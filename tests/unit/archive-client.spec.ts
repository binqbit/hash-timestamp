import { expect } from "chai";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  HashTimestampClient,
  ArchiveCaptureError,
  ArchiveRestoreExecutionError,
  createArchive,
  addArchiveNode,
  canonicalHashId,
  deriveHashPda,
  deriveBatchHash,
  type HashArchive,
} from "../../app/sdk/hashTimestamp";
import { submitCreation } from "../../app/sdk/client/archive";
import { nodeId } from "../../app/sdk/archive/values";
import {
  archiveFixture,
  fixtureProgram,
  accountInfo,
  digest,
  hex,
} from "../support/archive-fixtures";

async function rejection(operation: Promise<unknown>): Promise<any> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

async function runtime(input?: HashArchive, liveNames: string[] = ["tip"]) {
  const fixture = archiveFixture();
  const archive = input ?? fixture.archive;
  const program = fixtureProgram();
  const client = new HashTimestampClient(program);
  const records = new Map<string, Awaited<ReturnType<typeof accountInfo>>>();
  for (const name of liveNames) {
    const pda = fixture.pdas[name] ?? name;
    records.set(pda, await accountInfo(program, archive, pda));
  }
  const calls: { event: string; value?: unknown }[] = [];
  const sent: Transaction[] = [];
  const provider = program.provider as any;
  provider.wallet = {
    publicKey: Keypair.fromSeed(digest("archive payer")).publicKey,
  };
  provider.publicKey = provider.wallet.publicKey;
  provider.sendAndConfirm = async (tx: Transaction) => {
    sent.push(tx);
    return `signature-${sent.length}`;
  };
  provider.connection.getAccountInfo = async (
    key: PublicKey,
    config: unknown
  ) => {
    calls.push({ event: "read", value: config });
    return records.get(key.toBase58()) ?? null;
  };
  provider.connection.getAccountInfoAndContext = async (key: PublicKey) => ({
    context: { slot: 50 },
    value: records.get(key.toBase58()) ?? null,
  });
  provider.connection.confirmTransaction = async () => {
    calls.push({ event: "confirm" });
    return { context: { slot: 60 }, value: { err: null } };
  };
  return {
    client,
    program,
    provider,
    archive,
    pdas: fixture.pdas,
    records,
    calls,
    sent,
  };
}

function hashBatch(count: number) {
  const { archive: fixture } = archiveFixture();
  let archive = createArchive(fixture.programId);
  const hashes = Array.from({ length: count }, (_, i) => digest(`split-${i}`));
  const targets = hashes.map((hash, i) => {
    const pda = deriveHashPda(
      new PublicKey(archive.programId),
      canonicalHashId(hash, 0)
    ).toBase58();
    archive = addArchiveNode(archive, pda, {
      hash: hex(hash),
      source: { kind: "hash" },
      createdAt: String(100 + i),
    });
    return pda;
  });
  const hash = deriveBatchHash(
    hashes.map((hash, i) => ({ hash, kind: 0, createdAt: 100 + i }))
  );
  const anchor = deriveHashPda(
    new PublicKey(archive.programId),
    canonicalHashId(hash, 3)
  ).toBase58();
  archive = addArchiveNode(archive, anchor, {
    hash: hex(hash),
    createdAt: "200",
    source: {
      kind: "batch",
      members: targets.map((pda) => hex(nodeId(archive.nodes[pda]))),
    },
  });
  return { archive, anchor, targets };
}

describe("archive restore planning and execution", () => {
  it("compiles real Anchor instructions and requires explicit approval for extra creations", async () => {
    const f = await runtime();
    const plan = await f.client.planRestore(f.archive, {
      targets: [f.pdas.hash],
    });
    expect(f.sent).to.have.length(0);
    expect(plan.steps).to.have.length(1);
    expect(plan.steps[0].expectedCreations).to.have.members([
      f.pdas.hash,
      f.pdas.branch,
    ]);
    expect(plan.steps[0].additionalRequiredCreations).to.deep.equal([
      f.pdas.branch,
    ]);
    expect(plan.steps[0].transactionBytes).to.be.at.most(1232);
    expect(
      String(await rejection(f.client.executeRestorePlan(plan)))
    ).to.include("allowAdditionalRecords");
    // Display objects are not authorization: editing them cannot alter private signed effects.
    plan.steps[0].additionalRequiredCreations.length = 0;
    plan.steps[0].proof.length = 0;
    expect(
      String(await rejection(f.client.executeRestorePlan(plan)))
    ).to.include("allowAdditionalRecords");
    const result = await f.client.executeRestorePlan(plan, {
      allowAdditionalRecords: true,
    });
    expect(result.signatures).to.deep.equal(["signature-1"]);
    expect(Object.keys(result.archive.nodes)).to.have.members([
      f.pdas.tip,
      f.pdas.branch,
      f.pdas.hash,
    ]);
    expect(f.sent[0].instructions[0].data.length).to.be.greaterThan(0);
  });

  it("chooses a nearer live anchor and locks existing intermediate pairs read-only", async () => {
    const f = await runtime(undefined, ["tip", "branch"]);
    const auto = await f.client.planRestore(f.archive, {
      targets: [f.pdas.hash],
    });
    expect(auto.steps[0].anchor).to.equal(f.pdas.branch);
    const explicit = await f.client.planRestore(f.archive, {
      anchor: f.pdas.tip,
      targets: [f.pdas.hash],
    });
    expect(explicit.steps[0].expectedCreations).to.deep.equal([f.pdas.hash]);
    await f.client.executeRestorePlan(explicit);
    const keys = f.sent[0].instructions[0].keys;
    const branchIndex = keys.findIndex(
      (meta) => meta.pubkey.toBase58() === f.pdas.branch
    );
    expect(keys[branchIndex].isWritable).to.equal(false);
    expect(keys[branchIndex + 1].isWritable).to.equal(false);
    expect(
      keys.find((meta) => meta.pubkey.toBase58() === f.pdas.hash)!.isWritable
    ).to.equal(true);
  });

  it("returns already-present targets without signing or creating votes", async () => {
    const f = await runtime(undefined, ["hash"]);
    const plan = await f.client.planRestore(f.archive, {
      targets: [f.pdas.hash],
    });
    expect(plan.alreadyPresent).to.deep.equal([f.pdas.hash]);
    expect(plan.steps).to.have.length(0);
    const result = await f.client.executeRestorePlan(plan);
    expect(result.signatures).to.deep.equal([]);
    expect(result.archive.nodes[f.pdas.hash]).to.deep.equal(
      f.archive.nodes[f.pdas.hash]
    );
    expect(f.sent).to.have.length(0);
  });

  it("does not interpret RPC failure, corrupt records or conflicting history as absence", async () => {
    for (const kind of ["rpc", "owner", "bump", "timestamp"]) {
      const f = await runtime();
      if (kind === "rpc") {
        const read = f.provider.connection.getAccountInfo;
        f.provider.connection.getAccountInfo = async (
          key: PublicKey,
          config: unknown
        ) => {
          if (key.toBase58() === f.pdas.hash)
            throw new Error("transport unavailable");
          return read(key, config);
        };
      } else {
        const info = await accountInfo(f.program, f.archive, f.pdas.hash);
        if (kind === "owner") info.owner = PublicKey.default;
        if (kind === "bump") info.data[info.data.length - 1] ^= 1;
        if (kind === "timestamp") {
          const alternate = {
            ...f.archive,
            nodes: {
              ...f.archive.nodes,
              [f.pdas.hash]: {
                ...f.archive.nodes[f.pdas.hash],
                createdAt: "101",
              },
            },
          };
          Object.assign(
            info,
            await accountInfo(f.program, alternate, f.pdas.hash)
          );
        }
        f.records.set(f.pdas.hash, info);
      }
      expect(
        String(
          await rejection(
            f.client.planRestore(f.archive, {
              anchor: f.pdas.tip,
              targets: [f.pdas.hash],
            })
          )
        )
      ).to.include("No complete");
      expect(f.sent).to.have.length(0);
    }
  });

  it("allows prefunded empty System-owned placeholders", async () => {
    const f = await runtime(undefined, ["branch"]);
    f.records.set(f.pdas.hash, {
      owner: SystemProgram.programId,
      executable: false,
      data: Buffer.alloc(0),
      lamports: 1,
      rentEpoch: 0,
    });
    const plan = await f.client.planRestore(f.archive, {
      targets: [f.pdas.hash],
    });
    expect(plan.steps[0].expectedCreations).to.deep.equal([f.pdas.hash]);
  });

  it("requires a non-tip Account snapshot in proof-only mode even if the account is live", async () => {
    const f = await runtime(undefined, ["pack", "account"]);
    delete f.archive.nodes[f.pdas.account].snapshot;
    const create = await f.client.planRestore(f.archive, {
      anchor: f.pdas.pack,
      targets: [f.pdas.hash],
    });
    expect(create.steps).to.have.length(1);
    expect(
      String(
        await rejection(
          f.client.planRestore(f.archive, {
            anchor: f.pdas.pack,
            targets: [f.pdas.hash],
            createAccounts: false,
          })
        )
      )
    ).to.include("Missing Account snapshot");
  });

  it("verifies historical Hashes without materializing accounts", async () => {
    const f = await runtime();
    const plan = await f.client.planRestore(f.archive, {
      anchor: f.pdas.tip,
      targets: [f.pdas.hash],
      createAccounts: false,
    });
    expect(plan.steps[0].requestedAccounts).to.deep.equal([]);
    await f.client.executeRestorePlan(plan);
    expect(f.sent[0].instructions[0].keys).to.have.length(3);
  });

  it("uses multiple complete proofs from the same anchor when all targets will not fit", async () => {
    const batch = hashBatch(5);
    const f = await runtime(batch.archive, [batch.anchor]);
    const plan = await f.client.planRestore(batch.archive, {
      anchor: batch.anchor,
      targets: batch.targets,
    });
    expect(plan.steps.length).to.be.greaterThan(1);
    expect(plan.steps.flatMap((step) => step.targets)).to.have.members(
      batch.targets
    );
    for (const step of plan.steps) {
      expect(step.proof).to.have.length(6);
      expect(step.transactionBytes).to.be.at.most(1232);
      expect(step.additionalRequiredCreations).to.deep.equal([]);
    }
  });

  it("rejects a proof whose complete closure cannot fit even for a single target", async () => {
    const batch = hashBatch(12);
    const f = await runtime(batch.archive, [batch.anchor]);
    expect(
      String(
        await rejection(
          f.client.planRestore(batch.archive, {
            anchor: batch.anchor,
            targets: [batch.targets[0]],
          })
        )
      )
    ).to.include("No complete");
    expect(f.sent).to.have.length(0);
  });

  it("binds an executable plan to its connection, signers and private SDK identity", async () => {
    const f = await runtime(undefined, ["branch"]);
    const plan = await f.client.planRestore(f.archive, {
      targets: [f.pdas.hash],
    });
    expect(
      String(await rejection(f.client.executeRestorePlan({ ...plan })))
    ).to.include("Unknown restore plan");
    expect(
      String(
        await rejection(
          f.client.executeRestorePlan(plan, {}, Keypair.generate())
        )
      )
    ).to.include("signer changed");
    f.provider.connection = new Connection("http://127.0.0.1:19999");
    expect(
      String(await rejection(f.client.executeRestorePlan(plan)))
    ).to.include("connection");
    expect(f.sent).to.have.length(0);
  });

  it("preserves completed receipts when a later independent transaction fails", async () => {
    const batch = hashBatch(5);
    const f = await runtime(batch.archive, [batch.anchor]);
    const plan = await f.client.planRestore(batch.archive, {
      anchor: batch.anchor,
      targets: batch.targets,
    });
    let calls = 0;
    f.provider.sendAndConfirm = async () => {
      if (++calls === 2) throw new Error("wallet rejected");
      return "first-signature";
    };
    const error = await rejection(f.client.executeRestorePlan(plan));
    expect(error).to.be.instanceOf(ArchiveRestoreExecutionError);
    expect(error.failedStep).to.equal(1);
    expect(error.completed.signatures).to.deep.equal(["first-signature"]);
    expect(Object.keys(error.completed.archive.nodes)).to.have.members(
      Object.keys(batch.archive.nodes)
    );
    expect(calls).to.equal(2);
  });
});

describe("creation archive receipts", () => {
  it("register returns exactly the new node and the chain timestamp after confirmation", async () => {
    const f = await runtime(undefined, ["hash"]);
    const result = await f.client.register(f.archive.nodes[f.pdas.hash].hash);
    expect(result.signature).to.equal("signature-1");
    expect(Object.keys(result.archive.nodes)).to.deep.equal([f.pdas.hash]);
    expect(result.archive.nodes[f.pdas.hash].createdAt).to.equal("100");
    expect(f.calls).to.deep.equal([
      { event: "confirm" },
      { event: "read", value: { commitment: "confirmed", minContextSlot: 60 } },
    ]);
  });

  it("retains Branch, Batch, Pack and Account witnesses without dependency nodes", async () => {
    const f = await runtime(undefined, [
      "hash",
      "branch",
      "pack",
      "batch",
      "account",
    ]);
    for (const name of ["branch", "pack", "batch", "account"]) {
      const { createdAt, ...pending } = f.archive.nodes[f.pdas[name]];
      const builder = {
        rpc: async () => "created-signature",
        signers: () => builder,
      };
      const result = await submitCreation(f.program, builder, pending);
      expect(Object.keys(result.archive.nodes)).to.deep.equal([f.pdas[name]]);
      expect(result.archive.nodes[f.pdas[name]]).to.deep.equal(
        f.archive.nodes[f.pdas[name]]
      );
    }
  });

  it("rejects an invalid pending snapshot before sending", async () => {
    const f = await runtime();
    const { createdAt, ...pending } = f.archive.nodes[f.pdas.account];
    pending.snapshot!.data[0] ^= 1;
    let calls = 0;
    const builder = {
      rpc: async () => {
        calls++;
        return "never";
      },
      signers: () => builder,
    };
    expect(
      String(await rejection(submitCreation(f.program, builder, pending)))
    ).to.include("commitment mismatch");
    expect(calls).to.equal(0);
  });

  it("preserves the signature on failed capture or uncertain confirmation without retrying", async () => {
    for (const confirmed of [true, false]) {
      const f = await runtime(undefined, []);
      if (!confirmed)
        f.provider.connection.confirmTransaction = async () => {
          throw new Error("confirmation transport failure");
        };
      const error = await rejection(
        f.client.register(f.archive.nodes[f.pdas.hash].hash)
      );
      expect(error).to.be.instanceOf(ArchiveCaptureError);
      expect(error.signature).to.equal("signature-1");
      expect(error.status).to.equal(confirmed ? "confirmed" : "submitted");
      expect(error.pda).to.equal(f.pdas.hash);
      expect(error.pendingNode).to.deep.equal({
        hash: f.archive.nodes[f.pdas.hash].hash,
        source: { kind: "hash" },
      });
      expect(f.sent).to.have.length(1);
    }
  });
});
