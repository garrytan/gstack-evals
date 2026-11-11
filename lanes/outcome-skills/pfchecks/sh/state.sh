#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Post-turn routing (plan section 5; #305's run notes item 4). pf_turns runs "state.sh <repo> <work> <name>..." only after
# a capture, wrap-up or bundle step failed or timed out. It reads, and never changes, what the agent could have written,
# and prints one PF_ARM_STATE line per cause it finds there: a work file the step needs (each <name>: inv, s.head, s.inv)
# missing, or an s.head that names no commit; a repository root or .git that is not a directory; a .git/config git cannot
# read, or one that leaves the root outside git's work tree; a HEAD that names no commit; an index git cannot read, or one
# with unmerged entries; and a .lock file under .git made during the session (newer than <work>/inv) that was there
# before the step started (not newer than <work>/pf-step.stamp), which the agent's own git left. No line means the cause
# lies in the harness, the host, docker or the network. It always exits 0.
repo=$1
work=$2
shift 2
say() { printf 'PF_ARM_STATE %s\n' "$*"; }
g() { git -C "$repo" -c safe.directory='*' -c core.quotepath=off "$@"; }
need_head=0
for n in "$@"; do
  [ -f "$work/$n" ] || say "missing $n"
  [ "$n" = s.head ] && need_head=1
done
[ -d "$repo" ] || { say "repo $repo is not a directory"; exit 0; }
[ -d "$repo/.git" ] || { say "git_dir .git is not a directory"; exit 0; }
g config --local -l >/dev/null 2>&1 || { say "config .git/config is unreadable"; exit 0; }
[ "$(g rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || { say "worktree git sees no work tree at the repository root"; exit 0; }
if [ "$need_head" = 1 ] && [ -f "$work/s.head" ] && ! g cat-file -e "$(head -c 200 "$work/s.head" | tr -d '[:space:]')^{commit}" 2>/dev/null; then say "s.head names no commit"; fi
g rev-parse -q --verify 'HEAD^{commit}' >/dev/null 2>&1 || say "head HEAD names no commit"
if g ls-files -s >/dev/null 2>&1; then
  [ -z "$(g ls-files -u 2>/dev/null | head -n 1)" ] || say "unmerged the index has unmerged entries"
else
  say "index the index is unreadable"
fi
if [ -f "$work/pf-step.stamp" ]; then
  since=()
  [ -f "$work/inv" ] && since=(-newer "$work/inv")
  find "$repo/.git" -name '*.lock' ${since[@]+"${since[@]}"} ! -newer "$work/pf-step.stamp" -print 2>/dev/null | LC_ALL=C sort | head -n 20 | while IFS= read -r f; do say "lock ${f#"$repo"/}"; done
fi
exit 0
