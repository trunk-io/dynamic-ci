import { describe, expect, it } from "vitest";
import { runJq } from "./support/jq";

const parse = (raw: string): unknown =>
  runJq({ program: "key-list.jq", input: null, args: ["--arg", "raw", raw] });

describe("key-list.jq", () => {
  it("splits a comma-separated list", () => {
    expect(parse("unit,e2e")).toEqual(["unit", "e2e"]);
  });

  it("trims whitespace and drops empties", () => {
    expect(parse(" unit , , e2e ,")).toEqual(["unit", "e2e"]);
  });

  // The unset case, and the one that must mean "no restriction".
  it("is an empty list when unset", () => {
    expect(parse("")).toEqual([]);
  });
});
