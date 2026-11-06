import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicCiResponse } from "../compat";

const setOutput = vi.fn();
const warning = vi.fn();
const info = vi.fn();

vi.mock("@actions/core", () => ({
  setOutput: (name: string, value: string) => setOutput(name, value),
  warning: (message: string) => warning(message),
  info: (message: string) => info(message),
}));

const { setAnnotationsEnabled } = await import("../annotations");
const { setFailOpenOutputs, setOutputs } = await import("../outputs");

beforeEach(() => {
  setAnnotationsEnabled(true);
  setOutput.mockClear();
  warning.mockClear();
  info.mockClear();
});

const response: DynamicCiResponse = {
  jobs: [
    { jobKey: "unit-tests", run: false, summary: "Skip", signals: [] },
    { jobKey: "integration", run: true, summary: "Run", signals: [] },
  ],
};

describe("setOutputs", () => {
  // Each output is set as Trunk built it: `3.10` and the big integer must
  // survive byte for byte, or a leg is renamed or the job fails.
  it("sets each prune output under the job's key, unchanged", () => {
    const prune = {
      exclude: '[{"os":"macos","python":3.10,"n":12345678901234567890}]',
      matrix: '{"include":[{"suite":"apps","shard":""}]}',
      include: '[{"suite":"apps","shard":""}]',
    };
    setOutputs(
      {
        jobs: [
          {
            jobKey: "unit-tests",
            run: true,
            summary: "Run",
            signals: [],
            prune,
          },
        ],
      },
      ["unit-tests"],
    );
    expect(setOutput.mock.calls).toEqual([
      ["unit-tests", "true"],
      ["unit-tests-exclude", prune.exclude],
      ["unit-tests-matrix", prune.matrix],
      ["unit-tests-include", prune.include],
    ]);
  });

  it("sets only the prune outputs Trunk sent", () => {
    setOutputs(
      {
        jobs: [
          {
            jobKey: "test",
            run: true,
            summary: "Run",
            signals: [],
            prune: { exclude: '[{"os":"macos"}]' },
          },
        ],
      },
      ["test"],
    );
    expect(setOutput.mock.calls).toEqual([
      ["test", "true"],
      ["test-exclude", '[{"os":"macos"}]'],
    ]);
  });

  it("sets no prune output for a job that is skipped, even if Trunk sent one", () => {
    setOutputs(
      {
        jobs: [
          {
            jobKey: "test",
            run: false,
            summary: "Skip",
            signals: [],
            prune: { exclude: '[{"os":"macos"}]' },
          },
        ],
      },
      ["test"],
    );
    expect(setOutput.mock.calls).toEqual([["test", "false"]]);
  });

  // `test-matrix` is both `test`'s prune output and a job's own output; setting
  // both would leave one of them wrong.
  it("does not set a prune output whose name is a job's key, and says so", () => {
    setOutputs(
      {
        jobs: [
          {
            jobKey: "test",
            run: true,
            summary: "Run",
            signals: [],
            prune: { matrix: '{"include":[{"os":"linux"}]}' },
          },
          { jobKey: "test-matrix", run: false, summary: "Skip", signals: [] },
        ],
      },
      ["test", "test-matrix"],
    );
    expect({
      outputs: setOutput.mock.calls,
      warnings: warning.mock.calls,
    }).toEqual({
      outputs: [
        ["test", "true"],
        ["test-matrix", "false"],
      ],
      warnings: [[expect.stringContaining('Not setting "test-matrix"')]],
    });
  });

  it.each([
    { why: "is not JSON", prune: { exclude: '[{"os":' } },
    {
      why: "is an object where an array goes",
      prune: { exclude: '{"os":"macos"}' },
    },
    { why: "is an array where an object goes", prune: { matrix: "[]" } },
    { why: "is null", prune: { include: "null" } },
  ])(
    "drops a prune output that $why, so the matrix falls back to its default",
    ({ prune }) => {
      setOutputs(
        {
          jobs: [
            { jobKey: "test", run: true, summary: "Run", signals: [], prune },
          ],
        },
        ["test"],
      );
      expect({
        outputs: setOutput.mock.calls,
        warnings: warning.mock.calls.length,
      }).toEqual({
        outputs: [["test", "true"]],
        warnings: 1,
      });
    },
  );

  it("sets no prune output when every leg is skipped, so the job's if: skips it", () => {
    setOutputs(
      {
        jobs: [
          {
            jobKey: "test",
            run: false,
            summary: "Skip",
            signals: [],
            variations: [
              { match: { os: "linux" }, run: false, summary: "Skip" },
            ],
          },
        ],
      },
      ["test"],
    );
    expect(setOutput.mock.calls).toEqual([["test", "false"]]);
  });

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

  // The regression: this one escaped the `enable-annotation` gate, so it
  // annotated on the default path.
  it("logs the missing verdict without annotating it when annotations are off", () => {
    setAnnotationsEnabled(false);
    setOutputs(response, ["unit-tests", "e2e"]);
    expect(warning).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("e2e"));
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
