import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Connection,
  TransactionSignature,
} from "@solana/web3.js";
import { HashTimestamp } from "../../target/types/hash_timestamp";

// Must match on-chain layout
export const HASH_ACCOUNT_SPACE = 8 /*disc*/ + 32 + 8 + 8 + 1 + 7; // 64 bytes

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

  async vote(hash: HashBytes, payer?: Keypair): Promise<TransactionSignature> {
    const hashBytes = to32Bytes(hash);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashBytes);
    const votePda = this.votePda(hashPda, walletPk);

    const builder = this.program.methods.vote([...hashBytes]).accountsStrict({
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

  async unvote(
    hash: HashBytes,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const hashBytes = to32Bytes(hash);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashBytes);
    const votePda = this.votePda(hashPda, walletPk);

    const builder = this.program.methods.unvote([...hashBytes]).accountsStrict({
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

  async verify(hash: HashBytes): Promise<TransactionSignature> {
    const hashBytes = to32Bytes(hash);
    const hashPda = this.hashPda(hashBytes);
    return this.program.methods
      .verify([...hashBytes])
      .accountsStrict({ hashAccount: hashPda })
      .rpc();
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
