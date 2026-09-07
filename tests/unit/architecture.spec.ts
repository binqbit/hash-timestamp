import { expect } from "chai";
import * as path from "path";
import guard from "../../scripts/check-architecture.cjs";
const { readSources, inspectSources } = guard;

describe("architecture boundaries", () => {
  it("keeps the repository's layer dependencies clean", () => {
    expect(
      inspectSources(readSources(path.resolve(process.cwd())))
    ).to.deep.equal([]);
  });

  it("detects raw runtime mechanics in handlers and live accounts in protocol", () => {
    const errors = inspectSources({
      "programs/hash-timestamp/src/instructions/vote.rs":
        "fn vote() { Rent::get(); }",
      "programs/hash-timestamp/src/protocol/bad.rs":
        "fn compute(a: &AccountInfo) {}",
      "programs/hash-timestamp/src/runtime/bad.rs":
        "use crate::instructions::Restore;",
    });
    expect(errors).to.deep.equal([
      "programs/hash-timestamp/src/instructions/vote.rs: move account mechanics into runtime",
      "programs/hash-timestamp/src/protocol/bad.rs: protocol cannot access live accounts",
      "programs/hash-timestamp/src/runtime/bad.rs: runtime must not own instruction contexts or scenarios",
    ]);
  });

  it("detects SDK façade backedges and cycles without rejecting comments", () => {
    expect(
      inspectSources({
        "app/sdk/encoding.ts": 'import { x } from "./hashUtils";',
      }).some((error: string) => error.includes("internal modules"))
    ).to.equal(true);
    expect(
      inspectSources({
        "app/sdk/protocol/a.ts": 'import { x } from "../rent";',
      }).some((error: string) => error.includes("SDK protocol"))
    ).to.equal(true);
    expect(
      inspectSources({
        "app/sdk/protocol/a.ts": 'import { x } from "../hashUtils";',
        "app/sdk/hashUtils.ts": 'export { x } from "./protocol/a";',
      }).some((error: string) => error.includes("cycle"))
    ).to.equal(true);
    expect(
      inspectSources({
        "programs/hash-timestamp/src/protocol/ok.rs":
          "// AccountInfo belongs in runtime\nfn value() {}",
      })
    ).to.deep.equal([]);
  });
});
