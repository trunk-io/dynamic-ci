import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A stand-in `buildkite-agent` that answers `pipeline upload --dry-run --format
 * json` with a fixed rendering, and returns a `PATH` with it in front.
 *
 * The filter's YAML branch is the one path that calls the real agent, and it is
 * where the interpolation contract lives — so it needs a test, and a test cannot
 * assume a Buildkite agent is installed on the machine running it. What the
 * agent would have parsed does not matter here: the filter only reads the JSON
 * that comes back.
 */
export const fakeAgentPath = (rendered: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), "dci-agent-"));
  writeFileSync(
    join(dir, "buildkite-agent"),
    `#!/usr/bin/env bash\ncat <<'JSON'\n${JSON.stringify(rendered)}\nJSON\n`,
    { mode: 0o755 },
  );
  return `${dir}:${process.env["PATH"] ?? ""}`;
};
