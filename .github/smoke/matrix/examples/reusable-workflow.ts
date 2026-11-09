// The answer key for .github/workflows/matrix-example-reusable-workflow.yaml:
// every leg the called workflow's matrix expands to, and the name GitHub gives
// it ("<caller> / <callee>").
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "unit",
    shape: "reusable workflow, matrix from inputs",
    shows:
      "a reusable workflow whose matrix comes from caller inputs set to literals; check runs are named 'caller / callee'",
    prefix: "Unit",
    wiring: "exclude",
    legs: [
      { values: { os: "linux" }, name: "Unit / Test (linux)" },
      { values: { os: "macos" }, name: "Unit / Test (macos)" },
    ],
    prune: [{ os: "macos" }],
  },
];
