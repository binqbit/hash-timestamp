import { expect } from "chai";
import {
  client,
  deriveAccountMetadataHash,
  errorCodeOf,
  getRentMinimums,
  hashLamports,
  HashSourceKind,
  hashSourceOf,
  provider,
  rentForSource,
  sourceKindOf,
  toNum,
  voteLamports,
} from "./helpers";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

describe("account hash instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
  });

  it("rejects hashing the same account twice", async () => {
    const target = Keypair.generate();
    const space = 16;
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

    await client.hashAccount(target.publicKey);

    try {
      await client.hashAccount(target.publicKey);
      expect.fail("hashAccount should fail for duplicate targets");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6009);
    }
  });

  it("rejects hashing an account when the hash PDA is invalid", async () => {
    const target = Keypair.generate();
    const space = 8;
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

    try {
      await client.program.methods
        .account()
        .accountsStrict({
          hashAccount: Keypair.generate().publicKey,
          voteInfo: Keypair.generate().publicKey,
          target: target.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("account_hash should fail when hash PDA is invalid");
    } catch (err: any) {
      const message = (err?.error?.errorMessage ?? err?.message ?? "").toLowerCase();
      expect(
        message.includes("address must be derived") ||
          message.includes("invalid seeds") ||
          errorCodeOf(err) === 6001
      ).to.eq(
        true,
        `Unexpected error for invalid hash PDA: ${err?.error?.errorMessage ?? err}`
      );
    }
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
    const source = hashSourceOf(hashAccount!);
    expect(source.kind).to.eq("account");
    const expectedRent = await rentForSource(source);
    const sourceAccountBuffer =
      source.account instanceof PublicKey
        ? source.account.toBuffer()
        : Buffer.from(source.account as Uint8Array);
    expect(Buffer.from(sourceAccountBuffer)).to.deep.equal(
      target.publicKey.toBuffer()
    );
    expect(toNum(hashAccount!.voters)).to.eq(1);
    expect(sourceKindOf(hashAccount!)).to.eq(HashSourceKind.Account);
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
    expect(await hashLamports(hashId)).to.eq(expectedRent);

    const voteInfo = await client.fetchVoteInfo(
      hashId,
      provider.wallet.publicKey
    );
    expect(voteInfo).to.not.equal(null);
    expect(toNum(voteInfo!.amount)).to.eq(expectedRent);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );

    await client.unvote(hashId);
    expect(await hashLamports(hashId)).to.eq(0);
  });
});
