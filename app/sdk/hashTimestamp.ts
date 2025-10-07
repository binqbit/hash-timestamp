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
  8 /*voters*/ +
  8 /*created_at*/ +
  1 /*bump*/ +
  7; /*padding*/

export const VOTE_INFO_SPACE =
  8 /*disc*/ +
  32 /*voter*/ +
  32 /*hash_id*/ +
  8 /*amount*/ +
  1 /*bump*/ +
  7; /*padding*/

const GENESIS_HASH = new Uint8Array(32);

export type HashBytes = Uint8Array | Buffer | number[] | string;

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
  newPayload: HashBytes
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
  return new Uint8Array(hasher.digest());
}

export function deriveGenesisHashId(payload: HashBytes): Uint8Array {
  return deriveUpdatedHash(GENESIS_HASH, 0, payload);
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
    const derivedBytes = deriveUpdatedHash(oldHashIdBytes, createdAt, newHashBytes);
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
