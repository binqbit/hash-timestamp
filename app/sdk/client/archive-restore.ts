import type { Program } from "@coral-xyz/anchor";
import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import type { HashTimestamp } from "../../../target/types/hash_timestamp";
import {
  parseArchive,
  createArchive,
  archivePublicKey,
} from "../archive/codec";
import { dependencyOrder } from "../archive/graph";
import { mergeArchives } from "../archive/operations";
import type { HashArchive, ArchiveNode } from "../archive/model";
import type {
  ArchiveRestoreOptions,
  ArchiveRestorePlan,
  ArchiveRestoreResult,
} from "../archive/planning";
import { readArchiveRecord, sameArchiveRecord } from "./archive";
import {
  compileArchiveCandidate,
  type ArchiveCandidate,
  type PreparedArchiveStep,
} from "./archive-candidate";

type ProgramApi = Program<HashTimestamp>;
interface Execution {
  connection: ProgramApi["provider"]["connection"];
  endpoint: string;
  programId: string;
  payer: string;
  feePayer: string;
  present: HashArchive;
  steps: PreparedArchiveStep[];
}
// Plans are ephemeral capabilities; mutation of the display result cannot change signed effects.
const prepared = new WeakMap<ArchiveRestorePlan, Execution>();

export class ArchiveRestoreExecutionError extends Error {
  readonly name = "ArchiveRestoreExecutionError";
  constructor(
    readonly completed: ArchiveRestoreResult,
    readonly failedStep: number,
    readonly cause: unknown
  ) {
    super(
      `Archive restore stopped at step ${failedStep}; ${
        completed.signatures.length
      } earlier transactions confirmed. ${String(cause)}`
    );
  }
}

/** Read-only planning. Uses independent complete proofs, never arbitrary chunks of one proof. */
export async function planArchiveRestore(
  program: ProgramApi,
  input: HashArchive,
  options: ArchiveRestoreOptions,
  payer: PublicKey,
  feePayer: PublicKey
): Promise<ArchiveRestorePlan> {
  const archive = parseArchive(input);
  if (archive.programId !== program.programId.toBase58())
    throw new Error("Archive belongs to a different program");
  const targets = options.targets.map((pda) => archivePublicKey(pda));
  if (!targets.length || new Set(targets).size !== targets.length)
    throw new Error("Supply nonempty unique restore targets");
  for (const target of targets)
    if (!archive.nodes[target])
      throw new Error(`Unknown restore target: ${target}`);
  const create = options.createAccounts !== false;
  const candidates =
    options.anchor && options.anchor !== "auto"
      ? [archivePublicKey(options.anchor)]
      : Object.keys(archive.nodes).sort();
  const live = new Map<string, ArchiveNode | null>();
  const readErrors = new Map<string, string>();
  const keys = Object.keys(archive.nodes);
  // Bounded fan-out; transport failures remain errors, never classified as absence.
  for (let offset = 0; offset < keys.length; offset += 8) {
    await Promise.all(
      keys.slice(offset, offset + 8).map(async (pda) => {
        try {
          live.set(pda, await readArchiveRecord(program, pda));
        } catch (error) {
          readErrors.set(pda, String(error));
        }
      })
    );
  }
  const matches = (pda: string) =>
    !!live.get(pda) && sameArchiveRecord(live.get(pda)!, archive.nodes[pda]);
  const alreadyPresent = create ? targets.filter(matches) : [];
  const remaining = new Set(
    targets.filter((pda) => !alreadyPresent.includes(pda))
  );
  const plan: ArchiveRestorePlan = {
    programId: archive.programId,
    payer: payer.toBase58(),
    feePayer: feePayer.toBase58(),
    steps: [],
    alreadyPresent,
    rejectedAnchors: [],
  };
  const present = createArchive(archive.programId);
  for (const pda of alreadyPresent) present.nodes[pda] = archive.nodes[pda];
  const execution: Execution = {
    ...plan,
    present: parseArchive(present),
    connection: program.provider.connection,
    endpoint: program.provider.connection.rpcEndpoint,
    steps: [],
  };
  const usable: ArchiveCandidate[] = [];
  const context = {
    targets,
    create,
    payer,
    feePayer,
    live,
    readErrors,
    matches,
  };
  for (const anchor of candidates) {
    try {
      if (readErrors.has(anchor)) throw new Error(readErrors.get(anchor));
      if (!archive.nodes[anchor] || !matches(anchor))
        throw new Error("Anchor is absent or has a different historical state");
      const closure = dependencyOrder(archive, [anchor]);
      const covered = targets.filter((target) => closure.includes(target));
      if (!covered.length) continue;
      // If materializing every selected Hash is too large, try smaller selections.
      // Each attempt still includes the anchor's entire proof closure.
      const selections = [covered];
      while (selections.length) {
        const selected = selections.pop()!;
        try {
          usable.push(
            await compileArchiveCandidate(
              program,
              archive,
              context,
              anchor,
              closure,
              selected
            )
          );
        } catch (error) {
          if (selected.length === 1)
            plan.rejectedAnchors.push({
              anchor,
              reason: `${selected[0]}: ${String(error)}`,
            });
          else {
            const half = Math.ceil(selected.length / 2);
            selections.push(selected.slice(half), selected.slice(0, half));
          }
        }
      }
    } catch (error) {
      plan.rejectedAnchors.push({ anchor, reason: String(error) });
    }
  }
  while (remaining.size) {
    // Deterministic greedy selection; not a claim of globally optimal multi-anchor coverage.
    const ranked = usable
      .filter((candidate) =>
        candidate.summary.targets.some((pda) => remaining.has(pda))
      )
      .sort((a, b) => {
        const coverage = (item: typeof a) =>
          item.summary.targets.filter((pda) => remaining.has(pda)).length;
        return (
          b.summary.targets.filter((pda) => remaining.has(pda)).length -
            a.summary.targets.filter((pda) => remaining.has(pda)).length ||
          a.summary.additionalRequiredCreations.length -
            b.summary.additionalRequiredCreations.length ||
          a.summary.transactionBytes / coverage(a) -
            b.summary.transactionBytes / coverage(b) ||
          a.summary.anchor.localeCompare(b.summary.anchor)
        );
      });
    if (!ranked.length)
      throw new Error(
        `No complete, live, transaction-sized proof for: ${[...remaining].join(
          ", "
        )}. ${plan.rejectedAnchors
          .map((item) => `${item.anchor}: ${item.reason}`)
          .join("; ")}`
      );
    const best = ranked[0];
    plan.steps.push(best.summary);
    execution.steps.push(best.execution);
    for (const target of best.summary.targets) remaining.delete(target);
  }
  prepared.set(plan, execution);
  return plan;
}

/** Only executable plans returned by this SDK are accepted. No automatic transaction retries. */
export async function executeArchiveRestore(
  program: ProgramApi,
  plan: ArchiveRestorePlan,
  payer: Keypair | undefined,
  payerKey: PublicKey,
  feePayer: PublicKey,
  allowAdditionalRecords: boolean
): Promise<ArchiveRestoreResult> {
  const execution = prepared.get(plan);
  if (!execution)
    throw new Error("Unknown restore plan; call planRestore first");
  if (
    execution.connection !== program.provider.connection ||
    execution.endpoint !== program.provider.connection.rpcEndpoint ||
    execution.programId !== program.programId.toBase58() ||
    execution.payer !== payerKey.toBase58() ||
    execution.feePayer !== feePayer.toBase58()
  )
    throw new Error(
      "Restore plan connection, program or signer changed; replan before signing"
    );
  if (
    !allowAdditionalRecords &&
    execution.steps.some((step) => step.additional.length)
  )
    throw new Error(
      "Restore requires additional records; inspect the plan and explicitly allowAdditionalRecords"
    );
  if (!program.provider.sendAndConfirm)
    throw new Error("Provider must implement sendAndConfirm");
  const result: ArchiveRestoreResult = {
    signatures: [],
    archive: parseArchive(execution.present),
  };
  for (const [index, step] of execution.steps.entries()) {
    try {
      const tx = new Transaction().add(step.instruction);
      tx.feePayer = feePayer;
      const signature = await program.provider.sendAndConfirm(
        tx,
        payer ? [payer] : [],
        { commitment: "confirmed", preflightCommitment: "confirmed" }
      );
      result.signatures.push(signature);
      result.archive = mergeArchives(result.archive, step.archive);
    } catch (error) {
      throw new ArchiveRestoreExecutionError(result, index, error);
    }
  }
  return result;
}
