/** RPC compatibility and interpretation of fetched Anchor account data. */
import type { PublicKey } from "@solana/web3.js";
import type { HashBytes } from "../types";
import { coerceBigInt } from "../protocol/normalization";
import { generationFromSource, hashSourceKindOf } from "../protocol/source";
import { decodeHashSource } from "../encoding";

interface NullableAccountReader<T> {
  fetch(address: PublicKey): Promise<T>;
  fetchNullable?(address: PublicKey): Promise<T | null>;
}

/** Preserve legacy fetch fallback behavior; modern fetchNullable errors propagate. */
export async function fetchNullableAccount<T>(
  reader: NullableAccountReader<T>,
  address: PublicKey
): Promise<T | null> {
  if (reader.fetchNullable) return reader.fetchNullable(address);
  try {
    return await reader.fetch(address);
  } catch (_) {
    return null;
  }
}

/** Narrow boundary also accepts legacy snake_case snapshots from custom readers. */
export interface HashSnapshotInput {
  hash?: HashBytes;
  source?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
}

export function branchParentMetadata(account: HashSnapshotInput) {
  const createdAt = coerceBigInt(account.createdAt ?? account.created_at ?? 0);
  const source = decodeHashSource(account.source ?? {});
  return {
    createdAt,
    generation: generationFromSource(source),
    sourceKind: hashSourceKindOf(source),
  };
}
