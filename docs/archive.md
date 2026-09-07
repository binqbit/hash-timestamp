# Hash Timestamp archives

An archive is a portable JSON graph of historical Hash Timestamp records. The
SDK creates, validates, merges and selects its nodes, then compiles the relevant
graph into the contract's existing Restore instruction. No new instruction or
account layout is introduced.

See the complete, executable-format [JSON example](../examples/archive.json) and
the type-checked [usage examples](../examples/archive-usage.ts). The JSON example
contains Hash, Account, two Branch levels, Pack and a Batch containing Branch/Pack.
Its addresses and commitments are deterministic fixtures, not live-chain evidence.

## Version 1 shape

```json
{
  "format": "hash-timestamp-archive",
  "version": 1,
  "programId": "<program public key>",
  "nodes": {
    "<hash account PDA>": {
      "hash": "<32-byte lowercase hex>",
      "source": { "kind": "hash" },
      "createdAt": "1720000000"
    }
  }
}
```

The placeholders above explain the shape; use the linked full example for valid
values. Each node key is its actual PDA, derived from `programId` and the canonical
ID of its stored `hash`/source kind. The node does not repeat its PDA or canonical ID.

| Source  | `source` fields                                             | Additional node fields used for restoration                  |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Hash    | `kind: "hash"`                                              | None; the stored 32-byte hash is an accepted Restore payload |
| Account | `kind: "account"`, `account` (target public key)            | Optional `snapshot`                                          |
| Branch  | `kind: "branch"`, `previousHashId`, `payload`, `generation` | None; the parent is another node                             |
| Batch   | `kind: "batch"`, `members` (ordered canonical IDs)          | None; each member is another node                            |
| Pack    | `kind: "pack"`                                              | Optional `members` (ordered **PDA addresses**)               |

Account `snapshot` contains exactly `owner`, `lamports`, `executable`, `rentEpoch`
and `data`. Owner/target are base58 public keys, data is an array of integer bytes,
and executable is a boolean. This is the original committed target snapshot, not
a later RPC snapshot or the HashAccount's own lamports/data.

- Normalized hashes and canonical IDs are 64-character lowercase hexadecimal
  without `0x`; public keys and PDA node keys/references are Base58. Parsing accepts
  either encoding for these 32-byte strings (including uppercase hex), then
  normalizes by field type before validation, merging and export. Duplicate node
  keys or members remain invalid even when written in different encodings.
  PDA selectors and restore targets also accept either encoding.
- `createdAt` is a nonzero signed i64 decimal **string**. `generation`, snapshot
  `lamports` and `rentEpoch` are unsigned u64 decimal strings. Branch generation
  must be positive. No numeric rounding, leading zeros or clamping is accepted.
- Member lists are nonempty, unique and ordered. Sorting them changes identity.
- No filenames, metadata, network identity, votes, bumps or separate `proofs`
  collection are stored. Fingerprints are reconstructed from dependency nodes.
- Unknown fields, variants, format versions and duplicate JSON keys are rejected.

The file binds a program address, **not a cluster**. The application selects the
connection and checks live anchors there. A well-formed JSON file alone is not an
on-chain existence proof or a guarantee of a file's original creation time; see
the [protocol guarantees](instructions.md#core-primitives-and-invariants).

## Partial archives and merging

A single operation returns one node. Branch/Batch/Pack receipts therefore normally
refer to nodes absent from that receipt. This is valid partial history; missing
records, Pack membership or Account snapshots are never guessed from current state.

```ts
import {
  parseArchive,
  stringifyArchive,
  mergeArchives,
  inspectArchive,
} from "./app/sdk/hashTimestamp";

const history = mergeArchives(
  parseArchive(firstJson),
  parseArchive(secondJson)
);
const report = inspectArchive(history);
// report.complete, report.missingNodes, report.missingWitnesses
const updatedJson = stringifyArchive(history);
```

Merge is immutable and idempotent. Matching nodes may gain a missing Pack member
list or Account snapshot. Different programs, historical timestamps, sources or
provided witnesses cause an error, never last-write-wins replacement. Completing
a previously partial graph also validates its newly available commitments.

One PDA has one historical incarnation per archive. If an account was closed and
recreated with another timestamp, keep the histories in separate archives.

`parseArchive` validates schema, PDA derivation, cycles and commitments whose
inputs are present. `inspectArchive().complete` means all graph data and witnesses
are available; it does **not** mean an anchor is live or a transaction will fit.
An archive missing an Account snapshot can still be usable when that exact Account
is supplied live to Restore, as described below.

## Pure APIs (no RPC or file writes)

| Function                                                             | Purpose                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `createArchive(programId)`                                           | Create an empty versioned archive                              |
| `parseArchive(jsonOrObject)`                                         | Strict validation and a detached result                        |
| `stringifyArchive(archive)`                                          | Validate and serialize with stable node-key order              |
| `inspectArchive(archive)`                                            | Report missing nodes and witnesses                             |
| `mergeArchives(first, ...others)`                                    | Combine compatible histories without mutation                  |
| `addArchiveNode(archive, pda, node)`                                 | Add/enrich a node using the same merge rules                   |
| `selectArchive(archive, pdas, includeDependencies = true)`           | Extract nodes, normally with their complete dependency closure |
| `archiveFromProof(programId, proof)`                                 | Import the existing SDK `RestoreProofInput[]` representation   |
| `buildRestoreProof(archive, { anchor, targets, existingAccounts? })` | Compile a complete proof from PDA selections                   |

`selectArchive(..., false)` exports only the requested nodes, allowing a partial
result. Legacy proof import requires nodes for supplied parent/member fingerprints
and rejects contradictory relationships, timestamps, generations and payloads.
It does not preserve redundant fingerprints or original file bytes.

`buildRestoreProof` puts the anchor first, deduplicates shared dependencies and
excludes unrelated nodes. It does not check RPC state. `existingAccounts` is an
advanced declaration of accounts that will actually be supplied live to the
instruction, **not** permission to skip proof dependencies; the anchor is always
treated as existing. Prefer the client planner for normal use.

Imports are limited to 10,000 nodes and 16 MiB of UTF-8 JSON. Object inputs also
must fit 16 MiB in normalized compact JSON. Export normally uses readable
indentation, falling back to compact JSON when whitespace would exceed that limit.
These limits are separate from the much smaller transaction limit. The SDK does
not read or write files automatically; persistence remains the application's job.

## Creation receipts

```ts
const { signature, archive } = await client.register(fileHash);
const next = await client.branch(parentId, newFileHash, false);
const history = mergeArchives(archive, next.archive);
// Persist stringifyArchive(history) before withdrawing votes.
```

`register` and `branch` now return `{ signature, archive }`, not a signature string.
Batch/Pack/Account results also contain `archive` while retaining their existing
`batchId`, `packId`, `hashId` and `metadataHash` fields. Each successful creation
archive contains **exactly the new node**, including the input Pack membership or
Account snapshot when applicable. Other records must be merged separately.
Vote/unvote/verify and the low-level `restore` return shapes are unchanged.

Known archive inputs are validated before submission. After submission, capture
confirms the signature at `confirmed`, then reads the HashAccount with that
confirmation's `minContextSlot`. `createdAt` comes from the account, never the
client clock or an estimated block time.

Once submission has returned a signature, failures in the additional confirmation
or capture phase throw `ArchiveCaptureError`, retaining
`signature`, `pda`, `pendingNode`, `status` (`submitted` or `confirmed`) and `cause`.
Check the transaction status before any retry; do not blindly repeat creation.
The pending node intentionally has no invented timestamp.
Errors thrown by the original provider submission still propagate as-is; if that
provider timed out before returning a signature, check the wallet/provider receipt.

```ts
import { ArchiveCaptureError } from "./app/sdk/hashTimestamp";

try {
  const receipt = await client.register(fileHash);
  persist(receipt.signature, stringifyArchive(receipt.archive)); // application code
} catch (error) {
  if (error instanceof ArchiveCaptureError) {
    retainSubmission(error.signature, error.pda, error.pendingNode); // application code
  }
  throw error;
}
```

Keep the initial vote until capture and persistence complete. A minimum RPC slot
prevents stale-bank capture, but does not make a later RPC read an immutable
transaction receipt: a concurrent withdrawal by the same signer can close and
recreate the PDA. Coordinate lifecycle operations in the application.

## Plan, review, execute

```ts
const archive = parseArchive(savedJson);
const plan = await client.planRestore(archive, {
  targets: [targetPda], // PDA addresses, not canonical IDs
  anchor: "auto", // optional; an explicit anchor PDA is also accepted
});

// Read-only planning does not prompt a wallet or send transactions.
for (const step of plan.steps) {
  console.log(
    step.anchor,
    step.expectedCreations,
    step.additionalRequiredCreations,
    step.transactionBytes
  );
}

// Default refuses any additional, unrequested record creations.
const result = await client.executeRestorePlan(plan);
// After reviewing and accepting additionalRequiredCreations, explicitly use:
// await client.executeRestorePlan(plan, { allowAdditionalRecords: true });
```

The planner reads current records, checks ownership/PDA/bump and exact historical
state, and chooses live anchors from the supplied archive. It never treats an RPC
error or incompatible occupied account as a missing account. Requested records
already matching on-chain are listed in `alreadyPresent`; no new vote is added.

Each anchor needs its **entire** dependency closure, including every nested
Batch/Pack member and their ancestors. Existing derived records do not truncate
that closure. Only unselected raw Hash leaves can have null parameters. When
materializing, the contract requires pairs for every non-anchor parametric record;
missing derived intermediates or Account members may therefore be additional
mandatory creations. The plan exposes these and execution requires explicit consent.

Exact existing pairs are read-only. If one disappears before execution, the
transaction fails instead of unexpectedly funding its replacement. If a planned
missing record becomes an exact matching live record, fewer creations may occur.
An incompatible historical incarnation still fails on-chain. Plans are not locks.

Selection is deterministic and greedy: cover remaining targets, then prefer fewer
additional creations and smaller serialized transactions. It is not a global
minimum-rent or minimum-transaction optimizer. Oversized selections are subdivided
into target subsets using **complete proofs** from the same anchor; independent
anchors may also require separate steps. A single complete proof that cannot fit
the legacy 1232-byte transaction limit is rejected, not arbitrarily chopped up.
Size checks include signatures, account metas and a possibly distinct fee payer.

`executeRestorePlan` only accepts the original in-memory plan created by this SDK,
on the same connection/program and with the same signer/fee payer. Editing its
display fields does not edit signed instructions or bypass extra-creation consent.
After changing connections or reloading JSON, call `planRestore` again.

Steps execute sequentially at `confirmed`; the whole plan is **not atomic** across
transactions. `ArchiveRestoreExecutionError.completed` preserves successful earlier
signatures and authenticated nodes; `failedStep` is zero-based and `cause` is
retained. The failing submission can have uncertain status. Resolve it and replan
from live state instead of automatically replaying the original plan.

The result is `{ signatures, archive }`. Its archive contains authenticated proof
nodes and already-present targets, not a claim that every returned node was newly
created. It excludes unrelated input history; the caller may merge it into storage.

For a one-call workflow, `client.restoreArchive(archive, options, payer?)` plans and
executes with the same defaults. For on-chain proof validation without creating
ancestors, set `createAccounts: false`; this still signs a transaction. Non-anchor
Accounts then need snapshots even if they currently exist, because no account pairs
are supplied. The pure graph compiler and [low-level Restore API](sdk.md#restore-anchored-history-with-or-without-materialization)
remain available for custom workflows.
