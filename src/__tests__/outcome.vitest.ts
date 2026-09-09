import { describe, expect, it } from "vitest";
import { RecommendationError } from "../api";
import { outcomeForError, outcomeForResponse } from "../outcome";
import { PLAN_REASON, PLAN_STATUS } from "../telemetry/protos";
import type { DynamicCiResponse } from "../compat";

const withNotice = (code: string): DynamicCiResponse => ({
  jobs: [],
  notice: { code, message: "…" },
});

const withVerdicts: DynamicCiResponse = {
  jobs: [{ jobKey: "a", run: true, summary: "Run", signals: [] }],
};

describe("outcomeForResponse", () => {
  it("reports a plan with verdicts as a success carrying no reason", () => {
    expect(outcomeForResponse(withVerdicts)).toEqual({
      status: PLAN_STATUS.success,
      reason: PLAN_REASON.none,
    });
  });

  // Shadow plans carry real verdicts, so they are a success; shadow-vs-enforced is a
  // server-side label and duplicating it here would be a second source of truth.
  it("reports shadow mode as a success, not an omission", () => {
    expect(
      outcomeForResponse({
        ...withVerdicts,
        notice: { code: "REPO_IN_SHADOW_MODE", message: "…" },
      }),
    ).toEqual({
      status: PLAN_STATUS.success,
      reason: PLAN_REASON.none,
    });
  });

  // A 200 with a notice, but nothing was gated because the engine broke. Filing it
  // under `omitted` would hide a crash among the expected short-circuits.
  it("reports an absorbed engine crash as a failure", () => {
    expect(outcomeForResponse(withNotice("ENGINE_UNAVAILABLE"))).toEqual({
      status: PLAN_STATUS.failed,
      reason: PLAN_REASON.engineUnavailable,
    });
  });

  it.each([
    ["MERGE_QUEUE_BRANCH", PLAN_REASON.mergeQueueBranch],
    ["ORG_NOT_ENABLED", PLAN_REASON.orgNotEnabled],
    ["REPO_NOT_ENABLED", PLAN_REASON.repoNotEnabled],
    ["WORKFLOW_NOT_RECOGNIZED", PLAN_REASON.workflowNotRecognized],
  ])("maps the %s short-circuit to an omission", (code, reason) => {
    expect(outcomeForResponse(withNotice(code))).toEqual({
      status: PLAN_STATUS.omitted,
      reason,
    });
  });

  // The engine ships notices ahead of this vendored copy, so an unknown code must
  // still land in the right bucket rather than being dropped.
  it("keeps an unrecognized notice an omission", () => {
    expect(outcomeForResponse(withNotice("A_NOTICE_FROM_THE_FUTURE"))).toEqual({
      status: PLAN_STATUS.omitted,
      reason: PLAN_REASON.none,
    });
  });

  it("reports an unexplained empty plan as a failure", () => {
    expect(outcomeForResponse({ jobs: [] })).toEqual({
      status: PLAN_STATUS.failed,
      reason: PLAN_REASON.noVerdicts,
    });
  });
});

describe("outcomeForError", () => {
  it.each([
    ["http_server_error", PLAN_REASON.httpServerError],
    ["http_client_error", PLAN_REASON.httpClientError],
    ["http_rate_limited", PLAN_REASON.httpRateLimited],
    ["timeout", PLAN_REASON.timeout],
    ["transport", PLAN_REASON.transport],
    ["invalid_response", PLAN_REASON.invalidResponse],
  ] as const)("maps the %s failure kind", (kind, reason) => {
    expect(outcomeForError(new RecommendationError(kind, "boom"))).toEqual({
      status: PLAN_STATUS.failed,
      reason,
    });
  });

  it("falls back to internal for a non-RecommendationError throw", () => {
    expect(
      outcomeForError(new TypeError("undefined is not a function")),
    ).toEqual({
      status: PLAN_STATUS.failed,
      reason: PLAN_REASON.internal,
    });
  });
});
