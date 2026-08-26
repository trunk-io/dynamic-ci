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

export const DYNAMIC_CI_RESPONSE_SCHEMA: z.ZodObject<{
  jobs: z.ZodArray<typeof JOB_VERDICT_SCHEMA>;
}> = z.object({
  jobs: z.array(JOB_VERDICT_SCHEMA),
});
export type DynamicCiResponse = z.infer<typeof DYNAMIC_CI_RESPONSE_SCHEMA>;
