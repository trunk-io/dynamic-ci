// The answer key for .github/workflows/matrix-example-filter-in-shared-reusable-workflow.yaml:
// the same called job under each of its two callers.
import type { Fixture } from "../fixtures.ts";

const MUST_RUN =
  "both calls run the same filter step, so the action cannot tell which caller's verdict is this call's check";

export const FIXTURES: Fixture[] = [
  {
    key: "check",
    caller: "unit",
    shape: "one job, in a reusable workflow called twice",
    shows:
      "a filter inside a reusable workflow that two jobs call cannot gate its own job, so the job runs in both calls",
    prefix: "Unit / Check",
    wiring: "none",
    legs: [{ values: {}, name: "Unit / Check" }],
    mustRun: MUST_RUN,
  },
  {
    key: "check",
    caller: "integration",
    shape: "one job, in a reusable workflow called twice",
    shows: "the second call of the same reusable workflow; its job runs too",
    prefix: "Integration / Check",
    wiring: "none",
    legs: [{ values: {}, name: "Integration / Check" }],
    mustRun: MUST_RUN,
  },
];
