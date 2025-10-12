import { expect } from "chai";
import { client, deriveGenesisHashId, errorCodeOf, randomHash, toNum } from "./helpers";

describe("verify instruction", () => {
  it("verify succeeds when the hash account exists", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    await client.register(payload);
    await client.verify(hashId);

    const account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    expect(toNum(account!.voters)).to.eq(1);

    await client.unvote(hashId);
  });

  it("fails when the hash account is missing", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);

    try {
      await client.verify(hashId);
      expect.fail("verify should fail for a missing hash account");
    } catch (err: any) {
      const message = (
        err?.error?.errorMessage ?? err?.message ?? ""
      ).toLowerCase();
      const code = errorCodeOf(err);
      expect(
        message.includes("account does not exist") ||
          message.includes("not found") ||
          message.includes("already be initialized") ||
          message.includes("already initialized") ||
          code === 6000 ||
          code === 6001
      ).to.eq(
        true,
        `Unexpected error for missing hash verification: ${err?.error?.errorMessage ?? err}`
      );
    }
  });
});
