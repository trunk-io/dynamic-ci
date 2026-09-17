#!/usr/bin/env bash
# The `debug` option's output.
#
# **stderr only, without exception.** In filter mode stdout carries the pipeline
# being uploaded, so a single stray byte there corrupts a customer's build — and
# a debugging aid that breaks the thing you are debugging is worse than none.
# That is why this is a function rather than an `echo` at each call site.

dci_debug_enabled() {
    # Buildkite renders a YAML boolean into the environment as the string
    # "true", so this compares rather than tests for emptiness.
    [[ ${BUILDKITE_PLUGIN_DYNAMIC_CI_DEBUG:-false} == "true" ]]
}

# One collapsed Buildkite log group per block: present when wanted, folded away
# when not, rather than several hundred lines of JSON between the customer and
# whatever they were actually reading.
#
# Pretty-printed through the vendored jq when the payload parses, and emitted raw
# when it does not — a malformed plan is exactly when you want to see the bytes.
dci_debug_block() {
    local jq_bin="$1" title="$2" payload="$3"
    dci_debug_enabled || return 0
    {
        echo "--- :trunk: debug · ${title}"
        "${jq_bin}" . <<<"${payload}" 2>/dev/null || printf '%s\n' "${payload}"
    } >&2
}
