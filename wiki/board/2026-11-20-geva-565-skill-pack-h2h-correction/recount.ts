// Copyright (c) 2026 Garry Tan. MIT License.
// Recounts the correction's figures from the published stage 2 session data, keyless. Run from the repository root:
//   bun wiki/board/2026-11-20-geva-565-skill-pack-h2h-correction/recount.ts
// Test files are the scorer's own path conventions (TEST_PATH in lanes/outcome-skills/statemachines/langs.ts) with no
// unit test patch, because the units' hidden test patches are not published. The line ratio is the scorer's
// lines_changed, the one the preregistered ratio uses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTestPath, type Lang } from "../../../lanes/outcome-skills/statemachines/langs.ts";
import { fileDiffs } from "../../../lanes/outcome-skills/statemachines/secondary.ts";
import { logRatio } from "../../../lanes/outcome-skills/h2h/analysis/stats.ts";
import { readPrereg } from "../../../lanes/outcome-skills/h2h/prereg.ts";
import { scriptedTurns } from "../../../lanes/outcome-skills/h2h/sessions/turns.ts";

const D = "wiki/board/2026-11-19-geva-540-skill-pack-h2h-session-data";
interface Sess {
  session: string; unit: string; arm: string; class: "O" | "B2"; repo: string; lang: Lang; gap: string | null; cost_usd: number; continuations: number;
  tools: Record<string, number>; skills_launched: string[]; diff: string | null;
  score: { verified: boolean; lines_changed: number; gap: string | null } | null;
}
const lines = (f: string) => readFileSync(join(D, f), "utf8").split("\n").filter((l) => l.trim());
const S: Sess[] = lines("sessions.jsonl").map((l) => JSON.parse(l));
const scores = new Map(lines("score-records.jsonl").map((l) => JSON.parse(l)).map((r) => [r.unit + "|" + r.arm, r]));
const pct = (a: number, b: number) => ((100 * a) / b).toFixed(1);
const out: string[] = [];
const say = (s = "") => out.push(s);

const p = readPrereg();
say("1. Where the sentence goes (sessions/turns.ts scriptedTurns, gstack-oneline against gstack)");
say("   sentence: " + p.texts.oneline);
for (const entry of ["bug", "feature"] as const) {
  const one = scriptedTurns("gstack-oneline", entry, "<problem statement>", { prereg: p });
  const base = scriptedTurns("gstack", entry, "<problem statement>", { prereg: p });
  say("   " + entry + ": scripted turns " + one.length + "; turns carrying the sentence " + one.filter((t) => t.includes(p.texts.oneline)).length + "; the first ends with a blank line and the sentence " + one[0]!.endsWith("\n\n" + p.texts.oneline) + "; every turn is gstack's turn plus that ending " + one.every((t, k) => t === base[k] + "\n\n" + p.texts.oneline));
}
const oneS = S.filter((s) => s.arm === "gstack-oneline");
say("   gstack-oneline sessions with a continuation turn: " + oneS.filter((s) => s.continuations > 0).length + " of " + oneS.length);
say();

let mismatch = 0;
for (const s of S) {
  const r = scores.get(s.unit + "|" + s.arm);
  if (s.score && r && (r.verified !== s.score.verified || r.lines_changed !== s.score.lines_changed)) mismatch++;
}
say("sessions " + S.length + "; sessions.jsonl and score-records.jsonl disagree on verified or lines_changed in " + mismatch);
say();

const LOOSE = /test|spec|fixture|snapshots\/|expected/i;
const testFiles = (s: Sess): { files: number; lines: number; other: number; otherLines: number; loose: number } => {
  if (!s.diff) return { files: 0, lines: 0, other: 0, otherLines: 0, loose: 0 };
  let files = 0, n = 0, other = 0, otherLines = 0, loose = 0;
  for (const f of fileDiffs(readFileSync(join(D, s.diff), "utf8"))) {
    const path = f.newPath ?? f.oldPath ?? "";
    const k = f.plus.length + f.minus.length;
    if (!isTestPath(s.lang, path, new Set())) {
      other++;
      otherLines += k;
      if (LOOSE.test(path)) loose += k;
      continue;
    }
    files++;
    n += k;
  }
  return { files, lines: n, other, otherLines, loose };
};
// The test-like lines the scorer must have counted in lines_changed. The scorer also leaves out generated files, lockfiles
// and in-source test modules, which the published records don't name, so at most (otherLines - lines_changed) of the loose
// lines were already left out. Subtracting only the rest never removes a line the scorer didn't count.
const countedLoose = (t: { otherLines: number; loose: number }, linesChanged: number) => Math.max(0, t.loose - Math.max(0, t.otherLines - linesChanged));

const O = S.filter((s) => s.class === "O");
const arms = [...new Set(S.map((s) => s.arm))].sort();
say("2a. O sessions that changed at least one test file, by arm (exploratory, not preregistered)");
for (const a of arms) {
  const ss = O.filter((s) => s.arm === a);
  if (!ss.length) continue;
  say("   " + a.padEnd(15) + " " + ss.filter((s) => testFiles(s).files > 0).length + " of " + ss.length);
}
say();

const by = (arm: string) => new Map(O.filter((s) => s.arm === arm).map((s) => [s.unit, s]));
const g = by("gstack"), o = by("gstack-oneline");
const both = [...g.keys()].filter((u) => g.get(u)!.score?.verified && o.get(u)?.score?.verified).sort();
const tg = both.map((u) => testFiles(g.get(u)!)), to = both.map((u) => testFiles(o.get(u)!));
say("2b. The " + both.length + " O units both gstack and gstack-oneline fixed");
say("   changed a test file: gstack " + tg.filter((t) => t.files > 0).length + ", gstack-oneline " + to.filter((t) => t.files > 0).length);
say("   gstack changed one and gstack-oneline did not: " + both.filter((_, k) => tg[k]!.files > 0 && to[k]!.files === 0).length + "; the reverse: " + both.filter((_, k) => tg[k]!.files === 0 && to[k]!.files > 0).length);
say("   test-file lines changed: gstack " + tg.reduce((a, t) => a + t.lines, 0) + ", gstack-oneline " + to.reduce((a, t) => a + t.lines, 0));
say("   lines in files outside the conventions whose path holds test, spec, fixture, snapshots/ or expected: gstack " + tg.reduce((a, t) => a + t.loose, 0) + ", gstack-oneline " + to.reduce((a, t) => a + t.loose, 0) + ", in " + both.filter((_, k) => tg[k]!.loose + to[k]!.loose > 0).length + " units");
const rg = tg.reduce((a, t) => a + t.lines + t.otherLines, 0), ro = to.reduce((a, t) => a + t.lines + t.otherLines, 0);
say("   raw changed lines, all files in each diff: gstack " + rg + ", gstack-oneline " + ro + " = " + (ro / rg).toFixed(3));
say("   files changed outside tests: gstack " + tg.reduce((a, t) => a + t.other, 0) + ", gstack-oneline " + to.reduce((a, t) => a + t.other, 0) + "; units where gstack-oneline changed fewer, as many, more: " + both.filter((_, k) => to[k]!.other < tg[k]!.other).length + ", " + both.filter((_, k) => to[k]!.other === tg[k]!.other).length + ", " + both.filter((_, k) => to[k]!.other > tg[k]!.other).length);
const pairs = both.map((u) => ({ repo: g.get(u)!.repo, x: g.get(u)!.score!.lines_changed, y: o.get(u)!.score!.lines_changed }));
const lr = logRatio(pairs, p.bootstrap_seed);
const sx = pairs.reduce((a, q) => a + q.x, 0), sy = pairs.reduce((a, q) => a + q.y, 0);
const ratios = pairs.filter((q) => q.x > 0 && q.y > 0).map((q) => q.y / q.x).sort((a, b) => a - b);
const med = (v: number[]) => (v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2);
say("   non-test lines (scorer's lines_changed), gstack-oneline over gstack:");
say("     geometric mean of paired ratios (preregistered, bootstrap seed " + p.bootstrap_seed + "): " + lr.ratio!.toFixed(3) + " [" + lr.ci95![0].toFixed(3) + ", " + lr.ci95![1].toFixed(3) + "], n " + lr.n + ", zero pairs left out " + lr.zero_excluded);
say("     total lines: " + sy + " over " + sx + " = " + (sy / sx).toFixed(3));
say("     median paired ratio: " + med(ratios).toFixed(3) + "; median lines per unit " + med(pairs.map((q) => q.y).sort((a, b) => a - b)) + " against " + med(pairs.map((q) => q.x).sort((a, b) => a - b)));
say("     units smaller, equal, larger: " + pairs.filter((q) => q.y < q.x).length + ", " + pairs.filter((q) => q.y === q.x).length + ", " + pairs.filter((q) => q.y > q.x).length);
const gl = (u: string) => g.get(u)!.score!.lines_changed, ol = (u: string) => o.get(u)!.score!.lines_changed;
const strictPairs = both.map((u, k) => ({ repo: g.get(u)!.repo, x: gl(u) - countedLoose(tg[k]!, gl(u)), y: ol(u) - countedLoose(to[k]!, ol(u)) }));
say("     sessions whose non-test diff lines equal the scorer's lines_changed: " + both.filter((u, k) => tg[k]!.otherLines === gl(u)).length + " of " + both.length + " gstack, " + both.filter((u, k) => to[k]!.otherLines === ol(u)).length + " of " + both.length + " gstack-oneline");
say("     test-like lines the scorer counted (lower bound): gstack " + both.reduce((a, u, k) => a + countedLoose(tg[k]!, gl(u)), 0) + ", gstack-oneline " + both.reduce((a, u, k) => a + countedLoose(to[k]!, ol(u)), 0));
const lrs = logRatio(strictPairs, p.bootstrap_seed);
say("     sensitivity, not preregistered: those counted test-like lines taken out of lines_changed: geometric mean " + lrs.ratio!.toFixed(3) + " [" + lrs.ci95![0].toFixed(3) + ", " + lrs.ci95![1].toFixed(3) + "], n " + lrs.n + "; total " + strictPairs.reduce((a, q) => a + q.y, 0) + " over " + strictPairs.reduce((a, q) => a + q.x, 0) + " = " + (strictPairs.reduce((a, q) => a + q.y, 0) / strictPairs.reduce((a, q) => a + q.x, 0)).toFixed(3));
const units = [...g.keys()].filter((u) => o.has(u));
const vg = units.filter((u) => g.get(u)!.score?.verified).length, vo = units.filter((u) => o.get(u)!.score?.verified).length;
say("   hidden tests passed (verified), 100 O units: gstack " + vg + ", gstack-oneline " + vo + "; only gstack " + units.filter((u) => g.get(u)!.score?.verified && !o.get(u)!.score?.verified).length + ", only gstack-oneline " + units.filter((u) => !g.get(u)!.score?.verified && o.get(u)!.score?.verified).length);
const calls = (m: Map<string, Sess>) => [...m.values()].reduce((a, s) => a + Object.values(s.tools).reduce((x, y) => x + y, 0), 0) / m.size;
say("   mean tool calls per O session: gstack " + calls(g).toFixed(1) + ", gstack-oneline " + calls(o).toFixed(1));
say();

say("3a. Skill tool calls, skills launched and subagent launches (Agent or Task tool), all sessions per arm");
for (const a of arms) {
  const ss = S.filter((s) => s.arm === a);
  const skillCall = ss.filter((s) => (s.tools.Skill ?? 0) > 0).length;
  const launched = ss.filter((s) => s.skills_launched.length > 0).length;
  const sub = ss.filter((s) => (s.tools.Agent ?? 0) + (s.tools.Task ?? 0) > 0).length;
  say("   " + a.padEnd(15) + " sessions " + String(ss.length).padStart(3) + ", with a Skill call " + skillCall + ", with a skill launched " + launched + ", with a subagent " + sub);
}
say("   tool names seen in any session: " + [...new Set(S.flatMap((s) => Object.keys(s.tools)))].sort().join(", "));
say();

say("3b. Cost per verified fix against no pack (every session's dollars over verified fixes, as the page's table), by class");
const packs = ["gstack", "superpowers", "agent-skills", "gsd", "pstack", "tstack"];
for (const c of ["O", "B2"] as const) {
  const per = (a: string) => {
    const ss = S.filter((s) => s.class === c && s.arm === a);
    return ss.reduce((x, s) => x + s.cost_usd, 0) / ss.filter((s) => s.score?.verified).length;
  };
  const none = per("none");
  const more = packs.filter((a) => per(a) > none);
  say("   " + c + ": " + more.length + " of " + packs.length + " packs cost more per verified fix than no pack (" + more.join(", ") + "); cost less or the same: " + (packs.filter((a) => !(per(a) > none)).join(", ") || "none"));
}
console.log(out.join("\n"));
