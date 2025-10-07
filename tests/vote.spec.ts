import { expect } from "chai";
import { client, deriveGenesisHashId, randomHash } from "./helpers";

describe("vote instruction", () => {
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
        text.includes("already in use") || text.includes("already exists")
      );
    }

    await client.unvote(hashId);
  });
});
