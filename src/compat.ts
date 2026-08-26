import * as z from "zod";
import { PUBLIC_SIGNAL_RESULT_SCHEMA } from "./schema/signals";
import {
  DYNAMIC_CI_RESPONSE_SCHEMA as SYNCED_RESPONSE_SCHEMA,
  JOB_VERDICT_SCHEMA as SYNCED_JOB_VERDICT_SCHEMA,
} from "./schema/response";
import type { DynamicCiRequest as SyncedRequest } from "./schema/request";

/*
 * The contract as the action uses it: the synced one from `src/schema`, with the
 * signal-identifier enums widened to plain strings. Import these here, not from
 * `src/schema` — that copy stays an exact mirror of the monorepo.
 *
 * The service adds signals and vote kinds on its own release cadence, while
 * `src/schema` only advances when a sync PR merges. A closed `z.enum` turns that
 * ordinary additive change into a hard failure: one unrecognized `type` fails
 * the whole-response parse, discarding the verdicts for *every* job in the
 * workflow, and the action fails open — so the gate silently stops gating until
 * the two copies line up again.
 *
 * The names are deliberately the ones the synced schemas use, so consumers
 * differ only in where they import from. Same-name shadowing is safe in the
 * direction that matters: the strict type is assignable to this widened one,
 * never the reverse.
 */

/**
 * `type` and `recommendation` are display-only — `report.ts` renders them into a
 * log line and a summary table, and nothing else reads them. Everything that
 * decides behavior (`run`, `summary`, and the request) keeps its synced type, so
 * a genuinely malformed response still fails open.
 *
 * Built by `.extend()`ing the synced schema so the widening reads as a diff
 * against the contract. The explicit annotation `--isolatedDeclarations` wants
 * cuts the right way too: a field added upstream stops matching it, so the sync
 * PR fails `pnpm typecheck` rather than quietly dropping the field here.
 */
export const PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT: z.ZodObject<{
  type: z.ZodString;
  recommendation: z.ZodString;
  message: z.ZodString;
  ignored: z.ZodBoolean;
}> = PUBLIC_SIGNAL_RESULT_SCHEMA.extend({
  type: z.string(),
  recommendation: z.string(),
});
export type PublicSignalResult = z.infer<
  typeof PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT
>;

export const JOB_VERDICT_SCHEMA: z.ZodObject<{
  jobKey: z.ZodString;
  run: z.ZodBoolean;
  summary: z.ZodString;
  signals: z.ZodArray<typeof PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT>;
}> = SYNCED_JOB_VERDICT_SCHEMA.extend({
  signals: z.array(PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT),
});
export type JobVerdict = z.infer<typeof JOB_VERDICT_SCHEMA>;

export const DYNAMIC_CI_RESPONSE_SCHEMA: z.ZodObject<{
  jobs: z.ZodArray<typeof JOB_VERDICT_SCHEMA>;
}> = SYNCED_RESPONSE_SCHEMA.extend({ jobs: z.array(JOB_VERDICT_SCHEMA) });
export type DynamicCiResponse = z.infer<typeof DYNAMIC_CI_RESPONSE_SCHEMA>;

/**
 * The same widening on the way out, for the `ignore-signals` passthrough: the
 * caller may name a signal this copy of the contract predates, and the service
 * is the side that can authoritatively reject it. Type-level only — the request
 * is serialized, never parsed, so there is no runtime schema to widen.
 */
export type DynamicCiRequest = Omit<SyncedRequest, "ignoreSignals"> & {
  ignoreSignals?: string[];
};
