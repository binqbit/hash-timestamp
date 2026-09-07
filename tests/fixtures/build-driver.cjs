#!/usr/bin/env node
// Unit-test stand-in: records Anchor invocations and emits disposable artifacts.
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log("anchor-cli 0.31.1");
  process.exit(0);
}
fs.appendFileSync(process.env.BUILD_TEST_CALLS, JSON.stringify(args) + "\n");
if (args[0] === "build") {
  if (process.env.BUILD_TEST_FAIL === "1") process.exit(7);
  const idl = JSON.parse(fs.readFileSync("tests/fixtures/idl.json", "utf8"));
  idl.address = process.env.BUILD_TEST_ADDRESS || idl.address;
  fs.mkdirSync("target/idl", { recursive: true });
  fs.mkdirSync("target/deploy", { recursive: true });
  fs.writeFileSync("target/idl/hash_timestamp.json", JSON.stringify(idl));
  fs.writeFileSync(
    path.join("target/deploy", "hash_timestamp.so"),
    "test fixture"
  );
} else if (!["clean", "test"].includes(args[0])) {
  throw new Error(`Unexpected Anchor command: ${args[0]}`);
}
