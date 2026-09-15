import { describe, expect, it } from "vitest";
import { runJq } from "./support/jq";
import { RENDERED_PIPELINE } from "./support/pipeline";

const collect = (input: unknown): unknown =>
  runJq({ program: "collect-keys.jq", input });

describe("collect-keys.jq", () => {
  // The recursion is the point: a flat `.steps[]` misses every grouped step, and
  // a pipeline whose grouped work is silently never scored looks like a pipeline
  // Trunk simply has no history for.
  it("collects keys at the top level and inside groups", () => {
    expect(collect(RENDERED_PIPELINE)).toEqual([
      "unit",
      "lint",
      "fmt",
      "e2e",
      "smoke",
    ]);
  });

  it("ignores steps with no key, and non-command steps", () => {
    expect(
      collect({
        steps: [{ label: "no key" }, { wait: null }, { block: "go?" }],
      }),
    ).toEqual([]);
  });

  // What the hook branches on to tell the customer to add a `key:` rather than
  // calling the API to be told there is nothing to score.
  it("returns an empty array for a pipeline with no keyed step", () => {
    expect(collect({ steps: [] })).toEqual([]);
  });

  it("recurses through nested groups", () => {
    expect(
      collect({
        steps: [
          {
            group: "outer",
            steps: [{ group: "inner", steps: [{ key: "deep" }] }],
          },
        ],
      }),
    ).toEqual(["deep"]);
  });
});
