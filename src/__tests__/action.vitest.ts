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
import {
  PLAN_REASON,
  PLAN_STATUS,
  PlanRequestMetrics,
} from "../telemetry/protos";
import { runAction } from "../main";
import type { DynamicCiResponse } from "../schema/response";

const API_BASE = "https://dynamic-ci.test";
const API_URL = `${API_BASE}/v2/dynamic-ci/generate-plan`;
const TELEMETRY_URL =
  "https://telemetry.dynamic-ci.test/v1/dynamic-ci/plan-metrics";

/** Status/reason are read back as raw protobuf field bytes; see decodeTelemetry. */
let telemetryPosts: Uint8Array[] = [];

const skipUnitTests: DynamicCiResponse = {
  jobs: [
    {
      jobKey: "unit-tests",
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

const decodeTelemetry = (
  payload: Uint8Array,
): { status: number; reason: number; attempts: number } => {
  const decoded = PlanRequestMetrics.decode(payload) as unknown as {
    status?: number;
    reason?: number;
    attempts?: number;
  };
  return {
    status: decoded.status ?? 0,
    reason: decoded.reason ?? 0,
    attempts: decoded.attempts ?? 0,
  };
};

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
  jobKeys = "",
  ignoreSignals = "",
}: {
  token?: string;
  omitToken?: boolean;
  jobKeys?: string;
  ignoreSignals?: string;
} = {}): void => {
  vi.stubEnv("INPUT_TOKEN", omitToken ? undefined : token);
  vi.stubEnv("INPUT_JOB-KEYS", jobKeys);
  vi.stubEnv("INPUT_IGNORE-SIGNALS", ignoreSignals);
  vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", API_BASE);
  vi.stubEnv("TRUNK_DYNAMIC_CI_MAX_ATTEMPTS", "1");
  vi.stubEnv("GITHUB_OUTPUT", outputPath);
  vi.stubEnv("GITHUB_STEP_SUMMARY", summaryPath);
  vi.stubEnv("GITHUB_EVENT_PATH", eventPath);
  vi.stubEnv("GITHUB_REPOSITORY", "trunk-io/example");
  vi.stubEnv("GITHUB_SERVER_URL", "https://github.com");
  vi.stubEnv(
    "GITHUB_WORKFLOW_REF",
    "trunk-io/example/.github/workflows/pr.yaml@refs/pull/42/merge",
  );
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
      // Registered for every case: msw is configured to error on an unhandled
      // request, and the telemetry lane must never influence the action's outcome.
      () =>
        http.post(TELEMETRY_URL, async ({ request: received }) => {
          telemetryPosts.push(new Uint8Array(await received.arrayBuffer()));
          return new HttpResponse(null, { status: 200 });
        }),
    ]);
    server.start();
  });

  beforeEach(() => {
    writeFileSync(outputPath, "");
    writeFileSync(summaryPath, "");
    telemetryPosts = [];
    server.reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    server.close();
  });

  it("writes a skip verdict as a 'false' job output", async () => {
    stubRunnerEnv({ jobKeys: "unit-tests" });

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
    stubRunnerEnv({ jobKeys: "unit-tests", token: "secret-token" });

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
      jobKeys: ["unit-tests"],
    });
  });

  it("fans out over the workflow when job-keys is unset", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () =>
          HttpResponse.json({
            jobs: [
              { jobKey: "build_docs", run: true, summary: "Run", signals: [] },
              {
                jobKey: "e2e-chrome",
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
      build_docs: "true",
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
      jobKeys: "unit-tests",
      ignoreSignals: "estimated-cost, historical-pass-rate",
    });

    await runAction();

    expect(body).toMatchObject({
      ignoreSignals: ["estimated-cost", "historical-pass-rate"],
    });
  });

  // A signal this version predates is a normal state, not an error: the service
  // ships new signals before the vendored contract catches up.
  it("forwards an unrecognized ignore-signals value, and still gates", async () => {
    let body: unknown;
    server.overrideHandlers([
      () =>
        http.post(API_URL, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(skipUnitTests);
        }),
    ]);
    stubRunnerEnv({
      jobKeys: "unit-tests",
      ignoreSignals: "estimated-cost,a-signal-from-the-future",
    });

    await runAction();

    expect(body).toMatchObject({
      ignoreSignals: ["estimated-cost", "a-signal-from-the-future"],
    });
    expect(readOutputs()).toEqual({ "unit-tests": "false" });
    expect(readFileSync(summaryPath, "utf8")).not.toContain("fail-open");
  });

  // The regression this file most needs to hold: an unrecognized signal `type`
  // used to fail the whole-response parse, so every job in the workflow lost its
  // verdict and the action failed open.
  it("honors verdicts when the service returns a signal it does not know", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () =>
          HttpResponse.json({
            jobs: [
              {
                jobKey: "unit-tests",
                run: false,
                summary: "Skip — the future signal says so.",
                signals: [
                  {
                    type: "a-signal-from-the-future",
                    recommendation: "A_VOTE_FROM_THE_FUTURE",
                    message: "Invented by a service newer than this action.",
                    ignored: false,
                  },
                ],
              },
            ],
          }),
        ),
    ]);
    stubRunnerEnv({ jobKeys: "unit-tests" });

    await runAction();

    expect(readOutputs()).toEqual({ "unit-tests": "false" });

    // Reported rather than dropped: it is what explains the verdict.
    const summary = readFileSync(summaryPath, "utf8");
    expect(summary).not.toContain("fail-open");
    expect(summary).toContain("a-signal-from-the-future");
    expect(summary).toContain("A_VOTE_FROM_THE_FUTURE");
  });

  it("defaults a job the service omits to 'true'", async () => {
    stubRunnerEnv({ jobKeys: "unit-tests,integration-tests" });

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
    stubRunnerEnv({ jobKeys: "unit-tests,integration-tests" });

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
    stubRunnerEnv({ jobKeys: "unit-tests" });
    vi.stubEnv("TRUNK_DYNAMIC_CI_TIMEOUT_MS", "20");

    await runAction();

    expect(readOutputs()).toEqual({ "unit-tests": "true" });
    expect(readFileSync(summaryPath, "utf8")).toContain("latency budget");
  });

  it("fails open without failing the step when the token is missing", async () => {
    stubRunnerEnv({ jobKeys: "unit-tests", omitToken: true });

    await expect(runAction()).resolves.toBeUndefined();

    // No job set is known at this point, and an absent output already means "run".
    expect(readOutputs()).toEqual({});
    expect(readFileSync(summaryPath, "utf8")).toContain("fail-open");
  });

  it("writes a per-job summary table that omits ABSTAIN signals", async () => {
    stubRunnerEnv({ jobKeys: "unit-tests" });

    await runAction();

    const summary = readFileSync(summaryPath, "utf8");
    expect(summary).toContain("unit-tests");
    expect(summary).toContain("⏭️ SKIP");
    expect(summary).toContain("historical-pass-rate");
    expect(summary).not.toContain("ABSTAIN");
  });

  describe("plan telemetry", () => {
    it("reports a served plan as a success carrying no reason", async () => {
      stubRunnerEnv({ jobKeys: "unit-tests" });

      await runAction();

      expect(telemetryPosts).toHaveLength(1);
      expect(decodeTelemetry(telemetryPosts[0] ?? new Uint8Array())).toEqual({
        status: PLAN_STATUS.success,
        reason: PLAN_REASON.unspecified,
        attempts: 1,
      });
    });

    it("reports a fail-open with the failure class that caused it", async () => {
      server.overrideHandlers([
        () => http.post(API_URL, () => new HttpResponse(null, { status: 503 })),
        () =>
          http.post(TELEMETRY_URL, async ({ request: received }) => {
            telemetryPosts.push(new Uint8Array(await received.arrayBuffer()));
            return new HttpResponse(null, { status: 200 });
          }),
      ]);
      stubRunnerEnv({ jobKeys: "unit-tests" });

      await runAction();

      expect(readOutputs()).toEqual({ "unit-tests": "true" });
      expect(
        decodeTelemetry(telemetryPosts[0] ?? new Uint8Array()),
      ).toMatchObject({
        status: PLAN_STATUS.failed,
        reason: PLAN_REASON.httpServerError,
      });
    });

    // The lane is fire-and-forget: it runs after the verdict is set, and a telemetry
    // outage must not change a single output or fail the step.
    it("leaves outputs untouched when telemetry itself fails", async () => {
      server.overrideHandlers([
        () => http.post(API_URL, () => HttpResponse.json(skipUnitTests)),
        () =>
          http.post(
            TELEMETRY_URL,
            () => new HttpResponse(null, { status: 500 }),
          ),
      ]);
      stubRunnerEnv({ jobKeys: "unit-tests" });

      await expect(runAction()).resolves.toBeUndefined();
      expect(readOutputs()).toEqual({ "unit-tests": "false" });
    });
  });
});
