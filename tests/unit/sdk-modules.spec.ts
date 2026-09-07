import { expect } from "chai";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { HashTimestamp } from "../../target/types/hash_timestamp";
import * as publicSdk from "../../app/sdk/hashTimestamp";
import * as utilities from "../../app/sdk/hashUtils";
import * as normalization from "../../app/sdk/protocol/normalization";
import * as hashes from "../../app/sdk/protocol/hashes";
import * as addresses from "../../app/sdk/protocol/addresses";
import * as sources from "../../app/sdk/protocol/source";
import * as encoding from "../../app/sdk/encoding";
import * as rent from "../../app/sdk/rent";
import { prepareRestore } from "../../app/sdk/restore";
import { RestoreProofInput } from "../../app/sdk/types";

const expectedUtilities = [
  "to32Bytes",
  "toBytes",
  "toBigInt",
  "coerceBigInt",
  "canonicalHashId",
  "deriveGenesisHashId",
  "deriveAccountMetadataHash",
  "deriveAccountHashId",
  "deriveBranchHash",
  "deriveBranchHashId",
  "decodeHashSource",
  "generationFromSource",
  "hashSourceKindOf",
  "hashAccountSpace",
  "encodeHashSource",
  "normalizeSourceKind",
  "encodeRestoreParameters",
  "derivePackHash",
  "derivePackHashId",
  "deriveBatchHash",
  "deriveBatchHashId",
  "deriveHashPda",
  "deriveVotePda",
  "rentExemptForHash",
  "rentExemptForVote",
].sort();

function restoreProof(): RestoreProofInput[] {
  return [1, 2, 3, 4].map((value) => ({
    hash: Buffer.alloc(32, value),
    source: { kind: "hash" },
    createdAt: BigInt(100 + value),
    params:
      value === 3 ? null : { kind: "hash", payload: Buffer.alloc(32, value) },
  }));
}

function clientFixture() {
  const captured: any = {};
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
      return "restore-signature";
    },
  };
  const program: any = {
    programId: new PublicKey(Buffer.alloc(32, 7)),
    provider: {
      wallet: { publicKey: new PublicKey(Buffer.alloc(32, 8)) },
      connection: {},
    },
    methods: {
      restore(proof: any) {
        captured.proof = proof;
        return builder;
      },
    },
  };
  const client = new publicSdk.HashTimestampClient(
    program as Program<HashTimestamp>
  );
  return { client, program, captured };
}

describe("SDK module compatibility", () => {
  it("keeps exactly the public utility exports and their implementation identities", () => {
    expect(Object.keys(utilities).sort()).to.deep.equal(expectedUtilities);
    expect(Object.keys(publicSdk).sort()).to.deep.equal(
      [
        ...expectedUtilities,
        "HASH_ACCOUNT_BASE_SIZE",
        "VOTE_INFO_SPACE",
        "HashSourceKind",
        "HashTimestampClient",
        "RestoreApi",
      ].sort()
    );
    const leaves: any = {
      ...normalization,
      ...hashes,
      ...addresses,
      ...sources,
      ...encoding,
      ...rent,
    };
    for (const name of expectedUtilities) {
      expect((utilities as any)[name]).to.equal(leaves[name]);
      expect((publicSdk as any)[name]).to.equal(leaves[name]);
    }
    expect((publicSdk as any).publicKeyBytes).to.equal(undefined);
    expect((publicSdk as any).prepareRestore).to.equal(undefined);
  });

  it("retains byte-view versus copy semantics and numeric rejection policies", () => {
    const backing = new Uint8Array(40).fill(4);
    const input = backing.subarray(4, 36);
    const view = utilities.toBytes(input);
    const copy = utilities.to32Bytes(input);
    input[0] = 9;
    expect(view[0]).to.equal(9);
    expect(copy[0]).to.equal(4);
    expect(() => utilities.to32Bytes(new Uint8Array(31))).to.throw(
      "hash must be exactly 32 bytes"
    );
    expect(() => utilities.toBigInt(1.5)).to.throw();
    expect(utilities.coerceBigInt(new BN("123"))).to.equal(123n);
    expect(normalization.numberToU64(1.9)).to.equal(1n);
    expect(normalization.numberToU64(2 ** 80)).to.equal(0xffffffffffffffffn);
    expect(() => normalization.numberToU64(-1)).to.throw(
      "value must be non-negative"
    );
    expect(() => normalization.numberToU64(Infinity)).to.throw(
      "value must be a finite number"
    );
  });

  it("retains tolerant source decoding, field aliases and all source round trips", () => {
    for (const raw of [undefined, {}, { futureVariant: {} }]) {
      expect(encoding.decodeHashSource(raw)).to.deep.equal({ kind: "hash" });
    }
    const key = new PublicKey(Buffer.alloc(32, 10));
    expect(
      encoding.decodeHashSource({ Account: { pubKey: key } })
    ).to.deep.equal({
      kind: "account",
      account: new Uint8Array(key.toBuffer()),
    });
    const branch = {
      kind: "branch" as const,
      previousHashId: new Uint8Array(32).fill(11),
      payload: new Uint8Array(32).fill(12),
      generation: 2n,
    };
    expect(
      encoding.decodeHashSource({
        Branch: {
          previous_hash_id: branch.previousHashId,
          payload: branch.payload,
          generation: new BN(2),
        },
      })
    ).to.deep.equal(branch);
    for (const source of [
      { kind: "hash" as const },
      { kind: "account" as const, account: new Uint8Array(key.toBuffer()) },
      branch,
      { kind: "batch" as const, members: [new Uint8Array(32).fill(13)] },
      { kind: "pack" as const },
    ]) {
      expect(
        encoding.decodeHashSource(encoding.encodeHashSource(source))
      ).to.deep.equal(source);
    }
  });

  it("retains snapshot clamping independently from metadata numeric conversion", () => {
    const encoded = encoding.encodeRestoreParameters({
      kind: "account",
      snapshot: {
        owner: new PublicKey(Buffer.alloc(32, 2)),
        lamports: -1n,
        executable: true,
        rentEpoch: 1n << 80n,
        data: [1, 2, 3],
      },
    }).account.snapshot;
    expect(encoded.lamports.toString()).to.equal("0");
    expect(encoded.rentEpoch.toString()).to.equal("18446744073709551615");
    expect(encoded.data).to.deep.equal(Buffer.from([1, 2, 3]));
    expect(encoded.executable).to.equal(true);
    expect(encoding.encodeRestoreParameters({ kind: "account" })).to.deep.equal(
      { account: { snapshot: null } }
    );
  });

  it("encodes fingerprints and every restore variant without changing field shapes", () => {
    const fingerprint = {
      hash: Buffer.alloc(32, 3),
      sourceKind: publicSdk.HashSourceKind.Branch,
      createdAt: -4n,
      generation: 5n,
    };
    const branch = encoding.encodeRestoreParameters({
      kind: "branch",
      parent: fingerprint,
    }).branch.parent;
    expect(branch.hash).to.deep.equal([...fingerprint.hash]);
    expect(branch.sourceKind).to.equal(2);
    expect(branch.createdAt.toString()).to.equal("-4");
    expect(branch.generation.toString()).to.equal("5");
    for (const kind of ["batch", "pack"] as const) {
      expect(
        encoding.encodeRestoreParameters({ kind, members: [fingerprint] })[kind]
          .members
      ).to.deep.equal([branch]);
    }
    expect(
      encoding.encodeRestoreParameters({ kind: "hash", payload: [1, 2] })
    ).to.deep.equal({ hash: { payload: Buffer.from([1, 2]) } });
  });

  it("keeps pure restore preparation ordered, non-mutating and proof-only capable", () => {
    const proof = restoreProof();
    const before = proof.map((link) => [...utilities.to32Bytes(link.hash)]);
    const prepared = prepareRestore(proof, true);
    expect(prepared.proofEncoded.map((link) => link.hash)).to.deep.equal(
      before
    );
    expect(prepared.proofEncoded[2].params).to.equal(null);
    expect(prepared.restoredIds).to.deep.equal(
      [proof[1], proof[3]].map((link) =>
        utilities.canonicalHashId(link.hash, link.source)
      )
    );
    expect(prepareRestore(proof, false).restoredIds).to.deep.equal([]);
    expect(proof).to.deep.equal(restoreProof());
    expect(
      proof.map((link) => [...utilities.to32Bytes(link.hash)])
    ).to.deep.equal(before);
    const empty = prepareRestore([], true);
    expect(empty.proofEncoded).to.deep.equal([]);
    expect(empty.restoredIds).to.deep.equal([]);
    expect(empty.anchorId).to.deep.equal(
      utilities.deriveGenesisHashId(new Uint8Array(32))
    );
  });

  it("retains restore anchor selection rejection", () => {
    const proof = restoreProof();
    proof[1] = proof[0];
    expect(() => prepareRestore(proof, true)).to.throw(
      "restore selection must not include the anchor hash"
    );
    expect(prepareRestore(proof, false).restoredIds).to.deep.equal([]);
  });

  for (const mode of [
    "wallet",
    "payer",
    "options-payer",
    "proof-only",
  ] as const) {
    it(`restore builder preserves ${mode} overload, account ordering and requested IDs`, async () => {
      const { client, captured, program } = clientFixture();
      const payer = Keypair.fromSeed(new Uint8Array(32).fill(14));
      const proof = restoreProof();
      const result =
        mode === "wallet"
          ? await client.restore(proof)
          : mode === "payer"
          ? await client.restore(proof, payer)
          : await client.restore(
              proof,
              { createAccounts: mode !== "proof-only" },
              payer
            );
      const wallet =
        mode === "wallet" ? program.provider.wallet.publicKey : payer.publicKey;
      const expected = prepareRestore(proof, mode !== "proof-only");
      expect(result.signature).to.equal("restore-signature");
      expect(result.restoredIds).to.deep.equal(expected.restoredIds);
      expect(captured.proof).to.deep.equal(expected.proofEncoded);
      expect(captured.accounts.payer.equals(wallet)).to.equal(true);
      expect(
        captured.accounts.systemProgram.equals(SystemProgram.programId)
      ).to.equal(true);
      expect(
        captured.accounts.anchorHashAccount.equals(
          client.hashPda(expected.anchorId)
        )
      ).to.equal(true);
      expect(
        captured.remaining.map((meta: any) => meta.pubkey.toBase58())
      ).to.deep.equal(
        expected.restoredIds
          .flatMap((id) => [client.hashPda(id), client.votePda(id, wallet)])
          .map((key) => key.toBase58())
      );
      expect(
        captured.remaining.every(
          (meta: any) => meta.isWritable && !meta.isSigner
        )
      ).to.equal(true);
      expect(captured.signers).to.deep.equal(
        mode === "wallet" ? undefined : [payer]
      );
    });
  }

  it("reads the current provider instead of caching its wallet or connection", async () => {
    const { client, captured, program } = clientFixture();
    const replacement = {
      wallet: { publicKey: new PublicKey(Buffer.alloc(32, 99)) },
      connection: {},
    };
    program.provider = replacement;
    expect(client.connection).to.equal(replacement.connection);
    await new publicSdk.RestoreApi(client).restore([]);
    expect(
      captured.accounts.payer.equals(replacement.wallet.publicKey)
    ).to.equal(true);
  });
});
