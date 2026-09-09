import protobuf from "protobufjs";

// Reflection rather than generated code, as in analytics-uploader — see CONTRIBUTING.
// Half of a cross-repo contract with trunk1's telemetry-service: field numbers and
// enum values must change together, and nothing fails if they drift.
export const Semver: protobuf.Type = new protobuf.Type("Semver")
  .add(new protobuf.Field("major", 1, "uint32"))
  .add(new protobuf.Field("minor", 2, "uint32"))
  .add(new protobuf.Field("patch", 3, "uint32"))
  .add(new protobuf.Field("suffix", 4, "string"));

export const Repo: protobuf.Type = new protobuf.Type("Repo")
  .add(new protobuf.Field("host", 1, "string"))
  .add(new protobuf.Field("owner", 2, "string"))
  .add(new protobuf.Field("name", 3, "string"));

export const PLAN_STATUS = {
  unspecified: 0,
  success: 1,
  failed: 2,
  skipped: 3,
} as const;

// Set only when FAILED or SKIPPED. An enum, never a string: the receiver makes this a
// Prometheus label, and free text from a client is an unbounded label value.
export const PLAN_REASON = {
  unspecified: 0,
  engineUnavailable: 1,
  httpServerError: 2,
  httpClientError: 3,
  httpRateLimited: 4,
  timeout: 5,
  transport: 6,
  invalidResponse: 7,
  noVerdicts: 8,
  internal: 9,
  mergeQueueBranch: 10,
  orgNotEnabled: 11,
  repoNotEnabled: 12,
  workflowNotRecognized: 13,
} as const;

export const PlanRequestMetrics: protobuf.Type = new protobuf.Type(
  "PlanRequestMetrics",
)
  .add(new protobuf.Field("action_version", 1, "Semver"))
  .add(new protobuf.Field("repo", 2, "Repo"))
  .add(new protobuf.Field("status", 3, "int32"))
  .add(new protobuf.Field("reason", 4, "int32"))
  .add(new protobuf.Field("attempts", 5, "uint32"))
  .add(new protobuf.Field("duration_ms", 6, "uint32"))
  .add(Semver)
  .add(Repo);
