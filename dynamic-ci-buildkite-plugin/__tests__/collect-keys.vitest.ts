import { describe, expect, it } from "vitest";
import { runJq } from "./support/jq";
import { RENDERED_PIPELINE } from "./support/pipeline";

const collect = (
  input: unknown,
  only: readonly string[] = [],
  exclude: readonly string[] = [],
): unknown =>
  runJq({
    program: "collect-keys.jq",
    input,
    args: [
      "--argjson",
      "only",
      JSON.stringify(only),
      "--argjson",
      "exclude",
      JSON.stringify(exclude),
    ],
  });

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
      "gate-enter",
      "gate-exit",
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

  // Not merely unscored — not even asked about. A trigger step's outcome is in
  // the build it launches, so a verdict here could suppress a build whose result
  // the engine never sees.
  it("excludes a trigger step even though it has a key", () => {
    const keys = collect(RENDERED_PIPELINE);

    expect(keys).not.toContain("downstream");
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

// `only-keys`: the option that makes "trial Dynamic CI on one step" a REAL skip,
// taken before dispatch, rather than step mode's run-and-do-nothing.
describe("collect-keys.jq with only-keys", () => {
  it("narrows to the named keys", () => {
    expect(collect(RENDERED_PIPELINE, ["unit", "smoke"])).toEqual([
      "unit",
      "smoke",
    ]);
  });

  it("reaches a named key nested in a group", () => {
    expect(collect(RENDERED_PIPELINE, ["e2e"])).toEqual(["e2e"]);
  });

  // An empty list is the default and means no restriction — not "consider
  // nothing", which would silently disable the plugin.
  it("considers everything when the list is empty", () => {
    expect(collect(RENDERED_PIPELINE, [])).toEqual(collect(RENDERED_PIPELINE));
  });

  it("returns nothing when no named key is in the pipeline", () => {
    expect(collect(RENDERED_PIPELINE, ["nope"])).toEqual([]);
  });

  // Narrowing cannot promote a step the walk already refuses.
  it("still excludes a trigger step even when it is named", () => {
    expect(collect(RENDERED_PIPELINE, ["downstream"])).toEqual([]);
  });
});

// `exclude-keys`: the "never skip this one" control, and the only per-step
// protection that exists client-side.
describe("collect-keys.jq with exclude-keys", () => {
  it("drops the named keys and keeps the rest", () => {
    expect(collect(RENDERED_PIPELINE, [], ["unit", "e2e"])).toEqual([
      "lint",
      "fmt",
      "smoke",
      "gate-enter",
      "gate-exit",
    ]);
  });

  it("drops a named key nested in a group", () => {
    const kept = collect(RENDERED_PIPELINE, [], ["e2e"]);

    expect(kept).not.toContain("e2e");
    expect(kept).toContain("smoke");
  });

  // Exclusion is applied last, so it wins — the safe direction, since this is
  // how a customer says "never skip this".
  it("wins over only-keys when a key is in both", () => {
    expect(collect(RENDERED_PIPELINE, ["unit", "lint"], ["unit"])).toEqual([
      "lint",
    ]);
  });

  it("considers everything when the list is empty", () => {
    expect(collect(RENDERED_PIPELINE, [], [])).toEqual(
      collect(RENDERED_PIPELINE),
    );
  });
});
