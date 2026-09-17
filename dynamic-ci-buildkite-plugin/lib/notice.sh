#!/usr/bin/env bash
# The plan's `notice`, surfaced to the build log.
#
# A plan that skips nothing looks identical from here whatever the reason, and
# the reason is something only the server knows. `notice` is how it says which,
# and without surfacing it a customer's first build reads as "the plugin did
# nothing" with no way to find out why.

# Logs the plan's notice, if it carries one. Never fails: a plan with no notice
# is the ordinary case, and a malformed one must not break an upload.
dci_log_notice() {
    local jq_bin="$1" plan="$2" message
    message="$("${jq_bin}" -r '.notice.message // empty' <<<"${plan}" 2>/dev/null)" || return 0
    if [[ -n ${message} ]]; then
        echo "--- :trunk: ${message}" >&2
    fi
}
