import * as core from "@actions/core";
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
import { PlanRequestMetrics, Repo, Semver } from "./protos";

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

const SUFFIX_MAX_CHARS = 32;
const SAFE_SUFFIX = /^[A-Za-z0-9._/-]+$/;

/**
 * `v1`, `v1.2` and `v1.2.3[-rc]` all parse: the README pins `@v1`, so rejecting a
 * partial version would report 0.0.0 for nearly all traffic and defeat the point of
 * the field. Anything else (a branch or sha pin) rides in `suffix`, which is clamped
 * because it becomes a Prometheus label and `gh-action-ref` is a public input.
 */
export const semverFromRef = (
  ref: string,
): { major: number; minor: number; patch: number; suffix: string } => {
  const matches = /^v(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/.exec(ref);
  if (matches) {
    return {
      major: Number(matches[1]),
      minor: Number(matches[2] ?? 0),
      patch: Number(matches[3] ?? 0),
      suffix: boundedSuffix(matches[4] ?? ""),
    };
  }
  return { major: 0, minor: 0, patch: 0, suffix: boundedSuffix(ref) };
};

const boundedSuffix = (value: string): string => {
  if (!value) {
    return "unknown";
  }
  const trimmed = value.slice(0, SUFFIX_MAX_CHARS);
  return SAFE_SUFFIX.test(trimmed) ? trimmed : "other";
};

export interface PlanTelemetry {
  token: string;
  actionRef: string;
  repo: RepoShape;
  outcome: PlanOutcome;
  attempts: number;
  durationMs: number;
}

/**
 * Report the plan outcome to trunk's telemetry service. Fire-and-forget: the verdict
 * is already set, and a telemetry failure must never reach a customer's build log —
 * hence `core.debug` and the swallowed catch.
 */
export const sendPlanTelemetry = async (
  telemetry: PlanTelemetry,
): Promise<void> => {
  if (telemetryDisabled()) {
    return;
  }
  try {
    const message = PlanRequestMetrics.create({
      action_version: Semver.create(semverFromRef(telemetry.actionRef)),
      repo: Repo.create(telemetry.repo),
      status: telemetry.outcome.status,
      reason: telemetry.outcome.reason,
      attempts: telemetry.attempts,
      duration_ms: Math.round(telemetry.durationMs),
    });
    const buffer = PlanRequestMetrics.encode(message).finish();

    await backOff(
      async () => {
        // Node's fetch defaults to a 300s headers timeout, so an unbounded call here
        // would add ~15 minutes to every job against a host that accepts and stalls.
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
        // A 4xx is the documented steady-state failure of a drifted proto contract;
        // retrying it just pays the budget to be rejected three identical times.
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
