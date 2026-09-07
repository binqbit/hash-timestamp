import { PublicKey } from "@solana/web3.js";
import {
  accountPublicKey,
  to32Bytes,
  toBigInt,
} from "../protocol/normalization";
import { canonicalHashId } from "../protocol/hashes";
import { generationFromSource, hashSourceKindOf } from "../protocol/source";
import type {
  HashSource,
  RestoreAccountSnapshotInput,
  RestoreHashFingerprintInput,
} from "../types";
import type { ArchiveNode, ArchiveSnapshot, ArchiveSource } from "./model";

export const archiveHex = (bytes: Uint8Array | number[] | string) =>
  Buffer.from(to32Bytes(bytes)).toString("hex");

export function archiveSource(source: HashSource): ArchiveSource {
  switch (source.kind) {
    case "hash":
    case "pack":
      return { kind: source.kind };
    case "account":
      return {
        kind: "account",
        account: accountPublicKey(source.account).toBase58(),
      };
    case "branch":
      return {
        kind: "branch",
        previousHashId: archiveHex(source.previousHashId),
        payload: archiveHex(source.payload),
        generation: source.generation.toString(),
      };
    case "batch":
      return { kind: "batch", members: source.members.map(archiveHex) };
  }
}

export function sourceFromArchive(source: ArchiveSource): HashSource {
  if (source.kind === "branch")
    return { ...source, generation: BigInt(source.generation) };
  if (source.kind === "account")
    return { ...source, account: new PublicKey(source.account) };
  return source;
}

export function archiveSnapshot(
  snapshot: RestoreAccountSnapshotInput
): ArchiveSnapshot {
  return {
    owner: accountPublicKey(snapshot.owner).toBase58(),
    lamports: toBigInt(snapshot.lamports).toString(),
    executable: snapshot.executable,
    rentEpoch: toBigInt(snapshot.rentEpoch).toString(),
    data: [...snapshot.data],
  };
}

export function snapshotFromArchive(
  snapshot: ArchiveSnapshot
): RestoreAccountSnapshotInput {
  return {
    ...snapshot,
    owner: new PublicKey(snapshot.owner),
    lamports: BigInt(snapshot.lamports),
    rentEpoch: BigInt(snapshot.rentEpoch),
    data: [...snapshot.data],
  };
}

export function nodeId(node: ArchiveNode): Uint8Array {
  return canonicalHashId(node.hash, sourceFromArchive(node.source));
}

export function nodeFingerprint(
  node: ArchiveNode
): RestoreHashFingerprintInput {
  const source = sourceFromArchive(node.source);
  return {
    hash: node.hash,
    sourceKind: hashSourceKindOf(source),
    createdAt: BigInt(node.createdAt),
    generation: generationFromSource(source),
  };
}
