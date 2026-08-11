import * as core from "@actions/core";
import { SIGNAL_TYPE_SCHEMA, type SignalType } from "./schema/signals";

export interface ActionInputs {
  /** Trunk organization API token. Marked as a secret so it is never logged. */
  token: string;
  /** Jobs to scope the recommendation to; empty means the whole workflow. */
  jobNames: string[];
  /** Known signal identifiers the caller wants excluded. */
  ignoreSignals: SignalType[];
}

/**
 * Read the action inputs. `job-names` is a comma-separated list taken only from
 * the explicit input — the current job is never inferred from `GITHUB_JOB`,
 * since the action is often run as a fan-out/pre-job step before any job has
 * started. Empty means "recommend for the whole workflow". Both inputs are
 * split on commas only (not whitespace), since job names can contain spaces
 * (e.g. `Unit Tests`). `ignore-signals` is a comma-separated list of kebab-case
 * signal ids (e.g. `estimated-cost`); an unknown id throws here, which the
 * top-level handler turns into a fail-open run-everything.
 */
export const readInputs = (): ActionInputs => {
  const token = core.getInput("token", { required: true });
  // Ensure the token is scrubbed from any log output.
  core.setSecret(token);

  const jobNames = core
    .getInput("job-names")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  const ignoreSignals = core
    .getInput("ignore-signals")
    .split(",")
    .map((signal) => signal.trim())
    .filter(Boolean)
    .map((signal) => SIGNAL_TYPE_SCHEMA.parse(signal));

  return { token, jobNames, ignoreSignals };
};
