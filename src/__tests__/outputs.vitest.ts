import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicCiResponse } from "../schema/response";

const setOutput = vi.fn();
const warning = vi.fn();

vi.mock("@actions/core", () => ({
  setOutput: (name: string, value: string) => setOutput(name, value),
  warning: (message: string) => warning(message),
}));

const { setFailOpenOutputs, setOutputs } = await import("../outputs");

beforeEach(() => {
  setOutput.mockClear();
  warning.mockClear();
});

const response: DynamicCiResponse = {
  jobs: [
    { jobName: "unit-tests", run: false, summary: "Skip", signals: [] },
    { jobName: "integration", run: true, summary: "Run", signals: [] },
  ],
};

describe("setOutputs", () => {
  it("emits flat per-job true/false strings", () => {
    setOutputs(response, ["unit-tests", "integration"]);
    expect(setOutput.mock.calls).toEqual([
      ["unit-tests", "false"],
      ["integration", "true"],
    ]);
  });

  it("defaults a requested job missing from the response to run=true", () => {
    setOutputs(response, ["unit-tests", "e2e"]);
    expect(setOutput.mock.calls).toEqual([
      ["unit-tests", "false"],
      ["integration", "true"],
      ["e2e", "true"],
    ]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("e2e"));
  });

  it("normalizes job names to reference-safe output keys", () => {
    setOutputs(
      {
        jobs: [
          {
            jobName: "build (ubuntu, 20)",
            run: false,
            summary: "Skip",
            signals: [],
          },
        ],
      },
      ["Unit Tests"],
    );
    expect(setOutput.mock.calls).toEqual([
      // verdict job: "build (ubuntu, 20)" -> "build-ubuntu-20"
      ["build-ubuntu-20", "false"],
      // missing requested job: "Unit Tests" -> "unit-tests", defaulted to run
      ["unit-tests", "true"],
    ]);
  });
});

describe("setFailOpenOutputs", () => {
  it("recommends run for every job in scope", () => {
    setFailOpenOutputs(["unit-tests", "integration"]);
    expect(setOutput.mock.calls).toEqual([
      ["unit-tests", "true"],
      ["integration", "true"],
    ]);
  });
});
