import { describe, expect, it } from "vitest";
import { runJq } from "./support/jq";

const toSkips = (
  jobs: readonly { jobKey: string; run: boolean; summary: string }[],
) => runJq({ program: "plan-to-skips.jq", input: { jobs } });

describe("plan-to-skips.jq", () => {
  it("keeps only the verdicts that say skip", () => {
    expect(
      toSkips([
        { jobKey: "unit", run: false, summary: "passed 40/40" },
        { jobKey: "e2e", run: true, summary: "correlated paths changed" },
      ]),
    ).toEqual({ unit: "Trunk Dynamic CI: passed 40/40" });
  });

  // Buildkite rejects a `skip` string over 70 characters, so an unusually long
  // summary would fail the upload — with the plugin, not the customer, at fault.
  it("truncates the reason to Buildkite's 70-character limit", () => {
    const skips = toSkips([
      { jobKey: "unit", run: false, summary: "x".repeat(200) },
    ]);

    expect(skips).toEqual({
      unit: `Trunk Dynamic CI: ${"x".repeat(70 - "Trunk Dynamic CI: ".length)}`,
    });
    expect(Object.values(z(skips)).every((v) => v.length <= 70)).toBe(true);
  });

  it("is an empty object when the plan skips nothing", () => {
    expect(toSkips([{ jobKey: "unit", run: true, summary: "run it" }])).toEqual(
      {},
    );
  });

  it("is an empty object for a plan with no verdicts at all", () => {
    expect(toSkips([])).toEqual({});
  });
});

/** jq returns `unknown`; the length assertion needs strings. */
const z = (out: unknown): Record<string, string> => {
  if (typeof out !== "object" || out === null) {
    throw new Error("jq did not return an object");
  }
  return Object.fromEntries(
    Object.entries(out).map(([key, value]) => [key, String(value)]),
  );
};
