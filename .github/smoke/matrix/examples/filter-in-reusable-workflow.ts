// The answer key for .github/workflows/matrix-example-filter-in-reusable-workflow.yaml.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "Suite",
    caller: "tests",
    shape: "runtime include, filter inside a reusable workflow",
    shows:
      "the filter runs in the called workflow and keys matrices by the local job; Trunk decides caller/Suite and the action sets Suite-include for the gate there",
    prefix: "Tests / Suite",
    wiring: "include",
    legs: [
      { values: { name: "api" }, name: "Tests / Suite (api)" },
      { values: { name: "web" }, name: "Tests / Suite (web)" },
      { values: { name: "worker" }, name: "Tests / Suite (worker)" },
    ],
    prune: [{ name: "worker" }],
  },
];
