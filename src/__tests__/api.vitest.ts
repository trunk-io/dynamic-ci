import { createServer, type ServerApi } from "./__fixtures__/msw";
import { delay, http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DynamicCiRequest, DynamicCiResponse } from "../compat";
import { requestRecommendations } from "../api";
import { DEFAULT_API_URL as API_URL } from "../config";

const request: DynamicCiRequest = {
  repo: { host: "github.com", owner: "trunk-io", name: "trunk" },
  commitSha: "abc123",
  baseSha: "def456",
  branch: "feature/x",
  prNumber: 1,
  runId: "7890123456",
  runAttempt: 1,
  workflowPath: ".github/workflows/ci.yml",
  workflowName: "CI",
  jobKeys: ["unit-tests"],
};

const validResponse: DynamicCiResponse = {
  jobs: [
    {
      jobKey: "unit-tests",
      run: false,
      summary: "Skip — 99% historical pass rate",
      signals: [
        {
          type: "historical-pass-rate",
          recommendation: "VOTE_NO_RUN",
          message: "99% over 30d",
          ignored: false,
        },
      ],
    },
  ],
};

describe("requestRecommendations (MSW integration)", () => {
  let server: ServerApi;

  beforeAll(() => {
    server = createServer([
      () => http.post(API_URL, () => HttpResponse.json(validResponse)),
    ]);
    server.start();
  });
  beforeEach(() => {
    server.reset();
  });
  afterAll(() => {
    server.close();
  });

  it("parses a schema-valid 2xx response", async () => {
    const result = await requestRecommendations({
      url: API_URL,
      token: "tok",
      body: request,
      timeoutMs: 1000,
    });
    expect(result.jobs[0]?.run).toBe(false);
  });

  it("sends a Bearer token and JSON body to the endpoint", async () => {
    let authHeader: string | null = null;
    let receivedBody: unknown;
    server.overrideHandlers([
      () =>
        http.post(API_URL, async ({ request: received }) => {
          authHeader = received.headers.get("authorization");
          receivedBody = await received.json();
          return HttpResponse.json(validResponse);
        }),
    ]);

    await requestRecommendations({
      url: API_URL,
      token: "secret-tok",
      body: request,
      timeoutMs: 1000,
    });

    expect(authHeader).toBe("Bearer secret-tok");
    expect(receivedBody).toMatchObject({ jobKeys: ["unit-tests"] });
  });

  it("throws on a non-2xx status (caller fails open)", async () => {
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

    await expect(
      requestRecommendations({
        url: API_URL,
        token: "tok",
        body: request,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/503/);
  });

  // The complement of the test below: unknown enum *members* are tolerated (the
  // service adds signals ahead of this vendored contract), unknown *shapes* are not.
  it("accepts a signal type and recommendation outside the vendored enums", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () =>
          HttpResponse.json({
            jobs: [
              {
                jobKey: "unit-tests",
                run: false,
                summary: "Skip",
                signals: [
                  {
                    type: "a-signal-from-the-future",
                    recommendation: "A_VOTE_FROM_THE_FUTURE",
                    message: "…",
                    ignored: false,
                  },
                ],
              },
            ],
          }),
        ),
    ]);

    const result = await requestRecommendations({
      url: API_URL,
      token: "tok",
      body: request,
      timeoutMs: 1000,
    });

    expect(result.jobs[0]?.run).toBe(false);
    expect(result.jobs[0]?.signals[0]?.type).toBe("a-signal-from-the-future");
  });

  it("throws when the response fails schema validation", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, () => HttpResponse.json({ jobs: "not-an-array" })),
    ]);

    await expect(
      requestRecommendations({
        url: API_URL,
        token: "tok",
        body: request,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow();
  });

  it("surfaces a latency-budget error when the request exceeds the timeout", async () => {
    server.overrideHandlers([
      () =>
        http.post(API_URL, async () => {
          await delay(200);
          return HttpResponse.json(validResponse);
        }),
    ]);

    await expect(
      requestRecommendations({
        url: API_URL,
        token: "tok",
        body: request,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/latency budget/);
  });
});
