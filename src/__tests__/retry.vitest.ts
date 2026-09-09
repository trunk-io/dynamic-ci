import { http, HttpResponse } from "msw";
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
import { requestRecommendations } from "../api";
import { DEFAULT_API_URL as API_URL } from "../config";
import type { DynamicCiRequest, DynamicCiResponse } from "../compat";

const request: DynamicCiRequest = {
  repo: { host: "github.com", owner: "trunk-io", name: "trunk" },
  commitSha: "abc123",
  baseSha: "def456",
  branch: "feature/x",
  prNumber: 1,
  runId: "7890123456",
  runAttempt: 1,
  workflowPath: ".github/workflows/ci.yml",
  jobKeys: ["unit-tests"],
};

const validResponse: DynamicCiResponse = {
  jobs: [{ jobKey: "unit-tests", run: false, summary: "Skip", signals: [] }],
};

const call = (maxAttempts: number) =>
  requestRecommendations({
    url: API_URL,
    token: "tok",
    body: request,
    timeoutMs: 1000,
    maxAttempts,
  });

describe("requestRecommendations retries", () => {
  let server: ServerApi;
  let received: number;

  beforeAll(() => {
    server = createServer([
      () => http.post(API_URL, () => HttpResponse.json(validResponse)),
    ]);
    server.start();
  });
  beforeEach(() => {
    received = 0;
    // Real backoff is uniform-random up to ~14s across four attempts, which races
    // vitest's 5s default. A flaky retry test gets quarantined, and this file is
    // exactly what would catch retries being removed.
    vi.stubEnv("TRUNK_DYNAMIC_CI_BACKOFF_START_MS", "1");
    server.reset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(() => {
    server.close();
  });

  it("recovers on a later attempt and reports the attempt count", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => {
          received += 1;
          return received < 3
            ? new HttpResponse(null, { status: 503 })
            : HttpResponse.json(validResponse);
        }),
    ]);

    const result = await call(3);

    expect(result.attempts).toBe(3);
    expect(result.response.jobs[0]?.run).toBe(false);
    expect(received).toBe(3);
  });

  it("gives up after exhausting the attempt budget", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => {
          received += 1;
          return new HttpResponse(null, { status: 500 });
        }),
    ]);

    await expect(call(3)).rejects.toThrow(/500/);
    expect(received).toBe(3);
  });

  // The whole point of the non-retryable path: retrying a wire-shape disagreement
  // spends the full budget to receive the identical bytes. A request-count assertion
  // is the only thing that catches a regression here — the throw looks the same.
  it("does not retry a response that fails schema validation", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => {
          received += 1;
          return HttpResponse.json({ jobs: "not-an-array" });
        }),
    ]);

    await expect(call(3)).rejects.toThrow(/cannot parse/);
    expect(received).toBe(1);
  });

  it("retries a 429 like any other transient failure", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => {
          received += 1;
          return received < 2
            ? new HttpResponse(null, { status: 429 })
            : HttpResponse.json(validResponse);
        }),
    ]);

    await expect(call(3)).resolves.toMatchObject({ attempts: 2 });
  });

  // 4xx is retried on purpose (the budget is "any non-200"), and it can never
  // succeed — so the cost is real and this test is what makes it visible.
  it("still spends the budget on a 401, which cannot succeed", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => {
          received += 1;
          return new HttpResponse(null, { status: 401 });
        }),
    ]);

    await expect(call(3)).rejects.toThrow(/401/);
    expect(received).toBe(3);
  });

  it("reports the measured attempt count on the thrown error", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => {
          received += 1;
          return HttpResponse.json({ jobs: "not-an-array" });
        }),
    ]);

    // The non-retryable path exits after one request, so anything that assumes the
    // budget was spent would report 4 here.
    await expect(call(3)).rejects.toMatchObject({ attempts: 1 });
  });

  it("makes exactly one attempt when the budget is one", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => {
          received += 1;
          return new HttpResponse(null, { status: 502 });
        }),
    ]);

    await expect(call(1)).rejects.toThrow(/502/);
    expect(received).toBe(1);
  });
});
