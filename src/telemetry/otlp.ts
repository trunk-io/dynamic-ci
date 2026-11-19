import type { ChangedFilesSource } from "../changed-files";
import type { WorkflowFileShaSource } from "../workflow-file-sha";
import { PLAN_STATUS } from "./protos";

// Half of a cross-repo contract with trunk2's public-api
// (`ts/apps/public-api/src/products/telemetry/dynamic-ci-metrics.ts`): a name, unit,
// label value or bucket it does not list is rejected there with no error here.
export const SERVICE_NAME = "trunk-dynamic-ci";

export const DURATION_BOUNDS_SECONDS: readonly number[] = [
  0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600,
];

export const JOB_BOUNDS: readonly number[] = [0, 1, 2, 5, 10, 25, 50, 100, 250];

const MAX_PLAN_SECONDS = 600;
const MAX_JOBS = 256;
const MAX_ATTEMPTS = 3;
const AGGREGATION_TEMPORALITY_DELTA = 1;
const NANOS_PER_MS = 1_000_000n;
const MS_PER_SECOND = 1_000;

const STATUS_LABEL: Record<number, string | undefined> = {
  [PLAN_STATUS.success]: "success",
  [PLAN_STATUS.failed]: "failed",
  [PLAN_STATUS.omitted]: "omitted",
};

const INPUT_SOURCE_LABEL = {
  checkout: "checkout",
  api: "github_api",
} as const satisfies Record<ChangedFilesSource | WorkflowFileShaSource, string>;

type OtlpValue = { stringValue: string } | { intValue: string };
interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

const text = (key: string, value: string): OtlpAttribute => ({
  key,
  value: { stringValue: value },
});

const int = (key: string, value: number): OtlpAttribute => ({
  key,
  value: { intValue: String(value) },
});

const bucketCounts = (value: number, bounds: readonly number[]): string[] => {
  const found = bounds.findIndex((bound) => value <= bound);
  const bucket = found === -1 ? bounds.length : found;
  return Array.from({ length: bounds.length + 1 }, (_, i) =>
    i === bucket ? "1" : "0",
  );
};

export interface PlanMetrics {
  version: string;
  environment: "production" | "staging";
  status: number;
  reason: string;
  attempts: number;
  durationMs: number;
  jobCount: number;
  inputs?: {
    changedFiles: ChangedFilesSource | undefined;
    workflowFileSha: WorkflowFileShaSource | undefined;
  };
  nowMs: number;
}

// A duration or job count trunk2 would reject is left out rather than sent.
export const planMetricsRequest = (plan: PlanMetrics): unknown => {
  const durationMs = Math.max(0, Math.round(plan.durationMs));
  const seconds = durationMs / MS_PER_SECOND;
  const time = (BigInt(plan.nowMs) * NANOS_PER_MS).toString();
  const startTime = (BigInt(plan.nowMs - durationMs) * NANOS_PER_MS).toString();
  const status = text(
    "trunk.dynamic_ci.plan.status",
    STATUS_LABEL[plan.status] ?? "unspecified",
  );
  const inputs =
    plan.inputs === undefined
      ? []
      : [
          text(
            "trunk.dynamic_ci.plan.changed_files_source",
            plan.inputs.changedFiles === undefined
              ? "none"
              : INPUT_SOURCE_LABEL[plan.inputs.changedFiles],
          ),
          text(
            "trunk.dynamic_ci.plan.workflow_file_sha_source",
            plan.inputs.workflowFileSha === undefined
              ? "none"
              : INPUT_SOURCE_LABEL[plan.inputs.workflowFileSha],
          ),
        ];
  const attempts =
    plan.attempts > 0 && plan.attempts <= MAX_ATTEMPTS
      ? [int("trunk.dynamic_ci.plan.attempts", plan.attempts)]
      : [];
  const histogram = (
    name: string,
    unit: string,
    value: number,
    bounds: readonly number[],
  ) => ({
    name,
    unit,
    histogram: {
      aggregationTemporality: AGGREGATION_TEMPORALITY_DELTA,
      dataPoints: [
        {
          attributes: [status],
          startTimeUnixNano: startTime,
          timeUnixNano: time,
          count: "1",
          sum: value,
          min: value,
          max: value,
          explicitBounds: bounds,
          bucketCounts: bucketCounts(value, bounds),
        },
      ],
    },
  });

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            text("service.name", SERVICE_NAME),
            text("service.version", plan.version),
            text("deployment.environment.name", plan.environment),
          ],
        },
        scopeMetrics: [
          {
            scope: { name: SERVICE_NAME, version: plan.version },
            metrics: [
              {
                name: "trunk.dynamic_ci.plans",
                unit: "{plan}",
                sum: {
                  aggregationTemporality: AGGREGATION_TEMPORALITY_DELTA,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      attributes: [
                        status,
                        text("trunk.dynamic_ci.plan.reason", plan.reason),
                        ...attempts,
                        ...inputs,
                      ],
                      startTimeUnixNano: startTime,
                      timeUnixNano: time,
                      asInt: "1",
                    },
                  ],
                },
              },
              ...(seconds <= MAX_PLAN_SECONDS
                ? [
                    histogram(
                      "trunk.dynamic_ci.plan.duration",
                      "s",
                      seconds,
                      DURATION_BOUNDS_SECONDS,
                    ),
                  ]
                : []),
              ...(Number.isInteger(plan.jobCount) &&
              plan.jobCount >= 0 &&
              plan.jobCount <= MAX_JOBS
                ? [
                    histogram(
                      "trunk.dynamic_ci.plan.jobs",
                      "{job}",
                      plan.jobCount,
                      JOB_BOUNDS,
                    ),
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
};
