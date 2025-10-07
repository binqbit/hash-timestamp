import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Connection,
  TransactionSignature,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { HashTimestamp } from "../../target/types/hash_timestamp";

// Must match on-chain layout
export const HASH_ACCOUNT_SPACE =
  8 /*disc*/ +
  32 /*previous.hash*/ +
  8 /*previous.created_at*/ +
  8 /*previous.generation*/ +
  32 /*hash*/ +
  1 /*hash_type*/ +
  8 /*voters*/ +
  8 /*created_at*/ +
  1 /*bump*/ +
  6; /*padding*/

export const VOTE_INFO_SPACE =
  8 /*disc*/ +
  32 /*voter*/ +
  32 /*hash_id*/ +
  8 /*amount*/ +
  1 /*bump*/ +
  7; /*padding*/

const GENESIS_HASH = new Uint8Array(32);

export type HashBytes = Uint8Array | Buffer | number[] | string;

export enum HashType {
  Hash = 0,
  Branch = 1,
  Batch = 2,
}

export function to32Bytes(input: HashBytes): Uint8Array {
  let buf: Buffer;
  if (input instanceof Uint8Array) {
    buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  } else if (Buffer.isBuffer(input)) {
    buf = input;
  } else if (Array.isArray(input)) {
    buf = Buffer.from(input);
  } else {
    buf = Buffer.from(input, "hex");
  }
  if (buf.length !== 32) throw new Error("hash must be exactly 32 bytes");
  return new Uint8Array(buf);
}

export function deriveUpdatedHash(
  previousHashId: HashBytes,
  previousCreatedAt: number | anchor.BN,
  newPayload: HashBytes,
  hashType: HashType = HashType.Branch
): Uint8Array {
  const prevHashBytes = Buffer.from(to32Bytes(previousHashId));
  const payloadBytes = Buffer.from(to32Bytes(newPayload));
  const createdAt =
    typeof previousCreatedAt === "number"
      ? BigInt(previousCreatedAt)
      : BigInt(previousCreatedAt.toString());
  const createdBuf = Buffer.alloc(8);
  createdBuf.writeBigInt64LE(createdAt);

  const hasher = createHash("sha256");
  hasher.update(new Uint8Array(prevHashBytes));
  hasher.update(new Uint8Array(createdBuf));
  hasher.update(new Uint8Array(payloadBytes));
  hasher.update(new Uint8Array([hashType]));
  return new Uint8Array(hasher.digest());
}

export function deriveGenesisHashId(payload: HashBytes): Uint8Array {
  return deriveUpdatedHash(GENESIS_HASH, 0, payload, HashType.Hash);
}

type NumericLike = number | bigint | anchor.BN;

function toBigInt(value: NumericLike): bigint {
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "bigint") {
    return value;
  }
  return BigInt(value.toString());
}

function toI64Bytes(value: NumericLike): Uint8Array {
  const bigintValue = toBigInt(value);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(bigintValue);
  return new Uint8Array(buf);
}

function toU64Bytes(value: NumericLike): Uint8Array {
  const bigintValue = toBigInt(value);
  if (bigintValue < BigInt(0)) {
    throw new Error("value must be non-negative");
  }
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(bigintValue);
  return new Uint8Array(buf);
}

function coerceNumericLike(value: any): NumericLike {
  if (typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value && typeof value.toString === "function") {
    return BigInt(value.toString());
  }
  if (value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  throw new Error("unsupported numeric value");
}

function coerceBigInt(value: any): bigint {
  return toBigInt(coerceNumericLike(value));
}

function pickField<T = any>(object: any, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }
  return undefined;
}

export function deriveBatchPayloadHash(
  memberCanonicalIds: HashBytes[],
  memberCreatedAts: NumericLike[],
  memberGenerations: NumericLike[]
): Uint8Array {
  if (memberCanonicalIds.length === 0) {
    throw new Error("batch requires at least one member");
  }
  if (
    memberCanonicalIds.length !== memberCreatedAts.length ||
    memberCanonicalIds.length !== memberGenerations.length
  ) {
    throw new Error("member canonical ids, timestamps, and generations length mismatch");
  }
  const hasher = createHash("sha256");
  for (let i = 0; i < memberCanonicalIds.length; i++) {
    hasher.update(new Uint8Array(to32Bytes(memberCanonicalIds[i])));
    hasher.update(new Uint8Array(toI64Bytes(memberCreatedAts[i])));
    hasher.update(new Uint8Array(toU64Bytes(memberGenerations[i])));
  }
  return new Uint8Array(hasher.digest());
}

export function deriveBatchHashId(
  memberCanonicalIds: HashBytes[],
  memberCreatedAts: NumericLike[],
  memberGenerations: NumericLike[]
): Uint8Array {
  const aggregated = deriveBatchPayloadHash(
    memberCanonicalIds,
    memberCreatedAts,
    memberGenerations
  );
  return deriveUpdatedHash(GENESIS_HASH, 0, aggregated, HashType.Batch);
}

export function deriveHashPda(
  programId: PublicKey,
  hash: HashBytes
): PublicKey {
  const hashBytes = to32Bytes(hash);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("hash"), Buffer.from(hashBytes)],
    programId
  );
  return pda;
}

export function deriveVotePda(
  programId: PublicKey,
  hashPda: PublicKey,
  voter: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), hashPda.toBuffer(), voter.toBuffer()],
    programId
  );
  return pda;
}

export async function rentExemptForHash(conn: Connection): Promise<number> {
  return conn.getMinimumBalanceForRentExemption(HASH_ACCOUNT_SPACE);
}

export async function rentExemptForVote(conn: Connection): Promise<number> {
  return conn.getMinimumBalanceForRentExemption(VOTE_INFO_SPACE);
}

export class HashTimestampClient {
  readonly program: Program<HashTimestamp>;
  constructor(program: Program<HashTimestamp>) {
    this.program = program;
  }

  get connection(): Connection {
    return this.program.provider.connection;
  }
  get programId(): PublicKey {
    return this.program.programId;
  }

  hashPda(hash: HashBytes): PublicKey {
    return deriveHashPda(this.programId, hash);
  }
  votePda(hashPda: PublicKey, voter: PublicKey): PublicKey {
    return deriveVotePda(this.programId, hashPda, voter);
  }

  async register(hash: HashBytes, payer?: Keypair): Promise<TransactionSignature> {
    const hashBytes = to32Bytes(hash);
    const hashIdBytes = deriveGenesisHashId(hashBytes);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashPda, walletPk);

    const builder = this.program.methods
      .register([...hashBytes])
      .accountsStrict({
        hashAccount: hashPda,
        voteInfo: votePda,
        user: walletPk,
        systemProgram: SystemProgram.programId,
      });

    if (payer) {
      return builder.signers([payer]).rpc();
    }
    return builder.rpc();
  }

  async vote(hashId: HashBytes, payer?: Keypair): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashPda, walletPk);

    const builder = this.program.methods.vote().accountsStrict({
      hashAccount: hashPda,
      voteInfo: votePda,
      user: walletPk,
      systemProgram: SystemProgram.programId,
    });

    if (payer) {
      return builder.signers([payer]).rpc();
    }
    return builder.rpc();
  }

  async unvote(hashId: HashBytes, payer?: Keypair): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashPda, walletPk);

    const builder = this.program.methods.unvote().accountsStrict({
      hashAccount: hashPda,
      voteInfo: votePda,
      user: walletPk,
      systemProgram: SystemProgram.programId,
    });

    if (payer) {
      return builder.signers([payer]).rpc();
    }
    return builder.rpc();
  }

  async verify(hashId: HashBytes): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const hashPda = this.hashPda(hashIdBytes);
    return this.program.methods
      .verify()
      .accountsStrict({ hashAccount: hashPda })
      .rpc();
  }

  async branch(
    oldHashId: HashBytes,
    newHash: HashBytes,
    takeVote = true,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const oldHashIdBytes = to32Bytes(oldHashId);
    const newHashBytes = to32Bytes(newHash);
    const oldHashPda = this.hashPda(oldHashIdBytes);

    const oldAccount = await this.fetchHashAccount(oldHashIdBytes);
    if (!oldAccount) {
      throw new Error("old hash account not found");
    }
    const createdAt =
      typeof oldAccount.createdAt === "number"
        ? oldAccount.createdAt
        : oldAccount.createdAt.toNumber();
    const derivedBytes = deriveUpdatedHash(
      oldHashIdBytes,
      createdAt,
      newHashBytes,
      HashType.Branch
    );
    const newHashPda = this.hashPda(derivedBytes);
    const newVotePda = this.votePda(newHashPda, walletPk);
    const oldVotePda = this.votePda(oldHashPda, walletPk);

    const builder = this.program.methods
      .branch([...newHashBytes], takeVote)
      .accountsStrict({
        oldHashAccount: oldHashPda,
        newHashAccount: newHashPda,
        oldVoteInfo: oldVotePda,
        newVoteInfo: newVotePda,
        user: walletPk,
        systemProgram: SystemProgram.programId,
      });

    if (payer) {
      return builder.signers([payer]).rpc();
    }
    return builder.rpc();
  }

  async batch(
    memberIds: HashBytes[],
    payer?: Keypair
  ): Promise<{ signature: TransactionSignature; batchId: Uint8Array }> {
    if (memberIds.length === 0) {
      throw new Error("batch requires at least one member");
    }

    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;

    const memberIdBytes = memberIds.map((id) => to32Bytes(id));
    const memberPdas = memberIdBytes.map((id) => this.hashPda(id));

    const memberAccounts = await Promise.all(
      memberIdBytes.map(async (id) => {
        const account = await this.fetchHashAccount(id);
        if (!account) {
          throw new Error("batch member hash not found");
        }
        return account;
      })
    );

    const memberCreatedAts = memberAccounts.map((account) => {
      const created =
        (account as any).createdAt ?? (account as any).created_at ?? null;
      if (created === null || created === undefined) {
        throw new Error("batch member missing created_at");
      }
      return coerceBigInt(created);
    });

    const memberGenerations = memberAccounts.map((account) => {
      const prev =
        (account as any).previous ??
        (account as any).previousBlock ??
        (account as any).previous_block ??
        null;
      if (!prev) {
        return BigInt(0);
      }
      const prevHashRaw =
        pickField(prev, "hashId", "hash_id", "hash") ?? new Uint8Array(32);
      const prevHash = Buffer.from(to32Bytes(prevHashRaw as HashBytes));
      const prevCreated = coerceBigInt(
        pickField(prev, "createdAt", "created_at") ?? 0
      );
      const prevGeneration = coerceBigInt(
        pickField(prev, "generation", "gen") ?? 0
      );
      const isZeroHash = prevHash.every((value) => value === 0);
      const isGenesisPrev =
        isZeroHash && prevCreated === BigInt(0) && prevGeneration === BigInt(0);
      return isGenesisPrev ? BigInt(0) : prevGeneration + BigInt(1);
    });

    const batchId = deriveBatchHashId(
      memberIdBytes,
      memberCreatedAts,
      memberGenerations
    );
    const batchPda = this.hashPda(batchId);
    const votePda = this.votePda(batchPda, walletPk);

    const builder = this.program.methods
      .batch()
      .accountsStrict({
        batchHashAccount: batchPda,
        voteInfo: votePda,
        payer: walletPk,
        systemProgram: SystemProgram.programId,
      })
      // Anchor's remainingAccounts maintains order; preserve provided sequence.
      .remainingAccounts(
        memberPdas.map((pubkey) => ({
          pubkey,
          isSigner: false,
          isWritable: false,
        }))
      );

    const signature = payer
      ? await builder.signers([payer]).rpc()
      : await builder.rpc();

    return { signature, batchId };
  }

  // Account helpers
  async fetchHashAccount(hash: HashBytes) {
    const hashPda = this.hashPda(hash);
    // Prefer fetchNullable to avoid throwing on closed/cleared accounts
    // @ts-ignore - older Anchor types may not have fetchNullable in types
    if (this.program.account.hashAccount.fetchNullable) {
      // @ts-ignore
      return this.program.account.hashAccount.fetchNullable(hashPda);
    }
    try {
      return await this.program.account.hashAccount.fetch(hashPda);
    } catch (_) {
      return null;
    }
  }

  async fetchVoteInfo(hash: HashBytes, voter: PublicKey) {
    const hashPda = this.hashPda(hash);
    const votePda = this.votePda(hashPda, voter);
    // @ts-ignore
    if (this.program.account.voteInfo.fetchNullable) {
      // @ts-ignore
      return this.program.account.voteInfo.fetchNullable(votePda);
    }
    try {
      return await this.program.account.voteInfo.fetch(votePda);
    } catch (_) {
      return null;
    }
  }
}
