// Generated file — do not edit by hand.
// Synced from Trunk's internal contract definition; edit it there instead.

import * as z from "zod";

export const SIGNAL_TYPES = [
  "estimated-cost",
  "previous-result-on-pr",
  "historical-pass-rate",
  "diff-driven-volatility",
  "force-override",
  "merge-failure",
  "mid-pr-stack",
  "required-check",
] as const;

export const SIGNAL_TYPE_SCHEMA: z.ZodEnum<{
  [K in (typeof SIGNAL_TYPES)[number]]: K;
}> = z.enum(SIGNAL_TYPES);
export type SignalType = z.infer<typeof SIGNAL_TYPE_SCHEMA>;

export const RECOMMENDATIONS = [
  "MUST_RUN",
  "VOTE_RUN",
  "VOTE_NO_RUN",
  "NEVER_RUN",
  "INCOMPLETE",
  "ABSTAIN",
] as const;

export const RECOMMENDATION_SCHEMA: z.ZodEnum<{
  [K in (typeof RECOMMENDATIONS)[number]]: K;
}> = z.enum(RECOMMENDATIONS);
export type Recommendation = z.infer<typeof RECOMMENDATION_SCHEMA>;

export const PUBLIC_SIGNAL_RESULT_SCHEMA: z.ZodObject<{
  type: z.ZodEnum<{ [K in (typeof SIGNAL_TYPES)[number]]: K }>;
  recommendation: z.ZodEnum<{ [K in (typeof RECOMMENDATIONS)[number]]: K }>;
  message: z.ZodString;
  ignored: z.ZodBoolean;
}> = z.object({
  type: SIGNAL_TYPE_SCHEMA,
  recommendation: RECOMMENDATION_SCHEMA,
  message: z.string().describe("Human-readable rationale, surfaced in logs."),
  ignored: z
    .boolean()
    .describe(
      "Dropped from the verdict tally via the request's ignoreSignals.",
    ),
});
export type PublicSignalResult = z.infer<typeof PUBLIC_SIGNAL_RESULT_SCHEMA>;
