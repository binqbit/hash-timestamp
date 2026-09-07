import { expect } from "chai";
import {
  mergeArchives,
  stringifyArchive,
  parseArchive,
  canonicalHashId,
} from "../../app/sdk/hashTimestamp";
import { sourceFromArchive } from "../../app/sdk/archive/values";
import {
  client,
  randomHash,
  deriveGenesisHashId,
  airdrop,
  provider,
  LAMPORTS_PER_SOL,
} from "../support/integration";

describe("portable archive recovery", () => {
  it("merges one-node receipts and restores the original timestamp through a branch", async () => {
    await airdrop(provider.wallet.publicKey, LAMPORTS_PER_SOL);
    const hash = randomHash(),
      hashId = deriveGenesisHashId(hash);
    const original = await client.register(hash);
    const branch = await client.branch(hashId, randomHash(), false);
    expect(Object.keys(original.archive.nodes)).to.have.length(1);
    expect(Object.keys(branch.archive.nodes)).to.have.length(1);
    const archive = parseArchive(
      stringifyArchive(mergeArchives(original.archive, branch.archive))
    );
    const pda = client.hashPda(hashId).toBase58();
    const closed = await client.unvote(hashId);
    await provider.connection.confirmTransaction(closed, "confirmed");
    const plan = await client.planRestore(archive, { targets: [pda] });
    expect(plan.steps).to.have.length(1);
    expect(plan.steps[0].additionalRequiredCreations).to.deep.equal([]);
    const restored = await client.executeRestorePlan(plan);
    expect(restored.signatures).to.have.length(1);
    expect(
      (await client.fetchHashAccount(hashId))!.createdAt.toString()
    ).to.equal(original.archive.nodes[pda].createdAt);
    await client.unvote(hashId);
    const child = Object.values(branch.archive.nodes)[0];
    await client.unvote(
      canonicalHashId(child.hash, sourceFromArchive(child.source))
    );
  });

  for (const kind of ["batch", "pack"] as const) {
    it(`recovers a selected Hash from a retained ${kind} without recreating its sibling`, async () => {
      const first = randomHash(),
        second = randomHash();
      const ids = [deriveGenesisHashId(first), deriveGenesisHashId(second)];
      const a = await client.register(first),
        b = await client.register(second);
      const grouped = await client[kind](ids);
      const archive = mergeArchives(a.archive, b.archive, grouped.archive);
      const closeFirst = await client.unvote(ids[0]);
      const closeSecond = await client.unvote(ids[1]);
      await provider.connection.confirmTransaction(closeFirst, "confirmed");
      await provider.connection.confirmTransaction(closeSecond, "confirmed");
      const target = client.hashPda(ids[0]).toBase58();
      const plan = await client.planRestore(archive, { targets: [target] });
      expect(plan.steps[0].expectedCreations).to.deep.equal([target]);
      await client.executeRestorePlan(plan);
      expect(
        (await client.fetchHashAccount(ids[0]))!.createdAt.toString()
      ).to.equal(a.archive.nodes[target].createdAt);
      expect(await client.fetchHashAccount(ids[1])).to.equal(null);
      await client.unvote(ids[0]);
      await client.unvote(
        "batchId" in grouped ? grouped.batchId : grouped.packId
      );
    });
  }
});
