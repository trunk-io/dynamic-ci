#!/usr/bin/env bash
# Trunk Dynamic CI — the plan request. NOT YET IMPLEMENTED (checkpoint P3).
#
# Takes the pipeline's step keys as a JSON array on argv, and is expected to
# print a `CiPlan` JSON object on stdout. Exiting non-zero makes `hooks/command`
# upload the pipeline unmodified, which is why this stub is safe to ship: the
# plugin installs, renders, declines to plan, and runs everything.
#
# P3 fills this in: build the request body from the agent's environment, POST it
# to /v2/dynamic-ci/generate-buildkite-plan with the org API token, and print the
# response. The body's field-by-field sources are in the TRD's request table.

set -euo pipefail

echo "the Dynamic CI plan client is not implemented yet (P3)" >&2
exit 1
