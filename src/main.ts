import * as core from "@actions/core";
import { RecommendationError, requestRecommendations } from "./api";
import { resolveApiUrl, resolveMaxAttempts, resolveTimeoutMs } from "./config";
import { buildRequest, parseRepo } from "./context";
import { readInputs } from "./inputs";
import { outcomeForError, outcomeForResponse } from "./outcome";
import { setFailOpenOutputs, setOutputs } from "./outputs";
import { reportFailOpen, reportRecommendations } from "./report";
import { PLAN_REASON, PLAN_STATUS } from "./telemetry/protos";
import { sendPlanTelemetry } from "./telemetry";

const failOpen = async (jobKeys: string[], reason: string): Promise<void> => {
  setFailOpenOutputs(jobKeys);
  await reportFailOpen(jobKeys, reason);
};

export const run = async (): Promise<void> => {
  const inputs = readInputs();
  const request = buildRequest(inputs);

  const apiUrl = resolveApiUrl();
  const timeoutMs = resolveTimeoutMs();
  const maxAttempts = resolveMaxAttempts();
  // An empty `jobKeys` is fan-out mode: the service enumerates the whole workflow.
  const scope =
    request.jobKeys.length > 0
      ? request.jobKeys.join(", ")
      : `all jobs in workflow "${request.workflowPath}"`;
  core.info(`Requesting recommendations from ${apiUrl} for: ${scope}`);

  const startedAt = Date.now();
  try {
    const result = await requestRecommendations({
      url: apiUrl,
      token: inputs.token,
      body: request,
      timeoutMs,
      maxAttempts,
    });
    setOutputs(result.response, request.jobKeys);
    await reportRecommendations(result.response);
    await sendPlanTelemetry({
      token: inputs.token,
      actionRef: inputs.actionRef,
      repo: request.repo,
      outcome: outcomeForResponse(result.response),
      attempts: result.attempts,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    await failOpen(
      request.jobKeys,
      error instanceof Error ? error.message : String(error),
    );
    await sendPlanTelemetry({
      token: inputs.token,
      actionRef: inputs.actionRef,
      repo: request.repo,
      outcome: outcomeForError(error),
      attempts:
        error instanceof RecommendationError ? (error.attempts ?? 0) : 0,
      durationMs: Date.now() - startedAt,
    });
  }
};

// Never calls core.setFailed: failing the step would defeat the fail-open guarantee.
export const runAction = async (): Promise<void> => {
  try {
    await run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    core.warning(
      `Trunk Dynamic CI Filter failed open due to an unexpected error: ${reason}`,
    );
    try {
      await failOpen([], reason);
    } catch {
      // Reporting itself failed; the outputs are already absent, which means run.
    }
    // Re-read the inputs: run() may have thrown before reading them, and this is the
    // failure mode least visible any other way.
    try {
      const inputs = readInputs();
      await sendPlanTelemetry({
        token: inputs.token,
        actionRef: inputs.actionRef,
        repo: parseRepo(),
        outcome: { status: PLAN_STATUS.failed, reason: PLAN_REASON.internal },
        attempts: 0,
        durationMs: 0,
      });
    } catch {
      // Nothing left to report with.
    }
  }
};
