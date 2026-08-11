import * as z from "zod";
import { PUBLIC_SIGNAL_RESULT_SCHEMA } from "./signals";

/** Per-job verdict. `signals` is what the action logs and annotates. */
export const JOB_VERDICT_SCHEMA: z.ZodObject<{
  jobName: z.ZodString;
  run: z.ZodBoolean;
  summary: z.ZodString;
  signals: z.ZodArray<typeof PUBLIC_SIGNAL_RESULT_SCHEMA>;
}> = z.object({
  jobName: z.string(),
  run: z.boolean(),
  summary: z.string(),
  signals: z.array(PUBLIC_SIGNAL_RESULT_SCHEMA),
});
export type JobVerdict = z.infer<typeof JOB_VERDICT_SCHEMA>;

/** Response payload: service → action. Unknown keys are ignored, not rejected. */
export const DYNAMIC_CI_RESPONSE_SCHEMA: z.ZodObject<{
  jobs: z.ZodArray<typeof JOB_VERDICT_SCHEMA>;
}> = z.object({
  jobs: z.array(JOB_VERDICT_SCHEMA),
});
export type DynamicCiResponse = z.infer<typeof DYNAMIC_CI_RESPONSE_SCHEMA>;
