import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Repo } from "./compat";
import { githubClient } from "./github";

const API_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 10_000;
const BLOB_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
// A symlink is a blob too (mode 120000), but its sha is the link's, not the file's.
const REGULAR_FILE_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);
// A workflow from another repository (an organization's required workflow) keeps
// that repository's prefix and is not in this one: looking it up only spends a call.
const WORKFLOW_DIRECTORY = ".github/workflows/";

export type WorkflowFileShaSource = "checkout" | "api";

export interface ResolvedWorkflowFileSha {
  sha: string;
  source: WorkflowFileShaSource;
}

const execFileAsync = promisify(execFile);

/**
 * The blob at `path` in `commitSha`, from `git ls-tree`: local, and only when the
 * commit is in the checkout. Not `rev-parse <commit>:<path>`, which answers a
 * directory with its tree sha.
 */
export const fromCheckout = async ({
  commitSha,
  path,
  cwd,
}: {
  commitSha: string;
  path: string;
  cwd: string;
}): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-tree", "-z", "--full-tree", commitSha, "--", path],
      { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS },
    );
    const entries = stdout.split("\0").filter((entry) => entry !== "");
    const [entry] = entries;
    if (entries.length !== 1 || entry === undefined) {
      return undefined;
    }
    // `<mode> SP <type> SP <sha> TAB <path>`
    const [meta = "", entryPath] = entry.split("\t");
    const [mode = "", type, sha = ""] = meta.split(" ");
    return REGULAR_FILE_MODES.has(mode) &&
      type === "blob" &&
      entryPath === path &&
      BLOB_SHA.test(sha)
      ? sha
      : undefined;
  } catch {
    return undefined;
  }
};

/** One contents-API read with the action's `github-token` (`contents: read`). */
export const fromApi = async ({
  commitSha,
  path,
  repo,
  githubToken,
}: {
  commitSha: string;
  path: string;
  repo: Repo;
  githubToken: string;
}): Promise<string | undefined> => {
  if (githubToken === "") {
    return undefined;
  }
  try {
    const octokit = githubClient(githubToken);
    const { data } = await octokit.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.name,
      path,
      ref: commitSha,
      request: { signal: AbortSignal.timeout(API_TIMEOUT_MS) },
    });
    // A directory answers with an array; only a file has the blob sha wanted.
    return !Array.isArray(data) &&
      data.type === "file" &&
      BLOB_SHA.test(data.sha)
      ? data.sha
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The git blob sha of the running workflow file, at the commit the run is on
 * (`GITHUB_SHA`: the merge commit for a pull request, which is the file GitHub
 * runs). Trunk builds a static matrix's prune outputs only from the parsed
 * version with exactly this sha, so a missing or different sha only means matrix
 * jobs run whole. Any failure sends none.
 */
export const resolveWorkflowFileSha = async ({
  commitSha,
  path,
  repo,
  githubToken,
  cwd,
}: {
  commitSha: string;
  path: string;
  repo: Repo;
  githubToken: string;
  cwd: string;
}): Promise<ResolvedWorkflowFileSha | undefined> => {
  if (commitSha === "" || !path.startsWith(WORKFLOW_DIRECTORY)) {
    return undefined;
  }
  const checkout = await fromCheckout({ commitSha, path, cwd });
  if (checkout !== undefined) {
    return { sha: checkout, source: "checkout" };
  }
  const api = await fromApi({ commitSha, path, repo, githubToken });
  return api === undefined ? undefined : { sha: api, source: "api" };
};
