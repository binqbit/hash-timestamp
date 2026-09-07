import { expect } from "chai";
import { mockCapture } from "../support/archive-fixtures";
import { BN, Program } from "@coral-xyz/anchor";
import {
  AccountInfo,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { HashTimestamp } from "../../target/types/hash_timestamp";
import {
  HashAccountData,
  HashSourceKind,
  HashTimestampClient,
  RestoreApi,
  canonicalHashId,
  deriveAccountMetadataHash,
  deriveBranchHash,
  deriveGenesisHashId,
  to32Bytes,
} from "../../app/sdk/hashTimestamp";

const key = (value: number) => new PublicKey(Buffer.alloc(32, value));
const rawHash = Buffer.alloc(32, 2);
const hashId = deriveGenesisHashId(rawHash);
const explicitPayer = Keypair.fromSeed(new Uint8Array(32).fill(3));
const snapshot: HashAccountData = {
  hash: [...rawHash],
  voters: new BN(1),
  createdAt: new BN(100),
  bump: 255,
  source: { hash: {} },
};
const targetInfo: AccountInfo<Buffer> = {
  owner: key(4),
  lamports: 1000,
  executable: false,
  rentEpoch: 0,
  data: Buffer.from([1, 2, 3]),
};

function fixture() {
  const calls: string[] = [];
  const capture: {
    method?: string;
    args?: unknown[];
    accounts?: Record<string, PublicKey>;
    signers?: Keypair[];
  } = {};
  let rpcError: unknown;
  const rpc = async () => {
    calls.push("rpc");
    if (rpcError) throw rpcError;
    return "test-signature";
  };
  const builder = {
    accountsStrict(accounts: Record<string, PublicKey>) {
      calls.push("accounts");
      capture.accounts = accounts;
      return builder;
    },
    remainingAccounts(_accounts: unknown[]) {
      return builder;
    },
    signers(signers: Keypair[]) {
      calls.push("signers");
      capture.signers = signers;
      // Deliberately return a different object: callers must use the signed builder.
      return { rpc };
    },
    rpc,
  };
  const method =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(name);
      capture.method = name;
      capture.args = args;
      return builder;
    };
  const program = {
    programId: key(1),
    provider: {
      wallet: { publicKey: key(5) },
      connection: { getAccountInfo: async (_address: PublicKey) => targetInfo },
    },
    methods: Object.fromEntries(
      [
        "register",
        "vote",
        "unvote",
        "verify",
        "branch",
        "batch",
        "pack",
        "account",
        "restore",
      ].map((name) => [name, method(name)])
    ),
    account: {
      hashAccount: {
        fetch: async () => snapshot,
        fetchNullable: async () => snapshot,
      },
    },
  };
  const client = new HashTimestampClient(
    program as unknown as Program<HashTimestamp>
  );
  mockCapture(program, rawHash, { kind: "hash" });
  return {
    client,
    program,
    capture,
    calls,
    failRpc: (error: unknown) => {
      rpcError = error;
    },
  };
}

async function rejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

describe("SDK client boundaries", () => {
  for (const operation of ["register", "vote", "unvote"] as const) {
    for (const payer of [undefined, explicitPayer]) {
      it(`${operation} preserves ${
        payer ? "explicit" : "wallet"
      } signing and account mapping`, async () => {
        const { client, program, capture, calls } = fixture();
        const user = payer
          ? payer.publicKey
          : program.provider.wallet.publicKey;
        if (payer)
          Object.defineProperty(program.provider, "wallet", {
            get() {
              throw new Error("explicit signer must not read wallet");
            },
          });
        const result = await client[operation](
          operation === "register" ? rawHash : hashId,
          payer
        );
        expect(typeof result === "string" ? result : result.signature).to.equal(
          "test-signature"
        );
        expect(capture.args).to.deep.equal(
          operation === "register" ? [[...rawHash]] : []
        );
        expect(capture.accounts).to.deep.equal({
          hashAccount: client.hashPda(hashId),
          voteInfo: client.votePda(hashId, user),
          user,
          systemProgram: SystemProgram.programId,
        });
        expect(capture.signers).to.deep.equal(payer ? [payer] : undefined);
        expect(calls).to.deep.equal([
          operation,
          "accounts",
          ...(payer ? ["signers"] : []),
          "rpc",
        ]);
      });
    }
  }

  it("verify uses the public PDA override without reading the SDK wallet or accounts", async () => {
    const { client, program, capture, calls } = fixture();
    client.hashPda = () => key(9);
    Object.defineProperty(program.provider, "wallet", {
      get() {
        throw new Error("wallet read");
      },
    });
    Object.defineProperty(program, "account", {
      get() {
        throw new Error("account read");
      },
    });
    expect(await client.verify(hashId)).to.equal("test-signature");
    expect(capture.accounts).to.deep.equal({ hashAccount: key(9) });
    expect(calls).to.deep.equal(["verify", "accounts", "rpc"]);
  });

  for (const takeVote of [undefined, false]) {
    it(`branch preserves late overrides, legacy metadata and takeVote=${String(
      takeVote
    )}`, async () => {
      const { client, program, capture } = fixture();
      const originalUser = program.provider.wallet.publicKey;
      const payload = Buffer.alloc(32, 7);
      const derivedHash = deriveBranchHash(
        hashId,
        -10n,
        2n,
        HashSourceKind.Branch,
        payload
      );
      const childId = canonicalHashId(derivedHash, HashSourceKind.Branch);
      const reads: Uint8Array[] = [];
      client.fetchHashAccount = async (id) => {
        reads.push(to32Bytes(id));
        program.provider = {
          ...program.provider,
          wallet: { publicKey: key(18) },
        };
        return {
          ...snapshot,
          createdAt: undefined,
          created_at: -10n,
          source: {
            branch: {
              previousHashId: [...rawHash],
              payload: [...payload],
              generation: new BN(2),
            },
          },
        } as HashAccountData;
      };
      client.hashPda = (id) =>
        Buffer.from(to32Bytes(id)).equals(Buffer.from(hashId))
          ? key(10)
          : key(11);
      client.votePda = (id, user) => {
        expect(user).to.deep.equal(originalUser);
        return Buffer.from(to32Bytes(id)).equals(Buffer.from(hashId))
          ? key(12)
          : key(13);
      };
      Object.defineProperty(program, "account", {
        get() {
          throw new Error("bypassed public fetch");
        },
      });
      const pdaIds: Uint8Array[] = [];
      const derivePda = client.hashPda;
      client.hashPda = (id) => {
        pdaIds.push(to32Bytes(id));
        return derivePda(id);
      };
      mockCapture(program, derivedHash, {
        kind: "branch",
        previousHashId: hashId,
        payload,
        generation: 3n,
      });
      expect(
        (await client.branch(hashId, payload, takeVote)).signature
      ).to.equal("test-signature");
      expect(reads).to.deep.equal([hashId]);
      expect(pdaIds).to.deep.equal([hashId, childId]);
      expect(capture.args).to.deep.equal([[...payload], takeVote !== false]);
      expect(capture.accounts).to.deep.equal({
        hashAccount: key(10),
        newHashAccount: key(11),
        voteInfo: key(12),
        newVoteInfo: key(13),
        user: originalUser,
        systemProgram: SystemProgram.programId,
      });
    });
  }

  it("branch rejects a missing parent before creating the builder", async () => {
    const { client, calls } = fixture();
    client.fetchHashAccount = async () => null;
    expect(
      ((await rejection(client.branch(hashId, rawHash))) as Error).message
    ).to.equal("old hash account not found");
    expect(calls).to.deep.equal([]);
  });

  it("hashAccount uses the current connection and returns precisely the metadata commitment result", async () => {
    const { client, program, capture } = fixture();
    const target = key(20);
    const addresses: PublicKey[] = [];
    program.provider = {
      wallet: { publicKey: key(21) },
      connection: {
        getAccountInfo: async (address) => {
          addresses.push(address);
          return targetInfo;
        },
      },
    };
    const metadataHash = deriveAccountMetadataHash(target, targetInfo);
    const expectedId = canonicalHashId(metadataHash, HashSourceKind.Account);
    mockCapture(program, metadataHash, { kind: "account", account: target });
    const { archive, ...result } = await client.hashAccount(target);
    expect(Object.keys(archive.nodes)).to.deep.equal([
      client.hashPda(expectedId).toBase58(),
    ]);
    expect(result).to.deep.equal({
      signature: "test-signature",
      hashId: expectedId,
      metadataHash,
    });
    expect(addresses).to.deep.equal([target]);
    expect(capture.accounts).to.deep.equal({
      hashAccount: client.hashPda(expectedId),
      voteInfo: client.votePda(expectedId, key(21)),
      target,
      payer: key(21),
      systemProgram: SystemProgram.programId,
    });
  });

  it("hashAccount rejects an absent target before creating the builder", async () => {
    const { client, program, calls } = fixture();
    program.provider.connection.getAccountInfo = async () => null;
    expect(
      ((await rejection(client.hashAccount(key(20)))) as Error).message
    ).to.equal("target account not found");
    expect(calls).to.deep.equal([]);
  });

  for (const accountName of ["hashAccount", "voteInfo"] as const) {
    it(`${accountName} fetch preserves receiver, modern errors and legacy null fallback`, async () => {
      const { client, program } = fixture();
      const address = key(22);
      client.hashPda = () => address;
      client.votePda = () => address;
      const result = { marker: "raw account data" };
      const sentinel = new Error("RPC/decode failure");
      let fail = false;
      let empty = false;
      const reader: {
        fetch(address: PublicKey): Promise<unknown>;
        fetchNullable?(address: PublicKey): Promise<unknown>;
      } = {
        async fetch(actual) {
          expect(this).to.equal(reader);
          expect(actual).to.equal(address);
          if (fail) throw sentinel;
          return result;
        },
        async fetchNullable(actual) {
          expect(this).to.equal(reader);
          expect(actual).to.equal(address);
          if (fail) throw sentinel;
          return empty ? null : result;
        },
      };
      Object.defineProperty(program, "account", {
        value: { [accountName]: reader },
      });
      const fetchAccount = () =>
        accountName === "hashAccount"
          ? client.fetchHashAccount(hashId)
          : client.fetchVoteInfo(hashId, key(23));
      expect(await fetchAccount()).to.equal(result);
      empty = true;
      expect(await fetchAccount()).to.equal(null);
      fail = true;
      expect(await rejection(fetchAccount())).to.equal(sentinel);
      delete reader.fetchNullable;
      expect(await fetchAccount()).to.equal(null);
      fail = false;
      expect(await fetchAccount()).to.equal(result);
    });
  }

  it("propagates submission failures without retrying or changing the error", async () => {
    for (const objectResult of [false, true]) {
      const { client, calls, failRpc } = fixture();
      const sentinel = new Error("transaction failed");
      failRpc(sentinel);
      expect(
        await rejection(
          objectResult ? client.hashAccount(key(20)) : client.vote(hashId)
        )
      ).to.equal(sentinel);
      expect(calls.filter((call) => call === "rpc")).to.have.length(1);
    }
  });

  it("restore retains payer precedence and RestoreApi forwards a current client override", async () => {
    const { client, capture } = fixture();
    const proof = [
      { hash: rawHash, source: { kind: "hash" as const }, createdAt: 100n },
    ];
    const thirdPayer = Keypair.fromSeed(new Uint8Array(32).fill(24));
    await client.restore(proof, explicitPayer, thirdPayer);
    expect(capture.signers).to.deep.equal([explicitPayer]);
    const api = new RestoreApi(client);
    const expected = { signature: "overridden", restoredIds: [hashId] };
    client.restore = async (actualProof, options, payer) => {
      expect(actualProof).to.equal(proof);
      expect(options).to.equal(undefined);
      expect(payer).to.equal(thirdPayer);
      return expected;
    };
    expect(await api.restore(proof, undefined, thirdPayer)).to.equal(expected);
  });
});
