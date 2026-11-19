import * as core from "@actions/core";
import type protobuf from "protobufjs";
import { backOff } from "exponential-backoff";
import {
  BACKOFF_MAX_DELAY_MS,
  BACKOFF_TIME_MULTIPLE,
  DEFAULT_API_URL,
  TELEMETRY_TIMEOUT_MS,
  isV2ApiKey,
  resolveApiUrl,
  resolveBackoffStartMs,
  resolveTelemetryUrl,
  resolveTelemetryV2Url,
  telemetryDisabled,
} from "../config";
import type { Repo as RepoShape } from "../compat";
import type { PlanOutcome } from "../outcome";
import type { ChangedFilesSource } from "../changed-files";
import type { WorkflowFileShaSource } from "../workflow-file-sha";
import { planMetricsRequest } from "./otlp";
import {
  Duration,
  PLAN_INPUT_SOURCE,
  PlanRequestMetrics,
  Repo,
} from "./protos";

const TELEMETRY_ATTEMPTS = 3;
const HTTP_SERVER_ERROR_FLOOR = 500;

class TelemetryHttpError extends Error {
  public readonly isClientError: boolean;

  public constructor(status: number) {
    super(`telemetry returned ${String(status)}`);
    this.name = "TelemetryHttpError";
    this.isClientError = status < HTTP_SERVER_ERROR_FLOOR;
  }
}

const MS_PER_SECOND = 1_000;
const NANOS_PER_MS = 1_000_000;

/** Wall clock as a `google.protobuf.Duration`; the caller still measures in ms. */
const durationOf = (durationMs: number): protobuf.Message => {
  const ms = Math.max(0, Math.round(durationMs));
  return Duration.create({
    seconds: Math.floor(ms / MS_PER_SECOND),
    nanos: (ms % MS_PER_SECOND) * NANOS_PER_MS,
  });
};

const FULL_SHA = /^[0-9a-f]{40}$/i;

// Prefixed so the Buildkite plugin's `buildkite/<ref>` shares the label without
// colliding; a pinned sha is cut to 7 characters to fit the server's 32.
export const actionVersionLabel = (ref: string): string =>
  `github/${FULL_SHA.test(ref) ? ref.slice(0, 7) : ref || "unknown"}`;

export interface PlanTelemetry {
  token: string;
  actionRef: string;
  repo: RepoShape;
  outcome: PlanOutcome;
  attempts: number;
  durationMs: number;
  jobCount: number;
  /** Where each input came from; undefined when it was not sent. */
  inputs?: {
    changedFiles: ChangedFilesSource | undefined;
    workflowFileSha: WorkflowFileShaSource | undefined;
  };
}

const PLAN_INPUT_SOURCE_OF = {
  checkout: PLAN_INPUT_SOURCE.checkout,
  api: PLAN_INPUT_SOURCE.githubApi,
} as const satisfies Record<ChangedFilesSource | WorkflowFileShaSource, number>;

const inputSource = (
  source: ChangedFilesSource | WorkflowFileShaSource | undefined,
): number =>
  source === undefined ? PLAN_INPUT_SOURCE.none : PLAN_INPUT_SOURCE_OF[source];

/**
 * Report the plan outcome. Fire-and-forget: the verdict is already set, and a
 * telemetry failure must never reach a customer's build log.
 */
export const sendPlanTelemetry = async (
  telemetry: PlanTelemetry,
): Promise<void> => {
  if (telemetryDisabled()) {
    return;
  }
  try {
    const request = isV2ApiKey(telemetry.token)
      ? v2Request(telemetry)
      : v1Request(telemetry);

    await backOff(
      async () => {
        // Node's fetch defaults to a 300s headers timeout, so an unbounded call here
        // would add minutes to every job against a host that accepts and stalls.
        const response = await fetch(request.url, {
          method: "POST",
          body: request.body,
          headers: request.headers,
          signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new TelemetryHttpError(response.status);
        }
      },
      {
        delayFirstAttempt: false,
        jitter: "full",
        maxDelay: BACKOFF_MAX_DELAY_MS,
        numOfAttempts: TELEMETRY_ATTEMPTS,
        // A 4xx is a drifted contract, not a blip; retrying just pays the budget
        // to be rejected three identical times.
        retry: (error: unknown) =>
          !(error instanceof TelemetryHttpError && error.isClientError),
        startingDelay: resolveBackoffStartMs(),
        timeMultiple: BACKOFF_TIME_MULTIPLE,
      },
    );
  } catch (error) {
    core.debug(
      `Telemetry upload failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

interface TelemetryRequest {
  url: string;
  body: string | Buffer;
  headers: Record<string, string>;
}

// trunk1 compares the key with the org's legacy one, so a v2 key goes to trunk2.
const v2Request = (telemetry: PlanTelemetry): TelemetryRequest => ({
  url: resolveTelemetryV2Url(),
  body: JSON.stringify(
    planMetricsRequest({
      version: actionVersionLabel(telemetry.actionRef),
      environment:
        resolveApiUrl() === DEFAULT_API_URL ? "production" : "staging",
      status: telemetry.outcome.status,
      reason: telemetry.outcome.reason,
      attempts: telemetry.attempts,
      durationMs: telemetry.durationMs,
      jobCount: telemetry.jobCount,
      inputs: telemetry.inputs,
      nowMs: Date.now(),
    }),
  ),
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${telemetry.token}`,
  },
});

const v1Request = (telemetry: PlanTelemetry): TelemetryRequest => {
  const message = PlanRequestMetrics.create({
    action_version: actionVersionLabel(telemetry.actionRef),
    repo: Repo.create(telemetry.repo),
    status: telemetry.outcome.status,
    reason: telemetry.outcome.reason,
    attempts: telemetry.attempts,
    duration: durationOf(telemetry.durationMs),
    job_count: telemetry.jobCount,
    ...(telemetry.inputs === undefined
      ? {}
      : {
          changed_files_source: inputSource(telemetry.inputs.changedFiles),
          workflow_file_sha_source: inputSource(
            telemetry.inputs.workflowFileSha,
          ),
        }),
  });
  return {
    url: resolveTelemetryUrl(),
    body: Buffer.from(PlanRequestMetrics.encode(message).finish()),
    headers: {
      "Content-Type": "application/x-protobuf",
      "x-api-token": telemetry.token,
    },
  };
};
