// The answer key for .github/workflows/matrix-example-axes-with-include.yaml:
// every leg each matrix job expands to, and the name GitHub gives it.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "test",
    shape: "axes plus static include, exclude on axes only",
    shows:
      "include extends one axis leg and adds another; excluded by the axis keys only, the leg include extends comes back",
    prefix: "Test (",
    wiring: "exclude",
    legs: [
      { values: { os: "linux", node: 18 }, name: "Test (linux, 18)" },
      {
        values: { os: "linux", node: 20, experimental: true },
        name: "Test (linux, 20)",
      },
      { values: { os: "macos", node: 18 }, name: "Test (macos, 18)" },
      { values: { os: "macos", node: 20 }, name: "Test (macos, 20)" },
      { values: { os: "windows", node: 22 }, name: "Test (windows, 22)" },
    ],
    identityDims: ["os", "node"],
    prune: [{ node: 20 }],
    expect: {
      ran: [
        "Test (linux, 18)",
        "Test (linux, 20)",
        "Test (macos, 18)",
        "Test (windows, 22)",
      ],
      note: "observed: an include entry whose combination was excluded is added back as a new leg",
    },
  },
  {
    key: "build",
    shape: "axes, no name:",
    shows:
      "no name:, so GitHub appends the axis values itself; a key added by include is left out of the name",
    prefix: "build (",
    wiring: "exclude",
    legs: [
      {
        values: {
          os: "linux",
          arch: "amd64",
          tier: { name: "gold", level: 1 },
        },
        // Observed: the include-only `tier` key isn't in the default name.
        name: "build (linux, amd64)",
      },
      { values: { os: "linux", arch: "arm64" }, name: "build (linux, arm64)" },
      { values: { os: "macos", arch: "amd64" }, name: "build (macos, amd64)" },
      { values: { os: "macos", arch: "arm64" }, name: "build (macos, arm64)" },
    ],
    prune: [{ os: "macos", arch: "arm64" }],
  },
];
