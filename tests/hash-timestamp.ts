import { deserialize, serialize } from "v8";

if (typeof (globalThis as any).structuredClone !== "function") {
  (globalThis as any).structuredClone = (value: unknown) => deserialize(serialize(value));
}

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { HashTimestamp } from "../target/types/hash_timestamp";
import { expect } from "chai";
import {
  HashTimestampClient,
  deriveGenesisHashId,
  deriveUpdatedHash,
  rentExemptForHash,
  rentExemptForVote,
} from "../app/sdk/hashTimestamp";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.HashTimestamp as Program<HashTimestamp>;
const client = new HashTimestampClient(program);

const toNum = (value: any): number =>
  typeof value === "number" ? value : value.toNumber();

const randomHash = () => Keypair.generate().publicKey.toBuffer();

const zeroHash = Buffer.alloc(32, 0);

const generationOf = (account: any): number => {
  const prev = account.previous;
  const prevHashBuffer = Buffer.from(prev.hashId ?? prev.hash_id ?? prev.hash);
  const isGenesisPrev =
    Buffer.compare(new Uint8Array(prevHashBuffer), new Uint8Array(zeroHash)) ===
      0 &&
    toNum(prev.createdAt) === 0 &&
    toNum(prev.generation) === 0;
  return isGenesisPrev ? 0 : toNum(prev.generation) + 1;
};

const airdrop = async (pubkey: PublicKey, lamports = LAMPORTS_PER_SOL) => {
  const sig = await provider.connection.requestAirdrop(pubkey, lamports);
  await provider.connection.confirmTransaction(sig);
};

const hashLamports = async (hashId: Buffer | Uint8Array) => {
  const info = await provider.connection.getAccountInfo(client.hashPda(hashId));
  return info?.lamports ?? 0;
};

const voteLamports = async (hashId: Buffer | Uint8Array, voter: PublicKey) => {
  const hashPda = client.hashPda(hashId);
  const info = await provider.connection.getAccountInfo(
    client.votePda(hashPda, voter)
  );
  return info?.lamports ?? 0;
};

describe("hash-timestamp", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    rentMin = await rentExemptForHash(provider.connection);
    voteRentMin = await rentExemptForVote(provider.connection);
  });

  it("vote initializes a new hash account for the first voter", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);
    expect(Buffer.from(account!.hash)).to.deep.equal(payload);
    expect(Buffer.from(account!.previous.hashId)).to.deep.equal(zeroHash);
    expect(toNum(account!.previous.createdAt)).to.eq(0);
    expect(toNum(account!.previous.generation)).to.eq(0);
    expect(generationOf(account!)).to.eq(0);
    expect(await hashLamports(hashId)).to.eq(rentMin);

    const voteInfo = await client.fetchVoteInfo(
      hashId,
      provider.wallet.publicKey
    );
    expect(voteInfo).to.not.equal(null);
    expect(toNum(voteInfo!.amount)).to.eq(rentMin);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    await client.unvote(hashId);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(0);
  });

  it("rejects registering the same hash twice", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    try {
      await client.register(payload);
      expect.fail("Expected register to fail for an existing hash");
    } catch (err: any) {
      const errorCode = err?.error?.errorCode?.number;
      expect(errorCode).to.eq(6009);
    }

    await client.unvote(hashId);
  });

  it("verify succeeds when the hash account exists", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);
    await client.verify(hashId);

    const account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);

    await client.unvote(hashId);
  });

  it("rejects voting for a missing hash account", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    try {
      await client.vote(hashId);
      expect.fail("Expected vote to fail when the hash account is missing");
    } catch (err: any) {
      const message = (err?.error?.errorMessage ?? err?.message ?? "").toLowerCase();
      const matched =
        message.includes("account does not exist") ||
        message.includes("already initialized");
      expect(matched, `Unexpected error message: ${message}`).to.eq(true);
    }
  });

  it("rejects voting twice for the same hash", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    try {
      await client.vote(hashId);
      expect.fail("Expected second vote to fail for the same voter");
    } catch (err: any) {
      const message = (err?.error?.errorMessage ?? err?.message ?? "").toLowerCase();
      expect(message).to.satisfy((text: string) =>
        text.includes("already in use") || text.includes("already exists")
      );
    }

    await client.unvote(hashId);
  });

  it("unvote removes the final voter and closes the hash account", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);
    await client.unvote(hashId);

    const account = await client.fetchHashAccount(hashId);
    expect(account).to.eq(null);
    expect(await hashLamports(hashId)).to.eq(0);
  });

  it("retains the hash account while at least one voter remains", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const second = Keypair.generate();
    await airdrop(second.publicKey, 2 * LAMPORTS_PER_SOL);
    await client.vote(hashId, second);

    let account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(2);
    expect(await hashLamports(hashId)).to.eq(rentMin * 2);

    await client.unvote(hashId);

    account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);
    expect(await hashLamports(hashId)).to.eq(rentMin);

    const firstVoteInfo = await client.fetchVoteInfo(
      hashId,
      provider.wallet.publicKey
    );
    expect(firstVoteInfo).to.eq(null);

    const secondVoteInfo = await client.fetchVoteInfo(hashId, second.publicKey);
    expect(secondVoteInfo).to.not.equal(null);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(voteRentMin);

    await client.unvote(hashId, second);

    account = await client.fetchHashAccount(hashId);
    expect(account).to.eq(null);
    expect(await hashLamports(hashId)).to.eq(0);
  });

  it("migrates the caller's vote while preserving other voters on the old hash", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const second = Keypair.generate();
    await airdrop(second.publicKey, 2 * LAMPORTS_PER_SOL);
    await client.vote(hashId, second);

    const before = await client.fetchHashAccount(hashId);
    expect(before).to.not.equal(null);
    expect(toNum(before!.voters)).to.eq(2);

    const createdAt = toNum(before!.createdAt);
    const generation = generationOf(before!);

    const newPayload = randomHash();
    const derivedId = deriveUpdatedHash(hashId, createdAt, newPayload);

    await client.branch(hashId, newPayload, true);

    const oldAccount = await client.fetchHashAccount(hashId);
    expect(oldAccount).to.not.equal(null);
    expect(toNum(oldAccount!.voters)).to.eq(1);
    expect(await hashLamports(hashId)).to.eq(rentMin);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(voteRentMin);

    const newAccount = await client.fetchHashAccount(derivedId);
    expect(newAccount).to.not.equal(null);
    expect(Buffer.from(newAccount!.previous.hashId)).to.deep.equal(
      Buffer.from(hashId)
    );
    expect(toNum(newAccount!.previous.createdAt)).to.eq(createdAt);
    expect(toNum(newAccount!.previous.generation)).to.eq(generation);
    expect(generationOf(newAccount!)).to.eq(generation + 1);
    expect(toNum(newAccount!.voters)).to.eq(1);
    expect(await hashLamports(derivedId)).to.eq(rentMin);
    expect(await voteLamports(derivedId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    const migratedVote = await client.fetchVoteInfo(
      derivedId,
      provider.wallet.publicKey
    );
    expect(migratedVote).to.not.equal(null);
    expect(toNum(migratedVote!.amount)).to.eq(rentMin);

    await client.unvote(derivedId);
    await client.unvote(hashId, second);
  });

  it("requires the caller's vote when migrating even if others remain", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const second = Keypair.generate();
    await airdrop(second.publicKey, 2 * LAMPORTS_PER_SOL);
    await client.vote(hashId, second);

    await client.unvote(hashId);
    expect(await client.fetchVoteInfo(hashId, provider.wallet.publicKey)).to.eq(
      null
    );

    try {
      await client.branch(hashId, randomHash(), true);
      expect.fail("Expected branch to fail when caller has no vote");
    } catch (err: any) {
      const errorCode = err?.error?.errorCode?.number;
      expect(errorCode).to.eq(6007);
    }

    await client.unvote(hashId, second);
  });

  it("updates a hash and migrates the caller's vote", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const oldAccount = await client.fetchHashAccount(hashId);
    expect(oldAccount).to.not.equal(null);
    const createdAt = toNum(oldAccount!.createdAt);

    const newPayload = randomHash();
    const derivedId = deriveUpdatedHash(hashId, createdAt, newPayload);

    await client.branch(hashId, newPayload, true);

    const oldAfter = await client.fetchHashAccount(hashId);
    expect(oldAfter).to.eq(null);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(0);

    const newAccount = await client.fetchHashAccount(derivedId);
    expect(newAccount).to.not.equal(null);
    expect(Buffer.from(newAccount!.previous.hashId)).to.deep.equal(
      Buffer.from(hashId)
    );
    expect(toNum(newAccount!.previous.createdAt)).to.eq(createdAt);
    expect(toNum(newAccount!.previous.generation)).to.eq(
      generationOf(oldAccount!)
    );
    expect(Buffer.from(newAccount!.hash)).to.deep.equal(newPayload);
    expect(generationOf(newAccount!)).to.eq(generationOf(oldAccount!) + 1);
    expect(toNum(newAccount!.voters)).to.eq(1);

    const voteInfo = await client.fetchVoteInfo(
      derivedId,
      provider.wallet.publicKey
    );
    expect(voteInfo).to.not.equal(null);
    expect(toNum(voteInfo!.amount)).to.eq(rentMin);
    expect(await voteLamports(derivedId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    await client.unvote(derivedId);
  });

  it("updates a hash without migrating the caller's vote", async () => {
    const basePayload = randomHash();
    const baseId = deriveGenesisHashId(basePayload);

    await client.register(basePayload);

    const baseAccount = await client.fetchHashAccount(baseId);
    const createdAt = toNum(baseAccount!.createdAt);

    const newPayload = randomHash();
    const derivedId = deriveUpdatedHash(baseId, createdAt, newPayload);

    await client.branch(baseId, newPayload, false);

    const baseAfter = await client.fetchHashAccount(baseId);
    expect(baseAfter).to.not.equal(null);
    expect(toNum(baseAfter!.voters)).to.eq(1);
    expect(await voteLamports(baseId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    const newAccount = await client.fetchHashAccount(derivedId);
    expect(newAccount).to.not.equal(null);
    expect(Buffer.from(newAccount!.previous.hashId)).to.deep.equal(
      Buffer.from(baseId)
    );
    expect(toNum(newAccount!.previous.createdAt)).to.eq(createdAt);
    expect(toNum(newAccount!.previous.generation)).to.eq(
      generationOf(baseAccount!)
    );
    expect(generationOf(newAccount!)).to.eq(generationOf(baseAfter!) + 1);
    expect(toNum(newAccount!.voters)).to.eq(1);
    expect(await voteLamports(derivedId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    await client.unvote(derivedId);
    await client.unvote(baseId);
  });

  it("requires an existing vote when migrating during a branch", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const outsider = Keypair.generate();
    await airdrop(outsider.publicKey, 2 * LAMPORTS_PER_SOL);

    try {
      await client.branch(hashId, randomHash(), true, outsider);
      expect.fail("Expected branch to fail when vote is missing");
    } catch (err: any) {
      const errorCode = err?.error?.errorCode?.number;
      expect(errorCode).to.eq(6007);
    }

    await client.unvote(hashId);
  });
});
