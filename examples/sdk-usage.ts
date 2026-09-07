/**
 * Node.js examples. Importing this module never connects to a cluster or sends a transaction.
 * Call the functions explicitly with a configured, funded provider/client.
 */
import { createHash } from "crypto";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { HashTimestamp } from "../target/types/hash_timestamp";
import {
  HashTimestampClient,
  canonicalHashId,
  decodeHashSource,
  deriveBranchHash,
  deriveBranchHashId,
  deriveGenesisHashId,
  hashSourceKindOf,
} from "../app/sdk/hashTimestamp";
import type { HashBytes, RestoreProofInput } from "../app/sdk/hashTimestamp";

/** Load the matching generated IDL in your application and supply its provider. */
export function createClient(idl: HashTimestamp, provider: AnchorProvider) {
  return new HashTimestampClient(new Program<HashTimestamp>(idl, provider));
}

/** Register a file digest. Registration already creates this signer's vote. */
export async function registerFile(
  client: HashTimestampClient,
  bytes: Uint8Array
) {
  const fileHash = createHash("sha256").update(bytes).digest();
  const hashId = deriveGenesisHashId(fileHash);
  const signature = await client.register(fileHash);
  const record = await client.fetchHashAccount(hashId);
  if (!record) throw new Error("Registered hash record was not found");
  return {
    signature,
    fileHash,
    hashId,
    address: client.hashPda(hashId),
    createdAt: record.createdAt.toString(),
    source: decodeHashSource(record.source),
  };
}

/**
 * Create one branch from a raw Hash record, retaining its parent vote.
 * Save the returned proof before removing any votes; retain the live child anchor.
 * This deliberately supports one raw parent, not arbitrary history graphs.
 */
export async function branchFromFile(
  client: HashTimestampClient,
  parentId: HashBytes,
  payload: HashBytes
) {
  const parent = await client.fetchHashAccount(parentId);
  if (!parent) throw new Error("Parent hash record was not found");
  const parentSource = decodeHashSource(parent.source);
  if (parentSource.kind !== "hash")
    throw new Error("This example requires a raw Hash parent");

  const childHash = deriveBranchHash(
    parentId,
    parent.createdAt,
    0n,
    hashSourceKindOf(parentSource),
    payload
  );
  const childId = deriveBranchHashId(childHash);
  const signature = await client.branch(parentId, payload, false);
  const child = await client.fetchHashAccount(childId);
  if (!child) throw new Error("Branch hash record was not found");

  const proof: RestoreProofInput[] = [
    {
      hash: child.hash,
      source: decodeHashSource(child.source),
      createdAt: child.createdAt,
      params: {
        kind: "branch",
        parent: {
          hash: parent.hash,
          sourceKind: hashSourceKindOf(parentSource),
          createdAt: parent.createdAt,
          generation: 0n,
        },
      },
    },
    {
      hash: parent.hash,
      source: parentSource,
      createdAt: parent.createdAt,
      params: { kind: "hash", payload: parent.hash },
    },
  ];
  return {
    signature,
    childId,
    parentId: canonicalHashId(parent.hash, parentSource),
    proof,
  };
}
