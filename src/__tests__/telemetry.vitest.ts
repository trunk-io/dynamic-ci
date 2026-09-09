import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TELEMETRY_URL,
  TELEMETRY_PATH,
  resolveBackoffStartMs,
  resolveMaxAttempts,
  resolveTelemetryUrl,
  telemetryDisabled,
} from "../config";
import { semverFromRef } from "../telemetry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("semverFromRef", () => {
  // The README pins `@v1`, so this is nearly all real traffic. Rejecting it would
  // report 0.0.0 everywhere and make the version label useless.
  it("parses the documented major-only pin", () => {
    expect(semverFromRef("v1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      suffix: "unknown",
    });
  });

  it("parses a full version with and without a prerelease suffix", () => {
    expect(semverFromRef("v1.2.3")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
    });
    expect(semverFromRef("v1.2.3-rc.1")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      suffix: "rc.1",
    });
  });

  // `gh-action-ref` is a public input, so a caller can write straight into a
  // Prometheus label. Both clamps below are the only thing bounding that.
  it("truncates an over-long ref", () => {
    expect(semverFromRef("a".repeat(200)).suffix).toHaveLength(32);
  });

  it("replaces a ref with unexpected characters rather than passing it through", () => {
    expect(semverFromRef('evil{label="x"}').suffix).toBe("other");
  });

  it("reports an absent ref as a single known value", () => {
    expect(semverFromRef("").suffix).toBe("unknown");
  });
});

describe("telemetry configuration", () => {
  it("defaults to the production telemetry host", () => {
    expect(resolveTelemetryUrl()).toBe(DEFAULT_TELEMETRY_URL);
    expect(DEFAULT_TELEMETRY_URL).toBe(
      `https://telemetry.api.trunk.io${TELEMETRY_PATH}`,
    );
  });

  it("follows the api address so a staging run reports to staging", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "https://api.trunk-staging.io");
    expect(resolveTelemetryUrl()).toBe(
      `https://telemetry.api.trunk-staging.io${TELEMETRY_PATH}`,
    );
  });

  // `telemetry.localhost` resolves to nothing, so prefixing the local loop would
  // cost a DNS failure per run.
  it("posts to the base host itself when the address is not https", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "http://localhost:3000");
    expect(resolveTelemetryUrl()).toBe(
      `http://localhost:3000${TELEMETRY_PATH}`,
    );
  });

  it("falls back to production for an unparseable address", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "not a url");
    expect(resolveTelemetryUrl()).toBe(DEFAULT_TELEMETRY_URL);
  });

  it("can be turned off entirely", () => {
    expect(telemetryDisabled()).toBe(false);
    vi.stubEnv("TRUNK_DISABLE_TELEMETRY", "true");
    expect(telemetryDisabled()).toBe(true);
  });
});

describe("resolveMaxAttempts", () => {
  it("defaults to one initial attempt plus three retries", () => {
    expect(resolveMaxAttempts()).toBe(4);
  });

  it("clamps above the ceiling and honours a lower budget", () => {
    vi.stubEnv("TRUNK_DYNAMIC_CI_MAX_ATTEMPTS", "99");
    expect(resolveMaxAttempts()).toBe(4);
    vi.stubEnv("TRUNK_DYNAMIC_CI_MAX_ATTEMPTS", "1");
    expect(resolveMaxAttempts()).toBe(1);
  });

  // `Number(" ")` is 0 and `Number.isInteger(0)` is true, so a blank would otherwise
  // clamp to a single attempt rather than falling back to the default.
  it.each(["", " ", "0", "-1", "2.5", "4abc"])(
    "falls back to the default for %o",
    (raw) => {
      vi.stubEnv("TRUNK_DYNAMIC_CI_MAX_ATTEMPTS", raw);
      expect(resolveMaxAttempts()).toBe(4);
    },
  );
});

describe("resolveBackoffStartMs", () => {
  it("defaults to the shared starting delay", () => {
    expect(resolveBackoffStartMs()).toBe(1000);
  });

  it("honours an override so tests need not pay real backoff", () => {
    vi.stubEnv("TRUNK_DYNAMIC_CI_BACKOFF_START_MS", "1");
    expect(resolveBackoffStartMs()).toBe(1);
  });
});
