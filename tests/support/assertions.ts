import { strict as assert } from "assert";

/** Decode Anchor's structured error first, then its program logs. No RPC needed. */
export function errorCodeOf(error: unknown): number | null {
  const value = error as {
    error?: { errorCode?: { number?: unknown }; logs?: unknown };
    logs?: unknown;
  } | null;
  const direct = value?.error?.errorCode?.number;
  if (typeof direct === "number") return direct;
  const logs = value?.logs ?? value?.error?.logs;
  if (Array.isArray(logs)) {
    for (const entry of logs) {
      if (typeof entry !== "string") continue;
      const match = entry.match(/custom program error: 0x([0-9a-f]+)/i);
      if (match) return parseInt(match[1], 16);
    }
  }
  return null;
}

/** Unexpected success and unrelated failures must both fail the test. */
export async function expectProgramError(
  operation: Promise<unknown>,
  expectedCode: number
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(errorCodeOf(error), expectedCode, String(error));
    return true;
  });
}
