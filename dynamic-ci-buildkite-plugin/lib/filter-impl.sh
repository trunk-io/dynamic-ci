#!/usr/bin/env bash
# Trunk Dynamic CI — filter mode.
#
#   generator | "$TRUNK_DYNAMIC_CI_FILTER" | buildkite-agent pipeline upload
#
# Reads a pipeline on stdin, marks the steps Trunk recommends skipping, and
# writes the pipeline to stdout. The customer keeps their own command; the plugin
# contributes only this filter. Works for a pipeline no file describes — a
# generated one — which pipeline mode cannot attach to at all.
#
# Three rules govern this file, and they are not style preferences:
#
#   1. STDOUT IS THE DATA CHANNEL. Every message goes to stderr, without
#      exception. In pipeline mode a stray `echo` is log noise; here it corrupts
#      the pipeline being uploaded.
#   2. `set -e` IS DELIBERATELY ABSENT. Under it, any unhandled non-zero exit
#      would terminate having written nothing, and the customer's `pipeline
#      upload` would then receive empty input — a build with no steps, which is
#      far worse than a build that skips nothing. Every failure is handled
#      explicitly, and an EXIT trap is the backstop for the ones that are not.
#   3. THE INPUT IS BUFFERED TO A FILE, so a fail-open replays the customer's
#      exact bytes — comments, anchors, trailing newline and all. A shell
#      variable cannot promise that: command substitution strips trailing
#      newlines.
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=jq.sh
source "${PLUGIN_DIR}/lib/jq.sh"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=notice.sh
source "${PLUGIN_DIR}/lib/notice.sh"

buffer="$(mktemp)"
emitted=false

log() { echo "$1" >&2; }

# Rule 2's backstop: whatever happens, something is on stdout. Without this a
# bug in this script empties a customer's pipeline instead of failing open.
# shellcheck disable=SC2329 # invoked by the EXIT trap below
safety_net() {
    if [[ ${emitted} == false ]]; then
        log "--- :trunk: Dynamic CI exited unexpectedly — pipeline unchanged"
        cat "${buffer}" 2>/dev/null
    fi
    rm -f "${buffer}"
}
trap safety_net EXIT

emit_unchanged() {
    cat "${buffer}"
    emitted=true
    exit 0
}

emit() {
    printf '%s\n' "$1"
    emitted=true
    exit 0
}

cat >"${buffer}"

jq_bin="${TRUNK_DCI_JQ-}"
if [[ -z ${jq_bin} ]] && ! jq_bin="$(dci_resolve_jq "${PLUGIN_DIR}/vendor")"; then
    log "--- :trunk: Dynamic CI has no usable jq — pipeline unchanged"
    emit_unchanged
fi

# Already JSON — the generator case. No render, so nothing is interpolated that
# would not have been anyway, and this path never touches YAML at all. It is why
# filter mode is simpler than pipeline mode rather than more complex.
if rendered="$("${jq_bin}" -c . "${buffer}" 2>/dev/null)"; then
    :
else
    # YAML: the agent parses it, never us. `--no-interpolation` so the customer's
    # own `pipeline upload` still performs exactly one interpolation pass.
    if ! rendered="$(buildkite-agent pipeline upload --dry-run --format json \
        --no-interpolation <"${buffer}" 2>/dev/null)"; then
        log "--- :trunk: Dynamic CI could not read the pipeline — pipeline unchanged"
        emit_unchanged
    fi
fi

if ! keys="$("${jq_bin}" -c -f "${PLUGIN_DIR}/lib/collect-keys.jq" <<<"${rendered}")"; then
    log "--- :trunk: Dynamic CI could not read the pipeline's step keys — pipeline unchanged"
    emit_unchanged
fi

if [[ ${keys} == "[]" ]]; then
    log "--- :trunk: Dynamic CI found no step with a key: attribute — pipeline unchanged"
    log "    Add a key: to the steps you want Trunk to decide about."
    emit_unchanged
fi

if ! plan="$(TRUNK_DCI_JQ="${jq_bin}" \
    TRUNK_DCI_TOKEN_ENV="${BUILDKITE_PLUGIN_DYNAMIC_CI_TOKEN_ENV:-TRUNK_TOKEN}" \
    "${PLUGIN_DIR}/lib/request-plan.sh" "${keys}")"; then
    log "--- :trunk: Dynamic CI is unavailable — running every step"
    emit_unchanged
fi

dci_log_notice "${jq_bin}" "${plan}"

if ! skips="$("${jq_bin}" -c -f "${PLUGIN_DIR}/lib/plan-to-skips.jq" <<<"${plan}")"; then
    log "--- :trunk: Dynamic CI returned a plan this version cannot read — pipeline unchanged"
    emit_unchanged
fi

if ! mutated="$("${jq_bin}" --argjson skips "${skips}" \
    -f "${PLUGIN_DIR}/lib/apply-skips.jq" <<<"${rendered}")"; then
    log "--- :trunk: Dynamic CI could not apply its plan — pipeline unchanged"
    emit_unchanged
fi

skipped_count="$("${jq_bin}" -r 'length' <<<"${skips}" 2>/dev/null || echo "?")"
log "--- :trunk: Dynamic CI marked ${skipped_count} step(s) to skip"
emit "${mutated}"
