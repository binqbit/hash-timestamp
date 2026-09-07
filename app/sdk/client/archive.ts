/** Chain reads and post-confirmation capture. Pure archive modules never access RPC. */
import type { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { HashTimestamp } from "../../../target/types/hash_timestamp";
import { decodeHashSource } from "../encoding";
import { canonicalHashId } from "../protocol/hashes";
import { createArchive, parseArchive } from "../archive/codec";
import type { ArchiveNode, HashArchive } from "../archive/model";
import { archiveHex, archiveSource, nodeId } from "../archive/values";
import { submitInstruction } from "./transactions";
import type { CreationResult } from "../types";
import type { Keypair } from "@solana/web3.js";

export type ArchiveProgram = Pick<
  Program<HashTimestamp>,
  "programId" | "provider" | "coder"
>;
export type PendingArchiveNode = Omit<ArchiveNode, "createdAt">;

export class ArchiveCaptureError extends Error {
  readonly name = "ArchiveCaptureError";
  constructor(
    readonly signature: string,
    readonly pda: string,
    readonly pendingNode: PendingArchiveNode,
    readonly cause: unknown,
    readonly status: "submitted" | "confirmed" = "confirmed"
  ) {
    super(
      `Transaction ${signature} ${status}, but archive capture failed for ${pda}. Check its status; do not blindly resubmit creation. ${String(
        cause
      )}`
    );
  }
}

/** Only absent or valid System-owned placeholders count as missing; RPC errors propagate. */
export async function readArchiveRecord(
  program: ArchiveProgram,
  pda: string,
  minContextSlot?: number
): Promise<ArchiveNode | null> {
  const address = new PublicKey(pda);
  const info = await program.provider.connection.getAccountInfo(address, {
    commitment: "confirmed",
    minContextSlot,
  });
  if (
    !info ||
    (info.owner.equals(SystemProgram.programId) &&
      !info.executable &&
      info.data.length === 0)
  )
    return null;
  if (!info.owner.equals(program.programId) || info.executable)
    throw new Error(`Incompatible account owner/state: ${pda}`);
  const record = program.coder.accounts.decode("hashAccount", info.data);
  if (BigInt(record.voters.toString()) <= 0n)
    throw new Error(`Hash record has no voters: ${pda}`);
  const source = decodeHashSource(record.source);
  const hash = archiveHex(record.hash);
  const [expected, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("hash"), Buffer.from(canonicalHashId(hash, source))],
    program.programId
  );
  if (!expected.equals(address) || record.bump !== bump)
    throw new Error(`Invalid hash record PDA/bump: ${pda}`);
  const node: ArchiveNode = {
    hash,
    source: archiveSource(source),
    createdAt: record.createdAt.toString(),
  };
  return parseArchive({
    ...createArchive(program.programId),
    nodes: { [pda]: node },
  }).nodes[pda];
}

export function sameArchiveRecord(a: ArchiveNode, b: ArchiveNode): boolean {
  return (
    a.hash === b.hash &&
    a.createdAt === b.createdAt &&
    JSON.stringify(a.source) === JSON.stringify(b.source)
  );
}

/** Validate all known archive inputs before any transaction can be submitted. */
export async function submitCreation(
  program: ArchiveProgram,
  builder: Parameters<typeof submitInstruction>[0],
  pending: PendingArchiveNode,
  payer?: Keypair
): Promise<CreationResult> {
  const provisional = { ...pending, createdAt: "1" };
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("hash"), Buffer.from(nodeId(provisional))],
    program.programId
  );
  const validated = parseArchive({
    ...createArchive(program.programId),
    nodes: { [pda.toBase58()]: provisional },
  }).nodes[pda.toBase58()];
  const { createdAt: _timestamp, ...expected } = validated;
  const signature = await submitInstruction(builder, payer);
  return {
    signature,
    archive: await captureCreatedArchive(program, signature, expected),
  };
}

export async function captureCreatedArchive(
  program: ArchiveProgram,
  signature: string,
  pending: PendingArchiveNode
): Promise<HashArchive> {
  const expected = JSON.parse(JSON.stringify(pending)) as PendingArchiveNode;
  const id = nodeId({ ...expected, createdAt: "1" });
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("hash"), Buffer.from(id)],
    program.programId
  );
  const pda = address.toBase58();
  let status: "submitted" | "confirmed" = "submitted";
  try {
    // Anchor providers may submit at processed commitment. Never capture an older confirmed bank.
    const confirmation = await program.provider.connection.confirmTransaction(
      signature,
      "confirmed"
    );
    if (confirmation.value.err)
      throw new Error(
        `Creation transaction failed: ${JSON.stringify(confirmation.value.err)}`
      );
    status = "confirmed";
    const record = await readArchiveRecord(
      program,
      pda,
      confirmation.context.slot
    );
    if (
      !record ||
      record.hash !== expected.hash ||
      JSON.stringify(record.source) !== JSON.stringify(expected.source)
    )
      throw new Error(
        "Created record is unavailable or differs from submitted inputs"
      );
    return parseArchive({
      ...createArchive(program.programId),
      nodes: { [pda]: { ...expected, createdAt: record.createdAt } },
    });
  } catch (error) {
    throw new ArchiveCaptureError(signature, pda, expected, error, status);
  }
}
