/** Explicitly invoked examples only: importing this file has no RPC or filesystem effects. */
import { createHash } from "crypto";
import {
  HashTimestampClient,
  deriveGenesisHashId,
  mergeArchives,
  parseArchive,
  stringifyArchive,
  type HashArchive,
} from "../app/sdk/hashTimestamp";

/** The caller persists the returned text before withdrawing any votes. */
export async function registerAndBranch(
  client: HashTimestampClient,
  bytes: Uint8Array,
  updated: Uint8Array
) {
  const hash = createHash("sha256").update(bytes).digest();
  const initial = await client.register(hash);
  const child = await client.branch(
    deriveGenesisHashId(hash),
    createHash("sha256").update(updated).digest(),
    false
  );
  const archive = mergeArchives(initial.archive, child.archive);
  return {
    signatures: [initial.signature, child.signature],
    archive,
    json: stringifyArchive(archive),
    originalPda: Object.keys(initial.archive.nodes)[0],
  };
}

/** Read-only preview: application displays the plan, then decides whether to execute it. */
export async function previewRestore(
  client: HashTimestampClient,
  json: string,
  targetPda: string
) {
  return client.planRestore(parseArchive(json), { targets: [targetPda] });
}

/** Immutable client-owned aggregation; conflicting historical incarnations are rejected. */
export function appendReceipt(
  savedJson: string,
  newNodeArchive: HashArchive
): string {
  return stringifyArchive(
    mergeArchives(parseArchive(savedJson), newNodeArchive)
  );
}
