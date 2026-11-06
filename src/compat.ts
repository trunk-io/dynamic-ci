import * as z from "zod";
import type { components } from "./schema/contract.js";
import contract from "./schema/dynamic-ci-contract.json" with { type: "json" };

// Display-only signal enums are widened to strings: Trunk adds members ahead of
// any sync PR here, and one unrecognized `type` would fail the whole-response
// parse, failing open and silently ungating. See src/schema/README.md.

export type Repo = components["schemas"]["PlanRepo"];

export type Impact = components["schemas"]["PlanImpact"];

export const SIGNAL_TYPES: readonly string[] =
  contract.components.schemas.SignalType.enum;

export const PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT: z.ZodObject<{
  type: z.ZodString;
  recommendation: z.ZodString;
  message: z.ZodString;
  ignored: z.ZodBoolean;
}> = z.object({
  type: z.string(),
  recommendation: z.string(),
  message: z.string(),
  ignored: z.boolean(),
});
export type PublicSignalResult = z.infer<
  typeof PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT
>;

export const PLAN_NOTICE_SCHEMA: z.ZodObject<{
  code: z.ZodString;
  message: z.ZodString;
}> = z.object({ code: z.string(), message: z.string() });

export const VARIATION_VERDICT_SCHEMA: z.ZodObject<{
  match: z.ZodRecord<z.ZodString, z.ZodUnknown>;
  group: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  run: z.ZodBoolean;
  summary: z.ZodString;
}> = z.object({
  match: z.record(z.string(), z.unknown()),
  group: z.record(z.string(), z.unknown()).optional(),
  run: z.boolean(),
  summary: z.string(),
});
export type VariationVerdict = z.infer<typeof VARIATION_VERDICT_SCHEMA>;

// Strings, never parsed: each is set as an output byte for byte, and a
// re-encoded row or value renames a leg or fails the customer's job.
export const PRUNE_SCHEMA: z.ZodObject<{
  exclude: z.ZodOptional<z.ZodString>;
  matrix: z.ZodOptional<z.ZodString>;
  include: z.ZodOptional<z.ZodString>;
}> = z.object({
  exclude: z.string().optional(),
  matrix: z.string().optional(),
  include: z.string().optional(),
});
export type Prune = z.infer<typeof PRUNE_SCHEMA>;

export const JOB_VERDICT_SCHEMA: z.ZodObject<{
  jobKey: z.ZodString;
  run: z.ZodBoolean;
  summary: z.ZodString;
  signals: z.ZodArray<typeof PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT>;
  variations: z.ZodOptional<z.ZodArray<typeof VARIATION_VERDICT_SCHEMA>>;
  prune: z.ZodOptional<typeof PRUNE_SCHEMA>;
}> = z.object({
  jobKey: z.string(),
  run: z.boolean(),
  summary: z.string(),
  signals: z.array(PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT),
  variations: z.array(VARIATION_VERDICT_SCHEMA).optional(),
  prune: PRUNE_SCHEMA.optional(),
});
export type JobVerdict = z.infer<typeof JOB_VERDICT_SCHEMA>;

export const DYNAMIC_CI_RESPONSE_SCHEMA: z.ZodObject<{
  jobs: z.ZodArray<typeof JOB_VERDICT_SCHEMA>;
  notice: z.ZodOptional<typeof PLAN_NOTICE_SCHEMA>;
}> = z.object({
  jobs: z.array(JOB_VERDICT_SCHEMA),
  notice: PLAN_NOTICE_SCHEMA.optional(),
});
export type DynamicCiResponse = z.infer<typeof DYNAMIC_CI_RESPONSE_SCHEMA>;

export type DynamicCiRequest = Omit<
  components["schemas"]["CiPlanRequest"],
  "ignoreSignals"
> & { ignoreSignals?: string[] };

// The contract with exactly this file's widening applied. Asserting BOTH
// directions against it is what makes a field added or dropped upstream a
// compile error here rather than a value silently stripped at parse time.
type WidenedSignalResult = Omit<
  components["schemas"]["SignalResult"],
  "type" | "recommendation"
> & { type: string; recommendation: string };
type WidenedJobVerdict = Omit<
  components["schemas"]["JobVerdict"],
  "signals"
> & { signals: WidenedSignalResult[] };
type WidenedPlan = Omit<components["schemas"]["CiPlan"], "jobs"> & {
  jobs: WidenedJobVerdict[];
};

type Parsed = z.input<typeof DYNAMIC_CI_RESPONSE_SCHEMA>;
type MatchesContract = WidenedPlan extends Parsed
  ? Parsed extends WidenedPlan
    ? true
    : never
  : never;
const matchesContract: MatchesContract = true;
void matchesContract;

// Assignability alone misses an OPTIONAL field the contract adds: the parser
// would strip it with no type error, as `variations` and `prune` would have
// been. The key sets must match too.
type SameKeys<A, B> = [
  Exclude<keyof A, keyof B>,
  Exclude<keyof B, keyof A>,
] extends [never, never]
  ? true
  : never;
const jobVerdictKeysMatch: SameKeys<
  WidenedJobVerdict,
  z.input<typeof JOB_VERDICT_SCHEMA>
> = true;
const planKeysMatch: SameKeys<WidenedPlan, Parsed> = true;
// `dropSetup` and `adjustments` are the Buildkite plugin's outputs; a GitHub
// plan never carries them, so the parser leaves them out on purpose.
const pruneKeysMatch: SameKeys<
  Omit<components["schemas"]["Prune"], "dropSetup" | "adjustments">,
  z.input<typeof PRUNE_SCHEMA>
> = true;
const variationKeysMatch: SameKeys<
  components["schemas"]["VariationVerdict"],
  z.input<typeof VARIATION_VERDICT_SCHEMA>
> = true;
void [jobVerdictKeysMatch, planKeysMatch, pruneKeysMatch, variationKeysMatch];
