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

| Option           | Default       |                                                                              |
| ---------------- | ------------- | ---------------------------------------------------------------------------- |
| `pipeline`       | unset         | Path to the pipeline file. Omit to use `pipeline upload`'s own search order. |
| `token-env`      | `TRUNK_TOKEN` | Name of the environment variable holding your Trunk organization API token.  |
| `ignore-signals` | unset         | Comma-separated signal identifiers to exclude from the recommendation.       |

**Pass the token by environment, never as plugin configuration.** Plugin
configuration is interpolated into the uploaded pipeline and is visible in the
Buildkite UI.

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
```

The plugin is vendored alongside the [Dynamic CI GitHub
Action](https://github.com/trunk-io/dynamic-ci) so both speak one wire contract
and ship on one release process.
