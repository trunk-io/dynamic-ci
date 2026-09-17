import * as z from "zod";

/**
 * How these tests narrow jq's output.
 *
 * jq hands back `unknown`, and hand-rolled narrowing does not survive this
 * repo's lint rules — `Array.isArray` on an unknown property widens to `any[]`,
 * which is both unsafe and banned. So every test that reads a step out of jq's
 * output goes through these.
 *
 * A step is deliberately `Record<string, unknown>` rather than a modelled
 * Buildkite step. `apply-skips.jq` reads `.key`, `.trigger`, `.steps` and
 * `.skip` and treats everything else as opaque — that opacity is the property
 * the tests exist to pin, so typing the fixtures against Buildkite's own schema
 * would encode a shape the mutation is specifically designed not to depend on.
 */
export const STEP_SCHEMA: z.ZodRecord<z.ZodString, z.ZodUnknown> = z.record(
  z.string(),
  z.unknown(),
);

export const PIPELINE_SCHEMA: z.ZodObject<{
  steps: z.ZodArray<typeof STEP_SCHEMA>;
}> = z.object({ steps: z.array(STEP_SCHEMA) });

export const pipelineSteps = (out: unknown): Record<string, unknown>[] =>
  PIPELINE_SCHEMA.parse(out).steps;

/** One top-level step by its `key`, so the assertion is type-checked. */
export const stepByKey = (
  out: unknown,
  key: string,
): Record<string, unknown> => {
  const step = pipelineSteps(out).find((candidate) => candidate["key"] === key);
  if (step === undefined) {
    throw new Error(`no step keyed ${key} in jq's output`);
  }
  return step;
};

/** The children of a pipeline's one `group:` step. */
export const groupChildren = (out: unknown): Record<string, unknown>[] => {
  const group = pipelineSteps(out).find((step) => "group" in step);
  if (group === undefined) {
    throw new Error("jq did not return the fixture's group step");
  }
  return z.array(STEP_SCHEMA).parse(group["steps"]);
};
