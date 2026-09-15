import * as core from "@actions/core";
import type {
  DynamicCiResponse,
  JobVerdict,
  PublicSignalResult,
} from "./compat";

const ANNOTATION_TITLE = "Trunk Dynamic CI Filter";

/**
 * Whether to post annotations, from the `enable-annotation` input. Nothing else
 * about reporting depends on it: the log lines and the job summary are written
 * either way.
 */
export interface ReportOptions {
  annotate: boolean;
}

/**
 * A message that has no `core.info` line of its own, since `core.warning` both
 * logs and annotates. With annotations off it still has to reach the log, so it
 * degrades to a plain line rather than disappearing with the annotation.
 */
export const warnOrLog = (
  options: ReportOptions,
  message: string,
  title?: string,
): void => {
  if (options.annotate) {
    core.warning(message, { title });
    return;
  }
  core.info(message);
};

/**
 * An empty plan with no notice explaining it. Notices cover every expected
 * cause, so reaching this means something went wrong that the service could not
 * name — hence pointing at support rather than restating the fail-safe.
 */
const NO_VERDICTS_MESSAGE =
  "No per-job recommendations were returned. Please contact slack.trunk.io for support.";

const verdictLabel = (run: boolean): string => (run ? "RUN" : "SKIP");

/**
 * A signal's message for display. Ignored signals get an `(Ignored)` prefix.
 */
const signalMessage = (signal: PublicSignalResult): string =>
  signal.ignored ? `(Ignored) ${signal.message}` : signal.message;

/**
 * The signals worth showing: ABSTAIN results (a signal that does not apply to
 * the job, e.g. no force override exists) are pure noise in logs and the job
 * summary, so they are omitted everywhere the action renders signals.
 */
const displaySignals = (job: JobVerdict): PublicSignalResult[] =>
  job.signals.filter((signal) => signal.recommendation !== "ABSTAIN");

/** Glanceable verdict marker for the summary (logs stay plain text). */
const verdictBadge = (run: boolean): string => (run ? "✅ RUN" : "⏭️ SKIP");

/**
 * Per-job log line, keyed by the job key — which is both the output key and what
 * an `if:` conditional names, so a log line matches the
 * `steps.<id>.outputs.<job-key>` reference verbatim.
 */
const logVerdict = (job: JobVerdict): void => {
  core.info(`  ${job.jobKey}: ${verdictLabel(job.run)} — ${job.summary}`);
  for (const signal of displaySignals(job)) {
    core.info(
      `    - [${signal.recommendation}] ${signal.type}: ${signalMessage(signal)}`,
    );
  }
};

/** Escape a value for a single markdown table cell (pipes/newlines break rows). */
const escapeCell = (value: string): string =>
  value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** A single markdown table row, e.g. `| a | b | c |`. */
const mdRow = (cells: string[]): string => `| ${cells.join(" | ")} |`;

/** The at-a-glance verdict table: one row per job, with the engine's summary. */
const overviewTable = (jobs: JobVerdict[]): string =>
  [
    mdRow(["Job", "Verdict", "Summary"]),
    mdRow(["---", "---", "---"]),
    ...jobs.map((job) =>
      mdRow([
        escapeCell(job.jobKey),
        verdictBadge(job.run),
        escapeCell(job.summary),
      ]),
    ),
  ].join("\n");

/** A job's per-signal markdown table. */
const signalTable = (job: JobVerdict): string =>
  [
    mdRow(["Signal", "Recommendation", "Message"]),
    mdRow(["---", "---", "---"]),
    ...displaySignals(job).map((signal) =>
      mdRow([
        escapeCell(signal.type),
        signal.recommendation,
        escapeCell(signalMessage(signal)),
      ]),
    ),
  ].join("\n");

/**
 * A collapsible section per job. The blank lines around the table are required:
 * GitHub only renders markdown inside `<details>` when the content is separated
 * from the `<summary>` (and surrounded) by blank lines.
 */
const jobDetails = (job: JobVerdict): string =>
  [
    "<details>",
    `<summary>${job.jobKey} → ${verdictBadge(job.run)}</summary>`,
    "",
    `_${escapeCell(job.summary)}_`,
    "",
    signalTable(job),
    "",
    "</details>",
  ].join("\n");

/**
 * The verdict tables, or a plain statement that there are none. A notice already
 * states the consequence, so repeating the generic line beneath it would say the
 * same thing twice.
 */
const summaryBody = (response: DynamicCiResponse): string[] => {
  if (response.jobs.length === 0) {
    return response.notice ? [] : [NO_VERDICTS_MESSAGE];
  }
  return [
    overviewTable(response.jobs),
    "",
    // Blank line between each <details> so GitHub renders them all.
    response.jobs.map(jobDetails).join("\n\n"),
  ];
};

/**
 * Write the job summary as markdown: the plan-level notice if there is one, then
 * a compact at-a-glance verdict table and one collapsible `<details>` section per
 * job holding its per-signal breakdown, so many jobs (fan-out mode) stay
 * scannable. Skipped (logs only) when `GITHUB_STEP_SUMMARY` is unavailable
 * (e.g. tests).
 */
const writeSummary = async (response: DynamicCiResponse): Promise<void> => {
  if (!process.env["GITHUB_STEP_SUMMARY"]) {
    return;
  }
  const markdown = [
    `## ${ANNOTATION_TITLE}`,
    "",
    ...(response.notice
      ? [`> ${escapeCell(response.notice.message)}`, ""]
      : []),
    ...summaryBody(response),
  ].join("\n");
  core.summary.addRaw(markdown).addEOL();
  await core.summary.write();
};

/**
 * The plan-level condition, when the service reports one. A warning rather than
 * an info line: these plans are green and empty, and only a warning reaches the
 * run's annotation list — which is also why it is the info line it was competing
 * with once annotations are off.
 */
const reportPlanNotice = (
  response: DynamicCiResponse,
  options: ReportOptions,
): void => {
  if (response.notice) {
    warnOrLog(
      options,
      `${response.notice.message} [${response.notice.code}]`,
      ANNOTATION_TITLE,
    );
    return;
  }
  if (response.jobs.length === 0) {
    warnOrLog(options, NO_VERDICTS_MESSAGE, ANNOTATION_TITLE);
  }
};

/** Log + (when annotations are on) annotate the recommendations served by the API. */
export const reportRecommendations = async (
  response: DynamicCiResponse,
  options: ReportOptions,
): Promise<void> => {
  reportPlanNotice(response, options);

  // Guarded: an unconditional heading over zero verdicts is the bare
  // `recommendations:` line that started all this.
  if (response.jobs.length > 0) {
    core.info(`${ANNOTATION_TITLE} recommendations:`);
    for (const job of response.jobs) {
      logVerdict(job);
      // Dropped outright rather than degraded: `logVerdict` already printed it.
      if (options.annotate) {
        core.notice(
          `${job.jobKey}: ${verdictLabel(job.run)} — ${job.summary}`,
          {
            title: ANNOTATION_TITLE,
          },
        );
      }
    }
  }

  await writeSummary(response);
};

/** Log + (when annotations are on) annotate that the action failed open. */
export const reportFailOpen = async (
  jobKeys: string[],
  reason: string,
  options: ReportOptions,
): Promise<void> => {
  warnOrLog(
    options,
    `${ANNOTATION_TITLE} failed open — recommending RUN for ${jobKeys.join(", ") || "all jobs in scope"}: ${reason}`,
    `${ANNOTATION_TITLE} (fail-open)`,
  );
  if (!process.env["GITHUB_STEP_SUMMARY"]) {
    return;
  }
  core.summary.addHeading(`${ANNOTATION_TITLE} — fail-open`, 2);
  core.summary.addRaw(
    `Recommending **RUN** for all jobs in scope (${jobKeys.join(", ") || "unknown"}).`,
  );
  core.summary.addBreak();
  core.summary.addRaw(`Reason: ${reason}`);
  await core.summary.write();
};
