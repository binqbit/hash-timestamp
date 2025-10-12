# Architecture

Hash Timestamp is organised around a small set of concepts that keep hash proofs deterministic and easy to audit on Solana. This note explains those building blocks without tying them to individual source files.

## State Model

Two account types drive the program:

- **HashAccount** records the registered hash value, the description of how that hash was produced, the current voter count, the creation timestamp, and a PDA bump so the account can always be regenerated. Each hash account is funded by the first voter and remains rent exempt while at least one vote exists.
- **VoteInfo** tracks a single voter’s deposit. It stores the voter public key, the canonical identifier of the hash they support, the lamports locked for rent, and its PDA bump. Removing the vote returns the deposit and may close the related hash when no other voters remain.

The serialized sizes of these accounts are fixed so that every client can compute the rent-exempt minimum required to create them.

## Hash Sources

Every hash carries a **HashSource** that explains its origin. The variants are:

- **Hash** – a raw 32-byte payload supplied directly by a user.
- **Account** – a digest derived from another Solana account’s metadata (public key, owner, lamports, executable flag, rent epoch, length, and contents).
- **Branch** – a child hash derived from an existing hash, coupled with a payload and an incremented generation.
- **Batch** – an aggregate that preserves the list of member canonical identifiers.
- **Pack** – a compact aggregate that skips the member list and retains only fingerprints.

Each variant exposes a discriminator value. The canonical identifier of a hash is computed as `sha256(hash_bytes || discriminator)`, making the address deterministic even when two workflows produce the same raw bytes.

## Program Derived Addresses

Hash Timestamp uses predictable PDAs:

- Hash accounts rely on the seed prefix `hash` plus the canonical identifier.
- Vote accounts rely on the prefix `vote` plus the voter public key and the same canonical identifier.

Reusable helpers inside the program wrap these seeds so that account creation, CPI calls, and closing logic always use the same ordering.

## Lifecycle and Rent

When a hash is created, the program simultaneously creates its associated vote account. The payer deposits the exact rent minimum for both accounts. Subsequent voters deposit the same minimum when invoking the `vote` instruction. Removing a vote refunds the deposit and decreases the hash’s voter count; if the caller was the last voter, the hash account is closed and the remaining lamports are returned as well.

## Composition Patterns

The program supports several higher-level flows:

- **Registration** simply writes a user-provided hash and casts the first vote.
- **Account hashing** anchors external account metadata so it can be referenced later.
- **Branching** derives a new hash from an existing one, optionally migrating the caller’s vote to the child hash and incrementing the generation count.
- **Batching** and **packing** aggregate multiple existing hashes into a single digest; batching keeps the membership list while packing stores only compact fingerprints.

Snapshots of existing hash accounts are used when composing new hashes so that derived values remain deterministic and verifiable.

## How Instructions Fit Together

- **register** creates the first hash and vote for a given payload. It is the entry point for new proofs.
- **account** produces a hash from arbitrary account metadata, letting teams anchor on-chain state without manual preprocessing.
- **vote** adds a supporter to an existing hash and ensures the rent deposit is in place. **unvote** removes that support and handles clean-up when hashes become obsolete.
- **branch** evolves an existing hash while preserving lineage. It can migrate the caller’s vote so the new branch inherits their deposit.
- **batch** and **pack** prove that multiple prior hashes were considered together, with different trade-offs between transparency and storage.
- **verify** is a lightweight existence check that lets clients confirm a hash is still live without mutating state.

Together these instructions let developers register data, prove when it first gained support, compose more complex structures, and finally retire hashes when they are no longer needed. Clients use the SDK to prepare PDAs, submit transactions, and read back account data so that every proof can be validated off-chain. The shared principles—fixed account sizes, deterministic seeds, and explicit sources—make the project predictable for any integration.**_ End Patch_** End Patch to=functions.apply_patch
