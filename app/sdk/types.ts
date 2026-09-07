import type { BN, IdlAccounts } from "@coral-xyz/anchor";
import type { PublicKey, TransactionSignature } from "@solana/web3.js";
import type { HashTimestamp } from "../../target/types/hash_timestamp";
import type { HashArchive } from "./archive/model";

export const HASH_ACCOUNT_BASE_SIZE =
  8 /*disc*/ + 32 /*hash*/ + 8 /*voters*/ + 8 /*created_at*/ + 1; /*bump*/

export const VOTE_INFO_SPACE =
  8 /*disc*/ +
  32 /*voter*/ +
  32 /*hash_id*/ +
  8 /*amount*/ +
  1 /*bump*/ +
  7; /*padding*/

/** Byte arrays or hexadecimal strings without a `0x` prefix. Hashes/IDs are 32 bytes. */
export type HashBytes = Uint8Array | Buffer | number[] | string;
/** Prefer bigint or BN for integers outside JavaScript’s safe number range. */
export type NumericLike = number | bigint | BN;

export enum HashSourceKind {
  Hash = 0,
  Account = 1,
  Branch = 2,
  Batch = 3,
  Pack = 4,
}

export type HashSource =
  | { kind: "hash" }
  | { kind: "account"; account: PublicKey | HashBytes }
  | {
      kind: "branch";
      previousHashId: HashBytes;
      payload: HashBytes;
      generation: bigint;
    }
  | { kind: "batch"; members: HashBytes[] }
  | { kind: "pack" };

export type HashSourceKindLike = HashSource | HashSourceKind | number;

export interface RestoreAccountSnapshotInput {
  owner: PublicKey | HashBytes;
  lamports: NumericLike;
  executable: boolean;
  rentEpoch: NumericLike;
  data: Uint8Array | Buffer | number[];
}

export interface RestoreHashFingerprintInput {
  hash: HashBytes;
  sourceKind: HashSourceKindLike;
  createdAt: NumericLike;
  generation: NumericLike;
}

export type RestoreParametersInput =
  | { kind: "hash"; payload: HashBytes }
  | { kind: "account"; snapshot?: RestoreAccountSnapshotInput }
  | { kind: "branch"; parent: RestoreHashFingerprintInput }
  | { kind: "batch"; members: RestoreHashFingerprintInput[] }
  | { kind: "pack"; members: RestoreHashFingerprintInput[] };

export interface RestoreProofInput {
  hash: HashBytes;
  source: HashSource;
  createdAt: NumericLike;
  params?: RestoreParametersInput | null;
}

export interface PackMemberInput {
  hash: HashBytes;
  kind: HashSourceKind;
  createdAt: NumericLike;
}

export interface BatchMemberInput extends PackMemberInput {}

/** Raw Anchor account data: integers remain BN and source is the IDL enum. */
export type HashAccountData = IdlAccounts<HashTimestamp>["hashAccount"];
export type VoteInfoData = IdlAccounts<HashTimestamp>["voteInfo"];

export interface RestoreOptions {
  /** Defaults to true. False submits proof verification without account creation. */
  createAccounts?: boolean;
}

export interface RestoreResult {
  signature: TransactionSignature;
  /** IDs requested for materialization, not a list of newly created accounts. */
  restoredIds: Uint8Array[];
}

export interface CreationResult {
  signature: TransactionSignature;
  archive: HashArchive;
}

export interface BatchResult extends CreationResult {
  batchId: Uint8Array;
}

export interface PackResult extends CreationResult {
  packId: Uint8Array;
}

export interface AccountHashResult extends CreationResult {
  hashId: Uint8Array;
  metadataHash: Uint8Array;
}
