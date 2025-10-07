import { expect } from "chai";
import {
  airdrop,
  client,
  deriveGenesisHashId,
  getRentMinimums,
  hashLamports,
  Keypair,
  LAMPORTS_PER_SOL,
  provider,
  randomHash,
  toNum,
  voteLamports,
} from "./helpers";

describe("unvote instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
  });

  it("unvote removes the final voter and closes the hash account", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);
    await client.unvote(hashId);

    let account = await client.fetchHashAccount(hashId);
    expect(account).to.eq(null);
    expect(await hashLamports(hashId)).to.eq(0);

    await client.register(payload);
    account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);

    await client.unvote(hashId);
    account = await client.fetchHashAccount(hashId);
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

    const secondVoteInfo = await client.fetchVoteInfo(
      hashId,
      second.publicKey
    );
    expect(secondVoteInfo).to.not.equal(null);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(voteRentMin);

    await client.unvote(hashId, second);

    account = await client.fetchHashAccount(hashId);
    expect(account).to.eq(null);
    expect(await hashLamports(hashId)).to.eq(0);
  });
});
