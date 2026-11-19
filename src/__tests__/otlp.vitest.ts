import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planMetricsRequest, type PlanMetrics } from "../telemetry/otlp";
import { PLAN_REASON, PLAN_STATUS } from "../telemetry/protos";

// A copy of trunk2's `ts/apps/public-api/src/products/telemetry/__tests__/dynamic-ci-metrics.json`,
// the body its route tests read; the two must stay byte-equal.
const PINNED_BODY: unknown = JSON.parse(
  readFileSync(
    new URL("__fixtures__/plan-metrics.json", import.meta.url),
    "utf8",
  ),
);

const PLAN: PlanMetrics = {
  version: "github/v1",
  environment: "production",
  status: PLAN_STATUS.success,
  reason: PLAN_REASON.none,
  attempts: 2,
  durationMs: 1_234,
  jobCount: 7,
  inputs: { changedFiles: "checkout", workflowFileSha: "api" },
  nowMs: 1_763_560_801_234,
};

interface Body {
  resourceMetrics: {
    scopeMetrics: {
      metrics: {
        name: string;
        sum?: { dataPoints: { attributes: unknown[] }[] };
        histogram?: { dataPoints: { bucketCounts: string[] }[] };
      }[];
    }[];
  }[];
}

const metricsOf = (plan: PlanMetrics) =>
  (planMetricsRequest(plan) as Body).resourceMetrics[0]?.scopeMetrics[0]
    ?.metrics ?? [];

describe("planMetricsRequest", () => {
  it("writes the body trunk2's route is pinned to", () => {
    expect(planMetricsRequest(PLAN)).toEqual(PINNED_BODY);
  });

  it("sends no attempts or input sources it does not have", () => {
    expect(
      metricsOf({ ...PLAN, attempts: 0, inputs: undefined })[0]?.sum
        ?.dataPoints[0]?.attributes,
    ).toEqual([
      {
        key: "trunk.dynamic_ci.plan.status",
        value: { stringValue: "success" },
      },
      { key: "trunk.dynamic_ci.plan.reason", value: { stringValue: "" } },
    ]);
  });

  it("reads an input it did not send as none", () => {
    expect(
      metricsOf({
        ...PLAN,
        status: PLAN_STATUS.failed,
        reason: PLAN_REASON.timeout,
        attempts: 3,
        inputs: { changedFiles: undefined, workflowFileSha: undefined },
      })[0]?.sum?.dataPoints[0]?.attributes,
    ).toEqual([
      { key: "trunk.dynamic_ci.plan.status", value: { stringValue: "failed" } },
      {
        key: "trunk.dynamic_ci.plan.reason",
        value: { stringValue: "timeout" },
      },
      { key: "trunk.dynamic_ci.plan.attempts", value: { intValue: "3" } },
      {
        key: "trunk.dynamic_ci.plan.changed_files_source",
        value: { stringValue: "none" },
      },
      {
        key: "trunk.dynamic_ci.plan.workflow_file_sha_source",
        value: { stringValue: "none" },
      },
    ]);
  });

  it.each([
    { name: "a duration over 600s", plan: { ...PLAN, durationMs: 600_001 } },
    { name: "over 256 jobs", plan: { ...PLAN, jobCount: 257 } },
  ])("leaves out the histogram trunk2 would reject for $name", ({ plan }) => {
    expect(metricsOf(plan).map((metric) => metric.name)).toEqual([
      "trunk.dynamic_ci.plans",
      plan.jobCount > 256
        ? "trunk.dynamic_ci.plan.duration"
        : "trunk.dynamic_ci.plan.jobs",
    ]);
  });

  it.each([
    { name: "zero jobs", jobCount: 0, bucket: 0 },
    { name: "one job", jobCount: 1, bucket: 1 },
    { name: "250 jobs", jobCount: 250, bucket: 8 },
    { name: "256 jobs", jobCount: 256, bucket: 9 },
  ])("puts $name in bucket $bucket", ({ jobCount, bucket }) => {
    expect(
      metricsOf({ ...PLAN, jobCount })[2]?.histogram?.dataPoints[0]
        ?.bucketCounts,
    ).toEqual(Array.from({ length: 10 }, (_, i) => (i === bucket ? "1" : "0")));
  });
});
