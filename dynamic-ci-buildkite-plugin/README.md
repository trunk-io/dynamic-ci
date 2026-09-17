# Dynamic CI Buildkite Plugin

Skips the steps your diff does not need, using your organization's own CI
history. Trunk decides at **pipeline-upload time**, so a skipped step never
acquires an agent.

## Usage

Add the plugin to the step that already uploads your pipeline, and remove that
step's `command` — the plugin performs the upload:

```yaml
steps:
  # before:
  #   - label: ":pipeline: upload"
  #     command: buildkite-agent pipeline upload
  - label: ":pipeline: upload"
    secrets:
      - TRUNK_TOKEN
    plugins:
      - trunk-io/dynamic-ci#v1: ~
```

Nothing else in your pipeline changes.

If your upload step's command does more than upload, it cannot take the plugin
as-is — the plugin owns the step's command, so that extra work would stop
running. Move it to its own step.

### Options

| Option           | Default       |                                                                                                                                                                                                                                |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`           | `pipeline`    | `pipeline` takes over the upload step's command; `filter` leaves your command alone and puts `trunk-dynamic-ci-filter` on PATH; `step` decides about one step.                                                                 |
| `pipeline`       | unset         | Path to the pipeline file. Omit to use `pipeline upload`'s own search order.                                                                                                                                                   |
| `token-env`      | `TRUNK_TOKEN` | Name of the environment variable holding your Trunk organization API token. Expose it to the step (`secrets:`, or your agent's environment) and name it here — never put the token in plugin configuration or an `env:` value. |
| `debug`          | `false`       | Print the requested step keys, the request body and the plan to the build log, in collapsed groups. All of it goes to stderr, so it is safe in filter mode.                                                                    |
| `ignore-signals` | unset         | Comma-separated signal identifiers to exclude from the recommendation.                                                                                                                                                         |

**The token must reach the step without passing through the pipeline
definition.** Two things are interpolated into the uploaded pipeline at upload
time and shown in the Buildkite UI: plugin configuration, and `env:` values. So
put the token in neither. Expose it to the step — Buildkite `secrets:`, or your
agent's own environment — and point `token-env` at the variable's name.

## If your pipeline is generated

Many pipelines are not files — a script prints steps and uploads its own output.
There is no YAML for the plugin to read and no command for it to take over, so
use **filter mode** instead: keep your command exactly as it is, and add one
segment to the pipe.

```yaml
- key: initialize-pipeline
  label: ":wrench: Initialize Pipeline"
  secrets:
    - TRUNK_TOKEN
  command: |
    python -m ci.generate_pipeline \
      | trunk-dynamic-ci-filter \
      | buildkite-agent pipeline upload
  plugins:
    - trunk-io/dynamic-ci#v1:
        mode: filter
```

The plugin contributes one thing here: the `trunk-dynamic-ci-filter` command,
put on your `PATH` for the duration of the step. It reads a pipeline on stdin —
JSON or YAML — and writes one on stdout, and on any failure it writes back
**exactly** what it was given, byte for byte.

**It is a command, not a path in a variable, on purpose.** Buildkite interpolates
`${VAR}` in an uploaded pipeline at _upload_ time, while anything a plugin
exports exists only at _step_ runtime. A pipe written `| "${SOME_PATH}" |` would
therefore collapse to `|  |` — a shell syntax error on your first build. A
command name has nothing to interpolate.

Filter mode works for a generator in any language, and on JSON input it does
less work than pipeline mode: the pipeline is already parsed, so nothing is
rendered and nothing is interpolated that would not have been anyway.

## If you want to try one step first

**Step mode** puts the plugin on a single step, which then asks about itself:

```yaml
- key: e2e
  label: ":robot: E2E"
  command: make e2e
  secrets:
    - TRUNK_TOKEN
  plugins:
    - trunk-io/dynamic-ci#v1:
        mode: step
```

Two honest differences from the other modes, because the step has already been
dispatched by the time Trunk is asked:

- **The saving is smaller.** The agent is acquired, the repository checked out,
  and plugins set up before anything is skipped. On a long step that is still
  most of the cost; on a short one it may be nearly all of it.
- **Buildkite reports the step as passed, not skipped**, because it ran and did
  no work. Pipeline and filter mode mark the step before dispatch and so report
  it as genuinely skipped.

A step in this mode **must** have a `key:` — it is the whole request — and the
plugin fails the step rather than running it if one is missing, so you never get
a step that looks filtered but is not.

## Your steps need a `key:`

Trunk identifies a Buildkite step by its declarative `key:`, which is the only
identity that stays stable as labels and matrix values change. A step without
one has no history to reason about, so it always runs and the plugin says which
steps those were.

```yaml
- key: unit-tests # <- required for Trunk to decide about this step
  label: ":test_tube: Unit tests"
  command: make test
```

## What it does to your pipeline, and what it does not

The plugin's only effect is to add a `skip:` attribute to steps Trunk
recommended skipping. Specifically:

- It **never reads or writes a file in your repository.** The pipeline is
  rendered by `buildkite-agent pipeline upload --dry-run --format json`, so your
  YAML is parsed by Buildkite's own agent and the change happens to the rendered
  copy in flight.
- It **never changes a command**, adds a step, removes a step, or reorders
  anything.
- It **never overrides a `skip:` you wrote yourself**, including `skip: false`.
- A step the plan did not name is uploaded unchanged.

The whole mutation is [five lines of `jq`](lib/apply-skips.jq). It is small on
purpose: this is the only part of the plugin that changes what your build does,
so you should be able to read all of it.

Skipped steps stay visible in the build — use **Show skipped steps** — with the
recommendation's reason on hover.

## It installs nothing

The plugin ships the one tool it needs. `vendor/` holds verified static
[`jq`](https://jqlang.org) binaries for linux-amd64, linux-arm64 and
macos-arm64, with their upstream checksums in `bin/SHA256SUMS`; the hook checks
the checksum before executing. On a platform we do not ship, the plugin says so
and uploads your pipeline unchanged.

## Working out why nothing skipped

Set `debug: true` and the plugin prints three collapsed groups to the build log:
the step keys it asked about, the request body it sent, and the plan it got
back. Between them they answer most questions — whether your steps were seen,
whether the repository and pipeline resolved to what you expected, whether
`baseSha` came out null, and what Trunk actually decided.

```yaml
plugins:
  - trunk-io/dynamic-ci#v1:
      debug: true
```

All of it goes to stderr, so it is safe in filter mode, where stdout carries the
pipeline being uploaded. None of it contains your token — that travels in a
request header, never in the body.

## It fails open

Any failure — an unreachable API, a timeout, a plan this version cannot read, a
missing `jq` — uploads your pipeline unmodified and logs why. This step is on
the critical path of every build; the plugin will not be what breaks one.

## Development

```sh
pnpm test   # runs this plugin's tests with the rest of the repo's

# the request body, without making a call — the shape the tests validate
# against the engine's own schema
lib/request-plan.sh --print-body '["unit-tests"]'
```

Point the plugin at another Trunk deployment with `TRUNK_PUBLIC_API_ADDRESS`
(a base address; the endpoint path is part of the contract and is always
appended). It is the same variable the test-results uploader and the GitHub
Action read.

The plugin is vendored alongside the [Dynamic CI GitHub
Action](https://github.com/trunk-io/dynamic-ci) so both speak one wire contract
and ship on one release process.
