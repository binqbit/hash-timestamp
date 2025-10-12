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
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    try {
      await client.vote(hashId);
      expect.fail("Expected vote to fail when the hash account is missing");
    } catch (err: any) {
      const message = (
        err?.error?.errorMessage ?? err?.message ?? ""
      ).toLowerCase();
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
      const message = (
        err?.error?.errorMessage ?? err?.message ?? ""
      ).toLowerCase();
      expect(message).to.satisfy((text: string) =>
        text.includes("already in use") ||
        text.includes("already exists") ||
        text.includes("already voted for this hash")
      );
    }

    await client.unvote(hashId);
  });
});
