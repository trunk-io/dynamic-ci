# A comma-separated key list option (`only-keys`, `exclude-keys`), parsed.
#
# Comma-separated rather than a YAML list to match `ignore-signals`, and because
# a Buildkite array reaches a hook as `..._0`, `..._1` environment variables —
# awkward to read in shell and easy to read wrong.
$raw
| split(",")
| map(gsub("^\\s+|\\s+$"; ""))
| map(select(. != ""))
