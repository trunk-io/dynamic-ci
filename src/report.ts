import * as core from "@actions/core";
import type {
  DynamicCiResponse,
  JobVerdict,
  PublicSignalResult,
} from "./compat";

const ANNOTATION_TITLE = "Trunk Dynamic CI Filter";

/**
 * The residual empty plan: no verdicts and no notice explaining why. Reachable
 * from a service too old to send a notice, or one that scored nothing at all.
 */
const NO_VERDICTS_MESSAGE =
  "No per-job recommendations were returned, so every job in this workflow will run. This is the documented fail-safe, not a failure.";

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
      ? [
          `> **${response.notice.code}** — ${escapeCell(response.notice.message)}`,
          "",
        ]
      : []),
    ...summaryBody(response),
  ].join("\n");
  core.summary.addRaw(markdown).addEOL();
  await core.summary.write();
};

/**
 * The plan-level condition, when the service reports one.
 *
 * A warning rather than an info line, because every condition that carries a
 * notice answers with a run-everything plan — which in fan-out mode is an empty
 * `jobs` — and a green step whose only evidence is an absence is precisely what
 * made this report unreadable before. `core.warning` reaches the run's
 * annotation list; `core.info` reaches only the step log.
 */
const reportPlanNotice = (response: DynamicCiResponse): void => {
  if (response.notice) {
    core.warning(`${response.notice.message} [${response.notice.code}]`, {
      title: ANNOTATION_TITLE,
    });
    return;
  }
  if (response.jobs.length === 0) {
    core.warning(NO_VERDICTS_MESSAGE, { title: ANNOTATION_TITLE });
  }
};

/** Log + annotate the recommendations served by the API. */
export const reportRecommendations = async (
  response: DynamicCiResponse,
): Promise<void> => {
  reportPlanNotice(response);

  // Guarded: an unconditional heading over zero verdicts is the bare
  // `recommendations:` line that started all this.
  if (response.jobs.length > 0) {
    core.info(`${ANNOTATION_TITLE} recommendations:`);
    for (const job of response.jobs) {
      logVerdict(job);
      core.notice(`${job.jobKey}: ${verdictLabel(job.run)} — ${job.summary}`, {
        title: ANNOTATION_TITLE,
      });
    }
  }

  await writeSummary(response);
};

/** Log + annotate that the action failed open (recommending RUN for all jobs). */
export const reportFailOpen = async (
  jobKeys: string[],
  reason: string,
): Promise<void> => {
  core.warning(
    `${ANNOTATION_TITLE} failed open — recommending RUN for ${jobKeys.join(", ") || "all jobs in scope"}: ${reason}`,
    { title: `${ANNOTATION_TITLE} (fail-open)` },
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
