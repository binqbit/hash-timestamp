# Hash Timestamp

Hash Timestamp is an Anchor based Solana program that lets users register 32 byte hashes, secure them with rent bearing votes, and evolve those hashes into new composites over time. The goal of the repository is to keep a canonical proof trail on chain until every voter withdraws their deposit.

## Project Overview

- **Purpose:** track when a hash first gained support, enforce rent deposits through program derived accounts, and support composite hashes (branch, batch, pack) that extend or aggregate earlier proofs.
- **Core instructions:** register, account hash, vote, unvote, branch, batch, pack, and verify. Each one is explained in [Instruction Guide](docs/instructions.md).
- **End to end coverage:** the TypeScript SDK and mocha tests mirror every on chain instruction so you can script workflows or validate behavior without re implementing PDA logic.

## Project Summary

- The smart contract lives under [programs/hash-timestamp/](programs/hash-timestamp) and is split into instructions, logic helpers, state definitions, and utility functions.
- The TypeScript SDK in [app/sdk/hashTimestamp.ts](app/sdk/hashTimestamp.ts) mirrors the on chain layout so client applications can derive program addresses and send instructions without re implementing PDA logic.
- Integration tests in [tests/](tests/) exercise every public instruction against a local Anchor workspace.
- Additional references in [docs/](docs/) explain architecture details, instruction behavior, and integration guidance for applications.

## Prerequisites

Make sure the following tooling is available before working with the project: Solana CLI, Anchor CLI, a Rust toolchain installed through rustup, and Node.js version 16 or later with either Yarn or npm.

## Setup and Build

Install JavaScript dependencies after cloning the repository:

```bash
yarn install
# or: npm install
```

Build the Anchor program so that the binary artifacts and generated IDL appear inside `target/`:

```bash
anchor build
```

## Quick Start

1. Configure Solana CLI to point at localhost (or your preferred cluster) and ensure your keypair has SOL:
   ```bash
   solana config set --url localhost
   solana airdrop 4
   ```
2. Start a local validator and deploy:
   ```bash
   solana-test-validator --reset
   anchor build
   anchor deploy
   ```
3. Run the test suite to confirm behavior:
   ```bash
   anchor test
   ```
   The tests cover registration, voting flows, branching, batching, packing, and verification.
4. Explore the SDK to script the same flows from TypeScript. The examples in [tests/](tests/) are a good starting point for automated tooling.

## Local Development Flow

1. Start a local validator to obtain a clean cluster:
   ```bash
   solana-test-validator --reset
   ```
2. Deploy the program to that validator:
   ```bash
   anchor deploy
   ```
3. Run the automated test suite:
   ```bash
   anchor test
   ```
   To keep the validator running across multiple executions, start it separately, build once, and then run:
   ```bash
   yarn ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"
   ```

## Deploying to Shared Clusters

1. Update `Anchor.toml` with the cluster URL (for example `devnet`) and the wallet path you intend to use.
2. Configure Solana CLI to the same cluster:
   ```bash
   solana config set --url https://api.devnet.solana.com
   solana config get
   ```
3. Ensure the program ID in `programs/hash-timestamp/src/lib.rs` (the `declare_id!` macro) matches the address you plan to deploy to. Use `anchor keys list` if you need to fetch the generated ID.
4. Build and deploy:
   ```bash
   anchor build
   anchor deploy
   ```
5. After deployment, regenerate any client IDL artifacts if required and distribute the program ID to downstream applications.

## Testing and Validation

- Use `anchor test` locally before shipping changes; it spins up a validator, rebuilds the program, and runs mocha specs.
- When working against devnet or another persistent cluster, prefer targeted scripts that leverage the SDK to validate specific instructions (for example, registering a hash and verifying its canonical ID).
- To audit proofs manually, call the `verify` instruction through the SDK and cross check the returned account data with `client.fetchHashAccount`.

## SDK Overview

The TypeScript helper wraps the Anchor `Program<HashTimestamp>` instance and exposes high level methods such as register, account hash, vote, unvote, branch, batch, pack, and verify. It also provides utilities for rent estimation, canonical hash derivation, and PDA lookups. Refer to [SDK Guide](docs/sdk.md) for step by step usage notes, including how to validate a hash proof or retrieve derived identifiers after sending a transaction.

## Deployment Notes

Before targeting a shared cluster, update `Anchor.toml` with the desired cluster name and wallet path, ensure the `declare_id!` macro in `programs/hash-timestamp/src/lib.rs` matches the deployed program identifier, and rotate the keypairs stored under `config/` as part of your release process.

## Further Reading

- [Architecture](docs/architecture.md) describes the account layouts, rent model, and composition strategies used on chain.
- [Instruction Guide](docs/instructions.md) explains every instruction, the accounts each one expects, and how to interpret success or failure when validating proofs.
- [SDK Guide](docs/sdk.md) provides guidance for working with the TypeScript helper and for checking proof validity from client applications.
- [Application Integration](docs/api.md) outlines integration practices for applications or services that depend on the program and SDK.
