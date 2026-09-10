import * as core from "@actions/core";
import type protobuf from "protobufjs";
import { backOff } from "exponential-backoff";
import {
  BACKOFF_MAX_DELAY_MS,
  BACKOFF_TIME_MULTIPLE,
  TELEMETRY_TIMEOUT_MS,
  resolveBackoffStartMs,
  resolveTelemetryUrl,
  telemetryDisabled,
} from "../config";
import type { Repo as RepoShape } from "../schema/request";
import type { PlanOutcome } from "../outcome";
import { Duration, PlanRequestMetrics, Repo } from "./protos";

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

export interface PlanTelemetry {
  token: string;
  actionRef: string;
  repo: RepoShape;
  outcome: PlanOutcome;
  attempts: number;
  durationMs: number;
  jobCount: number;
}

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
    const message = PlanRequestMetrics.create({
      action_version: telemetry.actionRef || "unknown",
      repo: Repo.create(telemetry.repo),
      status: telemetry.outcome.status,
      reason: telemetry.outcome.reason,
      attempts: telemetry.attempts,
      duration: durationOf(telemetry.durationMs),
      job_count: telemetry.jobCount,
    });
    const buffer = PlanRequestMetrics.encode(message).finish();

    await backOff(
      async () => {
        // Node's fetch defaults to a 300s headers timeout, so an unbounded call here
        // would add minutes to every job against a host that accepts and stalls.
        const response = await fetch(resolveTelemetryUrl(), {
          method: "POST",
          body: Buffer.from(buffer),
          headers: {
            "Content-Type": "application/x-protobuf",
            "x-api-token": telemetry.token,
          },
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
