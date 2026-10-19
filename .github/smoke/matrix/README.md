# The matrix smoke test

Every shape of GitHub Actions matrix that Dynamic CI has to identify, decide and
prune per leg, written as a workflow author would write it. It does two jobs:

- **It tests GitHub, and our model of it.** Pruning individual matrix legs rests
  on how GitHub matches `exclude`, applies `include`, renders job names and
  treats an empty matrix. Each of those is a fixture here, so a pull request
  settles it.
- **It produces golden data.** Every run uploads `observed.json`: every name
  GitHub rendered, per fixture. Anything that predicts a leg's name from its
  matrix values can be tested against these names.

| File                                         | What it is                                                      |
| -------------------------------------------- | --------------------------------------------------------------- |
| `../../workflows/matrix-smoke.yaml`          | One job per matrix shape, plus the planner, filter and verdict  |
| `../../workflows/matrix-smoke-reusable.yaml` | The reusable workflow the `reusable-inputs` fixture calls       |
| `../../workflows/matrix-probe-empty.yaml`    | A by-hand probe: an ungated empty matrix, expected to go red    |
| `fixtures.ts`                                | The answer key: each fixture's legs, their names, what to prune |
| `smoke.ts`                                   | `planner`, `simulate` and `verdict`, run by the workflow's jobs |

## Two modes

- **`simulate`** — pull requests that touch these files. The filter job runs
  `smoke.ts simulate`, which emits the per-leg pruning outputs the action will
  emit (`<job>`, `<job>-exclude`, `<job>-matrix`) for the pruning `fixtures.ts`
  asks for. Deterministic, and needs no service.
- **`live`** — run the workflow by hand and pick `live`. The filter job runs the
  action at this commit against staging, with the planner's rows in `matrices`.
  Until the action can prune individual legs, it ignores `matrices` and prunes
  nothing, and the run checks only that nothing breaks. After that, the same
  verdict checks real pruning.

## What is asserted

The verdict reads the filter job's outputs, works out which legs they meant to
prune (the way each fixture is wired), and lists the run's check runs from the
GitHub API. For every fixture:

- **No pruned leg ran.** A leg whose combination is in `<job>-exclude`, or
  missing from `<job>-matrix`, never became a job, so it never reported anything.
- **Every kept leg ran, under the name `fixtures.ts` predicts, and passed.**
- **A job skipped whole reports one check run,** `skipped`, under its unexpanded
  name. That is the required-check hazard the fan-in job exists for.
- **Every check run belongs to some fixture.** Otherwise a wrong prefix would let
  a fixture pass with no legs to check.

**What the service decides is never asserted.** The verdict is the same in both
modes: it checks that GitHub did what the outputs said, never whether the
outputs were right.

## The fixtures

| Fixture                  | Shape                                  | Wiring  | What it settles                                                         |
| ------------------------ | -------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `all-axes-named`         | axes, all in `name:`                   | exclude | The baseline: a typed exclude removes one combination                   |
| `some-axes-named`        | axes, some in `name:`                  | exclude | A partial exclude (`{os}`) removes both legs that share a name          |
| `default-name`           | axes, no `name:`                       | exclude | GitHub's default name suffix, which leaves out keys added by include    |
| `shard-axis`             | axes, one a shard index                | exclude | A suite pruned across all its shards                                    |
| `object-axis`            | axis of objects                        | exclude | An exclude matches an object-valued axis by the whole object            |
| `number-exclude`         | number axis, string exclude            | exclude | `"18"` in an exclude removes the number `18` leg                        |
| `bool-exclude`           | boolean axis, string exclude           | exclude | PINNED: `"false"` in an exclude does not remove a `false` leg           |
| `float-values`           | float axis, nothing excluded           | none    | Whether `3.10` (renders `3.1`) and `"3.10"` are separate legs           |
| `float-exclude`          | float axis, string exclude             | exclude | PINNED: excluding `"3.10"` also removes the number `3.1`                |
| `context-name`           | `name:` reads `github.*`               | exclude | A name that can't be rendered from the matrix values alone              |
| `axes-plus-include`      | axes plus static include               | exclude | PINNED: an exclude key added by include fails the job, silently         |
| `axes-include-projected` | axes plus static include               | exclude | An exclude on axis keys only; whether include adds the leg back         |
| `include-only-literal`   | include-only, literal fallback         | matrix  | Include rows kept in `fromJSON(output \|\| '<literal>')`                |
| `all-pruned`             | every leg pruned                       | matrix  | `<job>` is `false`, so `if:` skips before the empty matrix is evaluated |
| `whole-job-skipped`      | whole job skipped                      | exclude | Today's whole-job skip: one check run, unexpanded name                  |
| `runs-on-include`        | include-only, `runs-on` from matrix    | none    | Legs told apart only by runner and values, named by GitHub              |
| `reusable-inputs`        | reusable workflow, matrix from inputs  | exclude | A matrix from caller inputs set to literals; the `caller / callee` name |
| `runtime-sharded`        | runtime include, stable fields, shards | matrix  | `&&`/`\|\|` defaults, booleans and numbers in the name                  |
| `runtime-matrix-object`  | runtime matrix object                  | matrix  | A planner that emits the whole matrix object                            |
| `axes-runtime-include`   | static axes plus runtime include       | none    | Only the include rows are known, so the job can only be skipped whole   |
| `bin-packed`             | runtime include, bin-packed            | none    | Rows with nested arrays and no stable field: skipped whole only         |
| `name-collision`         | runtime include, colliding names       | matrix  | Two rows that render one name; pruning by row still works               |

A fixture marked PINNED records what GitHub actually does where that differs
from what its outputs meant (`expect` in `fixtures.ts`). It stays green while
GitHub behaves that way, and goes red if GitHub changes.

A red verdict that says a leg "ran under a name fixtures.ts does not predict"
means either GitHub changed how it names legs, or a new fixture's prediction was
wrong. Take the real name from `observed.json` and fix the fixture.

## Adding a fixture

1. Add the job to `matrix-smoke.yaml`. Gate it on `needs.filter.outputs.<key>`,
   declare the filter outputs it reads, and add it to the verdict's `needs`.
2. Add its entry to `fixtures.ts`. Give it a `prefix` no other fixture's names
   start with.
3. For a runtime matrix, add the key to `RUNTIME_KEYS` and the planner's outputs.

`smoke.ts` runs locally on Node 24 (`node .github/smoke/matrix/smoke.ts simulate`).
The verdict needs `NEEDS` and a jobs API, both of which can be faked in a few
lines. Sabotage a fixture and check the verdict goes red: a smoke test that can't
fail isn't one.

## What this cannot see

This tests what reaches GitHub and what GitHub does with it. Whether Trunk
attributed each leg that ran to the right matrix variant is checked on the Trunk
side after a `live` run, not by this workflow.
