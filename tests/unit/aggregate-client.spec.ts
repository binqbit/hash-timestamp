import { expect } from "chai";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { HashTimestamp } from "../../target/types/hash_timestamp";
import {
  HashTimestampClient,
  HashSourceKind,
  canonicalHashId,
  deriveBatchHash,
  deriveGenesisHashId,
} from "../../app/sdk/hashTimestamp";

type Aggregate = "batch" | "pack";

function fixture() {
  const payer = Keypair.fromSeed(new Uint8Array(32).fill(42));
  const hashes = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];
  const ids = hashes.map(deriveGenesisHashId);
  const snapshots: any[] = hashes.map((hash, index) => ({
    hash: [...hash],
    source: { hash: {} },
    createdAt: BigInt(100 + index),
  }));
  const fetched: string[] = [];
  const captured: {
    instruction?: Aggregate;
    accounts?: any;
    remaining?: any[];
    signers?: Keypair[];
  } = {};
  const builder = {
    accountsStrict(accounts: any) {
      captured.accounts = accounts;
      return builder;
    },
    remainingAccounts(accounts: any[]) {
      captured.remaining = accounts;
      return builder;
    },
    signers(signers: Keypair[]) {
      captured.signers = signers;
      return builder;
    },
    async rpc() {
      return "test-signature";
    },
  };
  const program = {
    programId: new PublicKey("4qHXrn8Z72fmDyvBBafJV7QujMJ7jKesa8C6zqcZry5k"),
    provider: {
      wallet: { publicKey: new PublicKey(Buffer.alloc(32, 99)) },
      connection: {},
    },
    methods: {
      batch: () => {
        captured.instruction = "batch";
        return builder;
      },
      pack: () => {
        captured.instruction = "pack";
        return builder;
      },
    },
    account: {
      hashAccount: {
        async fetchNullable(address: PublicKey) {
          fetched.push(address.toBase58());
          const index = ids.findIndex((id) =>
            client.hashPda(id).equals(address)
          );
          return index < 0 ? null : snapshots[index];
        },
      },
    },
  } as unknown as Program<HashTimestamp>;
  const client = new HashTimestampClient(program);
  return { client, payer, hashes, ids, snapshots, fetched, captured };
}

async function expectError(operation: Promise<unknown>, message: string) {
  try {
    await operation;
    expect.fail(`expected error: ${message}`);
  } catch (error: any) {
    expect(error.message).to.equal(message);
  }
}

describe("aggregate SDK preparation", () => {
  for (const kind of ["batch", "pack"] as Aggregate[]) {
    it(`${kind} preserves member order, derived accounts, and explicit payer`, async () => {
      const { client, payer, hashes, ids, fetched, captured } = fixture();
      const result = await client[kind]([ids[1], ids[0]], payer);
      const aggregateHash = deriveBatchHash([
        { hash: hashes[1], kind: HashSourceKind.Hash, createdAt: BigInt(101) },
        { hash: hashes[0], kind: HashSourceKind.Hash, createdAt: BigInt(100) },
      ]);
      const expectedId = canonicalHashId(
        aggregateHash,
        kind === "batch" ? HashSourceKind.Batch : HashSourceKind.Pack
      );
      const actualId = "batchId" in result ? result.batchId : result.packId;
      expect(Buffer.from(actualId)).to.deep.equal(Buffer.from(expectedId));
      expect(result.signature).to.equal("test-signature");
      expect(captured.instruction).to.equal(kind);
      expect(
        captured.accounts.systemProgram.equals(SystemProgram.programId)
      ).to.equal(true);
      expect(fetched).to.deep.equal(
        [ids[1], ids[0]].map((id) => client.hashPda(id).toBase58())
      );
      expect(
        captured.remaining!.map((meta) => meta.pubkey.toBase58())
      ).to.deep.equal(fetched);
      expect(
        captured.remaining!.every((meta) => !meta.isSigner && !meta.isWritable)
      ).to.equal(true);
      expect(
        captured.accounts.hashAccount.equals(client.hashPda(expectedId))
      ).to.equal(true);
      expect(
        captured.accounts.voteInfo.equals(
          client.votePda(expectedId, payer.publicKey)
        )
      ).to.equal(true);
      expect(captured.accounts.payer.equals(payer.publicKey)).to.equal(true);
      expect(captured.signers).to.deep.equal([payer]);
    });

    it(`${kind} rejects empty or duplicate membership before any fetch`, async () => {
      const { client, ids, fetched } = fixture();
      await expectError(
        client[kind]([]),
        `${kind} requires at least one member`
      );
      for (const alias of [
        ids[0],
        Buffer.from(ids[0]),
        Buffer.from(ids[0]).toString("hex"),
      ]) {
        await expectError(
          client[kind]([ids[0], alias]),
          `${kind} member IDs must be unique`
        );
      }
      expect(fetched).to.deep.equal([]);
    });

    it(`${kind} preserves mixed source kinds, BN timestamps and requested order`, async () => {
      const { client, hashes, ids, snapshots } = fixture();
      const timestamps = [new BN("9007199254740993"), new BN("-123")];
      snapshots[0].source = {
        account: { account: new PublicKey(Buffer.alloc(32, 12)) },
      };
      snapshots[0].createdAt = timestamps[0];
      snapshots[1].source = {
        branch: {
          previousHashId: [...hashes[0]],
          payload: [...hashes[1]],
          generation: new BN(2),
        },
      };
      delete snapshots[1].createdAt;
      snapshots[1].created_at = timestamps[1];
      ids[0] = canonicalHashId(hashes[0], HashSourceKind.Account);
      ids[1] = canonicalHashId(hashes[1], HashSourceKind.Branch);
      const result = await client[kind]([ids[1], ids[0]]);
      const digest = deriveBatchHash([
        {
          hash: hashes[1],
          kind: HashSourceKind.Branch,
          createdAt: timestamps[1],
        },
        {
          hash: hashes[0],
          kind: HashSourceKind.Account,
          createdAt: timestamps[0],
        },
      ]);
      expect(
        "batchId" in result ? result.batchId : result.packId
      ).to.deep.equal(
        canonicalHashId(
          digest,
          kind === "batch" ? HashSourceKind.Batch : HashSourceKind.Pack
        )
      );
    });

    it(`${kind} retains missing-member and malformed-snapshot errors`, async () => {
      const { client, ids, snapshots } = fixture();
      await expectError(
        client[kind]([Buffer.alloc(32, 9)]),
        `${kind} member hash not found`
      );
      // Timestamp validation across all members precedes hash validation.
      delete snapshots[0].hash;
      delete snapshots[1].createdAt;
      await expectError(client[kind](ids), `${kind} member missing created_at`);
      snapshots[1].created_at = BigInt(101);
      await expectError(client[kind](ids), `${kind} member missing hash value`);
    });
  }
});
