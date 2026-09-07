/** Compile one complete proof into a size-checked instruction and an execution receipt. */
import type { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { HashTimestamp } from "../../../target/types/hash_timestamp";
import type { HashArchive, ArchiveNode } from "../archive/model";
import type { ArchiveRestoreStep } from "../archive/planning";
import { createArchive, parseArchive } from "../archive/codec";
import { buildRestoreProof } from "../archive/proof";
import { prepareRestore } from "../restore";
import { deriveHashPda, deriveVotePda } from "../protocol/addresses";

export interface PreparedArchiveStep {
  instruction: TransactionInstruction;
  archive: HashArchive;
  additional: string[];
}

export interface ArchiveCandidate {
  summary: ArchiveRestoreStep;
  execution: PreparedArchiveStep;
}

export interface CandidateContext {
  targets: string[];
  create: boolean;
  payer: PublicKey;
  feePayer: PublicKey;
  live: Map<string, ArchiveNode | null>;
  readErrors: Map<string, string>;
  matches: (pda: string) => boolean;
}

export async function compileArchiveCandidate(
  program: Program<HashTimestamp>,
  archive: HashArchive,
  context: CandidateContext,
  anchor: string,
  closure: string[],
  selected: string[]
): Promise<ArchiveCandidate> {
  const { create, payer, feePayer, live, readErrors, matches } = context;
  const existing = create ? closure.filter(matches) : [anchor];
  const proof = buildRestoreProof(archive, {
    anchor,
    targets: selected,
    existingAccounts: existing,
  });
  const encoded = prepareRestore(proof, create);
  const requested = encoded.restoredIds.map((id) =>
    deriveHashPda(program.programId, id).toBase58()
  );
  for (const pda of requested) {
    if (readErrors.has(pda)) throw new Error(readErrors.get(pda));
    if (live.get(pda) && !matches(pda))
      throw new Error(`Historical incarnation conflict: ${pda}`);
  }
  const creations = requested.filter((pda) => !matches(pda));
  const additional = creations.filter((pda) => !context.targets.includes(pda));
  const metas = encoded.restoredIds.flatMap((id) => {
    const address = deriveHashPda(program.programId, id);
    // Existing→missing must fail instead of silently funding an unplanned record.
    const writable = creations.includes(address.toBase58());
    return [
      { pubkey: address, isSigner: false, isWritable: writable },
      {
        pubkey: deriveVotePda(program.programId, id, payer),
        isSigner: false,
        isWritable: writable,
      },
    ];
  });
  const instruction = await program.methods
    .restore(encoded.proofEncoded)
    .accountsStrict({
      payer,
      anchorHashAccount: new PublicKey(anchor),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(metas)
    .instruction();
  const transaction = new Transaction({
    feePayer,
    recentBlockhash: PublicKey.default.toBase58(),
  }).add(instruction);
  const transactionBytes = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  const authenticated = createArchive(archive.programId);
  for (const pda of closure) authenticated.nodes[pda] = archive.nodes[pda];
  return {
    summary: {
      anchor,
      targets: selected,
      proof,
      requestedAccounts: requested,
      expectedCreations: creations,
      additionalRequiredCreations: additional,
      transactionBytes,
    },
    execution: {
      instruction,
      archive: parseArchive(authenticated),
      additional: [...additional],
    },
  };
}
