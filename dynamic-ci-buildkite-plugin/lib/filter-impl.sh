#!/usr/bin/env bash
# Trunk Dynamic CI — filter mode.
#
#   generator | "$TRUNK_DYNAMIC_CI_FILTER" | buildkite-agent pipeline upload
#
# Reads a pipeline on stdin, marks the steps Trunk recommends skipping, and
# writes the pipeline to stdout. The customer keeps their own command; the plugin
# contributes only this filter. Works for a pipeline no file describes — a
# generated one — and equally for a pipeline that is a file.
#
# Three rules govern this file, and they are not style preferences:
#
#   1. STDOUT IS THE DATA CHANNEL. Every message goes to stderr, without
#      exception. Elsewhere a stray `echo` is log noise; here it corrupts
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
# shellcheck source-path=SCRIPTDIR
# shellcheck source=debug.sh
source "${PLUGIN_DIR}/lib/debug.sh"

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
# a generated pipeline costs less work than a file, not more.
if rendered="$("${jq_bin}" -c . "${buffer}" 2>/dev/null)"; then
    :
else
    # Not JSON, so treat it as YAML — which the AGENT parses, never us. We shell
    # out to `pipeline upload --dry-run`, which renders and validates without
    # uploading, and take its JSON.
    #
    # `--no-interpolation` because interpolation must happen exactly once and the
    # customer's own `pipeline upload` is what does it. Rendering it here as well
    # would substitute every `${VAR}` twice.
    if ! rendered="$(buildkite-agent pipeline upload --dry-run --format json \
        --no-interpolation <"${buffer}" 2>/dev/null)"; then
        log "--- :trunk: Dynamic CI could not read the pipeline — pipeline unchanged"
        emit_unchanged
    fi
    # Rendered WITHOUT interpolation, so the customer's own `pipeline upload`
    # must perform the single pass. If it carries `--no-interpolation` too,
    # nothing interpolates and `$$VAR` reaches the shell, which reads `$$` as
    # its own PID — `$$FX_INNER` becomes `206FX_INNER`. Not an error, not a
    # blank: a plausible string that changes every run. Measured, not theorised.
    #
    # Gated twice, so this stays a warning worth reading. A pipeline with no `$`
    # in it cannot be damaged by a missing interpolation pass, so there is
    # nothing to say; and where there is something at stake, the step's own
    # command usually settles whether the mistake was actually made.
    if [[ ${rendered} == *'$'* ]]; then
        if [[ ${BUILDKITE_COMMAND-} == *--no-interpolation* ]]; then
            log "--- :trunk: Dynamic CI: remove --no-interpolation from your pipeline upload"
            log "    This step's command passes it, and Dynamic CI has already rendered"
            log "    without interpolation — so nothing will interpolate at all."
            # shellcheck disable=SC2016 # `$$VAR` is the literal text being explained
            log '    $$VAR will resolve to a process id rather than to your variable.'
        elif [[ -n ${BUILDKITE_COMMAND-} ]]; then
            : # Command is visible and does not pass the flag. Nothing to say.
        else
            log "--- :trunk: Dynamic CI rendered this pipeline without interpolation"
            # shellcheck disable=SC2016 # backticks quote a command name; single quotes are required
            log '    Your `buildkite-agent pipeline upload` must NOT pass --no-interpolation,'
            # shellcheck disable=SC2016 # `$$VAR` is the literal text being explained
            log '    or nothing will interpolate and $$VAR will resolve to a process id.'
        fi
    fi
fi

only_keys="$("${jq_bin}" -c -n \
    --arg raw "${BUILDKITE_PLUGIN_DYNAMIC_CI_ONLY_KEYS-}" \
    -f "${PLUGIN_DIR}/lib/key-list.jq")" || only_keys="[]"
exclude_keys="$("${jq_bin}" -c -n \
    --arg raw "${BUILDKITE_PLUGIN_DYNAMIC_CI_EXCLUDE_KEYS-}" \
    -f "${PLUGIN_DIR}/lib/key-list.jq")" || exclude_keys="[]"

if ! keys="$("${jq_bin}" -c --argjson only "${only_keys}" \
    --argjson exclude "${exclude_keys}" \
    -f "${PLUGIN_DIR}/lib/collect-keys.jq" <<<"${rendered}")"; then
    log "--- :trunk: Dynamic CI could not read the pipeline's step keys — pipeline unchanged"
    emit_unchanged
fi

dci_debug_block "${jq_bin}" "requested step keys" "${keys}"

if [[ ${keys} == "[]" ]]; then
    # Two different causes, and conflating them sends a customer looking for a
    # missing `key:` when what they have is a stale `only-keys`.
    if [[ ${only_keys} != "[]" || ${exclude_keys} != "[]" ]]; then
        log "--- :trunk: Dynamic CI has no step left to consider — pipeline unchanged"
        log "    only-keys: ${BUILDKITE_PLUGIN_DYNAMIC_CI_ONLY_KEYS:-<unset>}"
        log "    exclude-keys: ${BUILDKITE_PLUGIN_DYNAMIC_CI_EXCLUDE_KEYS:-<unset>}"
    else
        log "--- :trunk: Dynamic CI found no step with a key: attribute — pipeline unchanged"
        log "    Add a key: to the steps you want Trunk to decide about."
    fi
    emit_unchanged
fi

if ! plan="$(TRUNK_DCI_JQ="${jq_bin}" \
    TRUNK_DCI_TOKEN_ENV="${BUILDKITE_PLUGIN_DYNAMIC_CI_TOKEN_ENV:-TRUNK_TOKEN}" \
    "${PLUGIN_DIR}/lib/request-plan.sh" "${keys}")"; then
    log "--- :trunk: Dynamic CI is unavailable — running every step"
    emit_unchanged
fi

dci_debug_block "${jq_bin}" "plan" "${plan}"
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

# Never between here and `emit`: a failure to describe what was done must not
# stop the pipeline that was already correctly built from going out.
if summary="$("${jq_bin}" -r --argjson before "${rendered}" --argjson plan "${plan}" \
    -f "${PLUGIN_DIR}/lib/applied-skips.jq" <<<"${mutated}" 2>/dev/null)"; then
    log "${summary}"
else
    log "--- :trunk: Dynamic CI applied its plan"
fi
emit "${mutated}"
