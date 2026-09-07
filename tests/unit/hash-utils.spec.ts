import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

import {
  HashSource,
  HashSourceKind,
  canonicalHashId,
  decodeHashSource,
  deriveAccountMetadataHash,
  deriveBatchHash,
  deriveBranchHash,
  deriveHashPda,
  derivePackHash,
  deriveVotePda,
  encodeHashSource,
  hashAccountSpace,
  hashSourceKindOf,
  toBytes,
} from "../../app/sdk/hashTimestamp";

const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

describe("hash utility public key normalization", () => {
  it("normalizes public keys created by another web3.js copy", () => {
    const expected = Keypair.generate().publicKey;
    const foreignPublicKey = {
      toBase58: () => expected.toBase58(),
      toBuffer: () => expected.toBuffer(),
    } as unknown as PublicKey;

    expect(Buffer.from(toBytes(foreignPublicKey))).to.eql(expected.toBuffer());

    const decoded = decodeHashSource({
      account: { account: foreignPublicKey },
    });
    expect(decoded.kind).to.equal("account");
    if (decoded.kind !== "account") {
      throw new Error("decoded source must be an account");
    }
    expect(Buffer.from(decoded.account as Uint8Array)).to.eql(
      expected.toBuffer()
    );

    const encoded = encodeHashSource({
      kind: "account",
      account: foreignPublicKey,
    });
    expect(encoded.account.account.toBase58()).to.equal(expected.toBase58());
  });
});

describe("protocol v3 compatibility vectors", () => {
  const programId = new PublicKey(
    "4qHXrn8Z72fmDyvBBafJV7QujMJ7jKesa8C6zqcZry5k"
  );

  it("keeps operation-specific errors for empty aggregates", () => {
    expect(() => deriveBatchHash([])).to.throw(
      "batch requires at least one member"
    );
    expect(() => derivePackHash([])).to.throw(
      "pack requires at least one member"
    );
  });

  it("keeps canonical, branch, aggregate, and PDA derivation byte-stable", () => {
    const canonical = canonicalHashId(
      Buffer.alloc(32, 0x11),
      HashSourceKind.Branch
    );
    expect(hex(canonical)).to.equal(
      "de7cc218a459caaf756d498e46da3749b81dfd9161b6d5ffe351762350385263"
    );

    const branch = deriveBranchHash(
      canonical,
      BigInt(-123_456_789),
      BigInt(42),
      HashSourceKind.Branch,
      Buffer.alloc(32, 0x22)
    );
    expect(hex(branch)).to.equal(
      "e4066b9be14508808fa6efec3f911f9eade328921e8ccca37119ddbed274141c"
    );

    const members = [
      {
        hash: Buffer.alloc(32, 0x11),
        kind: HashSourceKind.Branch,
        createdAt: BigInt(-123_456_789),
      },
      {
        hash: Buffer.alloc(32, 0x22),
        kind: HashSourceKind.Pack,
        createdAt: BigInt(987_654_321),
      },
    ];
    const expectedAggregate =
      "313dbb66ea86355e1669034d7434dd51f04e45506856d3bac8e1c28d5626054a";
    expect(hex(deriveBatchHash(members))).to.equal(expectedAggregate);
    expect(hex(derivePackHash(members))).to.equal(expectedAggregate);

    expect(deriveHashPda(programId, canonical).toBase58()).to.equal(
      "GnKtZVxHnB8D3Mbp47FxcWP8CH9yaC2NDvTh7nxGa9Eb"
    );
    expect(
      deriveVotePda(
        programId,
        canonical,
        new PublicKey(Buffer.alloc(32, 0x33))
      ).toBase58()
    ).to.equal("BhFUSc6UiBfKQnfngfGZXEoRA2jJ8Sn9TGYwWozsW4uu");
  });

  it("keeps account metadata hashing byte-stable", () => {
    const digest = deriveAccountMetadataHash(
      new PublicKey(Buffer.alloc(32, 0x44)),
      {
        data: Buffer.from([1, 2, 3, 4]),
        executable: true,
        lamports: 123_456_789,
        owner: new PublicKey(Buffer.alloc(32, 0x55)),
        rentEpoch: 777,
      }
    );

    expect(hex(digest)).to.equal(
      "82b78bb2a028133dc9c5eba6d458ef492f5942df843f0081ef0bea087fc2565e"
    );
  });

  it("keeps source discriminators and allocated account sizes stable", () => {
    const sources: HashSource[] = [
      { kind: "hash" },
      { kind: "account", account: Buffer.alloc(32, 1) },
      {
        kind: "branch",
        previousHashId: Buffer.alloc(32, 2),
        payload: Buffer.alloc(32, 3),
        generation: BigInt(7),
      },
      {
        kind: "batch",
        members: [Buffer.alloc(32, 4), Buffer.alloc(32, 5)],
      },
      { kind: "pack" },
    ];

    expect(sources.map(hashSourceKindOf)).to.deep.equal([
      HashSourceKind.Hash,
      HashSourceKind.Account,
      HashSourceKind.Branch,
      HashSourceKind.Batch,
      HashSourceKind.Pack,
    ]);
    expect(sources.map(hashAccountSpace)).to.deep.equal([64, 96, 136, 128, 64]);
  });
});
