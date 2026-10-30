// The answer key for .github/workflows/matrix-example-static-axes.yaml: every
// leg each matrix job expands to, and the name GitHub gives it.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "test",
    shape: "axes, all in name:",
    shows:
      "the baseline: static axes, every axis in name:, one combination excluded by its typed values",
    prefix: "Test (",
    wiring: "exclude",
    legs: [
      { values: { os: "linux", node: 18 }, name: "Test (linux, node 18)" },
      { values: { os: "linux", node: 20 }, name: "Test (linux, node 20)" },
      { values: { os: "macos", node: 18 }, name: "Test (macos, node 18)" },
      { values: { os: "macos", node: 20 }, name: "Test (macos, node 20)" },
    ],
    prune: [{ os: "macos", node: 20 }],
  },
  {
    key: "build",
    shape: "axes, some in name:",
    shows:
      "name: shows os but not node, so two legs share each name; a partial exclude ({os}) removes both",
    prefix: "Build (",
    wiring: "exclude",
    identityDims: ["os"],
    legs: [
      { values: { os: "linux", node: 18 }, name: "Build (linux)" },
      { values: { os: "linux", node: 20 }, name: "Build (linux)" },
      { values: { os: "macos", node: 18 }, name: "Build (macos)" },
      { values: { os: "macos", node: 20 }, name: "Build (macos)" },
    ],
    prune: [{ os: "macos" }],
  },
];
