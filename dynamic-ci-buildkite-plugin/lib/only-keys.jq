# The `only-keys` option, parsed from its comma-separated form.
#
# Comma-separated rather than a YAML list to match `ignore-signals`, and because
# a Buildkite array reaches a hook as `..._0`, `..._1` environment variables —
# awkward to read in shell and easy to read wrong.
$raw
| split(",")
| map(gsub("^\\s+|\\s+$"; ""))
| map(select(. != ""))
