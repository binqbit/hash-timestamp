import { expect } from "chai";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

import {
  airdrop,
  client,
  deriveBranchHash,
  deriveBranchHashId,
  deriveGenesisHashId,
  generationOf,
  getRentMinimums,
  hashLamports,
  hashSourceOf,
  Keypair,
  LAMPORTS_PER_SOL,
  provider,
  randomHash,
  sourceKindOf,
  toNum,
  voteLamports,
} from "../support/integration";
import { RestoreProofInput } from "../../app/sdk/hashTimestamp";

const prefund = async (lamports: number, ...destinations: PublicKey[]) => {
  const transaction = new Transaction();
  for (const destination of destinations) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: destination,
        lamports,
      })
    );
  }
  await provider.sendAndConfirm(transaction);
};

describe("prefunded deterministic PDAs", () => {
  let placeholderRent: number;
  let hashRent: number;
  let voteRent: number;

  before(async () => {
    placeholderRent =
      await provider.connection.getMinimumBalanceForRentExemption(0);
    ({ hash: hashRent, vote: voteRent } = await getRentMinimums());
  });

  it("registers when both the hash and first-vote PDAs already hold lamports", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    const hashPda = client.hashPda(hashId);
    const votePda = client.votePda(hashId, provider.wallet.publicKey);

    await prefund(placeholderRent, hashPda, votePda);
    expect(await hashLamports(hashId)).to.eq(placeholderRent);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(
      placeholderRent
    );

    await client.register(payload);

    const hashAccount = await client.fetchHashAccount(hashId);
    const voteAccount = await client.fetchVoteInfo(
      hashId,
      provider.wallet.publicKey
    );
    expect(hashAccount).to.not.equal(null);
    expect(voteAccount).to.not.equal(null);
    expect(toNum(hashAccount!.voters)).to.eq(1);
    expect(await hashLamports(hashId)).to.eq(hashRent);
    expect(await voteLamports(hashId, provider.wallet.publicKey)).to.eq(
      voteRent
    );

    await client.unvote(hashId);
  });

  for (const surplus of [0, 12345]) {
    it(`retains ${
      surplus ? "overfunded" : "fully funded"
    } PDA balances and refunds exactly to the instruction signer`, async () => {
      const signer = Keypair.generate();
      await airdrop(signer.publicKey, LAMPORTS_PER_SOL);
      const payload = randomHash();
      const id = deriveGenesisHashId(payload);
      const hashPda = client.hashPda(id);
      const votePda = client.votePda(id, signer.publicKey);
      const hashBalance = hashRent + surplus;
      const voteBalance = voteRent + surplus;
      await prefund(hashBalance, hashPda);
      await prefund(voteBalance, votePda);
      const balanceBefore = await provider.connection.getBalance(
        signer.publicKey
      );
      await client.register(payload, signer);
      try {
        // Provider pays transaction fees; no rent top-up is needed from signer.
        expect(await provider.connection.getBalance(signer.publicKey)).to.equal(
          balanceBefore
        );
        expect(await hashLamports(id)).to.equal(hashBalance);
        expect(await voteLamports(id, signer.publicKey)).to.equal(voteBalance);
        const vote = await client.fetchVoteInfo(id, signer.publicKey);
        expect(toNum(vote!.amount)).to.equal(hashRent);
        expect(vote!.voter.equals(signer.publicKey)).to.equal(true);
        expect(Buffer.from(vote!.hashId)).to.deep.equal(Buffer.from(id));
      } finally {
        await client.unvote(id, signer);
      }
      expect(await provider.connection.getBalance(signer.publicKey)).to.equal(
        balanceBefore + hashBalance + voteBalance
      );
      expect(await client.fetchHashAccount(id)).to.equal(null);
      expect(await client.fetchVoteInfo(id, signer.publicKey)).to.equal(null);
    });
  }

  it("adds a voter when their vote PDA already holds lamports", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    await client.register(payload);

    const second = Keypair.generate();
    await airdrop(second.publicKey, 2 * LAMPORTS_PER_SOL);
    const secondVotePda = client.votePda(hashId, second.publicKey);
    await prefund(placeholderRent, secondVotePda);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(placeholderRent);

    await client.vote(hashId, second);

    const hashAccount = await client.fetchHashAccount(hashId);
    expect(hashAccount).to.not.equal(null);
    expect(toNum(hashAccount!.voters)).to.eq(2);
    expect(await hashLamports(hashId)).to.eq(hashRent * 2);
    expect(await voteLamports(hashId, second.publicKey)).to.eq(voteRent);

    await client.unvote(hashId, second);
    await client.unvote(hashId);
  });

  it("restores an ancestor when its hash and vote PDAs already hold lamports", async () => {
    const genesisPayload = randomHash();
    const genesisId = deriveGenesisHashId(genesisPayload);
    await client.register(genesisPayload);

    const genesisAccount = await client.fetchHashAccount(genesisId);
    expect(genesisAccount).to.not.equal(null);
    const genesisCreatedAt = toNum(
      (genesisAccount as any).createdAt ??
        (genesisAccount as any).created_at ??
        0
    );

    const branchPayload = randomHash();
    await client.branch(genesisId, branchPayload, true);
    expect(await client.fetchHashAccount(genesisId)).to.equal(null);

    const branchHash = deriveBranchHash(
      genesisId,
      genesisCreatedAt,
      generationOf(genesisAccount!),
      sourceKindOf(genesisAccount!),
      branchPayload
    );
    const branchId = deriveBranchHashId(branchHash);
    const branchAccount = await client.fetchHashAccount(branchId);
    expect(branchAccount).to.not.equal(null);
    const branchCreatedAt = toNum(
      (branchAccount as any).createdAt ?? (branchAccount as any).created_at ?? 0
    );

    const proof: RestoreProofInput[] = [
      {
        hash: Buffer.from((branchAccount as any).hash),
        source: hashSourceOf(branchAccount!),
        createdAt: branchCreatedAt,
        params: {
          kind: "branch",
          parent: {
            hash: Buffer.from((genesisAccount as any).hash),
            sourceKind: sourceKindOf(genesisAccount!),
            createdAt: genesisCreatedAt,
            generation: generationOf(genesisAccount!),
          },
        },
      },
      {
        hash: Buffer.from((genesisAccount as any).hash),
        source: hashSourceOf(genesisAccount!),
        createdAt: genesisCreatedAt,
        params: { kind: "hash", payload: genesisPayload },
      },
    ];

    const genesisHashPda = client.hashPda(genesisId);
    const genesisVotePda = client.votePda(genesisId, provider.wallet.publicKey);
    await prefund(placeholderRent, genesisHashPda, genesisVotePda);

    const { restoredIds } = await client.restore(proof);
    expect(restoredIds).to.have.length(1);
    expect(Buffer.from(restoredIds[0])).to.deep.equal(Buffer.from(genesisId));
    expect(await hashLamports(genesisId)).to.eq(hashRent);
    expect(await voteLamports(genesisId, provider.wallet.publicKey)).to.eq(
      voteRent
    );

    await client.unvote(genesisId);
    await client.unvote(branchId);
  });
});
