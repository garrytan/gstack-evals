# Mining-yield probe (GEVA-87, keyless)

Run on 2026-10-31 against public GitHub clones (blob-less, shallow since 2026-04-01). No model calls. The garrytan/gstack row reads a depth-1 local checkout and is not a measurement. The measured run used an absolute output path; the published script makes OUT absolute the same way.

## Script (probe.sh)

```bash
#!/usr/bin/env bash
# Keyless mining-yield probe for the GEVA-87 plan: counts, per repo, commits merged 2026-07-01..2026-10-31 that change source and tests,
# fix commits with tests, and SZZ pairs (a fix commit whose changed lines blame to a commit in the same window). No model calls.
set -u
OUT="$PWD/probe-out"; mkdir -p "$OUT"; cd "$OUT"
for R in honojs/hono pydantic/pydantic drizzle-team/drizzle-orm python-poetry/poetry tailwindlabs/tailwindcss garrytan/gstack; do
  D=$(echo $R | tr / _)
  if [ "$R" = garrytan/gstack ]; then SRC=$HOME/.local/share/gstack; else
    [ -d $D ] || timeout 600 git clone -q --filter=blob:none --shallow-since=2026-04-01 --single-branch https://github.com/$R.git $D 2>/dev/null || { echo "$R clone-failed"; continue; }
    SRC=$OUT/$D; fi
  cd $SRC
  TOTAL=0; CT=0; FIX=0; PAIRS=0; MULTI=0
  for C in $(git log --first-parent --since=2026-07-01 --until=2026-10-31 --format=%H); do
    TOTAL=$((TOTAL+1))
    FILES=$(git diff-tree --no-commit-id --name-only -r $C)
    T=$(echo "$FILES" | grep -Eic '(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.' || true)
    S=$(echo "$FILES" | grep -Eiv '(^|/)(tests?|__tests__|spec|docs?)/|[._-](test|spec)\.|\.(md|json|ya?ml|lock|txt)$' | grep -c . || true)
    [ "$T" -gt 0 ] && [ "$S" -gt 0 ] || continue
    CT=$((CT+1))
    git log -1 --format=%s $C | grep -Eiq '\bfix|bug|regress|crash|broke' || continue
    FIX=$((FIX+1)); [ $FIX -le 40 ] || continue
    P=$(git rev-parse -q --verify $C^ 2>/dev/null) || continue
    FOUND=""
    for F in $(echo "$FILES" | grep -Eiv '(^|/)(tests?|__tests__|spec|docs?)/|[._-](test|spec)\.|\.(md|json|ya?ml|lock|txt)$' | head -4); do
      for H in $(git diff -U0 $P $C -- "$F" 2>/dev/null | grep -E '^@@' | sed -E 's/^@@ -([0-9]+)(,([0-9]+))? .*/\1:\3/' | head -6); do
        A=${H%%:*}; N=${H#*:}; [ -z "$N" ] && N=1; [ "$N" = 0 ] && continue
        for I in $(timeout 60 git blame -l -s -L $A,+$N $P -- "$F" 2>/dev/null | cut -c1-40 | sort -u); do
          [ "${I#^}" = "$I" ] || continue
          DT=$(git log -1 --format=%cs $I 2>/dev/null); [ -n "$DT" ] && [[ "$DT" > "2026-06-30" ]] && FOUND="$FOUND $I"
        done
      done
    done
    if [ -n "$FOUND" ]; then PAIRS=$((PAIRS+1)); I1=$(echo $FOUND | tr ' ' '\n' | sort -u | head -1); NS=$(git diff-tree --no-commit-id --name-only -r $I1 | grep -Eiv '(^|/)(tests?|__tests__|spec|docs?)/|[._-](test|spec)\.|\.(md|json|ya?ml|lock|txt)$' | grep -c . || true); [ "$NS" -ge 2 ] && MULTI=$((MULTI+1)); fi
  done
  echo "$R commits=$TOTAL src+test=$CT fix+test=$FIX szz_checked=$([ $FIX -lt 40 ] && echo $FIX || echo 40) szz_pairs=$PAIRS multi_file_introducers=$MULTI"
  cd $OUT
done
```

## Output

```
honojs/hono commits=195 src+test=117 fix+test=91 szz_checked=40 szz_pairs=8 multi_file_introducers=3
pydantic/pydantic commits=321 src+test=136 fix+test=30 szz_checked=30 szz_pairs=5 multi_file_introducers=3
drizzle-team/drizzle-orm commits=9 src+test=1 fix+test=0 szz_checked=0 szz_pairs=0 multi_file_introducers=0
python-poetry/poetry commits=73 src+test=32 fix+test=19 szz_checked=19 szz_pairs=3 multi_file_introducers=1
tailwindlabs/tailwindcss commits=83 src+test=52 fix+test=12 szz_checked=12 szz_pairs=1 multi_file_introducers=1
garrytan/gstack commits=1 src+test=0 fix+test=0 szz_checked=0 szz_pairs=0 multi_file_introducers=0
```
