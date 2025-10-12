# Application Integration

This guide explains how to consume the Hash Timestamp program from any application or service that talks to Solana. The focus is on orchestrating instructions, handling proof data, and matching the SDK to your preferred runtime, whether that is a backend service, command line tool, or user interface.

## Environment Preparation

1. Load the program IDL and construct an Anchor `Program<HashTimestamp>` instance that targets the cluster you plan to use.
2. Instantiate the SDK client from `app/sdk/hashTimestamp.ts` with that program so all canonical identifier and PDA derivations stay consistent with the on-chain contract.
3. Make sure the signer you pass to the provider has enough SOL to fund rent deposits for new hash and vote accounts.

## Typical Workflow

- Registration: accept a 32 byte payload (or derive one from external data), call the `register` helper, and persist the returned canonical identifier so you can reference the hash in future operations.
- Account hashing: when anchoring external state, gather the target account metadata, use the `accountHash` helper to register it, and record the metadata digest alongside the canonical identifier.
- Voting: before adding or removing votes, read the current vote status with `fetchVoteInfo` so your application can decide whether to prompt for `vote` or `unvote`.
- Branching and aggregation: plan branch, batch, or pack operations as explicit workflow steps. Capture both the transaction signatures and derived identifiers returned by the SDK so downstream systems can confirm lineage.
- Verification: run the `verify` helper when you need to prove that a hash still exists. Pair the result with a fresh call to `fetchHashAccount` to obtain creation timestamps, voter counts, or source metadata.

## Error Interpretation

Anchor surfaces program failures as structured errors. Inspect the `errorCode.number` field on exceptions and translate the values using the table in `docs/instructions.md`. Examples include:

- `HashNotFound` – the targeted hash account no longer exists; recreate it if the proof is required.
- `AlreadyVoted` – the signer already has an active vote; skip duplicate deposits.
- `VoteAccountMissing` – a branch operation attempted to migrate a vote without supplying the existing vote PDA.

Persist these interpretations or expose them as telemetry so operators can react quickly when automated jobs fail.

## Operational Practices

- Wait for each transaction to reach the desired confirmation status before triggering dependent instructions; branch, batch, and pack operations rely on recently created accounts.
- Cache rent minimums per cluster to avoid frequent RPC calls when estimating deposits.
- Store canonical identifiers and transaction signatures in your application database so you can audit proof lifecycles or rebuild state after an outage.
- Surface proof status by periodically polling `fetchHashAccount` and reconciling the results with your own records.

Following these practices keeps integrations deterministic and makes it easier to reason about proof validity across different deployment environments.
