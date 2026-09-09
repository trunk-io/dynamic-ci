import { randomUUID } from "node:crypto";
import * as core from "@actions/core";
import { backOff } from "exponential-backoff";
import {
  DYNAMIC_CI_RESPONSE_SCHEMA,
  type DynamicCiRequest,
  type DynamicCiResponse,
} from "./compat";
import {
  BACKOFF_MAX_DELAY_MS,
  BACKOFF_TIME_MULTIPLE,
  resolveBackoffStartMs,
} from "./config";

interface RequestRecommendationsArgs {
  url: string;
  token: string;
  body: DynamicCiRequest;
  timeoutMs: number;
  maxAttempts: number;
}

export type FailureKind =
  | "http_server_error"
  | "http_client_error"
  | "http_rate_limited"
  | "timeout"
  | "transport"
  | "invalid_response";

export class RecommendationError extends Error {
  public readonly kind: FailureKind;
  /** False for a deterministic disagreement: a retry returns the identical bytes. */
  public readonly retryable: boolean;
  /** Set as the error leaves `requestRecommendations`, so telemetry reports the
   *  measured count rather than assuming the budget was spent. */
  public attempts?: number;

  public constructor(
    kind: FailureKind,
    message: string,
    opts?: { retryable?: boolean },
  ) {
    super(message);
    this.name = "RecommendationError";
    this.kind = kind;
    this.retryable = opts?.retryable ?? true;
  }
}

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_FLOOR = 500;

const classifyStatus = (status: number): FailureKind => {
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return "http_rate_limited";
  }
  return status >= HTTP_SERVER_ERROR_FLOOR
    ? "http_server_error"
    : "http_client_error";
};

export interface RecommendationResult {
  response: DynamicCiResponse;
  attempts: number;
}

const attemptOnce = async (
  args: Omit<RequestRecommendationsArgs, "maxAttempts">,
): Promise<DynamicCiResponse> => {
  const requestId = randomUUID();
  core.info(`Recommendation service request id: ${requestId}`);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, args.timeoutMs);
  try {
    const response = await fetch(args.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.token}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RecommendationError(
        classifyStatus(response.status),
        `recommendation API returned ${String(response.status)} ${response.statusText}`,
      );
    }

    const json: unknown = await response.json();
    const parsed = DYNAMIC_CI_RESPONSE_SCHEMA.safeParse(json);
    if (!parsed.success) {
      // Not retried: a wire-shape disagreement clears only on a deploy.
      throw new RecommendationError(
        "invalid_response",
        `recommendation API returned a response this action cannot parse: ${parsed.error.message}`,
        { retryable: false },
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof RecommendationError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new RecommendationError(
        "timeout",
        `exceeded latency budget of ${String(args.timeoutMs)}ms`,
      );
    }
    throw new RecommendationError(
      "transport",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Retries with exponential backoff; the caller fails open on any throw. The timeout is
 * **per attempt**, so a dead API costs ~`timeoutMs * maxAttempts` on every job at once.
 */
export const requestRecommendations = async ({
  maxAttempts,
  ...args
}: RequestRecommendationsArgs): Promise<RecommendationResult> => {
  let attempts = 0;
  const response = await backOff(
    async () => {
      attempts += 1;
      return attemptOnce(args);
    },
    {
      delayFirstAttempt: false,
      jitter: "full",
      maxDelay: BACKOFF_MAX_DELAY_MS,
      // A *total*, not a retry count: the uploader's 3 is two retries.
      numOfAttempts: maxAttempts,
      startingDelay: resolveBackoffStartMs(),
      timeMultiple: BACKOFF_TIME_MULTIPLE,
      retry: (error: unknown, attemptNumber: number) => {
        if (error instanceof RecommendationError && !error.retryable) {
          return false;
        }
        const reason = error instanceof Error ? error.message : String(error);
        // `retry` is consulted on the final attempt too, so say "retrying" only when
        // one is actually left — otherwise the build log claims a retry that never runs.
        const remaining = attemptNumber < maxAttempts;
        core.info(
          `Recommendation attempt ${String(attemptNumber)} of ${String(maxAttempts)} failed (${reason})${remaining ? "; retrying." : "."}`,
        );
        return true;
      },
    },
  ).catch((error: unknown) => {
    if (error instanceof RecommendationError) {
      error.attempts = attempts;
    }
    throw error;
  });
  return { response, attempts };
};
