import { expect } from "chai";
import {
  airdrop,
  client,
  deriveBranchHash,
  deriveBranchHashId,
  deriveGenesisHashId,
  generationOf,
  getRentMinimums,
  hashLamports,
  errorCodeOf,
  HashSourceKind,
  hashSourceOf,
  Keypair,
  LAMPORTS_PER_SOL,
  provider,
  rentForSource,
  randomHash,
  sourceKindOf,
  toNum,
  voteLamports,
} from "../support/integration";
import { SystemProgram } from "@solana/web3.js";

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
    const parentKind = sourceKindOf(before!);
    const branchHash = deriveBranchHash(
      hashId,
      createdAt,
      generation,
      parentKind,
      newPayload
    );
    const derivedId = deriveBranchHashId(branchHash);

    await client.branch(hashId, newPayload, true);

    const oldAccount = await client.fetchHashAccount(hashId);
    expect(oldAccount).to.not.equal(null);
    expect(toNum(oldAccount!.voters)).to.eq(1);
    expect(await hashLamports(hashId)).to.eq(rentMin);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(voteRentMin);

    const newAccount = await client.fetchHashAccount(derivedId);
    expect(newAccount).to.not.equal(null);
    const newSource = hashSourceOf(newAccount!);
    expect(newSource.kind).to.eq("branch");
    if (newSource.kind !== "branch") {
      throw new Error("expected branch hash source");
    }
    const expectedRent = await rentForSource(newSource);
    expect(Buffer.from(newSource.previousHashId)).to.deep.equal(
      Buffer.from(hashId)
    );
    expect(Buffer.from(newSource.payload)).to.deep.equal(newPayload);
    expect(Number(newSource.generation)).to.eq(generation + 1);
    expect(Buffer.from(newAccount!.hash)).to.deep.equal(branchHash);
    expect(generationOf(newAccount!)).to.eq(generation + 1);
    expect(toNum(newAccount!.voters)).to.eq(1);
    expect(sourceKindOf(newAccount!)).to.eq(HashSourceKind.Branch);
    expect(await hashLamports(derivedId)).to.eq(expectedRent);
    expect(await voteLamports(derivedId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    const migratedVote = await client.fetchVoteInfo(
      derivedId,
      provider.wallet.publicKey
    );
    expect(migratedVote).to.not.equal(null);
    expect(toNum(migratedVote!.amount)).to.eq(expectedRent);

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
    const oldVoteLamports = await voteLamports(
      hashId,
      provider.wallet.publicKey
    );

    const newPayload = randomHash();
    const parentKind = sourceKindOf(oldAccount!);
    const branchHash = deriveBranchHash(
      hashId,
      createdAt,
      generationOf(oldAccount!),
      parentKind,
      newPayload
    );
    const derivedId = deriveBranchHashId(branchHash);

    await client.branch(hashId, newPayload, true);

    const oldAfter = await client.fetchHashAccount(hashId);
    expect(oldAfter).to.eq(null);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(0);

    const newAccount = await client.fetchHashAccount(derivedId);
    expect(newAccount).to.not.equal(null);
    const newSource = hashSourceOf(newAccount!);
    expect(newSource.kind).to.eq("branch");
    if (newSource.kind !== "branch") {
      throw new Error("expected branch hash source");
    }
    const expectedRent = await rentForSource(newSource);
    expect(Buffer.from(newSource.previousHashId)).to.deep.equal(
      Buffer.from(hashId)
    );
    expect(Buffer.from(newSource.payload)).to.deep.equal(newPayload);
    expect(Number(newSource.generation)).to.eq(generationOf(oldAccount!) + 1);
    expect(Buffer.from(newAccount!.hash)).to.deep.equal(branchHash);
    expect(generationOf(newAccount!)).to.eq(generationOf(oldAccount!) + 1);
    expect(toNum(newAccount!.voters)).to.eq(1);
    expect(sourceKindOf(newAccount!)).to.eq(HashSourceKind.Branch);
    expect(await hashLamports(derivedId)).to.eq(expectedRent);
    expect(await voteLamports(derivedId, provider.wallet.publicKey)).to.eq(
      oldVoteLamports
    );

    const voteInfo = await client.fetchVoteInfo(
      derivedId,
      provider.wallet.publicKey
    );
    expect(voteInfo).to.not.equal(null);
    expect(toNum(voteInfo!.amount)).to.eq(expectedRent);

    await client.unvote(derivedId);
  });

  it("updates a hash without migrating the caller's vote", async () => {
    const basePayload = randomHash();
    const baseId = deriveGenesisHashId(basePayload);

    await client.register(basePayload);

    const baseAccount = await client.fetchHashAccount(baseId);
    const createdAt = toNum(baseAccount!.createdAt);

    const newPayload = randomHash();
    const parentKind = sourceKindOf(baseAccount!);
    const branchHash = deriveBranchHash(
      baseId,
      createdAt,
      generationOf(baseAccount!),
      parentKind,
      newPayload
    );
    const derivedId = deriveBranchHashId(branchHash);

    await client.branch(baseId, newPayload, false);

    const baseAfter = await client.fetchHashAccount(baseId);
    expect(baseAfter).to.not.equal(null);
    expect(sourceKindOf(baseAfter!)).to.eq(HashSourceKind.Hash);
    expect(toNum(baseAfter!.voters)).to.eq(1);
    expect(await voteLamports(baseId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    const newAccount = await client.fetchHashAccount(derivedId);
    expect(newAccount).to.not.equal(null);
    const branchSource = hashSourceOf(newAccount!);
    expect(branchSource.kind).to.eq("branch");
    if (branchSource.kind !== "branch") {
      throw new Error("expected branch hash source");
    }
    const expectedRent = await rentForSource(branchSource);
    expect(Buffer.from(branchSource.previousHashId)).to.deep.equal(
      Buffer.from(baseId)
    );
    expect(Buffer.from(branchSource.payload)).to.deep.equal(newPayload);
    expect(Number(branchSource.generation)).to.eq(
      generationOf(baseAccount!) + 1
    );
    expect(Buffer.from(newAccount!.hash)).to.deep.equal(branchHash);
    expect(generationOf(newAccount!)).to.eq(generationOf(baseAfter!) + 1);
    expect(toNum(newAccount!.voters)).to.eq(1);
    expect(sourceKindOf(newAccount!)).to.eq(HashSourceKind.Branch);
    expect(await hashLamports(derivedId)).to.eq(expectedRent);
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

  it("requires the caller's exact old vote when migrating", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const oldAccount = await client.fetchHashAccount(hashId);
    expect(oldAccount).to.not.equal(null);

    const createdAt = toNum(oldAccount!.createdAt);
    const generation = generationOf(oldAccount!);
    const parentKind = sourceKindOf(oldAccount!);
    const nextPayload = randomHash();
    const branchHash = deriveBranchHash(
      hashId,
      createdAt,
      generation,
      parentKind,
      nextPayload
    );
    const newId = deriveBranchHashId(branchHash);

    try {
      await client.program.methods
        .branch([...nextPayload], true)
        .accountsStrict({
          hashAccount: client.hashPda(hashId),
          voteInfo: Keypair.generate().publicKey,
          newHashAccount: client.hashPda(newId),
          newVoteInfo: client.votePda(newId, provider.wallet.publicKey),
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail(
        "Expected branch to fail when migrating without the exact old vote account"
      );
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6006);
    } finally {
      await client.unvote(hashId);
    }
  });

  it("rolls back child creation when the new vote PDA is invalid", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    await client.register(payload);

    const parentBefore = await client.fetchHashAccount(hashId);
    expect(parentBefore).to.not.equal(null);
    const parentLamportsBefore = await hashLamports(hashId);
    const parentVoteLamportsBefore = await voteLamports(
      hashId,
      provider.wallet.publicKey
    );
    const nextPayload = randomHash();
    const branchHash = deriveBranchHash(
      hashId,
      toNum(parentBefore!.createdAt),
      generationOf(parentBefore!),
      sourceKindOf(parentBefore!),
      nextPayload
    );
    const newId = deriveBranchHashId(branchHash);

    try {
      await client.program.methods
        .branch([...nextPayload], true)
        .accountsStrict({
          hashAccount: client.hashPda(hashId),
          voteInfo: client.votePda(hashId, provider.wallet.publicKey),
          newHashAccount: client.hashPda(newId),
          newVoteInfo: Keypair.generate().publicKey,
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Expected branch to reject an invalid child vote PDA");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6001);
    }

    const parentAfter = await client.fetchHashAccount(hashId);
    expect(parentAfter).to.not.equal(null);
    expect(toNum(parentAfter!.voters)).to.eq(toNum(parentBefore!.voters));
    expect(await hashLamports(hashId)).to.eq(parentLamportsBefore);
    expect(
      await client.fetchVoteInfo(hashId, provider.wallet.publicKey)
    ).to.not.equal(null);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(
      parentVoteLamportsBefore
    );
    expect(await client.fetchHashAccount(newId)).to.equal(
      null,
      "a failed child vote validation must roll back the child hash"
    );

    await client.unvote(hashId);
  });

  it("requires a system placeholder when not migrating and the old vote PDA is not provided", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const oldAccount = await client.fetchHashAccount(hashId);
    expect(oldAccount).to.not.equal(null);

    const createdAt = toNum(oldAccount!.createdAt);
    const generation = generationOf(oldAccount!);
    const parentKind = sourceKindOf(oldAccount!);
    const nextPayload = randomHash();
    const branchHash = deriveBranchHash(
      hashId,
      createdAt,
      generation,
      parentKind,
      nextPayload
    );
    const newId = deriveBranchHashId(branchHash);

    try {
      await client.program.methods
        .branch([...nextPayload], false)
        .accountsStrict({
          hashAccount: client.hashPda(hashId),
          voteInfo: provider.wallet.publicKey,
          newHashAccount: client.hashPda(newId),
          newVoteInfo: client.votePda(newId, provider.wallet.publicKey),
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail(
        "Expected branch to fail when not migrating with non-system placeholder"
      );
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6006);
    } finally {
      await client.unvote(hashId);
    }
  });
});
