// The answer key for .github/workflows/matrix-example-include-list.yaml: every
// leg each matrix job expands to, and the name GitHub gives it. The legs'
// values are the rows the workflow writes as each job's fallback.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "test",
    shape: "include-only, literal fallback",
    shows:
      "include rows can't be excluded from, so the rows live in a fromJSON(output || '<literal>') fallback",
    prefix: "Tests (",
    wiring: "matrix",
    legs: [
      {
        values: { lane: "parallel", shard: 1, shard_count: 1 },
        name: "Tests (parallel 1/1)",
      },
      {
        values: { lane: "serial", shard: 1, shard_count: 3 },
        name: "Tests (serial 1/3)",
      },
      {
        values: { lane: "serial", shard: 2, shard_count: 3 },
        name: "Tests (serial 2/3)",
      },
      {
        values: { lane: "serial", shard: 3, shard_count: 3 },
        name: "Tests (serial 3/3)",
      },
    ],
    prune: [{ lane: "serial" }],
  },
  {
    key: "integration",
    shape: "every leg pruned",
    shows:
      "with every leg pruned, <job>-matrix is {include: []} and <job> is false; the if: must skip the job before GitHub evaluates the empty matrix",
    prefix: "Integration (",
    wiring: "matrix",
    legs: [
      { values: { lane: "parallel" }, name: "Integration (parallel)" },
      { values: { lane: "serial" }, name: "Integration (serial)" },
    ],
    prune: "all",
    skippedName: "Integration (${{ matrix.lane }})",
  },
];
