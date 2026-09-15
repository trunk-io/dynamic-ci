# The plan request body, from values the caller passes as jq `--arg`s.
#
# Built by jq rather than by string interpolation in shell: every value here
# comes from the agent's environment — a branch name, a commit author — and jq
# escapes them correctly by construction. Hand-rolled JSON in bash is how a
# quote in a branch name becomes a malformed request.
#
# Shapes the three fields whose types are not string: `baseSha` and `prNumber`
# are nullable, and `runAttempt` arrives already numeric.

# Optional fields are omitted rather than sent empty. The engine distinguishes an
# absent value from an empty one, and "" is not a real actor or event name.
def optional($key; $value): if $value == "" then {} else { ($key): $value } end;

# `ignore-signals` is a comma-separated plugin option, matching the GitHub
# Action's input. An unknown identifier is a 400 from the API — deliberately, so
# a typo fails open loudly instead of silently disabling nothing.
def signals:
  $ignoreSignals
  | split(",")
  | map(ascii_downcase | gsub("^\\s+|\\s+$"; ""))
  | map(select(. != ""));

{
  repo: { host: $host, owner: $owner, name: $name },
  commitSha: $commitSha,
  baseSha: (if $baseSha == "" then null else $baseSha end),
  branch: $branch,
  prNumber: (if $prNumber == "" then null else ($prNumber | tonumber) end),
  runId: $runId,
  runAttempt: $runAttempt,
  buildkiteOrganizationSlug: $orgSlug,
  buildkitePipelineSlug: $pipelineSlug,
  jobKeys: $jobKeys,
}
+ optional("triggeringActor"; $triggeringActor)
+ optional("eventName"; $eventName)
+ (if $ignoreSignals == "" then {} else { ignoreSignals: signals } end)
