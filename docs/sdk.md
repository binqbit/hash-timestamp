# SDK Guide

The TypeScript helper in app/sdk/hashTimestamp.ts exists so client developers can interact with the Hash Timestamp program without copying Rust logic into their applications. This guide explains what the helper provides and how to apply it during development.

## Getting Started

The helper expects an Anchor workspace with the Hash Timestamp IDL available. Once your application has an Anchor provider, construct the helper by passing that Program<HashTimestamp> instance into the exported client class. The client keeps a reference to the program, its connection, and the program identifier so that later calls stay consistent with on chain expectations.

## Available Capabilities

The helper offers a library of pure utilities:

- Canonical hash helpers that mirror on chain hashing rules, allowing you to derive identifiers for register, branch, batch, pack, and account metadata flows.
- PDA derivation helpers for hash accounts and vote accounts so you can predict addresses before submitting transactions.
- Rent estimation helpers that query the Solana cluster for the current minimum balance required to keep hash or vote accounts rent exempt.

On top of those utilities, the client exposes high level methods that submit transactions on your behalf. Each method prepares the correct account list and arguments for the corresponding instruction:

- register stores a new standalone hash and records the caller as the first voter.
- accountHash derives a hash from another Solana account's metadata and registers it.
- vote and unvote manage individual deposits tied to a hash.
- branch, batch, and pack create composite hashes while respecting program validation rules.
- verify performs a lightweight existence check against a hash account.

## Return Values and Proof Tracking

Transaction methods return either a signature or a pair of values containing the signature and the derived canonical identifier. Capture these results so you can reference them later when verifying that a hash proof persists on chain. The helper also provides fetchHashAccount and fetchVoteInfo functions to read back deserialized account data, which is useful for validating voter counts, rent deposits, and lineage.

## Error Interpretation

When the program rejects a transaction, Anchor surfaces the ErrorCode number through the thrown exception. Inspect err.error.errorCode.number to determine which condition occurred. The mapping between codes and explanations is documented in docs/instructions.md. Use that mapping to present meaningful messages to tooling users.

## Workflow Tips

- Reuse the canonical identifier helpers when composing custom transactions so that every PDA derived client side matches the on chain expectation.
- Query rent minimums only when necessary and cache the results per cluster to reduce RPC load.
- Combine fetchHashAccount with the verify method to double check whether a proof remains valid after each mutation.

By relying on the SDK rather than hand assembling accounts, developers reduce the risk of seed mismatches, under funded accounts, or mis ordered remaining accounts when building complex flows such as branch migrations or batch compositions.
