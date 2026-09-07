# Architecture

Module responsibilities and execution boundaries. Public instruction behavior is
defined in [instructions.md](instructions.md); client usage is in [sdk.md](sdk.md).

## Layers and dependencies

| Layer          | Responsibility                                                         |
| -------------- | ---------------------------------------------------------------------- |
| `lib`          | Anchor entry points and dispatch                                       |
| `instructions` | Account contexts and operation sequencing                              |
| `protocol`     | Deterministic hashes, addresses, proof rules and restoration decisions |
| `runtime`      | Account validation, funding, allocation, serialization and refunds     |
| `state`        | Persisted shapes and local invariants                                  |

Dependencies flow from `instructions` to `runtime` and `protocol`, and from
`runtime` to `protocol`/`state`. Runtime does not import instructions; protocol
does not access live account handles, sysvars, RPC or CPI.

Handlers show meaningful operations. Put byte manipulation, transfers and account
mechanics behind the runtime boundary; put value-only rules in protocol modules.

## Repository map

```text
programs/hash-timestamp/src/
├── lib.rs                       entry points
├── error.rs                     public error definitions
├── telemetry.rs                 optional diagnostic logging
├── state/
│   ├── hash_account.rs          hash record and voter-count invariants
│   ├── hash_source.rs           source variants, generation and allocated size
│   └── vote_info.rs             refundable witness claim
├── instructions/                account contexts and handlers
│   ├── register.rs / account.rs
│   ├── vote.rs / unvote.rs / verify.rs
│   ├── branch.rs / batch.rs / pack.rs
│   └── restore.rs
├── protocol/
│   ├── address.rs               canonical IDs, PDAs and signer seeds
│   ├── hash/
│   │   ├── branch.rs            child derivation
│   │   ├── compose.rs           ordered aggregate commitments
│   │   ├── metadata.rs          account-metadata digest
│   │   └── snapshot.rs          immutable record values
│   └── restore/
│       ├── types.rs             proof wire types
│       ├── graph.rs             dependencies, reachability and ordering
│       ├── validate.rs          commitments and historical consistency
│       └── plan.rs              missing-record decisions
└── runtime/
    ├── record_lifecycle.rs      joint hash/vote operations
    ├── hash_record.rs           live-record validation and creation
    ├── vote_record.rs           vote validation, funding and release
    ├── metadata.rs              metadata reads
    ├── aggregate.rs             ordered member loading
    ├── vote_migration.rs        parent-vote validation
    ├── restore/
    │   ├── accounts.rs          account binding and preflight
    │   └── execution.rs         prepared creation plan and execution
    ├── account_io.rs            discriminator-aware serialization
    ├── pda_account.rs           funding, allocation and assignment
    └── lamports.rs              checked transfers and closure

app/sdk/
├── hashTimestamp.ts             public entry point
├── hashUtils.ts                 compatibility utility exports
├── client.ts                    instruction builders and operation sequences
├── client/
│   ├── transactions.ts          signer selection and submission
│   ├── accounts.ts              account-read compatibility
│   └── aggregate.ts             member reads and fingerprints
├── protocol/
│   ├── normalization.ts         byte, key and numeric conversion
│   ├── source.ts                source tags, generation and account sizes
│   ├── hashes.ts                digest framing
│   └── addresses.ts             PDA derivation
├── encoding.ts / wire.ts        Anchor encoding and IDL-derived types
├── restore.ts                   proof encoding and requested-ID selection
├── rent.ts                      RPC rent estimates
└── types.ts                     public data contracts
```

SDK leaf modules do not import `client` or the public export files.
`mod.rs` files expose module APIs; generated `target/` files are build outputs.
For test placement and tooling, see [testing.md](testing.md).

## Instruction pipelines

| Instruction      | Sequence                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `register`       | Timestamp raw record → create record and initial vote                                                         |
| `account`        | Read metadata digest → timestamp → create                                                                     |
| `batch` / `pack` | Load members → compose → timestamp → create                                                                   |
| `vote`           | Validate live hash → add funded vote                                                                          |
| `unvote`         | Validate hash → authenticate vote → release claim                                                             |
| `branch`         | Validate parent → derive child → validate migration → create child → optionally release old vote              |
| `restore`        | Bind accounts → parse graph → authenticate anchor → validate accounts → validate commitments → plan → execute |
| `verify`         | Validate live hash                                                                                            |

Thin Anchor entry points delegate to handlers. The handler itself owns the
scenario; there is no additional whole-instruction proxy layer.

## Account and effect boundaries

`Account<T>` holds Anchor-decoded state. A mutable typed account remains the
authoritative value serialized on exit. `Signer` and `Program<System>`
establish signer/program constraints.

`UncheckedAccount` is used where runtime validation is necessary: new or
prefunded PDAs, optional parent votes, metadata targets and the restore anchor.
Variable remaining accounts arrive as `AccountInfo` handles.

- `hash_record` owns live-record loading and validation.
- `vote_record::validate` accepts typed state; `load_and_validate` decodes
  dynamic accounts. Both enforce the same identity rules.
- `RecordWriter` binds the instruction payer and System Program. It creates a
  hash with its initial vote or adds a funded vote to an existing hash.
- `ValidatedVote` binds a validated claim to its account. Its consuming
  `release` operation checks the recipient, decrements the counter and refunds/closes accounts.

`state` retains the read-only `HashAccount::verify_account` PDA/bump adapter;
it does not borrow serialized data or perform CPI.

Ordering protects invariants: metadata is read before funding effects, branch
creates the child before releasing the parent vote, and restore finishes
validation/preparation before its first allocation. Transaction atomicity is
the rollback boundary if a later CPI fails.

## Restore ownership

The [restore handler](../programs/hash-timestamp/src/instructions/restore.rs)
coordinates three distinct representations:

1. `ProofGraph` contains proof values and dependency order, with no account handles.
2. `ValidatedProof` records commitment validity under runtime-supplied facts
   about existing records. Anchor authentication is a separate earlier handler step.
3. `RestorePlan` selects missing records; runtime binds those decisions to
   validated destinations in `RestoreExecution`.

All historical `NewHashRecord` values are prepared before execution.
`NewHashRecord::historical` preserves the proof timestamp; normal creation
uses `NewHashRecord::now`.

The internal requested-index set is not a public arbitrary-target API: account
binding still requires every non-tip parametric pair when materializing records.
Public proof ordering, full dependency closure, snapshot exceptions and conflicts
are specified once in the [restore reference](instructions.md#restore).

## Persisted state

`HashAccount` stores `hash`, `source`, `voters`, `created_at` and `bump`.
`VoteInfo` stores `voter`, canonical `hash_id`, refundable `amount` and `bump`.

Source variants are Hash, Account, Branch, Batch and Pack. Batch additionally
stores ordered member IDs; Pack does not store membership. Hashes and PDA framing
are described in the [protocol invariants](instructions.md#core-primitives-and-invariants)
and implemented in `protocol/hash` and `protocol/address.rs`.

Allocated sizes include compatibility padding:

| State               |                     Space |
| ------------------- | ------------------------: |
| Hash or Pack record |                  64 bytes |
| Account record      |                  96 bytes |
| Branch record       |                 136 bytes |
| Batch record        | `64 + 32 × members` bytes |
| VoteInfo            |                  88 bytes |

These are allocated sizes, not just serialized field lengths; rent calculations
must use the appropriate account size.

## Compatibility

Instruction signatures, ordered accounts, field/variant layouts, errors, PDA
seeds, digest framing and allocated sizes are protocol contracts. Internal
refactoring must preserve them. The reviewed IDL baseline is
`tests/fixtures/idl-v3.json`; intentional ABI changes require a versioned migration.

See [compatibility gates](testing.md#coverage-and-compatibility-gates) for validation.
