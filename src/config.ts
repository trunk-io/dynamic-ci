/** Path appended to the public API address to reach the recommendation endpoint. */
export const DYNAMIC_CI_PATH = "/v2/dynamic-ci/generate-plan";

/** Trunk's public API. Used when {@link API_ADDRESS_ENV} is unset. */
export const DEFAULT_API_ADDRESS = "https://api.trunk.io";

/** Production endpoint. Used when {@link API_ADDRESS_ENV} is unset. */
// Spelled out rather than composed from the two constants above: a template
// literal needs an explicit annotation under `isolatedDeclarations`, which
// `no-inferrable-types` then rejects. config.vitest.ts pins it against them.
export const DEFAULT_API_URL =
  "https://api.trunk.io/v2/dynamic-ci/generate-plan";

/**
 * Point the action at a different Trunk deployment via the shared trunk API base
 * address (dev/staging) — the same env var the test-results uploader reads. It is
 * a base address (e.g. `https://api.trunk.io`), host only; {@link DYNAMIC_CI_PATH}
 * is always appended. Unset falls back to production.
 *
 * Deliberately a host override rather than a whole-URL one: the path is part of
 * the contract between this action and the API version it speaks, so letting a
 * caller replace it would let the two drift silently.
 */
export const API_ADDRESS_ENV = "TRUNK_PUBLIC_API_ADDRESS";

/** Override the request timeout (the fail-open latency budget). */
export const TIMEOUT_MS_ENV = "TRUNK_DYNAMIC_CI_TIMEOUT_MS";

/** Latency budget: a recommendation must not exceed 30s per job. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Override the number of attempts (1 initial + retries). */
export const MAX_ATTEMPTS_ENV = "TRUNK_DYNAMIC_CI_MAX_ATTEMPTS";

/**
 * Total attempts, i.e. 1 initial + 3 retries.
 *
 * Note `exponential-backoff`'s `numOfAttempts` is a *total*, not a retry count —
 * the test-results uploader's 3 means two retries. Do not "align" the two on the
 * assumption they mean the same thing.
 *
 * The timeout above stays **per attempt**, so a fully unreachable API costs up to
 * `DEFAULT_TIMEOUT_MS * MAX_ATTEMPTS + backoff` per job. Lower this env fleet-wide
 * to cut that ceiling without cutting a release.
 */
export const DEFAULT_MAX_ATTEMPTS = 4;

/** Beyond four attempts the per-job latency cost dominates. */
const MAX_ATTEMPTS_CEILING = 4;

/** Backoff between attempts. Mirrors the uploader's shared config. */
export const BACKOFF_STARTING_DELAY_MS = 1_000;
export const BACKOFF_MAX_DELAY_MS = 10_000;
export const BACKOFF_TIME_MULTIPLE = 2;

/**
 * Shrink the backoff. Exists for tests: real backoff is uniform-random up to ~14s
 * across four attempts, which races vitest's 5s default and makes the retry suite
 * flake — and a flaky retry test is the one that gets quarantined, which is exactly
 * the test that would catch retries being removed.
 */
export const BACKOFF_START_MS_ENV = "TRUNK_DYNAMIC_CI_BACKOFF_START_MS";

export const resolveBackoffStartMs = (): number => {
  const parsed = Number(process.env[BACKOFF_START_MS_ENV]);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : BACKOFF_STARTING_DELAY_MS;
};

export const resolveMaxAttempts = (): number => {
  const raw = process.env[MAX_ATTEMPTS_ENV];
  if (!raw) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  // Number() (not parseInt) so trailing garbage is rejected to the default rather
  // than silently truncated, matching resolveTimeoutMs.
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.min(parsed, MAX_ATTEMPTS_CEILING);
};

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

/** Path on the telemetry host, appended to `telemetry.<api-host>`. */
export const TELEMETRY_PATH = "/v1/dynamic-ci/plan-metrics";

const telemetryUrl = (host: string): string =>
  `https://telemetry.${host}${TELEMETRY_PATH}`;

export const DEFAULT_TELEMETRY_URL: string = telemetryUrl("api.trunk.io");

/**
 * Derived from the same base address as the plan endpoint, matching the uploader, so
 * a staging run reports to staging. Deliberately a *different host* from the plan
 * API: telemetry rides trunk1's telemetry-gateway while the plan crosses the /v2
 * apex forward, which is what lets a plan-path outage still be reported.
 */
export const resolveTelemetryUrl = (): string => {
  const base = process.env[API_ADDRESS_ENV]?.trim();
  if (!base) {
    return DEFAULT_TELEMETRY_URL;
  }
  try {
    const url = new URL(base);
    // Non-https is the local loop, where `telemetry.localhost` resolves to nothing;
    // post to the base host itself, as the uploader's client does.
    return url.protocol === "https:"
      ? telemetryUrl(url.host)
      : `${url.origin}${TELEMETRY_PATH}`;
  } catch {
    return DEFAULT_TELEMETRY_URL;
  }
};

/** Opt out entirely, matching the uploader's escape hatch. */
export const DISABLE_TELEMETRY_ENV = "TRUNK_DISABLE_TELEMETRY";

export const telemetryDisabled = (): boolean =>
  (process.env[DISABLE_TELEMETRY_ENV] ?? "").toLowerCase() === "true";

/**
 * Telemetry is not the critical path, so it gets a tight deadline rather than the
 * plan lane's. Node's fetch defaults to a 300s headers timeout, which across three
 * attempts would add ~15 minutes to every job against a host that accepts and
 * stalls. The uploader's client uses 1s for exactly this call.
 */
export const TELEMETRY_TIMEOUT_MS = 1_000;
