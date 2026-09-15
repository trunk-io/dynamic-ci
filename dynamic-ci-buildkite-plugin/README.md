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
    env:
      TRUNK_TOKEN: ${TRUNK_DYNAMIC_CI_TOKEN}
    plugins:
      - trunk-io/dynamic-ci#v1: ~
```

Nothing else in your pipeline changes.

If your upload step's command does more than upload, it cannot take the plugin
as-is — the plugin owns the step's command, so that extra work would stop
running. Move it to its own step.

### Options

| Option           | Default       |                                                                                                                                                           |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`           | `pipeline`    | `pipeline` takes over the upload step's command; `filter` leaves your command alone and exports `TRUNK_DYNAMIC_CI_FILTER`; `step` decides about one step. |
| `pipeline`       | unset         | Path to the pipeline file. Omit to use `pipeline upload`'s own search order.                                                                              |
| `token-env`      | `TRUNK_TOKEN` | Name of the environment variable holding your Trunk organization API token.                                                                               |
| `ignore-signals` | unset         | Comma-separated signal identifiers to exclude from the recommendation.                                                                                    |

**Pass the token by environment, never as plugin configuration.** Plugin
configuration is interpolated into the uploaded pipeline and is visible in the
Buildkite UI.

## If your pipeline is generated

Many pipelines are not files — a script prints steps and uploads its own output.
There is no YAML for the plugin to read and no command for it to take over, so
use **filter mode** instead: keep your command exactly as it is, and add one
segment to the pipe.

```yaml
- key: initialize-pipeline
  label: ":wrench: Initialize Pipeline"
  env:
    TRUNK_TOKEN: ${TRUNK_DYNAMIC_CI_TOKEN}
  command: |
    python -m ci.generate_pipeline \
      | "$TRUNK_DYNAMIC_CI_FILTER" \
      | buildkite-agent pipeline upload
  plugins:
    - trunk-io/dynamic-ci#v1:
        mode: filter
```

The plugin contributes one thing here: `TRUNK_DYNAMIC_CI_FILTER`, the path to the
filter. It reads a pipeline on stdin and writes one on stdout — JSON or YAML —
and on any failure it writes back **exactly** what it was given, byte for byte.

Filter mode works for a generator in any language, and on JSON input it does
less work than pipeline mode: the pipeline is already parsed, so nothing is
rendered and nothing is interpolated that would not have been anyway.

## If you want to try one step first

**Step mode** puts the plugin on a single step, which then asks about itself:

```yaml
- key: e2e
  label: ":robot: E2E"
  command: make e2e
  env:
    TRUNK_TOKEN: ${TRUNK_DYNAMIC_CI_TOKEN}
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

The plugin ships the one tool it needs. `bin/` holds verified static
[`jq`](https://jqlang.org) binaries for linux-amd64, linux-arm64 and
macos-arm64, with their upstream checksums in `bin/SHA256SUMS`; the hook checks
the checksum before executing. On a platform we do not ship, the plugin says so
and uploads your pipeline unchanged.

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
