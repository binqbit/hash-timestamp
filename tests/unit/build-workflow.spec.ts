import { strict as assert } from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const programId = "HTSx1wheA1TnHSEbKWxmtXKgJNyRfF3QxeK2hHQcJ9pN";
const otherId = "11111111111111111111111111111111";
const repository = process.cwd();

describe("program build workflow", () => {
  let fixture: string;
  let callsFile: string;

  beforeEach(() => {
    fixture = fs.mkdtempSync(
      path.join(os.tmpdir(), "hash-timestamp-build-test-")
    );
    for (const file of [
      "Anchor.toml",
      "scripts/test.sh",
      "scripts/check-idl.cjs",
      "tests/fixtures/idl-v3.json",
      "tests/fixtures/build-driver.cjs",
    ]) {
      const destination = path.join(fixture, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repository, file), destination);
    }
    const driver = path.join(fixture, "tests/fixtures/build-driver.cjs");
    fs.chmodSync(driver, 0o755);
    const bin = path.join(fixture, "node_modules/.bin");
    fs.mkdirSync(bin, { recursive: true });
    // No real Rust installation, build, wallet, RPC, or validator is used.
    for (const executable of ["cargo", "rustup"]) {
      fs.symlinkSync(driver, path.join(bin, executable));
    }
    callsFile = path.join(fixture, "anchor-calls.jsonl");
    fs.writeFileSync(callsFile, "");
  });

  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

  function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
    const result = spawnSync("bash", ["scripts/test.sh", ...args], {
      cwd: fixture,
      env: {
        ...process.env,
        ANCHOR_BIN: path.join(fixture, "tests/fixtures/build-driver.cjs"),
        BUILD_TEST_CALLS: callsFile,
        BUILD_TEST_FAIL: "0",
        BUILD_TEST_ADDRESS: "",
        ...extraEnv,
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.ifError(result.error);
    return result;
  }

  function calls(): string[][] {
    return fs
      .readFileSync(callsFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  function build() {
    const result = run(["--build-only"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    fs.writeFileSync(callsFile, "");
  }

  function checkIdl(args: string[] = []) {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-idl.cjs", ...args],
      {
        cwd: fixture,
        encoding: "utf8",
        timeout: 10000,
      }
    );
    assert.ifError(result.error);
    return result;
  }

  it("builds the program without deployment or test execution", () => {
    const result = run(["--build-only"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(), [["clean"], ["build", "--"]]);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(fixture, "target/idl/hash_timestamp.json"),
          "utf8"
        )
      ).address,
      programId
    );
  });

  it("passes the Cargo arguments to Anchor build", () => {
    const result = run(["--build-only", "--", "--offline"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(), [["clean"], ["build", "--", "--offline"]]);
  });

  it("builds once and runs tests with the shared identity and debug logs", () => {
    const result = run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(), [
      ["clean"],
      ["build", "--", "--features", "debug-logs"],
      ["test", "--skip-build", "--", "--features", "debug-logs"],
    ]);
  });

  it("quick mode reuses a build without rebuilding, deploying or starting a validator", () => {
    build();
    const result = run([
      "--quick",
      "--skip-build",
      "--skip-deploy",
      "--skip-local-validator",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(calls(), [
      [
        "test",
        "--skip-build",
        "--skip-deploy",
        "--skip-local-validator",
        "--",
        "--features",
        "debug-logs",
      ],
    ]);
  });

  for (const flag of ["--quick", "--skip-build"]) {
    it(`rejects a mismatched address before invoking Anchor test with ${flag}`, () => {
      build();
      const file = path.join(fixture, "target/idl/hash_timestamp.json");
      const idl = JSON.parse(fs.readFileSync(file, "utf8"));
      idl.address = otherId;
      fs.writeFileSync(file, JSON.stringify(idl));
      const result = run([flag]);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /IDL compatibility check failed at IDL.address/
      );
      assert.deepEqual(calls(), []);
    });
  }

  it("rejects missing artifacts before invoking Anchor test", () => {
    assert.equal(run(["--quick"]).status, 1);
    assert.deepEqual(calls(), []);
    build();
    fs.unlinkSync(path.join(fixture, "target/deploy/hash_timestamp.so"));
    assert.match(run(["--quick"]).stderr, /Program artifact is missing/);
    assert.deepEqual(calls(), []);
  });

  it("rejects keypair-based deployment to a manually managed validator", () => {
    assert.equal(run(["--skip-local-validator"]).status, 1);
    assert.deepEqual(calls(), []);
  });

  it("prints build help without cleaning or building", () => {
    const result = run(["--build-only", "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--build-only/);
    assert.deepEqual(calls(), []);
  });

  it("rejects a localnet configuration pointing to a different identity", () => {
    build();
    const file = path.join(fixture, "Anchor.toml");
    const config = fs
      .readFileSync(file, "utf8")
      .replace(
        /(\[programs\.localnet\]\s*\n\s*hash_timestamp\s*=\s*")[^"]+/,
        `$1${otherId}`
      );
    fs.writeFileSync(file, config);
    const result = run(["--quick"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Program address for localnet must match/);
    assert.deepEqual(calls(), []);
  });

  it("propagates build failure without invoking tests", () => {
    const result = run([], { BUILD_TEST_FAIL: "1" });
    assert.equal(result.status, 7);
    assert.deepEqual(
      calls().map((args) => args[0]),
      ["clean", "build"]
    );
  });

  it("rejects an incorrectly addressed build before invoking tests", () => {
    const result = run([], { BUILD_TEST_ADDRESS: otherId });
    assert.equal(result.status, 1);
    assert.deepEqual(
      calls().map((args) => args[0]),
      ["clean", "build"]
    );
  });

  it("checks the program ID without ignoring account-layout or nested-address changes", () => {
    build();
    assert.equal(checkIdl().status, 0);
    const file = path.join(fixture, "target/idl/hash_timestamp.json");
    const original = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const mutate of [
      (idl: any) => {
        delete idl.address;
      },
      (idl: any) => {
        idl.instructions[0].accounts[0].writable = false;
      },
      (idl: any) => {
        idl.instructions[0].accounts.find(
          (account: any) => account.name === "system_program"
        ).address = programId;
      },
    ]) {
      const idl = structuredClone(original);
      mutate(idl);
      fs.writeFileSync(file, JSON.stringify(idl));
      assert.equal(checkIdl().status, 1);
    }
  });
});
