import { Connection } from "@solana/web3.js";
import { HashSource, VOTE_INFO_SPACE } from "./types";
import { hashAccountSpace } from "./protocol/source";

export async function rentExemptForHash(
  conn: Connection,
  source: HashSource = { kind: "hash" }
): Promise<number> {
  return conn.getMinimumBalanceForRentExemption(hashAccountSpace(source));
}

export async function rentExemptForVote(conn: Connection): Promise<number> {
  return conn.getMinimumBalanceForRentExemption(VOTE_INFO_SPACE);
}
