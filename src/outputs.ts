import * as core from "@actions/core";
import { warn } from "./annotations";
import type { DynamicCiResponse, Prune } from "./compat";

/** Set the per-job output under its job key. */
const setJobOutput = (jobKey: string, run: boolean): void => {
  core.setOutput(jobKey, run ? "true" : "false");
};

/**
 * The matrix outputs that leave a job's pruned legs out
 * (`<job>-exclude`, `<job>-matrix`, `<job>-include`), each set exactly as Trunk
 * built it. The customer wires the one their matrix shape needs; the others go
 * unused. Nothing is set when nothing is pruned, so `||` falls back to the
 * customer's own matrix.
 */
const PRUNE_OUTPUTS = [
  { field: "exclude", suffix: "-exclude", shape: "array" },
  { field: "matrix", suffix: "-matrix", shape: "object" },
  { field: "include", suffix: "-include", shape: "array" },
] as const satisfies readonly {
  field: keyof Prune;
  suffix: string;
  shape: "array" | "object";
}[];

/** Parsed only to check it, never re-encoded: the text is set as Trunk built it. */
const hasShape = (text: string, shape: "array" | "object"): boolean => {
  try {
    const value: unknown = JSON.parse(text);
    return shape === "array"
      ? Array.isArray(value)
      : typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
};

const setPruneOutputs = ({
  jobKey,
  prune,
  jobKeys,
}: {
  jobKey: string;
  prune: Prune;
  jobKeys: ReadonlySet<string>;
}): void => {
  for (const { field, suffix, shape } of PRUNE_OUTPUTS) {
    const text = prune[field];
    if (text === undefined) {
      continue;
    }
    const name = `${jobKey}${suffix}`;
    // Not set, so the matrix falls back to its `||` default and every leg runs.
    if (jobKeys.has(name)) {
      warn(
        `Not setting "${name}": a job has that key, and its own output would be overwritten. Every variation of "${jobKey}" runs.`,
      );
    } else if (!hasShape(text, shape)) {
      warn(
        `Not setting "${name}": Trunk returned a value that is not a JSON ${shape}. Every variation of "${jobKey}" runs.`,
      );
    } else {
      core.setOutput(name, text);
    }
  }
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
  const jobKeys = new Set([
    ...response.jobs.map((job) => job.jobKey),
    ...requestedJobKeys,
  ]);
  for (const job of response.jobs) {
    setJobOutput(job.jobKey, job.run);
    // A skipped job has no matrix to prune.
    if (job.run && job.prune !== undefined) {
      setPruneOutputs({ jobKey: job.jobKey, prune: job.prune, jobKeys });
    }
    decided.add(job.jobKey);
  }
  for (const jobKey of requestedJobKeys) {
    if (!decided.has(jobKey)) {
      warn(`No verdict returned for job "${jobKey}"; defaulting to run.`);
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
