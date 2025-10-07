import { deserialize, serialize } from "v8";

if (typeof (globalThis as any).structuredClone !== "function") {
  (globalThis as any).structuredClone = (value: unknown) =>
    deserialize(serialize(value));
}

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { HashTimestamp } from "../target/types/hash_timestamp";
import {
  HashTimestampClient,
  HashType,
  deriveAccountHashId,
  deriveAccountMetadataHash,
  deriveBatchHashId,
  deriveBatchPayloadHash,
  deriveGenesisHashId,
  deriveUpdatedHash,
  rentExemptForHash,
  rentExemptForVote,
} from "../app/sdk/hashTimestamp";

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export const program = anchor.workspace
  .HashTimestamp as Program<HashTimestamp>;
export const client = new HashTimestampClient(program);

export const randomHash = () => Keypair.generate().publicKey.toBuffer();
export const zeroHash = Buffer.alloc(32, 0);

export const toNum = (value: any): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value.toNumber === "function") return value.toNumber();
  if (value && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new TypeError("Unable to coerce value to number");
};

export const toHashType = (value: any): HashType => {
  if (value == null) {
    throw new TypeError("hash type is nullish");
  }

  if (typeof value === "number") {
    return value as HashType;
  }

  if (typeof value === "bigint") {
    return Number(value) as HashType;
  }

  if (typeof value.toNumber === "function") {
    return value.toNumber() as HashType;
  }

  if (Array.isArray(value) && value.length > 0) {
    return toHashType(value[0]);
  }

  const keys = Object.keys(value);
  for (const key of keys) {
    switch (key.toLowerCase()) {
      case "hash":
        return HashType.Hash;
      case "account":
        return HashType.Account;
      case "branch":
        return HashType.Branch;
      case "batch":
        return HashType.Batch;
    }
  }

  throw new TypeError(
    `Unknown hash type representation: ${JSON.stringify(value)}`
  );
};

export const generationOf = (account: any): number => {
  const prev = account.previous;
  const prevHashBuffer = Buffer.from(
    prev.hashId ?? prev.hash_id ?? prev.hash
  );
  const isGenesisPrev =
    Buffer.compare(
      new Uint8Array(prevHashBuffer),
      new Uint8Array(zeroHash)
    ) === 0 &&
    toNum(prev.createdAt) === 0 &&
    toNum(prev.generation) === 0;
  return isGenesisPrev ? 0 : toNum(prev.generation) + 1;
};

export const airdrop = async (
  pubkey: PublicKey,
  lamports = LAMPORTS_PER_SOL
) => {
  const sig = await provider.connection.requestAirdrop(pubkey, lamports);
  await provider.connection.confirmTransaction(sig);
};

export const hashLamports = async (
  hashId: Buffer | Uint8Array
): Promise<number> => {
  const info = await provider.connection.getAccountInfo(
    client.hashPda(hashId)
  );
  return info?.lamports ?? 0;
};

export const voteLamports = async (
  hashId: Buffer | Uint8Array,
  voter: PublicKey
): Promise<number> => {
  const hashPda = client.hashPda(hashId);
  const info = await provider.connection.getAccountInfo(
    client.votePda(hashPda, voter)
  );
  return info?.lamports ?? 0;
};

let cachedRent: { hash: number; vote: number } | null = null;

export const getRentMinimums = async () => {
  if (!cachedRent) {
    const hash = await rentExemptForHash(provider.connection);
    const vote = await rentExemptForVote(provider.connection);
    cachedRent = { hash, vote };
  }

  return cachedRent;
};

export {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  HashType,
  HashTimestampClient,
  deriveAccountHashId,
  deriveAccountMetadataHash,
  deriveBatchHashId,
  deriveBatchPayloadHash,
  deriveGenesisHashId,
  deriveUpdatedHash,
};
