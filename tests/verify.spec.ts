import { expect } from "chai";
import {
  client,
  deriveGenesisHashId,
  randomHash,
  toNum,
} from "./helpers";

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
});
