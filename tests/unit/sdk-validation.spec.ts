import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  canonicalHashId,
  deriveBranchHash,
  deriveBatchHash,
  derivePackHash,
  encodeHashSource,
  encodeRestoreParameters,
  hashSourceKindOf,
  to32Bytes,
  toBytes,
} from "../../app/sdk/hashTimestamp";
import { prepareRestore } from "../../app/sdk/restore";

const hash = new Uint8Array(32).fill(17);
const fingerprint = { hash, sourceKind: 0, createdAt: 123n, generation: 0n };

describe("SDK input boundaries", () => {
  it("rejects non-integer and unknown source kinds at every digest boundary", () => {
    for (const kind of [NaN, Infinity, -1, 1.5, 5, 256]) {
      const calls = [
        () => hashSourceKindOf(kind),
        () => canonicalHashId(hash, kind),
        () => deriveBranchHash(hash, 1n, 0n, kind, hash),
        () => deriveBatchHash([{ hash, kind, createdAt: 1n }]),
        () => derivePackHash([{ hash, kind, createdAt: 1n }]),
        () =>
          encodeRestoreParameters({
            kind: "branch",
            parent: { ...fingerprint, sourceKind: kind },
          }),
      ];
      for (const call of calls) expect(call, `invalid kind ${kind}`).to.throw();
    }
  });

  it("rejects generation values that the wire encoder would change", () => {
    for (const generation of [-1n, 1n << 64n]) {
      expect(() =>
        encodeHashSource({
          kind: "branch",
          previousHashId: hash,
          payload: hash,
          generation,
        })
      ).to.throw();
      for (const kind of ["branch", "batch", "pack"] as const) {
        const parent = { ...fingerprint, generation };
        expect(() =>
          encodeRestoreParameters(
            kind === "branch" ? { kind, parent } : { kind, members: [parent] }
          )
        ).to.throw();
      }
    }
  });

  it("rejects timestamps outside i64 in proof links and fingerprints", () => {
    for (const createdAt of [-(1n << 63n) - 1n, 1n << 63n]) {
      expect(() =>
        prepareRestore([{ hash, source: { kind: "hash" }, createdAt }], false)
      ).to.throw();
      expect(() =>
        encodeRestoreParameters({
          kind: "branch",
          parent: { ...fingerprint, createdAt },
        })
      ).to.throw();
    }
  });

  it("preserves valid i64/u64 endpoints and negative historical timestamps", () => {
    const maxGeneration = (1n << 64n) - 1n;
    for (const createdAt of [-(1n << 63n), -1n, 0n, (1n << 63n) - 1n]) {
      const encoded = encodeRestoreParameters({
        kind: "branch",
        parent: { ...fingerprint, createdAt, generation: maxGeneration },
      }).branch.parent;
      expect(encoded.createdAt.toString()).to.equal(createdAt.toString());
      expect(encoded.generation.toString()).to.equal(maxGeneration.toString());
    }
  });

  it("accepts account-source public keys as bytes, hex, base58 and foreign key objects", () => {
    const key = new PublicKey(hash);
    for (const account of [
      key,
      hash,
      [...hash],
      Buffer.from(hash).toString("hex"),
      key.toBase58(),
    ]) {
      expect(
        encodeHashSource({ kind: "account", account }).account.account.equals(
          key
        )
      ).to.equal(true);
    }
    const foreign = {
      toBase58: () => key.toBase58(),
      toBuffer: () => Buffer.from(hash),
    } as PublicKey;
    expect(
      encodeHashSource({
        kind: "account",
        account: foreign,
      }).account.account.equals(key)
    ).to.equal(true);
  });

  it("rejects truncated hexadecimal input instead of accepting a different byte string", () => {
    for (const suffix of ["z", "a", "00xx"]) {
      const malformed = "ab".repeat(32) + suffix;
      expect(() => to32Bytes(malformed)).to.throw();
      expect(() => toBytes(malformed)).to.throw();
    }
    expect(toBytes("")).to.have.length(0);
    expect(toBytes("Aa01")).to.deep.equal(new Uint8Array([170, 1]));
  });

  it("rejects numeric arrays that would wrap, truncate or contain holes", () => {
    for (const value of [-1, 256, 1.5, NaN, Infinity]) {
      const malformed = new Array(32).fill(1);
      malformed[0] = value;
      expect(() => to32Bytes(malformed)).to.throw();
      expect(() => toBytes(malformed)).to.throw();
    }
    expect(() => toBytes(new Array(2))).to.throw();
    expect(toBytes([0, 255])).to.deep.equal(new Uint8Array([0, 255]));
  });
});
