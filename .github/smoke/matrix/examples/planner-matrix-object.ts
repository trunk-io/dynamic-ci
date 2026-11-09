// The answer key for .github/workflows/matrix-example-planner-matrix-object.yaml:
// every leg the planned matrix expands to, and the name GitHub gives it. The
// workflow's Plan job writes exactly these values as the matrix's include rows.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "build",
    shape: "runtime matrix object",
    shows:
      "a planner that emits the whole strategy.matrix object rather than an include array",
    prefix: "Build ",
    wiring: "matrix",
    legs: [
      { values: { image: "gateway" }, name: "Build gateway" },
      { values: { image: "scheduler" }, name: "Build scheduler" },
      { values: { image: "indexer" }, name: "Build indexer" },
      { values: { image: "notifier" }, name: "Build notifier" },
    ],
    prune: [{ image: "scheduler" }],
  },
];
