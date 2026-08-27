// Generated file — do not edit by hand.
// Synced from Trunk's internal contract definition; edit it there instead.

import * as z from "zod";
import { PUBLIC_SIGNAL_RESULT_SCHEMA } from "./signals";

export const JOB_VERDICT_SCHEMA: z.ZodObject<{
  jobKey: z.ZodString;
  run: z.ZodBoolean;
  summary: z.ZodString;
  signals: z.ZodArray<typeof PUBLIC_SIGNAL_RESULT_SCHEMA>;
}> = z.object({
  jobKey: z.string(),
  run: z.boolean(),
  summary: z.string(),
  signals: z.array(PUBLIC_SIGNAL_RESULT_SCHEMA),
});
export type JobVerdict = z.infer<typeof JOB_VERDICT_SCHEMA>;

export const PLAN_NOTICE_SCHEMA: z.ZodObject<{
  code: z.ZodString;
  message: z.ZodString;
}> = z.object({
  code: z.string(),
  message: z.string(),
});
export type PlanNotice = z.infer<typeof PLAN_NOTICE_SCHEMA>;

export const DYNAMIC_CI_RESPONSE_SCHEMA: z.ZodObject<{
  jobs: z.ZodArray<typeof JOB_VERDICT_SCHEMA>;
  notice: z.ZodOptional<typeof PLAN_NOTICE_SCHEMA>;
}> = z.object({
  jobs: z.array(JOB_VERDICT_SCHEMA),
  notice: PLAN_NOTICE_SCHEMA.optional(),
});
export type DynamicCiResponse = z.infer<typeof DYNAMIC_CI_RESPONSE_SCHEMA>;
