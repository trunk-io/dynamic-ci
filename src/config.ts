import * as z from "zod";

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

/** Total attempts, not retries — `exponential-backoff`'s `numOfAttempts` is a total. */
export const DEFAULT_MAX_ATTEMPTS = 3;

const MAX_ATTEMPTS_CEILING = 3;

/** Backoff between attempts. Mirrors the uploader's shared config. */
export const BACKOFF_STARTING_DELAY_MS = 1_000;
export const BACKOFF_MAX_DELAY_MS = 10_000;
export const BACKOFF_TIME_MULTIPLE = 2;

/** Shrink the backoff. Exists so the retry tests do not race vitest's timeout. */
export const BACKOFF_START_MS_ENV = "TRUNK_DYNAMIC_CI_BACKOFF_START_MS";

/** Path on the telemetry host, appended to `telemetry.<api-host>`. */
export const TELEMETRY_PATH = "/v1/dynamic-ci/plan-metrics";

/** Opt out entirely, matching the uploader's escape hatch. */
export const DISABLE_TELEMETRY_ENV = "TRUNK_DISABLE_TELEMETRY";

/** Node's fetch defaults to a 300s headers timeout; the uploader uses 1s here. */
export const TELEMETRY_TIMEOUT_MS = 1_000;

const telemetryUrl = (host: string): string =>
  `https://telemetry.${host}${TELEMETRY_PATH}`;

export const DEFAULT_TELEMETRY_URL: string = telemetryUrl("api.trunk.io");

// Every schema ends in `.catch(default)`: a runner can set anything, and the action
// must degrade rather than throw. `Number("")`, `Number(" ")` and `Number("30000abc")`
// all fail a constraint below and land in the same fallback.

const timeoutMsSchema = z.coerce.number().positive().catch(DEFAULT_TIMEOUT_MS);

const maxAttemptsSchema = z.coerce
  .number()
  .int()
  .positive()
  .transform((attempts) => Math.min(attempts, MAX_ATTEMPTS_CEILING))
  .catch(DEFAULT_MAX_ATTEMPTS);

const backoffStartMsSchema = z.coerce
  .number()
  .nonnegative()
  .catch(BACKOFF_STARTING_DELAY_MS);

const disableTelemetrySchema = z
  .string()
  .transform((value) => value.trim().toLowerCase() === "true")
  .catch(false);

// Deliberately not validated as a URL: a malformed address must fail the fetch (which
// fails open) rather than fall back to production and quietly send a staging repo's
// traffic to prod.
const apiUrlSchema = z
  .string()
  .trim()
  .min(1)
  // Strip a trailing slash so appending the path cannot produce a double `//`.
  .transform((base) => `${base.replace(/\/+$/, "")}${DYNAMIC_CI_PATH}`)
  .catch(DEFAULT_API_URL);

const telemetryUrlSchema = z
  .string()
  .trim()
  .pipe(z.url())
  .transform((base) => {
    const url = new URL(base);
    // Non-https is the local loop, where `telemetry.localhost` resolves to nothing;
    // post to the base host itself, as the uploader's client does.
    return url.protocol === "https:"
      ? telemetryUrl(url.host)
      : `${url.origin}${TELEMETRY_PATH}`;
  })
  .catch(DEFAULT_TELEMETRY_URL);

export const resolveTimeoutMs = (): number =>
  timeoutMsSchema.parse(process.env[TIMEOUT_MS_ENV]);

export const resolveMaxAttempts = (): number =>
  maxAttemptsSchema.parse(process.env[MAX_ATTEMPTS_ENV]);

export const resolveBackoffStartMs = (): number =>
  backoffStartMsSchema.parse(process.env[BACKOFF_START_MS_ENV]);

export const telemetryDisabled = (): boolean =>
  disableTelemetrySchema.parse(process.env[DISABLE_TELEMETRY_ENV]);

export const resolveApiUrl = (): string =>
  apiUrlSchema.parse(process.env[API_ADDRESS_ENV]);

/**
 * Follows the plan endpoint's base address, so a staging run reports to staging.
 * A different host from the plan API on purpose: that is what lets an outage of the
 * plan path still be reported.
 */
export const resolveTelemetryUrl = (): string =>
  telemetryUrlSchema.parse(process.env[API_ADDRESS_ENV]);
