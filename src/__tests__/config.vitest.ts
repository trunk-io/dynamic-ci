import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_ADDRESS,
  DEFAULT_API_URL,
  DYNAMIC_CI_PATH,
  DEFAULT_TIMEOUT_MS,
  resolveApiUrl,
  resolveTimeoutMs,
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
