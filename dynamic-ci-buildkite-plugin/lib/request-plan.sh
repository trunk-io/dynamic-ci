#!/usr/bin/env bash
# Trunk Dynamic CI — the plan request.
#
# Builds the request body from the agent's environment, POSTs it to
# /v2/dynamic-ci/generate-buildkite-plan, and prints the plan on stdout. Exiting
# non-zero is a supported outcome: `hooks/command` then uploads the pipeline
# unmodified, so an outage costs a full CI run rather than a broken build.
#
# Usage:
#   request-plan.sh <job-keys-json>                POST and print the plan
#   request-plan.sh --print-body <job-keys-json>   print the body, make no call
#
# `--print-body` exists for the tests: they parse that output with the vendored
# copy of the engine's zod schema, so a missing, renamed or mistyped field is a
# CI failure here rather than a 400 nobody sees until a customer's build.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=jq.sh
source "${LIB_DIR}/jq.sh"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=debug.sh
source "${LIB_DIR}/debug.sh"

DEFAULT_API_ADDRESS="https://api.trunk.io"
PLAN_PATH="/v2/dynamic-ci/generate-buildkite-plan"
# Mirrors the GitHub Action's budget: 30s per attempt, three attempts total.
TIMEOUT_SECONDS=30
RETRIES=2

log() { echo "$1" >&2; }

# `owner/name` and the host from a git remote, matching what CI ingestion did
# when it created the repository row this request is resolved against.
#
# Load-bearing: the row is keyed on (org, host, "owner/name") from ingestion's
# OWN parse of this same remote. A disagreement finds no repository and the
# request fails open with nothing visible to the customer, so the two rules have
# to stay the same — take the LAST `@` (a token-bearing HTTPS remote is real,
# and its userinfo may itself contain one) and strip a `www.` prefix.
dci_parse_remote() {
    local remote="$1" rest host path

    rest="${remote##*@}" # drop scheme+userinfo if an `@` is present
    rest="${rest#*://}"  # otherwise drop the scheme
    rest="${rest#www.}"  # ingestion strips this generically; match it

    if [[ ${rest} == *:* && ${rest} != */* ]]; then
        host="${rest%%:*}"
        path="${rest#*:}"
    elif [[ ${rest} == *:* && ${rest%%:*} != *"/"* ]]; then
        host="${rest%%:*}" # scp form: host:owner/name
        path="${rest#*:}"
    else
        host="${rest%%/*}"
        path="${rest#*/}"
    fi

    path="${path%.git}"
    path="${path%/}"

    if [[ -z ${host} || ${path} != */* ]]; then
        log "could not read owner/name out of the remote ${remote}"
        return 1
    fi

    printf '%s\n%s\n' "${host}" "${path}"
}

# The merge base of the PR's target branch and HEAD, or empty when there is no
# PR or git cannot answer. Empty becomes a null `baseSha`, which is legal and
# costs the diff-derived signals rather than the whole plan.
dci_base_sha() {
    local base_branch="${BUILDKITE_PULL_REQUEST_BASE_BRANCH-}"
    if [[ -z ${base_branch} ]]; then
        return 0
    fi
    git merge-base "origin/${base_branch}" HEAD 2>/dev/null ||
        git merge-base "${base_branch}" HEAD 2>/dev/null ||
        true
}

# `BUILDKITE_PULL_REQUEST` is the literal string "false" off a pull request, not
# an empty value — so this has to be compared, never tested for truthiness.
dci_pr_number() {
    local pr="${BUILDKITE_PULL_REQUEST:-false}"
    if [[ ${pr} == "false" || -z ${pr} ]]; then
        return 0
    fi
    echo "${pr}"
}

dci_build_body() {
    local jq_bin="$1" job_keys="$2" host="$3" repo_path="$4"
    local owner="${repo_path%%/*}" name="${repo_path#*/}"
    local retry="${BUILDKITE_RETRY_COUNT:-0}"

    # Built by jq rather than printf: every value here is attacker-adjacent (a
    # branch name, a commit author) and jq escapes them correctly by construction.
    # `--arg` is always a string; the nulls and numbers are shaped below.
    "${jq_bin}" -n \
        --arg host "${host}" \
        --arg owner "${owner}" \
        --arg name "${name}" \
        --arg commitSha "${BUILDKITE_COMMIT-}" \
        --arg baseSha "$(dci_base_sha)" \
        --arg branch "${BUILDKITE_BRANCH-}" \
        --arg prNumber "$(dci_pr_number)" \
        --arg runId "${BUILDKITE_BUILD_ID-}" \
        --argjson runAttempt "$((retry + 1))" \
        --arg triggeringActor "${BUILDKITE_BUILD_CREATOR-}" \
        --arg eventName "${BUILDKITE_SOURCE-}" \
        --arg orgSlug "${BUILDKITE_ORGANIZATION_SLUG-}" \
        --arg pipelineSlug "${BUILDKITE_PIPELINE_SLUG-}" \
        --arg ignoreSignals "${BUILDKITE_PLUGIN_DYNAMIC_CI_IGNORE_SIGNALS-}" \
        --argjson jobKeys "${job_keys}" \
        -f "${LIB_DIR}/request-body.jq"
}

dci_post() {
    local body="$1" token="$2" url="$3" response status

    response="$(mktemp)"
    # shellcheck disable=SC2064  # expand now: $response must not change later
    trap "rm -f '${response}'" RETURN

    status="$(curl -sS -o "${response}" -w '%{http_code}' \
        --max-time "${TIMEOUT_SECONDS}" --retry "${RETRIES}" --retry-delay 1 \
        -X POST "${url}" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data-binary "${body}")" || {
        log "the plan request could not be made"
        return 1
    }

    if [[ ${status} != 2?? ]]; then
        log "the plan request returned HTTP ${status}"
        # The envelope carries a coded message worth surfacing; cap it so a stray
        # HTML error page cannot flood the build log.
        head -c 500 "${response}" >&2 || true
        echo >&2
        return 1
    fi

    cat "${response}"
}

main() {
    local print_body=false

    if [[ ${1-} == "--print-body" ]]; then
        print_body=true
        shift
    fi

    local job_keys="${1-}"
    if [[ -z ${job_keys} ]]; then
        log "usage: request-plan.sh [--print-body] <job-keys-json>"
        return 1
    fi

    local jq_bin
    # The hook has already resolved and verified a jq; reuse it rather than
    # hashing the binary a second time.
    if [[ -n ${TRUNK_DCI_JQ-} ]]; then
        jq_bin="${TRUNK_DCI_JQ}"
    elif ! jq_bin="$(dci_resolve_jq "${LIB_DIR}/../vendor")"; then
        return 1
    fi

    local remote="${BUILDKITE_REPO-}"
    if [[ -z ${remote} ]]; then
        log "BUILDKITE_REPO is not set, so the repository cannot be identified"
        return 1
    fi

    local parsed host repo_path
    if ! parsed="$(dci_parse_remote "${remote}")"; then
        return 1
    fi
    host="$(head -n1 <<<"${parsed}")"
    repo_path="$(tail -n1 <<<"${parsed}")"

    local body
    body="$(dci_build_body "${jq_bin}" "${job_keys}" "${host}" "${repo_path}")"

    # The body is what diagnoses a resolution that looked fine and was not: the
    # wrong pipeline slug, a null baseSha, a repo parsed differently from how
    # ingestion parsed it. It carries no credential — the token rides a header.
    dci_debug_block "${jq_bin}" "request body" "${body}"

    if [[ ${print_body} == true ]]; then
        echo "${body}"
        return 0
    fi

    local token_env="${TRUNK_DCI_TOKEN_ENV:-TRUNK_TOKEN}" token
    token="${!token_env-}"
    if [[ -z ${token} ]]; then
        log "no Trunk API token in \$${token_env} — set it, or point token-env at the variable holding it"
        return 1
    fi

    local address="${TRUNK_PUBLIC_API_ADDRESS:-${DEFAULT_API_ADDRESS}}"
    dci_post "${body}" "${token}" "${address%/}${PLAN_PATH}"
}

main "$@"
