import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Connection,
  TransactionSignature,
  AccountInfo,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { HashTimestamp } from "../../target/types/hash_timestamp";

// Must match on-chain layout
export const HASH_ACCOUNT_BASE_SIZE =
  8 /*disc*/ + 32 /*hash*/ + 8 /*voters*/ + 8 /*created_at*/ + 1; /*bump*/

export const VOTE_INFO_SPACE =
  8 /*disc*/ +
  32 /*voter*/ +
  32 /*hash_id*/ +
  8 /*amount*/ +
  1 /*bump*/ +
  7; /*padding*/

const GENESIS_HASH = new Uint8Array(32);

export type HashBytes = Uint8Array | Buffer | number[] | string;
export type NumericLike = number | bigint | anchor.BN;

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

export function hashSourceKindOf(
  source: HashSource | HashSourceKind
): HashSourceKind {
  if (typeof source === "number") {
    return source as HashSourceKind;
  }
  switch (source.kind) {
    case "hash":
      return HashSourceKind.Hash;
    case "account":
      return HashSourceKind.Account;
    case "branch":
      return HashSourceKind.Branch;
    case "batch":
      return HashSourceKind.Batch;
    case "pack":
      return HashSourceKind.Pack;
    default:
      throw new Error("unrecognized hash source variant");
  }
}

export function hashAccountSpace(source: HashSource): number {
  // Sum of: discriminator + fields + padding
  const base = HASH_ACCOUNT_BASE_SIZE;
  switch (source.kind) {
    case "hash":
      return base + 1 + 6;
    case "account":
      return base + 1 + 32 + 6;
    case "branch":
      return base + 1 + 32 + 32 + 8 + 6;
    case "batch": {
      const length = source.members.length;
      return base + 1 + 4 + length * 32 + 2;
    }
    case "pack":
      return base + 1 + 6;
    default:
      return base + 1;
  }
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

  const dataLength = Buffer.alloc(8);
  dataLength.writeBigUInt64LE(BigInt(info.data.length));
  hasher.update(new Uint8Array(dataLength));
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

export function deriveBranchHash(
  previousCanonicalId: HashBytes,
  previousCreatedAt: NumericLike,
  previousGeneration: NumericLike,
  previousSourceKind: HashSourceKind,
  payload: HashBytes
): Uint8Array {
  const hasher = createHash("sha256");
  hasher.update(new Uint8Array(to32Bytes(previousCanonicalId)));
  hasher.update(new Uint8Array([previousSourceKind]));
  hasher.update(new Uint8Array(toI64Bytes(previousCreatedAt)));
  hasher.update(new Uint8Array(toU64Bytes(previousGeneration)));
  hasher.update(new Uint8Array(to32Bytes(payload)));
  return new Uint8Array(hasher.digest());
}

export function deriveBranchHashId(branchHash: HashBytes): Uint8Array {
  return canonicalHashId(branchHash, HashSourceKind.Branch);
}

function numberToU64(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error("value must be a finite number");
  }
  if (value < 0) {
    throw new Error("value must be non-negative");
  }
  const max = (BigInt(1) << BigInt(64)) - BigInt(1);
  const truncated = Math.floor(value);
  let bigint = BigInt(truncated);
  if (bigint > max) {
    bigint = max;
  }
  return bigint;
}

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

export function decodeHashSource(raw: any): HashSource {
  if (!raw || typeof raw !== "object") {
    return { kind: "hash" };
  }

  const entries = Object.entries(raw);
  if (entries.length === 0) {
    return { kind: "hash" };
  }

  const [variantRaw, value] = entries[0];
  const variant = variantRaw.toLowerCase();

  switch (variant) {
    case "hash":
      return { kind: "hash" };
    case "account": {
      const accountValue = pickField(
        value,
        "account",
        "pubkey",
        "pubKey",
        "key"
      );
      return { kind: "account", account: accountValue ?? value };
    }
    case "branch": {
      const previous = pickField(
        value,
        "previousHashId",
        "previous_hash_id",
        "previousHashID"
      );
      const payload = pickField(value, "payload");
      const generation = pickField(value, "generation") ?? 0;
      if (!previous || !payload) {
        throw new Error("branch source missing previous hash or payload");
      }
      return {
        kind: "branch",
        previousHashId: to32Bytes(previous as HashBytes),
        payload: to32Bytes(payload as HashBytes),
        generation: coerceBigInt(generation),
      };
    }
    case "batch": {
      const membersValue = pickField(value, "members") ?? [];
      const membersArray = Array.isArray(membersValue) ? membersValue : [];
      const normalized = membersArray.map((member) =>
        to32Bytes(member as HashBytes)
      );
      return { kind: "batch", members: normalized };
    }
    case "pack": {
      return { kind: "pack" };
    }
    default:
      return { kind: "hash" };
  }
}

export function generationFromSource(source: HashSource): bigint {
  return source.kind === "branch" ? source.generation : BigInt(0);
}

export interface PackMemberInput {
  hash: HashBytes;
  kind: HashSourceKind;
  createdAt: NumericLike;
}

export interface BatchMemberInput {
  hash: HashBytes;
  kind: HashSourceKind;
  createdAt: NumericLike;
}

export function derivePackHash(members: PackMemberInput[]): Uint8Array {
  if (members.length === 0) {
    throw new Error("pack requires at least one member");
  }
  const hasher = createHash("sha256");
  for (const member of members) {
    hasher.update(new Uint8Array(to32Bytes(member.hash)));
    hasher.update(new Uint8Array([member.kind]));
    hasher.update(new Uint8Array(toI64Bytes(member.createdAt)));
  }
  return new Uint8Array(hasher.digest());
}

export function derivePackHashId(packHash: HashBytes): Uint8Array {
  return canonicalHashId(packHash, HashSourceKind.Pack);
}

export function deriveBatchHash(members: BatchMemberInput[]): Uint8Array {
  if (members.length === 0) {
    throw new Error("batch requires at least one member");
  }
  const hasher = createHash("sha256");
  for (const member of members) {
    hasher.update(new Uint8Array(to32Bytes(member.hash)));
    hasher.update(new Uint8Array([member.kind]));
    hasher.update(new Uint8Array(toI64Bytes(member.createdAt)));
  }
  return new Uint8Array(hasher.digest());
}

export function deriveBatchHashId(batchHash: HashBytes): Uint8Array {
  return canonicalHashId(batchHash, HashSourceKind.Batch);
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
  hashId: HashBytes,
  voter: PublicKey
): PublicKey {
  const hashIdBytes = to32Bytes(hashId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), voter.toBuffer(), Buffer.from(hashIdBytes)],
    programId
  );
  return pda;
}

export async function rentExemptForHash(
  conn: Connection,
  source: HashSource = { kind: "hash" }
): Promise<number> {
  return conn.getMinimumBalanceForRentExemption(hashAccountSpace(source));
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
  votePda(hashId: HashBytes, voter: PublicKey): PublicKey {
    return deriveVotePda(this.programId, hashId, voter);
  }

  async register(
    hash: HashBytes,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const hashBytes = to32Bytes(hash);
    const hashIdBytes = deriveGenesisHashId(hashBytes);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashIdBytes, walletPk);

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

  async vote(
    hashId: HashBytes,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashIdBytes, walletPk);

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

  async unvote(
    hashId: HashBytes,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashIdBytes, walletPk);

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
    payload: HashBytes,
    takeVote = true,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;
    const oldHashIdBytes = to32Bytes(oldHashId);
    const payloadBytes = to32Bytes(payload);
    const oldHashPda = this.hashPda(oldHashIdBytes);

    const oldAccount = await this.fetchHashAccount(oldHashIdBytes);
    if (!oldAccount) {
      throw new Error("old hash account not found");
    }

    const createdRaw =
      (oldAccount as any).createdAt ?? (oldAccount as any).created_at ?? 0;
    const createdAt = coerceBigInt(createdRaw);
    const sourceRaw = (oldAccount as any).source ?? {};
    const decodedSource = decodeHashSource(sourceRaw);
    const parentGeneration = generationFromSource(decodedSource);
    const sourceKind = hashSourceKindOf(decodedSource);
    const newHash = deriveBranchHash(
      oldHashIdBytes,
      createdAt,
      parentGeneration,
      sourceKind,
      payloadBytes
    );
    const newGeneration = parentGeneration + BigInt(1);
    const newId = canonicalHashId(newHash, HashSourceKind.Branch);
    const newHashPda = this.hashPda(newId);
    const newVotePda = this.votePda(newId, walletPk);
    const oldVotePda = this.votePda(oldHashIdBytes, walletPk);

    const builder = this.program.methods
      .branch([...payloadBytes], takeVote)
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

    const memberSources = memberAccounts.map((account) =>
      decodeHashSource((account as any).source ?? {})
    );
    const memberKinds = memberSources.map((source) => hashSourceKindOf(source));

    const memberHashes = memberAccounts.map((account) => {
      const hashValue = (account as any).hash;
      if (!hashValue) {
        throw new Error("batch member missing hash value");
      }
      return to32Bytes(hashValue as HashBytes);
    });

    const batchHash = deriveBatchHash(
      memberHashes.map((hash, index) => ({
        hash,
        kind: memberKinds[index],
        createdAt: memberCreatedAts[index],
      }))
    );
    const batchId = deriveBatchHashId(batchHash);
    const batchPda = this.hashPda(batchId);
    const votePda = this.votePda(batchId, walletPk);

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

  async pack(
    memberIds: HashBytes[],
    payer?: Keypair
  ): Promise<{ signature: TransactionSignature; packId: Uint8Array }> {
    if (memberIds.length === 0) {
      throw new Error("pack requires at least one member");
    }

    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;

    const memberIdBytes = memberIds.map((id) => to32Bytes(id));
    const memberPdas = memberIdBytes.map((id) => this.hashPda(id));

    const memberAccounts = await Promise.all(
      memberIdBytes.map(async (id) => {
        const account = await this.fetchHashAccount(id);
        if (!account) {
          throw new Error("pack member hash not found");
        }
        return account;
      })
    );

    const memberCreatedAts = memberAccounts.map((account) => {
      const created =
        (account as any).createdAt ?? (account as any).created_at ?? null;
      if (created === null || created === undefined) {
        throw new Error("pack member missing created_at");
      }
      return coerceBigInt(created);
    });

    const memberSources = memberAccounts.map((account) =>
      decodeHashSource((account as any).source ?? {})
    );
    const memberKinds = memberSources.map((source) => hashSourceKindOf(source));

    const memberHashes = memberAccounts.map((account) => {
      const hashValue = (account as any).hash;
      if (!hashValue) {
        throw new Error("pack member missing hash value");
      }
      return to32Bytes(hashValue as HashBytes);
    });

    const packHash = derivePackHash(
      memberHashes.map((hash, index) => ({
        hash,
        kind: memberKinds[index],
        createdAt: memberCreatedAts[index],
      }))
    );
    const packId = derivePackHashId(packHash);
    const packPda = this.hashPda(packId);
    const votePda = this.votePda(packId, walletPk);

    const builder = this.program.methods
      .pack()
      .accountsStrict({
        packHashAccount: packPda,
        voteInfo: votePda,
        payer: walletPk,
        systemProgram: SystemProgram.programId,
      })
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

    return { signature, packId };
  }

  async hashAccount(
    target: PublicKey,
    payer?: Keypair
  ): Promise<{
    signature: TransactionSignature;
    hashId: Uint8Array;
    metadataHash: Uint8Array;
  }> {
    const provider = this.program.provider as anchor.AnchorProvider;
    const walletPk = payer ? payer.publicKey : provider.wallet.publicKey;

    const info = await this.connection.getAccountInfo(target);
    if (!info) {
      throw new Error("target account not found");
    }

    const metadataHash = deriveAccountMetadataHash(target, info);
    const hashId = canonicalHashId(metadataHash, HashSourceKind.Account);
    const hashPda = this.hashPda(hashId);
    const votePda = this.votePda(hashId, walletPk);

    const builder = this.program.methods.account().accountsStrict({
      hashAccount: hashPda,
      voteInfo: votePda,
      target,
      payer: walletPk,
      systemProgram: SystemProgram.programId,
    });

    const signature = payer
      ? await builder.signers([payer]).rpc()
      : await builder.rpc();

    return { signature, hashId, metadataHash };
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
    const hashIdBytes = to32Bytes(hash);
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashIdBytes, voter);
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
