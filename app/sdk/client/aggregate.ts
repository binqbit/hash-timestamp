/** Ordered aggregate snapshots; batch/pack transaction builders remain explicit in the client. */
import type { PublicKey } from "@solana/web3.js";
import type { BatchMemberInput, HashAccountData, HashBytes } from "../types";
import { coerceBigInt, to32Bytes } from "../protocol/normalization";
import { hashSourceKindOf } from "../protocol/source";
import { decodeHashSource } from "../encoding";
import type { HashSnapshotInput } from "./accounts";

interface AggregateReader {
  hashPda(hashId: HashBytes): PublicKey;
  fetchHashAccount(hashId: HashBytes): Promise<HashAccountData | null>;
}

type AggregateKind = "batch" | "pack";

export function normalizeUniqueMemberIds(
  memberIds: HashBytes[],
  aggregate: AggregateKind
): Uint8Array[] {
  const normalized = memberIds.map((id) => to32Bytes(id));
  const seen = new Set<string>();

  for (const id of normalized) {
    const key = id.join(",");
    if (seen.has(key)) {
      throw new Error(`${aggregate} member IDs must be unique`);
    }
    seen.add(key);
  }

  return normalized;
}

/** Load ordered member snapshots once; public operations retain their own builders. */
export async function loadAggregateMembers(
  reader: AggregateReader,
  memberIds: Uint8Array[],
  aggregate: AggregateKind
): Promise<{ memberPdas: PublicKey[]; fingerprints: BatchMemberInput[] }> {
  const memberPdas = memberIds.map((id) => reader.hashPda(id));
  const accounts: HashSnapshotInput[] = await Promise.all(
    memberIds.map(async (id) => {
      const account = await reader.fetchHashAccount(id);
      if (!account) {
        throw new Error(`${aggregate} member hash not found`);
      }
      return account;
    })
  );

  // Preserve validation order: all timestamps, then source kinds, then hashes.
  const createdAts = accounts.map((account) => {
    const created = account.createdAt ?? account.created_at ?? null;
    if (created === null || created === undefined) {
      throw new Error(`${aggregate} member missing created_at`);
    }
    return coerceBigInt(created);
  });
  const kinds = accounts.map((account) =>
    hashSourceKindOf(decodeHashSource(account.source ?? {}))
  );
  const hashes = accounts.map((account) => {
    const hash = account.hash;
    if (!hash) {
      throw new Error(`${aggregate} member missing hash value`);
    }
    return to32Bytes(hash);
  });

  return {
    memberPdas,
    fingerprints: hashes.map((hash, index) => ({
      hash,
      kind: kinds[index],
      createdAt: createdAts[index],
    })),
  };
}
