// The matrix smoke test's three moving parts, one subcommand each:
//
//   node smoke.ts planner              emit each runtime fixture's rows, as a workflow's planner job would
//   node smoke.ts simulate [example]   emit the per-leg pruning outputs the action will emit, from the answer key
//   node smoke.ts verdict [example]    compare the check runs GitHub created against the answer key
//
// With no example, the answer key is fixtures.ts and the workflow is
// matrix-smoke.yaml. With one, it is examples/<example>.ts and the workflow is
// matrix-example-<example>.yaml.
//
// The verdict is agnostic about where the pruning came from. It reads the filter
// job's outputs, works out which legs they meant to prune, and checks GitHub
// honored exactly that — so it asserts the same thing whether the outputs came
// from `simulate` or from the real action against staging (`mode: live`).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { FIXTURES, RUNTIME_KEYS, rowsOf } from "./fixtures.ts";
import type { Fixture, Leg, Row, Value } from "./fixtures.ts";

const OUT = "matrix-smoke-out";

// Matrix values are compared loosely: scalars by their string form, objects and
// arrays structurally.
const looseEqual = (a: Value | undefined, b: Value | undefined): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => looseEqual(item, b[i]))
    );
  }
  if (isObject(a) || isObject(b)) {
    return isObject(a) && isObject(b) && sameRow(a, b);
  }
  return a !== undefined && b !== undefined && String(a) === String(b);
};

const isObject = (v: Value | undefined): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const sameRow = (a: Row, b: Row): boolean => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => looseEqual(a[k], b[k]))
  );
};

/** A leg matches a `match` (or a GitHub exclude entry) when it carries every value in it. */
const carries = (values: Row, match: Row): boolean =>
  Object.entries(match).every(([dim, value]) => looseEqual(values[dim], value));

const sortedJson = (v: Value): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    isObject(val as Value)
      ? Object.fromEntries(
          Object.entries(val as Row).sort(([x], [y]) => x.localeCompare(y)),
        )
      : val,
  );

/** Every value as a string, objects as key-sorted JSON: values a service stored as text. */
const stringified = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      typeof v === "object" && v !== null ? sortedJson(v) : String(v),
    ]),
  );

const writeOutputs = (outputs: Record<string, string>): void => {
  const file = process.env["GITHUB_OUTPUT"];
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`);
  for (const line of lines) process.stdout.write(line);
  if (file) appendFileSync(file, lines.join(""));
};

// ---------------------------------------------------------------------------
// planner
// ---------------------------------------------------------------------------
const planner = (): void => {
  const outputs: Record<string, string> = {};
  for (const fixture of FIXTURES.filter((f) => RUNTIME_KEYS.includes(f.key))) {
    const rows = rowsOf(fixture);
    outputs[`${fixture.key}-rows`] = JSON.stringify(rows);
    outputs[`${fixture.key}-matrix`] = JSON.stringify({ include: rows });
  }
  writeOutputs(outputs);
};

// ---------------------------------------------------------------------------
// simulate: the action's per-leg pruning outputs, fed from fixtures.ts instead of a plan
// ---------------------------------------------------------------------------
/** The filter outputs simulate mode emits for one fixture. */
const simulatedOutputs = (fixture: Fixture): Record<string, string> => {
  const outputs: Record<string, string> = {};
  const { prune } = fixture;
  const pruned =
    prune === undefined
      ? []
      : fixture.legs.filter(
          (leg) => prune === "all" || prune.some((m) => carries(leg.values, m)),
        );
  const kept = fixture.legs.filter((leg) => !pruned.includes(leg));
  // Fan-out mode sets a verdict for every job it knows; every leg pruned is a skip.
  outputs[fixture.key] = kept.length > 0 ? "true" : "false";
  if (pruned.length === 0) return outputs; // nothing pruned: no outputs, `||` falls back

  const shape = fixture.stringify ? stringified : (row: Row): Row => row;
  const dims = fixture.identityDims;
  const project = (row: Row): Row =>
    dims ? Object.fromEntries(dims.map((d) => [d, row[d] ?? null])) : row;
  const exclude = [
    ...new Map(
      pruned.map((leg) => {
        const entry = shape(project(leg.values));
        return [sortedJson(entry), entry];
      }),
    ).values(),
  ];
  outputs[`${fixture.key}-exclude`] = JSON.stringify(exclude);
  outputs[`${fixture.key}-matrix`] = JSON.stringify({
    include: kept.map((leg) => shape(leg.values)),
  });
  return outputs;
};

const simulate = (fixtures: Fixture[]): void => {
  const outputs: Record<string, string> = {};
  for (const fixture of fixtures)
    Object.assign(outputs, simulatedOutputs(fixture));
  writeOutputs(outputs);
};

/**
 * A pin records what GitHub did with the outputs simulate mode emits, so it
 * holds only when the filter emitted exactly those. Any other outputs (live
 * mode, or a service that prunes differently) get the ordinary check. Only the
 * outputs the fixture's wiring reads are compared: the filter job declares just
 * those, so the others never reach the verdict.
 */
const pinApplies = (
  fixture: Fixture,
  outputs: Record<string, string>,
): boolean => {
  const read: Record<Fixture["wiring"], string[]> = {
    exclude: ["", "-exclude"],
    matrix: ["", "-matrix"],
    none: [""],
  };
  const simulated = simulatedOutputs(fixture);
  return read[fixture.wiring].every((suffix) => {
    const name = `${fixture.key}${suffix}`;
    return outputs[name] === simulated[name];
  });
};

// ---------------------------------------------------------------------------
// verdict
// ---------------------------------------------------------------------------
interface Job {
  name: string;
  status: string;
  conclusion: string | null;
}

interface NeedsEntry {
  result: string;
  outputs: Record<string, string>;
}

// Jobs the smoke workflows run that are not fixtures. Any other check run must
// belong to a fixture, or a prefix in the answer key is wrong.
const INFRA_JOBS = new Set([
  // matrix-smoke.yaml
  "Dynamic CI filter",
  "Planner",
  "Verdict",
  "Matrix Smoke Pass",
  // matrix-example-*.yaml
  "Dynamic CI Filter",
  "Plan",
  "Tests pass",
  "Smoke verdict",
  // Not ours: pr.yaml's trunk-action posts this check run on the same commit,
  // and GitHub lists it among this run's jobs.
  "Trunk Check",
]);

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const fetchJobs = async (): Promise<Job[]> => {
  const api = process.env["GITHUB_API_URL"] || "https://api.github.com";
  const base = `${api}/repos/${env("GITHUB_REPOSITORY")}/actions/runs/${env("GITHUB_RUN_ID")}/jobs`;
  const jobs: Job[] = [];
  // `filter=latest`: one entry per job, from its most recent attempt.
  for (let page = 1; ; page++) {
    const response = await fetch(
      `${base}?filter=latest&per_page=100&page=${String(page)}`,
      {
        headers: {
          authorization: `Bearer ${env("GITHUB_TOKEN")}`,
          accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`listing jobs returned HTTP ${String(response.status)}`);
    }
    const body = (await response.json()) as {
      jobs: Job[];
      total_count: number;
    };
    jobs.push(...body.jobs);
    if (body.jobs.length < 100 || jobs.length >= body.total_count) return jobs;
  }
};

// The jobs API can lag the workflow: a leg that has finished (the verdict only
// starts once every fixture job has) can still read as queued or in progress,
// with a null conclusion. Such a leg is judged by its job's `needs.<key>.result`,
// which the workflow itself reports, rather than by the API.
const concludedBadly = (job: Job): boolean =>
  job.status === "completed" && job.conclusion !== "success";

const SETTLE_ATTEMPTS = 18;
const SETTLE_INTERVAL_MS = 10_000;

/** List the run's jobs, re-listing for up to 3 minutes until every leg reads as completed. */
const fetchSettledJobs = async (): Promise<Job[]> => {
  for (let attempt = 1; ; attempt++) {
    const jobs = await fetchJobs();
    const unsettled = jobs.filter(
      (job) => !INFRA_JOBS.has(job.name) && job.status !== "completed",
    );
    if (unsettled.length === 0 || attempt === SETTLE_ATTEMPTS) {
      if (unsettled.length > 0) {
        process.stdout.write(
          `${String(unsettled.length)} leg(s) still not completed in the jobs API; judging them by their job's result.\n`,
        );
      }
      return jobs;
    }
    process.stdout.write(
      `${String(unsettled.length)} leg(s) not yet completed in the jobs API; listing again in ${String(SETTLE_INTERVAL_MS / 1000)}s.\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
  }
};

const parseOutput = (raw: string | undefined): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

interface Check {
  name: string;
  problems: string[];
  detail: string;
}

/** Which legs the filter's outputs meant to prune, read the way this fixture is wired. */
const intendedPrune = (
  fixture: Fixture,
  outputs: Record<string, string>,
): { wholeSkip: boolean; pruned: Leg[]; kept: Leg[] } => {
  const wholeSkip = outputs[fixture.key] === "false";
  const exclude = parseOutput(outputs[`${fixture.key}-exclude`]) as
    | Row[]
    | undefined;
  const matrix = parseOutput(outputs[`${fixture.key}-matrix`]) as
    | { include: Row[] }
    | undefined;
  const isPruned = (leg: Leg): boolean => {
    if (wholeSkip) return true;
    if (fixture.wiring === "exclude" && exclude) {
      return exclude.some((entry) => carries(leg.values, entry));
    }
    if (fixture.wiring === "matrix" && matrix) {
      return !matrix.include.some((row) => sameRow(row, leg.values));
    }
    return false; // unwired: an output it doesn't read can't prune anything
  };
  const pruned = fixture.legs.filter(isPruned);
  return { wholeSkip, pruned, kept: fixture.legs.filter((l) => !isPruned(l)) };
};

/** A pinned fixture: GitHub must still behave exactly as `expect` records. */
const checkPinned = (
  fixture: Fixture,
  expect: NonNullable<Fixture["expect"]>,
  needs: Record<string, NeedsEntry>,
  observed: Job[],
  name: string,
  problems: string[],
): Check => {
  const result = needs[fixture.key]?.result;
  if (result !== (expect.result ?? "success")) {
    problems.push(
      `the job's result is ${String(result)}, but GitHub was observed to give ${expect.result ?? "success"} (${expect.note})`,
    );
  }
  const remaining = [...expect.ran];
  for (const job of observed) {
    if (concludedBadly(job)) {
      problems.push(`"${job.name}" concluded ${String(job.conclusion)}`);
    }
    const at = remaining.indexOf(job.name);
    if (at >= 0) {
      remaining.splice(at, 1);
    } else {
      problems.push(
        `"${job.name}" ran, but GitHub was observed not to run it (${expect.note})`,
      );
    }
  }
  for (const missing of remaining) {
    problems.push(
      `"${missing}" never ran, but GitHub was observed to run it (${expect.note})`,
    );
  }
  return {
    name,
    problems,
    detail: `pinned: ${String(expect.ran.length)} expected, ${String(observed.length)} ran${expect.result ? `, job ${String(result)}` : ""}`,
  };
};

const checkFixture = (
  fixture: Fixture,
  needs: Record<string, NeedsEntry>,
  outputs: Record<string, string>,
  observed: Job[],
): Check => {
  const name = `${fixture.key} ran exactly the legs its outputs kept`;
  const problems: string[] = [];
  if (!(fixture.key in needs)) {
    problems.push(
      "no such job in the verdict's needs: add it to the workflow, or to the verdict job's needs",
    );
  }
  if (fixture.expect && pinApplies(fixture, outputs)) {
    return checkPinned(
      fixture,
      fixture.expect,
      needs,
      observed,
      name,
      problems,
    );
  }
  const { wholeSkip, pruned, kept } = intendedPrune(fixture, outputs);

  if (wholeSkip) {
    const [only, ...rest] = observed;
    if (!only || rest.length > 0) {
      problems.push(
        `skipped whole, so expected ONE check run; saw ${String(observed.length)}`,
      );
    } else {
      if (only.conclusion !== "skipped") {
        problems.push(
          `"${only.name}" concluded ${String(only.conclusion)}, not skipped`,
        );
      }
      if (
        fixture.skippedName !== undefined &&
        only.name !== fixture.skippedName
      ) {
        problems.push(
          `the skipped check is named "${only.name}", expected the unexpanded "${fixture.skippedName}"`,
        );
      }
    }
    return {
      name,
      problems,
      detail: `skipped whole (${String(observed.length)} check run)`,
    };
  }

  const result = needs[fixture.key]?.result;
  if (result !== undefined && result !== "success") {
    problems.push(`the job's result is ${result}, not success`);
  }
  const remaining = kept.map((leg) => leg.name);
  const prunedNames = new Set(pruned.map((leg) => leg.name));
  for (const job of observed) {
    if (concludedBadly(job)) {
      problems.push(`"${job.name}" concluded ${String(job.conclusion)}`);
    }
    const at = remaining.indexOf(job.name);
    if (at >= 0) {
      remaining.splice(at, 1);
    } else if (prunedNames.has(job.name)) {
      problems.push(`"${job.name}" ran, but its outputs pruned it`);
    } else {
      problems.push(
        `"${job.name}" ran under a name the answer key does not predict`,
      );
    }
  }
  for (const missing of remaining) {
    problems.push(
      `"${missing}" was kept but never ran (or ran under another name)`,
    );
  }
  return {
    name,
    problems,
    detail: `${String(kept.length)} kept, ${String(pruned.length)} pruned, ${String(observed.length)} ran`,
  };
};

const xmlEscape = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const verdict = async (
  fixtures: Fixture[],
  example: string | undefined,
): Promise<void> => {
  const needs = JSON.parse(env("NEEDS")) as Record<string, NeedsEntry>;
  // The filter job's key: the examples use the README's, matrix-smoke.yaml its own.
  const outputs =
    (needs["dynamic-ci-filter"] ?? needs["filter"])?.outputs ?? {};
  const jobs = await fetchSettledJobs();
  // Flaky Tests keys a test on its name, and every example has a `test` job.
  const label = example ? `${example}: ` : "";

  const checks: Check[] = [];
  const observedByFixture: Record<string, Job[]> = {};
  for (const fixture of fixtures) {
    // An infra job can share a fixture's prefix: "Tests pass" starts with "Test".
    const observed = jobs.filter(
      (job) => !INFRA_JOBS.has(job.name) && job.name.startsWith(fixture.prefix),
    );
    observedByFixture[fixture.key] = observed;
    const check = checkFixture(fixture, needs, outputs, observed);
    checks.push({ ...check, name: `${label}${check.name}` });
  }

  // A check run no fixture claims means a prefix is wrong, and that fixture's
  // own check would pass vacuously on the legs it can't see.
  const unclaimed = jobs.filter(
    (job) =>
      !INFRA_JOBS.has(job.name) &&
      !fixtures.some((f) => job.name.startsWith(f.prefix)),
  );
  checks.push({
    name: `${label}every check run belongs to a fixture`,
    problems: unclaimed.map(
      (job) => `"${job.name}" matches no fixture's prefix`,
    ),
    detail: `${String(jobs.length)} check runs`,
  });

  mkdirSync(OUT, { recursive: true });
  // The golden data: what GitHub actually named every leg. The parser's
  // default-name and ingestion's template rendering are tested against this.
  writeFileSync(
    `${OUT}/observed.json`,
    JSON.stringify(
      {
        mode: process.env["MODE"] || "simulate",
        example: example ?? null,
        outputs,
        fixtures: Object.fromEntries(
          Object.entries(observedByFixture).map(([key, observed]) => [
            key,
            observed.map((j) => ({ name: j.name, conclusion: j.conclusion })),
          ]),
        ),
        unclaimed: unclaimed.map((j) => j.name),
      },
      null,
      2,
    ),
  );

  const failures = checks.filter((c) => c.problems.length > 0);
  writeFileSync(
    `${OUT}/junit.xml`,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<testsuites>",
      `  <testsuite name="dynamic-ci matrix smoke" tests="${String(checks.length)}" failures="${String(failures.length)}">`,
      ...checks.map((c) => {
        // A stable name, with the variable detail in the message: Flaky Tests
        // keys a test on its name.
        const body =
          c.problems.length > 0
            ? `<failure message="${xmlEscape(c.problems.join("; "))}"/>`
            : "";
        return `    <testcase classname="matrix-smoke" name="${xmlEscape(c.name)}">${body}</testcase>`;
      }),
      "  </testsuite>",
      "</testsuites>",
      "",
    ].join("\n"),
  );

  const rows = fixtures.map((fixture, i) => {
    const check = checks[i];
    const mark = check && check.problems.length > 0 ? "✘" : "✔";
    return `| ${mark} | \`${fixture.key}\` | ${fixture.shape} | ${fixture.wiring} | ${check?.detail ?? ""} |`;
  });
  const summary = [
    `## Matrix ${example ? `example: ${example}` : "smoke"} (${process.env["MODE"] || "simulate"})`,
    "",
    "| | Fixture | Shape | Wiring | Legs |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...failures.flatMap((c) => [
      `### ✘ ${c.name}`,
      "",
      ...c.problems.map((p) => `- ${p}`),
      "",
    ]),
  ].join("\n");
  const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryFile) appendFileSync(summaryFile, summary);

  for (const c of checks) {
    process.stdout.write(
      `${c.problems.length > 0 ? "✘" : "✔"} ${c.name} — ${c.detail}\n`,
    );
    for (const p of c.problems) process.stdout.write(`    ${p}\n`);
  }
  if (failures.length > 0) {
    process.stdout.write(
      `${String(failures.length)} check(s) failed. ${OUT}/observed.json has every name GitHub rendered.\n`,
    );
    process.exitCode = 1;
  }
};

/** The answer key: an example's, or matrix-smoke.yaml's when none is named. */
const loadFixtures = async (
  example: string | undefined,
): Promise<Fixture[]> => {
  if (example === undefined) return FIXTURES;
  if (!/^[a-z0-9-]+$/.test(example)) {
    throw new Error(`not an example name: ${example}`);
  }
  const module = (await import(`./examples/${example}.ts`)) as {
    FIXTURES: Fixture[];
  };
  return module.FIXTURES;
};

const [command, example] = process.argv.slice(2);
switch (command) {
  case "planner":
    planner();
    break;
  case "simulate":
    simulate(await loadFixtures(example));
    break;
  case "verdict":
    await verdict(await loadFixtures(example), example);
    break;
  default:
    process.stderr.write(
      `usage: node smoke.ts planner | simulate [example] | verdict [example] (got ${String(command)})\n`,
    );
    process.exitCode = 2;
}
