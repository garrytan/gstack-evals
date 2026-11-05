#!/usr/bin/env bash
# L1 Amendment C (#218's trust-limit residual): for each task, whether the pulled image it builds from, or its build
# context, holds a Claude Code settings file that names a UserPromptSubmit hook. Such a hook would run beside the arm's
# route hook and could add text to the prompt the proxy reads. vm-run.sh runs this after the image pulls and before the
# oracle gate and writes its output to out/task-hooks.tsv; the results post reports the count.
# Usage: task-hooks.sh <run dir>. One row per task: task, image, workdir, hook (yes, no or unknown), files.
# The image is the stage the task's Dockerfile ends on, followed through stage names to a pulled image. The workdir is
# that stage chain's WORKDIRs joined onto the image's own WorkingDir. Each image runs once as root with no network and no
# pull, under /bin/sh, with a probe that reads managed settings, /root/.claude, the .claude dir of the workdir and of each
# parent, and any .claude dir up to 6 levels under the workdir on its filesystem. hook is yes when a file there, or a
# .claude/settings*.json anywhere in the build context ("context:" files), names UserPromptSubmit; unknown when the image
# scan failed and the context names none (files then gives the reason). Files a RUN step writes at build time are outside it.
set -uo pipefail
run=$(cd "$1" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/probe.sh" <<'PROBE'
wd=$1; r=$2
echo scan-ok
hit() { if [ -f "$1" ] && grep -q UserPromptSubmit "$1" 2>/dev/null; then echo "hit ${1#"$r"}"; fi; return 0; }
for f in /etc/claude-code/managed-settings.json /root/.claude/settings.json /root/.claude/settings.local.json; do hit "$r$f"; done
d=$wd
while :; do
  for f in settings.json settings.local.json; do hit "$r${d%/}/.claude/$f"; done
  [ "$d" = / ] && break
  d=$(dirname "$d")
done
find "$r$wd" -xdev -maxdepth 6 -path '*/.claude/settings*.json' -type f 2>/dev/null | while read -r f; do hit "$f"; done
PROBE
chmod 644 "$tmp/probe.sh"
safe='^[A-Za-z0-9._/@:+=-]+$'
printf 'task\timage\tworkdir\thook\tfiles\n'
for df in "$run"/tasks/*/environment/Dockerfile; do
  [ -f "$df" ] || continue
  ctx=$(dirname "$df")
  task=$(basename "$(dirname "$ctx")")
  line=$(awk '
    toupper($1) == "FROM" { n++; i = 2; while ($i ~ /^--/) i++; img[n] = $i; wd[n] = ""; name[n] = ""; for (k = i + 1; k < NF; k++) if (toupper($k) == "AS") name[n] = tolower($(k + 1)) }
    toupper($1) == "WORKDIR" && n { wd[n] = wd[n] "\t" $2 }
    END { s = n; w = wd[s]; while (s) { f = 0; for (j = s - 1; j >= 1; j--) if (name[j] != "" && name[j] == tolower(img[s])) { f = j; break }; if (!f) break; s = f; w = wd[s] w }; print img[s] w }' "$df")
  IFS=$'\t' read -r -a parts <<< "$line"
  img=${parts[0]:-}
  wds=("${parts[@]:1}")
  wd=""
  if [ ${#wds[@]} -eq 0 ] || [ "${wds[0]#/}" = "${wds[0]}" ]; then
    if [[ $img =~ $safe ]]; then wd=$(timeout --kill-after=10 60 sg docker -c "docker image inspect -f '{{.Config.WorkingDir}}' $img" 2>/dev/null < /dev/null | tail -1); fi
  fi
  [ -n "$wd" ] || wd=/
  for w in "${wds[@]}"; do case "$w" in /*) wd=$w ;; *) wd=${wd%/}/$w ;; esac; done
  ctxhits=$(cd "$ctx" && find . -path '*/.claude/settings*.json' -type f -exec grep -l UserPromptSubmit {} + 2>/dev/null | sed 's#^\./#context:#' | sort)
  status=ok; reason=""; hits=""
  if ! [[ $img =~ $safe && $wd =~ $safe ]]; then
    status=unknown; reason="the image or workdir has a character the scan does not pass to a shell"
  else
    out=$(timeout --kill-after=10 120 sg docker -c "docker run --rm --pull never --network none --user 0 --entrypoint= -v $tmp/probe.sh:/laneb-probe.sh:ro $img /bin/sh /laneb-probe.sh $wd" 2> "$tmp/err" < /dev/null)
    rc=$?
    if [ "$rc" -ne 0 ]; then
      status=unknown; reason="docker run exited $rc: $(tail -1 "$tmp/err" | tr '\t\r' '  ' | cut -c1-200)"
    elif ! grep -qx scan-ok <<< "$out"; then
      status=unknown; reason="the scan printed no result"
    else
      hits=$(sed -n 's/^hit //p' <<< "$out" | sort -u)
    fi
  fi
  files=$(printf '%s\n%s\n' "$hits" "$ctxhits" | sed '/^$/d' | paste -sd, -)
  if [ -n "$files" ]; then hook=yes
  elif [ "$status" = unknown ]; then hook=unknown; files=$reason
  else hook=no
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$task" "$img" "$wd" "$hook" "$files"
done
