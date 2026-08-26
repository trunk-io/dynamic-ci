import * as core from "@actions/core";
import type { DynamicCiResponse } from "./compat";

/** Set the per-job output under its job key. */
const setJobOutput = (jobKey: string, run: boolean): void => {
  core.setOutput(jobKey, run ? "true" : "false");
};

/**
 * Emit a flat per-job string output (`<job-key>` → `'true'`/`'false'`) for each
 * verdict. Any requested job missing from the response defaults to `'true'`
 * (fail-safe).
 *
 * The output key is the job key verbatim. GitHub constrains a `jobs:` key to the
 * same character set an expression can dereference, so it is already usable as
 * `steps.<id>.outputs.<job-key>` — normalizing it here would only make the
 * caller guess at a second spelling of an identifier they already have.
 */
export const setOutputs = (
  response: DynamicCiResponse,
  requestedJobKeys: string[],
): void => {
  const decided = new Set<string>();
  for (const job of response.jobs) {
    setJobOutput(job.jobKey, job.run);
    decided.add(job.jobKey);
  }
  for (const jobKey of requestedJobKeys) {
    if (!decided.has(jobKey)) {
      core.warning(
        `No verdict returned for job "${jobKey}"; defaulting to run.`,
      );
      setJobOutput(jobKey, true);
    }
  }
};

/**
 * Fail-open outputs: recommend running every job in scope. Used on API error,
 * non-2xx, timeout, or unexpected failure.
 */
export const setFailOpenOutputs = (jobKeys: string[]): void => {
  for (const jobKey of jobKeys) {
    setJobOutput(jobKey, true);
  }
};
