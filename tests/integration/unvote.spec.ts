import { expect } from "chai";
import {
  airdrop,
  client,
  expectProgramError,
  deriveGenesisHashId,
  errorCodeOf,
  getRentMinimums,
  hashLamports,
  Keypair,
  LAMPORTS_PER_SOL,
  provider,
  randomHash,
  toNum,
  voteLamports,
} from "../support/integration";
import { SystemProgram } from "@solana/web3.js";

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

    const secondVoteInfo = await client.fetchVoteInfo(hashId, second.publicKey);
    expect(secondVoteInfo).to.not.equal(null);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(voteRentMin);

    await client.unvote(hashId, second);

    account = await client.fetchHashAccount(hashId);
    expect(account).to.eq(null);
    expect(await hashLamports(hashId)).to.eq(0);
  });

  it("rejects unvote attempts from a non-voter", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);

    const second = Keypair.generate();
    await airdrop(second.publicKey, 2 * LAMPORTS_PER_SOL);
    await client.vote(hashId, second);

    const outsider = Keypair.generate();
    await airdrop(outsider.publicKey, 2 * LAMPORTS_PER_SOL);

    const hashPda = client.hashPda(hashId);
    const secondVotePda = client.votePda(hashId, second.publicKey);

    await expectProgramError(
      client.program.methods
        .unvote()
        .accountsStrict({
          hashAccount: hashPda,
          voteInfo: secondVotePda,
          user: outsider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([outsider])
        .rpc(),
      6003
    );

    await client.unvote(hashId, second);
    await client.unvote(hashId);
  });

  it("rejects unvote when the hash account is already fully closed", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    await client.register(payload);
    await client.unvote(hashId);
    expect(await client.fetchHashAccount(hashId)).to.equal(null);
    await expectProgramError(client.unvote(hashId), 3012);
  });

  it("rejects a valid caller vote belonging to a different hash without changing either record", async () => {
    const payloads = [randomHash(), randomHash()];
    const ids = payloads.map(deriveGenesisHashId);
    for (const payload of payloads) await client.register(payload);
    const addresses = ids.flatMap((id) => [
      client.hashPda(id),
      client.votePda(id, provider.wallet.publicKey),
    ]);
    const before = await provider.connection.getMultipleAccountsInfo(addresses);
    try {
      try {
        await client.program.methods
          .unvote()
          .accountsStrict({
            hashAccount: addresses[0],
            voteInfo: addresses[3],
            user: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("a vote for another hash must be rejected");
      } catch (error) {
        expect(errorCodeOf(error)).to.equal(6001);
      }
      const after = await provider.connection.getMultipleAccountsInfo(
        addresses
      );
      expect(after).to.deep.equal(before);
    } finally {
      for (const id of ids) await client.unvote(id);
    }
  });
});
