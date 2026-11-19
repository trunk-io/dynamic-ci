import * as core from "@actions/core";
import type { Repo } from "./compat";
import { githubClient } from "./github";
import { MAX_JOB_IDENTITY_LENGTH, type JobIdentity } from "./inputs";

const API_TIMEOUT_MS = 10_000;

/**
 * The name GitHub gave this job's check run (`<calling job> / <job>`), which is
 * the only thing that tells apart several jobs calling one reusable workflow.
 * Read with the workflow's own token, and only inside a called workflow, so a
 * top-level filter spends nothing. Any failure sends none: Trunk then reads the
 * keys as sent.
 */
export const resolveCheckRunName = async ({
  job,
  repo,
  githubToken,
}: {
  job: JobIdentity;
  repo: Repo;
  githubToken: string;
}): Promise<string | undefined> => {
  const workflowRef = process.env["GITHUB_WORKFLOW_REF"] ?? "";
  if (
    githubToken === "" ||
    job.checkRunId === undefined ||
    job.workflowRef === undefined ||
    job.workflowRef === workflowRef
  ) {
    return undefined;
  }
  try {
    const { data } = await githubClient(githubToken).rest.checks.get({
      owner: repo.owner,
      repo: repo.name,
      check_run_id: job.checkRunId,
      request: { signal: AbortSignal.timeout(API_TIMEOUT_MS) },
    });
    const name: unknown = data.name;
    return typeof name === "string" &&
      name !== "" &&
      name.length <= MAX_JOB_IDENTITY_LENGTH
      ? name
      : undefined;
  } catch (error) {
    core.debug(`Could not read this job's check run name: ${String(error)}`);
    return undefined;
  }
};
