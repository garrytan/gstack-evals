#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Post-turn routing (plan section 5; #305's run notes item 4). pf_turns runs "state.sh [--timed-out] <repo> <work>
# <name>..." only after a capture, wrap-up or bundle step failed or, with --timed-out, timed out. It reads, and never
# changes, what the agent could have written, and prints one PF_ARM_STATE line per cause it finds there: a work file the
# step needs (each <name>: inv, s.head, s.inv) missing, or an s.head that names no commit; a repository root or .git that
# is not a directory; a .git/config git cannot read, one that sets a filter (filter.*, through an include too) the base
# repo did not have with that value (<work>/inv.filters, saved at the start inventory; no filter line when it is
# missing), or one that leaves the root outside git's work tree; a HEAD that names no commit; an index git cannot read, or one with
# unmerged entries; a .lock file under .git made during the session (newer than <work>/inv) that was there before the
# step started (not newer than <work>/pf-step.stamp), which the agent's own git left, read only when the step did not
# time out, since a timeout stops the step's own git, whose lock can fall in the stamp's clock tick; a path the capture
# lists, changed during the session, that the step cannot read or enter (capture.sh unreadable); and, on a timeout,
# files the capture lists, changed during the session, that number at least 2,000,000 or hold at least 8 GiB (capture.sh
# size), with one "PF_TREE_SIZE files=N bytes=B stopped=S" line on every timeout, above the line or below it. On a
# 4-core Capy machine (2026-11-11) the commit added about 7,000 files or 31 MB of random bytes a second, so
# either alone takes about half the step's 600 s. On a timeout the size count runs before the unreadable scan, which is
# skipped once the tree has grown, so a tree too big to walk in time is named by the cheap count. No line means the cause lies in the harness, the host, docker or the
# network. It always exits 0. Its git runs with no hooks, no fsmonitor, no system or global config
# and no ignore file outside the repository.
timed=0
if [ "${1:-}" = --timed-out ]; then
  timed=1
  shift
fi
repo=$1
work=$2
shift 2
here=$(cd "$(dirname "$0")" && pwd)
files=2000000
bytes=8589934592
say() { printf 'PF_ARM_STATE %s\n' "$*"; }
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
g() { git -C "$repo" -c safe.directory='*' -c core.quotepath=off -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.excludesFile=/dev/null "$@"; }
need_head=0
for n in "$@"; do
  [ -f "$work/$n" ] || say "missing $n"
  [ "$n" = s.head ] && need_head=1
done
[ -d "$repo" ] || { say "repo $repo is not a directory"; exit 0; }
[ -d "$repo/.git" ] || { say "git_dir .git is not a directory"; exit 0; }
g config --local -l >/dev/null 2>&1 || { say "config .git/config is unreadable"; exit 0; }
if [ -f "$work/inv.filters" ]; then
  bash "$here/capture.sh" filters "$repo" 2>/dev/null | grep -vxF -f "$work/inv.filters" | cut -f1 | LC_ALL=C sort -u | head -n 20 | while IFS= read -r k; do say "filter .git/config sets $k"; done
fi
[ "$(g rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || { say "worktree git sees no work tree at the repository root"; exit 0; }
if [ "$need_head" = 1 ] && [ -f "$work/s.head" ] && ! g cat-file -e "$(head -c 200 "$work/s.head" | tr -d '[:space:]')^{commit}" 2>/dev/null; then say "s.head names no commit"; fi
g rev-parse -q --verify 'HEAD^{commit}' >/dev/null 2>&1 || say "head HEAD names no commit"
if g ls-files -s >/dev/null 2>&1; then
  [ -z "$(g ls-files -u 2>/dev/null | head -n 1)" ] || say "unmerged the index has unmerged entries"
else
  say "index the index is unreadable"
fi
if [ "$timed" = 0 ] && [ -f "$work/pf-step.stamp" ]; then
  since=()
  [ -f "$work/inv" ] && since=(-newer "$work/inv")
  find "$repo/.git" -name '*.lock' ${since[@]+"${since[@]}"} ! -newer "$work/pf-step.stamp" -print 2>/dev/null | LC_ALL=C sort | head -n 20 | while IFS= read -r f; do say "lock ${f#"$repo"/}"; done
fi
if [ -f "$work/inv" ]; then
  grown=0
  if [ "$timed" = 1 ]; then
    size=$(bash "$here/capture.sh" size "$repo" "$work/inv" "$files" "$bytes" 2>/dev/null)
    n=${size#files=}
    n=${n%% *}
    b=${size#*bytes=}
    b=${b%% *}
    case $n$b in
      ''|*[!0-9]*) ;;
      *)
        if [ "$n" -ge "$files" ] || [ "$b" -ge "$bytes" ]; then
          say "grown the session wrote files=$n bytes=$b, at least $files files or $bytes bytes"
          grown=1
        fi
        printf 'PF_TREE_SIZE %s\n' "$size"
        ;;
    esac
  fi
  [ "$grown" = 1 ] || bash "$here/capture.sh" unreadable "$repo" "$work/inv" 2>/dev/null | head -n 20 | while IFS= read -r f; do say "unreadable $f"; done
fi
exit 0
