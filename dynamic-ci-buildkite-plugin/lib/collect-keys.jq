# Every step `key:` in a rendered pipeline, at any nesting depth.
#
# `group:` steps nest their own `steps`, so the walk has to recurse; a flat
# `.steps[]` silently misses every grouped step, which reads as a pipeline whose
# grouped work is simply never scored.
def walk: .steps[]? | (., walk);

[walk | select(.key) | .key]
