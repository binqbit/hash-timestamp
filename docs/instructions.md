# Instruction Guide

This guide explains how to use each instruction in the Hash Timestamp program. It is written for developers building tools, services, or apps that rely on deterministic, verifiable hash proofs.

## How To Read This Guide

- All instructions operate on program-derived addresses (PDAs).
- A "hash account" PDA uses the seed "hash" plus a canonical identifier.
- A "vote account" PDA uses the seed "vote" plus the voter public key and the same canonical identifier.
- Creating accounts requires the caller to fund the rent-exempt minimum for their serialized sizes.

---

## register

Creates a new hash account for a user-supplied 32-byte payload and records the caller as the first voter.

- Inputs
  - 32-byte payload (the raw hash bytes)
- Required Accounts
  - Writable hash account PDA for the canonical identifier
  - Writable vote account PDA for the caller
  - Caller as signer
  - System program
- Behavior
  - Initializes a hash account with source "Hash" and sets voters to 1.
  - Creates the caller's vote account funded with the rent minimum.
- Postconditions
  - Hash account exists and is rent-exempt; the caller has an active vote.
- Failure Cases
  - Invalid PDA seeds, account already exists, insufficient funds.
- Notes
  - Use this to introduce standalone hashes not derived from other on-chain data.

## account

Derives a hash from the metadata of another Solana account and registers it.

- Inputs
  - Target account address to hash
- Required Accounts
  - Writable hash account PDA for the metadata hash
  - Writable vote account PDA for the payer
  - Target account (read-only)
  - Payer as signer
  - System program
- Behavior
  - Hashes key metadata (address, owner, lamports, executable flag, rent epoch, data length, and contents).
  - Registers the resulting digest with source "Account".
- Postconditions
  - Hash account and voter record exist for the metadata-derived digest.
- Failure Cases
  - Invalid PDA seeds, account already exists, missing target account.
- Notes
  - Use when you need a verifiable anchor to external program state.

## vote

Adds an additional vote to an existing hash; creates the vote account if missing.

- Inputs
  - Canonical identifier of the target hash
- Required Accounts
  - Writable hash account
  - Writable vote account PDA for the caller
  - Caller as signer
  - System program
- Behavior
  - Verifies the hash account, increments voter count, and creates the caller's vote PDA funded with rent.
- Postconditions
  - Caller has a vote; hash voters count increases by one.
- Failure Cases
  - Hash not found, invalid PDA seeds, caller already voted, insufficient funds.

## unvote

Removes the caller's vote and withdraws their deposit; closes the hash account if it was the final vote.

- Inputs
  - Canonical identifier of the target hash
- Required Accounts
  - Writable hash account
  - Writable vote account for the caller (seeds enforced)
  - Caller as signer
  - System program
- Behavior
  - Confirms ownership and seeds; refunds the deposit; decrements the voter count; closes accounts when appropriate.
- Postconditions
  - Caller's vote account is closed; hash may also be closed if no voters remain.
- Failure Cases
  - Invalid seeds, caller is not the voter, hash not found.

## verify

Performs a lightweight existence check of a hash account.

- Inputs
  - Canonical identifier of the target hash
- Required Accounts
  - Hash account (read-only or writable)
- Behavior
  - Succeeds if the account is initialized and matches its PDA; no state changes.
- Postconditions
  - None (read-only validation).
- Failure Cases
  - Hash not found, invalid seeds.

## branch

Derives a child hash from an existing hash and optionally migrates the caller's vote to the child.

- Inputs
  - 32-byte payload for the new branch
  - Flag indicating whether to migrate the caller's vote
- Required Accounts
  - Writable parent hash account
  - Writable child hash account PDA (new)
  - Caller's old vote account or a system-program placeholder (see Notes)
  - Writable new vote account PDA for the child
  - Caller as signer
  - System program
- Behavior
  - Reads a snapshot of the parent; computes a child digest using parent identity, source kind, creation time, generation, and the payload.
  - Creates the child hash and the caller's new vote account.
  - If migrating, closes the old vote and transfers deposits; closes the parent hash if it was the final vote.
- Postconditions
  - Child hash exists with generation incremented; the caller has a vote on the child.
- Failure Cases
  - Parent not found, missing vote for migration, invalid seeds, insufficient funds.
- Notes
  - When not migrating, the instruction still requires either the correct old vote PDA (owned by the program) or a system-program placeholder so PDAs remain deterministic.

## batch

Builds an aggregate hash that retains the canonical identifier list of all members.

- Inputs
  - List of member canonical identifiers
- Required Accounts
  - Writable batch hash account PDA (new)
  - Writable vote account PDA for the payer
  - Payer as signer
  - System program
  - Member hash accounts (read-only remaining accounts)
- Behavior
  - Validates membership and ownership; fingerprints each member; hashes the sequence and stores member IDs in the source.
- Postconditions
  - Batch hash exists; payer has a vote on the batch.
- Failure Cases
  - No members, wrong program ownership, member not initialized, invalid seeds.

## pack

Aggregates multiple existing hashes into a compact digest without storing the member list.

- Inputs
  - List of member canonical identifiers
- Required Accounts
  - Writable pack hash account PDA (new)
  - Writable vote account PDA for the payer
  - Payer as signer
  - System program
  - Member hash accounts (read-only remaining accounts)
- Behavior
  - Validates members; fingerprints each; hashes the sequence; stores a compact source variant.
- Postconditions
  - Pack hash exists; payer has a vote on the pack.
- Failure Cases
  - No members, wrong program ownership, member not initialized, invalid seeds.

---

## Proof Validity Checklist

Use the following checks to validate proofs in any environment:

- Confirm the canonical identifier you computed matches the hash account PDA on chain.
- Verify the account is initialized (created time is non-zero) and owned by the program.
- Optionally call the verify instruction to perform a no-op existence check.
- Inspect voter count and, if relevant, ensure the expected wallet has an active vote.
- For branches, confirm the parent ID and generation in the source reflect the intended lineage.
- For batches and packs, ensure the set or order of members matches what you intended to aggregate.
