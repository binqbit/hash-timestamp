# Testing

## Setup

Run contract commands from `hash-timestamp/`. Install:

- Rust/Cargo and rustup, including the nightly toolchain used for IDL generation.
- Anchor CLI 0.31.1 and Solana tools: `solana`, `solana-test-validator`, and the
  SBF build tool used by Anchor.
- Node.js >=17 with native `structuredClone`, and Yarn 1.x.
- Node dependencies with `yarn install --frozen-lockfile`.

Configure a development wallet and local cluster in [Anchor.toml](../Anchor.toml).
Use disposable local accounts for integration tests, not a production wallet
or shared application state.

`scripts/test.sh` powers the build/test commands. It checks the Anchor version,
routes Cargo toolchain selectors through rustup and places artifacts in `target/`.
It does not install the toolchain. If needed, set `ANCHOR_BIN` to your Anchor
0.31.1 executable. Run `./scripts/test.sh --help` for flags and provider/wallet
environment defaults.

## Commands

| Command                          | Scope                                                              | Additional requirements                                                     |
| -------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `yarn build`                     | Build program and generate IDL/types                               | Build toolchain                                                             |
| `yarn test`                      | Build program, load local validator, run checks and test suites    | Full setup above                                                            |
| `yarn test:unit`                 | SDK values, adapters, wire format, build workflow and architecture | Node dependencies; no wallet or RPC                                         |
| `yarn test:rust`                 | Native Rust tests and doctests                                     | Rust/Cargo                                                                  |
| `yarn test:checks`               | JS/TS formatting, types, Rust tests, architecture and IDL          | Matching IDL/types                                                          |
| `yarn test:integration`          | Transaction scenarios only                                         | Running validator, deployed program, `ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET` |
| `./scripts/test.sh --skip-build` | Test using existing SBF/IDL artifacts                              | Artifacts matching the source                                               |
| `./scripts/test.sh --quick`      | Skip build, deployment and validator startup                       | Matching program already loaded in a running validator                      |

Direct `yarn test:integration` does not set the wrapper's environment defaults.
An Anchor-managed validator stops when its test command finishes.

For a focused run, use `--grep` rather than editing tests:

```bash
yarn test:unit --grep "mixed source"
```

The same option works with `test:integration` when its runtime prerequisites
are satisfied.

## Program identity

All builds and tests use one program ID, declared in
[`lib.rs`](../programs/hash-timestamp/src/lib.rs) and shared by the devnet,
testnet and localnet entries in [`Anchor.toml`](../Anchor.toml).
Selecting an RPC cluster does not change the compiled address.

`yarn build` generates SBF and IDL/types and checks the interface and address.
It does not deploy or start a validator. `yarn test` uses the same identity,
with debug logs enabled. Cargo arguments may follow `--`, such as
`yarn build -- --offline`.

Building does not require the program's private key. Deployment is a separate
operation requiring the matching program key and target cluster.
Do not run `anchor keys sync` against an unrelated deployment keypair: it can
replace the configured address.

## Manually managed validator

Preload the program into a disposable local ledger and keep the validator
running. Run both terminals from `hash-timestamp/`:

```bash
# Terminal 1
yarn build
yarn check:idl
test_program_id=$(node -p "require('./target/idl/hash_timestamp.json').address")
local_test_ledger=$(mktemp -d /tmp/hash-timestamp-localnet.XXXXXX)
solana-test-validator --ledger "$local_test_ledger" --bind-address 127.0.0.1 \
  --bpf-program "$test_program_id" target/deploy/hash_timestamp.so
```

```bash
# Terminal 2, from hash-timestamp/
./scripts/test.sh --quick
```

Use `--quick` only while the matching program remains loaded. A new ledger or
changed program requires restarting the validator with the matching SBF.
The wrapper rejects `--skip-local-validator` without `--skip-deploy` to avoid
falling through to a keypair-based deployment. Stop the validator with Ctrl-C.

## Test organization

- `tests/unit/**/*.spec.ts`: no wallet, validator or network; use narrow fake
  RPC/builders to test client boundaries.
- `tests/integration/**/*.spec.ts`: real instruction scenarios.
- `tests/support/`: assertions, provider/account setup, clock polling and proof fixtures.
- Rust `#[cfg(test)]` modules: protocol rules, state invariants and runtime helpers.
- `tests/fixtures/idl-v3.json`: reviewed ABI baseline; update only for an
  intentional, versioned interface change.

Quoted recursive globs discover specs automatically. Put new specs in their
unit/integration directory, not `tests/` itself. Empty selections, `.only`
and skipped/pending tests fail the normal commands. Integration cases have a
60-second timeout; polling uses bounded deadlines, with no automatic test retries.

## Coverage and compatibility gates

- Rust/SDK vectors and real Anchor Borsh round trips cover hashes, source tags,
  PDA seeds, account layouts and wire encoding.
- SDK tests cover inputs, exact integers, signing, RPC adapters, aggregates and restore builders.
- Restore tests cover graph structure, commitments, historical timestamps and snapshots.
- Runtime/integration tests cover ownership, prefunding, refunds, counters and rollback.
- `check:architecture` checks layer dependencies and handler/SDK boundaries.
  It is a lexical guard, not a full static analyzer.
- `check:idl` compares generated IDL with the baseline, ignoring documentation
  text only, and checks the configured program addresses.
  Rebuild stale generated artifacts before running it.

Execution results and mutation experiments belong in the dated
[review records](../debug-tools/tests_review.md).

## Diagnostic controls

```bash
node debug-tools/test_runner_probe.cjs
node debug-tools/aggregate_kind_mutation.cjs
```

The runner probe exits 0 after checking that valid tests pass and
empty/focused/pending fixtures fail. Fixtures are outside normal discovery.

The mutation probe intentionally forces aggregate member kinds to Hash in its
own process. It should exit 1 with the two mixed-source Batch/Pack cases failing.
It does not edit source files or send transactions; it is not a normal green gate.

## Formatting

`yarn lint` checks JS/TS and maintenance scripts, not Rust or Markdown. Check
those separately:

```bash
cargo fmt --all -- --check
yarn prettier README.md "docs/*.md" --check
```
