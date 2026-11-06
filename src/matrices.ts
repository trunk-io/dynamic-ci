import { type ParseError, parseTree } from "jsonc-parser";
import { warn } from "./annotations";

/**
 * Caps on the rows sent, the same limits Trunk applies to `matrixRows`. Trunk
 * refuses a plan request over 512 KiB, which would decide every job whole, so
 * the rows keep under half of it.
 */
export const MAX_JOB_BYTES: number = 64 * 1024;
export const MAX_TOTAL_BYTES: number = 256 * 1024;
export const MAX_JOBS = 64;

export interface MatrixRows {
  /** Job key → its rows array, the exact text the planner emitted. */
  matrixRows: Record<string, string>;
  /** The jobs left out for size, at most {@link MAX_JOBS}. */
  matrixRowsOmitted: string[];
}

const JSON_ONLY = { disallowComments: true, allowTrailingComma: false };

/**
 * The `matrices` input, a JSON object of job key → the rows its runtime matrix
 * is built from. Each job's array is sliced out of the input as text, never
 * parsed and re-encoded: Trunk names legs from that text and returns the kept
 * rows in it, and `JSON.parse` would turn `3.10` into `3.1`, renaming a leg.
 *
 * Nothing here fails the step. An unreadable input sends no rows, a value that
 * is not an array is dropped with a warning, an empty one is skipped (the
 * planner made nothing to decide), and a job past the caps is left out with a
 * warning and named in `matrixRowsOmitted`. Each such job is decided whole.
 */
export const buildMatrixRows = (raw: string): MatrixRows | undefined => {
  if (raw.trim() === "") {
    return undefined;
  }
  const errors: ParseError[] = [];
  const root = parseTree(raw, errors, JSON_ONLY);
  if (root?.type !== "object" || errors.length > 0) {
    warn("matrices: not a JSON object; sending no matrix rows.");
    return undefined;
  }

  const matrixRows: Record<string, string> = {};
  const omitted: string[] = [];
  let total = 0;
  for (const property of root.children ?? []) {
    const [key, value] = property.children ?? [];
    if (key === undefined || value === undefined) {
      continue;
    }
    const jobKey = String(key.value);
    if (value.type !== "array") {
      warn(`matrices.${jobKey}: not a JSON list of rows; deciding it whole.`);
      continue;
    }
    if ((value.children ?? []).length === 0) {
      continue;
    }
    const text = raw.slice(value.offset, value.offset + value.length);
    const bytes = Buffer.byteLength(text);
    if (
      bytes > MAX_JOB_BYTES ||
      total + bytes > MAX_TOTAL_BYTES ||
      Object.keys(matrixRows).length >= MAX_JOBS
    ) {
      omitted.push(jobKey);
      continue;
    }
    matrixRows[jobKey] = text;
    total += bytes;
  }
  if (omitted.length > 0) {
    warn(
      `matrices: too large to send in full; deciding these jobs whole: ${omitted.join(", ")}.`,
    );
  }
  if (Object.keys(matrixRows).length === 0 && omitted.length === 0) {
    return undefined;
  }
  return { matrixRows, matrixRowsOmitted: omitted.slice(0, MAX_JOBS) };
};
