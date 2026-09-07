import { PublicKey } from "@solana/web3.js";
import { HashBytes } from "../types";
import { to32Bytes } from "./normalization";

export function deriveHashPda(
  programId: PublicKey,
  hash: HashBytes
): PublicKey {
  const hashBytes = to32Bytes(hash);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("hash"), Buffer.from(hashBytes)],
    programId
  );
  return pda;
}

export function deriveVotePda(
  programId: PublicKey,
  hashId: HashBytes,
  voter: PublicKey
): PublicKey {
  const hashIdBytes = to32Bytes(hashId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), voter.toBuffer(), Buffer.from(hashIdBytes)],
    programId
  );
  return pda;
}
