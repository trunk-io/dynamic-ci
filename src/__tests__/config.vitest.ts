import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_URL,
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

  it("appends the endpoint path to a configured base address", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "https://api.example.com");
    expect(resolveApiUrl()).toBe("https://api.example.com/v1/dynamic-ci");
  });

  it("does not double up the slash on a base address with a trailing slash", () => {
    vi.stubEnv("TRUNK_PUBLIC_API_ADDRESS", "https://api.example.com///");
    expect(resolveApiUrl()).toBe("https://api.example.com/v1/dynamic-ci");
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
