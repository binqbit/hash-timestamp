import { expect } from "chai";
import { readFileSync } from "fs";
import { PublicKey } from "@solana/web3.js";
import {
  parseArchive,
  stringifyArchive,
  mergeArchives,
  selectArchive,
  inspectArchive,
  buildRestoreProof,
  archiveFromProof,
  createArchive,
  deriveHashPda,
  canonicalHashId,
  type HashArchive,
} from "../../app/sdk/hashTimestamp";
import { archiveFixture, digest, hex } from "../support/archive-fixtures";
import {
  nodeFingerprint,
  snapshotFromArchive,
} from "../../app/sdk/archive/values";
import { deriveAccountSnapshotHash } from "../../app/sdk/protocol/hashes";
import { MAX_ARCHIVE_BYTES } from "../../app/sdk/archive/codec";

describe("portable archive format", () => {
  it("keeps the complete documented JSON example valid and byte-derivable", () => {
    expect(
      parseArchive(readFileSync("examples/archive.json", "utf8"))
    ).to.deep.equal(archiveFixture().archive);
  });
  it("round-trips every source, exact integers and deterministic member order", () => {
    const { archive, pdas } = archiveFixture();
    expect(parseArchive(stringifyArchive(archive))).to.deep.equal(archive);
    expect(inspectArchive(archive)).to.deep.equal({
      complete: true,
      missingNodes: [],
      missingWitnesses: [],
    });
    expect(archive.nodes[pdas.account].snapshot!.lamports).to.equal(
      "18446744073709551615"
    );
    const reversed = {
      ...archive,
      nodes: Object.fromEntries(Object.entries(archive.nodes).reverse()),
    };
    expect(stringifyArchive(reversed)).to.equal(stringifyArchive(archive));
    expect(
      parseArchive(stringifyArchive(archive)).nodes[pdas.pack].members
    ).to.deep.equal([pdas.hash, pdas.account]);
  });

  it("merges independently exported single nodes without mutating inputs", () => {
    const { archive } = archiveFixture();
    const files = Object.keys(archive.nodes).map((pda) =>
      selectArchive(archive, [pda], false)
    );
    const before = JSON.stringify(files);
    const merged = mergeArchives(files[0], ...files.slice(1));
    expect(merged).to.deep.equal(archive);
    expect(mergeArchives(merged, merged)).to.deep.equal(merged);
    expect(JSON.stringify(files)).to.equal(before);
    merged.nodes[Object.keys(merged.nodes)[0]].createdAt = "999";
    expect(JSON.stringify(files)).to.equal(before);
  });

  it("reports missing dependencies and witnesses without inventing them", () => {
    const { archive, pdas } = archiveFixture();
    const partial = selectArchive(archive, [pdas.pack], false);
    expect(inspectArchive(partial).missingNodes).to.have.members([
      pdas.hash,
      pdas.account,
    ]);
    delete partial.nodes[pdas.pack].members;
    expect(inspectArchive(partial).missingWitnesses).to.deep.equal([
      { pda: pdas.pack, field: "members" },
    ]);
    expect(() =>
      buildRestoreProof(partial, { anchor: pdas.pack, targets: [] })
    ).to.throw("Missing Pack members");
    const enriched = mergeArchives(partial, archive);
    expect(enriched).to.deep.equal(archive);
    expect(partial.nodes[pdas.pack].members).to.equal(undefined);
  });

  it("rejects conflicting historical incarnations and program identities", () => {
    const { archive, pdas } = archiveFixture();
    const single = selectArchive(archive, [pdas.hash], false);
    const changed = parseArchive(single);
    changed.nodes[pdas.hash].createdAt = "101";
    expect(() => mergeArchives(single, changed)).to.throw(
      "Conflicting historical incarnation"
    );
    expect(() =>
      mergeArchives(single, createArchive(PublicKey.default))
    ).to.throw("different programs");
  });

  it("rejects contradictory witnesses, including member reordering", () => {
    const { archive, pdas } = archiveFixture();
    const partial = selectArchive(archive, [pdas.pack], false);
    const changed = parseArchive(partial);
    changed.nodes[pdas.pack].members!.reverse();
    expect(() => mergeArchives(partial, changed)).to.throw(
      "Conflicting members"
    );
    archive.nodes[pdas.pack].members!.reverse();
    expect(() => parseArchive(archive)).to.throw("commitment mismatch");
  });

  for (const mutation of [
    (a: any, p: any) => {
      a.metadata = {};
    },
    (a: any, p: any) => {
      a.network = "localnet";
    },
    (a: any, p: any) => {
      a.nodes[p.hash].bump = 255;
    },
    (a: any, p: any) => {
      a.nodes[p.hash].createdAt = 100;
    },
    (a: any, p: any) => {
      a.nodes[p.hash].createdAt = "0";
    },
    (a: any, p: any) => {
      a.nodes[p.hash].createdAt = "01";
    },
    (a: any, p: any) => {
      a.nodes[p.hash].createdAt = "9223372036854775808";
    },
    (a: any, p: any) => {
      a.nodes[p.hash].hash = a.nodes[p.hash].hash.toUpperCase();
    },
    (a: any, p: any) => {
      a.nodes[p.hash].members = [p.account];
    },
    (a: any, p: any) => {
      a.nodes[p.hash].source.kind = "group";
    },
    (a: any, p: any) => {
      a.nodes[p.account].snapshot.lamports = "18446744073709551616";
    },
    (a: any, p: any) => {
      a.nodes[p.account].snapshot.data = [256];
    },
    (a: any, p: any) => {
      a.nodes[p.batch].source.members.push(a.nodes[p.batch].source.members[0]);
    },
    (a: any, p: any) => {
      a.nodes[PublicKey.default.toBase58()] = a.nodes[p.hash];
      delete a.nodes[p.hash];
    },
  ]) {
    it(`rejects malformed archive input (${mutation
      .toString()
      .split("=>")[1]
      .trim()})`, () => {
      const { archive, pdas } = archiveFixture();
      mutation(archive, pdas);
      expect(() => parseArchive(archive)).to.throw();
    });
  }

  it("rejects duplicate JSON keys, including escaped equivalents", () => {
    const { archive, pdas } = archiveFixture();
    const json = JSON.stringify(archive);
    expect(() =>
      parseArchive(json.replace('"version":1', '"version":1,"ver\\u0073ion":1'))
    ).to.throw("Duplicate JSON key");
    const value = JSON.stringify(archive.nodes[pdas.hash]);
    expect(() =>
      parseArchive(
        json.replace(
          `"${pdas.hash}":${value}`,
          `"${pdas.hash}":${value},"${pdas.hash}":${value}`
        )
      )
    ).to.throw("Duplicate JSON key");
  });

  it("validates commitments when partial histories become complete", () => {
    const { archive, pdas } = archiveFixture();
    const parent = selectArchive(archive, [pdas.hash], false);
    parent.nodes[pdas.hash].createdAt = "101";
    const child = selectArchive(archive, [pdas.branch], false);
    expect(() => mergeArchives(child, parent)).to.throw("commitment mismatch");
    archive.nodes[pdas.account].snapshot!.data[0] ^= 1;
    expect(() => parseArchive(archive)).to.throw("commitment mismatch");
  });

  it("rejects dependency cycles even in partial Pack archives", () => {
    const { archive, pdas } = archiveFixture();
    const partial = selectArchive(archive, [pdas.pack], false);
    partial.nodes[pdas.pack].members = [pdas.pack];
    expect(() => parseArchive(partial)).to.throw("Cyclic");
  });

  it("keeps a large valid snapshot export within the import byte limit", function () {
    this.timeout(15000);
    const { archive, pdas } = archiveFixture();
    const node = archive.nodes[pdas.account];
    node.snapshot!.data = new Array(1300000).fill(255);
    if (node.source.kind !== "account") throw new Error("fixture");
    node.hash = hex(
      deriveAccountSnapshotHash(
        node.source.account,
        snapshotFromArchive(node.snapshot!)
      )
    );
    const pda = deriveHashPda(
      new PublicKey(archive.programId),
      canonicalHashId(node.hash, 1)
    ).toBase58();
    const large: HashArchive = {
      ...createArchive(archive.programId),
      nodes: { [pda]: node },
    };
    const json = stringifyArchive(large);
    expect(Buffer.byteLength(json)).to.be.at.most(MAX_ARCHIVE_BYTES);
    expect(parseArchive(json).nodes[pda].snapshot!.data.length).to.equal(
      1300000
    );
    expect(() => parseArchive(" ".repeat(MAX_ARCHIVE_BYTES + 1))).to.throw(
      "16 MiB"
    );
  });
});

describe("archive proof compiler", () => {
  it("keeps the full nested closure, deduplicates shared nodes, excludes unrelated history", () => {
    const { archive, pdas } = archiveFixture();
    const proof = buildRestoreProof(archive, {
      anchor: pdas.batch,
      targets: [pdas.hash],
    });
    expect(proof[0].source.kind).to.equal("batch");
    expect(proof).to.have.length(5);
    expect(
      proof.filter(
        (p) =>
          hex(Buffer.from(p.hash as string, "hex")) ===
          archive.nodes[pdas.hash].hash
      )
    ).to.have.length(1);
    expect(
      proof.some((p) => p.hash === archive.nodes[pdas.other].hash)
    ).to.equal(false);
    expect(proof.some((p) => p.hash === archive.nodes[pdas.tip].hash)).to.equal(
      false
    );
    expect(proof.find((p) => p.source.kind === "hash")!.params!.kind).to.equal(
      "hash"
    );
    expect(archiveFromProof(archive.programId, proof)).to.deep.equal(
      selectArchive(archive, [pdas.batch])
    );
  });

  it("only materializes requested Hash leaves; derived nodes remain parametric", () => {
    const { archive, pdas } = archiveFixture();
    const proof = buildRestoreProof(archive, {
      anchor: pdas.batch,
      targets: [pdas.pack],
    });
    expect(proof.find((p) => p.source.kind === "hash")!.params).to.equal(null);
    expect(
      proof.filter((p) => p.source.kind !== "hash").every((p) => !!p.params)
    ).to.equal(true);
    expect(() =>
      buildRestoreProof(archive, { anchor: pdas.branch, targets: [pdas.other] })
    ).to.throw("not reachable");
  });

  it("permits snapshot omission only for supplied existing Accounts, including the anchor", () => {
    const { archive, pdas } = archiveFixture();
    delete archive.nodes[pdas.account].snapshot;
    expect(() =>
      buildRestoreProof(archive, { anchor: pdas.pack, targets: [pdas.hash] })
    ).to.throw("Missing Account snapshot");
    const proof = buildRestoreProof(archive, {
      anchor: pdas.pack,
      targets: [pdas.hash],
      existingAccounts: [pdas.account],
    });
    expect(
      proof.find((p) => p.source.kind === "account")!.params
    ).to.deep.equal({ kind: "account", snapshot: undefined });
    expect(
      buildRestoreProof(archive, { anchor: pdas.account, targets: [] })
    ).to.have.length(1);
  });

  it("rejects contradictory legacy parent/member fingerprints and Hash payloads", () => {
    const { archive, pdas } = archiveFixture();
    const branch = buildRestoreProof(archive, {
      anchor: pdas.branch,
      targets: [pdas.hash],
    });
    branch.push({
      hash: archive.nodes[pdas.other].hash,
      source: { kind: "hash" },
      createdAt: 105n,
    });
    branch[0].params = {
      kind: "branch",
      parent: nodeFingerprint(archive.nodes[pdas.other]),
    };
    expect(() => archiveFromProof(archive.programId, branch)).to.throw(
      "Branch parent"
    );
    const batch = buildRestoreProof(archive, {
      anchor: pdas.batch,
      targets: [],
    });
    if (batch[0].params?.kind !== "batch") throw new Error("fixture");
    batch[0].params.members.reverse();
    expect(() => archiveFromProof(archive.programId, batch)).to.throw(
      "Batch members"
    );
    const hash = {
      hash: archive.nodes[pdas.hash].hash,
      source: { kind: "hash" as const },
      createdAt: 100n,
      params: { kind: "hash" as const, payload: digest("wrong") },
    };
    expect(() => archiveFromProof(archive.programId, [hash])).to.throw(
      "Hash payload"
    );
    hash.params.payload = Buffer.from("archive original");
    expect(archiveFromProof(archive.programId, [hash])).to.deep.equal(
      selectArchive(archive, [pdas.hash], false)
    );
  });
});
