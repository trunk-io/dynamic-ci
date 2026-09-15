import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT, vendoredJqPath } from "./support/jq";
import {
  AGENT_ENV,
  type CapturedRequest,
  withPlanServer,
} from "./support/plan-server";

const execFileAsync = promisify(execFile);

const PIPELINE = {
  steps: [
    { key: "unit", label: "Unit", command: "make test" },
    { key: "e2e", label: "E2E", command: "make e2e" },
  ],
};

const PLAN = {
  jobs: [
    { jobKey: "unit", run: false, summary: "passed 40/40", signals: [] },
    { jobKey: "e2e", run: true, summary: "paths changed", signals: [] },
  ],
};

/**
 * A stand-in for `buildkite-agent`, first on PATH. Pipeline mode is the one mode
 * that both reads from and writes to the agent, so without this there is nothing
 * to observe: the rendered pipeline goes in one end and the uploaded one comes
 * out the other, and the uploaded one is the whole product.
 */
const fakeAgent = (
  rendered: unknown,
): { binDir: string; uploadedPath: string } => {
  const dir = mkdtempSync(join(tmpdir(), "dci-agent-"));
  const renderedPath = join(dir, "rendered.json");
  const uploadedPath = join(dir, "uploaded.json");
  writeFileSync(renderedPath, JSON.stringify(rendered));

  const agent = join(dir, "buildkite-agent");
  writeFileSync(
    agent,
    [
      "#!/usr/bin/env bash",
      "# --dry-run is the render; anything else is the upload.",
      'if [[ "$*" == *--dry-run* ]]; then',
      `  cat ${renderedPath}`,
      "  exit 0",
      "fi",
      `cat > ${uploadedPath}`,
      "",
    ].join("\n"),
  );
  chmodSync(agent, 0o755);

  return { binDir: dir, uploadedPath };
};

const runPipelineMode = async (
  env: Readonly<Record<string, string>>,
  binDir: string,
): Promise<{ stderr: string }> =>
  execFileAsync(join(PLUGIN_ROOT, "hooks/command"), {
    encoding: "utf8",
    env: {
      PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      TRUNK_DCI_JQ: vendoredJqPath(),
      ...AGENT_ENV,
      BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: "pipeline",
      ...env,
    },
  });

describe("pipeline mode", () => {
  // The end-to-end assertion the refactor needed: pipeline mode now runs the
  // filter rather than its own copy of the algorithm, so what matters is that
  // the bytes reaching `pipeline upload` still carry the plan's skips.
  it("uploads a pipeline carrying the plan's skips", async () => {
    const captured: CapturedRequest = {};
    const { binDir, uploadedPath } = fakeAgent(PIPELINE);

    await withPlanServer(PLAN, captured, async (address) => {
      await runPipelineMode({ TRUNK_PUBLIC_API_ADDRESS: address }, binDir);
    });

    expect(JSON.parse(readFileSync(uploadedPath, "utf8"))).toEqual({
      steps: [
        {
          key: "unit",
          label: "Unit",
          command: "make test",
          skip: "Trunk Dynamic CI: passed 40/40",
        },
        { key: "e2e", label: "E2E", command: "make e2e" },
      ],
    });
  });

  // Fail-open all the way through the new seam: the filter emits the rendered
  // pipeline unchanged, and pipeline mode uploads that.
  it("uploads the pipeline unchanged when the plan is unavailable", async () => {
    const { binDir, uploadedPath } = fakeAgent(PIPELINE);

    const { stderr } = await runPipelineMode(
      { TRUNK_PUBLIC_API_ADDRESS: "http://127.0.0.1:1" },
      binDir,
    );

    expect(JSON.parse(readFileSync(uploadedPath, "utf8"))).toEqual(PIPELINE);
    expect(stderr).toContain("unavailable");
  });

  // `token-env` reached request-plan.sh in pipeline mode but NOT in filter mode,
  // so routing pipeline mode through the filter would have silently dropped it.
  it("honours token-env through the filter", async () => {
    const captured: CapturedRequest = {};
    const { binDir, uploadedPath } = fakeAgent(PIPELINE);

    await withPlanServer(PLAN, captured, async (address) => {
      await runPipelineMode(
        {
          TRUNK_PUBLIC_API_ADDRESS: address,
          TRUNK_TOKEN: "",
          MY_TRUNK_TOKEN: "test-token",
          BUILDKITE_PLUGIN_DYNAMIC_CI_TOKEN_ENV: "MY_TRUNK_TOKEN",
        },
        binDir,
      );
    });

    // A plan was fetched and applied, so the token was found where the option
    // said it would be.
    expect(readFileSync(uploadedPath, "utf8")).toContain("Trunk Dynamic CI:");
  });
});
