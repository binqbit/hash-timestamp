import { expect } from "chai";
import {
  client,
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

describe("register instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
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

    const accountHashType =
      (account as any).hashType ?? (account as any).hash_type;
    expect(toHashType(accountHashType)).to.eq(HashType.Hash);
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
});
