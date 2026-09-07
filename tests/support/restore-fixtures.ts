import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import {
  canonicalHashId,
  encodeHashSource,
  encodeRestoreParameters,
  HashBytes,
  HashSource,
  RestoreAccountSnapshotInput,
  RestoreHashFingerprintInput,
  RestoreProofInput,
  to32Bytes,
  toBigInt,
} from "../../app/sdk/hashTimestamp";
import {
  client,
  deriveBranchHash,
  deriveBranchHashId,
  deriveGenesisHashId,
  generationOf,
  hashSourceOf,
  Keypair,
  provider,
  randomHash,
  sourceKindOf,
  toNum,
} from "./integration";

export const createdAtOf = (account: any): number =>
  toNum((account as any).createdAt ?? (account as any).created_at ?? 0);

export const cloneHashBytes = (value: HashBytes | PublicKey): Buffer => {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  if (value instanceof PublicKey) {
    return Buffer.from(value.toBuffer());
  }
  if (typeof value === "string") {
    try {
      return Buffer.from(new PublicKey(value).toBuffer());
    } catch (_) {
      return Buffer.from(value, "hex");
    }
  }
  return Buffer.from(to32Bytes(value as HashBytes));
};

export const cloneBytes = (
  value: HashBytes | Uint8Array | Buffer | number[] | string | PublicKey
): Buffer => {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  if (value instanceof PublicKey) {
    return Buffer.from(value.toBuffer());
  }
  if (typeof value === "string") {
    try {
      return Buffer.from(new PublicKey(value).toBuffer());
    } catch (_) {
      return Buffer.from(value, "hex");
    }
  }
  return cloneHashBytes(value);
};

export const toBigIntLike = (value: any): bigint => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (value && typeof value.toString === "function") {
    return BigInt(value.toString());
  }
  return BigInt(value ?? 0);
};

const cloneSnapshot = (
  snapshot?: RestoreAccountSnapshotInput
): RestoreAccountSnapshotInput | undefined => {
  if (!snapshot) {
    return undefined;
  }
  return {
    owner:
      snapshot.owner instanceof PublicKey
        ? new PublicKey(snapshot.owner.toBuffer())
        : cloneHashBytes(snapshot.owner),
    lamports: toBigIntLike(snapshot.lamports),
    executable: snapshot.executable,
    rentEpoch: toBigIntLike(snapshot.rentEpoch),
    data: cloneBytes(snapshot.data),
  };
};

const cloneSource = (source: HashSource): HashSource => {
  switch (source.kind) {
    case "hash":
      return { kind: "hash" };
    case "account":
      return { kind: "account", account: cloneHashBytes(source.account) };
    case "branch":
      return {
        kind: "branch",
        previousHashId: cloneHashBytes(source.previousHashId),
        payload: cloneHashBytes(source.payload),
        generation: BigInt(source.generation),
      };
    case "batch":
      return {
        kind: "batch",
        members: source.members.map((member) => cloneHashBytes(member)),
      };
    case "pack":
      return { kind: "pack" };
    default:
      throw new Error("unsupported hash source variant");
  }
};

type ProofLinkExtras = {
  hashPayload?: HashBytes;
  accountSnapshot?: RestoreAccountSnapshotInput;
  branchParent?: RestoreHashFingerprintInput;
  memberFingerprints?: RestoreHashFingerprintInput[];
};

export const fingerprintFromAccount = (
  account: any
): RestoreHashFingerprintInput => ({
  hash: cloneHashBytes((account as any).hash as HashBytes),
  sourceKind: sourceKindOf(account),
  createdAt: toBigIntLike(createdAtOf(account)),
  generation: toBigIntLike(generationOf(account)),
});

const cloneFingerprint = (
  fingerprint: RestoreHashFingerprintInput
): RestoreHashFingerprintInput => ({
  hash: cloneHashBytes(fingerprint.hash),
  sourceKind: fingerprint.sourceKind,
  createdAt: toBigIntLike(fingerprint.createdAt),
  generation: toBigIntLike(fingerprint.generation),
});

const cloneParams = (
  params: RestoreProofInput["params"]
): RestoreProofInput["params"] => {
  if (params === null || params === undefined) {
    return params;
  }
  switch (params.kind) {
    case "hash":
      return { kind: "hash", payload: cloneBytes(params.payload) };
    case "account":
      return {
        kind: "account",
        snapshot: cloneSnapshot(params.snapshot),
      };
    case "branch":
      return {
        kind: "branch",
        parent: cloneFingerprint(params.parent),
      };
    case "batch":
      return {
        kind: "batch",
        members: params.members.map(cloneFingerprint),
      };
    case "pack":
      return {
        kind: "pack",
        members: params.members.map(cloneFingerprint),
      };
    default:
      throw new Error("unsupported restore parameters variant");
  }
};

export const toProofLink = (
  account: any,
  extras: ProofLinkExtras = {}
): RestoreProofInput => {
  const source = cloneSource(hashSourceOf(account));
  const params = (() => {
    switch (source.kind) {
      case "hash": {
        const payloadSource =
          extras.hashPayload ?? ((account as any).hash as HashBytes);
        return { kind: "hash", payload: cloneBytes(payloadSource) } as const;
      }
      case "account":
        return {
          kind: "account",
          snapshot: extras.accountSnapshot
            ? cloneSnapshot(extras.accountSnapshot)
            : undefined,
        } as const;
      case "branch": {
        const parent = extras.branchParent;
        if (!parent) {
          throw new Error("branch proof link requires parent fingerprint");
        }
        return {
          kind: "branch",
          parent: cloneFingerprint(parent),
        } as const;
      }
      case "batch": {
        const members = extras.memberFingerprints;
        if (!members || members.length === 0) {
          throw new Error("batch proof link requires member fingerprints");
        }
        return {
          kind: "batch",
          members: members.map(cloneFingerprint),
        } as const;
      }
      case "pack": {
        const members = extras.memberFingerprints;
        if (!members || members.length === 0) {
          throw new Error("pack proof link requires member fingerprints");
        }
        return {
          kind: "pack",
          members: members.map(cloneFingerprint),
        } as const;
      }
      default:
        throw new Error("unsupported hash source variant");
    }
  })();

  return {
    hash: cloneHashBytes((account as any).hash as HashBytes),
    source,
    createdAt: createdAtOf(account),
    params,
  };
};

export const cloneProofLink = (link: RestoreProofInput): RestoreProofInput => ({
  hash: cloneHashBytes(link.hash),
  source: cloneSource(link.source),
  createdAt: link.createdAt,
  params: cloneParams(link.params),
});

export const cloneProof = (proof: RestoreProofInput[]): RestoreProofInput[] =>
  proof.map(cloneProofLink);

export const encodeProofForProgram = (proof: RestoreProofInput[]) =>
  proof.map((link) => ({
    hash: [...to32Bytes(link.hash)],
    source: encodeHashSource(link.source),
    createdAt: new anchor.BN(toBigInt(link.createdAt).toString()),
    params: link.params ? encodeRestoreParameters(link.params) : null,
  }));

export const restoreAccountPairs = (
  proof: RestoreProofInput[],
  payer = provider.wallet.publicKey
) =>
  proof
    .slice(1)
    .filter((link) => link.params != null)
    .flatMap((link) => {
      const id = canonicalHashId(cloneHashBytes(link.hash), link.source);
      return [
        { pubkey: client.hashPda(id), isSigner: false, isWritable: true },
        {
          pubkey: client.votePda(id, payer),
          isSigner: false,
          isWritable: true,
        },
      ];
    });

export const restoreBuilder = (
  proof: RestoreProofInput[],
  remainingAccounts = restoreAccountPairs(proof),
  payer = provider.wallet.publicKey
) =>
  client.program.methods
    .restore(encodeProofForProgram(proof))
    .accountsStrict({
      payer,
      anchorHashAccount: client.hashPda(
        canonicalHashId(cloneHashBytes(proof[0].hash), proof[0].source)
      ),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts);

export const hexOf = (value: Uint8Array): string =>
  Buffer.from(value).toString("hex");

const snapshotOf = async (
  pubkey: PublicKey
): Promise<RestoreAccountSnapshotInput> => {
  const info = await provider.connection.getAccountInfo(pubkey);
  expect(info).to.not.equal(null);
  const accountInfo = info!;
  return {
    owner: accountInfo.owner,
    lamports: BigInt(accountInfo.lamports),
    executable: accountInfo.executable,
    rentEpoch: BigInt(accountInfo.rentEpoch),
    data: Buffer.from(accountInfo.data),
  };
};

export const prepareBranchChain = async () => {
  const genesisPayload = randomHash();
  const genesisId = deriveGenesisHashId(genesisPayload);
  await client.register(genesisPayload);

  const genesisAccount = await client.fetchHashAccount(genesisId);
  expect(genesisAccount).to.not.equal(null);

  const proofLinks: RestoreProofInput[] = [
    toProofLink(genesisAccount!, { hashPayload: genesisPayload }),
  ];

  let currentId = genesisId;
  let currentAccount = genesisAccount!;

  for (let i = 0; i < 2; i++) {
    const payload = randomHash();
    const createdAt = createdAtOf(currentAccount);
    const generation = generationOf(currentAccount);
    const kind = sourceKindOf(currentAccount);

    await client.branch(currentId, payload, true);

    const branchHash = deriveBranchHash(
      currentId,
      createdAt,
      generation,
      kind,
      payload
    );
    const branchId = deriveBranchHashId(branchHash);

    const branchAccount = await client.fetchHashAccount(branchId);
    expect(branchAccount).to.not.equal(null);

    proofLinks.push(
      toProofLink(branchAccount!, {
        branchParent: fingerprintFromAccount(currentAccount),
      })
    );
    currentId = branchId;
    currentAccount = branchAccount!;
  }

  const tipHashId = currentId;
  const proofChain = proofLinks.slice().reverse();
  const targetLink = proofLinks[0];

  const canonicalTip = canonicalHashId(
    cloneHashBytes(proofChain[0].hash),
    proofChain[0].source
  );
  expect(Buffer.from(canonicalTip)).to.deep.equal(Buffer.from(tipHashId));

  const canonicalChain = proofChain.map((entry) =>
    canonicalHashId(cloneHashBytes(entry.hash), entry.source)
  );
  const restoredHashIds = canonicalChain.slice(1);

  expect(await client.fetchHashAccount(genesisId)).to.equal(null);

  return {
    targetHashId: genesisId,
    targetLink,
    proofChain,
    tipHashId,
    restoredHashIds,
  };
};

export const prepareAccountChain = async () => {
  const dataAccount = Keypair.generate();
  const rent = await provider.connection.getMinimumBalanceForRentExemption(16);
  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: dataAccount.publicKey,
      lamports: rent + 1_000_000,
      space: 16,
      programId: SystemProgram.programId,
    })
  );
  await provider.sendAndConfirm(createTx, [dataAccount]);

  const accountSnapshot = await snapshotOf(dataAccount.publicKey);
  const { hashId: accountHashId } = await client.hashAccount(
    dataAccount.publicKey
  );
  const accountHashAccount = await client.fetchHashAccount(accountHashId);
  expect(accountHashAccount).to.not.equal(null);

  const proofLinks: RestoreProofInput[] = [
    toProofLink(accountHashAccount!, { accountSnapshot }),
  ];

  const payload = randomHash();
  const createdAt = createdAtOf(accountHashAccount!);
  const generation = generationOf(accountHashAccount!);
  const kind = sourceKindOf(accountHashAccount!);

  await client.branch(accountHashId, payload, false);

  const branchHash = deriveBranchHash(
    accountHashId,
    createdAt,
    generation,
    kind,
    payload
  );
  const branchId = deriveBranchHashId(branchHash);
  const branchAccount = await client.fetchHashAccount(branchId);
  expect(branchAccount).to.not.equal(null);

  proofLinks.push(
    toProofLink(branchAccount!, {
      branchParent: fingerprintFromAccount(accountHashAccount!),
    })
  );

  const proofChain = proofLinks.slice().reverse();
  const canonicalChain = proofChain.map((entry) =>
    canonicalHashId(cloneHashBytes(entry.hash), entry.source)
  );
  const restoredHashIds = canonicalChain.slice(1);
  const tipHashId = canonicalChain[0];
  const targetHashId = restoredHashIds[0];
  const targetLink = proofLinks[0];
  await client.unvote(targetHashId);
  expect(await client.fetchHashAccount(targetHashId)).to.equal(null);
  const tipHashAccount = await client.fetchHashAccount(tipHashId);
  expect(tipHashAccount).to.not.equal(null);

  return {
    targetHashId,
    targetLink,
    proofChain,
    tipHashId,
    restoredHashIds,
  };
};

export const preparePackChain = async () => {
  const memberPayloads = [randomHash(), randomHash()];
  const memberIds: Uint8Array[] = [];
  const memberAccounts: any[] = [];

  for (const payload of memberPayloads) {
    await client.register(payload);
    const memberId = deriveGenesisHashId(payload);
    memberIds.push(memberId);
    const account = await client.fetchHashAccount(memberId);
    expect(account).to.not.equal(null);
    memberAccounts.push(account);
  }

  const proofLinks: RestoreProofInput[] = memberAccounts.map((account, idx) =>
    toProofLink(account, { hashPayload: memberPayloads[idx] })
  );

  const { packId } = await client.pack(memberIds);
  const packAccount = await client.fetchHashAccount(packId);
  expect(packAccount).to.not.equal(null);

  const memberFingerprints = memberAccounts.map(fingerprintFromAccount);
  proofLinks.push(
    toProofLink(packAccount!, {
      memberFingerprints,
    })
  );

  const payload = randomHash();
  const createdAt = createdAtOf(packAccount!);
  const generation = generationOf(packAccount!);
  const kind = sourceKindOf(packAccount!);

  await client.branch(packId, payload, false);

  const branchHash = deriveBranchHash(
    packId,
    createdAt,
    generation,
    kind,
    payload
  );
  const branchId = deriveBranchHashId(branchHash);
  const branchAccount = await client.fetchHashAccount(branchId);
  expect(branchAccount).to.not.equal(null);

  proofLinks.push(
    toProofLink(branchAccount!, {
      branchParent: fingerprintFromAccount(packAccount!),
    })
  );

  const proofChain = proofLinks.slice().reverse();
  const canonicalChain = proofChain.map((entry) =>
    canonicalHashId(cloneHashBytes(entry.hash), entry.source)
  );
  const restoredHashIds = canonicalChain.slice(1);
  const tipHashId = canonicalChain[0];
  const targetHashId = restoredHashIds[0];
  const targetLink = proofLinks[proofLinks.length - 2];
  await client.unvote(packId);
  expect(await client.fetchHashAccount(packId)).to.equal(null);
  const tipHashAccount = await client.fetchHashAccount(tipHashId);
  expect(tipHashAccount).to.not.equal(null);

  return {
    targetHashId,
    targetLink: targetLink!,
    proofChain,
    tipHashId,
    restoredHashIds,
  };
};

export const prepareBatchChain = async () => {
  const memberPayloads = [randomHash(), randomHash()];
  const memberIds: Uint8Array[] = [];
  const memberAccounts: any[] = [];

  for (const payload of memberPayloads) {
    await client.register(payload);
    const memberId = deriveGenesisHashId(payload);
    memberIds.push(memberId);
    const account = await client.fetchHashAccount(memberId);
    expect(account).to.not.equal(null);
    memberAccounts.push(account);
  }

  const proofLinks: RestoreProofInput[] = memberAccounts.map((account, idx) =>
    toProofLink(account, { hashPayload: memberPayloads[idx] })
  );

  const { batchId } = await client.batch(memberIds);
  const batchAccount = await client.fetchHashAccount(batchId);
  expect(batchAccount).to.not.equal(null);

  const memberFingerprints = memberAccounts.map(fingerprintFromAccount);
  proofLinks.push(toProofLink(batchAccount!, { memberFingerprints }));

  const payload = randomHash();
  const createdAt = createdAtOf(batchAccount!);
  const generation = generationOf(batchAccount!);
  const kind = sourceKindOf(batchAccount!);

  await client.branch(batchId, payload, false);

  const branchHash = deriveBranchHash(
    batchId,
    createdAt,
    generation,
    kind,
    payload
  );
  const branchId = deriveBranchHashId(branchHash);
  const branchAccount = await client.fetchHashAccount(branchId);
  expect(branchAccount).to.not.equal(null);

  proofLinks.push(
    toProofLink(branchAccount!, {
      branchParent: fingerprintFromAccount(batchAccount!),
    })
  );

  const proofChain = proofLinks.slice().reverse();
  const canonicalChain = proofChain.map((entry) =>
    canonicalHashId(cloneHashBytes(entry.hash), entry.source)
  );
  const restoredHashIds = canonicalChain.slice(1);
  const tipHashId = canonicalChain[0];
  const targetHashId = restoredHashIds[0];
  const targetLink = proofLinks[proofLinks.length - 2];

  await client.unvote(batchId);
  expect(await client.fetchHashAccount(batchId)).to.equal(null);
  for (const memberId of memberIds) {
    await client.unvote(memberId);
    expect(await client.fetchHashAccount(memberId)).to.equal(null);
  }

  const tipHashAccount = await client.fetchHashAccount(tipHashId);
  expect(tipHashAccount).to.not.equal(null);

  return {
    targetHashId,
    targetLink: targetLink!,
    proofChain,
    tipHashId,
    restoredHashIds,
  };
};
