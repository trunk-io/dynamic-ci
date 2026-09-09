import protobuf from "protobufjs";

// Reflection rather than generated code, as in analytics-uploader — see CONTRIBUTING.
// Half of a cross-repo contract with trunk1's telemetry-service: field numbers and
// enum values must change together, and nothing fails if they drift.
export const Repo: protobuf.Type = new protobuf.Type("Repo")
  .add(new protobuf.Field("host", 1, "string"))
  .add(new protobuf.Field("owner", 2, "string"))
  .add(new protobuf.Field("name", 3, "string"));

export const PLAN_STATUS = {
  unspecified: 0,
  success: 1,
  failed: 2,
  omitted: 3,
} as const;

// Kept low-cardinality by this action; the receiver bounds length and charset.
export const PLAN_REASON = {
  none: "",
  engineUnavailable: "engine_unavailable",
  httpServerError: "http_server_error",
  httpClientError: "http_client_error",
  httpRateLimited: "http_rate_limited",
  timeout: "timeout",
  transport: "transport",
  invalidResponse: "invalid_response",
  noVerdicts: "no_verdicts",
  internal: "internal",
  mergeQueueBranch: "merge_queue_branch",
  orgNotEnabled: "org_not_enabled",
  repoNotEnabled: "repo_not_enabled",
  workflowNotRecognized: "workflow_not_recognized",
} as const;

export const PlanRequestMetrics: protobuf.Type = new protobuf.Type(
  "PlanRequestMetrics",
)
  .add(new protobuf.Field("action_version", 1, "string"))
  .add(new protobuf.Field("repo", 2, "Repo"))
  .add(new protobuf.Field("status", 3, "int32"))
  .add(new protobuf.Field("reason", 4, "string"))
  .add(new protobuf.Field("attempts", 5, "uint32"))
  .add(new protobuf.Field("duration_ms", 6, "uint32"))
  .add(new protobuf.Field("job_count", 7, "uint32"))
  .add(Repo);
