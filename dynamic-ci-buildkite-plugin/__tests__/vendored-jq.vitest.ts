import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT, vendoredJqPath } from "./support/jq";

interface ResolveResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Drive `dci_resolve_jq` the way `hooks/command` does — sourced into bash — so
 * the test exercises the real function rather than a reimplementation of it.
 */
const resolve = (binDir: string): ResolveResult => {
  const script = `source "${join(PLUGIN_ROOT, "lib/jq.sh")}"; dci_resolve_jq "${binDir}"`;
  try {
    const stdout = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    // `execFileSync` throws on a non-zero exit; the fields are what we assert on.
    const failure: unknown = error;
    if (
      typeof failure !== "object" ||
      failure === null ||
      !("status" in failure) ||
      !("stderr" in failure)
    ) {
      throw error;
    }
    return {
      status: Number(failure.status),
      stdout: "",
      stderr: String(failure.stderr),
    };
  }
};

/** A bin directory holding this platform's jq plus its recorded checksum. */
const stagedBinDir = (): { dir: string; name: string } => {
  const source = vendoredJqPath();
  const name = basename(source);
  const dir = mkdtempSync(join(tmpdir(), "dci-jq-"));
  copyFileSync(source, join(dir, name));
  const sums = readFileSync(join(PLUGIN_ROOT, "vendor/SHA256SUMS"), "utf8");
  writeFileSync(join(dir, "SHA256SUMS"), sums);
  return { dir, name };
};

describe("dci_resolve_jq", () => {
  it("resolves and runs the vendored jq for this platform", () => {
    const { dir } = stagedBinDir();

    const result = resolve(dir);

    expect(result.status).toBe(0);
    const version = execFileSync(result.stdout.trim(), ["--version"], {
      encoding: "utf8",
    });
    expect(version.trim()).toBe("jq-1.8.1");
  });

  // The reason the checksums are committed at all. A vendored binary is a file
  // in a git repository that the plugin then executes on a customer's agent, so
  // the check is not ceremony — it is the only thing between a tampered commit
  // and arbitrary execution.
  it("refuses a binary whose checksum does not match", () => {
    const { dir, name } = stagedBinDir();
    // Appending a byte rather than flipping one: same effect on the hash, and it
    // needs no index access to narrow.
    const tampered = Buffer.concat([
      readFileSync(join(dir, name)),
      Buffer.from([0]),
    ]);
    writeFileSync(join(dir, name), tampered);

    const result = resolve(dir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("checksum mismatch");
    expect(result.stdout).toBe("");
  });

  // An unrecorded binary is refused rather than run unverified: "no sum" and
  // "wrong sum" are the same answer here, because neither says the file is what
  // upstream published.
  it("refuses a binary with no recorded checksum", () => {
    const { dir } = stagedBinDir();
    writeFileSync(join(dir, "SHA256SUMS"), "");

    const result = resolve(dir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no recorded checksum");
  });

  it("names the platform it cannot serve", () => {
    const { dir, name } = stagedBinDir();
    execFileSync("rm", [join(dir, name)]);

    const result = resolve(dir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("vendored jq missing");
  });
});
