import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getGlobalDispatcher,
  MockAgent,
  setGlobalDispatcher,
  type Dispatcher,
} from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fromApi,
  fromCheckout,
  resolveWorkflowFileSha,
} from "../workflow-file-sha";

const REPO = { host: "github.com", owner: "acme", name: "widgets" };
const GITHUB_API = "https://api.github.test";
const PATH = ".github/workflows/ci.yml";
const API_SHA = "51d537a714c0f1c8a4e92b13d5f0e6a7c2b9d8e1";

// @actions/github calls undici's own fetch, which msw cannot see, so GitHub is
// faked at undici's dispatcher instead.
let original: Dispatcher;
let github: MockAgent;
const contentsReturns = (status: number, body: unknown): void => {
  github
    .get(GITHUB_API)
    .intercept({
      path: /^\/repos\/acme\/widgets\/contents\/\.github%2Fworkflows%2Fci\.yml\?ref=/,
      method: "GET",
    })
    .reply(status, JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
};

beforeEach(() => {
  original = getGlobalDispatcher();
  github = new MockAgent();
  github.disableNetConnect();
  setGlobalDispatcher(github);
  vi.stubEnv("GITHUB_API_URL", GITHUB_API);
});
afterEach(async () => {
  setGlobalDispatcher(original);
  await github.close();
  vi.unstubAllEnvs();
});

/** A checkout with the workflow file committed, and git's own blob sha for it. */
const checkoutWithWorkflow = (): {
  dir: string;
  commit: string;
  blob: string;
} => {
  const dir = mkdtempSync(join(tmpdir(), "dci-sha-"));
  const git = (...args: readonly string[]): string =>
    execFileSync("git", [...args], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: dir,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();
  git("init", "--quiet", "--initial-branch=main");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, PATH), "on: push\njobs: {}\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "workflow");
  return {
    dir,
    commit: git("rev-parse", "HEAD"),
    blob: git("hash-object", PATH),
  };
};

describe("fromCheckout", () => {
  it("reads the file's blob sha at the commit, as git names it", async () => {
    const { dir, commit, blob } = checkoutWithWorkflow();
    expect(
      await fromCheckout({ commitSha: commit, path: PATH, cwd: dir }),
    ).toBe(blob);
  });

  it.each([
    {
      why: "a commit the checkout does not have",
      commit: "f".repeat(40),
      path: PATH,
    },
    {
      why: "a path that is not in the commit",
      commit: undefined,
      path: ".github/workflows/gone.yml",
    },
    {
      why: "a directory, which has a tree sha",
      commit: undefined,
      path: ".github/workflows",
    },
  ])("sends none for $why", async ({ commit, path }) => {
    const checkout = checkoutWithWorkflow();
    expect(
      await fromCheckout({
        commitSha: commit ?? checkout.commit,
        path,
        cwd: checkout.dir,
      }),
    ).toBeUndefined();
  });
});

describe("fromApi", () => {
  it("reads the blob sha from the contents API", async () => {
    contentsReturns(200, { type: "file", sha: API_SHA, path: PATH });
    expect(
      await fromApi({
        commitSha: "a".repeat(40),
        path: PATH,
        repo: REPO,
        githubToken: "t",
      }),
    ).toBe(API_SHA);
  });

  it.each([
    {
      why: "a 403 (a token without contents: read)",
      status: 403,
      body: { message: "Forbidden" },
    },
    {
      why: "a directory listing",
      status: 200,
      body: [{ type: "file", sha: API_SHA }],
    },
    {
      why: "a sha that is not a blob sha",
      status: 200,
      body: { type: "file", sha: "main" },
    },
  ])("sends none for $why", async ({ status, body }) => {
    contentsReturns(status, body);
    expect(
      await fromApi({
        commitSha: "a".repeat(40),
        path: PATH,
        repo: REPO,
        githubToken: "t",
      }),
    ).toBeUndefined();
  });

  it("makes no call without a token", async () => {
    expect(
      await fromApi({
        commitSha: "a".repeat(40),
        path: PATH,
        repo: REPO,
        githubToken: "",
      }),
    ).toBeUndefined();
  });
});

describe("resolveWorkflowFileSha", () => {
  it("uses the checkout and makes no API call when the commit is there", async () => {
    const { dir, commit, blob } = checkoutWithWorkflow();
    // disableNetConnect: an API call here would throw and send no sha.
    expect(
      await resolveWorkflowFileSha({
        commitSha: commit,
        path: PATH,
        repo: REPO,
        githubToken: "t",
        cwd: dir,
      }),
    ).toEqual({ sha: blob, source: "checkout" });
  });

  it("falls back to the contents API when the commit is not checked out", async () => {
    contentsReturns(200, { type: "file", sha: API_SHA, path: PATH });
    expect(
      await resolveWorkflowFileSha({
        commitSha: "a".repeat(40),
        path: PATH,
        repo: REPO,
        githubToken: "t",
        cwd: mkdtempSync(join(tmpdir(), "dci-nogit-")),
      }),
    ).toEqual({ sha: API_SHA, source: "api" });
  });

  it("sends none when neither can answer", async () => {
    contentsReturns(500, { message: "boom" });
    expect(
      await resolveWorkflowFileSha({
        commitSha: "a".repeat(40),
        path: PATH,
        repo: REPO,
        githubToken: "t",
        cwd: mkdtempSync(join(tmpdir(), "dci-nogit-")),
      }),
    ).toBeUndefined();
  });
});
