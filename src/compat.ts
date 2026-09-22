import * as z from "zod";
import type { components } from "./schema/contract.js";
import contract from "./schema/dynamic-ci-contract.json" with { type: "json" };

// Display-only signal enums are widened to strings: Trunk adds members ahead of
// any sync PR here, and one unrecognized `type` would fail the whole-response
// parse, failing open and silently ungating. See src/schema/README.md.

export type Repo = components["schemas"]["PlanRepo"];

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

export const JOB_VERDICT_SCHEMA: z.ZodObject<{
  jobKey: z.ZodString;
  run: z.ZodBoolean;
  summary: z.ZodString;
  signals: z.ZodArray<typeof PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT>;
}> = z.object({
  jobKey: z.string(),
  run: z.boolean(),
  summary: z.string(),
  signals: z.array(PUBLIC_SIGNAL_RESULT_SCHEMA_COMPAT),
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
