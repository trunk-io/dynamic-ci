// The answer key for .github/workflows/matrix-example-platform-objects.yaml:
// every leg the matrix expands to, and the name GitHub gives it.
import type { Fixture } from "../fixtures.ts";

export const FIXTURES: Fixture[] = [
  {
    key: "test",
    shape: "axis of objects",
    shows:
      "an axis whose values are objects (the README's platform.target example), excluded by the whole object",
    prefix: "Test for ",
    wiring: "exclude",
    legs: [
      {
        values: {
          platform: { target: "x86_64-unknown-linux-gnu", os: "ubuntu-latest" },
        },
        name: "Test for x86_64-unknown-linux-gnu",
      },
      {
        values: {
          platform: { target: "aarch64-apple-darwin", os: "macos-14" },
        },
        name: "Test for aarch64-apple-darwin",
      },
    ],
    prune: [{ platform: { target: "aarch64-apple-darwin", os: "macos-14" } }],
  },
];
