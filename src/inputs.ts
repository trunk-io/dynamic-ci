import * as core from "@actions/core";
import { setAnnotationsEnabled, warn } from "./annotations";
import { SIGNAL_TYPES } from "./compat";

const KNOWN_SIGNALS = new Set<string>(SIGNAL_TYPES);

export interface ActionInputs {
  /** Trunk organization API token. Marked as a secret so it is never logged. */
  token: string;
  /** Job keys to scope the recommendation to; empty means the whole workflow. */
  jobKeys: string[];
  /** Signal identifiers the caller wants excluded, forwarded to the service as given. */
  ignoreSignals: string[];
  /** `github.action_ref` — the action's own version, for telemetry. */
  actionRef: string;
}

const splitList = (raw: string): string[] =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Arm the annotation gate. Read separately from `readInputs` because the
 * unexpected-error path needs it without the required `token` that `readInputs`
 * throws over, and not via `core.getBooleanInput` because that throws on any
 * non-YAML-boolean value, which would take the gate down over a cosmetic
 * setting.
 */
export const applyAnnotationSetting = (): void => {
  const raw = core.getInput("enable-annotation").trim().toLowerCase();
  setAnnotationsEnabled(raw === "true");
  if (raw !== "" && raw !== "false" && raw !== "true") {
    warn(
      `enable-annotation: "${raw}" is not "true" or "false"; treating it as false.`,
    );
  }
};

/**
 * Read the action inputs. `job-keys` is a comma-separated list of declarative
 * `jobs:` keys — the value `github.job` reports and an `if:` names, not the
 * rendered display name. It is taken only from the explicit input: the current
 * job is never inferred from `GITHUB_JOB`, since the action is often run as a
 * fan-out/pre-job step before any job has started. Empty means "recommend for
 * the whole workflow". `ignore-signals` is a comma-separated list of kebab-case
 * signal ids (e.g. `estimated-cost`) forwarded to the service verbatim: it owns
 * the signal list and is the only side that can authoritatively reject an id,
 * since new signals ship there before this vendored contract catches up. An id
 * this copy does not know is warned about and still sent, so a typo is inert
 * rather than failing the whole workflow open.
 */
export const readInputs = (): ActionInputs => {
  // First, so that every warning below is subject to it.
  applyAnnotationSetting();

  const token = core.getInput("token", { required: true });
  // Ensure the token is scrubbed from any log output.
  core.setSecret(token);

  const jobKeys = splitList(core.getInput("job-keys"));

  const ignoreSignals = splitList(core.getInput("ignore-signals"));
  for (const signal of ignoreSignals.filter((id) => !KNOWN_SIGNALS.has(id))) {
    warn(
      `ignore-signals: "${signal}" is not a signal this action version knows about; forwarding it anyway.`,
    );
  }

  return {
    token,
    jobKeys,
    ignoreSignals,
    actionRef: core.getInput("gh-action-ref"),
  };
};
