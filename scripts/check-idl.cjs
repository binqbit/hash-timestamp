#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const util = require("util");

const projectRoot = path.resolve(__dirname, "..");

function parseArguments(argv) {
  const options = {
    actual: path.join(projectRoot, "target/idl/hash_timestamp.json"),
    baseline: path.join(projectRoot, "tests/fixtures/idl.json"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--actual", "--baseline"].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value) {
      throw new Error(`${argument} requires a path`);
    }
    options[argument.slice(2)] = path.resolve(projectRoot, value);
    index += 1;
  }

  return options;
}

function configuredAddress(cluster, config) {
  // Read the scalar program entry used by this project's Anchor configuration.
  const section = config.match(
    new RegExp(`^\\[programs\\.${cluster}\\]\\s*\\n([^\\[]*)`, "m")
  );
  const address = section?.[1].match(
    /^\s*hash_timestamp\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*(?:#.*)?$/m
  )?.[1];
  if (!address) throw new Error(`Missing program address for ${cluster}`);
  return address;
}

function checkConfiguredAddresses(address, config) {
  for (const cluster of ["devnet", "testnet", "localnet"]) {
    if (configuredAddress(cluster, config) !== address) {
      throw new Error(
        `Program address for ${cluster} must match the IDL baseline.`
      );
    }
  }
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} IDL not found: ${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} IDL is not valid JSON: ${error.message}`);
  }
}

// Rust documentation may be reworded without changing the wire contract.
// Object keys are sorted for a stable comparison; array order remains intact
// because instruction accounts, fields, variants, and errors are order-sensitive.
function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .filter((key) => key !== "docs")
      .sort()
      .reduce((result, key) => {
        result[key] = normalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

function firstDifference(expected, actual, location = "IDL") {
  if (Object.is(expected, actual)) {
    return null;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return location;
    }
    if (expected.length !== actual.length) {
      return `${location}.length`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(
        expected[index],
        actual[index],
        `${location}[${index}]`
      );
      if (difference) return difference;
    }
    return null;
  }

  const expectedIsObject = expected !== null && typeof expected === "object";
  const actualIsObject = actual !== null && typeof actual === "object";
  if (expectedIsObject || actualIsObject) {
    if (!expectedIsObject || !actualIsObject) {
      return location;
    }
    const keys = Array.from(
      new Set([...Object.keys(expected), ...Object.keys(actual)])
    ).sort();
    for (const key of keys) {
      if (!(key in expected) || !(key in actual)) {
        return `${location}.${key}`;
      }
      const difference = firstDifference(
        expected[key],
        actual[key],
        `${location}.${key}`
      );
      if (difference) return difference;
    }
    return null;
  }

  return location;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const expected = normalize(readJson(options.baseline, "baseline"));
    checkConfiguredAddresses(
      expected.address,
      fs.readFileSync(path.join(projectRoot, "Anchor.toml"), "utf8")
    );
    const actual = normalize(readJson(options.actual, "generated"));

    if (!util.isDeepStrictEqual(actual, expected)) {
      const location = firstDifference(expected, actual) ?? "IDL";
      console.error(`IDL compatibility check failed at ${location}.`);
      console.error(`Baseline:  ${options.baseline}`);
      console.error(`Generated: ${options.actual}`);
      console.error(
        "If this is an intentional breaking protocol change, review it as a versioned migration and update the baseline explicitly."
      );
      process.exitCode = 1;
    } else {
      console.log(
        `IDL interface and program address match the ${expected.metadata.version} compatibility baseline.`
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { normalize, firstDifference };
if (require.main === module) main();
