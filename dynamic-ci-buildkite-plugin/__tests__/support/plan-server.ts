import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DYNAMIC_CI_RESPONSE_SCHEMA,
  type DynamicCiResponse,
} from "../../../src/schema/response";

/** What the filter or hook actually sent, captured for assertions. */
export interface CapturedRequest {
  received?: unknown;
}

/**
 * A plan endpoint on loopback, so curl, the request body and the response
 * parsing are all exercised rather than mocked.
 *
 * `run` is async and every caller must await its child processes. A synchronous
 * child would block the event loop this server answers on — which is a hang
 * rather than a failure, and costs a test run to diagnose.
 *
 * The plan is parsed against the engine's own response schema before it is
 * served, so these tests cannot pass against a plan shape the engine would never
 * return. That is the response-side half of what `--print-body` does for the
 * request: both directions of the wire contract fail here rather than in a
 * customer's build.
 */
export const withPlanServer = async (
  plan: DynamicCiResponse,
  captured: CapturedRequest,
  run: (address: string) => Promise<void>,
): Promise<void> => {
  const body = JSON.stringify(DYNAMIC_CI_RESPONSE_SCHEMA.parse(plan));
  const server: Server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (chunk: Buffer) => parts.push(chunk));
    req.on("end", () => {
      captured.received = JSON.parse(Buffer.concat(parts).toString("utf8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the plan server did not bind a port");
    }
    const { port }: AddressInfo = address;
    await run(`http://127.0.0.1:${String(port)}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

/** The agent environment both the filter and the hooks read. */
export const AGENT_ENV = {
  BUILDKITE_REPO: "git@github.com:trunk-io/trunk2.git",
  BUILDKITE_COMMIT: "9f2c1b7c2b4c9d1e0a3f5b6c7d8e9f0a1b2c3d4e",
  BUILDKITE_BRANCH: "feature/x",
  BUILDKITE_PULL_REQUEST: "4213",
  BUILDKITE_BUILD_ID: "01a0a151-99d4-4097-8806-a837f0830d9d",
  BUILDKITE_ORGANIZATION_SLUG: "trunk",
  BUILDKITE_PIPELINE_SLUG: "trunk2-pr",
  TRUNK_TOKEN: "test-token",
} as const;
