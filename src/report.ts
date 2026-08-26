import * as core from "@actions/core";
import type {
  DynamicCiResponse,
  JobVerdict,
  PublicSignalResult,
} from "./compat";

const ANNOTATION_TITLE = "Trunk Dynamic CI Filter";

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
 * Write the job summary as markdown: a compact at-a-glance verdict table, then
 * one collapsible `<details>` section per job holding its per-signal breakdown
 * so many jobs (fan-out mode) stay scannable. Skipped (logs only) when
 * `GITHUB_STEP_SUMMARY` is unavailable (e.g. tests).
 */
const writeSummary = async (jobs: JobVerdict[]): Promise<void> => {
  if (!process.env["GITHUB_STEP_SUMMARY"]) {
    return;
  }
  const markdown = [
    `## ${ANNOTATION_TITLE}`,
    "",
    overviewTable(jobs),
    "",
    // Blank line between each <details> so GitHub renders them all.
    jobs.map(jobDetails).join("\n\n"),
  ].join("\n");
  core.summary.addRaw(markdown).addEOL();
  await core.summary.write();
};

/** Log + annotate the recommendations served by the API. */
export const reportRecommendations = async (
  response: DynamicCiResponse,
): Promise<void> => {
  core.info(`${ANNOTATION_TITLE} recommendations:`);
  for (const job of response.jobs) {
    logVerdict(job);
    core.notice(`${job.jobKey}: ${verdictLabel(job.run)} — ${job.summary}`, {
      title: ANNOTATION_TITLE,
    });
  }
  await writeSummary(response.jobs);
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
