// The answer key for .github/workflows/matrix-example-planner-include.yaml:
// every leg the planned matrix expands to, and the name GitHub gives it. The
// workflow's Plan job writes exactly these values as its rows.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "test",
    shape: "runtime include, stable fields × shards",
    shows:
      "stable suite/compat fields × per-run shard fields; the name uses && || defaults, a boolean and numbers",
    prefix: "Test ",
    wiring: "matrix",
    legs: [
      {
        values: {
          suite: "api",
          compat: false,
          group: 1,
          concurrency: 2,
          artifact_key: "api-1",
        },
        name: "Test api (1/2)",
      },
      {
        values: {
          suite: "api",
          compat: false,
          group: 2,
          concurrency: 2,
          artifact_key: "api-2",
        },
        name: "Test api (2/2)",
      },
      {
        values: {
          suite: "api",
          compat: true,
          group: 1,
          concurrency: 1,
          artifact_key: "api-compat-1",
        },
        name: "Test api compat (1/1)",
      },
      {
        values: {
          suite: "worker",
          compat: false,
          group: 1,
          concurrency: 2,
          artifact_key: "worker-1",
        },
        name: "Test worker (1/2)",
      },
      {
        values: {
          suite: "worker",
          compat: false,
          group: 2,
          concurrency: 2,
          artifact_key: "worker-2",
        },
        name: "Test worker (2/2)",
      },
    ],
    // Decided on suite and compat: every worker shard goes together.
    prune: [{ suite: "worker", compat: false }],
  },
];
