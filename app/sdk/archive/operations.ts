import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import type { RestoreProofInput, RestoreHashFingerprintInput } from "../types";
import { canonicalHashId } from "../protocol/hashes";
import { deriveHashPda } from "../protocol/addresses";
import { hashSourceKindOf } from "../protocol/source";
import { toBytes } from "../protocol/normalization";
import { archivePublicKey, createArchive, parseArchive } from "./codec";
import { dependencyOrder, inspectArchiveGraph } from "./graph";
import { ArchiveNode, HashArchive } from "./model";
import { archiveHex, archiveSnapshot, archiveSource } from "./values";

export function inspectArchive(input: HashArchive) {
  return inspectArchiveGraph(parseArchive(input));
}

/** Immutable union. Matching records may gain missing witnesses, never a different history. */
export function mergeArchives(
  first: HashArchive,
  ...others: HashArchive[]
): HashArchive {
  const result = parseArchive(first);
  for (const input of others) {
    const archive = parseArchive(input);
    if (archive.programId !== result.programId)
      throw new Error("Cannot merge archives from different programs");
    for (const [pda, node] of Object.entries(archive.nodes)) {
      const previous = result.nodes[pda];
      if (!previous) {
        result.nodes[pda] = node;
        continue;
      }
      const core = (n: ArchiveNode) =>
        JSON.stringify([n.hash, n.source, n.createdAt]);
      if (core(previous) !== core(node))
        throw new Error(`Conflicting historical incarnation: ${pda}`);
      for (const field of ["members", "snapshot"] as const)
        if (
          previous[field] !== undefined &&
          node[field] !== undefined &&
          JSON.stringify(previous[field]) !== JSON.stringify(node[field])
        )
          throw new Error(`Conflicting ${field}: ${pda}`);
      result.nodes[pda] = {
        ...previous,
        ...node,
        ...(previous.members ? { members: previous.members } : {}),
        ...(previous.snapshot ? { snapshot: previous.snapshot } : {}),
      };
    }
  }
  return parseArchive(result);
}

export function addArchiveNode(
  archive: HashArchive,
  pda: string,
  node: ArchiveNode
): HashArchive {
  return mergeArchives(archive, {
    ...createArchive(archive.programId),
    nodes: { [pda]: node },
  });
}

/** Extract records with or without their dependencies. Never modifies the source archive. */
export function selectArchive(
  input: HashArchive,
  pdas: string[],
  includeDependencies = true
): HashArchive {
  const archive = parseArchive(input);
  const addresses = pdas.map((pda) => archivePublicKey(pda));
  const ids = includeDependencies
    ? dependencyOrder(archive, addresses)
    : addresses;
  const result = createArchive(archive.programId);
  for (const pda of ids) {
    if (!archive.nodes[pda]) throw new Error(`Unknown archive node: ${pda}`);
    result.nodes[pda] = archive.nodes[pda];
  }
  return parseArchive(result);
}

/** Import the existing SDK proof representation; fingerprints remain derivable, not duplicated. */
export function archiveFromProof(
  programId: PublicKey | string,
  proof: RestoreProofInput[]
): HashArchive {
  let archive = createArchive(programId);
  const key = new PublicKey(archive.programId);
  for (const link of proof) {
    if (link.params && link.params.kind !== link.source.kind)
      throw new Error("Proof parameters do not match source");
    if (link.params?.kind === "hash") {
      const payload = Buffer.from(toBytes(link.params.payload));
      if (
        !payload.length ||
        (payload.toString("hex") !== archiveHex(link.hash) &&
          createHash("sha256").update(payload).digest().toString("hex") !==
            archiveHex(link.hash))
      )
        throw new Error("Proof Hash payload does not match hash");
    }
    const fingerprintId = (member: RestoreHashFingerprintInput) =>
      archiveHex(
        canonicalHashId(member.hash, hashSourceKindOf(member.sourceKind))
      );
    if (
      link.source.kind === "branch" &&
      link.params?.kind === "branch" &&
      fingerprintId(link.params.parent) !==
        archiveHex(link.source.previousHashId)
    )
      throw new Error("Proof Branch parent does not match source");
    if (
      link.source.kind === "batch" &&
      link.params?.kind === "batch" &&
      JSON.stringify(link.params.members.map(fingerprintId)) !==
        JSON.stringify(link.source.members.map(archiveHex))
    )
      throw new Error("Proof Batch members do not match source order");
    const node: ArchiveNode = {
      hash: archiveHex(link.hash),
      source: archiveSource(link.source),
      createdAt: link.createdAt.toString(),
    };
    if (link.params?.kind === "pack")
      node.members = link.params.members.map((member) =>
        deriveHashPda(
          key,
          canonicalHashId(member.hash, hashSourceKindOf(member.sourceKind))
        ).toBase58()
      );
    if (link.params?.kind === "account" && link.params.snapshot)
      node.snapshot = archiveSnapshot(link.params.snapshot);
    const pda = deriveHashPda(
      key,
      canonicalHashId(link.hash, link.source)
    ).toBase58();
    if (archive.nodes[pda]) throw new Error(`Duplicate proof node: ${pda}`);
    archive.nodes[pda] = node;
  }
  archive = parseArchive(archive);
  // Do not silently discard contradictory supplied fingerprints while normalizing the graph.
  for (const link of proof) {
    const params = link.params;
    const fingerprints =
      params?.kind === "branch"
        ? [params.parent]
        : params?.kind === "batch" || params?.kind === "pack"
        ? params.members
        : [];
    for (const member of fingerprints) {
      const pda = deriveHashPda(
        key,
        canonicalHashId(member.hash, hashSourceKindOf(member.sourceKind))
      ).toBase58();
      const node = archive.nodes[pda];
      if (
        !node ||
        node.createdAt !== member.createdAt.toString() ||
        (node.source.kind === "branch" ? node.source.generation : "0") !==
          member.generation.toString()
      )
        throw new Error(
          `Proof fingerprint does not match archive node: ${pda}`
        );
    }
  }
  return archive;
}
