import { expect } from "chai";
import {
  airdrop,
  client,
  expectProgramError,
  deriveGenesisHashId,
  getRentMinimums,
  hashLamports,
  Keypair,
  LAMPORTS_PER_SOL,
  provider,
  randomHash,
  toNum,
  voteLamports,
} from "../support/integration";

describe("vote instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
  });

  it("adds a new voter and deposits the correct rent", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const second = Keypair.generate();
    await airdrop(second.publicKey, 2 * LAMPORTS_PER_SOL);

    const beforeAccount = await client.fetchHashAccount(hashId);
    expect(beforeAccount).to.not.equal(null);
    expect(toNum(beforeAccount!.voters)).to.eq(1);
    expect(await hashLamports(hashId)).to.eq(rentMin);

    await client.vote(hashId, second);

    const afterAccount = await client.fetchHashAccount(hashId);
    expect(afterAccount).to.not.equal(null);
    expect(toNum(afterAccount!.voters)).to.eq(2);
    expect(await hashLamports(hashId)).to.eq(rentMin * 2);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(voteRentMin);

    await client.unvote(hashId, second);
    await client.unvote(hashId);
  });

  it("rejects voting for a missing hash account", async () => {
    await expectProgramError(
      client.vote(deriveGenesisHashId(randomHash())),
      3012
    );
  });

  it("rejects voting twice for the same hash", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const beforeAccount = await client.fetchHashAccount(hashId);
    const beforeLamports = await hashLamports(hashId);
    const beforeVote = await client.fetchVoteInfo(
      hashId,
      provider.wallet.publicKey
    );
    const beforeVoteLamports = await voteLamports(
      hashId,
      provider.wallet.publicKey
    );
    expect(beforeAccount).to.not.equal(null);
    expect(beforeVote).to.not.equal(null);

    await expectProgramError(client.vote(hashId), 6002);

    const afterAccount = await client.fetchHashAccount(hashId);
    expect(afterAccount).to.not.equal(null);
    expect(toNum(afterAccount!.voters)).to.equal(
      toNum(beforeAccount!.voters),
      "a rejected duplicate vote must not change the voter count"
    );
    expect(await hashLamports(hashId)).to.equal(
      beforeLamports,
      "a rejected duplicate vote must not change the hash deposit"
    );
    const afterVote = await client.fetchVoteInfo(
      hashId,
      provider.wallet.publicKey
    );
    expect(afterVote).to.not.equal(null);
    expect(toNum(afterVote!.amount)).to.equal(toNum(beforeVote!.amount));
    expect(Buffer.from(afterVote!.hashId)).to.deep.equal(
      Buffer.from(beforeVote!.hashId)
    );
    expect(afterVote!.voter.toBase58()).to.equal(beforeVote!.voter.toBase58());
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.equal(
      beforeVoteLamports,
      "a rejected duplicate vote must not change the existing vote account"
    );

    await client.unvote(hashId);
  });
});
