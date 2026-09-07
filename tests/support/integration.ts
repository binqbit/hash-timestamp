import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { HashTimestamp } from "../../target/types/hash_timestamp";

import {
  HashSource,
  HashSourceKind,
  HashTimestampClient,
  canonicalHashId,
  decodeHashSource,
  deriveAccountHashId,
  deriveAccountMetadataHash,
  deriveBatchHash,
  deriveBatchHashId,
  deriveBranchHash,
  deriveBranchHashId,
  deriveGenesisHashId,
  derivePackHash,
  derivePackHashId,
  generationFromSource,
  hashAccountSpace,
  hashSourceKindOf,
  rentExemptForHash,
  rentExemptForVote,
} from "../../app/sdk/hashTimestamp";

export { errorCodeOf, expectProgramError } from "./assertions";

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

export const program = anchor.workspace.HashTimestamp as Program<HashTimestamp>;
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

export const hashSourceOf = (account: any): HashSource =>
  decodeHashSource((account as any).source ?? {});

export const sourceKindOf = (account: any): HashSourceKind =>
  hashSourceKindOf(hashSourceOf(account));

export const generationOf = (account: any): number =>
  Number(generationFromSource(hashSourceOf(account)));

export const hashSpaceOf = (account: any): number =>
  hashAccountSpace(hashSourceOf(account));

export const airdrop = async (
  pubkey: PublicKey,
  lamports = LAMPORTS_PER_SOL
) => {
  const sig = await provider.connection.requestAirdrop(pubkey, lamports);
  const confirmation = await provider.connection.confirmTransaction(
    sig,
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error(
      `Airdrop failed: ${JSON.stringify(confirmation.value.err)}`
    );
  }
};

export const hashLamports = async (
  hashId: Buffer | Uint8Array
): Promise<number> => {
  const info = await provider.connection.getAccountInfo(client.hashPda(hashId));
  return info?.lamports ?? 0;
};

export const voteLamports = async (
  hashId: Buffer | Uint8Array,
  voter: PublicKey
): Promise<number> => {
  const info = await provider.connection.getAccountInfo(
    client.votePda(hashId, voter)
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

export const rentForSource = async (source: HashSource) =>
  rentExemptForHash(provider.connection, source);

export {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  HashSourceKind,
  HashTimestampClient,
  canonicalHashId,
  deriveAccountHashId,
  deriveAccountMetadataHash,
  deriveBatchHash,
  deriveBatchHashId,
  deriveBranchHash,
  deriveBranchHashId,
  derivePackHash,
  derivePackHashId,
  deriveGenesisHashId,
  hashAccountSpace,
};
