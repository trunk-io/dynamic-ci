import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicCiResponse } from "../schema/response";

const info = vi.fn();
const notice = vi.fn();
const warning = vi.fn();

vi.mock("@actions/core", () => ({
  info: (message: string) => info(message),
  notice: (message: string, properties?: unknown) =>
    notice(message, properties),
  warning: (message: string, properties?: unknown) =>
    warning(message, properties),
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
  warning.mockClear();
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

  it("does not warn about a plan that has verdicts and no notice", async () => {
    await reportRecommendations(response);
    expect(warning).not.toHaveBeenCalled();
  });
});

/**
 * The regression these cover: an empty plan used to render as the heading
 * "Trunk Dynamic CI Filter recommendations:" and nothing else — on a green step,
 * so the only evidence anything had happened was an absence.
 */
describe("a plan with no verdicts", () => {
  const emptyWithNotice = {
    jobs: [],
    notice: {
      code: "ORG_NOT_ENABLED",
      message:
        "Every job will run: Dynamic CI is not enabled for this organization. Contact Trunk to turn it on.",
    },
  } as const satisfies DynamicCiResponse;

  it("annotates the reason the service gave", async () => {
    await reportRecommendations(emptyWithNotice);

    expect(warning).toHaveBeenCalledWith(
      "Every job will run: Dynamic CI is not enabled for this organization. Contact Trunk to turn it on. [ORG_NOT_ENABLED]",
      { title: "Trunk Dynamic CI Filter" },
    );
  });

  it("does not print a recommendations heading with nothing under it", async () => {
    await reportRecommendations(emptyWithNotice);

    const lines = info.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("recommendations:"))).toBe(false);
  });

  // A service too old to send a notice, or one that scored nothing at all: the
  // action still has to say that every job is about to run.
  it("points at support when the service sent no notice", async () => {
    await reportRecommendations({ jobs: [] });

    expect(warning).toHaveBeenCalledWith(
      "No per-job recommendations were returned. Please contact slack.trunk.io for support.",
      { title: "Trunk Dynamic CI Filter" },
    );
  });
});

describe("a plan that carries both verdicts and a notice", () => {
  // The merge-queue and kill-switch paths echo the requested job keys, so a
  // per-job call gets real verdicts *and* a notice. Both must render.
  const withBoth = {
    jobs: [
      {
        jobKey: "unit-tests",
        run: true,
        summary:
          "Running because this is a Merge Queue branch (never skipped).",
        signals: [],
      },
    ],
    notice: {
      code: "MERGE_QUEUE_BRANCH",
      message:
        "Every job will run: this is a merge-queue branch, where Dynamic CI never skips a job.",
    },
  } as const satisfies DynamicCiResponse;

  it("reports the notice and the verdicts", async () => {
    await reportRecommendations(withBoth);

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("[MERGE_QUEUE_BRANCH]"),
      { title: "Trunk Dynamic CI Filter" },
    );
    expect(notice).toHaveBeenCalledWith(
      "unit-tests: RUN — Running because this is a Merge Queue branch (never skipped).",
      { title: "Trunk Dynamic CI Filter" },
    );
  });
});
