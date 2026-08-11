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
| `src/api.ts`     | The one outbound HTTP call, and response validation.                  |
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
