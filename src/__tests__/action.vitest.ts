import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay, http, HttpResponse } from "msw";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, type ServerApi } from "./__fixtures__/msw";
import { runAction } from "../main";
import type { DynamicCiResponse } from "../schema/response";

const API_BASE = "https://dynamic-ci.test";
const API_URL = `${API_BASE}/v1/dynamic-ci`;

const skipUnitTests: DynamicCiResponse = {
  jobs: [
    {
      jobName: "Unit Tests",
      run: false,
      summary: "Skip — 99% historical pass rate and no impacted files.",
      signals: [
        {
          type: "historical-pass-rate",
          recommendation: "VOTE_NO_RUN",
          message: "99% over 30d",
          ignored: false,
        },
        {
          type: "force-override",
          recommendation: "ABSTAIN",
          message: "No override for this job.",
          ignored: false,
        },
      ],
    },
  ],
};

// Fixed paths for the whole file: `core.summary` caches its resolved file path on
// the first write, so a per-test path would leave later tests reading a stale file.
let workspace: string;
let outputPath: string;
let summaryPath: string;
let eventPath: string;

/** Parse the `name<<delimiter\nvalue\ndelimiter` protocol @actions/core writes. */
const readOutputs = (): Record<string, string> => {
  const lines = readFileSync(outputPath, "utf8").split(/\r?\n/);
  const outputs: Record<string, string> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(.+?)<<(ghadelimiter_[0-9a-f-]+)$/.exec(lines[index] ?? "");
    if (!match) {
      continue;
    }
    const key = match[1] ?? "";
    const delimiter = match[2] ?? "";
    const value: string[] = [];
    for (
      index += 1;
      index < lines.length && lines[index] !== delimiter;
      index += 1
    ) {
      value.push(lines[index] ?? "");
    }
    outputs[key] = value.join("\n");
  }
  return outputs;
};

const stubRunnerEnv = ({
  token = "test-token",
  omitToken = false,
  jobNames = "",
  ignoreSignals = "",
}: {
  token?: string;
  omitToken?: boolean;
  jobNames?: string;
  ignoreSignals?: string;
} = {}): void => {
  vi.stubEnv("INPUT_TOKEN", omitToken ? undefined : token);
  vi.stubEnv("INPUT_JOB-NAMES", jobNames);
  vi.stubEnv("INPUT_IGNORE-SIGNALS", ignoreSignals);
  vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", API_BASE);
  vi.stubEnv("GITHUB_OUTPUT", outputPath);
  vi.stubEnv("GITHUB_STEP_SUMMARY", summaryPath);
  vi.stubEnv("GITHUB_EVENT_PATH", eventPath);
  vi.stubEnv("GITHUB_REPOSITORY", "trunk-io/example");
  vi.stubEnv("GITHUB_SERVER_URL", "https://github.com");
  vi.stubEnv(
    "GITHUB_WORKFLOW_REF",
    "trunk-io/example/.github/workflows/pr.yaml@refs/pull/42/merge",
  );
  vi.stubEnv("GITHUB_WORKFLOW", "Pull Request");
  vi.stubEnv("GITHUB_RUN_ID", "7890123456");
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
  vi.stubEnv("GITHUB_TRIGGERING_ACTOR", "octocat");
  vi.stubEnv("GITHUB_EVENT_NAME", "pull_request");
  vi.stubEnv("GITHUB_SHA", "head-sha");
  vi.stubEnv("GITHUB_HEAD_REF", "feature/x");
  vi.stubEnv("GITHUB_REF_NAME", "42/merge");
};

describe("the action end to end", () => {
  let server: ServerApi;

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), "dynamic-ci-filter-"));
    outputPath = join(workspace, "outputs.txt");
    summaryPath = join(workspace, "summary.md");
    eventPath = join(workspace, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 42,
          base: { sha: "base-sha", ref: "main" },
          head: { sha: "head-sha", ref: "feature/x" },
        },
      }),
    );

    server = createServer([
      () => http.post(API_URL, () => HttpResponse.json(skipUnitTests)),
    ]);
    server.start();
  });

  beforeEach(() => {
    writeFileSync(outputPath, "");
    writeFileSync(summaryPath, "");
    server.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    server.close();
  });

  it("writes a skip verdict as a 'false' job output", async () => {
    stubRunnerEnv({ jobNames: "Unit Tests" });

    await runAction();

    expect(readOutputs()).toEqual({ "unit-tests": "false" });
  });

  it("sends the runner context and a Bearer token to the service", async () => {
    let authorization: string | null = null;
    let body: unknown;
    server.overrideHandlers([
      () =>
        http.post(API_URL, async ({ request }) => {
          authorization = request.headers.get("authorization");
          body = await request.json();
          return HttpResponse.json(skipUnitTests);
        }),
    ]);
    stubRunnerEnv({ jobNames: "Unit Tests", token: "secret-token" });

    await runAction();

    expect(authorization).toBe("Bearer secret-token");
    expect(body).toMatchObject({
      repo: { host: "github.com", owner: "trunk-io", name: "example" },
      commitSha: "head-sha",
      baseSha: "base-sha",
      branch: "feature/x",
      prNumber: 42,
      runId: "7890123456",
      runAttempt: 2,
      triggeringActor: "octocat",
      eventName: "pull_request",
      workflowPath: ".github/workflows/pr.yaml",
      workflowName: "Pull Request",
      jobNames: ["Unit Tests"],
    });
  });

  it("normalizes job names and fans out when job-names is unset", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () =>
          HttpResponse.json({
            jobs: [
              {
                jobName: "build (ubuntu, 20)",
                run: true,
                summary: "Run",
                signals: [],
              },
              {
                jobName: "E2E / chrome",
                run: false,
                summary: "Skip",
                signals: [],
              },
            ],
          }),
        ),
    ]);
    stubRunnerEnv();

    await runAction();

    expect(readOutputs()).toEqual({
      "build-ubuntu-20": "true",
      "e2e-chrome": "false",
    });
  });

  it("forwards ignore-signals to the service", async () => {
    let body: unknown;
    server.overrideHandlers([
      () =>
        http.post(API_URL, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(skipUnitTests);
        }),
    ]);
    stubRunnerEnv({
      jobNames: "Unit Tests",
      ignoreSignals: "estimated-cost, historical-pass-rate",
    });

    await runAction();

    expect(body).toMatchObject({
      ignoreSignals: ["estimated-cost", "historical-pass-rate"],
    });
  });

  it("fails open on an unrecognized ignore-signals value", async () => {
    stubRunnerEnv({
      jobNames: "Unit Tests",
      ignoreSignals: "estimated-cost,not-a-real-signal",
    });

    await expect(runAction()).resolves.toBeUndefined();

    // Input parsing throws before any request, so no job set is known yet.
    expect(readOutputs()).toEqual({});
    expect(readFileSync(summaryPath, "utf8")).toContain("fail-open");
  });

  it("defaults a job the service omits to 'true'", async () => {
    stubRunnerEnv({ jobNames: "Unit Tests,Integration Tests" });

    await runAction();

    expect(readOutputs()).toEqual({
      "unit-tests": "false",
      "integration-tests": "true",
    });
  });

  it("fails open to 'true' for every scoped job when the service errors", async () => {
    server.overrideHandlers([
      () =>
        http.post(
          API_URL,
          () =>
            new HttpResponse(null, {
              status: 503,
              statusText: "Service Unavailable",
            }),
        ),
    ]);
    stubRunnerEnv({ jobNames: "Unit Tests,Integration Tests" });

    await runAction();

    expect(readOutputs()).toEqual({
      "unit-tests": "true",
      "integration-tests": "true",
    });
    expect(readFileSync(summaryPath, "utf8")).toContain("fail-open");
  });

  it("fails open when the service exceeds the latency budget", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, async () => {
          await delay(200);
          return HttpResponse.json(skipUnitTests);
        }),
    ]);
    stubRunnerEnv({ jobNames: "Unit Tests" });
    vi.stubEnv("TRUNK_DYNAMIC_CI_TIMEOUT_MS", "20");

    await runAction();

    expect(readOutputs()).toEqual({ "unit-tests": "true" });
    expect(readFileSync(summaryPath, "utf8")).toContain("latency budget");
  });

  it("fails open without failing the step when the token is missing", async () => {
    stubRunnerEnv({ jobNames: "Unit Tests", omitToken: true });

    await expect(runAction()).resolves.toBeUndefined();

    // No job set is known at this point, and an absent output already means "run".
    expect(readOutputs()).toEqual({});
    expect(readFileSync(summaryPath, "utf8")).toContain("fail-open");
  });

  it("writes a per-job summary table that omits ABSTAIN signals", async () => {
    stubRunnerEnv({ jobNames: "Unit Tests" });

    await runAction();

    const summary = readFileSync(summaryPath, "utf8");
    expect(summary).toContain("Unit Tests");
    expect(summary).toContain("⏭️ SKIP");
    expect(summary).toContain("historical-pass-rate");
    expect(summary).not.toContain("ABSTAIN");
  });
});
