# SDK Guide

The TypeScript SDK derives the contract's IDs and PDAs, reads accounts, and submits
its instructions. Start from `app/sdk/hashTimestamp.ts`; `hashUtils.ts` remains a
compatible utility-only import path. This repository does not declare a published
SDK package.

## First call: register a file and read its record

Use the repository's pinned dependencies (`yarn install --frozen-lockfile`).
Run `yarn build` if `target/idl/hash_timestamp.json` and
`target/types/hash_timestamp.ts` are missing or stale. Your application supplies a
`Program<HashTimestamp>` with the matching IDL, deployed program address, cluster
connection and funded signing provider.

This is a Node.js example; the SDK uses Node `crypto` and `Buffer`.
Browser bundling is not established.

```ts
import { createHash } from "crypto";
import type { Program } from "@coral-xyz/anchor";
import type { HashTimestamp } from "./target/types/hash_timestamp";
import {
  HashTimestampClient,
  deriveGenesisHashId,
  decodeHashSource,
} from "./app/sdk/hashTimestamp";

export async function timestampFile(
  program: Program<HashTimestamp>,
  fileBytes: Uint8Array
) {
  const client = new HashTimestampClient(program);
  const fileHash = createHash("sha256").update(fileBytes).digest();
  const hashId = deriveGenesisHashId(fileHash);

  const { signature, archive } = await client.register(fileHash);
  const record = await client.fetchHashAccount(hashId);
  if (!record) throw new Error("Hash record was not found");

  return {
    signature,
    archive,
    hashId,
    address: client.hashPda(hashId),
    createdAt: record.createdAt.toString(),
    source: decodeHashSource(record.source),
  };
}
```

Import paths above assume a file at the repository root. The complete,
type-checked [examples/sdk-usage.ts](../examples/sdk-usage.ts) also provides
`createClient(idl, provider)`, `registerFile` and `branchFromFile`.
Importing the examples alone does not send any transactions.

Registration already creates the caller's vote. Do not immediately call `vote`
again with the same signer. `unvote` is a state-changing operation: removing
the final vote closes the hash record.

## Raw hash, canonical ID and PDA are different values

| Value        | Meaning                                                     | Example                         |
| ------------ | ----------------------------------------------------------- | ------------------------------- |
| Raw hash     | 32-byte digest or value registered by the caller            | `client.register(fileHash)`     |
| Canonical ID | Hash plus source discriminator, committed into a new digest | `deriveGenesisHashId(fileHash)` |
| PDA          | Solana account address derived from the ID and program      | `client.hashPda(hashId)`        |

`hashPda`, `fetchHashAccount`, `vote`, `unvote`, `verify`, the parent of
`branch`, and Batch/Pack members take **canonical IDs**, not raw file hashes.
`RestoreProofInput.hash`, by contrast, is the stored raw hash of that proof link.
Use the derivation helpers; do not construct these identities by hand.

Timestamp and lifecycle semantics are defined in the
[protocol invariants](instructions.md#core-primitives-and-invariants).

## Public methods

Except for `verify`, transaction methods accept an optional instruction payer
`Keypair`; omission uses the provider wallet. All results below are promises,
except the PDA methods.

| Method                                               | Work                                 | Result                                         |
| ---------------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| `hashPda(hashId)`, `votePda(hashId, voter)`          | Local derivation only                | `PublicKey`                                    |
| `fetchHashAccount(hashId)`                           | RPC read                             | `HashAccountData \| null`                      |
| `fetchVoteInfo(hashId, voter)`                       | RPC read                             | `VoteInfoData \| null`                         |
| `register(hash, payer?)`                             | Transaction + archive capture        | `{ signature, archive }`                       |
| `vote(hashId, payer?)`                               | Transaction                          | Signature string                               |
| `unvote(hashId, payer?)`                             | Transaction                          | Signature string                               |
| `verify(hashId)`                                     | Transaction, not a local check       | Signature string                               |
| `branch(parentId, payload, takeVote = true, payer?)` | Parent read + transaction + capture  | `{ signature, archive }`                       |
| `batch(memberIds, payer?)`                           | Member reads + transaction + capture | `{ signature, batchId, archive }`              |
| `pack(memberIds, payer?)`                            | Member reads + transaction + capture | `{ signature, packId, archive }`               |
| `hashAccount(targetPublicKey, payer?)`               | Target read + transaction + capture  | `{ signature, hashId, metadataHash, archive }` |
| `restore(proof, optionsOrPayer?, payer?)`            | Transaction                          | `RestoreResult: { signature, restoredIds }`    |
| `planRestore(archive, options, payer?)`              | Read-only RPC preflight              | `ArchiveRestorePlan`                           |
| `executeRestorePlan(plan, options?, payer?)`         | Execute prepared transactions        | `{ signatures, archive }`                      |
| `restoreArchive(archive, options, payer?)`           | Plan and execute                     | `{ signatures, archive }`                      |

Each creation archive contains exactly one new node. The [archive guide](archive.md)
defines its versioned JSON format, immutable merge APIs, target selection and
receipt-aware errors. `register`/`branch` callers must now destructure `signature`.

Fetch methods return **raw Anchor account data**: integer fields such as
`createdAt`, `voters` and vote `amount` remain `BN`; `source` remains the
IDL enum. Use `decodeHashSource(record.source)` for the SDK's tagged source
union. Prefer `.toString()` or `BigInt(value.toString())` over `.toNumber()`
for potentially large integers.

For ordinary existence reads, use `fetchHashAccount`. Both `verify` and
proof-only `restore` submit on-chain transactions, pay fees and return signatures;
neither returns a boolean or guarantees that state will remain unchanged.

## Signing, rent and fees

```ts
await client.register(fileHash); // provider wallet is the instruction signer
await client.register(otherFileHash, keypair); // explicit instruction signer
```

An explicit `payer` selects the instruction signer/rent payer and is passed to
Anchor's `.signers([payer])`. It does not replace the configured provider wallet.
With the normal Anchor provider, the provider wallet still pays transaction fees.
Fund both roles as appropriate. Submission uses the supplied provider. Creation
receipt capture additionally confirms at `confirmed`; archive-plan execution
requests `confirmed` from the provider. Other methods retain provider policy.
The SDK does not automatically retry submitted transactions.

`rentExemptForHash(connection, source)` and `rentExemptForVote(connection)`
estimate account rent through that connection. They are not total transaction
cost estimates. Do not assume a cached rent amount remains valid.

## Branches and aggregates

`branch(parentId, payload)` takes a 32-byte payload. Its default `takeVote=true`
creates the child vote and releases the caller's parent vote afterward. Fund the
child accounts upfront; the old-vote refund happens later.

Use `branch(parentId, payload, false)` to leave parent support unchanged.
This mode does not require an existing parent vote. The
[branchFromFile example](../examples/sdk-usage.ts) saves a restoration proof
for a raw Hash parent without withdrawing either vote.

```ts
const { signature, batchId } = await client.batch([firstId, secondId]);
const { packId } = await client.pack([firstId, secondId]);
```

Aggregate inputs must be nonempty, unique canonical IDs in the intended order.
Branch, aggregate and account-metadata calls read state before submission; if it
changes, re-read and re-derive affected inputs. See
[application state handling](api.md#coordinate-transactions-and-reads).

## Restore: anchored history, with or without materialization

Pass a complete `RestoreProofInput[]` with the live anchor at index zero.
Other proof entries may be in any order; Batch/Pack member order must remain exact.

```ts
const { signature, restoredIds } = await client.restore(proof);
await client.restore(proof, payer);
await client.restore(proof, { createAccounts: false }, payer);
```

- `createAccounts` defaults to true and requests every non-anchor entry with
  non-null `params`. This is not arbitrary-target selection.
- `createAccounts: false` submits proof validation without ancestor account
  pairs. It still sends a transaction and must satisfy the full proof rules,
  including required Account snapshots.
- `restoredIds` lists requested canonical IDs, not only newly created accounts.
  It is empty in proof-only mode.
- `RestoreApi` is a compatibility wrapper around `client.restore`.
  An optional instruction payer can be supplied as the second argument, or
  as the third argument after options.

This low-level method takes caller-prepared history and does not split proofs.
For selection from a JSON archive and transaction-sized planning, use
[archive restoration](archive.md#plan-review-execute). It also requires retained
history; it does not recover missing off-chain information from an RPC node.
See the [restore reference](instructions.md#restore)
for parameter variants, existing-record conflicts, nested aggregates and
[recovery limits](instructions.md#recovery-limits).

## Inputs, encoders and errors

- Fixed32 hash/ID strings accept **64 hexadecimal characters without `0x`**
  (either case) or **Base58** decoding to exactly 32 bytes. Both represent the
  same bytes and produce identical commitments and addresses. General byte
  payload strings (`toBytes`, Restore Hash `params.payload`)
  remain **hex-only**, with arbitrary lengths; byte arrays also work. Malformed hex,
  incomplete byte pairs, sparse arrays and non-integer/out-of-range bytes are
  rejected rather than silently truncated or wrapped.
- Account-source identities accept `PublicKey`, bytes, hex and base58.
  Prefer `PublicKey` for account identities. Archive parsing/export normalizes
  hashes and canonical IDs to lowercase hex, and public keys/PDAs to Base58.
- Use `bigint` or `BN` for exact large integers. Timestamps must fit signed
  i64 and generations unsigned u64. JavaScript numbers already rounded before
  reaching the SDK cannot be recovered.
- Snapshot lamports/rentEpoch retain the existing clamping into u64 range;
  generation and timestamp validation is strict, not clamping.
- Unknown numeric source tags, fractional tags, `NaN` and infinity are rejected.
  `decodeHashSource` retains legacy field aliases and its tolerant fallback
  for unknown variants; it is not a security validator for untrusted input.

Public wire adapters are `decodeHashSource`, `encodeHashSource` and
`encodeRestoreParameters`. Their encoded types come from the generated IDL.
Low-level wire preparation (`prepareRestore`) and fingerprint encoding are
internal. The archive's `buildRestoreProof` compiler is public. Other public
helpers derive hashes/IDs/PDAs and account sizes.
Use `client.program` for lower-level Anchor builders or custom account sets.

Client prechecks throw ordinary errors, for example
`old hash account not found`, `target account not found`, and
`batch member IDs must be unique`. RPC transport/decode errors are distinct
from program errors. Modern `fetchNullable` errors propagate; the retained
legacy fallback catches any `fetch` error and returns null. If you supply an
older/custom reader, that fallback cannot distinguish absence from an RPC failure.

```ts
import { AnchorError } from "@coral-xyz/anchor";

try {
  await client.restore(proof);
} catch (caught) {
  if (caught instanceof AnchorError) {
    console.error(caught.error.errorCode.number, caught.error.errorCode.code);
  }
  throw caught; // preserve transport, SDK and program error details
}
```

Map actual program codes using the [instruction guide](instructions.md).
Missing typed accounts may fail Anchor initialization before a handler's
`HashNotFound` check. A Restore error can mean a malformed proof, conflicting
current state, or invalid account setup; it does not always mean false history.

For module responsibilities, see [Architecture](architecture.md#repository-map).
For validation commands and test setup, see [Testing](testing.md).
