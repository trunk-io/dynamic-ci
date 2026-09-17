import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA } from "../../src/schema/request";
import { PLUGIN_ROOT, vendoredJqPath } from "./support/jq";
import {
  AGENT_ENV,
  type CapturedRequest,
  withPlanServer,
} from "./support/plan-server";

const execFileAsync = promisify(execFile);

interface HookResult {
  status: number;
  /** True when the step's own command actually ran. */
  ranCommand: boolean;
  stderr: string;
}

/**
 * Runs the command hook with a command whose only effect is a file, so "did the
 * step do its work" is a filesystem fact rather than a guess about log output.
 */
const runHook = async (
  env: Readonly<Record<string, string>>,
): Promise<HookResult> => {
  const marker = join(mkdtempSync(join(tmpdir(), "dci-step-")), "ran");
  const options = {
    encoding: "utf8" as const,
    env: {
      PATH: process.env["PATH"] ?? "",
      TRUNK_DCI_JQ: vendoredJqPath(),
      ...AGENT_ENV,
      BUILDKITE_COMMAND: `touch ${marker}`,
      ...env,
    },
  };

  try {
    const { stderr } = await execFileAsync(
      join(PLUGIN_ROOT, "hooks/command"),
      options,
    );
    return { status: 0, ranCommand: existsSync(marker), stderr };
  } catch (error) {
    const failure: unknown = error;
    if (
      typeof failure !== "object" ||
      failure === null ||
      !("code" in failure) ||
      !("stderr" in failure)
    ) {
      throw error;
    }
    return {
      status: Number(failure.code),
      ranCommand: existsSync(marker),
      stderr: String(failure.stderr),
    };
  }
};

const STEP_ENV = {
  BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: "step",
  BUILDKITE_STEP_KEY: "unit",
} as const;

const planFor = (run: boolean) => ({
  jobs: [{ jobKey: "unit", run, summary: "passed 40/40", signals: [] }],
});

describe("step mode", () => {
  it("does not run the step's work when the plan says skip", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(planFor(false), captured, async (address) => {
      const result = await runHook({
        ...STEP_ENV,
        TRUNK_PUBLIC_API_ADDRESS: address,
      });

      expect(result.status).toBe(0);
      expect(result.ranCommand).toBe(false);
      // The customer needs to know this was a decision, not a silent no-op —
      // and that Buildkite will report the step as passed regardless.
      expect(result.stderr).toContain("passed 40/40");
      expect(result.stderr).toContain("reports success");
    });

    // Scoped to this step alone, which is what separates step mode from the
    // whole-pipeline modes.
    const request = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      captured.received,
    );
    expect(request.jobKeys).toEqual(["unit"]);
  });

  it("prints the plan's notice when it carries one", async () => {
    const captured: CapturedRequest = {};
    const plan = {
      jobs: [],
      notice: {
        code: "ORG_NOT_ENABLED",
        message:
          "Every job will run: Dynamic CI is not enabled for this organization.",
      },
    };

    await withPlanServer(plan, captured, async (address) => {
      const result = await runHook({
        ...STEP_ENV,
        TRUNK_PUBLIC_API_ADDRESS: address,
      });

      expect(result.stderr).toContain("not enabled for this organization");
      // An empty plan means no verdict for this step, so it runs.
      expect(result.ranCommand).toBe(true);
    });
  });

  it("runs the step's work when the plan says run", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(planFor(true), captured, async (address) => {
      const result = await runHook({
        ...STEP_ENV,
        TRUNK_PUBLIC_API_ADDRESS: address,
      });

      expect(result.status).toBe(0);
      expect(result.ranCommand).toBe(true);
    });
  });

  it("prints the plan to the log under the debug option", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(planFor(false), captured, async (address) => {
      const result = await runHook({
        ...STEP_ENV,
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_DEBUG: "true",
      });

      expect(result.stderr).toContain("debug · plan");
      expect(result.stderr).toContain("debug · requested step keys");
      expect(result.stderr).toContain("passed 40/40");
    });
  });

  // One rule across all three modes: only-keys narrows what the plugin
  // considers. Here that means a step off the list is not decided about — so a
  // shared plugin block can sit on many steps with the list controlling which
  // are live.
  it("runs a step that is not in only-keys without asking", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(planFor(false), captured, async (address) => {
      const result = await runHook({
        ...STEP_ENV,
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_ONLY_KEYS: "something-else",
      });

      expect(result.ranCommand).toBe(true);
      expect(result.stderr).toContain("not in only-keys");
    });

    expect(captured.received).toBeUndefined();
  });

  it("still decides about a step that is in only-keys", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(planFor(false), captured, async (address) => {
      const result = await runHook({
        ...STEP_ENV,
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_ONLY_KEYS: "other, unit",
      });

      expect(result.ranCommand).toBe(false);
    });
  });

  it("runs a step in exclude-keys without asking", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(planFor(false), captured, async (address) => {
      const result = await runHook({
        ...STEP_ENV,
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_EXCLUDE_KEYS: "unit",
      });

      expect(result.ranCommand).toBe(true);
      expect(result.stderr).toContain("is in exclude-keys");
    });

    expect(captured.received).toBeUndefined();
  });

  // Fail-open: an outage must never be the reason a test did not run.
  it("runs the step's work when the plan is unavailable", async () => {
    const result = await runHook({
      ...STEP_ENV,
      TRUNK_PUBLIC_API_ADDRESS: "http://127.0.0.1:1",
    });

    expect(result.status).toBe(0);
    expect(result.ranCommand).toBe(true);
    expect(result.stderr).toContain("unavailable");
  });

  // The one place step mode is louder than pipeline mode. There, an unkeyed
  // step is one of many and runs; here the key IS the request, so running the
  // step while the customer believes Trunk is deciding about it is the failure.
  it("fails loudly on a step with no key rather than running it", async () => {
    const result = await runHook({
      BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: "step",
      BUILDKITE_STEP_KEY: "",
    });

    expect(result.status).not.toBe(0);
    expect(result.ranCommand).toBe(false);
    expect(result.stderr).toContain("needs a key:");
  });
});

describe("an unsupported mode", () => {
  // A configuration error, and the one case that does not fail open. Degrading
  // to "run the command, say nothing" is how a plugin gets installed, believed,
  // and never skips anything — which is exactly what `mode: step` did before it
  // was implemented.
  it("fails loudly rather than silently doing nothing", async () => {
    const result = await runHook({
      BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: "fliter",
    });

    expect(result.status).not.toBe(0);
    expect(result.ranCommand).toBe(false);
    expect(result.stderr).toContain("does not support mode");
    expect(result.stderr).toContain("pipeline, filter, step");
  });
});
