import { expect } from "chai";
import {
  client,
  deriveGenesisHashId,
  derivePackHash,
  derivePackHashId,
  errorCodeOf,
  getRentMinimums,
  hashLamports,
  HashSourceKind,
  hashSourceOf,
  Keypair,
  provider,
  randomHash,
  rentForSource,
  sourceKindOf,
  toNum,
  voteLamports,
} from "../support/integration";
import { SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

describe("pack instruction", () => {
  let rentMin: number;
  let voteRentMin: number;

  before(async () => {
    ({ hash: rentMin, vote: voteRentMin } = await getRentMinimums());
  });

  it("creates a minimal pack hash from member hashes", async () => {
    const payloadA = randomHash();
    const payloadB = randomHash();
    const hashIdA = deriveGenesisHashId(payloadA);
    const hashIdB = deriveGenesisHashId(payloadB);

    await client.register(payloadA);
    await client.register(payloadB);

    const accountA = await client.fetchHashAccount(hashIdA);
    const accountB = await client.fetchHashAccount(hashIdB);
    expect(accountA).to.not.equal(null);
    expect(accountB).to.not.equal(null);

    const memberCreatedAts = [
      BigInt(
        toNum(
          (accountA as any)?.createdAt ?? (accountA as any)?.created_at ?? 0
        )
      ),
      BigInt(
        toNum(
          (accountB as any)?.createdAt ?? (accountB as any)?.created_at ?? 0
        )
      ),
    ];
    const memberKinds = [sourceKindOf(accountA!), sourceKindOf(accountB!)];
    const memberHashes = [
      Buffer.from((accountA as any)?.hash ?? []),
      Buffer.from((accountB as any)?.hash ?? []),
    ];
    const expectedPackHash = derivePackHash([
      {
        hash: memberHashes[0],
        kind: memberKinds[0],
        createdAt: memberCreatedAts[0],
      },
      {
        hash: memberHashes[1],
        kind: memberKinds[1],
        createdAt: memberCreatedAts[1],
      },
    ]);
    const expectedPackId = derivePackHashId(expectedPackHash);

    const { packId } = await client.pack([hashIdA, hashIdB]);
    expect(Buffer.from(packId)).to.deep.equal(Buffer.from(expectedPackId));

    const packAccount = await client.fetchHashAccount(packId);
    expect(packAccount).to.not.equal(null);

    const packSource = hashSourceOf(packAccount!);
    expect(packSource.kind).to.eq("pack");
    expect(sourceKindOf(packAccount!)).to.eq(HashSourceKind.Pack);

    const expectedRent = await rentForSource(packSource);
    expect(Buffer.from((packAccount as any)?.hash ?? [])).to.deep.equal(
      Buffer.from(expectedPackHash)
    );
    expect(toNum((packAccount as any)?.voters ?? 0)).to.eq(1);
    expect(expectedRent).to.eq(rentMin);

    const packVote = await client.fetchVoteInfo(
      packId,
      provider.wallet.publicKey
    );
    expect(packVote).to.not.equal(null);
    expect(toNum(packVote!.amount)).to.eq(expectedRent);
    expect(await voteLamports(packId, provider.wallet.publicKey)).to.eq(
      voteRentMin
    );
    expect(await hashLamports(packId)).to.eq(expectedRent);

    await client.unvote(packId);
    await client.unvote(hashIdA);
    await client.unvote(hashIdB);
  });

  it("requires at least one member hash", async () => {
    const fakeId = Buffer.alloc(32, 5);
    const packPda = client.hashPda(fakeId);
    const votePda = client.votePda(fakeId, provider.wallet.publicKey);

    try {
      await client.program.methods
        .pack()
        .accountsStrict({
          hashAccount: packPda,
          voteInfo: votePda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([])
        .rpc();
      expect.fail("pack should fail with empty members");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6012);
    }
  });

  it("rejects member accounts owned by other programs", async () => {
    const outsider = Keypair.generate();
    const rent = await provider.connection.getMinimumBalanceForRentExemption(0);
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: outsider.publicKey,
        lamports: rent,
        space: 0,
        programId: SystemProgram.programId,
      })
    );
    await provider.sendAndConfirm(tx, [outsider]);

    const fakeId = Buffer.alloc(32, 9);
    const packPda = client.hashPda(fakeId);
    const votePda = client.votePda(fakeId, provider.wallet.publicKey);

    try {
      await client.program.methods
        .pack()
        .accountsStrict({
          hashAccount: packPda,
          voteInfo: votePda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: outsider.publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();
      expect.fail("pack should reject non program-owned members");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6013);
    }
  });

  it("rejects duplicate canonical member IDs on chain", async () => {
    const payload = randomHash();
    const hashId = deriveGenesisHashId(payload);
    await client.register(payload);

    const account = await client.fetchHashAccount(hashId);
    expect(account).to.not.equal(null);
    const fingerprint = {
      hash: Buffer.from((account as any)?.hash ?? []),
      kind: sourceKindOf(account!),
      createdAt: BigInt(
        toNum((account as any)?.createdAt ?? (account as any)?.created_at ?? 0)
      ),
    };
    const duplicatePackHash = derivePackHash([fingerprint, fingerprint]);
    const duplicatePackId = derivePackHashId(duplicatePackHash);
    const duplicatePackPda = client.hashPda(duplicatePackId);
    const duplicateVotePda = client.votePda(
      duplicatePackId,
      provider.wallet.publicKey
    );
    const memberPda = client.hashPda(hashId);

    try {
      await client.program.methods
        .pack()
        .accountsStrict({
          hashAccount: duplicatePackPda,
          voteInfo: duplicateVotePda,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: memberPda, isSigner: false, isWritable: false },
          { pubkey: memberPda, isSigner: false, isWritable: false },
        ])
        .rpc();
      expect.fail("pack should reject duplicate canonical member IDs");
    } catch (err: any) {
      expect(errorCodeOf(err)).to.eq(6027);
    } finally {
      if (await client.fetchHashAccount(duplicatePackId)) {
        await client.unvote(duplicatePackId);
      }
      await client.unvote(hashId);
    }
  });
});
