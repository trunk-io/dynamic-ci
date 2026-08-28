# Trunk Dynamic CI Filter

GitHub Action that recommends which CI jobs to run for the current diff, using your
organization's own CI history. It runs before your work, asks the Trunk
recommendation service for a per-job verdict, and emits those verdicts as job
outputs you gate on.

It is a near drop-in replacement for [path-based filtering](https://github.com/dorny/paths-filter): instead of hand-written
path globs, verdicts come from signals measured on your repository — historical pass
rates, whether the job already passed on this commit, how volatile the changed files
are, cost, and more.

> [!IMPORTANT]
> **This is a beta product.** Recommendation quality is still improving, the set of
> signals behind a verdict is still changing, and this action's inputs and outputs may
> change between releases. Pin a specific tag rather than a moving major version if you
> need stability, and read the release notes before upgrading.

A recommendation can be wrong, so the jobs that gate a merge still need to run somewhere.
If you use [Trunk's Merge Queue](https://docs.trunk.io/merge-queue/merge-queue) that is
handled for you — the service never skips a job on a merge-queue branch, so you do not
need to special-case the queue in your workflow. See [Merge queues](#merge-queues) for
what is and isn't covered.

## Usage

### Pre-job mode (recommended)

One upstream job asks for verdicts for the whole workflow, and every downstream job
gates on its outputs. This captures the most savings, because a skipped job never
boots a runner.

```yaml
jobs:
  dynamic-ci-filter:
    name: Dynamic CI Filter
    runs-on: ubuntu-latest
    timeout-minutes: 5
    # Only ask on pull requests; on other events the gate is skipped and, with no
    # outputs to compare against, every job below runs.
    if: github.event_name == 'pull_request'
    # Per-job outputs are set at runtime, so they must be re-exported here by name.
    outputs:
      unit-tests: ${{ steps.ci-filter.outputs.unit-tests }}
      integration-tests: ${{ steps.ci-filter.outputs.integration-tests }}
    steps:
      - name: Run Dynamic CI Filter
        id: ci-filter
        uses: trunk-io/dynamic-ci-filter@v1
        with:
          token: ${{ secrets.TRUNK_API_TOKEN }}

  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    needs: [dynamic-ci-filter]
    # Always compare against 'false', never 'true' — see "Outputs" below.
    # No merge-queue escape hatch needed: see "Merge queues".
    if: >-
      !cancelled() &&
      needs.dynamic-ci-filter.outputs.unit-tests != 'false'
    steps:
      - run: make test
```

### Pre-step mode

A single job asks only about itself and skips its own work. Simpler to adopt, but
the runner has already booted by the time the verdict arrives.

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Run Dynamic CI Filter
    id: ci-filter
    uses: trunk-io/dynamic-ci-filter@v1
    with:
      token: ${{ secrets.TRUNK_API_TOKEN }}
      job-keys: unit-tests

  - name: Unit Tests
    if: steps.ci-filter.outputs.unit-tests != 'false'
    run: make test
```

## Inputs

| Input            | Required | Description                                                                                                                                                                               |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`          | yes      | Trunk organization API token. Find it at app.trunk.io → Settings → Manage Organization → Organization API Token.                                                                          |
| `job-keys`       | no       | A job key, or comma-separated list of job keys, to scope the recommendation to. Leave unset to get a verdict for every job (fan-out).                                                     |
| `ignore-signals` | no       | Comma-separated signal identifiers to exclude from the recommendation. Forwarded to the service as given; an identifier this action version does not know is warned about and still sent. |

Jobs are addressed by their **key** — what the job is written as under `jobs:` in the
workflow file, and what `github.job` reports — not by the `name:` it displays under. A
display name changes with a job's matrix values; the key does not, which is what makes
it safe to put in an `if:`.

## Outputs

One output per job, whose value is the string `'true'` (run) or `'false'` (skip).

The output is named for the job key verbatim. GitHub already constrains a `jobs:` key to
what an expression can dereference, so a job written as `unit-tests` is read back as
`steps.ci-filter.outputs.unit-tests` with no transformation to work out.

**Always write `!= 'false'`, never `== 'true'`.** A job with no verdict — a service
outage, a job the service has never seen, a job whose key it has not resolved yet —
emits no output at all, and `!= 'false'` correctly runs it. Writing `== 'true'` would silently
skip your entire test suite the first time something goes wrong.

## Failing open

The action is built so that it can never block your CI:

- A transport error, non-2xx response, malformed response, or a request exceeding the
  latency budget (30s by default) all produce `'true'` for every job in scope.
- Unexpected failures — a missing token, for example — are caught too, and emit no
  outputs at all, which your `!= 'false'` conditionals read as "run".
- It never calls `core.setFailed`, so the step itself always succeeds. Failing the
  step would defeat the purpose.

Every fail-open is logged as a warning annotation with the reason, and written to the
job summary, so you can tell a real skip from a degraded one.

### When Trunk returns no recommendations

Trunk can answer successfully and still have nothing to recommend — because Dynamic CI
is not enabled for your organization, because the branch is a merge-queue branch,
because the engine was unavailable, or because Trunk has not yet enumerated the jobs in
this workflow. **Every job runs in all four cases**, which is the fail-safe working as
intended.

When that happens the response carries a `notice`, and the action renders it as a
warning annotation and in the job summary — for example:

> Every job will run: Dynamic CI is not enabled for this organization. Contact Trunk to
> turn it on. `[ORG_NOT_ENABLED]`

A notice covers every expected cause, so a plan that arrives empty _without_ one
means something went wrong that Trunk could not name. The action says so and points
you at [slack.trunk.io](https://slack.trunk.io) rather than printing an empty heading.

## Merge queues

A merge queue validates the exact commit that is about to land, so skipping a job there
could merge untested code. The service therefore **never skips a job on a Trunk Merge
Queue branch**: a request whose branch starts with `trunk-merge/` short-circuits to a
run-everything verdict before any recommendation work happens. It is a branch-name check
rather than a heuristic, so it is both deterministic and fast.

You therefore do not need to gate the queue yourself. In particular you do not need
`github.event_name != 'pull_request'` in your conditions — which matters because with
**draft merge-queue pull requests** enabled, queue batches arrive as `pull_request` events
on `trunk-merge/*` branches, so the event name cannot tell them apart from real PRs. Use
the action the same way everywhere and let the branch check do the work.

The guarantee holds in both modes, with slightly different mechanics:

- With `job-keys` set, every named job comes back as an explicit `'true'`.
- In fan-out mode the response carries no verdicts, so no outputs are set at all — which
  your `!= 'false'` conditions already read as "run". This is one more reason never to
  write `== 'true'`.

**Other merge queues are not covered.** The check matches the `trunk-merge/` prefix only.
GitHub's native merge queue, for instance, validates on `gh-readonly-queue/*` branches via
`merge_group` events, and those requests are treated like any other — so gate that
yourself:

```yaml
if: >-
  !cancelled() &&
  (github.event_name == 'merge_group' ||
  needs.dynamic-ci-filter.outputs.unit-tests != 'false')
```

You may wish to use another paths filter mechanism to deterministically reduce what runs in the merge queue.
If you have feedback on the filtering mechanism in merge queues, reach out to us on [Slack](https://slack.trunk.io).

## Signals

Each verdict is a combination of independent signals, and each signal's contribution
is shown in the logs and in the job summary. Pass any of these to `ignore-signals` to
drop it from the tally:

| Signal                   | What it looks at                                                 |
| ------------------------ | ---------------------------------------------------------------- |
| `estimated-cost`         | What the job costs to run.                                       |
| `previous-result-on-pr`  | Whether this job already ran on this PR, and how it did.         |
| `historical-pass-rate`   | How often this job has failed historically.                      |
| `diff-driven-volatility` | How often changes to these files have broken this job.           |
| `force-override`         | An explicit user override forcing the job to run.                |
| `merge-failure`          | Whether this job failed on the PR's most recent merge-queue run. |
| `mid-pr-stack`           | Whether another open PR is stacked on top of this one.           |
| `required-check`         | Whether the PR's base branch requires this job to merge.         |

The identifiers this action version knows about are `SIGNAL_TYPES` in
[`src/schema/signals.ts`](src/schema/signals.ts). Signals are added and retired while
this is in beta, and the service ships them before that vendored list catches up, so
neither side treats an unfamiliar identifier as an error:

- A signal the service returns that this version does not know is reported in the logs
  and summary like any other, and the verdict it belongs to is honored.
- An `ignore-signals` identifier this version does not know is warned about and
  forwarded anyway — so a typo has no effect, rather than taking the gate down.

Check `SIGNAL_TYPES` for the release you have pinned to see what this version can
describe, but read the job summary for what actually voted.

## Environment variables

| Variable                      | Default                | Description                                                                                     |
| ----------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `TRUNK_PUBLIC_API_ADDRESS`    | `https://api.trunk.io` | Trunk API base address (host only). The recommendation path is appended to it.                  |
| `TRUNK_DYNAMIC_CI_TIMEOUT_MS` | `30000`                | Request timeout, which is also the fail-open latency budget. Invalid values fall back to 30000. |

## Matrices

### A matrix is one job identity

Verdicts are keyed on the job **key** — what the job is written as under `jobs:` — and a
matrix expands into many legs beneath that one key. Trunk issues **one verdict for the
whole job**: either every leg runs or every leg skips. There is no per-leg verdict, and no
way to skip one platform while running another.

If you need matrix legs judged separately, reach out to us at
[slack.trunk.io](https://slack.trunk.io).

### Matrix legs as required checks

GitHub evaluates a job's `if:` before it expands the matrix, so a matrix job that Dynamic
CI skips emits a single check run under the **unexpanded** name:

```text
Test for ${{ matrix.platform.target }}
```

Per-leg contexts like `Test for x86_64-apple-darwin` then never report, and a pull request
whose branch protection requires them waits on **"Expected — Waiting for status to be
reported"** indefinitely. Wildcards are no help: required contexts are exact-match
strings on every plan. Non-matrix jobs are unaffected — a skipped job reports a `skipped`
conclusion, which branch protection accepts as satisfied.

Four ways to resolve it:

| Option                           | How it works                                                                                                                                                 | Trade-off                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fan-in job** (recommended)     | Add one `if: always()` job that `needs` the gated jobs and passes when each finished `success` or `skipped`. Require its name in place of the leg names.     | Aggregates per job, so it cannot require a subset of legs. Never gate this job with Dynamic CI — a gate that can be skipped cannot report.                      |
| **Require the workflow**         | GitHub's "Require workflows to pass before merging" ruleset rule keys on the workflow file path, and a run whose jobs all skip still concludes successfully. | GitHub Enterprise Cloud only. Requires the workflow as a whole, so jobs you had left out of the required set start blocking merges.                             |
| **Leave the job ungated**        | Omit the matrix job from the filter's `outputs:` and give it no `if:`. Its per-leg contexts keep reporting exactly as they do today.                         | No savings on that job. Everything else in the workflow can still be gated.                                                                                     |
| **In-step gating** (discouraged) | Move the verdict out of the job's `if:` and into each step's `if:`, so every leg still boots and still reports its context.                                  | Spends the runner anyway, and reports `success` without doing the work — feeding `historical-pass-rate` and `previous-result-on-pr` a pass that never happened. |

Prefer the fan-in job: it costs one cheap runner and keeps the pass-rate signals honest.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
