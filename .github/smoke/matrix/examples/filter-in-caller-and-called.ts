// The answer key for .github/workflows/matrix-example-filter-in-caller-and-called.yaml.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "shards",
    caller: "checks",
    shape: "runtime include in a called workflow, filters at both levels",
    shows:
      "the caller's filter decides checks and the called workflow's filter decides checks/shards by its own key; the shards keep their own verdict",
    prefix: "Checks / Shard (",
    wiring: "include",
    legs: [
      { values: { shard: 1 }, name: "Checks / Shard (1)" },
      { values: { shard: 2 }, name: "Checks / Shard (2)" },
      { values: { shard: 3 }, name: "Checks / Shard (3)" },
    ],
    prune: [{ shard: 3 }],
  },
];
