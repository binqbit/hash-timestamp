import { strict as assert } from "assert";
import { errorCodeOf, expectProgramError } from "../support/assertions";

describe("test error assertions", () => {
  it("accepts the exact program error from structured data or logs", async () => {
    await expectProgramError(
      Promise.reject({ error: { errorCode: { number: 6002 } } }),
      6002
    );
    await expectProgramError(
      Promise.reject({
        logs: ["Program failed: custom program error: 0x1772"],
      }),
      6002
    );
  });

  it("fails on unexpected success", async () => {
    await assert.rejects(
      expectProgramError(Promise.resolve("signature"), 6002),
      assert.AssertionError
    );
  });

  it("does not mistake another code or a transport error for the expected rejection", async () => {
    for (const error of [
      { error: { errorCode: { number: 6001 } } },
      new Error("RPC unavailable"),
    ]) {
      await assert.rejects(
        expectProgramError(Promise.reject(error), 6002),
        assert.AssertionError
      );
    }
  });

  it("prefers the structured code and ignores text outside program logs", () => {
    assert.equal(
      errorCodeOf({
        error: { errorCode: { number: 3012 } },
        logs: ["custom program error: 0x1772"],
      }),
      3012
    );
    assert.equal(errorCodeOf(new Error("Expected program error 6002")), null);
    assert.equal(errorCodeOf(null), null);
  });
});
