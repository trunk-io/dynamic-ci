// The answer key for .github/workflows/matrix-example-shards.yaml: every leg
// the matrix expands to, and the name GitHub gives it.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "test",
    shape: "axes, one of them a shard index",
    shows:
      "a shard declared as an axis; pruning one suite removes it across all its shards",
    prefix: "Test ",
    wiring: "exclude",
    legs: [
      { values: { suite: "unit", shard: 1 }, name: "Test unit (1/2)" },
      { values: { suite: "unit", shard: 2 }, name: "Test unit (2/2)" },
      {
        values: { suite: "integration", shard: 1 },
        name: "Test integration (1/2)",
      },
      {
        values: { suite: "integration", shard: 2 },
        name: "Test integration (2/2)",
      },
    ],
    // Decided on suite alone, so one exclude entry removes every shard.
    identityDims: ["suite"],
    prune: [{ suite: "integration" }],
  },
];
