import { SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";

/** Observe the chain's Clock, not wall-clock sleep, before creating a newer record. */
export async function waitForChainTimeAfter(
  connection: Connection,
  previous: bigint,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clock = await connection.getAccountInfo(
      SYSVAR_CLOCK_PUBKEY,
      "confirmed"
    );
    if (!clock || clock.data.length < 40)
      throw new Error("Clock sysvar is unavailable");
    // Clock's four preceding fields each occupy 8 bytes; unix_timestamp is i64.
    if (clock.data.readBigInt64LE(32) > previous) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Chain timestamp did not advance past ${previous} within ${timeoutMs} ms`
  );
}
