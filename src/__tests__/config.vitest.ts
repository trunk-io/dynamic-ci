import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_ADDRESS,
  DEFAULT_API_URL,
  DYNAMIC_CI_PATH,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TELEMETRY_URL,
  DEFAULT_TIMEOUT_MS,
  TELEMETRY_PATH,
  resolveApiUrl,
  resolveMaxAttempts,
  resolveTelemetryUrl,
  resolveTimeoutMs,
  telemetryDisabled,
} from "../config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveApiUrl", () => {
  it("falls back to the production endpoint when no base address is set", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", undefined);
    expect(resolveApiUrl()).toBe(DEFAULT_API_URL);
  });

  // Pinned literally: asserting against DEFAULT_API_URL alone would still pass if
  // the shipped endpoint changed, and this is the URL every unconfigured
  // customer's CI hits.
  it("ships the v2 endpoint on Trunk's public API as that default", () => {
    expect(DEFAULT_API_URL).toBe(
      "https://api.trunk.io/v2/dynamic-ci/generate-plan",
    );
  });

  // DEFAULT_API_URL is spelled out rather than composed (see config.ts), so this
  // is what stops it drifting from the host and path an override reassembles.
  it("keeps that default equal to the host and path an override composes", () => {
    expect(DEFAULT_API_URL).toBe(`${DEFAULT_API_ADDRESS}${DYNAMIC_CI_PATH}`);
  });

  it("appends the endpoint path to a configured base address", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "https://api.example.com");
    expect(resolveApiUrl()).toBe(
      "https://api.example.com/v2/dynamic-ci/generate-plan",
    );
  });

  it("does not double up the slash on a base address with a trailing slash", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "https://api.example.com///");
    expect(resolveApiUrl()).toBe(
      "https://api.example.com/v2/dynamic-ci/generate-plan",
    );
  });

  it("treats a whitespace-only base address as unset", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "   ");
    expect(resolveApiUrl()).toBe(DEFAULT_API_URL);
  });
});

describe("resolveTimeoutMs", () => {
  it("defaults when unset", () => {
    vi.stubEnv("TRUNK_DYNAMIC_CI_TIMEOUT_MS", undefined);
    expect(resolveTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("honors a positive override", () => {
    vi.stubEnv("TRUNK_DYNAMIC_CI_TIMEOUT_MS", "1500");
    expect(resolveTimeoutMs()).toBe(1500);
  });

  it.each(["30000abc", "not-a-number", "0", "-1", ""])(
    "falls back to the default for the invalid value %j",
    (value) => {
      vi.stubEnv("TRUNK_DYNAMIC_CI_TIMEOUT_MS", value);
      expect(resolveTimeoutMs()).toBe(DEFAULT_TIMEOUT_MS);
    },
  );
});

describe("resolveMaxAttempts", () => {
  it("honors a lower budget", () => {
    vi.stubEnv("TRUNK_DYNAMIC_CI_MAX_ATTEMPTS", "1");
    expect(resolveMaxAttempts()).toBe(1);
  });

  // Clamped rather than rejected: asking for more means "as many as I can have".
  it("clamps a request above the ceiling", () => {
    vi.stubEnv("TRUNK_DYNAMIC_CI_MAX_ATTEMPTS", "99");
    expect(resolveMaxAttempts()).toBe(DEFAULT_MAX_ATTEMPTS);
  });

  // `Number("")` and `Number(" ")` are both 0, which a bare isInteger check accepts.
  it.each([undefined, "", " ", "0", "-1", "2.5", "4abc"])(
    "falls back to the default for %j",
    (value) => {
      vi.stubEnv("TRUNK_DYNAMIC_CI_MAX_ATTEMPTS", value);
      expect(resolveMaxAttempts()).toBe(DEFAULT_MAX_ATTEMPTS);
    },
  );
});

describe("resolveTelemetryUrl", () => {
  it("defaults to the production telemetry host", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", undefined);
    expect(resolveTelemetryUrl()).toBe(DEFAULT_TELEMETRY_URL);
  });

  it("follows the api address so a staging run reports to staging", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "https://api.trunk-staging.io");
    expect(resolveTelemetryUrl()).toBe(
      `https://telemetry.api.trunk-staging.io${TELEMETRY_PATH}`,
    );
  });

  // `telemetry.localhost` resolves to nothing, so the local loop posts to the base.
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
});

describe("telemetryDisabled", () => {
  it.each(["true", "TRUE", " true "])("is opt-in via %j", (value) => {
    vi.stubEnv("TRUNK_DISABLE_TELEMETRY", value);
    expect(telemetryDisabled()).toBe(true);
  });

  it.each([undefined, "", "false", "yes", "1"])(
    "stays enabled for %j",
    (value) => {
      vi.stubEnv("TRUNK_DISABLE_TELEMETRY", value);
      expect(telemetryDisabled()).toBe(false);
    },
  );
});
