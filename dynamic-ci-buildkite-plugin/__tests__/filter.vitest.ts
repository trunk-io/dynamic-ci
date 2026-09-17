import { execFile, execFileSync } from "node:child_process";
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

/**
 * Runs the filter with stdin piped in. **Asynchronous on purpose**: the plan
 * server below lives on this process's event loop, so a synchronous child would
 * block the loop it needs to answer on — the filter would then wait out curl's
 * whole retry budget and the test would hang rather than fail.
 */
const runFilter = async (
  input: string,
  env: Readonly<Record<string, string>> = {},
): Promise<{ stdout: string; stderr: string }> => {
  const child = execFileAsync(
    join(PLUGIN_ROOT, "bin/trunk-dynamic-ci-filter"),
    {
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        TRUNK_DCI_JQ: vendoredJqPath(),
        ...AGENT_ENV,
        ...env,
      },
    },
  );
  child.child.stdin?.end(input);
  return child;
};

const PIPELINE = {
  steps: [
    { key: "unit", label: "Unit", command: "make test" },
    { key: "e2e", label: "E2E", command: "make e2e" },
    { key: "downstream", label: "Trigger", trigger: "core" },
  ],
};

const PLAN = {
  jobs: [
    { jobKey: "unit", run: false, summary: "passed 40/40", signals: [] },
    { jobKey: "e2e", run: true, summary: "paths changed", signals: [] },
    { jobKey: "downstream", run: false, summary: "would skip", signals: [] },
  ],
};

describe("filter mode", () => {
  it("marks the planned steps and writes the pipeline to stdout", async () => {
    const captured: { received?: unknown } = {};

    await withPlanServer(PLAN, captured, async (address) => {
      const { stdout } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
      });

      expect(JSON.parse(stdout)).toEqual({
        steps: [
          {
            key: "unit",
            label: "Unit",
            command: "make test",
            skip: "Trunk Dynamic CI: passed 40/40",
          },
          { key: "e2e", label: "E2E", command: "make e2e" },
          // Planned as a skip and refused anyway: a trigger step's outcome is
          // in the build it launches.
          { key: "downstream", label: "Trigger", trigger: "core" },
        ],
      });
    });

    // The request the filter actually made, against the engine's own schema.
    expect(() =>
      BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(captured.received),
    ).not.toThrow();
  });

  // A trigger step is never even asked about, so the plan above naming it is
  // something only a replay could produce.
  it("does not ask for a verdict on a trigger step", async () => {
    const captured: { received?: unknown } = {};

    await withPlanServer(PLAN, captured, async (address) => {
      await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
      });
    });

    const request = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      captured.received,
    );
    expect(request.jobKeys).toEqual(["unit", "e2e"]);
  });

  // A plan that skips nothing looks the same whatever the reason — an
  // organization not enabled, a repo in shadow, a pipeline Trunk has not
  // ingested. `notice` is the only thing that tells a customer which, and
  // without it the first build reads as "the plugin did nothing".
  it("prints the plan's notice when it carries one", async () => {
    const captured: CapturedRequest = {};
    const plan = {
      jobs: [],
      notice: {
        code: "REPO_NOT_ENABLED",
        message:
          "Every job will run: Dynamic CI is turned off for this repository.",
      },
    };

    await withPlanServer(plan, captured, async (address) => {
      const { stderr } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
      });

      expect(stderr).toContain("turned off for this repository");
    });
  });

  // stdout is the data channel. If any message reached it, the customer's
  // `pipeline upload` would receive a corrupt pipeline.
  it("puts nothing but the pipeline on stdout", async () => {
    const captured: { received?: unknown } = {};

    await withPlanServer(PLAN, captured, async (address) => {
      const { stdout } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
      });

      expect(() => {
        // Braced so nothing is returned: `JSON.parse` yields `any`, and
        // returning it from the arrow is an unsafe return.
        JSON.parse(stdout);
      }).not.toThrow();
    });
  });

  // The reason the input is buffered to a file rather than a shell variable:
  // command substitution strips trailing newlines, and "replays your exact
  // bytes" then quietly stops being true.
  it("replays the input byte for byte when the plan call fails", async () => {
    const yaml = "# a comment\nsteps:\n  - key: unit\n    command: make test\n";

    const { stdout } = await runFilter(yaml, {
      TRUNK_PUBLIC_API_ADDRESS: "http://127.0.0.1:1",
    });

    expect(stdout).toBe(yaml);
  });

  it("replays the input when there is no token to call with", async () => {
    const json = JSON.stringify(PIPELINE);

    const { stdout } = await runFilter(json, { TRUNK_TOKEN: "" });

    expect(stdout).toBe(json);
  });

  it("replays the input when no step has a key", async () => {
    const json = JSON.stringify({ steps: [{ command: "make test" }] });

    const { stdout } = await runFilter(json);

    expect(stdout).toBe(json);
  });
});

describe("the debug option", () => {
  it("prints nothing extra when it is off", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(PLAN, captured, async (address) => {
      const { stderr } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
      });

      expect(stderr).not.toContain("debug ·");
    });
  });

  it("prints the requested keys, the request body and the plan", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(PLAN, captured, async (address) => {
      const { stderr } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_DEBUG: "true",
      });

      expect(stderr).toContain("debug · requested step keys");
      expect(stderr).toContain("debug · request body");
      expect(stderr).toContain("debug · plan");
      // The values, not just the headings.
      expect(stderr).toContain('"unit"');
      expect(stderr).toContain("passed 40/40");
      expect(stderr).toContain("trunk2-pr");
    });
  });

  // The whole reason debug output is funnelled through one function. In filter
  // mode stdout carries the pipeline being uploaded, so a debugging aid that
  // wrote there would corrupt the build it was meant to help diagnose.
  it("keeps stdout carrying nothing but the pipeline", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(PLAN, captured, async (address) => {
      const { stdout } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_DEBUG: "true",
      });

      expect(JSON.parse(stdout)).toEqual({
        steps: [
          {
            key: "unit",
            label: "Unit",
            command: "make test",
            skip: "Trunk Dynamic CI: passed 40/40",
          },
          { key: "e2e", label: "E2E", command: "make e2e" },
          { key: "downstream", label: "Trigger", trigger: "core" },
        ],
      });
    });
  });

  // A YAML boolean reaches the hook as the string "true"; nothing else enables it.
  it("stays off for any value that is not the string true", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(PLAN, captured, async (address) => {
      const { stderr } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_DEBUG: "1",
      });

      expect(stderr).not.toContain("debug ·");
    });
  });
});

// The interface itself: `hooks/environment` puts the plugin's commands on PATH
// so the customer's pipe can name one. A command rather than a path in a
// variable specifically because Buildkite interpolates `${VAR}` in an uploaded
// pipeline at UPLOAD time, while anything this plugin exports exists only at
// step runtime — so `| "${TRUNK_DYNAMIC_CI_FILTER}" |` collapses to `|  |`, a
// shell syntax error on the customer's first build.
describe("the environment hook", () => {
  const inHook = async (
    mode: string,
    script: string,
  ): Promise<{ stdout: string; status: number }> => {
    const full = `source "${join(PLUGIN_ROOT, "hooks/environment")}"; ${script}`;
    try {
      const { stdout } = await execFileAsync("bash", ["-c", full], {
        encoding: "utf8",
        env: {
          PATH: process.env["PATH"] ?? "",
          BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: mode,
        },
      });
      return { stdout, status: 0 };
    } catch (error) {
      const failure: unknown = error;
      if (
        typeof failure !== "object" ||
        failure === null ||
        !("code" in failure)
      ) {
        throw error;
      }
      return { stdout: "", status: Number(failure.code) };
    }
  };

  it("puts trunk-dynamic-ci-filter on PATH in filter mode", async () => {
    const { stdout, status } = await inHook(
      "filter",
      "command -v trunk-dynamic-ci-filter",
    );

    expect(status).toBe(0);
    expect(stdout.trim()).toBe(
      join(PLUGIN_ROOT, "bin/trunk-dynamic-ci-filter"),
    );
  });

  // Named, not path-interpolated: this is the whole point of the mechanism.
  it("filters a pipeline when invoked by name", async () => {
    const { stdout, status } = await inHook(
      "filter",
      `printf '%s' '${JSON.stringify(PIPELINE)}' | trunk-dynamic-ci-filter`,
    );

    expect(status).toBe(0);
    // No token configured, so it fails open — replaying the input exactly.
    expect(JSON.parse(stdout)).toEqual(PIPELINE);
  });

  // An unexpected PATH change is worse than a missing one, so the mode has to
  // ask for it.
  it("does not touch PATH in the other modes", async () => {
    const { status } = await inHook(
      "pipeline",
      "command -v trunk-dynamic-ci-filter",
    );

    expect(status).not.toBe(0);
  });
});

describe("the command hand-back", () => {
  const runHook = (
    env: Readonly<Record<string, string>>,
  ): { stdout: string; status: number } => {
    try {
      const stdout = execFileSync(join(PLUGIN_ROOT, "hooks/command"), {
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "", ...AGENT_ENV, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { stdout, status: 0 };
    } catch (error) {
      const failure: unknown = error;
      if (
        typeof failure !== "object" ||
        failure === null ||
        !("status" in failure)
      ) {
        throw error;
      }
      return { stdout: "", status: Number(failure.status) };
    }
  };

  // The hook file exists, so Buildkite runs it INSTEAD of the step's command in
  // every mode. Filter and step mode therefore have to give the step back.
  it("runs the customer's command in filter mode", () => {
    const { stdout, status } = runHook({
      BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: "filter",
      BUILDKITE_COMMAND: "echo hello",
    });

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("hello");
  });

  // Why `BUILDKITE_SHELL` and not a bare `bash -c`: the agent's default carries
  // `-e`, so a failing line of a multi-line command fails the step. Under
  // `bash -c` the step would pass, turning a real failure into a green build.
  it("honours the agent's shell flags, so a failing line still fails", () => {
    const { status } = runHook({
      BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: "filter",
      BUILDKITE_COMMAND: "false\necho reached",
    });

    expect(status).not.toBe(0);
  });

  it("does nothing for a step that has no command", () => {
    const { status } = runHook({
      BUILDKITE_PLUGIN_DYNAMIC_CI_MODE: "filter",
      BUILDKITE_COMMAND: "",
    });

    expect(status).toBe(0);
  });
});
