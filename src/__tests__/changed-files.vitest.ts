import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse, type JsonBodyType } from "msw";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer } from "./__fixtures__/msw";
import {
  fromApi,
  fromCheckout,
  parseGitDiff,
  type PullRequestDiff,
  resolveChangedFiles,
} from "../changed-files";

const REPO = { host: "github.com", owner: "acme", name: "widgets" };
const FILES_URL = "https://api.github.test/repos/acme/widgets/pulls/7/files";

let pullFiles: JsonBodyType = [];
let pullFilesStatus = 200;
const server = createServer([
  () =>
    http.get(FILES_URL, () =>
      HttpResponse.json(pullFiles, { status: pullFilesStatus }),
    ),
]);

beforeAll(() => {
  server.start();
});
afterEach(() => {
  server.reset();
  pullFiles = [];
  pullFilesStatus = 200;
  vi.unstubAllEnvs();
});
afterAll(() => {
  server.close();
});

/** `main` with three files, and a branch that edits, renames, deletes and adds. */
const repoWithChanges = (
  extra = 0,
): { dir: string; base: string; head: string } => {
  const dir = mkdtempSync(join(tmpdir(), "dci-diff-"));
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
  const write = (path: string, content: string): void => {
    writeFileSync(join(dir, path), content);
  };
  const numbers = (count: number): string =>
    `${Array.from({ length: count }, (_u, i) => i).join("\n")}\n`;

  git("init", "--quiet", "--initial-branch=main");
  write("keep.txt", "a\nb\nc\n");
  write("old.txt", numbers(20));
  write("gone.txt", "x\ny\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD");

  git("checkout", "--quiet", "-b", "feature");
  write("keep.txt", "a\nB\nc\nd\n");
  git("mv", "old.txt", "new.txt");
  write("new.txt", numbers(21));
  git("rm", "--quiet", "gone.txt");
  write("added with space.txt", "1\n2\n");
  mkdirSync(join(dir, "many"));
  for (let i = 0; i < extra; i += 1) {
    write(join("many", `f${String(i).padStart(4, "0")}.txt`), "1\n");
  }
  git("add", ".");
  git("commit", "--quiet", "-m", "change");

  return { dir, base, head: git("rev-parse", "HEAD") };
};

const pr = (overrides: Partial<PullRequestDiff> = {}): PullRequestDiff => ({
  number: 7,
  baseSha: "b".repeat(40),
  headSha: "h".repeat(40),
  changedFiles: 2,
  additions: 5,
  deletions: 1,
  ...overrides,
});

describe("from the checkout", () => {
  it("lists every change against the merge base, renames included", () => {
    const { dir, base, head } = repoWithChanges();

    expect(fromCheckout(pr({ baseSha: base, headSha: head }), dir)).toEqual({
      base,
      totalFiles: 4,
      totalAdditions: 5,
      totalDeletions: 3,
      files: [
        {
          path: "added with space.txt",
          status: "added",
          additions: 2,
          deletions: 0,
        },
        { path: "gone.txt", status: "removed", additions: 0, deletions: 2 },
        { path: "keep.txt", status: "modified", additions: 2, deletions: 1 },
        {
          path: "new.txt",
          previousPath: "old.txt",
          status: "renamed",
          additions: 1,
          deletions: 0,
        },
      ],
    });
  });

  it("caps the list at 200 and keeps the totals over every file", () => {
    const { dir, base, head } = repoWithChanges(250);
    const diff = fromCheckout(pr({ baseSha: base, headSha: head }), dir);

    expect(diff).toMatchObject({
      totalFiles: 254,
      totalAdditions: 255,
      totalDeletions: 3,
    });
    expect(diff?.files).toHaveLength(200);
  });

  // The default depth-1 checkout: the head is there, the base is not.
  it("is undefined when a commit is missing", () => {
    const { dir, head } = repoWithChanges();

    expect(fromCheckout(pr({ headSha: head }), dir)).toBeUndefined();
  });

  it("is undefined outside a git repository", () => {
    expect(
      fromCheckout(pr(), mkdtempSync(join(tmpdir(), "dci-nogit-"))),
    ).toBeUndefined();
  });

  it("refuses listings that disagree rather than dropping a file", () => {
    expect(() =>
      parseGitDiff("M\0a.ts\0M\0b.ts\0", "1\t0\ta.ts\0", "base"),
    ).toThrow();
  });
});

describe("from the API", () => {
  const apiFile = (i: number) => ({
    filename: `src/f${String(i)}.ts`,
    status: "modified",
    additions: 2,
    deletions: 1,
    changes: 3,
  });

  const fetchFiles = (overrides: Partial<PullRequestDiff> = {}) => {
    vi.stubEnv("GITHUB_API_URL", "https://api.github.test");
    return fromApi(pr(overrides), REPO, "gh-token");
  };

  it("maps one page of pull request files onto the contract", async () => {
    pullFiles = [
      apiFile(0),
      {
        filename: "src/new.ts",
        previous_filename: "src/old.ts",
        status: "renamed",
        additions: 3,
        deletions: 0,
        changes: 3,
      },
    ];

    expect(await fetchFiles()).toEqual({
      base: "b".repeat(40),
      totalFiles: 2,
      totalAdditions: 5,
      totalDeletions: 1,
      files: [
        { path: "src/f0.ts", status: "modified", additions: 2, deletions: 1 },
        {
          path: "src/new.ts",
          previousPath: "src/old.ts",
          status: "renamed",
          additions: 3,
          deletions: 0,
        },
      ],
    });
  });

  // One page cannot hold every file the contract requires, so no request is
  // made at all; msw would fail the test on an unhandled one.
  it("leaves a pull request of more than 100 files to the server", async () => {
    expect(await fetchFiles({ changedFiles: 101 })).toBeUndefined();
  });

  it.each([
    ["the token lacks pull-requests: read", () => (pullFilesStatus = 403)],
    [
      "the page disagrees with the event's count",
      () => (pullFiles = [apiFile(0)]),
    ],
    [
      "a status the contract does not know",
      () => (pullFiles = [{ ...apiFile(0), status: "mystery" }, apiFile(1)]),
    ],
  ])("is undefined when %s", async (_name, arrange) => {
    arrange();

    expect(await fetchFiles()).toBeUndefined();
  });

  it("is undefined without a token", async () => {
    expect(await fromApi(pr(), REPO, "")).toBeUndefined();
  });
});

describe("the resolver", () => {
  it("prefers the checkout", async () => {
    const { dir, base, head } = repoWithChanges();

    expect(
      await resolveChangedFiles({
        pr: pr({ baseSha: base, headSha: head }),
        repo: REPO,
        githubToken: "gh-token",
        cwd: dir,
      }),
    ).toMatchObject({ source: "checkout", changedFiles: { totalFiles: 4 } });
  });

  it("falls back to the API", async () => {
    vi.stubEnv("GITHUB_API_URL", "https://api.github.test");
    pullFiles = [
      { filename: "a.ts", status: "added", additions: 5, deletions: 0 },
      { filename: "b.ts", status: "removed", additions: 0, deletions: 1 },
    ];

    expect(
      await resolveChangedFiles({
        pr: pr(),
        repo: REPO,
        githubToken: "gh-token",
        cwd: mkdtempSync(join(tmpdir(), "dci-nogit-")),
      }),
    ).toMatchObject({ source: "api", changedFiles: { totalFiles: 2 } });
  });

  // An empty list would read as "nothing changed"; the omitted field sends the
  // server to GitHub instead.
  it("is undefined, never an empty list, when neither can answer", async () => {
    vi.stubEnv("GITHUB_API_URL", "https://api.github.test");
    pullFilesStatus = 403;

    expect(
      await resolveChangedFiles({
        pr: pr(),
        repo: REPO,
        githubToken: "gh-token",
        cwd: mkdtempSync(join(tmpdir(), "dci-nogit-")),
      }),
    ).toBeUndefined();
  });
});
