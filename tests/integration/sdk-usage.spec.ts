import { expect } from "chai";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  branchFromFile,
  createClient,
  registerFile,
} from "../../examples/sdk-usage";
import { airdrop, client, provider, randomHash } from "../support/integration";

describe("documented SDK usage", () => {
  it("registers, branches and restores using the public examples", async () => {
    await airdrop(provider.wallet.publicKey, LAMPORTS_PER_SOL);
    const exampleClient = createClient(client.program.idl, provider);
    const registered = await registerFile(exampleClient, randomHash());
    expect(registered.source).to.deep.equal({ kind: "hash" });
    const branch = await branchFromFile(
      exampleClient,
      registered.hashId,
      randomHash()
    );
    expect(branch.parentId).to.deep.equal(registered.hashId);
    // Only this fixture owns a vote; removing it closes the parent record.
    await exampleClient.unvote(registered.hashId);
    expect(await exampleClient.fetchHashAccount(registered.hashId)).to.equal(
      null
    );
    const verified = await exampleClient.restore(branch.proof, {
      createAccounts: false,
    });
    expect(verified.restoredIds).to.deep.equal([]);
    expect(await exampleClient.fetchHashAccount(registered.hashId)).to.equal(
      null
    );
    const restored = await exampleClient.restore(branch.proof);
    expect(restored.restoredIds).to.deep.equal([registered.hashId]);
    const record = await exampleClient.fetchHashAccount(registered.hashId);
    expect(record!.createdAt.toString()).to.equal(registered.createdAt);
    await exampleClient.unvote(registered.hashId);
    await exampleClient.unvote(branch.childId);
  });
});
