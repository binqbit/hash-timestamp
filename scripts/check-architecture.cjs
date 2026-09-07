#!/usr/bin/env node
// Lightweight dependency guard, not a Rust parser or a security audit.
// The compiler, ABI vectors and transaction tests remain authoritative.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function readSources(root) {
  const sources = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), {
      withFileTypes: true,
    })) {
      const name = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (/\.(rs|ts)$/.test(name))
        sources[name] = fs.readFileSync(path.join(root, name), "utf8");
    }
  }
  visit("programs/hash-timestamp/src");
  visit("app/sdk");
  return sources;
}

function inspectSources(sources) {
  const errors = [];
  const imports = new Map();
  for (const [file, original] of Object.entries(sources)) {
    // Ignore explanatory comments; these lexical rules intentionally stay small.
    const code = original
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const rust = file.match(
      /^programs\/hash-timestamp\/src\/(instructions|protocol|runtime|state)\/(.+)\.rs$/
    );
    if (rust && !/(^|\/)tests\.rs$|_tests\.rs$/.test(file)) {
      const [, layer, name] = rust;
      const forbid = (pattern, message) => {
        if (pattern.test(code)) errors.push(file + ": " + message);
      };
      if (layer === "instructions") {
        if (name.includes("/"))
          errors.push(
            file + ": instructions must remain flat contexts and scenarios"
          );
        forbid(
          /\b(?:try_borrow(?:_mut)?_(?:data|lamports)|to_account_info|invoke_signed|invoke|CpiContext)\b|\b(?:Clock|Rent)::get\s*\(/,
          "move account mechanics into runtime"
        );
      }
      if (layer === "protocol" || layer === "state") {
        forbid(
          /\bcrate::(?:runtime|instructions)\b/,
          "value layers cannot depend on runtime or instructions"
        );
        forbid(
          /\bCpiContext\b|\bprogram::invoke(?:_signed)?\b|\b(?:Clock|Rent)::get\s*\(/,
          "value layers cannot perform CPI or read sysvars"
        );
        if (layer === "protocol") {
          forbid(
            /\b(?:AccountInfo|UncheckedAccount)\b|\b(?:Account|Context)\s*</,
            "protocol cannot access live accounts"
          );
        }
      }
      if (layer === "runtime") {
        forbid(
          /\bcrate::instructions\b|\bContext\s*</,
          "runtime must not own instruction contexts or scenarios"
        );
      }
    }
    if (file.startsWith("app/sdk/")) {
      const dependencies = ts
        .preProcessFile(original)
        .importedFiles.map(({ fileName }) => fileName)
        .filter((name) => name.startsWith("."))
        .map(
          (name) =>
            path.posix.normalize(
              path.posix.join(path.posix.dirname(file), name)
            ) + ".ts"
        );
      imports.set(file, dependencies);
      if (
        !["app/sdk/hashTimestamp.ts", "app/sdk/hashUtils.ts"].includes(file)
      ) {
        for (const dependency of dependencies) {
          if (
            [
              "app/sdk/hashTimestamp.ts",
              "app/sdk/hashUtils.ts",
              "app/sdk/client.ts",
            ].includes(dependency)
          ) {
            errors.push(
              file +
                ": internal modules must import leaves, not public façades or client"
            );
          }
          if (
            file.startsWith("app/sdk/protocol/") &&
            !dependency.startsWith("app/sdk/protocol/") &&
            dependency !== "app/sdk/types.ts"
          ) {
            errors.push(
              file +
                ": SDK protocol may depend only on protocol values and types"
            );
          }
        }
      }
    }
  }
  const visited = new Set(),
    active = new Set();
  function walk(file) {
    if (active.has(file)) {
      errors.push(file + ": SDK dependency cycle");
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    for (const dependency of imports.get(file) || []) walk(dependency);
    active.delete(file);
    visited.add(file);
  }
  for (const file of imports.keys()) walk(file);
  return errors;
}

module.exports = { readSources, inspectSources };
if (require.main === module) {
  const errors = inspectSources(readSources(path.resolve(__dirname, "..")));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Architecture boundaries: OK");
  }
}
