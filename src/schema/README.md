# `src/schema` — synced wire contract

These files are the request/response contract the action speaks to the Trunk
recommendation service. **They are synced from Trunk's internal monorepo, which is
the source of truth — do not hand-edit them here.** A local edit will be
overwritten by the next sync, and worse, will silently disagree with the service.

To change the contract: change it in the monorepo, then re-run the sync so this
copy and the committed `dist/index.js` are regenerated together.

`response.ts` intentionally omits the reserved test-level filter fields that exist
in the monorepo copy — test-level recommendations are not part of this action.
Zod ignores unknown keys, so a service response still carrying them parses fine.
