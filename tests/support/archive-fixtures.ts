import { readFileSync } from "fs";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import type { HashTimestamp } from "../../target/types/hash_timestamp";
import {
  createArchive,
  addArchiveNode,
  canonicalHashId,
  deriveBranchHash,
  deriveBatchHash,
  derivePackHash,
  deriveHashPda,
  encodeHashSource,
  type HashArchive,
  type HashSource,
} from "../../app/sdk/hashTimestamp";
import { deriveAccountSnapshotHash } from "../../app/sdk/protocol/hashes";
import {
  nodeId,
  sourceFromArchive,
  nodeFingerprint,
} from "../../app/sdk/archive/values";

export const digest = (value: string) =>
  createHash("sha256").update(value).digest();
export const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
export const fixtureIdl = JSON.parse(
  readFileSync("tests/fixtures/idl.json", "utf8")
);
export const fixtureProgram = () =>
  new Program<HashTimestamp>(fixtureIdl, {
    connection: new Connection("http://127.0.0.1:18899"),
  });

export function archiveFixture() {
  const programId = fixtureIdl.address as string;
  let archive = createArchive(programId);
  const pdas: Record<string, string> = {};
  function add(
    name: string,
    hash: Uint8Array,
    source: HashSource,
    time: bigint,
    extras = {}
  ) {
    const pda = deriveHashPda(
      new PublicKey(programId),
      canonicalHashId(hash, source)
    ).toBase58();
    const serial =
      source.kind === "branch"
        ? {
            ...source,
            previousHashId: hex(source.previousHashId as Uint8Array),
            payload: hex(source.payload as Uint8Array),
            generation: source.generation.toString(),
          }
        : source.kind === "batch"
        ? {
            ...source,
            members: source.members.map((id) => hex(id as Uint8Array)),
          }
        : source.kind === "account"
        ? { ...source, account: (source.account as PublicKey).toBase58() }
        : source;
    archive = addArchiveNode(archive, pda, {
      hash: hex(hash),
      source: serial,
      createdAt: time.toString(),
      ...extras,
    });
    pdas[name] = pda;
    return pda;
  }
  add("hash", digest("archive original"), { kind: "hash" }, 100n);
  add("other", digest("unrelated"), { kind: "hash" }, 105n);
  const target = new PublicKey(digest("target"));
  const snapshot = {
    owner: SystemProgram.programId,
    lamports: (1n << 64n) - 1n,
    rentEpoch: 0n,
    executable: false,
    data: [1, 2, 3],
  };
  add(
    "account",
    deriveAccountSnapshotHash(target, snapshot),
    { kind: "account", account: target },
    110n,
    {
      snapshot: {
        ...snapshot,
        owner: snapshot.owner.toBase58(),
        lamports: snapshot.lamports.toString(),
        rentEpoch: "0",
      },
    }
  );
  function branch(name: string, parent: string, time: bigint) {
    const node = archive.nodes[pdas[parent]],
      meta = nodeFingerprint(node),
      payload = digest(name);
    const parentId = nodeId(node);
    add(
      name,
      deriveBranchHash(
        parentId,
        meta.createdAt,
        meta.generation,
        Number(meta.sourceKind),
        payload
      ),
      {
        kind: "branch",
        previousHashId: parentId,
        payload,
        generation: BigInt(meta.generation.toString()) + 1n,
      },
      time
    );
  }
  branch("branch", "hash", 120n);
  branch("tip", "branch", 130n);
  const memberPdas = [pdas.hash, pdas.account];
  const members = memberPdas.map((pda) => {
    const n = archive.nodes[pda],
      f = nodeFingerprint(n);
    return { hash: n.hash, kind: Number(f.sourceKind), createdAt: f.createdAt };
  });
  add("pack", derivePackHash(members), { kind: "pack" }, 140n, {
    members: memberPdas,
  });
  const batchMembers = [pdas.branch, pdas.pack].map((pda) => {
    const n = archive.nodes[pda],
      f = nodeFingerprint(n);
    return { hash: n.hash, kind: Number(f.sourceKind), createdAt: f.createdAt };
  });
  add(
    "batch",
    deriveBatchHash(batchMembers),
    {
      kind: "batch",
      members: [
        nodeId(archive.nodes[pdas.branch]),
        nodeId(archive.nodes[pdas.pack]),
      ],
    },
    150n
  );
  return { archive, pdas };
}

/** Real Anchor account bytes, supplied through fake RPC only. */
export async function accountInfo(
  program: ReturnType<typeof fixtureProgram>,
  archive: HashArchive,
  pda: string
) {
  const node = archive.nodes[pda];
  const id = nodeId(node);
  const [, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("hash"), Buffer.from(id)],
    program.programId
  );
  return {
    owner: program.programId,
    executable: false,
    lamports: 10000000,
    rentEpoch: 0,
    data: await program.coder.accounts.encode("hashAccount", {
      hash: [...Buffer.from(node.hash, "hex")],
      source: encodeHashSource(sourceFromArchive(node.source)),
      createdAt: new BN(node.createdAt),
      voters: new BN(1),
      bump,
    }),
  };
}

/** Adds post-confirmation reads to existing builder-boundary fakes without a validator. */
export function mockCapture(
  program: any,
  hash: Uint8Array,
  source: HashSource,
  createdAt = 200n
) {
  const coder = fixtureProgram().coder;
  program.coder = coder;
  program.provider.connection.confirmTransaction = async () => ({
    context: { slot: 100 },
    value: { err: null },
  });
  const previous = program.provider.connection.getAccountInfo?.bind(
    program.provider.connection
  );
  const id = canonicalHashId(hash, source);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("hash"), Buffer.from(id)],
    program.programId
  );
  program.provider.connection.getAccountInfo = async (address: PublicKey) => {
    if (!address.equals(pda)) return previous ? previous(address) : null;
    return {
      owner: program.programId,
      executable: false,
      lamports: 10000000,
      rentEpoch: 0,
      data: await coder.accounts.encode("hashAccount", {
        hash: [...hash],
        source: encodeHashSource(source),
        createdAt: new BN(createdAt.toString()),
        voters: new BN(1),
        bump,
      }),
    };
  };
}
