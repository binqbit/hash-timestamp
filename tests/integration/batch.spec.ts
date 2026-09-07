import { expect } from "chai";
import {
  client,
  deriveBatchHash,
  deriveBatchHashId,
  deriveGenesisHashId,
  errorCodeOf,
  generationOf,
  getRentMinimums,
  hashLamports,
  HashSourceKind,
  hashSourceOf,
  Keypair,
  provider,
  rentForSource,
  randomHash,
  sourceKindOf,
  toNum,
  voteLamports,
} from "../support/integration";
import { SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

describe("batch instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
  });

  it("requires at least one member account", async () => {
    const fakeId = Buffer.alloc(32, 7);
    const batchPda = client.hashPda(fakeId);
    const votePda = client.votePda(fakeId, provider.wallet.publicKey);

    try {
      await client.program.methods
        .batch()
        .accountsStrict({
          hashAccount: batchPda,
          voteInfo: votePda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .rpc();
      expect.fail("batch should fail with no members");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6010);
    }
  });

  it("rejects member accounts not owned by the program", async () => {
    const outsider = Keypair.generate();
    const rent = await provider.connection.getMinimumBalanceForRentExemption(0);
    const createTx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: outsider.publicKey,
        space: 0,
        lamports: rent,
        programId: SystemProgram.programId,
      })
    );
    await provider.sendAndConfirm(createTx, [outsider]);

    const fakeId = Buffer.alloc(32, 11);
    const batchPda = client.hashPda(fakeId);
    const votePda = client.votePda(fakeId, provider.wallet.publicKey);

    try {
      await client.program.methods
        .batch()
        .accountsStrict({
          hashAccount: batchPda,
          voteInfo: votePda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: outsider.publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();
      expect.fail("batch should fail when members are not program owned");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6011);
    }
  });

  it("rejects duplicate canonical member IDs on chain", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    await client.register(payload);

    const account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    const fingerprint = {
      hash: Buffer.from(account!.hash),
      kind: sourceKindOf(account!),
      createdAt: BigInt(
        toNum(account!.createdAt ?? (account as any).created_at ?? 0)
      ),
    };
    const duplicateBatchHash = deriveBatchHash([fingerprint, fingerprint]);
    const duplicateBatchId = deriveBatchHashId(duplicateBatchHash);
    const duplicateBatchPda = client.hashPda(duplicateBatchId);
    const duplicateVotePda = client.votePda(
      duplicateBatchId,
      provider.wallet.publicKey
    );
    const memberPda = client.hashPda(hashId);

    try {
      await client.program.methods
        .batch()
        .accountsStrict({
          hashAccount: duplicateBatchPda,
          voteInfo: duplicateVotePda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: memberPda, isSigner: false, isWritable: false },
          { pubkey: memberPda, isSigner: false, isWritable: false },
        ])
        .rpc();
      expect.fail("batch should reject duplicate canonical member IDs");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6026);
    } finally {
      if (await client.fetchHashAccount(duplicateBatchId)) {
        await client.unvote(duplicateBatchId);
      }
      await client.unvote(hashId);
    }
  });

  it("produces different batch hashes when member order differs", async () => {
    const payloadA = randomHash();
    const payloadB = randomHash();
    const hashIdA = deriveGenesisHashId(payloadA);
    const hashIdB = deriveGenesisHashId(payloadB);

    await client.register(payloadA);
    await client.register(payloadB);

    const { batchId: firstId } = await client.batch([hashIdA, hashIdB]);
    const { batchId: secondId } = await client.batch([hashIdB, hashIdA]);

    expect(Buffer.from(firstId)).to.not.deep.equal(Buffer.from(secondId));

    await client.unvote(firstId);
    await client.unvote(secondId);
    await client.unvote(hashIdA);
    await client.unvote(hashIdB);
  });

  it("creates a batch hash aggregating multiple accounts", async () => {
    const payloadA = randomHash();
    const payloadB = randomHash();
    const hashIdA = deriveGenesisHashId(payloadA);
    const hashIdB = deriveGenesisHashId(payloadB);

    await client.register(payloadA);
    await client.register(payloadB);

    const accountA = await client.fetchHashAccount(hashIdA);
    const accountB = await client.fetchHashAccount(hashIdB);
    expect(accountA).to.not.equal(null);
    expect(accountB).to.not.equal(null);

    const memberCreatedAts = [
      BigInt(toNum(accountA!.createdAt ?? (accountA as any).created_at ?? 0)),
      BigInt(toNum(accountB!.createdAt ?? (accountB as any).created_at ?? 0)),
    ];
    const memberKinds = [sourceKindOf(accountA!), sourceKindOf(accountB!)];
    const memberHashes = [
      Buffer.from(accountA!.hash),
      Buffer.from(accountB!.hash),
    ];
    const expectedBatchHash = deriveBatchHash([
      {
        hash: memberHashes[0],
        kind: memberKinds[0],
        createdAt: memberCreatedAts[0],
      },
      {
        hash: memberHashes[1],
        kind: memberKinds[1],
        createdAt: memberCreatedAts[1],
      },
    ]);
    const expectedBatchId = deriveBatchHashId(expectedBatchHash);

    const { batchId } = await client.batch([hashIdA, hashIdB]);
    expect(Buffer.from(batchId)).to.deep.equal(Buffer.from(expectedBatchId));

    const batchAccount = await client.fetchHashAccount(batchId);
    expect(batchAccount).to.not.equal(null);
    const batchSource = hashSourceOf(batchAccount!);
    expect(batchSource.kind).to.eq("batch");
    if (batchSource.kind !== "batch") {
      throw new Error("expected batch hash source");
    }
    expect(batchSource.members).to.have.lengthOf(2);
    expect(Buffer.from(batchSource.members[0])).to.deep.equal(
      Buffer.from(hashIdA)
    );
    expect(Buffer.from(batchSource.members[1])).to.deep.equal(
      Buffer.from(hashIdB)
    );
    const expectedRent = await rentForSource(batchSource);
    expect(Buffer.from(batchAccount!.hash)).to.deep.equal(
      Buffer.from(expectedBatchHash)
    );
    expect(generationOf(batchAccount!)).to.eq(0);
    expect(toNum(batchAccount!.voters)).to.eq(1);
    expect(sourceKindOf(batchAccount!)).to.eq(HashSourceKind.Batch);

    const batchVote = await client.fetchVoteInfo(
      batchId,
      provider.wallet.publicKey
    );
    expect(batchVote).to.not.equal(null);
    expect(toNum(batchVote!.amount)).to.eq(expectedRent);
    expect(await voteLamports(batchId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );
    expect(await hashLamports(batchId)).to.eq(expectedRent);

    await client.unvote(batchId);
    await client.unvote(hashIdA);
    await client.unvote(hashIdB);
  });
});
