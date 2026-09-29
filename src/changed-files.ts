import { execFileSync } from "node:child_process";
import * as z from "zod";
import type { components } from "./schema/contract.js";
import type { Repo } from "./compat";

export type ChangedFiles = components["schemas"]["ChangedFiles"];
type ChangedFile = components["schemas"]["ChangedFile"];
type ChangedFileStatus = components["schemas"]["ChangedFileStatus"];

export const MAX_CHANGED_FILES = 200;
const API_PAGE_SIZE = 100;
const API_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 30_000;

export interface PullRequestDiff {
  number: number;
  baseSha: string;
  headSha: string;
  changedFiles?: number;
  additions?: number;
  deletions?: number;
}

export type ChangedFilesSource = "checkout" | "api";

export interface ResolvedChangedFiles {
  changedFiles: ChangedFiles;
  source: ChangedFilesSource;
}

const GIT_STATUS: Readonly<Record<string, ChangedFileStatus>> = {
  A: "added",
  M: "modified",
  D: "removed",
  R: "renamed",
  C: "copied",
  T: "modified",
};

const fields = (raw: string): string[] => {
  const parts = raw.split("\0");
  return parts.at(-1) === "" ? parts.slice(0, -1) : parts;
};

const lineCount = (raw: string | undefined): number => {
  if (raw === "-") {
    return 0;
  }
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`unreadable line count ${String(raw)}`);
  }
  return count;
};

// Throws rather than drop an entry: a short list reads as "these did not change".
export const parseGitDiff = (
  status: string,
  numstat: string,
  base: string,
): ChangedFiles => {
  const counts = new Map<string, { additions: number; deletions: number }>();
  const numstatFields = fields(numstat);
  for (let i = 0; i < numstatFields.length; ) {
    const [added, deleted, ...rest] = (numstatFields[i] ?? "").split("\t");
    const lines = {
      additions: lineCount(added),
      deletions: lineCount(deleted),
    };
    const path = rest.join("\t");
    if (path === "") {
      counts.set(numstatFields[i + 2] ?? "", lines);
      i += 3;
    } else {
      counts.set(path, lines);
      i += 1;
    }
  }

  const files: ChangedFile[] = [];
  const statusFields = fields(status);
  for (let i = 0; i < statusFields.length; ) {
    const code = (statusFields[i] ?? "").slice(0, 1);
    const moved = code === "R" || code === "C";
    const path = statusFields[i + (moved ? 2 : 1)] ?? "";
    const mapped = GIT_STATUS[code];
    const lines = counts.get(path);
    if (mapped === undefined || lines === undefined) {
      throw new Error(`cannot read the diff entry for ${path}`);
    }
    files.push({
      path,
      ...(moved ? { previousPath: statusFields[i + 1] ?? "" } : {}),
      status: mapped,
      ...lines,
    });
    i += moved ? 3 : 2;
  }
  if (files.length !== counts.size) {
    throw new Error("the name-status and numstat listings disagree");
  }

  const sorted = files.toSorted((a, b) =>
    a.path < b.path ? -1 : Number(a.path > b.path),
  );
  return {
    base,
    totalFiles: sorted.length,
    totalAdditions: sorted.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: sorted.reduce((sum, file) => sum + file.deletions, 0),
    files: sorted.slice(0, MAX_CHANGED_FILES),
  };
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  });

export const fromCheckout = (
  pr: PullRequestDiff,
  cwd: string,
): ChangedFiles | undefined => {
  try {
    git(cwd, ["merge-base", pr.baseSha, pr.headSha]);
    const range = `${pr.baseSha}...${pr.headSha}`;
    const flags = ["diff", "-z", "-M", "--no-ext-diff", "--no-textconv"];
    return parseGitDiff(
      git(cwd, [...flags, "--name-status", range]),
      git(cwd, [...flags, "--numstat", range]),
      pr.baseSha,
    );
  } catch {
    return undefined;
  }
};

const PULL_FILES_SCHEMA = z.array(
  z.object({
    filename: z.string(),
    status: z.enum([
      "added",
      "modified",
      "removed",
      "renamed",
      "copied",
      "changed",
      "unchanged",
    ]),
    additions: z.number(),
    deletions: z.number(),
    previous_filename: z.string().optional(),
  }),
);

// One page: the contract needs every file up to the cap, so bigger PRs go to the server.
export const fromApi = async (
  pr: PullRequestDiff,
  repo: Repo,
  githubToken: string,
): Promise<ChangedFiles | undefined> => {
  const { changedFiles: totalFiles, additions, deletions } = pr;
  if (
    githubToken === "" ||
    totalFiles === undefined ||
    additions === undefined ||
    deletions === undefined ||
    totalFiles > API_PAGE_SIZE
  ) {
    return undefined;
  }
  try {
    const apiUrl = process.env["GITHUB_API_URL"] ?? "https://api.github.com";
    const response = await fetch(
      `${apiUrl}/repos/${repo.owner}/${repo.name}/pulls/${String(pr.number)}/files?per_page=${String(API_PAGE_SIZE)}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return undefined;
    }
    const files = PULL_FILES_SCHEMA.parse(await response.json());
    if (files.length !== totalFiles) {
      return undefined;
    }
    return {
      base: pr.baseSha,
      totalFiles,
      totalAdditions: additions,
      totalDeletions: deletions,
      files: files.map((file) => ({
        path: file.filename,
        ...(file.previous_filename === undefined
          ? {}
          : { previousPath: file.previous_filename }),
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
    };
  } catch {
    return undefined;
  }
};

export const resolveChangedFiles = async ({
  pr,
  repo,
  githubToken,
  cwd,
}: {
  pr: PullRequestDiff;
  repo: Repo;
  githubToken: string;
  cwd: string;
}): Promise<ResolvedChangedFiles | undefined> => {
  const checkout = fromCheckout(pr, cwd);
  if (checkout !== undefined) {
    return { changedFiles: checkout, source: "checkout" };
  }
  const api = await fromApi(pr, repo, githubToken);
  return api === undefined ? undefined : { changedFiles: api, source: "api" };
};
