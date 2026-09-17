import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

export const PLUGIN_ROOT: string = resolve(import.meta.dirname, "../..");

/** The vendored binary for this platform, from `vendor/` — as `lib/jq.sh` resolves it. */
const VENDORED_JQ: Record<string, string> = {
  "linux-x64": "jq-linux-amd64",
  "linux-arm64": "jq-linux-arm64",
  "darwin-arm64": "jq-macos-arm64",
};

export const vendoredJqPath = (): string => {
  const platform = `${process.platform}-${process.arch}`;
  const name = VENDORED_JQ[platform];
  if (name === undefined) {
    throw new Error(`no vendored jq for ${platform}`);
  }
  return join(PLUGIN_ROOT, "vendor", name);
};

interface RunJqArgs {
  /** A file under `lib/`, e.g. `apply-skips.jq`. */
  program: string;
  input: unknown;
  args?: readonly string[];
}

/**
 * Run one of the plugin's jq programs with the vendored jq — the same binary the
 * hook runs, so a test cannot pass against a system jq of a different version.
 */
export const runJq = ({ program, input, args = [] }: RunJqArgs): unknown => {
  const stdout = execFileSync(
    vendoredJqPath(),
    ["-c", ...args, "-f", join(PLUGIN_ROOT, "lib", program)],
    { input: JSON.stringify(input), encoding: "utf8" },
  );
  return JSON.parse(stdout);
};
