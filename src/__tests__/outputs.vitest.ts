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
    { jobKey: "unit-tests", run: false, summary: "Skip", signals: [] },
    { jobKey: "integration", run: true, summary: "Run", signals: [] },
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

  // The job key is already what an `if:` dereferences, so anything but a
  // verbatim passthrough would make the caller guess at a second spelling.
  it("names each output for its job key verbatim", () => {
    setOutputs(
      {
        jobs: [
          { jobKey: "build_Docs", run: false, summary: "Skip", signals: [] },
        ],
      },
      ["build_Docs", "e2e-chrome"],
    );
    expect(setOutput.mock.calls).toEqual([
      ["build_Docs", "false"],
      ["e2e-chrome", "true"],
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
