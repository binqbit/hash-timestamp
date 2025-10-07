import { expect } from "chai";
import {
  airdrop,
  client,
  deriveGenesisHashId,
  deriveUpdatedHash,
  generationOf,
  getRentMinimums,
  hashLamports,
  HashType,
  Keypair,
  LAMPORTS_PER_SOL,
  provider,
  randomHash,
  toHashType,
  toNum,
  voteLamports,
} from "./helpers";

describe("branch instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
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
    const derivedId = deriveUpdatedHash(
      hashId,
      createdAt,
      newPayload,
      HashType.Branch
    );

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
    const newHashType =
      (newAccount as any).hashType ?? (newAccount as any).hash_type;
    expect(toHashType(newHashType)).to.eq(HashType.Branch);

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
    const oldVote = await client.fetchVoteInfo(
      hashId,
      provider.wallet.publicKey
    );
    expect(oldVote).to.not.equal(null);
    const oldVoteAmount = toNum(oldVote!.amount);
    const oldVoteLamports = await voteLamports(
      hashId,
      provider.wallet.publicKey
    );

    const newPayload = randomHash();
    const derivedId = deriveUpdatedHash(
      hashId,
      createdAt,
      newPayload,
      HashType.Branch
    );

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
    const newHashType =
      (newAccount as any).hashType ?? (newAccount as any).hash_type;
    expect(toHashType(newHashType)).to.eq(HashType.Branch);
    expect(await hashLamports(derivedId)).to.eq(rentMin);
    expect(await voteLamports(derivedId, provider.wallet.publicKey)).to.eq(
      oldVoteLamports
    );

    const voteInfo = await client.fetchVoteInfo(
      derivedId,
      provider.wallet.publicKey
    );
    expect(voteInfo).to.not.equal(null);
    expect(toNum(voteInfo!.amount)).to.eq(oldVoteAmount);

    await client.unvote(derivedId);
  });

  it("updates a hash without migrating the caller's vote", async () => {
    const basePayload = randomHash();
    const baseId = deriveGenesisHashId(basePayload);

    await client.register(basePayload);

    const baseAccount = await client.fetchHashAccount(baseId);
    const createdAt = toNum(baseAccount!.createdAt);

    const newPayload = randomHash();
    const derivedId = deriveUpdatedHash(
      baseId,
      createdAt,
      newPayload,
      HashType.Branch
    );

    await client.branch(baseId, newPayload, false);

    const baseAfter = await client.fetchHashAccount(baseId);
    expect(baseAfter).to.not.equal(null);
    const baseType =
      (baseAfter as any).hashType ?? (baseAfter as any).hash_type;
    expect(toHashType(baseType)).to.eq(HashType.Hash);
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
    const branchType =
      (newAccount as any).hashType ?? (newAccount as any).hash_type;
    expect(toHashType(branchType)).to.eq(HashType.Branch);
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
