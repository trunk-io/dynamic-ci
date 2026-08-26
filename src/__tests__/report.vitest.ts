import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicCiResponse } from "../schema/response";

const info = vi.fn();
const notice = vi.fn();

vi.mock("@actions/core", () => ({
  info: (message: string) => info(message),
  notice: (message: string, properties?: unknown) =>
    notice(message, properties),
  summary: {
    addRaw: vi.fn().mockReturnThis(),
    addEOL: vi.fn(),
    write: vi.fn(),
  },
}));

const { reportRecommendations } = await import("../report");

beforeEach(() => {
  info.mockClear();
  notice.mockClear();
  vi.stubEnv("GITHUB_STEP_SUMMARY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const response = {
  jobs: [
    {
      jobKey: "unit-tests",
      run: true,
      summary:
        "The job must run because a user override forces this job to run.",
      signals: [
        {
          type: "force-override",
          recommendation: "MUST_RUN",
          message: "A user override forces this job to run.",
          ignored: false,
        },
        {
          type: "previous-result-on-pr",
          recommendation: "NEVER_RUN",
          message: "Already passed on this exact commit.",
          ignored: false,
        },
        {
          type: "historical-pass-rate",
          recommendation: "ABSTAIN",
          message: "Does not apply.",
          ignored: false,
        },
      ],
    },
  ],
} as const satisfies DynamicCiResponse;

describe("reportRecommendations", () => {
  it("omits ABSTAIN signals from the per-signal log lines", async () => {
    await reportRecommendations(response);

    const lines = info.mock.calls.map((call) => String(call[0]));
    expect(
      lines.some((line) => line.includes("[MUST_RUN] force-override")),
    ).toBe(true);
    expect(
      lines.some((line) => line.includes("[NEVER_RUN] previous-result-on-pr")),
    ).toBe(true);
    expect(lines.some((line) => line.includes("ABSTAIN"))).toBe(false);
  });

  it("still annotates the job verdict with its summary", async () => {
    await reportRecommendations(response);
    expect(notice).toHaveBeenCalledWith(
      "unit-tests: RUN — The job must run because a user override forces this job to run.",
      { title: "Trunk Dynamic CI Filter" },
    );
  });
});
