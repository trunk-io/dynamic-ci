/** Production endpoint. Used when {@link API_ADDRESS_ENV} is unset. */
export const DEFAULT_API_URL =
  "https://ci-optimizer.v2.api.trunk.io/v1/dynamic-ci";

/** Path appended to the public API address to reach the recommendation endpoint. */
export const DYNAMIC_CI_PATH = "/v1/dynamic-ci";

/**
 * Override the recommendation endpoint via the shared trunk API base address
 * (dev/staging) — the same env var the test-results uploader reads. It is a base
 * address (e.g. `https://api.trunk.io`); {@link DYNAMIC_CI_PATH} is
 * appended to it. Unset falls back to the production endpoint.
 */
export const API_ADDRESS_ENV = "TRUNK_PUBLIC_API_ADDRESS";

/** Override the request timeout (the fail-open latency budget). */
export const TIMEOUT_MS_ENV = "TRUNK_DYNAMIC_CI_TIMEOUT_MS";

/** Latency budget: a recommendation must not exceed 30s per job. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export const resolveApiUrl = (): string => {
  const base = process.env[API_ADDRESS_ENV]?.trim();
  if (!base) {
    return DEFAULT_API_URL;
  }
  // Strip any trailing slash on the base address to avoid a double `//` when the
  // dynamic-ci path is appended.
  return `${base.replace(/\/+$/, "")}${DYNAMIC_CI_PATH}`;
};

export const resolveTimeoutMs = (): number => {
  const raw = process.env[TIMEOUT_MS_ENV];
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  // Number() (not parseInt) so trailing garbage like "30000abc" is rejected to
  // the default rather than silently truncated to 30000.
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
};
