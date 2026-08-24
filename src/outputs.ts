import * as core from "@actions/core";
import type { DynamicCiResponse } from "./compat";

/**
 * Convert a job name to a GitHub Actions output key that is safe to reference as
 * `steps.<id>.outputs.<key>`. Lowercases, collapses every run of characters
 * outside `[a-z0-9]` to a single `-`, and trims leading/trailing `-`. So
 * `Unit Tests` → `unit-tests` and `build (ubuntu, 20)` → `build-ubuntu-20`.
 *
 * Job names that aren't already reference-safe (spaces, parens, slashes, commas
 * — common in matrix jobs) otherwise can't be referenced in `if:` conditionals.
 */
export const toOutputKey = (jobName: string): string =>
  jobName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Set the per-job output under its reference-safe key. */
const setJobOutput = (jobName: string, run: boolean): void => {
  core.setOutput(toOutputKey(jobName), run ? "true" : "false");
};

/**
 * Emit a flat per-job string output (reference-safe `<job-key>` →
 * `'true'`/`'false'`, see {@link toOutputKey}) for each verdict. Any requested
 * job missing from the response defaults to `'true'` (fail-safe).
 */
export const setOutputs = (
  response: DynamicCiResponse,
  requestedJobs: string[],
): void => {
  const decided = new Set<string>();
  for (const job of response.jobs) {
    setJobOutput(job.jobName, job.run);
    decided.add(toOutputKey(job.jobName));
  }
  for (const job of requestedJobs) {
    if (!decided.has(toOutputKey(job))) {
      core.warning(`No verdict returned for job "${job}"; defaulting to run.`);
      setJobOutput(job, true);
    }
  }
};

/**
 * Fail-open outputs: recommend running every job in scope. Used on API error,
 * non-2xx, timeout, or unexpected failure.
 */
export const setFailOpenOutputs = (jobs: string[]): void => {
  for (const job of jobs) {
    setJobOutput(job, true);
  }
};
