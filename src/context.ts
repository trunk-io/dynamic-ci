import { readFileSync } from "node:fs";
import { warn } from "./annotations";
import type { DynamicCiRequest, Repo } from "./compat";
import * as z from "zod";
import type { ActionInputs } from "./inputs";
import {
  type ChangedFilesSource,
  type PullRequestDiff,
  resolveChangedFiles,
} from "./changed-files";

/** The subset of the GitHub event payload we read (unknown keys are stripped). */
const GitHubEventSchema = z.object({
  number: z.number().optional(),
  pull_request: z
    .object({
      number: z.number().optional(),
      changed_files: z.number().optional(),
      additions: z.number().optional(),
      deletions: z.number().optional(),
      base: z
        .object({ sha: z.string().optional(), ref: z.string().optional() })
        .optional(),
      head: z
        .object({ sha: z.string().optional(), ref: z.string().optional() })
        .optional(),
      labels: z.array(z.object({ name: z.string() })).optional(),
    })
    .optional(),
});
/**
 * The parsed event shape. Declared explicitly (rather than `z.infer`) so the
 * exported helpers that take it stay emittable under `isolatedDeclarations`; the
 * schema above is the runtime guard that replaces an unchecked `as` cast.
 */
interface GitHubEvent {
  number?: number;
  pull_request?: {
    number?: number;
    changed_files?: number;
    additions?: number;
    deletions?: number;
    base?: { sha?: string; ref?: string };
    head?: { sha?: string; ref?: string };
    labels?: { name: string }[];
  };
}

const readEvent = (): GitHubEvent => {
  const path = process.env["GITHUB_EVENT_PATH"];
  if (!path) {
    return {};
  }
  try {
    return GitHubEventSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    warn(`Could not read GITHUB_EVENT_PATH: ${String(error)}`);
    return {};
  }
};

/** Resolve repo host/owner/name from runner env (`GITHUB_REPOSITORY`, `GITHUB_SERVER_URL`). */
export const parseRepo = (): Repo => {
  const [owner = "", name = ""] = (
    process.env["GITHUB_REPOSITORY"] ?? ""
  ).split("/");
  let host = "github.com";
  try {
    host = new URL(process.env["GITHUB_SERVER_URL"] ?? "https://github.com")
      .host;
  } catch {
    // Keep the default host.
  }
  return { host, owner, name };
};

/** Prefer the PR head branch; fall back to the ref name for non-PR events. */
export const resolveBranch = (event: GitHubEvent): string =>
  process.env["GITHUB_HEAD_REF"] ||
  event.pull_request?.head?.ref ||
  process.env["GITHUB_REF_NAME"] ||
  "";

/**
 * The workflow file path from `GITHUB_WORKFLOW_REF`
 * (`{owner}/{repo}/{path}@{ref}`), e.g. `.github/workflows/ci.yml`. The service
 * matches it against the workflow it has ingested to enumerate that workflow's jobs.
 */
export const resolveWorkflowPath = (): string => {
  const withoutRef =
    (process.env["GITHUB_WORKFLOW_REF"] ?? "").split("@")[0] ?? "";
  const prefix = `${process.env["GITHUB_REPOSITORY"] ?? ""}/`;
  return withoutRef.startsWith(prefix)
    ? withoutRef.slice(prefix.length)
    : withoutRef;
};

/** Parse `GITHUB_RUN_ATTEMPT` (always ≥1 on a runner); default to 1. */
const resolveRunAttempt = (): number => {
  const attempt = Number.parseInt(process.env["GITHUB_RUN_ATTEMPT"] ?? "", 10);
  return Number.isFinite(attempt) && attempt > 0 ? attempt : 1;
};

const pullRequestDiff = (
  event: GitHubEvent,
  prNumber: number | null,
): PullRequestDiff | undefined => {
  const pr = event.pull_request;
  const baseSha = pr?.base?.sha;
  const headSha = pr?.head?.sha;
  if (pr === undefined || prNumber === null || !baseSha || !headSha) {
    return undefined;
  }
  return {
    number: prNumber,
    baseSha,
    headSha,
    ...(pr.changed_files === undefined
      ? {}
      : { changedFiles: pr.changed_files }),
    ...(pr.additions === undefined ? {} : { additions: pr.additions }),
    ...(pr.deletions === undefined ? {} : { deletions: pr.deletions }),
  };
};

export interface BuiltRequest {
  request: DynamicCiRequest;
  /** Absent when `changedFiles` was not sent and Trunk will fetch the diff. */
  changedFilesSource?: ChangedFilesSource;
}

/**
 * Assemble the request payload from action inputs plus the GitHub context
 * (env vars + event payload), and the changed files where they can be read.
 */
export const buildRequest = async (
  inputs: ActionInputs,
): Promise<BuiltRequest> => {
  const event = readEvent();
  const baseSha = event.pull_request?.base?.sha ?? null;
  const headSha =
    event.pull_request?.head?.sha || process.env["GITHUB_SHA"] || "";
  const prNumber = event.pull_request?.number ?? event.number ?? null;
  const repo = parseRepo();
  const pr = pullRequestDiff(event, prNumber);
  const resolved =
    pr === undefined
      ? undefined
      : await resolveChangedFiles({
          pr,
          repo,
          githubToken: inputs.githubToken,
          cwd: process.env["GITHUB_WORKSPACE"] || process.cwd(),
        });

  const request: DynamicCiRequest = {
    repo,
    commitSha: headSha,
    baseSha,
    branch: resolveBranch(event),
    prNumber,
    runId: process.env["GITHUB_RUN_ID"] ?? "",
    runAttempt: resolveRunAttempt(),
    ...(process.env["GITHUB_TRIGGERING_ACTOR"]
      ? { triggeringActor: process.env["GITHUB_TRIGGERING_ACTOR"] }
      : {}),
    ...(process.env["GITHUB_EVENT_NAME"]
      ? { eventName: process.env["GITHUB_EVENT_NAME"] }
      : {}),
    ...(event.pull_request?.labels === undefined
      ? {}
      : { prLabels: event.pull_request.labels.map(({ name }) => name) }),
    workflowPath: resolveWorkflowPath(),
    jobKeys: inputs.jobKeys,
    ...(inputs.ignoreSignals.length > 0
      ? { ignoreSignals: inputs.ignoreSignals }
      : {}),
    ...(resolved === undefined ? {} : { changedFiles: resolved.changedFiles }),
  };
  return resolved === undefined
    ? { request }
    : { request, changedFilesSource: resolved.source };
};
