// The matrix smoke test's expectations: one entry per fixture job in
// .github/workflows/matrix-smoke.yaml.
//
// THE YAML IS THE INPUT AND THIS FILE IS THE ANSWER KEY. Each matrix is written
// twice on purpose — once as a workflow author would write it, once here as the
// legs it should expand to and the names GitHub should give them. A disagreement
// between the two is the finding: either our model of GitHub is wrong, or GitHub
// changed.
//
// `legs[].values` are the values a leg carries, typed as GitHub sees them (YAML
// `18` is a number, `3.10` is the number 3.1). For runtime fixtures the planner
// job emits exactly these values as its rows, so the two cannot drift.
//
// `legs[].name` is the check-run name GitHub renders for that leg, as observed
// in a real run's observed.json.

export type Scalar = string | number | boolean | null;
export type Value = Scalar | Value[] | { [key: string]: Value };
export type Row = Record<string, Value>;

export interface Leg {
  values: Row;
  name: string;
}

/**
 * How the job reads the filter's pruning outputs:
 *   exclude  `strategy.matrix.exclude: fromJSON(<job>-exclude || '[]')` (axes)
 *   matrix   `strategy.matrix: fromJSON(<job>-matrix || <fallback>)` (include rows)
 *   none     not wired; the job can only be skipped whole
 */
export type Wiring = "exclude" | "matrix" | "none";

export interface Fixture {
  /** The job key under `jobs:`; also the filter output names `<key>`, `<key>-exclude`, `<key>-matrix`. */
  key: string;
  /** The kind of matrix, in a few words. */
  shape: string;
  /** What this fixture exists to show, in one line. */
  shows: string;
  /**
   * Every check run this fixture produces starts with this, including the single
   * one a whole-job skip reports under the bare job name; no other fixture's does.
   */
  prefix: string;
  wiring: Wiring;
  /** Runtime fixtures: the planner job emits these rows. Defaults to `legs[].values`. */
  rows?: Row[];
  legs: Leg[];
  /**
   * The dimensions the rendered names can tell apart, when that is fewer than
   * every key. Legs that share a name can't be told apart once they've run, so
   * the exclude names only these dimensions. Defaults to every key.
   */
  identityDims?: string[];
  /**
   * What the simulated plan prunes: each entry is a skipped variant's `match`, and
   * a leg is pruned when it carries every value in one. `"all"` prunes every leg,
   * which must skip the job whole.
   */
  prune?: Row[] | "all";
  /**
   * Emit the pruning outputs with every value as a string (`18` as `"18"`,
   * objects as key-sorted JSON), as a service that stored the values as text
   * would return them. Tests whether GitHub's exclude matching still lines up.
   */
  stringify?: boolean;
  /** The single check run GitHub reports when the job is skipped whole: the unexpanded name. */
  skippedName?: string;
  /**
   * PINNED: what GitHub actually does with the outputs simulate mode emits for
   * this fixture, where that is NOT what the outputs meant. When the filter
   * emitted exactly those outputs, this replaces the expectation the verdict
   * would work out from them, so the fixture stays green while GitHub behaves
   * this way and goes red if it changes. Any other outputs (live mode) get the
   * ordinary check. `note` says what was observed.
   */
  expect?: {
    /** The check-run names GitHub creates, one per leg. */
    ran: string[];
    /** The job's `needs.<key>.result`, when GitHub fails the job itself. */
    result?: "failure";
    note: string;
  };
}

const axes = (dims: Record<string, Value[]>): Row[] =>
  Object.entries(dims).reduce<Row[]>(
    (legs, [dim, values]) =>
      legs.flatMap((leg) => values.map((value) => ({ ...leg, [dim]: value }))),
    [{}],
  );

const named = (rows: Row[], name: (row: Row) => string): Leg[] =>
  rows.map((values) => ({ values, name: name(values) }));

const s = (value: Value | undefined): string =>
  typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);

export const FIXTURES: Fixture[] = [
  // ---------------------------------------------------------------------------
  // Static matrices: every value is written in the workflow file
  // ---------------------------------------------------------------------------
  {
    key: "all-axes-named",
    shape: "axes, all in name:",
    shows:
      "the baseline: static axes, every axis in name:, one combination excluded by its typed values",
    prefix: "All axes · ",
    wiring: "exclude",
    legs: named(
      axes({ os: ["linux", "macos"], node: [18, 20] }),
      (v) => `All axes · Test (${s(v["os"])}, node ${s(v["node"])})`,
    ),
    prune: [{ os: "macos", node: "20" }],
  },
  {
    key: "some-axes-named",
    shape: "axes, some in name:",
    shows:
      "name: shows os but not node, so two legs share each name; a partial exclude ({os}) removes both",
    prefix: "Some axes · ",
    wiring: "exclude",
    identityDims: ["os"],
    legs: named(
      axes({ os: ["linux", "macos"], node: [18, 20] }),
      (v) => `Some axes · Test (${s(v["os"])})`,
    ),
    prune: [{ os: "macos" }],
  },
  {
    key: "default-name",
    shape: "axes, no name:",
    shows:
      "no name:, so GitHub appends the axis values itself; a key added by include is left out of the name",
    prefix: "default-name",
    wiring: "exclude",
    legs: [
      {
        values: {
          os: "linux",
          arch: "amd64",
          tier: { name: "gold", level: 1 },
        },
        // Observed: the include-only `tier` key isn't in the default name.
        name: "default-name (linux, amd64)",
      },
      {
        values: { os: "linux", arch: "arm64" },
        name: "default-name (linux, arm64)",
      },
      {
        values: { os: "macos", arch: "amd64" },
        name: "default-name (macos, amd64)",
      },
      {
        values: { os: "macos", arch: "arm64" },
        name: "default-name (macos, arm64)",
      },
    ],
    prune: [{ os: "macos", arch: "arm64" }],
  },
  {
    key: "shard-axis",
    shape: "axes, one of them a shard index",
    shows:
      "a shard declared as an axis; pruning one suite removes it across all its shards",
    prefix: "Shard axis · ",
    wiring: "exclude",
    legs: named(
      axes({ suite: ["unit", "integration"], shard: [1, 2] }),
      (v) => `Shard axis · ${s(v["suite"])} (${s(v["shard"])}/2)`,
    ),
    prune: [{ suite: "integration" }],
  },
  {
    key: "object-axis",
    shape: "axis of objects",
    shows:
      "an axis whose values are objects (the README's platform.target example), excluded by the whole object",
    prefix: "Object · ",
    wiring: "exclude",
    legs: [
      {
        values: {
          platform: { target: "x86_64-unknown-linux-gnu", os: "ubuntu-latest" },
        },
        name: "Object · Test for x86_64-unknown-linux-gnu",
      },
      {
        values: {
          platform: { target: "aarch64-apple-darwin", os: "macos-14" },
        },
        name: "Object · Test for aarch64-apple-darwin",
      },
    ],
    prune: [{ platform: { target: "aarch64-apple-darwin", os: "macos-14" } }],
  },
  {
    key: "number-exclude",
    shape: "number axis, string exclude",
    shows:
      'an exclude of the string "18" against a leg whose value is the number 18; GitHub converts the string to a number, so it matches',
    prefix: "Number · ",
    wiring: "exclude",
    stringify: true,
    legs: named(
      axes({ node: [18, 20] }),
      (v) => `Number · node ${s(v["node"])}`,
    ),
    prune: [{ node: "18" }],
  },
  {
    key: "bool-exclude",
    shape: "boolean axis, string exclude",
    shows:
      'an exclude of the string "false" against a leg whose value is the boolean false; it does not match, so pruning outputs must keep JSON types',
    prefix: "Bool · ",
    wiring: "exclude",
    stringify: true,
    legs: named(
      axes({ flag: [true, false] }),
      (v) => `Bool · flag ${s(v["flag"])}`,
    ),
    prune: [{ flag: "false" }],
    expect: {
      ran: ["Bool · flag true", "Bool · flag false"],
      note: 'observed: the string "false" in an exclude does not remove a boolean false leg',
    },
  },
  {
    key: "float-values",
    shape: "float axis, nothing excluded",
    shows:
      'the control for float-exclude: YAML 3.10 is the number 3.1 and renders "3.1"; does GitHub keep "3.10" quoted as a separate leg?',
    prefix: "Floats · ",
    wiring: "none",
    legs: [
      { values: { python: 3.9 }, name: "Floats · Python 3.9" },
      { values: { python: 3.1 }, name: "Floats · Python 3.1" },
      { values: { python: "3.10" }, name: "Floats · Python 3.10" },
    ],
  },
  {
    key: "float-exclude",
    shape: "float axis, string exclude",
    shows:
      'excluding the string "3.10" from [3.9, 3.10, "3.10"]; float-values says whether both legs existed to begin with',
    prefix: "Float exclude · ",
    wiring: "exclude",
    legs: [
      { values: { python: 3.9 }, name: "Float exclude · Python 3.9" },
      { values: { python: 3.1 }, name: "Float exclude · Python 3.1" },
      { values: { python: "3.10" }, name: "Float exclude · Python 3.10" },
    ],
    prune: [{ python: "3.10" }],
    expect: {
      ran: ["Float exclude · Python 3.9"],
      note: 'observed: excluding "3.10" removes the number 3.1 as well as the string "3.10"',
    },
  },
  {
    key: "context-name",
    shape: "axes, name: reads github.*",
    shows:
      "name: reads github.workflow as well as matrix.*, so it can't be rendered from the matrix values alone",
    prefix: "Context · ",
    wiring: "exclude",
    legs: named(
      axes({ os: ["linux", "macos"] }),
      (v) => `Context · ${s(v["os"])} in Matrix Smoke`,
    ),
    prune: [{ os: "macos" }],
  },
  {
    key: "axes-include-projected",
    shape: "axes plus static include, exclude on axes only",
    shows:
      "include extends one axis leg and adds another; excluded by the axis keys only, the leg include extends comes back",
    prefix: "Projected · ",
    wiring: "exclude",
    legs: [
      {
        values: { os: "linux", node: 18 },
        name: "Projected · Test (linux, 18)",
      },
      {
        values: { os: "linux", node: 20, experimental: true },
        name: "Projected · Test (linux, 20)",
      },
      {
        values: { os: "macos", node: 18 },
        name: "Projected · Test (macos, 18)",
      },
      {
        values: { os: "macos", node: 20 },
        name: "Projected · Test (macos, 20)",
      },
      {
        values: { os: "windows", node: 22 },
        name: "Projected · Test (windows, 22)",
      },
    ],
    identityDims: ["os", "node"],
    prune: [{ node: "20" }],
    expect: {
      ran: [
        "Projected · Test (linux, 18)",
        "Projected · Test (linux, 20)",
        "Projected · Test (macos, 18)",
        "Projected · Test (windows, 22)",
      ],
      note: "observed: an include entry whose combination was excluded is added back as a new leg",
    },
  },
  {
    key: "include-only-literal",
    shape: "include-only, literal fallback",
    shows:
      "include rows can't be excluded from, so the rows live in a fromJSON(output || '<literal>') fallback",
    prefix: "Include-only · ",
    wiring: "matrix",
    legs: named(
      [
        { lane: "parallel", shard: 1, shard_count: 1 },
        { lane: "serial", shard: 1, shard_count: 3 },
        { lane: "serial", shard: 2, shard_count: 3 },
        { lane: "serial", shard: 3, shard_count: 3 },
      ],
      (v) =>
        `Include-only · ${s(v["lane"])} tests ${s(v["shard"])}/${s(v["shard_count"])}`,
    ),
    prune: [{ lane: "serial" }],
  },
  {
    key: "all-pruned",
    shape: "every leg pruned",
    shows:
      "with every leg pruned, <job>-matrix is {include: []} and <job> is false; the if: must skip the job before GitHub evaluates the empty matrix",
    prefix: "All-pruned · ",
    wiring: "matrix",
    legs: named(
      [{ lane: "parallel" }, { lane: "serial" }],
      (v) => `All-pruned · ${s(v["lane"])}`,
    ),
    prune: "all",
    skippedName: "All-pruned · ${{ matrix.lane }}",
  },
  {
    key: "whole-job-skipped",
    shape: "whole job skipped",
    shows:
      "today's behavior: a skipped matrix job reports ONE check under its unexpanded name, which is why a fan-in job must be the required check",
    prefix: "Whole · ",
    wiring: "exclude",
    legs: named(
      axes({ os: ["linux", "macos"] }),
      (v) => `Whole · Test (${s(v["os"])})`,
    ),
    prune: "all",
    skippedName: "Whole · Test (${{ matrix.os }})",
  },
  {
    key: "runs-on-include",
    shape: "include-only, no name:, runs-on from matrix",
    shows:
      "legs told apart only by their runner and values, with GitHub naming them",
    prefix: "runs-on-include",
    wiring: "none",
    legs: [
      {
        values: { runner: "ubuntu-24.04", arch: "amd64" },
        name: "runs-on-include (ubuntu-24.04, amd64)",
      },
      {
        values: { runner: "ubuntu-22.04", arch: "amd64-jammy" },
        name: "runs-on-include (ubuntu-22.04, amd64-jammy)",
      },
    ],
  },
  {
    key: "reusable-inputs",
    shape: "reusable workflow, matrix from inputs",
    shows:
      "a reusable workflow whose matrix comes from caller inputs set to literals; check runs are named 'caller / callee'",
    prefix: "Reusable",
    wiring: "exclude",
    legs: named(
      axes({ os: ["linux", "macos"] }),
      (v) => `Reusable / Test (${s(v["os"])})`,
    ),
    prune: [{ os: "macos" }],
  },

  // ---------------------------------------------------------------------------
  // Runtime matrices: rows built by the planner job
  // ---------------------------------------------------------------------------
  {
    key: "runtime-sharded",
    shape: "runtime include, stable fields × shards",
    shows:
      "stable suite/compat fields × per-run shard fields; the name uses && || defaults, a boolean and numbers",
    prefix: "Runtime sharded · ",
    wiring: "matrix",
    legs: named(
      [
        {
          suite: "api",
          compat: false,
          group: 1,
          concurrency: 2,
          artifact_key: "api-1",
        },
        {
          suite: "api",
          compat: false,
          group: 2,
          concurrency: 2,
          artifact_key: "api-2",
        },
        {
          suite: "api",
          compat: true,
          group: 1,
          concurrency: 1,
          artifact_key: "api-compat-1",
        },
        {
          suite: "worker",
          compat: false,
          group: 1,
          concurrency: 2,
          artifact_key: "worker-1",
        },
        {
          suite: "worker",
          compat: false,
          group: 2,
          concurrency: 2,
          artifact_key: "worker-2",
        },
      ],
      (v) =>
        `Runtime sharded · ${s(v["suite"])}${v["compat"] === true ? " compat" : ""} (${s(v["group"])}/${s(v["concurrency"])})`,
    ),
    // Decided on suite and compat: every worker shard goes together.
    prune: [{ suite: "worker", compat: "false" }],
  },
  {
    key: "runtime-matrix-object",
    shape: "runtime matrix object",
    shows:
      "a planner that emits the whole strategy.matrix object rather than an include array",
    prefix: "Runtime object · ",
    wiring: "matrix",
    legs: named(
      [
        { image: "gateway" },
        { image: "scheduler" },
        { image: "indexer" },
        { image: "notifier" },
      ],
      (v) => `Runtime object · Build ${s(v["image"])}`,
    ),
    prune: [{ image: "scheduler" }],
  },
  {
    key: "axes-runtime-include",
    shape: "static axes plus runtime include",
    shows:
      "the action would hold only the include rows, not the expanded legs, so this job can only be skipped whole",
    prefix: "Axes+runtime · ",
    wiring: "none",
    rows: [{ os: "linux", extra: "lint" }, { os: "windows" }],
    legs: [
      {
        values: { os: "linux", extra: "lint" },
        name: "Axes+runtime · Build (linux)",
      },
      { values: { os: "macos" }, name: "Axes+runtime · Build (macos)" },
      { values: { os: "windows" }, name: "Axes+runtime · Build (windows)" },
    ],
  },
  {
    key: "bin-packed",
    shape: "runtime include, bin-packed",
    shows:
      "packed package lists in nested arrays; no field is stable across runs, so the job can only be skipped whole",
    prefix: "Bin-packed · ",
    wiring: "none",
    legs: named(
      [
        { group: "pkg-a+pkg-b", legs: ["pkg-a", "pkg-b"], filters: "a|b" },
        { group: "pkg-c", legs: ["pkg-c"], filters: "c" },
      ],
      (v) => `Bin-packed · Tests (${s(v["group"])})`,
    ),
  },
  {
    key: "name-collision",
    shape: "runtime include, colliding names",
    shows:
      "two runtime rows render the same name, so the legs can't be told apart once they've run; pruning by row still works",
    prefix: "Collision · ",
    wiring: "matrix",
    legs: named(
      [
        { suite: "api", shard: 1 },
        { suite: "api", shard: 2 },
        { suite: "web", shard: 1 },
      ],
      (v) => `Collision · ${s(v["suite"])}`,
    ),
    prune: [{ suite: "web" }],
  },
];

/** The rows the planner job emits for a runtime fixture. */
export const rowsOf = (fixture: Fixture): Row[] =>
  fixture.rows ?? fixture.legs.map((leg) => leg.values);

/** The runtime fixtures, whose matrices the planner job builds. */
export const RUNTIME_KEYS: readonly string[] = [
  "runtime-sharded",
  "runtime-matrix-object",
  "axes-runtime-include",
  "bin-packed",
  "name-collision",
];
