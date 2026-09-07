import {
  HASH_ACCOUNT_BASE_SIZE,
  HashSource,
  HashSourceKind,
  HashSourceKindLike,
} from "../types";

export function generationFromSource(source: HashSource): bigint {
  return source.kind === "branch" ? source.generation : BigInt(0);
}

export function hashSourceKindOf(source: HashSourceKindLike): HashSourceKind {
  if (typeof source === "number") {
    if (!Number.isInteger(source) || source < 0 || source > 4) {
      throw new Error(`invalid hash source kind: ${source}`);
    }
    return source as HashSourceKind;
  }

  if (typeof source !== "object" || source === null) {
    throw new Error(`invalid hash source: ${String(source)}`);
  }

  const raw = source as Record<string, unknown>;
  if (raw.hash !== undefined) {
    return HashSourceKind.Hash;
  }
  if (raw.account !== undefined) {
    return HashSourceKind.Account;
  }
  if (raw.branch !== undefined) {
    return HashSourceKind.Branch;
  }
  if (raw.batch !== undefined) {
    return HashSourceKind.Batch;
  }
  if (raw.pack !== undefined) {
    return HashSourceKind.Pack;
  }

  switch ((source as HashSource).kind) {
    case "hash":
      return HashSourceKind.Hash;
    case "account":
      return HashSourceKind.Account;
    case "branch":
      return HashSourceKind.Branch;
    case "batch":
      return HashSourceKind.Batch;
    case "pack":
      return HashSourceKind.Pack;
    default:
      throw new Error(`invalid hash source: ${JSON.stringify(source)}`);
  }
}

function serializedSizeForHashSourceKind(
  kind: HashSourceKind,
  source?: HashSource
): number {
  switch (kind) {
    case HashSourceKind.Hash:
      return 1 + 6;
    case HashSourceKind.Account:
      return 1 + 32 + 6;
    case HashSourceKind.Branch:
      return 1 + 32 + 32 + 8 + 6;
    case HashSourceKind.Batch: {
      const members = source && source.kind === "batch" ? source.members : [];
      return 1 + 4 + members.length * 32 + 2;
    }
    case HashSourceKind.Pack:
      return 1 + 6;
    default:
      throw new Error(`invalid hash source kind: ${kind}`);
  }
}

export function hashAccountSpace(
  source: HashSource = { kind: "hash" }
): number {
  const kind = hashSourceKindOf(source);
  return HASH_ACCOUNT_BASE_SIZE + serializedSizeForHashSourceKind(kind, source);
}

export function normalizeSourceKind(value: HashSourceKindLike): number {
  return Number(hashSourceKindOf(value));
}
