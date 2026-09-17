# A plan's skip verdicts as a `jobKey -> reason` object, ready for
# `apply-skips.jq --argjson skips`.
#
# The reason is truncated to Buildkite's 70-character `skip` limit. Truncating
# here rather than in the hook keeps it testable, and keeps the untruncated
# summary available for the log.
def reason: ("Trunk Dynamic CI: " + .summary)[:70];

[.jobs[] | select(.run == false) | {key: .jobKey, value: reason}] | from_entries
