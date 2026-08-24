import * as z from "zod";
import { SIGNAL_TYPE_SCHEMA } from "./signals";

export const REPO_SCHEMA: z.ZodObject<{
  host: z.ZodDefault<z.ZodString>;
  owner: z.ZodString;
  name: z.ZodString;
}> = z.object({
  host: z
    .string()
    .default("github.com")
    .describe("Disambiguates GitHub.com from a GitHub Enterprise Server host."),
  owner: z.string(),
  name: z.string(),
});
export type Repo = z.infer<typeof REPO_SCHEMA>;

// The changed file set is deliberately absent: the service derives the diff from
// `baseSha`/`commitSha`, so the action never assumes a full checkout on the runner.
export const DYNAMIC_CI_REQUEST_SCHEMA: z.ZodObject<{
  repo: typeof REPO_SCHEMA;
  commitSha: z.ZodString;
  baseSha: z.ZodNullable<z.ZodString>;
  branch: z.ZodString;
  prNumber: z.ZodNullable<z.ZodNumber>;
  runId: z.ZodString;
  runAttempt: z.ZodNumber;
  triggeringActor: z.ZodOptional<z.ZodString>;
  eventName: z.ZodOptional<z.ZodString>;
  workflowPath: z.ZodString;
  workflowName: z.ZodString;
  jobNames: z.ZodDefault<z.ZodArray<z.ZodString>>;
  ignoreSignals: z.ZodOptional<z.ZodArray<typeof SIGNAL_TYPE_SCHEMA>>;
}> = z.object({
  repo: REPO_SCHEMA,
  commitSha: z.string(),
  baseSha: z.string().nullable().describe("Null for non-pull-request events."),
  branch: z.string(),
  prNumber: z
    .number()
    .int()
    .nullable()
    .describe("Null for non-pull-request events."),
  runId: z
    .string()
    .describe(
      "github.run_id: pins the workflow run that got the recommendation.",
    ),
  runAttempt: z
    .number()
    .int()
    .describe("github.run_attempt: disambiguates re-runs."),
  triggeringActor: z
    .string()
    .optional()
    .describe("github.triggering_actor: who initiated this run/rerun."),
  eventName: z
    .string()
    .optional()
    .describe("github.event_name: pull_request, workflow_dispatch, push, …."),
  workflowPath: z
    .string()
    .describe(
      "Workflow file path from github.workflow_ref, e.g. .github/workflows/ci.yml.",
    ),
  workflowName: z.string().describe("github.workflow."),
  jobNames: z
    .array(z.string())
    .default([])
    .describe(
      "Jobs to scope the recommendation to. Empty means every job in the workflow.",
    ),
  ignoreSignals: z
    .array(SIGNAL_TYPE_SCHEMA)
    .optional()
    .describe(
      "Signals to drop from the verdict tally. An unknown id fails validation.",
    ),
});
export type DynamicCiRequest = z.infer<typeof DYNAMIC_CI_REQUEST_SCHEMA>;
