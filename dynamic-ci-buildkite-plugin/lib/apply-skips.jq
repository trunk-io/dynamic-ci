# Add `skip` to the steps a plan says to skip. JSON in, JSON out, no I/O.
#
# This is the whole mutation. It is deliberately small enough to audit in one
# sitting, because it is the only thing in this plugin that changes what a
# customer's build does.
#
# Four properties, each pinned by a test in `__tests__/apply-skips.vitest.ts`:
#   * only `skip` is ever written — nothing else is added, removed or reordered
#   * a step the plan did not name is emitted unchanged
#   * a customer's own `skip` always wins, including `skip: false`
#   * groups are handled by the same recursion as the top level
def apply_skips($skips):
  (if has("steps") then .steps |= map(apply_skips($skips)) else . end)
  | if (.key != null) and ($skips[.key] != null) and (has("skip") | not)
    then .skip = $skips[.key]
    else . end;

.steps |= map(apply_skips($skips))
