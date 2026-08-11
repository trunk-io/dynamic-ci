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

This action runs the risk of skipping important jobs, so it is important to still run all required
jobs in the merge queue. See the [configuration](#pre-job-mode-recommended) below and information on [Trunk's Merge Queue](https://docs.trunk.io/merge-queue/merge-queue).

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
    # Run when not a pull request to ensure full validation in the merge queue.
    if: >-
      !cancelled() &&
      (github.event_name != 'pull_request' ||
      needs.dynamic-ci-filter.outputs.unit-tests != 'false')
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
      job-names: Unit Tests

  - name: Unit Tests
    if: steps.ci-filter.outputs.unit-tests != 'false'
    run: make test
```

## Inputs

| Input            | Required | Description                                                                                                                                                                                                |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`          | yes      | Trunk organization API token. Find it at app.trunk.io → Settings → Manage Organization → Organization API Token.                                                                                           |
| `job-names`      | no       | A job name, or comma-separated list of job names, to scope the recommendation to. Leave unset to get a verdict for every job (fan-out). This must be a stable job name, not its id/key in the YAML config. |
| `ignore-signals` | no       | Comma-separated signal identifiers to exclude from the recommendation. An unrecognized identifier makes the action fail open.                                                                              |

Job names are matched on the job's **display name**, which is the `name:` field. A job
with no `name:` is displayed under its id, and that is what to pass for it.

## Outputs

One output per job, whose value is the string `'true'` (run) or `'false'` (skip).

The output key is the job name normalized to something referenceable in an `if:`
expression: lowercased, with every run of non-alphanumeric characters collapsed to a
single `-`. So `Unit Tests` becomes `unit-tests` and `build (ubuntu, 20)` becomes
`build-ubuntu-20`.

**Always write `!= 'false'`, never `== 'true'`.** A job with no verdict — a service
outage, a job name the service has never seen, a job you just renamed — emits no
output at all, and `!= 'false'` correctly runs it. Writing `== 'true'` would silently
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

The identifiers the action accepts are `SIGNAL_TYPES` in
[`src/schema/signals.ts`](src/schema/signals.ts) — that list is the one validated
against, and anything not in it makes the action fail open rather than quietly ignore
your setting. Signals are added and retired while this is in beta, so check that file
for the release you have pinned.

## Environment variables

| Variable                      | Default | Description                                                                                     |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `TRUNK_PUBLIC_API_ADDRESS`    | —       | Override the Trunk API base address. The recommendation path is appended to it.                 |
| `TRUNK_DYNAMIC_CI_TIMEOUT_MS` | `30000` | Request timeout, which is also the fail-open latency budget. Invalid values fall back to 30000. |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
