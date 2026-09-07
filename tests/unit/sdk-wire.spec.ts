import { strict as assert } from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import { BorshInstructionCoder, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  encodeHashSource,
  encodeRestoreParameters,
} from "../../app/sdk/encoding";
import { prepareRestore } from "../../app/sdk/restore";
import type { HashSource, RestoreParametersInput } from "../../app/sdk/types";
import type { WireProofLink } from "../../app/sdk/wire";
import type { HashTimestamp } from "../../target/types/hash_timestamp";

describe("SDK pinned Anchor wire compatibility", () => {
  it("round-trips every variant and integer endpoint through the real coder", () => {
    // The pinned ABI keeps this unit test independent of build artifacts.
    // check:idl separately verifies the generated IDL; no RPC is invoked here.
    const idl = JSON.parse(
      readFileSync(resolve("tests/fixtures/idl.json"), "utf8")
    );
    const program = new Program<HashTimestamp>(idl, {
      connection: new Connection("http://127.0.0.1:8899"),
    });
    const instructionCoder = new BorshInstructionCoder(program.idl);
    const hash = Buffer.alloc(32, 17);
    const key = new PublicKey(hash);
    const maxU64 = (1n << 64n) - 1n;
    const sources: HashSource[] = [
      { kind: "hash" },
      { kind: "account", account: key },
      {
        kind: "branch",
        previousHashId: hash,
        payload: hash,
        generation: maxU64,
      },
      { kind: "batch", members: [hash] },
      { kind: "pack" },
    ];
    for (const source of sources) {
      const encoded = encodeHashSource(source);
      const bytes = program.coder.types.encode("hashSource", encoded);
      assert.deepStrictEqual(
        program.coder.types.decode("hashSource", bytes),
        encoded
      );
    }
    for (const createdAt of [-(1n << 63n), -1n, 0n, (1n << 63n) - 1n]) {
      const fingerprint = {
        hash,
        sourceKind: 2,
        createdAt,
        generation: maxU64,
      };
      const parameters: RestoreParametersInput[] = [
        { kind: "hash", payload: hash },
        {
          kind: "account",
          snapshot: {
            owner: key,
            lamports: maxU64,
            executable: true,
            rentEpoch: maxU64,
            data: Buffer.from([1, 2, 3]),
          },
        },
        { kind: "branch", parent: fingerprint },
        { kind: "batch", members: [fingerprint] },
        { kind: "pack", members: [fingerprint] },
      ];
      for (const params of parameters) {
        const encoded = encodeRestoreParameters(params);
        const bytes = program.coder.types.encode("restoreParameters", encoded);
        assert.deepStrictEqual(
          program.coder.types.decode("restoreParameters", bytes),
          encoded
        );
      }
      const prepared = prepareRestore(
        [
          {
            hash,
            source: { kind: "hash" },
            createdAt,
            params: { kind: "hash", payload: hash },
          },
        ],
        false
      );
      const bytes = program.coder.instruction.encode("restore", {
        proofChain: prepared.proofEncoded,
      });
      const decoded = instructionCoder.decode(bytes);
      assert.ok(decoded);
      assert.equal(decoded.name, "restore");
      const data = decoded.data as { proofChain: WireProofLink[] };
      assert.deepStrictEqual(data.proofChain, prepared.proofEncoded);
    }
  });
});
