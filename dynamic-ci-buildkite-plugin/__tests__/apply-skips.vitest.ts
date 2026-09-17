import { describe, expect, it } from "vitest";
import { runJq } from "./support/jq";
import { RENDERED_PIPELINE } from "./support/pipeline";
import { groupChildren, stepByKey } from "./support/schema";

const applySkips = (
  skips: Record<string, string>,
  input: unknown = RENDERED_PIPELINE,
) =>
  runJq({
    program: "apply-skips.jq",
    input,
    args: ["--argjson", "skips", JSON.stringify(skips)],
  });

const SKIP_UNIT_AND_E2E = {
  unit: "Trunk Dynamic CI: passed 40/40, no correlated paths",
  e2e: "Trunk Dynamic CI: unchanged area",
} as const;

describe("apply-skips.jq", () => {
  // The whole document, so a change that adds, drops or reorders anything shows
  // up here rather than in a property test that only looked at `skip`.
  it("adds skip to the planned steps and nothing else", () => {
    expect(applySkips(SKIP_UNIT_AND_E2E)).toEqual({
      steps: [
        {
          key: "unit",
          label: "Unit",
          command: "make test",
          skip: SKIP_UNIT_AND_E2E.unit,
        },
        {
          key: "lint",
          label: "Lint",
          command: "make lint",
          skip: "customer said so",
        },
        { key: "fmt", label: "Fmt", command: "make fmt", skip: false },
        { label: "unkeyed", command: "echo hi" },
        {
          group: "Tests",
          steps: [
            {
              key: "e2e",
              label: "E2E",
              command: "make e2e",
              depends_on: "unit",
              skip: SKIP_UNIT_AND_E2E.e2e,
            },
            { key: "smoke", label: "Smoke", command: "make smoke" },
          ],
        },
        { wait: null },
        { key: "downstream", label: "Trigger core", trigger: "core" },
        {
          key: "gate-enter",
          label: "Enter gate",
          command: "true",
          concurrency_group: "duration-updater-gate",
        },
        {
          key: "gate-exit",
          label: "Exit gate",
          command: "true",
          concurrency_group: "duration-updater-gate",
        },
      ],
    });
  });

  // The guard lives in the jq as well as the key walk, so a replayed or
  // hand-assembled plan naming a trigger step cannot route around it.
  it("never skips a trigger step, even when the plan names it", () => {
    const out = applySkips({ downstream: "Trunk Dynamic CI: would skip" });

    expect(out).toEqual(RENDERED_PIPELINE);
  });

  // A customer's `skip` is their decision about their own pipeline. `skip: false`
  // is the sharp case: it is how they force a step to run, and it is falsy, so a
  // truthiness test here would silently override exactly the instruction that
  // says "do not skip this".
  it("never overrides a skip the customer wrote, including skip: false", () => {
    const out = applySkips({
      lint: "Trunk Dynamic CI: would skip",
      fmt: "Trunk Dynamic CI: would skip",
    });

    expect(out).toEqual(RENDERED_PIPELINE);
  });

  // The fail-safe an unkeyed step already has: no key, no verdict, so it runs.
  it("leaves a step with no key alone even under a plan that names everything", () => {
    const out = applySkips({ unkeyed: "Trunk Dynamic CI: would skip" });

    expect(out).toEqual(RENDERED_PIPELINE);
  });

  // `smoke` is the group sibling of a step the plan DID name, which is the case
  // a recursion bug is most likely to catch by accident.
  it("leaves a step the plan did not name alone", () => {
    const out = applySkips({ e2e: "Trunk Dynamic CI: skipping" });

    expect(groupChildren(out)).toEqual([
      {
        key: "e2e",
        label: "E2E",
        command: "make e2e",
        depends_on: "unit",
        skip: "Trunk Dynamic CI: skipping",
      },
      { key: "smoke", label: "Smoke", command: "make smoke" },
    ]);
  });

  // jq preserves insertion order, so an untouched step keeps its key order too.
  // Structural equality would not catch a rewrite that reordered fields, and a
  // reordered step is a diff a customer has to read and explain.
  it("preserves field order on an untouched step", () => {
    const out = applySkips(SKIP_UNIT_AND_E2E);

    expect(Object.keys(stepByKey(out, "lint"))).toEqual([
      "key",
      "label",
      "command",
      "skip",
    ]);
  });

  it("recurses into nested groups", () => {
    const out = applySkips(
      { deep: "Trunk Dynamic CI: skipping" },
      {
        steps: [
          {
            group: "outer",
            steps: [{ group: "inner", steps: [{ key: "deep" }] }],
          },
        ],
      },
    );

    expect(out).toEqual({
      steps: [
        {
          group: "outer",
          steps: [
            {
              group: "inner",
              steps: [{ key: "deep", skip: "Trunk Dynamic CI: skipping" }],
            },
          ],
        },
      ],
    });
  });

  it("is a no-op when the plan skips nothing", () => {
    expect(applySkips({})).toEqual(RENDERED_PIPELINE);
  });
});
