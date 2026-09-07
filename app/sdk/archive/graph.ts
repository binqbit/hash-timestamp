import { PublicKey } from "@solana/web3.js";
import { deriveHashPda } from "../protocol/addresses";
import {
  deriveAccountSnapshotHash,
  deriveBatchHash,
  deriveBranchHash,
  derivePackHash,
} from "../protocol/hashes";
import { hashSourceKindOf } from "../protocol/source";
import { ArchiveNode, HashArchive } from "./model";
import {
  archiveHex,
  nodeFingerprint,
  nodeId,
  snapshotFromArchive,
  sourceFromArchive,
} from "./values";

export interface ArchiveInspection {
  complete: boolean;
  missingNodes: string[];
  missingWitnesses: { pda: string; field: "members" | "snapshot" }[];
}

export function nodeDependencies(
  archive: HashArchive,
  node: ArchiveNode
): string[] | undefined {
  const pda = (id: string) =>
    deriveHashPda(new PublicKey(archive.programId), id).toBase58();
  switch (node.source.kind) {
    case "branch":
      return [pda(node.source.previousHashId)];
    case "batch":
      return node.source.members.map(pda);
    case "pack":
      return node.members;
    default:
      return [];
  }
}

/** Iterative traversal: complete dependencies, no pruning through existing derived nodes. */
export function dependencyOrder(
  archive: HashArchive,
  roots: string[],
  requireComplete = true
): string[] {
  const active = new Set<string>(),
    done = new Set<string>(),
    ordered: string[] = [];
  for (const root of roots) {
    const stack: { pda: string; exit: boolean }[] = [
      { pda: root, exit: false },
    ];
    while (stack.length) {
      const { pda, exit } = stack.pop()!;
      if (exit) {
        active.delete(pda);
        done.add(pda);
        ordered.push(pda);
        continue;
      }
      if (done.has(pda)) continue;
      if (active.has(pda))
        throw new Error(`Cyclic archive dependencies: ${pda}`);
      const node = archive.nodes[pda];
      if (!node) {
        if (requireComplete) throw new Error(`Missing archive node: ${pda}`);
        continue;
      }
      const dependencies = nodeDependencies(archive, node);
      if (!dependencies && requireComplete)
        throw new Error(`Missing Pack members: ${pda}`);
      active.add(pda);
      stack.push({ pda, exit: true });
      for (const dependency of [...(dependencies ?? [])].reverse())
        stack.push({ pda: dependency, exit: false });
    }
  }
  return ordered;
}

/** Checks every commitment whose inputs are present; missing data is reported, never invented. */
export function inspectArchiveGraph(archive: HashArchive): ArchiveInspection {
  const missing = new Set<string>();
  const witnesses: ArchiveInspection["missingWitnesses"] = [];
  dependencyOrder(archive, Object.keys(archive.nodes), false);
  for (const [pda, node] of Object.entries(archive.nodes)) {
    const dependencies = nodeDependencies(archive, node);
    if (!dependencies) witnesses.push({ pda, field: "members" });
    for (const dep of dependencies ?? [])
      if (!archive.nodes[dep]) missing.add(dep);
    let expected: Uint8Array | undefined;
    if (node.source.kind === "account") {
      if (!node.snapshot) witnesses.push({ pda, field: "snapshot" });
      else
        expected = deriveAccountSnapshotHash(
          node.source.account,
          snapshotFromArchive(node.snapshot)
        );
    }
    if (dependencies && dependencies.every((dep) => !!archive.nodes[dep])) {
      if (node.source.kind === "branch") {
        const parent = archive.nodes[dependencies[0]];
        const fingerprint = nodeFingerprint(parent);
        if (
          BigInt(node.source.generation) !==
          BigInt(fingerprint.generation.toString()) + 1n
        )
          throw new Error(`Branch generation mismatch: ${pda}`);
        expected = deriveBranchHash(
          nodeId(parent),
          BigInt(parent.createdAt),
          fingerprint.generation,
          hashSourceKindOf(sourceFromArchive(parent.source)),
          node.source.payload
        );
      } else if (node.source.kind === "batch" || node.source.kind === "pack") {
        const members = dependencies.map((dep) => {
          const member = archive.nodes[dep];
          return {
            hash: member.hash,
            kind: hashSourceKindOf(sourceFromArchive(member.source)),
            createdAt: BigInt(member.createdAt),
          };
        });
        expected =
          node.source.kind === "batch"
            ? deriveBatchHash(members)
            : derivePackHash(members);
      }
    }
    if (expected && archiveHex(expected) !== node.hash)
      throw new Error(`Archive commitment mismatch: ${pda}`);
  }
  return {
    complete: !missing.size && !witnesses.length,
    missingNodes: [...missing].sort(),
    missingWitnesses: witnesses,
  };
}
