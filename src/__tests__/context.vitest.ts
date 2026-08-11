import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRequest, resolveWorkflowPath } from "../context";

afterEach(() => {
  vi.unstubAllEnvs();
});

const ENV = {
  repository: "trunk-io/trunk",
  workflowPath: ".github/workflows/ci.yml",
  workflowName: "CI",
  runId: "7890123456",
  runAttempt: 2,
  sha: "abc123",
  refName: "feature/x",
} as const;

const stubRunnerEnv = (): void => {
  vi.stubEnv("GITHUB_REPOSITORY", ENV.repository);
  vi.stubEnv(
    "GITHUB_WORKFLOW_REF",
    `${ENV.repository}/${ENV.workflowPath}@refs/heads/main`,
  );
  vi.stubEnv("GITHUB_WORKFLOW", ENV.workflowName);
  vi.stubEnv("GITHUB_RUN_ID", ENV.runId);
  vi.stubEnv("GITHUB_RUN_ATTEMPT", String(ENV.runAttempt));
  vi.stubEnv("GITHUB_SHA", ENV.sha);
  vi.stubEnv("GITHUB_REF_NAME", ENV.refName);
  // No event payload → non-PR shape (base/pr null).
  vi.stubEnv("GITHUB_EVENT_PATH", "");
};

describe("resolveWorkflowPath", () => {
  it("strips the owner/repo prefix and @ref suffix", () => {
    stubRunnerEnv();
    expect(resolveWorkflowPath()).toBe(ENV.workflowPath);
  });
});

describe("buildRequest", () => {
  it("populates workflow + run identity from the runner env", () => {
    stubRunnerEnv();
    const request = buildRequest({
      token: "t",
      jobNames: ["build"],
      ignoreSignals: [],
    });
    expect(request).toMatchObject({
      commitSha: ENV.sha,
      baseSha: null,
      prNumber: null,
      runId: ENV.runId,
      runAttempt: ENV.runAttempt,
      workflowPath: ENV.workflowPath,
      workflowName: ENV.workflowName,
      jobNames: ["build"],
    });
  });
});
