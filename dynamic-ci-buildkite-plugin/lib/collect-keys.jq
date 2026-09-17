# Every skippable step's `key:` in a rendered pipeline, at any nesting depth,
# narrowed to `$only` when that list is non-empty.
#
# `group:` steps nest their own `steps`, so the walk has to recurse; a flat
# `.steps[]` silently misses every grouped step, which reads as a pipeline whose
# grouped work is simply never scored.
#
# `trigger:` steps are excluded rather than scored: their outcome is in the build
# they launch, so a verdict here could suppress a build whose result the engine
# never sees. `apply-skips.jq` refuses them too — this only avoids asking.
#
# `$only` is the customer's allowlist. An empty list means no restriction, which
# is the default and the common case. Narrowing happens HERE, on the request,
# rather than in `apply-skips.jq`: a key we never asked about cannot come back in
# a plan, so one guard is enough. That is deliberately weaker than the trigger
# guard, which is duplicated in both — because a trigger skip breaks a build that
# never happens, while an out-of-scope skip only skips a step the customer would
# have let us consider had they not narrowed.
def walk: .steps[]? | (., walk);

[walk | select(.key != null and .trigger == null) | .key]
| if ($only | length) == 0 then . else map(select(IN($only[]))) end
