import { createHash } from "crypto";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import {
  BatchMemberInput,
  HashBytes,
  HashSource,
  HashSourceKind,
  NumericLike,
  PackMemberInput,
  RestoreAccountSnapshotInput,
} from "../types";
import {
  numberToU64,
  to32Bytes,
  toI64Bytes,
  toU64Bytes,
  accountPublicKey,
  toBytes,
} from "./normalization";
import { hashSourceKindOf } from "./source";

export function canonicalHashId(
  hash: HashBytes,
  source: HashSource | HashSourceKind
): Uint8Array {
  const kind = hashSourceKindOf(source);
  const hasher = createHash("sha256");
  hasher.update(new Uint8Array(to32Bytes(hash)));
  hasher.update(new Uint8Array([kind]));
  return new Uint8Array(hasher.digest());
}

export function deriveGenesisHashId(hash: HashBytes): Uint8Array {
  return canonicalHashId(hash, HashSourceKind.Hash);
}

function toBoolByte(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0]);
}

export function deriveAccountMetadataHash(
  account: PublicKey,
  info: AccountInfo<Buffer>
): Uint8Array {
  const hasher = createHash("sha256");
  hasher.update(account.toBuffer());
  hasher.update(info.owner.toBuffer());

  const lamports = Buffer.alloc(8);
  lamports.writeBigUInt64LE(numberToU64(info.lamports));
  hasher.update(new Uint8Array(lamports));

  hasher.update(toBoolByte(info.executable));

  const rentEpoch = Buffer.alloc(8);
  rentEpoch.writeBigUInt64LE(numberToU64(info.rentEpoch));
  hasher.update(new Uint8Array(rentEpoch));

  hasher.update(info.data);

  return new Uint8Array(hasher.digest());
}

export function deriveAccountHashId(
  account: PublicKey,
  info: AccountInfo<Buffer>
): Uint8Array {
  const metadataHash = deriveAccountMetadataHash(account, info);
  return canonicalHashId(metadataHash, HashSourceKind.Account);
}

/** Exact historical snapshot framing, without conversion through RPC number fields. */
export function deriveAccountSnapshotHash(
  account: PublicKey | HashBytes,
  snapshot: RestoreAccountSnapshotInput
): Uint8Array {
  const hasher = createHash("sha256");
  hasher.update(accountPublicKey(account).toBuffer());
  hasher.update(accountPublicKey(snapshot.owner).toBuffer());
  hasher.update(toU64Bytes(snapshot.lamports));
  hasher.update(toBoolByte(snapshot.executable));
  hasher.update(toU64Bytes(snapshot.rentEpoch));
  hasher.update(toBytes(snapshot.data));
  return new Uint8Array(hasher.digest());
}

export function deriveBranchHash(
  previousCanonicalId: HashBytes,
  previousCreatedAt: NumericLike,
  previousGeneration: NumericLike,
  previousSourceKind: HashSourceKind,
  payload: HashBytes
): Uint8Array {
  const hasher = createHash("sha256");
  hasher.update(new Uint8Array(to32Bytes(previousCanonicalId)));
  hasher.update(new Uint8Array([hashSourceKindOf(previousSourceKind)]));
  hasher.update(new Uint8Array(toI64Bytes(previousCreatedAt)));
  hasher.update(new Uint8Array(toU64Bytes(previousGeneration)));
  hasher.update(new Uint8Array(to32Bytes(payload)));
  return new Uint8Array(hasher.digest());
}

export function deriveBranchHashId(branchHash: HashBytes): Uint8Array {
  return canonicalHashId(branchHash, HashSourceKind.Branch);
}

/** Shared ordered fingerprint byte framing for Batch and Pack. */
function aggregateHashDigest(
  members: ReadonlyArray<BatchMemberInput | PackMemberInput>
): Uint8Array {
  const hasher = createHash("sha256");
  for (const member of members) {
    hasher.update(new Uint8Array(to32Bytes(member.hash)));
    hasher.update(new Uint8Array([hashSourceKindOf(member.kind)]));
    hasher.update(new Uint8Array(toI64Bytes(member.createdAt)));
  }
  return new Uint8Array(hasher.digest());
}

export function derivePackHash(members: PackMemberInput[]): Uint8Array {
  if (members.length === 0) {
    throw new Error("pack requires at least one member");
  }
  return aggregateHashDigest(members);
}

export function derivePackHashId(packHash: HashBytes): Uint8Array {
  return canonicalHashId(packHash, HashSourceKind.Pack);
}

export function deriveBatchHash(members: BatchMemberInput[]): Uint8Array {
  if (members.length === 0) {
    throw new Error("batch requires at least one member");
  }
  return aggregateHashDigest(members);
}

export function deriveBatchHashId(batchHash: HashBytes): Uint8Array {
  return canonicalHashId(batchHash, HashSourceKind.Batch);
}
