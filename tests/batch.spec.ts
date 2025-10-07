import { expect } from "chai";
import {
  client,
  deriveBatchHashId,
  deriveBatchPayloadHash,
  deriveGenesisHashId,
  generationOf,
  getRentMinimums,
  hashLamports,
  HashType,
  provider,
  randomHash,
  toHashType,
  toNum,
  voteLamports,
  zeroHash,
} from "./helpers";

describe("batch instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
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
      toNum(accountA!.createdAt ?? (accountA as any).created_at),
      toNum(accountB!.createdAt ?? (accountB as any).created_at),
    ];
    const memberGenerations = [
      generationOf(accountA!),
      generationOf(accountB!),
    ];
    const expectedBatchHash = deriveBatchPayloadHash(
      [hashIdA, hashIdB],
      memberCreatedAts,
      memberGenerations
    );
    const expectedBatchId = deriveBatchHashId(
      [hashIdA, hashIdB],
      memberCreatedAts,
      memberGenerations
    );
    const { batchId } = await client.batch([hashIdA, hashIdB]);
    expect(Buffer.from(batchId)).to.deep.equal(Buffer.from(expectedBatchId));

    const batchAccount = await client.fetchHashAccount(batchId);
    expect(batchAccount).to.not.equal(null);
    const batchType =
      (batchAccount as any).hashType ?? (batchAccount as any).hash_type;
    expect(toHashType(batchType)).to.eq(HashType.Batch);
    expect(Buffer.from(batchAccount!.previous.hashId)).to.deep.equal(
      Buffer.from(zeroHash)
    );
    expect(toNum(batchAccount!.previous.createdAt)).to.eq(0);
    expect(toNum(batchAccount!.previous.generation)).to.eq(0);
    expect(Buffer.from(batchAccount!.hash)).to.deep.equal(
      Buffer.from(expectedBatchHash)
    );
    expect(toNum(batchAccount!.createdAt)).to.be.greaterThan(0);
    expect(toNum(batchAccount!.voters)).to.eq(1);
    const batchVote = await client.fetchVoteInfo(
      batchId,
      provider.wallet.publicKey
    );
    expect(batchVote).to.not.equal(null);
    expect(toNum(batchVote!.amount)).to.eq(rentMin);
    expect(await voteLamports(batchId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );
    expect(await hashLamports(batchId)).to.eq(rentMin);

    await client.unvote(batchId);
    await client.unvote(hashIdA);
    await client.unvote(hashIdB);
  });
});
