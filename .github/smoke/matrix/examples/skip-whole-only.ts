// The answer key for .github/workflows/matrix-example-skip-whole-only.yaml:
// every leg each matrix job expands to, and the name GitHub gives it. The
// workflow's Plan job writes the build and package-tests rows.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "build",
    shape: "static axes plus runtime include",
    shows:
      "the action would hold only the include rows, not the expanded legs, so this job can only be skipped whole",
    prefix: "Build (",
    wiring: "none",
    rows: [{ os: "linux", extra: "lint" }, { os: "windows" }],
    legs: [
      { values: { os: "linux", extra: "lint" }, name: "Build (linux)" },
      { values: { os: "macos" }, name: "Build (macos)" },
      { values: { os: "windows" }, name: "Build (windows)" },
    ],
  },
  {
    key: "package-tests",
    shape: "runtime include, bin-packed",
    shows:
      "packed package lists in nested arrays; no field is stable across runs, so the job can only be skipped whole",
    prefix: "Package tests (",
    wiring: "none",
    legs: [
      {
        values: {
          group: "pkg-a+pkg-b",
          legs: ["pkg-a", "pkg-b"],
          filters: "a|b",
        },
        name: "Package tests (pkg-a+pkg-b)",
      },
      {
        values: { group: "pkg-c", legs: ["pkg-c"], filters: "c" },
        name: "Package tests (pkg-c)",
      },
    ],
  },
  {
    key: "test",
    shape: "whole job skipped",
    shows:
      "a skipped matrix job reports ONE check under its unexpanded name, which is why a fan-in job must be the required check",
    prefix: "Test (",
    wiring: "exclude",
    legs: [
      { values: { os: "linux" }, name: "Test (linux)" },
      { values: { os: "macos" }, name: "Test (macos)" },
    ],
    prune: "all",
    skippedName: "Test (${{ matrix.os }})",
  },
];
