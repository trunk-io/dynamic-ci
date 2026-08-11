import * as core from "@actions/core";
import { requestRecommendations } from "./api";
import { resolveApiUrl, resolveTimeoutMs } from "./config";
import { buildRequest } from "./context";
import { readInputs } from "./inputs";
import { setFailOpenOutputs, setOutputs } from "./outputs";
import { reportFailOpen, reportRecommendations } from "./report";

const failOpen = async (jobs: string[], reason: string): Promise<void> => {
  setFailOpenOutputs(jobs);
  await reportFailOpen(jobs, reason);
};

export const run = async (): Promise<void> => {
  const inputs = readInputs();
  const request = buildRequest(inputs);

  const apiUrl = resolveApiUrl();
  const timeoutMs = resolveTimeoutMs();
  // An empty `jobNames` is fan-out mode: the service enumerates the whole workflow.
  const scope =
    request.jobNames.length > 0
      ? request.jobNames.join(", ")
      : `all jobs in workflow "${request.workflowName}"`;
  core.info(`Requesting recommendations from ${apiUrl} for: ${scope}`);

  try {
    const response = await requestRecommendations({
      url: apiUrl,
      token: inputs.token,
      body: request,
      timeoutMs,
    });
    setOutputs(response, request.jobNames);
    await reportRecommendations(response);
  } catch (error) {
    await failOpen(
      request.jobNames,
      error instanceof Error ? error.message : String(error),
    );
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
    await failOpen([], reason);
  }
};
