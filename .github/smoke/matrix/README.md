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

| File                                         | What it is                                                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `../../workflows/matrix-example-<name>.yaml` | One customer-shaped example per file; see [Examples](#examples)    |
| `examples/<name>.ts`                         | Each example's answer key, every leg written out                   |
| `../../workflows/matrix-smoke.yaml`          | One job per remaining matrix shape, plus planner, filter, verdict  |
| `../../workflows/matrix-smoke-reusable.yaml` | The reusable workflow the `reusable-inputs` fixture calls          |
| `../../workflows/matrix-probes.yaml`         | By-hand probes whose answer is a failed job, so expected to go red |
| `fixtures.ts`                                | `matrix-smoke.yaml`'s answer key, and the `Fixture` type           |
| `smoke.ts`                                   | `planner`, `simulate` and `verdict`, run by the workflows' jobs    |

## Examples

Each `matrix-example-<name>.yaml` is a complete workflow, written the way a
customer would write it, so we can point customers with that shape to it. Its header says
when to use the shape, which variation dimensions to configure in Trunk, what the
filter emits, and which check to require. It is also a smoke test of its own:
everything marked `smoke:` is harness (the mode switch, the simulated outputs,
the verdict job), and a customer leaves it out.

| Example           | Shape                                            | Wiring  | What it shows                                                         |
| ----------------- | ------------------------------------------------ | ------- | --------------------------------------------------------------------- |
| `static-axes`     | axes, all in `name:` (`test`) and some (`build`) | exclude | The baseline exclude; a name that leaves an axis out shares a check   |
| `planner-include` | runtime include, stable fields, shards           | matrix  | A planner's rows through `matrices`; `&&`/`\|\|` defaults in the name |

`matrix-smoke.yaml`'s fixtures move into examples like these one at a time.
Shapes that only test GitHub's matching rules (`bool-exclude`, `float-*`,
`number-exclude`, `context-name`) stay there.

## Two modes

Every example, and `matrix-smoke.yaml`, runs in one of two modes.

- **`simulate`** — pull requests that touch these files, and weekly on Mondays
  to catch GitHub changing behavior a fixture pins. The filter job runs
  `smoke.ts simulate [example]`, which emits the per-leg pruning outputs the action will
  emit (`<job>`, `<job>-exclude`, `<job>-matrix`) for the pruning the answer
  key asks for. Deterministic, and needs no service.
- **`live`** — every 4 hours, or run the workflow by hand and pick `live`. The
  filter job runs the action at this commit against staging, with the
  planner's rows in `matrices`, and the scheduled runs build the CI history
  staging decides on. Until the action can prune individual legs, it ignores
  `matrices` and prunes nothing, and the run checks only that nothing breaks.
  After that, the same verdict checks real pruning.

## What is asserted

The verdict reads the filter job's outputs, works out which legs they meant to
prune (the way each fixture is wired), and lists the run's check runs from the
GitHub API. For every fixture:

- **No pruned leg ran.** A leg whose combination is in `<job>-exclude`, or
  missing from `<job>-matrix`, never became a job, so it never reported anything.
- **Every kept leg ran, under the name `fixtures.ts` predicts, and passed.**
  The jobs API can lag the workflow, so the verdict lists the jobs again for up
  to 3 minutes until every leg reads as completed. Pass or fail comes from each
  job's `needs.<key>.result`, which the workflow reports itself.
- **A job skipped whole reports one check run,** `skipped`, under its unexpanded
  name. That is the required-check hazard the fan-in job exists for.
- **Every check run belongs to some fixture.** Otherwise a wrong prefix would let
  a fixture pass with no legs to check.

**What the service decides is never asserted.** The verdict is the same in both
modes: it checks that GitHub did what the outputs said, never whether the
outputs were right.

## The fixtures in `matrix-smoke.yaml`

| Fixture                  | Shape                                 | Wiring  | What it settles                                                         |
| ------------------------ | ------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `default-name`           | axes, no `name:`                      | exclude | GitHub's default name suffix, which leaves out keys added by include    |
| `shard-axis`             | axes, one a shard index               | exclude | A suite pruned across all its shards                                    |
| `object-axis`            | axis of objects                       | exclude | An exclude matches an object-valued axis by the whole object            |
| `number-exclude`         | number axis, string exclude           | exclude | `"18"` in an exclude removes the number `18` leg                        |
| `bool-exclude`           | boolean axis, string exclude          | exclude | PINNED: `"false"` in an exclude does not remove a `false` leg           |
| `float-values`           | float axis, nothing excluded          | none    | Whether `3.10` (renders `3.1`) and `"3.10"` are separate legs           |
| `float-exclude`          | float axis, string exclude            | exclude | PINNED: excluding `"3.10"` also removes the number `3.1`                |
| `context-name`           | `name:` reads `github.*`              | exclude | A name that can't be rendered from the matrix values alone              |
| `axes-include-projected` | axes plus static include              | exclude | PINNED: excluded by axis keys only, the leg include extends comes back  |
| `include-only-literal`   | include-only, literal fallback        | matrix  | Include rows kept in `fromJSON(output \|\| '<literal>')`                |
| `all-pruned`             | every leg pruned                      | matrix  | `<job>` is `false`, so `if:` skips before the empty matrix is evaluated |
| `whole-job-skipped`      | whole job skipped                     | exclude | Today's whole-job skip: one check run, unexpanded name                  |
| `runs-on-include`        | include-only, `runs-on` from matrix   | none    | Legs told apart only by runner and values, named by GitHub              |
| `reusable-inputs`        | reusable workflow, matrix from inputs | exclude | A matrix from caller inputs set to literals; the `caller / callee` name |
| `runtime-matrix-object`  | runtime matrix object                 | matrix  | A planner that emits the whole matrix object                            |
| `axes-runtime-include`   | static axes plus runtime include      | none    | Only the include rows are known, so the job can only be skipped whole   |
| `bin-packed`             | runtime include, bin-packed           | none    | Rows with nested arrays and no stable field: skipped whole only         |
| `name-collision`         | runtime include, colliding names      | matrix  | Two rows that render one name; pruning by row still works               |

A fixture marked PINNED records what GitHub actually does with the outputs
`simulate` emits, where that differs from what the outputs meant (`expect` in
`fixtures.ts`). It stays green while GitHub behaves that way, and goes red if
GitHub changes. A pin applies only when the filter emitted exactly those
outputs: in `live` mode, the fixture gets the ordinary check instead.

A red verdict that says a leg "ran under a name the answer key does not
predict" means either GitHub changed how it names legs, or a new fixture's
prediction was wrong. Take the real name from `observed.json` and fix the fixture.

## Adding an example

1. Copy the example closest to it to `matrix-example-<name>.yaml`. Keep the
   header's sections, the `smoke:` markers, and the README's job key
   `dynamic-ci-filter`. Give its `live` cron a minute no other example uses, in
   both places it appears.
2. Write `examples/<name>.ts`: every leg's values and the name GitHub gives it,
   written out. Each matrix job needs a `prefix` that no other job's names in
   the same file start with.
3. Pass `<name>` to `smoke.ts simulate` and `smoke.ts verdict`, and add a row to
   [Examples](#examples).

## Adding a fixture to `matrix-smoke.yaml`

1. Add the job to `matrix-smoke.yaml`. Gate it on `needs.filter.outputs.<key>`,
   declare the filter outputs it reads, and add it to the verdict's `needs`.
2. Add its entry to `fixtures.ts`. Give it a `prefix` no other fixture's names
   start with.
3. For a runtime matrix, add the key to `RUNTIME_KEYS` and the planner's outputs.

`smoke.ts` runs locally on Node 24 (`node .github/smoke/matrix/smoke.ts simulate [example]`).
The verdict needs `NEEDS` and a jobs API, both of which can be faked in a few
lines. Sabotage a fixture and check the verdict goes red: a smoke test that can't
fail isn't one.

## What this cannot see

This tests what reaches GitHub and what GitHub does with it. Whether Trunk
attributed each leg that ran to the right matrix variation is checked on the Trunk
side after a `live` run, not by this workflow.
