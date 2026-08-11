import { randomUUID } from "node:crypto";
import * as core from "@actions/core";
import type { DynamicCiRequest } from "./schema/request";
import {
  DYNAMIC_CI_RESPONSE_SCHEMA,
  type DynamicCiResponse,
} from "./schema/response";

interface RequestRecommendationsArgs {
  url: string;
  token: string;
  body: DynamicCiRequest;
  timeoutMs: number;
}

/**
 * POST the request to the recommendation service and parse the response against
 * the shared contract. Throws on transport error, non-2xx status, timeout
 * (latency budget exceeded), or a response that fails schema validation. The
 * caller fails open on any throw.
 */
export const requestRecommendations = async ({
  url,
  token,
  body,
  timeoutMs,
}: RequestRecommendationsArgs): Promise<DynamicCiResponse> => {
  // Correlation id for this call: we generate it (rather than read it back from
  // the response) so it's logged up-front and survives a timeout/error — the
  // service adopts it via the `X-Request-Id` header and persists it, so a CI run
  // traces to the service logs and the stored recommendation.
  const requestId = randomUUID();
  core.info(`Recommendation service request id: ${requestId}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-request-id": requestId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `recommendation API returned ${String(response.status)} ${response.statusText}`,
      );
    }

    const json: unknown = await response.json();
    return DYNAMIC_CI_RESPONSE_SCHEMA.parse(json);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`exceeded latency budget of ${String(timeoutMs)}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
