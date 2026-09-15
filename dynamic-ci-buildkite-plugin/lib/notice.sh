#!/usr/bin/env bash
# The plan's `notice`, surfaced to the build log.
#
# A plan that skips nothing looks identical whatever the reason — an
# organization not enabled yet, a repository in shadow mode, a pipeline Trunk has
# not ingested, a merge-queue branch, an engine outage. `notice` is the only
# thing that tells them apart, and without it a customer's first build reads as
# "the plugin did nothing" with no way to find out why.

# Logs the plan's notice, if it carries one. Never fails: a plan with no notice
# is the ordinary case, and a malformed one must not break an upload.
dci_log_notice() {
    local jq_bin="$1" plan="$2" message
    message="$("${jq_bin}" -r '.notice.message // empty' <<<"${plan}" 2>/dev/null)" || return 0
    if [[ -n ${message} ]]; then
        echo "--- :trunk: ${message}" >&2
    fi
}
