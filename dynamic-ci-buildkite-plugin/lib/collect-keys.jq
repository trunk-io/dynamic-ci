# Every skippable step's `key:` in a rendered pipeline, at any nesting depth.
#
# `group:` steps nest their own `steps`, so the walk has to recurse; a flat
# `.steps[]` silently misses every grouped step, which reads as a pipeline whose
# grouped work is simply never scored.
#
# `trigger:` steps are excluded rather than scored: their outcome is in the build
# they launch, so a verdict here could suppress a build whose result the engine
# never sees. `apply-skips.jq` refuses them too — this only avoids asking.
def walk: .steps[]? | (., walk);

[walk | select(.key != null and .trigger == null) | .key]
