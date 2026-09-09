import type { DynamicCiResponse } from "./compat";
import { RecommendationError } from "./api";
import { PLAN_REASON, PLAN_STATUS } from "./telemetry/protos";

export interface PlanOutcome {
  status: number;
  reason: number;
}

// An unknown code still maps to `skipped`, so a notice this action predates reports
// as "served, gating nothing" rather than being dropped.
const NOTICE_REASON: Record<string, number> = {
  MERGE_QUEUE_BRANCH: PLAN_REASON.mergeQueueBranch,
  ORG_NOT_ENABLED: PLAN_REASON.orgNotEnabled,
  REPO_NOT_ENABLED: PLAN_REASON.repoNotEnabled,
  WORKFLOW_NOT_RECOGNIZED: PLAN_REASON.workflowNotRecognized,
};

const FAILURE_REASON: Record<string, number> = {
  http_server_error: PLAN_REASON.httpServerError,
  http_client_error: PLAN_REASON.httpClientError,
  http_rate_limited: PLAN_REASON.httpRateLimited,
  timeout: PLAN_REASON.timeout,
  transport: PLAN_REASON.transport,
  invalid_response: PLAN_REASON.invalidResponse,
};

/** Shadow is a success (real verdicts); ENGINE_UNAVAILABLE is a failure despite its
 *  200, since filing a crash under `skipped` hides it among expected short-circuits. */
export const outcomeForResponse = (
  response: DynamicCiResponse,
): PlanOutcome => {
  const code = response.notice?.code;
  if (code === "ENGINE_UNAVAILABLE") {
    return {
      status: PLAN_STATUS.failed,
      reason: PLAN_REASON.engineUnavailable,
    };
  }
  if (code !== undefined && code !== "REPO_IN_SHADOW_MODE") {
    return {
      status: PLAN_STATUS.skipped,
      reason: NOTICE_REASON[code] ?? PLAN_REASON.unspecified,
    };
  }
  // No verdicts and no notice: notices cover every expected empty plan, so this is
  // the service producing something it cannot explain.
  if (response.jobs.length === 0) {
    return { status: PLAN_STATUS.failed, reason: PLAN_REASON.noVerdicts };
  }
  return { status: PLAN_STATUS.success, reason: PLAN_REASON.unspecified };
};

export const outcomeForError = (error: unknown): PlanOutcome => ({
  status: PLAN_STATUS.failed,
  reason:
    error instanceof RecommendationError
      ? (FAILURE_REASON[error.kind] ?? PLAN_REASON.internal)
      : PLAN_REASON.internal,
});
