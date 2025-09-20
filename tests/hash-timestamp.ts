import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { HashTimestamp } from "../target/types/hash_timestamp";
import { expect } from "chai";
import { HashTimestampClient, rentExemptForHash } from "../app/sdk/hashTimestamp";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.HashTimestamp as Program<HashTimestamp>;
const client = new HashTimestampClient(program);

const toNum = (value: any): number =>
  typeof value === "number" ? value : value.toNumber();

const randomHash = () => Keypair.generate().publicKey.toBuffer();

const airdrop = async (pubkey: PublicKey, lamports = LAMPORTS_PER_SOL) => {
  const sig = await provider.connection.requestAirdrop(pubkey, lamports);
  await provider.connection.confirmTransaction(sig);
};

const hashLamports = async (hash: Buffer | Uint8Array) => {
  const info = await provider.connection.getAccountInfo(client.hashPda(hash));
  return info?.lamports ?? 0;
};

describe("hash-timestamp", () => {
  let rentMin: number;

  before(async () => {
    rentMin = await rentExemptForHash(provider.connection);
  });

  it("vote initializes a new hash account for the first voter", async () => {
    const hash = randomHash();

    await client.vote(hash);

    const account = await client.fetchHashAccount(hash);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);
    expect(Buffer.from(account!.hash)).to.deep.equal(hash);
    expect(await hashLamports(hash)).to.eq(rentMin);

    const voteInfo = await client.fetchVoteInfo(hash, provider.wallet.publicKey);
    expect(voteInfo).to.not.equal(null);
    expect(toNum(voteInfo!.amount)).to.eq(rentMin);

    await client.unvote(hash);
  });

  it("verify succeeds when the hash account exists", async () => {
    const hash = randomHash();

    await client.vote(hash);
    await client.verify(hash);

    const account = await client.fetchHashAccount(hash);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);

    await client.unvote(hash);
  });

  it("unvote removes the final voter and closes the hash account", async () => {
    const hash = randomHash();

    await client.vote(hash);
    await client.unvote(hash);

    const account = await client.fetchHashAccount(hash);
    expect(account).to.eq(null);
    expect(await hashLamports(hash)).to.eq(0);
  });

  it("retains the hash account while at least one voter remains", async () => {
    const hash = randomHash();

    await client.vote(hash);

    const second = Keypair.generate();
    await airdrop(second.publicKey, 2 * LAMPORTS_PER_SOL);
    await client.vote(hash, second);

    let account = await client.fetchHashAccount(hash);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(2);
    expect(await hashLamports(hash)).to.eq(rentMin * 2);

    await client.unvote(hash);

    account = await client.fetchHashAccount(hash);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);
    expect(await hashLamports(hash)).to.eq(rentMin);

    const firstVoteInfo = await client.fetchVoteInfo(hash, provider.wallet.publicKey);
    expect(firstVoteInfo).to.eq(null);

    const secondVoteInfo = await client.fetchVoteInfo(hash, second.publicKey);
    expect(secondVoteInfo).to.not.equal(null);

    await client.unvote(hash, second);

    account = await client.fetchHashAccount(hash);
    expect(account).to.eq(null);
    expect(await hashLamports(hash)).to.eq(0);
  });
});
