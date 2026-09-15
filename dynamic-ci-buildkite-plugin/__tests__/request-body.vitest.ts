import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA } from "../../src/schema/request";
import { PLUGIN_ROOT, vendoredJqPath } from "./support/jq";

/**
 * A Buildkite agent's environment, as `request-plan.sh` reads it. Built from
 * nothing rather than from `process.env` so the test cannot pass because the
 * machine running it happens to be in CI.
 */
const AGENT_ENV = {
  BUILDKITE_REPO: "git@github.com:trunk-io/trunk2.git",
  BUILDKITE_COMMIT: "9f2c1b7c2b4c9d1e0a3f5b6c7d8e9f0a1b2c3d4e",
  BUILDKITE_BRANCH: "feature/widget-cache",
  BUILDKITE_PULL_REQUEST: "4213",
  BUILDKITE_BUILD_ID: "01a0a151-99d4-4097-8806-a837f0830d9d",
  BUILDKITE_RETRY_COUNT: "0",
  BUILDKITE_BUILD_CREATOR: "octocat",
  BUILDKITE_SOURCE: "webhook",
  BUILDKITE_ORGANIZATION_SLUG: "trunk",
  BUILDKITE_PIPELINE_SLUG: "trunk2-pr",
} as const;

interface PrintBodyArgs {
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  jobKeys?: readonly string[];
}

/**
 * A repository with `main` and a feature branch one commit ahead, so the merge
 * base is `main`'s tip — what the script must resolve.
 */
const gitRepoWithBranch = (): { dir: string; mergeBase: string } => {
  const dir = mkdtempSync(join(tmpdir(), "dci-git-"));
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
    });

  git("init", "--quiet", "--initial-branch=main");
  git("commit", "--quiet", "--allow-empty", "-m", "base");
  const mergeBase = git("rev-parse", "HEAD").trim();
  git("checkout", "--quiet", "-b", "feature");
  git("commit", "--quiet", "--allow-empty", "-m", "ahead");

  return { dir, mergeBase };
};

/** A directory that is deliberately not a git repository, so `baseSha` is null. */
const nonGitDir = (): string => mkdtempSync(join(tmpdir(), "dci-nogit-"));

const printBody = ({
  env = {},
  cwd = nonGitDir(),
  jobKeys = ["unit", "e2e"],
}: PrintBodyArgs = {}): unknown => {
  const stdout = execFileSync(
    join(PLUGIN_ROOT, "lib/request-plan.sh"),
    ["--print-body", JSON.stringify(jobKeys)],
    {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        TRUNK_DCI_JQ: vendoredJqPath(),
        ...AGENT_ENV,
        ...env,
      },
    },
  );
  return JSON.parse(stdout);
};

describe("the plan request body", () => {
  // The point of `--print-body`: the body is hand-built in shell, but the check
  // that it matches the contract comes from the engine's own schema. A renamed
  // or mistyped field fails here rather than as a 400 in a customer's build.
  it("satisfies the engine's schema", () => {
    expect(() =>
      BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(printBody()),
    ).not.toThrow();
  });

  it("maps each field from the agent's environment", () => {
    const body = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(printBody());

    expect(body).toMatchObject({
      repo: { host: "github.com", owner: "trunk-io", name: "trunk2" },
      commitSha: AGENT_ENV.BUILDKITE_COMMIT,
      branch: "feature/widget-cache",
      prNumber: 4213,
      runId: AGENT_ENV.BUILDKITE_BUILD_ID,
      runAttempt: 1,
      triggeringActor: "octocat",
      eventName: "webhook",
      buildkiteOrganizationSlug: "trunk",
      buildkitePipelineSlug: "trunk2-pr",
      jobKeys: ["unit", "e2e"],
    });
  });

  // `BUILDKITE_RETRY_COUNT` counts from 0 and `runAttempt` from 1. Note what this
  // number means here: the retry count of the UPLOAD step, not a build attempt —
  // Buildkite has no build-level attempt, and a rebuild is a new build id.
  it("counts runAttempt from one", () => {
    const body = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      printBody({ env: { BUILDKITE_RETRY_COUNT: "2" } }),
    );

    expect(body.runAttempt).toBe(3);
  });

  // The sharp one: off a pull request Buildkite sets the literal string "false",
  // not an empty value, so a truthiness test would send prNumber 0 or "false".
  it("sends a null prNumber when the build is not a pull request", () => {
    const body = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      printBody({ env: { BUILDKITE_PULL_REQUEST: "false" } }),
    );

    expect(body.prNumber).toBeNull();
  });

  it("sends a null baseSha when there is no base branch to diff against", () => {
    const body = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(printBody());

    expect(body.baseSha).toBeNull();
  });

  // The only path that actually shells out to git. Worth a real repository: a
  // silently-empty `baseSha` costs the diff-derived signals on every build, and
  // nothing else in the plan would look wrong.
  it("resolves baseSha to the merge base of the PR's target branch", () => {
    const { dir, mergeBase } = gitRepoWithBranch();

    const body = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      printBody({
        cwd: dir,
        env: { BUILDKITE_PULL_REQUEST_BASE_BRANCH: "main" },
      }),
    );

    expect(body.baseSha).toBe(mergeBase);
  });

  it("omits the optional fields rather than sending them empty", () => {
    const body = printBody({
      env: { BUILDKITE_BUILD_CREATOR: "", BUILDKITE_SOURCE: "" },
    });

    expect(body).not.toHaveProperty("triggeringActor");
    expect(body).not.toHaveProperty("eventName");
  });

  it("splits ignore-signals and drops the empties", () => {
    const body = BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.parse(
      printBody({
        env: {
          BUILDKITE_PLUGIN_DYNAMIC_CI_IGNORE_SIGNALS:
            "estimated-cost, required-check,",
        },
      }),
    );

    expect(body.ignoreSignals).toEqual(["estimated-cost", "required-check"]);
  });

  // An unknown identifier is a 400 from the API, on purpose: a typo fails open
  // loudly rather than silently disabling nothing. So the body must carry it
  // through rather than filtering it out here.
  it("passes an unknown signal identifier through to be rejected", () => {
    const body = printBody({
      env: { BUILDKITE_PLUGIN_DYNAMIC_CI_IGNORE_SIGNALS: "not-a-signal" },
    });

    expect(BUILDKITE_DYNAMIC_CI_REQUEST_SCHEMA.safeParse(body).success).toBe(
      false,
    );
  });
});

// The repo row this request resolves against was created by CI ingestion from
// ITS parse of the same remote, so a disagreement here finds no repository and
// fails open invisibly. These are the forms ingestion's own parser was built
// against.
describe("the remote parse", () => {
  const repoFor = (remote: string): unknown => {
    const body = printBody({ env: { BUILDKITE_REPO: remote } });
    if (typeof body !== "object" || body === null || !("repo" in body)) {
      throw new Error("no repo in the body");
    }
    return body.repo;
  };

  const EXPECTED = {
    host: "github.com",
    owner: "trunk-io",
    name: "trunk2",
  } as const;

  it("reads an scp-style ssh remote", () => {
    expect(repoFor("git@github.com:trunk-io/trunk2.git")).toEqual(EXPECTED);
  });

  it("reads an https remote", () => {
    expect(repoFor("https://github.com/trunk-io/trunk2.git")).toEqual(EXPECTED);
  });

  it("reads an https remote with no .git suffix", () => {
    expect(repoFor("https://github.com/trunk-io/trunk2")).toEqual(EXPECTED);
  });

  // Takes the LAST `@`, which is the rule ingestion settled on: a token-bearing
  // remote is a real input, and the token itself may contain one.
  it("reads a token-bearing https remote", () => {
    expect(
      repoFor("https://x-access-token:ghs_abc@github.com/trunk-io/trunk2.git"),
    ).toEqual(EXPECTED);
  });

  it("strips a www. prefix, as ingestion does", () => {
    expect(repoFor("https://www.github.com/trunk-io/trunk2.git")).toEqual(
      EXPECTED,
    );
  });

  it("reads a non-GitHub host rather than assuming GitHub", () => {
    expect(repoFor("git@gitlab.com:acme/widgets.git")).toEqual({
      host: "gitlab.com",
      owner: "acme",
      name: "widgets",
    });
  });
});
