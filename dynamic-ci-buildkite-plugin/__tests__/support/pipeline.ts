/**
 * A rendered pipeline shaped like what `pipeline upload --dry-run --format json`
 * emits, covering every case the mutation has to get right in one document: a
 * plain keyed step, a step the customer already skipped, a step the customer
 * explicitly forced on, a step with no `key:`, a `group:` whose children are
 * keyed, a `depends_on` pointing at a step the plan skips, and a `wait`.
 */
export const RENDERED_PIPELINE = {
  steps: [
    { key: "unit", label: "Unit", command: "make test" },
    {
      key: "lint",
      label: "Lint",
      command: "make lint",
      skip: "customer said so",
    },
    { key: "fmt", label: "Fmt", command: "make fmt", skip: false },
    { label: "unkeyed", command: "echo hi" },
    {
      group: "Tests",
      steps: [
        { key: "e2e", label: "E2E", command: "make e2e", depends_on: "unit" },
        { key: "smoke", label: "Smoke", command: "make smoke" },
      ],
    },
    { wait: null },
    { key: "downstream", label: "Trigger core", trigger: "core" },
    {
      key: "gate-enter",
      label: "Enter gate",
      command: "true",
      concurrency_group: "duration-updater-gate",
    },
    {
      key: "gate-exit",
      label: "Exit gate",
      command: "true",
      concurrency_group: "duration-updater-gate",
    },
  ],
} as const;
