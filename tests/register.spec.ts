import { expect } from "chai";
import {
  client,
  deriveGenesisHashId,
  errorCodeOf,
  generationOf,
  getRentMinimums,
  hashLamports,
  HashSourceKind,
  hashSourceOf,
  provider,
  randomHash,
  sourceKindOf,
  toNum,
  voteLamports,
} from "./helpers";
import { Keypair, SystemProgram } from "@solana/web3.js";

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
    const source = hashSourceOf(account!);
    expect(source.kind).to.eq("hash");
    expect(generationOf(account!)).to.eq(0);
    expect(sourceKindOf(account!)).to.eq(HashSourceKind.Hash);
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

  it("rejects registration when the provided hash account PDA is invalid", async () => {
    const payload = randomHash();
    const fakeHash = Keypair.generate().publicKey;
    const fakeVote = Keypair.generate().publicKey;

    try {
      await client.program.methods
        .register([...payload])
        .accountsStrict({
          hashAccount: fakeHash,
          voteInfo: fakeVote,
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("register should fail when hash PDA is invalid");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6001);
    }
  });

  it("rejects registration when the vote PDA does not match the seeds", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    const validHashPda = client.hashPda(hashId);
    const wrongVotePda = Keypair.generate().publicKey;

    try {
      await client.program.methods
        .register([...payload])
        .accountsStrict({
          hashAccount: validHashPda,
          voteInfo: wrongVotePda,
          user: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("register should fail when vote PDA is invalid");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6001);
    }
  });
});
