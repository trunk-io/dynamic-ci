// The matrix smoke test's expectations: one entry per fixture job in
// .github/workflows/matrix-smoke.yaml. The `Fixture` type is shared with the
// examples: each .github/workflows/matrix-example-<name>.yaml has its own answer
// key in examples/<name>.ts, with every leg written out.
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
   * one a whole-job skip reports under the bare job name; no other fixture's in
   * the same workflow does.
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
  // ---------------------------------------------------------------------------
  // Runtime matrices: rows built by the planner job
  // ---------------------------------------------------------------------------
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
export const RUNTIME_KEYS: readonly string[] = ["name-collision"];
