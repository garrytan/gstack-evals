// Copyright (c) 2026 Garry Tan. MIT License.
// Drift (the implicit state machines prereg, section 8 item 6). A follow-on whose fix's tests fail is a drift case when a
// run's log holds one of the language's frozen drift forms (langs.ts DRIFT_FORMS) naming an identifier that occurs in the
// base tree's source and nowhere in the start tree's source. Drift fails both scores (they have already failed) and is
// counted for the sensitivity reading. On S0 the start tree is the base tree, so no follow-on there is a drift case.
import { runBash } from "./history.ts";
import { DRIFT_FORMS, SOURCE_EXT, type DriftForm, type Lang } from "./langs.ts";
import { runName } from "./testrun.ts";
import type { SmUnit } from "./unit.ts";

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** The identifier one capture names: a qualified name's last segment, or a module path's last segment without its
 *  extension (./lib/parse_args.js and pkg.parse_args both name parse_args). */
export function identOf(capture: DriftForm["capture"], raw: string): string {
  const s = raw.trim().replace(/^['"\x60]|['"\x60]$/g, "");
  if (capture === "module") return (s.split("/").pop() ?? "").replace(/\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|py|json)$/, "").split(".").pop() ?? "";
  return s.split(/::|\.|->/).pop() ?? "";
}

/** Every identifier the language's drift forms name in a log, with the form kinds that named it, in first-seen order. */
export function namedIds(lang: Lang, log: string): { id: string; kinds: string[] }[] {
  const out = new Map<string, Set<string>>();
  for (const f of DRIFT_FORMS[lang])
    for (const m of log.matchAll(f.re)) {
      const id = identOf(f.capture, m[1] ?? "");
      if (IDENT.test(id)) (out.get(id) ?? out.set(id, new Set()).get(id)!).add(f.kind);
    }
  return [...out].map(([id, k]) => ({ id, kinds: [...k].sort() }));
}

/** The drift decision over named ids and where each occurs: drift ids are those in the base tree's source and not in
 *  the start tree's. fixFailed: a fail-to-pass test did not pass (drift is a reason the fix's tests fail, never more). */
export function decideDrift(fixFailed: boolean, named: string[], inBase: ReadonlySet<string>, inStart: ReadonlySet<string>): { drift: boolean; ids: string[] } {
  const ids = fixFailed ? named.filter((id) => inBase.has(id) && !inStart.has(id)) : [];
  return { drift: ids.length > 0, ids };
}

/** Which of ids occur (git grep -w, fixed string) in the source files of commit two's parent (the base tree) and of commit
 *  two (the start tree) in a follow-on tree volume. Source files are the language's SOURCE_EXT, tests included. */
export function occurrences(u: SmUnit, image: string, volume: string, ids: string[]): { base: Set<string>; start: Set<string> } {
  const base = new Set<string>(), start = new Set<string>();
  if (!ids.length) return { base, start };
  const script = 'cd "$1" && git config --global --add safe.directory "*" 2>/dev/null; while IFS= read -r id; do for rev in HEAD~1 HEAD; do git grep -l -w -F -e "$id" "$rev" -- 2>/dev/null | sed "s|^|$rev $id |"; done; done < "$2/ids"';
  const r = runBash({ kind: "docker", image, volume, repoDir: u.repo_dir, name: runName("drift") }, script, { ids: ids.join("\n") + "\n" });
  for (const l of r.stdout.split("\n")) {
    const m = l.match(/^(HEAD~1|HEAD) (\S+) [^:]+:(.+)$/);
    if (!m || !SOURCE_EXT[u.lang].test(m[3]!)) continue;
    (m[1] === "HEAD" ? start : base).add(m[2]!);
  }
  return { base, start };
}
