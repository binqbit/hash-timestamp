import { expect } from "chai";
import {
  client,
  deriveGenesisHashId,
  expectProgramError,
  provider,
  randomHash,
} from "../support/integration";

describe("verify instruction", () => {
  it("verifies existence without changing the hash or vote account", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    await client.register(payload);
    try {
      const addresses = [
        client.hashPda(hashId),
        client.votePda(hashId, provider.wallet.publicKey),
      ];
      const before = await provider.connection.getMultipleAccountsInfo(
        addresses
      );
      expect(before.every((account) => account !== null)).to.equal(true);
      await client.verify(hashId);
      expect(
        await provider.connection.getMultipleAccountsInfo(addresses)
      ).to.deep.equal(before);
    } finally {
      await client.unvote(hashId);
    }
  });

  it("fails when the hash account is missing", async () => {
    await expectProgramError(
      client.verify(deriveGenesisHashId(randomHash())),
      3012
    );
  });
});
