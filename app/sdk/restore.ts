/** Pure restore proof encoding and materialization selection; no RPC or account effects. */
import * as anchor from "@coral-xyz/anchor";
import { HashSourceKind, RestoreProofInput } from "./types";
import { asI64, to32Bytes } from "./protocol/normalization";
import { canonicalHashId } from "./protocol/hashes";
import { encodeHashSource, encodeRestoreParameters } from "./encoding";
import type { WireProofLink } from "./wire";

export interface PreparedRestore {
  proofEncoded: WireProofLink[];
  anchorId: Uint8Array;
  /** Requested records, not a report of which records were newly created. */
  restoredIds: Uint8Array[];
}

export function prepareRestore(
  proof: RestoreProofInput[],
  createAccounts: boolean
): PreparedRestore {
  const proofEncoded = proof.map((entry) => ({
    hash: [...to32Bytes(entry.hash)],
    source: encodeHashSource(entry.source),
    createdAt: new anchor.BN(asI64(entry.createdAt).toString()),
    params: entry.params ? encodeRestoreParameters(entry.params) : null,
  }));

  const anchorId =
    proof.length > 0
      ? canonicalHashId(to32Bytes(proof[0].hash), proof[0].source)
      : canonicalHashId(new Uint8Array(32), HashSourceKind.Hash);

  const selection = createAccounts
    ? proof
        .slice(1)
        .filter((entry) => entry.params !== undefined && entry.params !== null)
    : [];

  const restoredIds: Uint8Array[] = [];

  if (selection.length > 0) {
    for (const entry of selection) {
      const entryHashBytes = to32Bytes(entry.hash);
      const entryCanonical = canonicalHashId(entryHashBytes, entry.source);
      if (Buffer.from(entryCanonical).equals(Buffer.from(anchorId))) {
        throw new Error("restore selection must not include the anchor hash");
      }

      restoredIds.push(entryCanonical);
    }
  }

  // These are requested IDs. The program may find that some already exist.
  return { proofEncoded, anchorId, restoredIds };
}
