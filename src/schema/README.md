# `src/schema` — the synced wire contract

`dynamic-ci-contract.json` is Trunk's **published** OpenAPI contract for the
endpoint this action calls, `POST /v2/dynamic-ci/generate-plan`. **It is synced
from Trunk's monorepo, which is the source of truth — do not hand-edit it here.**
A local edit will be overwritten by the next sync, and worse, will silently
disagree with the API.

`contract.d.ts` is generated from it by `pnpm generate:schema`
(`openapi-typescript`) and committed; CI regenerates and diffs it.

To change the contract: change it upstream. The sync regenerates this copy and
the committed `dist/index.js` together, since the action runs the bundle.

The action does not import either file directly:
[`src/compat.ts`](../compat.ts) is the contract as the action uses it, and widens
the signal-identifier enums to plain strings. Trunk adds signals between syncs,
and a closed enum would make that additive change fail the whole response —
discarding every job's verdict, at which point the action fails open and the gate
silently stops gating. Widen there, never here; this copy must keep matching what
Trunk publishes. `compat.ts` asserts that match at the type level, in both
directions, so a field added or dropped upstream is a typecheck failure on the
sync PR rather than a value quietly stripped.

The document carries request bodies and `200` responses only. Error envelopes are
deliberately absent: the action branches on the HTTP status, and the error code
enum spans every Trunk API product, so carrying it would raise a pull request
here every time an unrelated product added one.
