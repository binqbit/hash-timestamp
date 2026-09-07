import type { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionSignature,
} from "@solana/web3.js";
import { HashTimestamp } from "../../target/types/hash_timestamp";

import {
  AccountHashResult,
  BatchResult,
  HashAccountData,
  PackResult,
  RestoreOptions,
  RestoreResult,
  VoteInfoData,
  HashBytes,
  HashSourceKind,
  RestoreProofInput,
  CreationResult,
} from "./types";
import { to32Bytes, numberToU64 } from "./protocol/normalization";
import {
  canonicalHashId,
  deriveAccountMetadataHash,
  deriveBatchHash,
  deriveBatchHashId,
  deriveBranchHash,
  deriveGenesisHashId,
  derivePackHash,
  derivePackHashId,
} from "./protocol/hashes";
import { deriveHashPda, deriveVotePda } from "./protocol/addresses";
import { branchParentMetadata, fetchNullableAccount } from "./client/accounts";
import {
  loadAggregateMembers,
  normalizeUniqueMemberIds,
} from "./client/aggregate";
import { instructionPayer, submitInstruction } from "./client/transactions";
import { prepareRestore } from "./restore";
import { submitCreation } from "./client/archive";
import { archiveHex, archiveSource } from "./archive/values";
import type { HashArchive } from "./archive/model";
import type {
  ArchiveRestoreOptions,
  ArchiveRestorePlan,
  ArchiveRestoreResult,
} from "./archive/planning";
import {
  planArchiveRestore,
  executeArchiveRestore,
} from "./client/archive-restore";

/** High-level transaction and RPC API. Pass an Anchor Program configured for your cluster. */
export class HashTimestampClient {
  readonly program: Program<HashTimestamp>;

  constructor(program: Program<HashTimestamp>) {
    this.program = program;
  }

  get connection(): Connection {
    return this.program.provider.connection;
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  /** Pure address derivation. Takes a canonical ID, not a raw file hash. */
  hashPda(hashId: HashBytes): PublicKey {
    return deriveHashPda(this.programId, hashId);
  }

  /** Pure address derivation for a canonical ID and its voter. */
  votePda(hashId: HashBytes, voter: PublicKey): PublicKey {
    return deriveVotePda(this.programId, hashId, voter);
  }

  /** Register a raw hash and return its one-node archive after confirmation. */
  async register(hash: HashBytes, payer?: Keypair): Promise<CreationResult> {
    const hashBytes = to32Bytes(hash);
    const hashIdBytes = deriveGenesisHashId(hashBytes);
    const walletPk = instructionPayer(this.program.provider, payer);
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashIdBytes, walletPk);

    const builder = this.program.methods
      .register([...hashBytes])
      .accountsStrict({
        hashAccount: hashPda,
        voteInfo: votePda,
        user: walletPk,
        systemProgram: SystemProgram.programId,
      });

    return submitCreation(
      this.program,
      builder,
      { hash: archiveHex(hashBytes), source: { kind: "hash" } },
      payer
    );
  }

  /** Vote for an existing canonical ID. The signer funds the vote account. */
  async vote(
    hashId: HashBytes,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const walletPk = instructionPayer(this.program.provider, payer);
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashIdBytes, walletPk);

    const builder = this.program.methods.vote().accountsStrict({
      hashAccount: hashPda,
      voteInfo: votePda,
      user: walletPk,
      systemProgram: SystemProgram.programId,
    });

    return submitInstruction(builder, payer);
  }

  /** Withdraw the signer's vote for a canonical ID. */
  async unvote(
    hashId: HashBytes,
    payer?: Keypair
  ): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const walletPk = instructionPayer(this.program.provider, payer);
    const hashPda = this.hashPda(hashIdBytes);
    const votePda = this.votePda(hashIdBytes, walletPk);

    const builder = this.program.methods.unvote().accountsStrict({
      hashAccount: hashPda,
      voteInfo: votePda,
      user: walletPk,
      systemProgram: SystemProgram.programId,
    });

    return submitInstruction(builder, payer);
  }

  /** Submit on-chain existence verification; returns a signature, not a boolean. */
  async verify(hashId: HashBytes): Promise<TransactionSignature> {
    const hashIdBytes = to32Bytes(hashId);
    const hashPda = this.hashPda(hashIdBytes);
    return this.program.methods
      .verify()
      .accountsStrict({ hashAccount: hashPda })
      .rpc();
  }

  /** Read the parent by canonical ID, derive its child and submit the branch transaction. */
  async branch(
    oldHashId: HashBytes,
    payload: HashBytes,
    takeVote = true,
    payer?: Keypair
  ): Promise<CreationResult> {
    const walletPk = instructionPayer(this.program.provider, payer);
    const oldHashIdBytes = to32Bytes(oldHashId);
    const payloadBytes = to32Bytes(payload);
    const oldHashPda = this.hashPda(oldHashIdBytes);

    const oldAccount = await this.fetchHashAccount(oldHashIdBytes);
    if (!oldAccount) {
      throw new Error("old hash account not found");
    }

    const parent = branchParentMetadata(oldAccount);
    const newHash = deriveBranchHash(
      oldHashIdBytes,
      parent.createdAt,
      parent.generation,
      parent.sourceKind,
      payloadBytes
    );
    const newId = canonicalHashId(newHash, HashSourceKind.Branch);
    const newHashPda = this.hashPda(newId);
    const newVotePda = this.votePda(newId, walletPk);
    const oldVotePda = this.votePda(oldHashIdBytes, walletPk);

    const builder = this.program.methods
      .branch([...payloadBytes], takeVote)
      .accountsStrict({
        hashAccount: oldHashPda,
        newHashAccount: newHashPda,
        voteInfo: oldVotePda,
        newVoteInfo: newVotePda,
        user: walletPk,
        systemProgram: SystemProgram.programId,
      });

    return submitCreation(
      this.program,
      builder,
      {
        hash: archiveHex(newHash),
        source: archiveSource({
          kind: "branch",
          previousHashId: oldHashIdBytes,
          payload: payloadBytes,
          generation: parent.generation + 1n,
        }),
      },
      payer
    );
  }

  /** Read ordered canonical IDs, then create a batch. Member order affects identity. */
  async batch(memberIds: HashBytes[], payer?: Keypair): Promise<BatchResult> {
    if (memberIds.length === 0) {
      throw new Error("batch requires at least one member");
    }
    const memberIdBytes = normalizeUniqueMemberIds(memberIds, "batch");

    const walletPk = instructionPayer(this.program.provider, payer);

    const { memberPdas, fingerprints } = await loadAggregateMembers(
      this,
      memberIdBytes,
      "batch"
    );
    const batchHash = deriveBatchHash(fingerprints);
    const batchId = deriveBatchHashId(batchHash);
    const batchPda = this.hashPda(batchId);
    const votePda = this.votePda(batchId, walletPk);

    const builder = this.program.methods
      .batch()
      .accountsStrict({
        hashAccount: batchPda,
        voteInfo: votePda,
        payer: walletPk,
        systemProgram: SystemProgram.programId,
      })
      // Anchor's remainingAccounts maintains order; preserve provided sequence.
      .remainingAccounts(
        memberPdas.map((pubkey) => ({
          pubkey,
          isSigner: false,
          isWritable: false,
        }))
      );

    const result = await submitCreation(
      this.program,
      builder,
      {
        hash: archiveHex(batchHash),
        source: { kind: "batch", members: memberIdBytes.map(archiveHex) },
      },
      payer
    );
    return { ...result, batchId };
  }

  /** Read ordered canonical IDs, then create a pack. Member order affects identity. */
  async pack(memberIds: HashBytes[], payer?: Keypair): Promise<PackResult> {
    if (memberIds.length === 0) {
      throw new Error("pack requires at least one member");
    }
    const memberIdBytes = normalizeUniqueMemberIds(memberIds, "pack");

    const walletPk = instructionPayer(this.program.provider, payer);

    const { memberPdas, fingerprints } = await loadAggregateMembers(
      this,
      memberIdBytes,
      "pack"
    );
    const packHash = derivePackHash(fingerprints);
    const packId = derivePackHashId(packHash);
    const packPda = this.hashPda(packId);
    const votePda = this.votePda(packId, walletPk);

    const builder = this.program.methods
      .pack()
      .accountsStrict({
        hashAccount: packPda,
        voteInfo: votePda,
        payer: walletPk,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        memberPdas.map((pubkey) => ({
          pubkey,
          isSigner: false,
          isWritable: false,
        }))
      );

    const result = await submitCreation(
      this.program,
      builder,
      {
        hash: archiveHex(packHash),
        source: { kind: "pack" },
        members: memberPdas.map((pda) => pda.toBase58()),
      },
      payer
    );
    return { ...result, packId };
  }

  /** Read a Solana account snapshot, then submit its metadata commitment. */
  async hashAccount(
    target: PublicKey,
    payer?: Keypair
  ): Promise<AccountHashResult> {
    const walletPk = instructionPayer(this.program.provider, payer);

    const info = await this.connection.getAccountInfo(target);
    if (!info) {
      throw new Error("target account not found");
    }
    if (info.rentEpoch === undefined)
      throw new Error("RPC snapshot is missing rentEpoch");

    const metadataHash = deriveAccountMetadataHash(target, info);
    const hashId = canonicalHashId(metadataHash, HashSourceKind.Account);
    const hashPda = this.hashPda(hashId);
    const votePda = this.votePda(hashId, walletPk);

    // Retain the same snapshot used to derive the destination, before submission.
    const snapshot = {
      owner: info.owner.toBase58(),
      lamports: numberToU64(info.lamports).toString(),
      executable: info.executable,
      rentEpoch: numberToU64(info.rentEpoch).toString(),
      data: [...info.data],
    };

    const builder = this.program.methods.account().accountsStrict({
      hashAccount: hashPda,
      voteInfo: votePda,
      target,
      payer: walletPk,
      systemProgram: SystemProgram.programId,
    });

    const result = await submitCreation(
      this.program,
      builder,
      {
        hash: archiveHex(metadataHash),
        source: { kind: "account", account: target.toBase58() },
        snapshot,
      },
      payer
    );
    return { ...result, hashId, metadataHash };
  }

  /** RPC read by canonical ID. Returns raw Anchor data (BN integers, IDL source enum). */
  async fetchHashAccount(hashId: HashBytes): Promise<HashAccountData | null> {
    const hashPda = this.hashPda(hashId);
    return fetchNullableAccount(this.program.account.hashAccount, hashPda);
  }

  /** RPC read by canonical ID and voter. Missing/closed accounts return null. */
  async fetchVoteInfo(
    hashId: HashBytes,
    voter: PublicKey
  ): Promise<VoteInfoData | null> {
    const hashIdBytes = to32Bytes(hashId);
    const votePda = this.votePda(hashIdBytes, voter);
    return fetchNullableAccount(this.program.account.voteInfo, votePda);
  }

  /** Read live anchors and compile transaction-sized proofs without signing or sending. */
  async planRestore(
    archive: HashArchive,
    options: ArchiveRestoreOptions,
    payer?: Keypair
  ): Promise<ArchiveRestorePlan> {
    const signer = instructionPayer(this.program.provider, payer);
    const feePayer = instructionPayer(this.program.provider);
    return planArchiveRestore(this.program, archive, options, signer, feePayer);
  }

  async executeRestorePlan(
    plan: ArchiveRestorePlan,
    options: { allowAdditionalRecords?: boolean } = {},
    payer?: Keypair
  ): Promise<ArchiveRestoreResult> {
    return executeArchiveRestore(
      this.program,
      plan,
      payer,
      instructionPayer(this.program.provider, payer),
      instructionPayer(this.program.provider),
      options.allowAdditionalRecords === true
    );
  }

  async restoreArchive(
    archive: HashArchive,
    options: ArchiveRestoreOptions & { allowAdditionalRecords?: boolean },
    payer?: Keypair
  ): Promise<ArchiveRestoreResult> {
    const plan = await this.planRestore(archive, options, payer);
    return this.executeRestorePlan(plan, options, payer);
  }

  /** Submit a restoration proof. Proof-only mode is still an on-chain transaction. */
  async restore(
    proof: RestoreProofInput[],
    optionsOrPayer?: RestoreOptions | Keypair,
    payer?: Keypair
  ): Promise<RestoreResult> {
    const options =
      optionsOrPayer instanceof Keypair ? {} : optionsOrPayer ?? {};
    const createAccounts = options.createAccounts !== false;
    const resolvedPayer =
      optionsOrPayer instanceof Keypair ? optionsOrPayer : payer;

    const walletPk = instructionPayer(this.program.provider, resolvedPayer);

    const { proofEncoded, anchorId, restoredIds } = prepareRestore(
      proof,
      createAccounts
    );
    const anchorHashPda = this.hashPda(anchorId);
    const remainingAccounts = restoredIds.flatMap((id) => [
      { pubkey: this.hashPda(id), isSigner: false, isWritable: true },
      { pubkey: this.votePda(id, walletPk), isSigner: false, isWritable: true },
    ]);

    const builder = this.program.methods
      .restore(proofEncoded)
      .accountsStrict({
        payer: walletPk,
        anchorHashAccount: anchorHashPda,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts);

    const signature = await submitInstruction(builder, resolvedPayer);

    return { signature, restoredIds };
  }
}

/** Compatibility facade; new consumers can call client.restore directly. */
export class RestoreApi {
  constructor(private readonly client: HashTimestampClient) {}

  async restore(
    proof: RestoreProofInput[],
    optionsOrPayer?: RestoreOptions | Keypair,
    payer?: Keypair
  ): Promise<RestoreResult> {
    return this.client.restore(proof, optionsOrPayer, payer);
  }
}
