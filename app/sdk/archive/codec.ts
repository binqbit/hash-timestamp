import { PublicKey } from "@solana/web3.js";
import { canonicalHashId } from "../protocol/hashes";
import { deriveHashPda } from "../protocol/addresses";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ArchiveNode,
  HashArchive,
} from "./model";
import { inspectArchiveGraph } from "./graph";

export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_NODES = 10000;

function object(value: unknown, path: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${path}: expected a plain object`);
  return value as Record<string, unknown>;
}

function fields(
  value: Record<string, unknown>,
  required: string[],
  optional: string[],
  path: string
) {
  for (const field of required)
    if (!Object.prototype.hasOwnProperty.call(value, field))
      throw new Error(`${path}: missing ${field}`);
  for (const field of Object.keys(value))
    if (![...required, ...optional].includes(field))
      throw new Error(`${path}: unknown field ${field}`);
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new Error(`${path}: expected 32-byte lowercase hex`);
  return value;
}

export function archivePublicKey(value: unknown, path = "address"): string {
  if (typeof value !== "string")
    throw new Error(`${path}: expected base58 public key`);
  let key: PublicKey;
  try {
    key = new PublicKey(value);
  } catch (_) {
    throw new Error(`${path}: invalid public key`);
  }
  if (key.toBase58() !== value)
    throw new Error(`${path}: noncanonical public key`);
  return value;
}

function integer(value: unknown, signed: boolean, path: string): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value)
  )
    throw new Error(`${path}: expected canonical decimal string`);
  const n = BigInt(value);
  const minimum = signed ? -(1n << 63n) : 0n;
  const maximum = signed ? (1n << 63n) - 1n : (1n << 64n) - 1n;
  if (n < minimum || n > maximum)
    throw new Error(`${path}: integer out of range`);
  return value;
}

function members(
  value: unknown,
  parse: (item: unknown, path: string) => string,
  path: string
): string[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error(`${path}: expected nonempty member list`);
  const result = Array.from(value, (item, i) => parse(item, `${path}[${i}]`));
  if (new Set(result).size !== result.length)
    throw new Error(`${path}: duplicate members`);
  return result;
}

function node(value: unknown, path: string): ArchiveNode {
  const input = object(value, path);
  fields(input, ["hash", "source", "createdAt"], ["members", "snapshot"], path);
  const source = object(input.source, `${path}.source`);
  const sourcePath = `${path}.source`;
  let result: ArchiveNode;
  const common = {
    hash: hash(input.hash, `${path}.hash`),
    createdAt: integer(input.createdAt, true, `${path}.createdAt`),
  };
  if (common.createdAt === "0")
    throw new Error(`${path}: timestamp cannot be zero`);
  switch (source.kind) {
    case "hash":
    case "pack":
      fields(source, ["kind"], [], sourcePath);
      result = { ...common, source: { kind: source.kind } };
      break;
    case "account":
      fields(source, ["kind", "account"], [], sourcePath);
      result = {
        ...common,
        source: {
          kind: "account",
          account: archivePublicKey(source.account, sourcePath),
        },
      };
      break;
    case "branch":
      fields(
        source,
        ["kind", "previousHashId", "payload", "generation"],
        [],
        sourcePath
      );
      result = {
        ...common,
        source: {
          kind: "branch",
          previousHashId: hash(source.previousHashId, sourcePath),
          payload: hash(source.payload, sourcePath),
          generation: integer(source.generation, false, sourcePath),
        },
      };
      if (result.source.kind === "branch" && result.source.generation === "0")
        throw new Error(`${path}: branch generation cannot be zero`);
      break;
    case "batch":
      fields(source, ["kind", "members"], [], sourcePath);
      result = {
        ...common,
        source: {
          kind: "batch",
          members: members(source.members, hash, sourcePath),
        },
      };
      break;
    default:
      throw new Error(`${sourcePath}: unknown source kind`);
  }
  if (Object.prototype.hasOwnProperty.call(input, "members")) {
    if (source.kind !== "pack")
      throw new Error(`${path}: members witness is only valid for Pack`);
    result.members = members(
      input.members,
      archivePublicKey,
      `${path}.members`
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, "snapshot")) {
    if (source.kind !== "account")
      throw new Error(`${path}: snapshot is only valid for Account`);
    const snapshot = object(input.snapshot, `${path}.snapshot`);
    fields(
      snapshot,
      ["owner", "lamports", "executable", "rentEpoch", "data"],
      [],
      `${path}.snapshot`
    );
    if (typeof snapshot.executable !== "boolean")
      throw new Error(`${path}: executable must be boolean`);
    if (
      !Array.isArray(snapshot.data) ||
      Array.from(snapshot.data).some(
        (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255
      )
    )
      throw new Error(`${path}: snapshot data must be a byte array`);
    result.snapshot = {
      owner: archivePublicKey(snapshot.owner),
      lamports: integer(snapshot.lamports, false, path),
      executable: snapshot.executable,
      rentEpoch: integer(snapshot.rentEpoch, false, path),
      data: [...snapshot.data],
    };
  }
  return result;
}

/** Reject duplicate object keys before JSON.parse's last-value-wins behavior loses evidence. */
function rejectDuplicateKeys(json: string) {
  const stack: { keys?: Set<string>; key: boolean }[] = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(json))) {
    const text = token[0];
    const current = stack[stack.length - 1];
    if (text === "{") stack.push({ keys: new Set(), key: true });
    else if (text === "[") stack.push({ key: false });
    else if (text === "}" || text === "]") stack.pop();
    else if (text === "," && current?.keys) current.key = true;
    else if (text[0] === '"' && current?.keys && current.key) {
      const key = JSON.parse(text) as string;
      if (current.keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
      current.keys.add(key);
      current.key = false;
    }
  }
}

/** Strict, detached v1 decoding. Partial history is allowed, malformed known data is not. */
export function parseArchive(input: string | unknown): HashArchive {
  let value: unknown = input;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MAX_ARCHIVE_BYTES)
      throw new Error("Archive exceeds 16 MiB limit");
    value = JSON.parse(input);
    rejectDuplicateKeys(input);
  }
  const root = object(value, "archive");
  fields(root, ["format", "version", "programId", "nodes"], [], "archive");
  if (root.format !== ARCHIVE_FORMAT || root.version !== ARCHIVE_VERSION)
    throw new Error("Unsupported archive format or version");
  const programId = archivePublicKey(root.programId, "programId");
  const inputNodes = object(root.nodes, "nodes");
  if (Object.keys(inputNodes).length > MAX_ARCHIVE_NODES)
    throw new Error("Archive exceeds node limit");
  const nodes: Record<string, ArchiveNode> = {};
  for (const [pda, value] of Object.entries(inputNodes)) {
    archivePublicKey(pda, "node PDA");
    const parsed = node(value, `nodes.${pda}`);
    const kind = { hash: 0, account: 1, branch: 2, batch: 3, pack: 4 }[
      parsed.source.kind
    ];
    if (
      deriveHashPda(
        new PublicKey(programId),
        canonicalHashId(parsed.hash, kind)
      ).toBase58() !== pda
    )
      throw new Error(`Node PDA does not match its hash/source: ${pda}`);
    nodes[pda] = parsed;
  }
  const archive = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    programId,
    nodes,
  };
  if (Buffer.byteLength(JSON.stringify(archive), "utf8") > MAX_ARCHIVE_BYTES)
    throw new Error("Archive exceeds 16 MiB limit");
  inspectArchiveGraph(archive);
  return archive;
}

/** Stable object-key order, without reordering protocol-significant member lists. */
export function stringifyArchive(input: HashArchive): string {
  const archive = parseArchive(input);
  archive.nodes = Object.fromEntries(
    Object.entries(archive.nodes).sort(([a], [b]) => a.localeCompare(b))
  );
  const pretty = JSON.stringify(archive, null, 2) + "\n";
  // Whitespace must not make our own export impossible to import.
  return Buffer.byteLength(pretty, "utf8") <= MAX_ARCHIVE_BYTES
    ? pretty
    : JSON.stringify(archive);
}

export function createArchive(programId: PublicKey | string): HashArchive {
  return parseArchive({
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    programId: programId.toString(),
    nodes: {},
  });
}
