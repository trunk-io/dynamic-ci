import { execFile, execFileSync } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA } from "../../src/schema/request";
import { fakeAgentPath } from "./support/agent";
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

// What the log says it did has to be what it did. The count used to come off
// the plan, which overcounts: `apply-skips.jq` declines a `trigger:` step and a
// `skip:` the customer wrote themselves, so the plan's verdicts include steps
// that are still going to run. A wrong number is easy to miss; a wrong list of
// step keys is not, which is the other reason to name them.
describe("the summary of what was marked", () => {
  const LONG = "passed on the last 40 runs; no correlated paths changed here";

  const summaryFor = async (
    pipeline: unknown,
    plan: unknown,
  ): Promise<string> => {
    const captured: CapturedRequest = {};
    let stderr = "";

    await withPlanServer(plan, captured, async (address) => {
      ({ stderr } = await runFilter(JSON.stringify(pipeline), {
        TRUNK_PUBLIC_API_ADDRESS: address,
      }));
    });

    return stderr;
  };

  it("names each step it marked, with the reason", async () => {
    const stderr = await summaryFor(PIPELINE, {
      jobs: [
        { jobKey: "unit", run: false, summary: LONG, signals: [] },
        { jobKey: "e2e", run: true, summary: "paths changed", signals: [] },
      ],
    });

    expect(stderr).toContain("marked 1 step(s) to skip");
    expect(stderr).toContain(`unit — ${LONG}`);
  });

  // The `skip:` attribute is capped at 70 characters, so the reason in the
  // Buildkite UI is truncated. The log is the place the whole of it survives.
  it("logs the untruncated summary, not the 70-character skip value", async () => {
    const stderr = await summaryFor(PIPELINE, {
      jobs: [{ jobKey: "unit", run: false, summary: LONG, signals: [] }],
    });

    expect(LONG.length).toBeGreaterThan(70 - "Trunk Dynamic CI: ".length);
    expect(stderr).toContain(LONG);
  });

  it("does not name a step the mutation declined to mark", async () => {
    // PLAN says to skip `downstream`, which is a trigger step. It stays.
    const stderr = await summaryFor(PIPELINE, PLAN);

    expect(stderr).toContain("marked 1 step(s) to skip");
    expect(stderr).not.toContain("downstream");
  });

  it("does not name a step that carried the customer's own skip", async () => {
    const stderr = await summaryFor(
      { steps: [{ key: "held", command: "make x", skip: "mine" }] },
      { jobs: [{ jobKey: "held", run: false, summary: "would", signals: [] }] },
    );

    expect(stderr).toContain("marked no steps to skip");
    expect(stderr).not.toContain("held");
  });

  it("caps a long list rather than burying the rest of the log", async () => {
    const keys = Array.from({ length: 30 }, (_, i) => `step-${String(i)}`);
    const stderr = await summaryFor(
      { steps: keys.map((key) => ({ key, command: "make x" })) },
      {
        jobs: keys.map((jobKey) => ({
          jobKey,
          run: false,
          summary: "no correlated paths changed",
          signals: [],
        })),
      },
    );

    expect(stderr).toContain("marked 30 step(s) to skip");
    expect(stderr).toContain("step-24 —");
    expect(stderr).not.toContain("step-25 —");
    expect(stderr).toContain("… and 5 more");
  });

  it("keeps the summary off stdout", async () => {
    const captured: CapturedRequest = {};
    let stdout = "";

    await withPlanServer(PLAN, captured, async (address) => {
      ({ stdout } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
      }));
    });

    expect(stdout).not.toContain("marked");
    expect(() => {
      JSON.parse(stdout);
    }).not.toThrow();
  });
});

// The YAML branch renders with `--no-interpolation`, so the customer's own
// `pipeline upload` owes the single pass. If theirs passes the flag too, nothing
// interpolates and `$$VAR` reaches the shell, which reads `$$` as its own PID —
// `$$FX_INNER` becomes `206FX_INNER`. Not an error and not a blank: a plausible
// string that changes every run.
//
// This used to be said on every YAML pipeline, which is how the first customer
// to try filter mode was told off for a mistake they had not made. A warning
// everyone sees on every build is a warning nobody reads, so it is now gated on
// there being something to lose and, where the step's command is visible, on the
// mistake actually having been made.
describe("the interpolation warning", () => {
  const YAML = "steps:\n  - key: unit\n    command: make test\n";
  const NOTHING_TO_LOSE = { steps: [{ key: "unit", command: "make test" }] };
  const AT_STAKE = { steps: [{ key: "unit", command: "echo $$FX_INNER" }] };

  const renderAs = async (
    rendered: unknown,
    command: string,
  ): Promise<string> => {
    const captured: CapturedRequest = {};
    let stderr = "";

    await withPlanServer(PLAN, captured, async (address) => {
      ({ stderr } = await runFilter(YAML, {
        TRUNK_PUBLIC_API_ADDRESS: address,
        PATH: fakeAgentPath(rendered),
        BUILDKITE_COMMAND: command,
      }));
    });

    return stderr;
  };

  const PIPED =
    "cat p.yml | trunk-dynamic-ci-filter | buildkite-agent pipeline upload";

  it("says nothing when the pipeline has nothing to interpolate", async () => {
    expect(await renderAs(NOTHING_TO_LOSE, PIPED)).not.toContain(
      "interpolation",
    );
  });

  it("says nothing when the command is visible and does not pass the flag", async () => {
    expect(await renderAs(AT_STAKE, PIPED)).not.toContain("interpolation");
  });

  it("names the mistake when the command actually passes the flag", async () => {
    expect(await renderAs(AT_STAKE, `${PIPED} --no-interpolation`)).toContain(
      "remove --no-interpolation",
    );
  });

  it("falls back to the advisory when it cannot see the command", async () => {
    expect(await renderAs(AT_STAKE, "")).toContain(
      "must NOT pass --no-interpolation",
    );
  });

  it("still filters the pipeline on the YAML path", async () => {
    const captured: CapturedRequest = {};
    let stdout = "";

    await withPlanServer(PLAN, captured, async (address) => {
      ({ stdout } = await runFilter(YAML, {
        TRUNK_PUBLIC_API_ADDRESS: address,
        PATH: fakeAgentPath(NOTHING_TO_LOSE),
      }));
    });

    expect(JSON.parse(stdout)).toEqual({
      steps: [
        {
          key: "unit",
          command: "make test",
          skip: "Trunk Dynamic CI: passed 40/40",
        },
      ],
    });
  });
});

// The real answer to "I only want to trial this on one step": a skip taken
// before dispatch, rather than step mode's run-and-do-nothing.
describe("the only-keys option", () => {
  it("asks about only the named keys", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(PLAN, captured, async (address) => {
      await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_ONLY_KEYS: "unit",
      });
    });

    const request = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      captured.received,
    );
    expect(request.jobKeys).toEqual(["unit"]);
  });

  // A plan naming a key outside the list cannot arrive in practice — we never
  // asked — so narrowing is enforced on the request only. This pins that the
  // narrowed step is still genuinely skipped and its siblings are untouched.
  it("skips the named step and leaves the rest alone", async () => {
    const captured: CapturedRequest = {};

    await withPlanServer(PLAN, captured, async (address) => {
      const { stdout } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_ONLY_KEYS: "unit",
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

  // The "never skip my deploy step" control, and the reason it exists: saying it
  // through only-keys would mean listing every other step in the pipeline.
  it("never decides about a step in exclude-keys", async () => {
    const captured: CapturedRequest = {};

    // A plan scoped to what was actually asked, as the engine returns. Handing
    // back a verdict for `unit` here would test the documented asymmetry —
    // narrowing is enforced on the request, not on the plan — rather than the
    // option.
    const scoped = {
      jobs: [
        { jobKey: "e2e", run: true, summary: "paths changed", signals: [] },
      ],
    };

    await withPlanServer(scoped, captured, async (address) => {
      const { stdout } = await runFilter(JSON.stringify(PIPELINE), {
        TRUNK_PUBLIC_API_ADDRESS: address,
        BUILDKITE_PLUGIN_DYNAMIC_CI_EXCLUDE_KEYS: "unit",
      });

      expect(JSON.parse(stdout)).toEqual(PIPELINE);
    });

    const request = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      captured.received,
    );
    expect(request.jobKeys).toEqual(["e2e"]);
  });

  // A stale only-keys and an unkeyed pipeline both end with nothing to ask
  // about, and sending the customer to look for a missing `key:` when the list
  // is the problem wastes their afternoon.
  it("says the lists left nothing, not that no step has a key", async () => {
    const { stdout, stderr } = await runFilter(JSON.stringify(PIPELINE), {
      BUILDKITE_PLUGIN_DYNAMIC_CI_ONLY_KEYS: "renamed-last-week",
    });

    expect(stderr).toContain("no step left to consider");
    // Both lists are echoed, because either one can be the culprit and the
    // customer cannot tell which from the message alone.
    expect(stderr).toContain("renamed-last-week");
    expect(stderr).toContain("exclude-keys: <unset>");
    expect(stderr).not.toContain("found no step with a key");
    expect(JSON.parse(stdout)).toEqual(PIPELINE);
  });

  it("skips nothing and says so when exclude-keys covers every step", async () => {
    const { stdout, stderr } = await runFilter(JSON.stringify(PIPELINE), {
      BUILDKITE_PLUGIN_DYNAMIC_CI_EXCLUDE_KEYS: "unit,e2e",
    });

    expect(stderr).toContain("no step left to consider");
    expect(stderr).toContain("exclude-keys: unit,e2e");
    expect(JSON.parse(stdout)).toEqual(PIPELINE);
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
      "step",
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
