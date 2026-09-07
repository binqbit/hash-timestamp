# Instruction Guide

This file is the canonical reference for public program instruction behavior.
The implementation is authoritative; each instruction below links to its handler.
SDK method arguments and return values are documented separately in [sdk.md](sdk.md).

## Core primitives and invariants

- Hash accounts use PDA seeds: `"hash" + canonical_id`.
- Vote accounts use PDA seeds: `"vote" + voter_pubkey + hash_id`.
- Canonical hash identifier is computed by `sha256(hash_bytes || source_discriminator)`.
- Source tags are `Hash=0`, `Account=1`, `Branch=2`, `Batch=3`, and `Pack=4`.
- New records take `created_at` from the chain clock. Restored records retain the
  validated historical timestamp committed by their proof; restore transaction
  time is not substituted.
- The timestamp describes a protocol record, not filesystem creation time or
  authorship. `register` accepts any 32-byte value; it does not read a file or
  prove possession of its contents.
- Canonical IDs and PDA seeds do not separately include `created_at`. After the
  final vote closes a record, normal creation can reuse its ID/PDA with a new
  timestamp. Restore preserves a proven historical incarnation, not a permanent
  global "first ever" timestamp for that address.
- A live hash must be program-owned, deserialize correctly, have nonzero
  `created_at` and positive `voters`, and match its derived PDA and stored bump.
- Votes are refundable economic witnesses, not file ownership or authorship.
  No original-author signature is required to restore a valid history.
- The protocol supports two aggregate modes:
  - `batch`: stores the ordered member IDs in `HashSource::Batch`.
  - `pack`: stores only `HashSource::Pack`; its digest commits to the ordered
    fingerprints, which must be supplied externally for recovery.

## Errors

Program errors are defined in [error.rs](../programs/hash-timestamp/src/error.rs).
Typed-account loading can fail before a handler runs; Anchor and System Program
errors are separate from the program's enum. The cases below are not exhaustive.
Failed transactions roll back account effects, but execution fees remain charged.

## register

Implementation: [register.rs](../programs/hash-timestamp/src/instructions/register.rs).

Creates a live record from a raw 32-byte value and the caller's first vote.
An occupied record cannot be overwritten; normal creation after closure uses
a new chain timestamp.

- Inputs
  - `hash` (`[u8; 32]`).
- Required accounts
  - `hash_account`: writable hash account PDA for the canonical ID.
  - `vote_info`: writable vote PDA for the caller.
  - `user`: writable payer and instruction signer.
  - `system_program`.
- Behavior
  - `source = HashSource::Hash`.
  - Derives hash PDA from canonical ID and checks it matches `hash_account`.
  - Creates hash account with `created_at = Clock::get()?.unix_timestamp`, `voters = 1`.
  - Creates the vote account with `amount = hash_rent`, where `hash_rent` is the
    full required rent-exempt reserve for the allocated hash size. This amount
    is unchanged by any lamports already present on a valid prefunded hash PDA;
    prefunding only reduces the payer's top-up.
  - Accepts either unused zero-lamport destinations or pre-funded PDA placeholders that are empty, non-executable System Program accounts.
  - Tops an accepted placeholder up to rent, then allocates and assigns it with PDA signer seeds.
- Postconditions
  - Hash and vote accounts exist and are owned by the program.
  - Caller becomes the first voter.
- Failure cases
  - Existing program-owned hash account (`HashAlreadyExists`).
  - Existing program-owned vote account (`AlreadyVoted`).
  - Destination with invalid owner, data, or executable flag (`InvalidPdaPlaceholder`).
  - PDA mismatch (`InvalidHashSeeds`).
  - Insufficient lamports for rent funding.

## account

Implementation: [account.rs](../programs/hash-timestamp/src/instructions/account.rs)
and [metadata digest](../programs/hash-timestamp/src/protocol/hash/metadata.rs).

Commits to a target Solana account's metadata and creates the caller's first
vote. The record stores the digest and target key, not the snapshot bytes.

- Inputs
  - No serialized instruction arguments; metadata is read from `target`.
- Required accounts
  - `hash_account`: writable hash account PDA for metadata hash ID.
  - `vote_info`: writable vote PDA for the payer.
  - `target`: target account to hash (read-only).
  - `payer`: writable signer.
  - `system_program`.
- Behavior
  - Reads `target` metadata: pubkey, owner, lamports, executable flag, rent epoch, and raw data.
  - Hashes those fields in that order; integers use little-endian encoding.
    This read happens before timestamping or funding effects.
  - Creates hash account and caller vote account using the same creation flow as `register`.
  - Stores the digest and `HashSource::Account { account: target_pubkey }`, not
    the full snapshot. The caller must retain snapshot data for future recovery.
  - Does not require `target` to be owned by this program, sign, or pass a
    program-level liveness check.
- Postconditions
  - Hash record is initialized from target snapshot.
  - Caller is registered as one voter.
- Failure cases
  - Existing program-owned hash account (`HashAlreadyExists`).
  - Existing program-owned vote account (`AlreadyVoted`).
  - Invalid PDA placeholder (`InvalidPdaPlaceholder`), regardless of its balance.
  - Derived hash PDA mismatch (`InvalidHashSeeds`).
  - Runtime account-data borrowing/serialization errors.

## vote

Implementation: [vote.rs](../programs/hash-timestamp/src/instructions/vote.rs)
and [vote funding](../programs/hash-timestamp/src/runtime/vote_record.rs).

Adds one economic witness to an existing hash. The caller funds a refundable
hash-rent claim and a separate vote account; there is no protocol exit penalty.

- Inputs
  - none (hash account identity is from `hash_account`).
- Required accounts
  - `hash_account`: writable existing hash account.
  - `vote_info`: writable vote account PDA for caller.
  - `user`: writable signer and payer.
  - `system_program`.
- Behavior
  - Validates the live hash's initialization, owner, PDA and bump.
  - Computes the current rent minimum from the hash account's actual allocated
    data length.
  - Derives expected vote PDA for this hash ID and caller.
  - Creates vote account and transfers the same hash-rent amount to hash account.
  - Increments `voters`.
- Postconditions
  - Caller has valid `vote_info` account with `amount = hash_rent`.
  - `voters` increases by one.
- Failure cases
  - `HashNotFound` if hash account is uninitialized.
  - `AlreadyVoted` if the vote PDA is already program-owned.
  - `InvalidPdaPlaceholder` if the vote destination is not an empty, non-executable System Program account.
  - `InvalidHashSeeds` if vote account key is not derived for caller + hash ID.

## unvote

Implementation: [unvote.rs](../programs/hash-timestamp/src/instructions/unvote.rs)
and [ValidatedVote::release](../programs/hash-timestamp/src/runtime/vote_record.rs).

Removes the caller's vote and refunds its balances. Removing the final vote
also closes the hash account.

- Inputs
  - none (`hash_account` is the identity).
- Required accounts
  - `hash_account`: writable hash account.
  - `vote_info`: writable caller vote account.
  - `user`: writable signer and refund recipient.
  - `system_program`.
- Behavior
  - Validates hash account is initialized and hash ID matches vote account.
  - Requires vote belongs to `user`.
  - Determines whether this is the last vote. For a non-last vote, checks that
    refunding the recorded claim will leave the hash at or above the current
    rent-exempt minimum for its actual allocated data length.
  - Decrements `voters`, then closes the vote account and returns its entire
    balance to the caller, including any excess funding.
  - If it was the last vote, closes the hash account and returns all remaining
    lamports, including surplus; otherwise returns the vote's recorded claim
    from the hash account to the caller.
- Postconditions
  - Caller vote account is closed.
  - Hash is kept or closed depending on remaining voter count.
- Failure cases
  - `HashNotFound` if target hash account is uninitialized.
  - `NotVoter` if vote belongs to another wallet.
  - `InvalidHashSeeds` for wrong derived account.
  - Solana `AccountNotRentExempt` if a non-last refund would underfund the live
    hash; hash/vote state and balances remain unchanged, apart from separate
    transaction fees charged to the fee payer.
  - Solana `InsufficientFunds` if the recorded refund exceeds the hash balance.
  - Anchor account-loading errors if hash is already fully closed.

## branch

Implementation: [branch.rs](../programs/hash-timestamp/src/instructions/branch.rs),
[digest derivation](../programs/hash-timestamp/src/protocol/hash/branch.rs), and
[vote migration validation](../programs/hash-timestamp/src/runtime/vote_migration.rs).

Creates a child hash that commits to its parent's history and a new payload,
with optional withdrawal of the caller's parent vote.

- Inputs
  - `payload` (`[u8; 32]`).
  - `take_vote` (`bool`).
- Required accounts
  - `hash_account`: writable parent hash.
  - `vote_info`: writable caller vote PDA for the parent hash. With
    `take_vote = false`, it may be vacant when no vote exists; the SDK always
    supplies this derived PDA.
  - `new_hash_account`: writable PDA for child hash.
  - `new_vote_info`: writable PDA for child vote.
  - `user`: writable signer and payer.
  - `system_program`.
- Behavior
  - Snapshots parent hash.
  - Derives the child digest from parent canonical ID, parent source kind,
    parent creation time, parent generation, and payload. The child canonical
    ID additionally commits to the Branch source discriminator.
  - Checks generation overflow and validates the parent vote/migration policy
    before creating the child.
  - Creates the child hash with the current chain timestamp and its initial vote.
    The child must be funded first: a later refund of the old vote is not used
    directly to finance this creation.
  - If `take_vote = true`:
    - `vote_info` must be exact parent vote PDA for caller.
    - Requires account owned by program and matching voter/hash.
    - Closes/refunds the caller's parent vote after creating the child.
  - If `take_vote = false`, an existing derived `vote_info` must still match the
    caller and parent. A derived no-vote placeholder must be vacant. No old vote
    is migrated in this mode, and the caller need not already support the parent.
- Postconditions
  - Child hash exists with parent `generation + 1` in source. Non-Branch parents
    have generation zero, so their first branch has generation one.
  - Caller has vote on child hash.
  - Parent may close if caller was only voter and vote migrated.
- Failure cases
  - `HashNotFound` if parent hash account is uninitialized.
  - `VoteAccountMissing` when the old-vote key does not satisfy the migration policy.
  - `NoVoteToMigrate` when vote key is correct but ownership is not program-owned.
  - `NotVoter` when provided old vote does not belong to caller.
  - `InvalidHashSeeds` for wrong parent/child PDAs.
  - `GenerationOverflow` if generation counter overflows.
  - Child hash/vote creation and parent refund can also return the shared
    lifecycle errors, including insufficient upfront funding or refund reserve.

## batch

Implementation: [batch.rs](../programs/hash-timestamp/src/instructions/batch.rs),
[member loading](../programs/hash-timestamp/src/runtime/aggregate.rs), and
[composition](../programs/hash-timestamp/src/protocol/hash/compose.rs).

Creates an ordered aggregate of existing records and stores their canonical
IDs. A live batch can anchor recovery when the required proof is retained.

- Inputs
  - No serialized instruction arguments. Member IDs are derived from remaining
    accounts and must be unique; their order affects the aggregate identity.
- Required accounts
  - `hash_account`: writable new batch hash PDA.
  - `vote_info`: writable payer vote PDA for new batch hash.
  - `payer`: writable signer.
  - `system_program`.
  - Remaining accounts: member hash accounts (readable PDAs).
- Behavior
  - Validates each remaining hash account:
    - owned by program,
    - PDA and stored bump match the hash identity,
    - initialized (`created_at != 0` and `voters > 0`),
    - canonical ID is not repeated in the same batch.
  - Builds fingerprint for each member (`hash`, `source_kind`, `created_at`).
  - Derives the digest from ordered `(hash, source_kind, created_at)`
    fingerprints and stores the ordered member IDs in `HashSource::Batch`.
  - Creates batch hash and child vote.
- Postconditions
  - Batch hash exists with deterministic member list and voter count `1`.
- Failure cases
  - `BatchMembersEmpty` if no members passed.
  - `BatchMemberWrongProgram` if a member is not owned by this program.
  - `BatchMemberDuplicate` if the same canonical member ID appears more than once.
  - `HashNotFound` for uninitialized members.
  - `HashAlreadyExists` / `InvalidHashSeeds` for bad hashes.

## pack

Implementation: [pack.rs](../programs/hash-timestamp/src/instructions/pack.rs),
[member loading](../programs/hash-timestamp/src/runtime/aggregate.rs), and
[composition](../programs/hash-timestamp/src/protocol/hash/compose.rs).

Creates an ordered aggregate without storing its member list. Recovery
requires the member fingerprints and their history to be retained externally.

- Inputs
  - No serialized instruction arguments. Member IDs are derived from remaining
    accounts and must be unique; their order affects the aggregate identity.
- Required accounts
  - `hash_account`: writable new pack hash PDA.
  - `vote_info`: writable payer vote PDA for new pack.
  - `payer`: writable signer.
  - `system_program`.
  - Remaining accounts: member hash accounts (`read-only`).
- Behavior
  - Validates each member account in the same way as `batch`.
  - Rejects repeated canonical member IDs.
  - Derives pack hash from ordered member fingerprints.
  - Uses `HashSource::pack`.
  - Creates pack hash and child vote.
- Postconditions
  - Pack hash exists and has one active voter.
- Failure cases
  - `PackMembersEmpty` if no members passed.
  - `PackMemberWrongProgram` if member account owner is wrong.
  - `PackMemberDuplicate` if the same canonical member ID appears more than once.
  - `HashNotFound` for uninitialized member hashes.
  - `HashAlreadyExists` / `InvalidHashSeeds` for bad hashes.

## verify

Implementation: [verify.rs](../programs/hash-timestamp/src/instructions/verify.rs).

Checks a live hash record's initialization, owner, PDA and bump without
changing state. It does not check file contents, rehash a target or traverse ancestry.

- Inputs
  - No serialized instruction arguments. SDK `verify(hashId)` uses the
    canonical ID to derive the account address before building the instruction.
- Required accounts
  - `hash_account`: hash account to verify.
- Behavior
  - Checks live state, PDA and stored bump.
  - Performs no state mutation.
- Failure cases
  - Anchor account-loading errors for missing, malformed or wrong-owner typed
    accounts; `HashNotFound` if a decoded record fails the liveness invariant.
  - `InvalidHashSeeds` when account key does not match derived hash PDA.

## restore

Implementation: [restore.rs](../programs/hash-timestamp/src/instructions/restore.rs).
For internal responsibilities, see [restore ownership](architecture.md#restore-ownership).

Validates a historical proof against a live on-chain anchor and optionally
recreates missing hash records. The caller must retain the proof: restore does
not discover history, invert hashes, recover files or recreate snapshot targets.

- Inputs
  - `proof_chain`: nonempty array of `RestoreProofLink`, each containing `hash`,
    full `source`, historical `created_at`, and optional variant-specific `params`.
- Required accounts
  - `payer`: writable signer; need not be an original voter or file author.
  - `anchor_hash_account`: existing on-chain tip hash account.
  - `system_program`.
  - Optional remaining accounts as `(hash_account, vote_info)` pairs. Both must
    be writable when the hash is missing. Existing records used only for
    validation may be read-only.
- Processing order
  - Bind remaining account pairs to proof entries by derived hash PDA.
  - Build the graph from dependencies:
    - `branch` depends on parent canonical ID.
    - `batch` depends on member list.
    - `pack` depends on member fingerprints.
    - `hash` and `account` links have no dependencies.
  - Reject duplicate canonical IDs, missing dependencies, cycles and nodes not
    reachable from index zero. Establish dependency-first validation order.
  - Authenticate `proof_chain[0]` against the live anchor: owner, liveness, PDA,
    bump and exact `hash`, full `source`, and `created_at` must match.
  - Preflight every supplied hash/vote pair as compatible existing state or
    vacant writable destinations. Existing records must match historical
    hash/source/time; old balances and voter counts are not proof fields.
  - Validate each link in dependency-first order with nonzero `created_at`:
    - `hash` with params requires a payload. It accepts either a payload whose
      SHA-256 digest equals the stored hash, or the exact 32-byte raw hash used
      by `register`.
    - `account` with params requires a snapshot unless its historical hash record
      is supplied and validated as existing in this call, either as the anchor
      or in a remaining pair. In proof-only mode, every non-tip `account` link
      therefore needs a snapshot, even if its hash record exists on chain.
      No original target account is passed to restore.
    - only a raw `hash` link may omit params. It then skips the payload check,
      receives no account pair, and is not materialized. Its historical metadata
      is still bound through the descendants or the live anchor. An `account`
      or derived link without params is rejected.
    - `branch` matches its parent fingerprint (hash, kind, time, generation),
      requires child generation = parent generation + 1, and recomputes its digest.
    - `batch` and `pack` match every member fingerprint against its proof entry,
      reject duplicate members and recompute the ordered aggregate digest.
  - Prepare a dependency-first creation plan for missing, paired, non-tip links,
    then execute it. No allocation or funding transfer occurs before preflight
    and the full commitment checks finish. Later CPI failure still rolls back
    the transaction's account effects.
- Remaining account rules
  - Remaining accounts count must be even.
  - Within each pair, the hash account must be immediately followed by its vote
    account. Pair groups may appear in any order.
  - Each pair must map uniquely to a non-tip proof link that has params.
  - If any pairs are supplied, they must cover every non-tip link with params.
    Supplying only a chosen subset of those links is rejected.
  - Vote account in the pair must equal derived vote PDA for proof link canonical ID and payer.
  - Writable privileges for both destinations of each missing hash are checked
    before any creation CPI. Existing validation-only pairs need not be writable.
- Creation rules
  - Proof topology, content, existing state, and every supplied account pair are
    validated before missing records are materialized.
  - For each non-tip link with params and corresponding account pair, restore
    creates hash and vote accounts together when the hash account is missing.
  - A supplied existing hash is validated but not recreated and does not gain a vote.
    Its supplied vote must either be valid already or be the expected vacant
    System-owned PDA.
  - Pre-funded restoration PDAs use the same validated System Program placeholder flow as normal creation.
  - If no pairs are provided, restore performs validation only and performs no writes.
- Postconditions
  - For each missing non-tip proof link with params and a supplied account pair,
    caller gets a vote account with the recreated hash. Existing hashes retain
    their existing vote state. Each recreated hash has `voters = 1` and the
    historical hash/source/time, plus a fresh vote belonging to the current
    payer. Old voters, balances and deposits are not resurrected.
  - Proof-only calls create neither hashes nor votes; they are still transactions.
  - Proof passes graph and variant-specific commitment rules, including the
    explicitly allowed raw-Hash and existing-Account omissions above.
- Failure cases
  - `RestoreChainTooShort` for empty proof.
  - `InvalidHashSeeds` for a wrong anchor PDA or remaining vote PDA.
  - `RestoreTipMismatch` for a correctly addressed anchor not owned by this
    program, or for tip data that differs from the live anchor.
  - `RestoreProofDuplicate`, `RestoreDependencyMissing` for invalid graph topology.
  - `RestoreProofMismatch` for inconsistent proof commitments or member data,
    or a supplied existing non-tip hash/source that differs from its proof link.
  - `RestoreTimestampMismatch` for a supplied existing non-tip timestamp
    conflict or a zero historical timestamp.
  - `RestoreGenerationMismatch` for an invalid non-tip Branch generation;
    the same mismatch on the tip reports `RestoreTipMismatch`.
  - `RestorePackMembersMissing`, `RestoreHashPayloadMissing`, `RestoreAccountSnapshotMissing` for malformed proof params.
  - `RestoreAccountsMisaligned` for an odd account count, a pair for the tip or
    a non-parametric link, or incomplete pair coverage in materialization mode.
  - `AlreadyVoted` or vote-validation errors when a supplied restoration vote
    account has an incompatible state.
  - Anchor `ConstraintMut` (2000) when the hash is missing and either destination
    is read-only; the error names `restore_hash_account` or `restore_vote_account`.
  - `InvalidPdaPlaceholder` for a restoration destination with an invalid owner,
    data, or executable flag, regardless of its balance.

### Proof order and complete dependencies

There are three separate order rules:

- Proof index zero is the live anchor. Other proof entries may appear in any
  order; the program derives their verification order. A readable chain such
  as `[tip, parent, root]` is valid and verifies dependencies as `[root, parent, tip]`.
- Whole `(hash, vote)` pair groups may appear in any order, but the hash must
  immediately precede its own payer vote within each pair.
- Batch/Pack member lists and their fingerprints must retain their original
  order. Reordering those changes the committed aggregate, unlike reordering
  the outer proof array.

The proof must contain the full dependency closure reachable from the anchor.
An existing intermediate Branch, Batch or Pack is not a shortcut: its own
parameters and dependencies are still required. For example:

```text
B3 (live anchor)
├── B2
│   ├── B1 (desired record)
│   │   ├── A
│   │   └── X
│   └── Y
└── Z
```

Here `B3 = Batch(B2, Z)`, `B2 = Batch(B1, Y)`, and `B1 = Batch(A, X)`.
The proof needs all seven nodes, not only `B3 → B2 → B1`; derived siblings
need their own dependencies too. Plain Hash leaves may omit params and remain
proof-only. Batch nodes cannot. If B2 and B1 are missing, a materializing call
must recreate both; if B2 exists with matching historical state, it is only
validated. There is no public arbitrary-target selection or path-only inclusion
proof mode. The internal planner's requested-index set does not relax these rules.

### Historical proof versus occupied PDA

The same ID/PDA may have been closed and normally created again with a new
timestamp. If that ancestor account is supplied, its new timestamp conflicts
with the old proof and causes `RestoreTimestampMismatch` (6022). Restore never
overwrites it or chooses the minimum of the two dates. Recreation through a
valid restore, in contrast, retains the proven timestamp and can match later proofs.

With no remaining pairs, the program does not read ancestor PDAs: an unchanged
live anchor may still authenticate old history despite a newer record at an
ancestor address. The full proof rules, including Account snapshot requirements,
still apply. A raw Hash with `params: None` likewise has no supplied pair even
when other eligible records are materialized; it cannot itself be recreated in
that call. This omission cannot be used for Batch, Pack, Branch or Account nodes.

An anchor replaced with different historical fields fails the anchor check in
both modes. Also, one proof cannot represent two historical incarnations with
the same canonical ID: duplicate-ID rejection applies regardless of timestamps.

### Recovery limits

The SDK does not discover lost proof data or split proofs across transactions.
All proof bytes are instruction data; large graphs and Account snapshots may
exceed encoding, transaction, compute or account limits. Batch retains IDs, not
complete fingerprints/history; Pack retains neither member list nor fingerprints.

These guarantees assume legitimate program-owned anchor state and the security
of the hash commitments. They establish anchored historical records, not file
authorship, proof of possession of the original file, or its filesystem creation time.
