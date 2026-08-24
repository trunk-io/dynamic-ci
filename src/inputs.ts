import * as core from "@actions/core";
import { SIGNAL_TYPES } from "./schema/signals";

const KNOWN_SIGNALS = new Set<string>(SIGNAL_TYPES);

export interface ActionInputs {
  /** Trunk organization API token. Marked as a secret so it is never logged. */
  token: string;
  /** Jobs to scope the recommendation to; empty means the whole workflow. */
  jobNames: string[];
  /** Signal identifiers the caller wants excluded, forwarded to the service as given. */
  ignoreSignals: string[];
}

/**
 * Read the action inputs. `job-names` is a comma-separated list taken only from
 * the explicit input — the current job is never inferred from `GITHUB_JOB`,
 * since the action is often run as a fan-out/pre-job step before any job has
 * started. Empty means "recommend for the whole workflow". Both inputs are
 * split on commas only (not whitespace), since job names can contain spaces
 * (e.g. `Unit Tests`). `ignore-signals` is a comma-separated list of kebab-case
 * signal ids (e.g. `estimated-cost`) forwarded to the service verbatim: it owns
 * the signal list and is the only side that can authoritatively reject an id,
 * since new signals ship there before this vendored contract catches up. An id
 * this copy does not know is warned about and still sent, so a typo is inert
 * rather than failing the whole workflow open.
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
    .filter(Boolean);
  for (const signal of ignoreSignals.filter((id) => !KNOWN_SIGNALS.has(id))) {
    core.warning(
      `ignore-signals: "${signal}" is not a signal this action version knows about; forwarding it anyway.`,
    );
  }

  return { token, jobNames, ignoreSignals };
};
