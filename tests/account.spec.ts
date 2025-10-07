import { expect } from "chai";
import {
  client,
  deriveAccountMetadataHash,
  getRentMinimums,
  hashLamports,
  HashType,
  provider,
  toHashType,
  toNum,
  voteLamports,
  zeroHash,
} from "./helpers";
import { Keypair, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

describe("account hash instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
  });

  it("creates a hash from an account's metadata", async () => {
    const target = Keypair.generate();
    const space = 32;
    const rent = await provider.connection.getMinimumBalanceForRentExemption(
      space
    );

    const tx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: target.publicKey,
        lamports: rent,
        space,
        programId: SystemProgram.programId,
      })
    );

    await provider.sendAndConfirm(tx, [target]);

    const infoBefore = await provider.connection.getAccountInfo(
      target.publicKey
    );
    expect(infoBefore).to.not.equal(null);

    const { hashId, metadataHash } = await client.hashAccount(target.publicKey);

    const hashAccount = await client.fetchHashAccount(hashId);
    expect(hashAccount).to.not.equal(null);
    expect(Buffer.from(hashAccount!.previous.hashId)).to.deep.equal(zeroHash);
    expect(toNum(hashAccount!.previous.createdAt)).to.eq(0);
    expect(toNum(hashAccount!.previous.generation)).to.eq(0);
    expect(toNum(hashAccount!.voters)).to.eq(1);
    const hashType =
      (hashAccount as any).hashType ?? (hashAccount as any).hash_type;
    expect(toHashType(hashType)).to.eq(HashType.Account);
    expect(Buffer.from(hashAccount!.hash)).to.deep.equal(
      Buffer.from(metadataHash)
    );

    const expectedMetadata = deriveAccountMetadataHash(
      target.publicKey,
      infoBefore!
    );
    expect(Buffer.from(metadataHash)).to.deep.equal(
      Buffer.from(expectedMetadata)
    );
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
    expect(await hashLamports(hashId)).to.eq(0);
  });
});
