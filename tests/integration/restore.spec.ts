import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { waitForChainTimeAfter } from "../support/clock";
import {
  canonicalHashId,
  hashAccountSpace,
  RestoreProofInput,
  VOTE_INFO_SPACE,
} from "../../app/sdk/hashTimestamp";
import {
  airdrop,
  client,
  expectProgramError,
  deriveBranchHash,
  deriveBranchHashId,
  deriveGenesisHashId,
  errorCodeOf,
  generationOf,
  hashLamports,
  hashSourceOf,
  Keypair,
  provider,
  randomHash,
  sourceKindOf,
  toNum,
} from "../support/integration";

import {
  cloneBytes,
  cloneHashBytes,
  cloneProof,
  cloneProofLink,
  createdAtOf,
  encodeProofForProgram,
  fingerprintFromAccount,
  hexOf,
  prepareAccountChain,
  prepareBatchChain,
  prepareBranchChain,
  preparePackChain,
  restoreAccountPairs,
  restoreBuilder,
  toBigIntLike,
  toProofLink,
} from "../support/restore-fixtures";

describe("restore instruction", () => {
  before(async () => {
    await airdrop(provider.wallet.publicKey, 2 * LAMPORTS_PER_SOL);
  });

  it("restores an ancestor hash using a valid proof chain", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId, restoredHashIds } =
      await prepareBranchChain();

    const tipAccount = await client.fetchHashAccount(tipHashId);
    expect(tipAccount).to.not.equal(null);
    expect(Buffer.from((tipAccount as any).hash)).to.deep.equal(
      cloneHashBytes(proofChain[0].hash)
    );
    expect(hashSourceOf(tipAccount!)).to.deep.equal(proofChain[0].source);
    expect(createdAtOf(tipAccount!)).to.eq(proofChain[0].createdAt);

    const { restoredIds } = await client.restore(cloneProof(proofChain));
    expect(restoredIds.map(hexOf)).to.deep.equal(restoredHashIds.map(hexOf));

    const targetAccount = await client.fetchHashAccount(targetHashId);
    expect(targetAccount).to.not.equal(null);
    expect(createdAtOf(targetAccount!)).to.eq(targetLink.createdAt);
    expect(hashSourceOf(targetAccount!)).to.deep.equal(targetLink.source);

    for (const id of restoredHashIds) {
      const restoredAccount = await client.fetchHashAccount(id);
      expect(restoredAccount).to.not.equal(null);
    }

    for (const id of restoredHashIds) {
      await client.unvote(id);
      expect(await client.fetchHashAccount(id)).to.equal(null);
    }

    await client.unvote(tipHashId);
  });

  it("validates a complete proof without materializing missing ancestors", async () => {
    const { proofChain, tipHashId, restoredHashIds } =
      await prepareBranchChain();

    const { restoredIds } = await client.restore(cloneProof(proofChain), {
      createAccounts: false,
    });

    expect(restoredIds).to.deep.equal([]);
    for (const id of restoredHashIds) {
      expect(await client.fetchHashAccount(id)).to.equal(
        null,
        "validation-only restore must not create an account"
      );
    }

    await client.unvote(tipHashId);
  });

  it("accepts restore account-pair groups in any order", async () => {
    const { proofChain, tipHashId, restoredHashIds } =
      await prepareBranchChain();
    const proof = encodeProofForProgram(proofChain);
    const reversedPairs = proofChain
      .slice(1)
      .reverse()
      .flatMap((link) => {
        const canonical = canonicalHashId(
          cloneHashBytes(link.hash),
          link.source
        );
        return [
          {
            pubkey: client.hashPda(canonical),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: client.votePda(canonical, provider.wallet.publicKey),
            isSigner: false,
            isWritable: true,
          },
        ];
      });

    await client.program.methods
      .restore(proof)
      .accountsStrict({
        payer: provider.wallet.publicKey,
        anchorHashAccount: client.hashPda(tipHashId),
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(reversedPairs)
      .rpc();

    for (const id of restoredHashIds) {
      expect(await client.fetchHashAccount(id)).to.not.equal(null);
      await client.unvote(id);
    }
    await client.unvote(tipHashId);
  });

  it("restores only hashes that include full parameters", async () => {
    const { proofChain, tipHashId, restoredHashIds } =
      await prepareBranchChain();

    const branchId = restoredHashIds[0];
    const rawHashId = restoredHashIds[1];

    expect(await client.fetchHashAccount(branchId)).to.equal(null);
    expect(await client.fetchHashAccount(rawHashId)).to.equal(null);

    const partialProof = cloneProof(proofChain);
    partialProof[partialProof.length - 1].params = null;

    const { restoredIds } = await client.restore(partialProof);

    expect(restoredIds.map(hexOf)).to.deep.equal([hexOf(branchId)]);
    expect(await client.fetchHashAccount(branchId)).to.not.equal(null);
    expect(await client.fetchHashAccount(rawHashId)).to.equal(null);

    await client.unvote(branchId);
    await client.unvote(tipHashId);
  });

  for (const destination of ["hash", "vote"] as const) {
    it(`rejects a read-only missing restore ${destination} before any creation CPI`, async () => {
      const { proofChain, tipHashId, restoredHashIds } =
        await prepareBranchChain();
      const remaining = restoreAccountPairs(proofChain);
      // This intermediate branch executes after the root, so a late guard
      // would already have performed at least one complete record creation.
      remaining[destination === "hash" ? 0 : 1].isWritable = false;
      const anchorBefore = await provider.connection.getAccountInfo(
        client.hashPda(tipHashId)
      );
      try {
        const tx = await restoreBuilder(proofChain, remaining).transaction();
        tx.feePayer = provider.wallet.publicKey;
        const { value } = await provider.connection.simulateTransaction(tx);
        expect(value.err).to.deep.equal({
          InstructionError: [0, { Custom: 2000 }],
        });
        expect(value.logs).to.be.an("array").and.not.empty;
        expect(
          value.logs!.some((line) =>
            line.startsWith(
              `Program ${SystemProgram.programId.toBase58()} invoke [`
            )
          )
        ).to.equal(false);
        expect(
          value.logs!.some((line) => line.includes("checkpoint=record.created"))
        ).to.equal(false);
        for (const id of restoredHashIds) {
          expect(
            await provider.connection.getAccountInfo(client.hashPda(id))
          ).to.equal(null);
          expect(
            await provider.connection.getAccountInfo(
              client.votePda(id, provider.wallet.publicKey)
            )
          ).to.equal(null);
        }
        expect(
          await provider.connection.getAccountInfo(client.hashPda(tipHashId))
        ).to.deep.equal(anchorBefore);
      } finally {
        await client.unvote(tipHashId);
      }
    });
  }

  for (const voteState of ["existing", "vacant"] as const) {
    it(`accepts read-only existing restore records with a ${voteState} vote`, async () => {
      const { proofChain, tipHashId, restoredHashIds } =
        await prepareBranchChain();
      await client.restore(proofChain);
      const otherPayer =
        voteState === "vacant" ? Keypair.generate() : undefined;
      const payer = otherPayer?.publicKey ?? provider.wallet.publicKey;
      const remaining = restoreAccountPairs(proofChain, payer).map((meta) => ({
        ...meta,
        isWritable: false,
      }));
      const keys = [
        client.hashPda(tipHashId),
        ...remaining.map((meta) => meta.pubkey),
      ];
      const before = await provider.connection.getMultipleAccountsInfo(keys);
      try {
        const builder = restoreBuilder(proofChain, remaining, payer);
        await (otherPayer ? builder.signers([otherPayer]) : builder).rpc();
        expect(
          await provider.connection.getMultipleAccountsInfo(keys)
        ).to.deep.equal(before);
        if (voteState === "vacant") {
          for (const id of restoredHashIds) {
            expect(await client.fetchVoteInfo(id, payer)).to.equal(null);
          }
        }
      } finally {
        for (const id of restoredHashIds) await client.unvote(id);
        await client.unvote(tipHashId);
      }
    });
  }

  it("rejects proofs that contain disconnected hashes", async () => {
    const { targetLink, proofChain, tipHashId } = await prepareBranchChain();

    const extraHash = randomHash();
    const disconnected: RestoreProofInput = {
      hash: cloneHashBytes(extraHash),
      source: { kind: "hash" },
      createdAt: 123,
      params: { kind: "hash", payload: cloneBytes(extraHash) },
    };

    const tampered = cloneProof(proofChain);
    tampered.push(disconnected);

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail(
        "restore should fail when proof chain contains disconnected hashes"
      );
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6021);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("rejects proof chains with duplicated canonical ids", async () => {
    const { proofChain, tipHashId } = await prepareBranchChain();

    const duplicate = cloneProof(proofChain);
    expect(duplicate.length).to.be.greaterThan(1);
    duplicate.push(cloneProofLink(duplicate[1]));

    try {
      await client.restore(duplicate, { createAccounts: false });
      expect.fail("restore should fail when proof chain has duplicate ids");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6015);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("rejects calls with odd remaining-account lists", async () => {
    const { proofChain, tipHashId } = await prepareBranchChain();
    const proof = encodeProofForProgram(proofChain);

    try {
      await client.program.methods
        .restore(proof)
        .accountsStrict({
          payer: provider.wallet.publicKey,
          anchorHashAccount: client.hashPda(tipHashId),
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          {
            pubkey: Keypair.generate().publicKey,
            isSigner: false,
            isWritable: true,
          },
        ])
        .rpc();
      expect.fail("restore should fail when remaining accounts count is odd");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6024);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("rejects wrong vote account for a remaining proof link", async () => {
    const { proofChain, tipHashId } = await prepareBranchChain();
    const proof = encodeProofForProgram(proofChain);

    const remainingAccounts = proofChain
      .slice(1)
      .map((link, index) => {
        const canonical = canonicalHashId(
          cloneHashBytes(link.hash),
          link.source
        );
        return [
          {
            pubkey: client.hashPda(canonical),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey:
              index === 0
                ? Keypair.generate().publicKey
                : client.votePda(canonical, provider.wallet.publicKey),
            isSigner: false,
            isWritable: true,
          },
        ];
      })
      .flat();

    try {
      await client.program.methods
        .restore(proof)
        .accountsStrict({
          payer: provider.wallet.publicKey,
          anchorHashAccount: client.hashPda(tipHashId),
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();
      expect.fail("restore should fail when vote PDA does not match the hash");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6001);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("rejects proofs that do not match the chain tip", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId } =
      await prepareBranchChain();
    const tampered = cloneProof(proofChain);
    tampered[0].hash = randomHash();

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when tip proof is tampered");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6020);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  for (const [field, errorCode] of [
    ["payload", 6021],
    ["generation", 6023],
  ] as const) {
    it(`rejects a modified intermediate branch ${field} after validating the unchanged anchor`, async () => {
      const { proofChain, tipHashId, restoredHashIds } =
        await prepareBranchChain();
      const tampered = cloneProof(proofChain);
      const source = tampered[1].source;
      if (source.kind !== "branch")
        throw new Error("expected intermediate branch");
      if (field === "payload") source.payload = randomHash();
      else source.generation += 2n;
      expect(tampered[0]).to.deep.equal(proofChain[0]);
      const anchorAddress = client.hashPda(tipHashId);
      const anchorBefore = await provider.connection.getAccountInfo(
        anchorAddress
      );
      try {
        await expectProgramError(client.restore(tampered), errorCode);
        const destinations = restoredHashIds.flatMap((id) => [
          client.hashPda(id),
          client.votePda(id, provider.wallet.publicKey),
        ]);
        expect(
          await provider.connection.getMultipleAccountsInfo(destinations)
        ).to.deep.equal(destinations.map(() => null));
        expect(
          await provider.connection.getAccountInfo(anchorAddress)
        ).to.deep.equal(anchorBefore);
      } finally {
        await client.unvote(tipHashId);
      }
    });
  }

  it("leaves every missing ancestor absent when proof validation fails", async () => {
    const { proofChain, tipHashId, restoredHashIds } =
      await prepareBranchChain();
    const tampered = cloneProof(proofChain);
    const tipParams = tampered[0].params;
    if (!tipParams || tipParams.kind !== "branch") {
      throw new Error("expected branch parameters on the proof tip");
    }
    tipParams.parent.createdAt = toBigIntLike(tipParams.parent.createdAt) + 1n;

    try {
      await client.restore(tampered);
      expect.fail("restore should reject a late parent-fingerprint mismatch");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6020);
    }

    for (const id of restoredHashIds) {
      expect(await client.fetchHashAccount(id)).to.equal(
        null,
        "failed proof validation must not materialize an earlier graph node"
      );
    }
    expect(await client.fetchHashAccount(tipHashId)).to.not.equal(null);
    await client.unvote(tipHashId);
  });

  it("validates an existing ancestor without adding a missing payer vote", async () => {
    const genesisPayload = randomHash();
    const genesisId = deriveGenesisHashId(genesisPayload);
    await client.register(genesisPayload);

    const genesisAccount = await client.fetchHashAccount(genesisId);
    expect(genesisAccount).to.not.equal(null);

    const branchPayload = randomHash();
    await client.branch(genesisId, branchPayload, false);
    const branchHash = deriveBranchHash(
      genesisId,
      createdAtOf(genesisAccount!),
      generationOf(genesisAccount!),
      sourceKindOf(genesisAccount!),
      branchPayload
    );
    const branchId = deriveBranchHashId(branchHash);
    const branchAccount = await client.fetchHashAccount(branchId);
    expect(branchAccount).to.not.equal(null);

    const proof: RestoreProofInput[] = [
      toProofLink(branchAccount!, {
        branchParent: fingerprintFromAccount(genesisAccount!),
      }),
      toProofLink(genesisAccount!, { hashPayload: genesisPayload }),
    ];
    const otherPayer = Keypair.generate();
    await airdrop(otherPayer.publicKey, LAMPORTS_PER_SOL);
    expect(
      await client.fetchVoteInfo(genesisId, otherPayer.publicKey)
    ).to.equal(null);

    const beforeVoters = toNum(genesisAccount!.voters);
    const { restoredIds } = await client.restore(proof, otherPayer);

    expect(restoredIds.map(hexOf)).to.deep.equal([hexOf(genesisId)]);
    const existingAfter = await client.fetchHashAccount(genesisId);
    expect(existingAfter).to.not.equal(null);
    expect(toNum(existingAfter!.voters)).to.equal(beforeVoters);
    expect(
      await client.fetchVoteInfo(genesisId, otherPayer.publicKey)
    ).to.equal(
      null,
      "restore validates a vacant supplied vote PDA but does not add a vote to an existing hash"
    );

    await client.unvote(branchId);
    await client.unvote(genesisId);
  });

  it("rejects proofs where the tip timestamp is altered", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId } =
      await prepareBranchChain();
    const tampered = cloneProof(proofChain);
    tampered[0].createdAt = Number(tampered[0].createdAt) + 1;

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when tip timestamp is tampered");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6020);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("rejects an existing-hash timestamp conflict before creating any records", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId, restoredHashIds } =
      await prepareBranchChain();

    let recreated = false;
    try {
      await waitForChainTimeAfter(
        provider.connection,
        toBigIntLike(targetLink.createdAt)
      );
      await client.register(cloneHashBytes(targetLink.hash));
      recreated = true;
      const existingBefore = await client.fetchHashAccount(targetHashId);
      expect(existingBefore).to.not.equal(null);
      expect(createdAtOf(existingBefore!)).to.be.greaterThan(
        Number(targetLink.createdAt)
      );
      const existingLamportsBefore = await hashLamports(targetHashId);
      await expectProgramError(client.restore(cloneProof(proofChain)), 6022);
      for (const id of restoredHashIds) {
        if (!Buffer.from(id).equals(Buffer.from(targetHashId))) {
          expect(await client.fetchHashAccount(id)).to.equal(null);
        }
      }
      expect(await client.fetchHashAccount(targetHashId)).to.deep.equal(
        existingBefore
      );
      expect(await hashLamports(targetHashId)).to.equal(existingLamportsBefore);
    } finally {
      if (recreated) await client.unvote(targetHashId);
      await client.unvote(tipHashId);
    }
  });

  it("rolls back earlier restore creations when a later CPI runs out of funds", async () => {
    const { proofChain, tipHashId, restoredHashIds } =
      await prepareBranchChain();
    const payer = Keypair.generate();
    const root = proofChain[proofChain.length - 1];
    const hashRent =
      await provider.connection.getMinimumBalanceForRentExemption(
        hashAccountSpace(root.source)
      );
    const voteRent =
      await provider.connection.getMinimumBalanceForRentExemption(
        VOTE_INFO_SPACE
      );
    const funding = hashRent + voteRent + 100;
    const anchorBefore = await provider.connection.getAccountInfo(
      client.hashPda(tipHashId)
    );
    try {
      // A separate provider wallet pays transaction fees, so the instruction
      // payer balance must be restored exactly when the later creation fails.
      await provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: payer.publicKey,
            lamports: funding,
          })
        )
      );
      const tx = await restoreBuilder(
        proofChain,
        restoreAccountPairs(proofChain, payer.publicKey),
        payer.publicKey
      ).transaction();
      tx.feePayer = provider.wallet.publicKey;
      const latest = await provider.connection.getLatestBlockhash();
      tx.recentBlockhash = latest.blockhash;
      tx.partialSign(payer);
      const signed = await provider.wallet.signTransaction(tx);
      const signature = await provider.connection.sendRawTransaction(
        signed.serialize(),
        { skipPreflight: true }
      );
      const confirmation = await provider.connection.confirmTransaction(
        { signature, ...latest },
        "confirmed"
      );
      expect(confirmation.value.err).to.deep.equal({
        InstructionError: [0, { Custom: 1 }],
      });
      const receipt = await provider.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      // The root hash and vote creation CPIs both succeeded before the next
      // creation failed. Use runtime logs so this oracle also works without debug-logs.
      expect(
        receipt?.meta?.logMessages?.filter(
          (line) =>
            line === `Program ${SystemProgram.programId.toBase58()} success`
        )
      ).to.have.length(2);
      expect(await provider.connection.getBalance(payer.publicKey)).to.equal(
        funding
      );
      for (const id of restoredHashIds) {
        expect(
          await provider.connection.getAccountInfo(client.hashPda(id))
        ).to.equal(null);
        expect(
          await provider.connection.getAccountInfo(
            client.votePda(id, payer.publicKey)
          )
        ).to.equal(null);
      }
      expect(
        await provider.connection.getAccountInfo(client.hashPda(tipHashId))
      ).to.deep.equal(anchorBefore);
    } finally {
      const balance = await provider.connection.getBalance(payer.publicKey);
      if (balance > 0) {
        await provider.sendAndConfirm(
          new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: provider.wallet.publicKey,
              lamports: balance,
            })
          ),
          [payer]
        );
      }
      await client.unvote(tipHashId);
    }
  });

  it("requires a snapshot when an existing Account ancestor is omitted from the call", async () => {
    const { proofChain, tipHashId, restoredHashIds } =
      await prepareAccountChain();
    await client.restore(proofChain);
    const proof = cloneProof(proofChain);
    proof[1].params = { kind: "account" };
    const keys = [
      client.hashPda(tipHashId),
      ...restoreAccountPairs(proof).map((meta) => meta.pubkey),
    ];
    const before = await provider.connection.getMultipleAccountsInfo(keys);
    try {
      // The supplied existing hash record authenticates the omitted snapshot.
      await client.restore(proof);
      const tx = await restoreBuilder(proof, []).transaction();
      tx.feePayer = provider.wallet.publicKey;
      const { value } = await provider.connection.simulateTransaction(tx);
      expect(value.err).to.deep.equal({
        InstructionError: [0, { Custom: 6019 }],
      });
      expect(
        await provider.connection.getMultipleAccountsInfo(keys)
      ).to.deep.equal(before);
    } finally {
      for (const id of restoredHashIds) await client.unvote(id);
      await client.unvote(tipHashId);
    }
  });

  it("rejects proofs that omit hash payloads for hash links", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId } =
      await prepareBranchChain();
    const tampered = cloneProof(proofChain);
    const oldestIndex = tampered.length - 1;
    const hashLink = tampered[oldestIndex];
    if (!hashLink.params || hashLink.params.kind !== "hash") {
      throw new Error("expected hash variant for genesis proof link");
    }
    hashLink.params.payload = Buffer.alloc(0);

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when hash payload is missing");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6018);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("rejects proofs with incorrect hash payload data", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId } =
      await prepareBranchChain();
    const tampered = cloneProof(proofChain);
    const oldestIndex = tampered.length - 1;
    const hashLink = tampered[oldestIndex];
    if (!hashLink.params || hashLink.params.kind !== "hash") {
      throw new Error("expected hash variant for genesis proof link");
    }
    hashLink.params.payload = cloneBytes(randomHash());

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when hash payload is incorrect");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6021);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("restores an account hash using a snapshot proof", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId, restoredHashIds } =
      await prepareAccountChain();

    const { restoredIds } = await client.restore(cloneProof(proofChain));
    expect(restoredIds.map(hexOf)).to.deep.equal(restoredHashIds.map(hexOf));

    const restoredAccount = await client.fetchHashAccount(targetHashId);
    expect(restoredAccount).to.not.equal(null);
    expect(hashSourceOf(restoredAccount!)).to.deep.equal(targetLink.source);
    expect(createdAtOf(restoredAccount!)).to.eq(targetLink.createdAt);

    for (const id of restoredHashIds) {
      await client.unvote(id);
      expect(await client.fetchHashAccount(id)).to.equal(null);
    }

    await client.unvote(tipHashId);
  });

  it("rejects account hash proofs without snapshots", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId } =
      await prepareAccountChain();
    const tampered = cloneProof(proofChain);
    const accountIndex = 1;
    const accountLink = tampered[accountIndex];
    if (!accountLink.params || accountLink.params.kind !== "account") {
      throw new Error("expected account variant in proof chain");
    }
    accountLink.params.snapshot = undefined;

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when account snapshot is missing");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6019);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("rejects account hash proof links without parameters", async () => {
    const { proofChain, tipHashId } = await prepareAccountChain();
    const tampered = cloneProof(proofChain);
    tampered[1].params = null;

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when account parameters are missing");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6021);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("restores a batch hash using member proofs", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId, restoredHashIds } =
      await prepareBatchChain();

    const { restoredIds } = await client.restore(cloneProof(proofChain));
    expect(restoredIds.map(hexOf)).to.deep.equal(restoredHashIds.map(hexOf));

    const restoredBatch = await client.fetchHashAccount(targetHashId);
    expect(restoredBatch).to.not.equal(null);
    expect(hashSourceOf(restoredBatch!)).to.deep.equal(targetLink.source);

    for (const id of restoredHashIds) {
      await client.unvote(id);
      expect(await client.fetchHashAccount(id)).to.equal(null);
    }

    await client.unvote(tipHashId);
  });

  it("rejects batch proofs without member fingerprints", async () => {
    const { targetLink, proofChain, tipHashId } = await prepareBatchChain();
    const tampered = cloneProof(proofChain);
    const batchIndex = 1;
    const batchLink = tampered[batchIndex];
    if (!batchLink.params || batchLink.params.kind !== "batch") {
      throw new Error("expected batch variant in proof chain");
    }
    batchLink.params.members = [];

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when batch members are missing");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6010);
    } finally {
      await client.unvote(tipHashId);
    }
  });

  it("restores a pack hash using member proofs", async () => {
    const { targetHashId, targetLink, proofChain, tipHashId, restoredHashIds } =
      await preparePackChain();

    const { restoredIds } = await client.restore(cloneProof(proofChain));
    expect(restoredIds.map(hexOf)).to.deep.equal(restoredHashIds.map(hexOf));

    const restoredPack = await client.fetchHashAccount(targetHashId);
    expect(restoredPack).to.not.equal(null);
    expect(hashSourceOf(restoredPack!)).to.deep.equal(targetLink.source);

    for (const id of restoredHashIds) {
      await client.unvote(id);
      expect(await client.fetchHashAccount(id)).to.equal(null);
    }

    await client.unvote(tipHashId);
  });

  it("rejects pack proofs without member fingerprints", async () => {
    const { targetLink, proofChain, tipHashId, restoredHashIds } =
      await preparePackChain();
    const tampered = cloneProof(proofChain);
    const packIndex = 1;
    const packLink = tampered[packIndex];
    if (!packLink.params || packLink.params.kind !== "pack") {
      throw new Error("expected pack variant in proof chain");
    }
    packLink.params.members = [];

    try {
      await client.restore(tampered, { createAccounts: false });
      expect.fail("restore should fail when pack members are missing");
    } catch (err) {
      expect(errorCodeOf(err)).to.eq(6017);
    } finally {
      await client.unvote(tipHashId);
      for (const id of restoredHashIds.slice(1)) {
        await client.unvote(id);
        expect(await client.fetchHashAccount(id)).to.equal(null);
      }
    }
  });

  it("rejects empty proof chains", async () => {
    await expectProgramError(
      client.restore([], { createAccounts: false }),
      6014
    );
  });
});
