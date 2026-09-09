# Contributing to dynamic-ci-filter

## Prerequisites

- **Node.js** 24 or higher
- **pnpm**

```bash
pnpm install
```

## Layout

| Path             | What it is                                                            |
| ---------------- | --------------------------------------------------------------------- |
| `action.yaml`    | The action manifest. Declares inputs and points at the bundle.        |
| `src/index.ts`   | Entry point. Calls `runAction` and nothing else.                      |
| `src/main.ts`    | Orchestration: read inputs → request verdicts → set outputs → report. |
| `src/inputs.ts`  | Action inputs, including `ignore-signals` validation.                 |
| `src/context.ts` | Builds the request from the runner env and the event payload.         |
| `src/config.ts`  | Endpoint and timeout resolution.                                      |
| `src/api.ts`     | The outbound HTTP call, its retries, and response validation.         |
| `src/outcome.ts` | Maps a plan or a failure to the telemetry `(status, reason)` pair.    |
| `src/telemetry/` | Fire-and-forget plan telemetry. **Cross-repo contract — see below.**  |
| `src/outputs.ts` | Job-name normalization and `core.setOutput` calls.                    |
| `src/report.ts`  | Log lines, annotations, and the job summary.                          |
| `src/schema/`    | The wire contract. **Synced — see below.**                            |
| `src/__tests__/` | Tests, with shared fixtures in `__fixtures__/` beside them.           |
| `dist/index.js`  | Committed bundle. Generated; never edit by hand.                      |

## Build

The action runs `dist/index.js` on the runner and never installs dependencies, so the
bundle is a committed build artifact:

```bash
pnpm build      # esbuild → dist/index.js (+ dist/package.json)
pnpm watch      # rebuild on change
```

`dist/package.json` pins the directory to `type: commonjs`. The bundle is CommonJS
but this package is `type: module`, so without it Node reads `dist/index.js` as ESM
and the action dies on its first `require`. `pnpm build` writes it for you.

CI fails a PR whose `dist/index.js` does not match a fresh build, so **build and
commit the bundle with your source change.** The `build-pre-commit` Trunk action does
this automatically on commit.

## Test

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
```

Tests are `*.vitest.ts` files under `src/__tests__/`:

- `action.vitest.ts` drives the real entry point end to end. It sets the `INPUT_*` and
  `GITHUB_*` variables a runner would set, points `GITHUB_OUTPUT` and
  `GITHUB_STEP_SUMMARY` at temp files, mocks the service with
  [msw](https://mswjs.io/), and then asserts on what the action actually wrote. This
  is where fail-open behavior is covered — prefer adding cases here.
- The others are unit tests for a single module.

Note that `core.summary` caches its resolved file path on first write, so the
end-to-end tests share one summary file and truncate it between cases rather than
using a fresh path per test.

`pnpm test` also writes `junit.xml`, which CI uploads to Trunk Flaky Tests. Test
failures do not fail the test step directly — the uploader re-fails the job via
`previous-step-outcome`, so that quarantined failures can pass while real ones do not.

## Retries

`src/api.ts` retries a failed attempt with exponential backoff (full jitter). Two
knobs, both env vars so a bad day can be handled without cutting a release:

| Env var                             | Default | Meaning                                |
| ----------------------------------- | ------- | -------------------------------------- |
| `TRUNK_DYNAMIC_CI_TIMEOUT_MS`       | `30000` | **Per attempt**, not a total budget.   |
| `TRUNK_DYNAMIC_CI_MAX_ATTEMPTS`     | `4`     | 1 initial + 3 retries. Clamped to 1–4. |
| `TRUNK_DYNAMIC_CI_BACKOFF_START_MS` | `1000`  | Backoff base. Exists for tests.        |

Because the timeout is per attempt, a fully unreachable API costs up to
`timeout x attempts` plus backoff **per job**, and every job in every enabled repo
pays it at once. Worst case per job:

| Lane                                | Worst case |
| ----------------------------------- | ---------- |
| Plan: 4 attempts x 30s              | 120s       |
| Plan backoff (full jitter, ~1+2+4s) | ~7s        |
| Telemetry: 3 attempts x 1s          | 3s         |
| Telemetry backoff                   | ~7s        |
| **Total**                           | **~137s**  |

Drop `TRUNK_DYNAMIC_CI_MAX_ATTEMPTS` to `1` to cut the plan lane, or set
`TRUNK_DISABLE_TELEMETRY=true` to remove the telemetry lane. **A 4xx is retried too**
— the budget is "any non-200" — so a wrong or revoked token spends the full plan
budget on every job. That is a deliberate, and expensive, choice.

A schema-validation failure is **not** retried: the two sides disagree about the wire
shape, which is deterministic and clears only on a deploy, so a retry spends the whole
budget to receive the identical bytes. `retry.vitest.ts` asserts the request _count_,
which is the only thing that catches a regression here — the throw looks identical.

## Telemetry

Every terminal path with usable inputs reports one protobuf message to
`https://telemetry.<api-host>/v1/dynamic-ci/plan-metrics` with the org token on
`x-api-token`. It is fire-and-forget: it runs after the verdict is set, failures are
swallowed to `core.debug`, and a telemetry outage must never change an output. The
fetch carries a **1s** `AbortSignal.timeout`, matching the uploader's client: Node's
fetch otherwise defaults to a 300s headers timeout, and three untimed attempts would
add ~15 minutes to every job against a host that accepts and stalls. A 4xx is not
retried — a drifted proto contract is the documented steady-state 4xx, and retrying
it just pays the budget to be rejected three identical times.

The one path that reports nothing is a throw before the inputs are readable (a missing
`token`, the most common misconfiguration): there is no token left to authenticate the
report with.

`src/telemetry/protos.ts` defines the message with protobufjs **reflection** rather
than generated code, copying the analytics-uploader for the same two reasons: protoc's
output needs regex surgery to become ESM, and protobufjs's `load` uses `XMLHttpRequest`,
which does not exist on a runner.

**This is half of a cross-repo wire contract with no automated guard on either side.**
The other half is trunk1's telemetry-service
(`trunk/services/telemetry/proto/v1/dynamic_ci.proto` and its handler). Field numbers
and enum values must change together; nothing fails if they drift, and a mismatch
degrades to a 400 this action swallows — i.e. silently lost telemetry.

`reason` is an **enum, never a string**. The receiver turns it into a Prometheus label,
and free text from a client is an unbounded label value. `status` is deliberately only
three values (`success` / `failed` / `skipped`) so "is it working?" needs no arithmetic;
`reason` carries the detail, and is unset on success.

The same rule constrains the version. `gh-action-ref` is a **public input**, so a caller
can write into a label: `semverFromRef` parses `v1`, `v1.2` and `v1.2.3[-rc]` (the README
pins `@v1`, so rejecting a partial version would report `0.0.0` for nearly all traffic),
and anything else is truncated to 32 chars and charset-checked, falling back to `other`.

**`src/outcome.ts` hand-maintains a second copy of the engine's `PLAN_NOTICE` codes**,
with no sync tooling and no drift check — unlike `src/schema/`, which is projected
automatically. A seventh notice added upstream degrades silently to an unspecified
`skipped`. Check that table when the engine adds a notice.

## Running locally

Via [`@github/local-action`](https://github.com/github/local-action): copy
`.env.example` to `.env`, set a real `INPUT_TOKEN`, then:

```bash
pnpm local-action
```

## The synced schema

`src/schema/` is the request/response contract shared with the Trunk recommendation
service. **Trunk's internal monorepo is the source of truth; do not hand-edit these
files here.** A local edit gets overwritten on the next sync, and until then it
silently disagrees with the service.

To change the contract: change it upstream, run the sync to regenerate this copy,
rebuild the bundle, and commit both together. A drift check in CI on the upstream side
catches a contract change that never made it here.

One deliberate difference: the upstream copy carries reserved test-level filter fields
that this action does not implement. Zod ignores unknown response keys, so a service
response still carrying them parses fine here.

## Releases

1. Draft a new release on GitHub with a new tag (e.g. `v1.2.3`) and generate notes.
2. Once you have verified it works, run the **Update moving tag release version** workflow
   (`.github/workflows/release.yml`) with that tag as `target` and `v1` as
   `major_version`. It force-moves the major-version tag so consumers pinning `@v1`
   pick up the release.
