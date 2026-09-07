# Application Integration

Application-level state handling and recovery. For client construction and method
signatures, use the [SDK guide](sdk.md); for protocol rules, use the
[instruction reference](instructions.md).

## Configure the client

Create a `Program<HashTimestamp>` with the target deployment's IDL, program
address, connection and signing provider. Derive IDs and PDAs through the SDK,
rather than copying addresses into application code.

Fund the instruction payer for account creation/deposits and the provider wallet
for transaction fees. They can be different wallets; see [signing and fees](sdk.md#signing-rent-and-fees).

## Coordinate transactions and reads

1. Derive the appropriate canonical ID and submit the operation.
2. Confirm the transaction result before starting dependent operations.
3. Read `HashAccount`/`VoteInfo` if the next operation depends on current state.
4. Save proof data before withdrawing votes that may close historical records.

RPC reads observe current state, not an immutable receipt of your transaction.
Branch, aggregate and account-metadata prefetches do not lock state or form an
atomic snapshot with the later transaction. If state changes, re-read and
re-derive affected inputs.

Use `fetchHashAccount` for an existence read. A separate `verify` transaction
does not reserve the record for a later operation. Refresh rent estimates when
planning funding rather than treating a cached value as permanent.

## Retain recovery data

Persist the information needed to build a complete `RestoreProofInput[]`:

- raw hashes, canonical IDs and full sources;
- exact historical timestamps and generations;
- ordered member/parent fingerprints;
- Account snapshots when required, including their raw data;
- transaction signatures and the live anchor identity.

Keep separate historical incarnations in your application storage: a closed
canonical ID/PDA may be recreated with a different timestamp. Do not replace old
proof metadata with whichever record an RPC read returns today.

IDs and signatures alone are not a complete recovery archive. Batch stores
member IDs, not the full proof; Pack stores no member list. Retain a live anchor
and check proof size before relying on recovery. The
[restore reference](instructions.md#restore) explains closure, snapshot and
materialization restrictions.

## Handle failures by category

- **Invalid input or proof:** correct the data before retrying. Do not alter
  historical timestamps to match an unrelated current record.
- **State conflict:** re-read state. An occupied PDA can block restoration while
  the old history remains provable through an unchanged anchor.
- **Funding or reserve failure:** refresh rent/balances and fund the appropriate
  account or wallet. Failed program effects roll back, but execution fees remain charged.
- **RPC/transport failure:** preserve the original error. If submission status
  is uncertain, check the signature and resulting state before resubmitting.

Use structured Anchor errors where available; SDK validation and transport
errors are distinct. Error decoding is shown in the [SDK guide](sdk.md#inputs-encoders-and-errors);
instruction-specific failures are listed in the [contract reference](instructions.md).
