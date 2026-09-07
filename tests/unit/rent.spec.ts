import { strict as assert } from "assert";
import type { Connection } from "@solana/web3.js";
import {
  rentExemptForHash,
  rentExemptForVote,
} from "../../app/sdk/hashTimestamp";

describe("SDK rent estimates", () => {
  it("requests the correct default, batch and vote sizes and returns the RPC amount", async () => {
    const sizes: number[] = [];
    const connection = {
      async getMinimumBalanceForRentExemption(size: number) {
        sizes.push(size);
        return size * 10;
      },
    } as Connection;
    assert.equal(await rentExemptForHash(connection), 640);
    assert.equal(
      await rentExemptForHash(connection, {
        kind: "batch",
        members: [Buffer.alloc(32), Buffer.alloc(32, 1)],
      }),
      1280
    );
    assert.equal(await rentExemptForVote(connection), 880);
    assert.deepEqual(sizes, [64, 128, 88]);
  });

  it("propagates RPC errors without substituting a guessed rent", async () => {
    const sentinel = new Error("rent RPC failed");
    const connection = {
      async getMinimumBalanceForRentExemption() {
        throw sentinel;
      },
    } as unknown as Connection;
    for (const operation of [
      rentExemptForHash(connection),
      rentExemptForVote(connection),
    ]) {
      await assert.rejects(operation, (error) => error === sentinel);
    }
  });
});
