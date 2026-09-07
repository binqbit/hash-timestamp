# Hash Timestamp

Hash Timestamp is a Solana program for recording and verifying the history of
hashes. It lets applications register a record, link it to later records, group
records into aggregates and prove earlier history from a surviving on-chain anchor.

This repository contains the Rust smart contract, a TypeScript SDK, usage
examples and automated tests.

## What the project provides

- **Timestamp records:** register a raw hash or commit to a Solana account snapshot.
- **Linked history:** create branches and ordered Batch/Pack aggregates.
- **Record lifecycle:** support records with refundable votes and close them
  when their final vote is withdrawn.
- **Historical recovery:** validate retained proofs and recreate missing records
  with their proven historical timestamps.
- **Portable archives:** retain a versioned JSON graph, merge creation receipts
  and let the SDK plan restoration from selected nodes.

The program stores hash records, not file contents. File hashing happens in the
application. Recovery requires retained proof data and a live anchor; the detailed
guarantees and limits are in the [instruction reference](docs/instructions.md).

## Repository layout

- `programs/hash-timestamp/src/` — on-chain program.
- `app/sdk/` — TypeScript client, encoders and hash/address helpers.
- `examples/` — client usage examples.
- `tests/` — SDK unit tests and local-validator scenarios; Rust tests live
  alongside the program modules.
- `scripts/` — build, test and compatibility checks.
- `docs/` — focused guides for users and contributors.

## Getting started

Complete the [environment setup](docs/testing.md#setup), then run these commands
from `hash-timestamp/`:

```bash
yarn install --frozen-lockfile
yarn test
```

The test workflow builds the program, deploys it to a local validator and runs
the checks and test suites. Use `yarn build` when you only need the program
artifact and generated IDL/types. All builds and tests use the same program ID;
see [program identity](docs/testing.md#program-identity).

To call the program from an application, start with the
[SDK's first-call example](docs/sdk.md#first-call-register-a-file-and-read-its-record).
The [usage examples](examples/sdk-usage.ts) demonstrate registration and
building a branch proof.

## Documentation

Choose the guide for the task at hand:

- [Instructions](docs/instructions.md) — what each operation does, its account
  requirements, guarantees and errors.
- [SDK](docs/sdk.md) — client construction, inputs, return values and signing.
- [Archive format](docs/archive.md) — JSON nodes, merging, creation receipts and
  automatic restore planning.
- [Application integration](docs/api.md) — transaction coordination, state
  handling and proof persistence.
- [Architecture](docs/architecture.md) — module boundaries, data ownership and
  execution pipelines; start here when changing the implementation.
- [Testing](docs/testing.md) — toolchain setup, test commands and where new tests belong.
