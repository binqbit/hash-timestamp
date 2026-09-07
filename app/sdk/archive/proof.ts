import type { RestoreProofInput } from "../types";
import { parseArchive, archivePublicKey } from "./codec";
import { dependencyOrder, nodeDependencies } from "./graph";
import { HashArchive } from "./model";
import {
  nodeFingerprint,
  snapshotFromArchive,
  sourceFromArchive,
} from "./values";

export interface ArchiveProofOptions {
  anchor: string;
  /** PDA targets. Other raw Hash leaves stay proof-only. */
  targets: string[];
  /** Only records that will actually be supplied as existing to the instruction. */
  existingAccounts?: string[];
}

/** Pure compiler. Existence and transaction feasibility are checked by the client planner. */
export function buildRestoreProof(
  input: HashArchive,
  options: ArchiveProofOptions
): RestoreProofInput[] {
  const archive = parseArchive(input);
  const anchor = archivePublicKey(options.anchor);
  const order = dependencyOrder(archive, [anchor]);
  const included = new Set(order),
    targets = new Set(options.targets.map((pda) => archivePublicKey(pda)));
  if (targets.size !== options.targets.length)
    throw new Error("Duplicate restore targets");
  for (const target of targets)
    if (!included.has(target))
      throw new Error(`Target not reachable from anchor: ${target}`);
  const existing = new Set([
    anchor,
    ...(options.existingAccounts ?? []).map((pda) => archivePublicKey(pda)),
  ]);
  return [anchor, ...order.filter((pda) => pda !== anchor)].map((pda) => {
    const node = archive.nodes[pda];
    const source = sourceFromArchive(node.source);
    const entry: RestoreProofInput = {
      hash: node.hash,
      source,
      createdAt: BigInt(node.createdAt),
    };
    const dependencies = nodeDependencies(archive, node)!;
    switch (source.kind) {
      case "hash":
        entry.params = targets.has(pda)
          ? { kind: "hash", payload: node.hash }
          : null;
        break;
      case "account":
        if (!node.snapshot && !existing.has(pda))
          throw new Error(`Missing Account snapshot: ${pda}`);
        entry.params = {
          kind: "account",
          snapshot: existing.has(pda)
            ? undefined
            : snapshotFromArchive(node.snapshot!),
        };
        break;
      case "branch":
        entry.params = {
          kind: "branch",
          parent: nodeFingerprint(archive.nodes[dependencies[0]]),
        };
        break;
      case "batch":
      case "pack":
        entry.params = {
          kind: source.kind,
          members: dependencies.map((dep) =>
            nodeFingerprint(archive.nodes[dep])
          ),
        };
        break;
    }
    return entry;
  });
}
