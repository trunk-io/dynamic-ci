import {
  getGlobalDispatcher,
  MockAgent,
  setGlobalDispatcher,
  type Dispatcher,
} from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCheckRunName } from "../check-run-name";
import type { JobIdentity } from "../inputs";

const REPO = { host: "github.com", owner: "acme", name: "widgets" };
const GITHUB_API = "https://api.github.test";
const CALLER_REF = "acme/widgets/.github/workflows/ci.yml@refs/heads/main";
const CALLED_JOB: JobIdentity = {
  workflowRef: "acme/widgets/.github/workflows/suite.yml@refs/heads/main",
  checkRunId: 77,
};

// @actions/github calls undici's own fetch, which msw cannot see, so GitHub is
// faked at undici's dispatcher instead.
let original: Dispatcher;
let github: MockAgent;
let reads = 0;
const checkRunReturns = (status: number, body: unknown): void => {
  github
    .get(GITHUB_API)
    .intercept({ path: "/repos/acme/widgets/check-runs/77", method: "GET" })
    .reply(() => {
      reads += 1;
      return {
        statusCode: status,
        data: JSON.stringify(body),
        responseOptions: { headers: { "content-type": "application/json" } },
      };
    });
};

beforeEach(() => {
  reads = 0;
  original = getGlobalDispatcher();
  github = new MockAgent();
  github.disableNetConnect();
  setGlobalDispatcher(github);
  vi.stubEnv("GITHUB_API_URL", GITHUB_API);
  vi.stubEnv("GITHUB_WORKFLOW_REF", CALLER_REF);
});
afterEach(async () => {
  setGlobalDispatcher(original);
  await github.close();
  vi.unstubAllEnvs();
});

const resolve = (job: JobIdentity = CALLED_JOB, githubToken = "gh-token") =>
  resolveCheckRunName({ job, repo: REPO, githubToken });

describe("resolveCheckRunName", () => {
  it("reads the check run's name inside a called workflow", async () => {
    checkRunReturns(200, { id: 77, name: "Lint Suite / filter" });

    expect({ name: await resolve(), reads }).toEqual({
      name: "Lint Suite / filter",
      reads: 1,
    });
  });

  it.each<{ name: string; job: JobIdentity; githubToken?: string }>([
    {
      name: "the filter is a top-level job",
      job: { ...CALLED_JOB, workflowRef: CALLER_REF },
    },
    {
      name: "GitHub left the job context empty",
      job: {},
    },
    {
      name: "there is no check run id",
      job: { workflowRef: CALLED_JOB.workflowRef },
    },
    { name: "there is no token", job: CALLED_JOB, githubToken: "" },
  ])("reads nothing when $name", async ({ job, githubToken }) => {
    checkRunReturns(200, { id: 77, name: "Lint Suite / filter" });

    expect({ name: await resolve(job, githubToken), reads }).toEqual({
      name: undefined,
      reads: 0,
    });
  });

  it.each([
    { name: "the token cannot read checks", status: 403, body: {} },
    { name: "the check run is gone", status: 404, body: {} },
    { name: "GitHub fails", status: 500, body: {} },
    { name: "the name is empty", status: 200, body: { id: 77, name: "" } },
    { name: "the body has no name", status: 200, body: { id: 77 } },
  ])("sends no name when $name", async ({ status, body }) => {
    checkRunReturns(status, body);

    expect(await resolve()).toBeUndefined();
  });
});
