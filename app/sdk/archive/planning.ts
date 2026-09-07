import type { RestoreProofInput } from "../types";
import type { HashArchive } from "./model";

export interface ArchiveRestoreOptions {
  /** Target PDA addresses, not raw hashes or canonical IDs. */
  targets: string[];
  anchor?: string | "auto";
  createAccounts?: boolean;
}

export interface ArchiveRestoreStep {
  anchor: string;
  targets: string[];
  proof: RestoreProofInput[];
  /** Non-anchor records supplied for materialization/validation. */
  requestedAccounts: string[];
  /** Records absent at planning time; includes any mandatory intermediate records. */
  expectedCreations: string[];
  additionalRequiredCreations: string[];
  transactionBytes: number;
}

export interface ArchiveRestorePlan {
  programId: string;
  payer: string;
  feePayer: string;
  steps: ArchiveRestoreStep[];
  alreadyPresent: string[];
  rejectedAnchors: { anchor: string; reason: string }[];
}

export interface ArchiveRestoreResult {
  signatures: string[];
  /** Records authenticated by the completed steps, not a claim that every one was newly created. */
  archive: HashArchive;
}
