/** Portable v1 data only: no RPC objects, votes, bumps or application metadata. */
export const ARCHIVE_FORMAT = "hash-timestamp-archive" as const;
export const ARCHIVE_VERSION = 1 as const;

export type ArchiveSource =
  | { kind: "hash" }
  | { kind: "account"; account: string }
  | {
      kind: "branch";
      previousHashId: string;
      payload: string;
      generation: string;
    }
  | { kind: "batch"; members: string[] }
  | { kind: "pack" };

export interface ArchiveSnapshot {
  owner: string;
  lamports: string;
  executable: boolean;
  rentEpoch: string;
  data: number[];
}

export interface ArchiveNode {
  hash: string;
  source: ArchiveSource;
  createdAt: string;
  /** Ordered PDA references, only for Pack. Omission means membership is unknown. */
  members?: string[];
  /** Original target snapshot, only for Account. */
  snapshot?: ArchiveSnapshot;
}

export interface HashArchive {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  programId: string;
  /** One historical incarnation per PDA. Dependencies may be in another archive. */
  nodes: Record<string, ArchiveNode>;
}
