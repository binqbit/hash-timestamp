# Hash Timestamp

Hash Timestamp is an Anchor-based Solana program that records when a 32-byte hash was first backed by deposit-bearing voters. Each voter locks the rent-exempt minimum so the canonical timestamp remains on-chain until everyone withdraws.

## Functionality

- `vote` creates the hash account on first use, records the voter's deposit, and increments the voter count.
- `unvote` returns the caller's deposit, removes their vote record, and automatically closes the hash account when no voters remain.
- `verify` is a cheap check that fails if the hash account is missing or mismatched.

## Architecture

The on-chain state lives in program-derived accounts:

- `HashAccount` uses seeds [b"hash", hash] and stores the hash bytes, voter count, creation timestamp, and bump.
- `VoteInfo` uses seeds [b"vote", hash_pda, voter] to hold each voter's rent deposit.
  Using PDAs guarantees deterministic addresses and lets `verify` load accounts without extra inputs. Anchor supplies account validation, IDL generation, and CPI helpers, while the TypeScript SDK in `app/sdk/hashTimestamp.ts` mirrors the on-chain layout so clients can invoke the program with minimal boilerplate. End-to-end tests in `tests/hash-timestamp.ts` exercise the full flow against a local validator.

## Getting Started

Prerequisites:

- Solana CLI and Anchor CLI installed (`solana-test-validator`, `anchor --version`).
- Node.js 16+ with Yarn (or npm) for the TypeScript tooling.

Install dependencies:

```
yarn install
```

Use `npm install` if you prefer npm.

## Build

```
anchor build
```

This compiles the program to `target/deploy/` and regenerates the IDL in `target/idl/`.

## Run and Test

```
anchor test
```

`anchor test` spins up a local validator, builds the program, and runs the Mocha tests under `tests/`. To keep the validator running between commands, start it manually and then deploy and test:

```
solana-test-validator --reset
anchor deploy
yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

## Using the SDK

```
import * as anchor from '@coral-xyz/anchor';
import { HashTimestampClient } from './app/sdk/hashTimestamp';

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.HashTimestamp;
const client = new HashTimestampClient(program);

const hash = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

await client.vote(hash);
await client.verify(hash);
await client.unvote(hash);
```

Before targeting a live cluster, update `Anchor.toml` with the desired cluster and wallet, and replace the example keypair in `config/` with your deployment keys.
