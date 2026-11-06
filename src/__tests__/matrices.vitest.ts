import { describe, expect, it } from "vitest";
import {
  buildMatrixRows,
  MAX_JOB_BYTES,
  MAX_JOBS,
  MAX_TOTAL_BYTES,
} from "../matrices";

/** A one-row array whose text is exactly `bytes` bytes long, padded with `char`. */
const rowsOfBytes = (bytes: number, char = "x"): string => {
  const shell = '[{"pad":""}]';
  const charBytes = Buffer.byteLength(char);
  return `[{"pad":"${char.repeat(Math.floor((bytes - shell.length) / charBytes))}"}]`;
};

describe("buildMatrixRows", () => {
  it("slices each job's rows out as the text written, never re-encoded", () => {
    const tests =
      '[ {"py": 3.10, "n": 1e3, "big": 12345678901234567890},\n  {"config": {"os": "linux"}} ]';
    const image = '[{"image":"gateway"}]';

    expect(
      buildMatrixRows(`{"tests": ${tests}, "image": ${image}}`),
    ).toStrictEqual({
      matrixRows: { tests, image },
      matrixRowsOmitted: [],
    });
  });

  it("skips a job with no rows and drops one whose value is not a list", () => {
    expect(
      buildMatrixRows(
        '{"empty": [], "object": {"include": []}, "ok": [{"a": 1}]}',
      ),
    ).toStrictEqual({
      matrixRows: { ok: '[{"a": 1}]' },
      matrixRowsOmitted: [],
    });
  });

  it.each([
    { name: "unset", raw: "" },
    { name: "not JSON", raw: "{tests: [}" },
    { name: "a list, not an object", raw: '[{"a": 1}]' },
    { name: "only empty jobs", raw: '{"tests": []}' },
  ])("sends nothing when the input is $name", ({ raw }) => {
    expect(buildMatrixRows(raw)).toBeUndefined();
  });

  it("leaves out a job over the per-job cap, measured in bytes", () => {
    // "é" is two bytes: under the cap in length, over it in bytes.
    const big = rowsOfBytes(MAX_JOB_BYTES + 2, "é");
    expect(big.length).toBeLessThan(MAX_JOB_BYTES);

    expect(
      buildMatrixRows(`{"big": ${big}, "small": [{"a": 1}]}`),
    ).toStrictEqual({
      matrixRows: { small: '[{"a": 1}]' },
      matrixRowsOmitted: ["big"],
    });
  });

  it("sends a job of exactly the per-job cap", () => {
    const rows = rowsOfBytes(MAX_JOB_BYTES);
    expect(Buffer.byteLength(rows)).toBe(MAX_JOB_BYTES);

    expect(buildMatrixRows(`{"job": ${rows}}`)?.matrixRows).toStrictEqual({
      job: rows,
    });
  });

  it("leaves out the jobs past the total cap, keeping the earlier ones", () => {
    const rows = rowsOfBytes(MAX_JOB_BYTES);
    const jobs = MAX_TOTAL_BYTES / MAX_JOB_BYTES + 1;
    const keys = Array.from({ length: jobs }, (_, i) => `job_${String(i)}`);

    const built = buildMatrixRows(
      `{${keys.map((key) => `"${key}": ${rows}`).join(", ")}}`,
    );

    expect({
      sent: Object.keys(built?.matrixRows ?? {}),
      omitted: built?.matrixRowsOmitted,
    }).toStrictEqual({
      sent: keys.slice(0, jobs - 1),
      omitted: [keys[jobs - 1]],
    });
  });

  it("sends the first jobs up to the job cap, in input order", () => {
    const keys = Array.from(
      { length: MAX_JOBS + 1 },
      (_, i) => `job_${String(i)}`,
    );

    const built = buildMatrixRows(
      `{${keys.map((key) => `"${key}": [{"a": 1}]`).join(", ")}}`,
    );

    expect({
      sent: Object.keys(built?.matrixRows ?? {}),
      omitted: built?.matrixRowsOmitted,
    }).toStrictEqual({
      sent: keys.slice(0, MAX_JOBS),
      omitted: [keys[MAX_JOBS]],
    });
  });
});
