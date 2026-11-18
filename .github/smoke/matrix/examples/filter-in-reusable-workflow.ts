// The answer key for .github/workflows/matrix-example-filter-in-reusable-workflow.yaml.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "groups",
    caller: "tests",
    shape: "runtime include, filter inside a reusable workflow",
    shows:
      "the filter runs in the called workflow and keys matrices by the local job; Trunk decides caller/groups and the action sets groups-include for the gate there",
    prefix: "Tests / Group (",
    wiring: "include",
    legs: [
      { values: { name: "api" }, name: "Tests / Group (api)" },
      { values: { name: "web" }, name: "Tests / Group (web)" },
      { values: { name: "worker" }, name: "Tests / Group (worker)" },
    ],
    prune: [{ name: "worker" }],
  },
  {
    key: "areas",
    caller: "tests",
    shape: "runtime include, name only an expression, in a called workflow",
    shows:
      "a called job named only by an expression reports each variation as '<caller> / <value>', the same shape as its sibling jobs' names",
    prefix: "Tests / area-",
    wiring: "include",
    legs: [
      { values: { area: "area-docs" }, name: "Tests / area-docs" },
      { values: { area: "area-search" }, name: "Tests / area-search" },
      { values: { area: "area-billing" }, name: "Tests / area-billing" },
    ],
    prune: [{ area: "area-billing" }],
  },
  {
    key: "lint",
    caller: "tests",
    shape: "runtime include, every row skipped, in a called workflow",
    shows:
      "a called matrix job with every variation skipped is skipped whole and reports one check under its unexpanded name, prefixed by the caller",
    prefix: "Tests / Lint (",
    wiring: "include",
    legs: [
      { values: { target: "core" }, name: "Tests / Lint (core)" },
      { values: { target: "cli" }, name: "Tests / Lint (cli)" },
    ],
    prune: "all",
    skippedName: "Tests / Lint (${{ matrix.target }})",
  },
];
