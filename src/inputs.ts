import * as z from "zod";
import * as core from "@actions/core";
import { setAnnotationsEnabled, warn } from "./annotations";
import { SIGNAL_TYPES, type Impact } from "./compat";
import { buildMatrixRows, type MatrixRows } from "./matrices";

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
  /** Reads the pull request's files when the checkout cannot. Empty disables it. */
  githubToken: string;
  /** How much of the codebase the change affects, one entry per measure the caller's build tool computed. */
  impacts?: Impact[];
  /** Each runtime matrix job's rows, as the planner's text, from the `matrices` input. */
  matrices?: MatrixRows;
}

const MAX_IMPACT_COUNT = 10_000_000;
const MAX_IMPACTS = 8;

const IMPACT_ENTRY = z
  .strictObject({
    source: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9._-]{0,63}$/,
        "must be lowercase letters, digits, '.', '_' or '-', at most 64 characters",
      ),
    count: z.number().int().min(0).max(MAX_IMPACT_COUNT).optional(),
    all: z.boolean().optional(),
  })
  .refine(({ count, all }) => all === true || count !== undefined, {
    message: "needs a count unless all is true",
  });

const describeIssue = (error: z.ZodError): string =>
  error.issues
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.join(".")}: ${issue.message}`,
    )
    .join("; ");

/**
 * The `impacts` input, a JSON list of `{ source, count, all }`. An unreadable
 * input sends nothing, and an unreadable or repeated entry is dropped, each with
 * a warning rather than failing the step: without impacts the impact-reach
 * signal abstains, which leaves every verdict as it was.
 */
export const readImpacts = (): Impact[] | undefined => {
  const raw = core.getInput("impacts").trim();
  if (raw === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn("impacts: not valid JSON; sending no impacts.");
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    warn("impacts: not a JSON list; sending no impacts.");
    return undefined;
  }

  const impacts: Impact[] = [];
  parsed.forEach((item: unknown, index) => {
    const entry = IMPACT_ENTRY.safeParse(item);
    if (!entry.success) {
      warn(
        `impacts[${String(index)}]: ${describeIssue(entry.error)}; dropping it.`,
      );
      return;
    }
    const { source, count, all = false } = entry.data;
    if (impacts.some((impact) => impact.source === source)) {
      warn(`impacts: lists ${source} more than once; keeping the first.`);
      return;
    }
    if (impacts.length >= MAX_IMPACTS) {
      warn(
        `impacts: more than ${String(MAX_IMPACTS)} entries; dropping ${source}.`,
      );
      return;
    }
    impacts.push({ source, all, ...(count === undefined ? {} : { count }) });
  });
  return impacts.length === 0 ? undefined : impacts;
};

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

  const impacts = readImpacts();
  const matrices = buildMatrixRows(core.getInput("matrices"));

  return {
    token,
    jobKeys,
    ignoreSignals,
    actionRef: core.getInput("gh-action-ref"),
    githubToken: core.getInput("github-token"),
    ...(impacts === undefined ? {} : { impacts }),
    ...(matrices === undefined ? {} : { matrices }),
  };
};
