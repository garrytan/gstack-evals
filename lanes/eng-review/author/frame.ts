// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals er frame (prereg 2026-11-08-geva-405, section 4, gate answers I1 and J1): the widened frame and the free
// supply recount, no model call.
//   er frame search  --out <dir>    public repositories with at least 500 stars, not forks or archived, pushed since
//                                   2026-10-01, licensed MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0, GPL-2.0,
//                                   GPL-3.0, LGPL-2.1, LGPL-3.0 or AGPL-3.0, found by topic searches per type, each with
//                                   a provisional type and a copyleft mark, in seeded order (seed 20261108): frame.jsonl
//   er frame recount --frame <frame.jsonl> --work <custody dir> --out <counts dir> [--usable 10] [--types a,b]
//                    [--exclude <file of change shas>] [--mined-at <date>]
//                                   GEVA-405's supply count method on the widened frame: per type, repositories in
//                                   seeded order until about 10 are usable, local clones, er mine over every change
//                                   merged in the window, keyable units at the 120-word floor, the per-repository caps
//                                   (4 for mobile and consumer, 3 for the others) and projections to the frame, with
//                                   copyleft and without it. Per-repository records stay in --work; --out gets counts.
// Build-time choices where the prereg is silent (lanes/eng-review/README.md, authoring side):
// - Topic searches are product-value's per type (its "other" is developer tools here), up to 10 pages of 100 a topic. A
//   repository found under several types takes the first in the frozen rule's order (mobile, consumer, server-side,
//   developer tools). The type stays provisional: every unit's type comes from er classify.
// - The sample keeps drawing until it has the usable count and at least 4 usable repositories in each licence group
//   (or the group runs out), at most 45 tries a type, so the without-copyleft read has its own sample.
// - Usable: the clone succeeds, at least 20 first-parent changes merged in the window, test files at the head.
// - Before each repository's metadata read, a shared GraphQL quota under 2,500 points waits for its reset.
// - Clones are --no-checkout, single-branch, no tags, shallow back to 2026-05-01, LFS smudge off; one clone at a time,
//   deleted after its repository is mined.
// - Keyable (GEVA-405's strict read): an eligible unit with a defect revert or a B candidate of at least 2 blamed lines;
//   the wider read also counts a C candidate. Units whose aftermath holds another drawn unit are skipped, then the
//   per-repository cap applies, both in seeded order. A projection is capped keyable units per tried repository times
//   the frame's repositories, raw and at the count's 45% B precision.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchMeta } from "../../real-outcome/mine/fetch.ts";
import { gitLines, gitRun } from "../../real-outcome/mine/git.ts";
import type { RepoMeta } from "../../real-outcome/mine/meta.ts";
import { FLOOR, graphqlLeft, rest } from "../../product-value/author/gh.ts";
import { TOPICS as PV_TOPICS } from "../../product-value/author/mine.ts";
import { need, parseArgs, PvError, readRecords, refuseInRepo, writeJson } from "../../product-value/io.ts";
import type { Io } from "../cli.ts";
import { PROJECT_TYPES, type ProjectType } from "../types.ts";
import { COPYLEFT, erClass, LICENCES, mineClone, order, strictBR, WINDOW, withPlans, type Candidate, type MineResult } from "./mine.ts";

export const MIN_STARS = 500, PUSHED_SINCE = "2026-10-01", SHALLOW_SINCE = "2026-05-01", MIN_WINDOW_CHANGES = 20, MAX_TRIES = 45, GROUP_MIN = 4, B_PRECISION = 0.45;
export const CAP: Record<ProjectType, number> = { mobile: 4, consumer: 4, server: 3, devtools: 3 };
export const TOPICS: Record<ProjectType, string[]> = { mobile: PV_TOPICS.mobile, consumer: PV_TOPICS.consumer, server: PV_TOPICS.server, devtools: PV_TOPICS.other };

export interface FrameRepo {
  repo: string;
  stars: number;
  licence: string;
  copyleft: boolean;
  type_prov: ProjectType;
  topics: string[];
  default_branch: string;
  order: string;
}

/** Search items to frame rows: licence, fork and archive filters, the provisional type by rule order, seeded order. */
export function frameRows(found: Array<{ type: ProjectType; topic: string; item: any }>): FrameRepo[] {
  const rows = new Map<string, FrameRepo>();
  for (const { type, topic, item } of found) {
    const spdx = item.license?.spdx_id;
    if (!LICENCES.includes(spdx) || item.fork || item.archived || item.stargazers_count < MIN_STARS || !(item.pushed_at >= PUSHED_SINCE)) continue;
    const prev = rows.get(item.full_name);
    const t = prev && PROJECT_TYPES.indexOf(prev.type_prov) < PROJECT_TYPES.indexOf(type) ? prev.type_prov : type;
    rows.set(item.full_name, { repo: item.full_name, stars: item.stargazers_count, licence: spdx, copyleft: COPYLEFT.includes(spdx), type_prov: t, topics: [...new Set([...(prev?.topics ?? []), topic])], default_branch: item.default_branch, order: order(item.full_name) });
  }
  return [...rows.values()].sort((a, b) => (a.order < b.order ? -1 : 1));
}

function search(out: string, types: ProjectType[], io: Io, get: (path: string) => any = rest, sleep = (ms: number) => Bun.sleepSync(ms)): number {
  const found: Array<{ type: ProjectType; topic: string; item: any }> = [];
  let calls = 0;
  for (const type of types)
    for (const topic of TOPICS[type])
      for (let page = 1; page <= 10; page++) {
        const q = encodeURIComponent("topic:" + topic + " stars:>=" + MIN_STARS + " pushed:>=" + PUSHED_SINCE + " archived:false fork:false");
        const r = get("search/repositories?q=" + q + "&sort=stars&order=desc&per_page=100&page=" + page);
        calls++;
        sleep(2_200);
        for (const item of r.items ?? []) found.push({ type, topic, item });
        if ((r.items ?? []).length < 100) break;
      }
  const rows = frameRows(found);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "frame.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const tally = types.map((t) => t + " " + rows.filter((r) => r.type_prov === t).length + " (" + rows.filter((r) => r.type_prov === t && r.copyleft).length + " copyleft)").join(", ");
  appendFileSync(join(out, "frame.log"), JSON.stringify({ at: new Date().toISOString(), rest_search_calls: calls, retrieved: found.length, frame: rows.length }) + "\n");
  io.out("er frame search: " + calls + " search calls, " + found.length + " items, frame of " + rows.length + ": " + tally);
  return 0;
}

export interface RepoCount {
  repo: string;
  type: ProjectType;
  copyleft: boolean;
  usable: boolean;
  why: string | null;
  window_changes: number;
  features: number;
  pre_plan: number;
  with_pr: number;
  plan120: number;
  keyable: Record<"strict" | "wide", Record<"w1" | "w2", number>>;
  capped: Record<"strict" | "wide", number>;
  graphql_points: number;
  /** Unit change shas, for the exclusion list; this record stays in custody. */
  units: string[];
}

/** Seeded order, then skip a unit whose aftermath holds a drawn unit or that a drawn unit's aftermath holds, then the cap. */
export function capUnits(units: Candidate[], cap: number): Candidate[] {
  const drawn: Candidate[] = [];
  for (const u of [...units].sort((a, b) => (order(a.id) < order(b.id) ? -1 : 1))) {
    if (drawn.length >= cap) break;
    if (drawn.some((d) => d.aftermath.some((x) => x.change === u.change) || u.aftermath.some((x) => x.change === d.change))) continue;
    drawn.push(u);
  }
  return drawn;
}

/** One mined repository's counts, after the exclusion list. */
export function countRepo(r: MineResult, type: ProjectType, copyleft: boolean, exclude: Set<string>, points: number): RepoCount {
  const cands = r.candidates.filter((c) => !exclude.has(c.change));
  const pre = cands.filter((c) => c.eligible || c.reasons.every((x) => x === "no_plan_text" || x === "plan_under_120_words"));
  const ok = cands.filter((c) => c.eligible);
  const wide = (c: Candidate) => strictBR(c) || c.aftermath.some((x) => x.kind === "C");
  const split = (f: (c: Candidate) => boolean) => ({ w1: ok.filter((c) => c.wave === 1 && f(c)).length, w2: ok.filter((c) => c.wave === 2 && f(c)).length });
  return {
    repo: r.repo, type, copyleft, usable: true, why: null, window_changes: r.window_changes, features: cands.filter((c) => c.kind === "feature").length, pre_plan: pre.length,
    with_pr: pre.filter((c) => c.pr !== null).length, plan120: ok.length, keyable: { strict: split(strictBR), wide: split(wide) },
    capped: { strict: capUnits(ok.filter(strictBR), CAP[type]).length, wide: capUnits(ok.filter(wide), CAP[type]).length }, graphql_points: points, units: cands.map((c) => c.change),
  };
}

const empty = (repo: string, type: ProjectType, copyleft: boolean, why: string, window = 0): RepoCount => ({ repo, type, copyleft, usable: false, why, window_changes: window, features: 0, pre_plan: 0, with_pr: 0, plan120: 0, keyable: { strict: { w1: 0, w2: 0 }, wide: { w1: 0, w2: 0 } }, capped: { strict: 0, wide: 0 }, graphql_points: 0, units: [] });

export interface Miner {
  clone: (repo: string, dir: string) => boolean;
  meta: (repo: string) => RepoMeta;
  points: () => number;
  plans: Parameters<typeof withPlans>[1] | undefined;
}

const realMiner: Miner = {
  clone: (repo, dir) => {
    const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "clone", "--quiet", "--no-checkout", "--single-branch", "--no-tags", "--shallow-since=" + SHALLOW_SINCE, "https://github.com/" + repo + ".git", dir], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_OPTIONAL_LOCKS: "0" }, timeout: 20 * 60_000, encoding: "utf8" });
    return r.status === 0;
  },
  meta: (repo) => {
    const left = graphqlLeft();
    if (left.remaining < FLOOR) Bun.sleepSync(Math.max(0, left.reset * 1000 - Date.now()) + 5_000);
    return fetchMeta(repo, WINDOW.from);
  },
  points: () => graphqlLeft().remaining,
  plans: undefined,
};

/** Mines one frame repository into its counts; the clone is deleted before it returns. */
export function mineOne(f: FrameRepo, work: string, minedAt: string, exclude: Set<string>, m: Miner): RepoCount {
  const dir = join(work, "clone");
  rmSync(dir, { recursive: true, force: true });
  try {
    if (!m.clone(f.repo, dir)) return empty(f.repo, f.type_prov, f.copyleft, "clone_failed");
    const n = gitRun(dir, ["rev-list", "--first-parent", "--count", "--since=" + WINDOW.from, "--until=" + WINDOW.to + "T23:59:59Z", "HEAD"]);
    const windowChanges = Number(n.stdout.trim()) || 0;
    if (windowChanges < MIN_WINDOW_CHANGES) return empty(f.repo, f.type_prov, f.copyleft, "under_20_window_changes", windowChanges);
    if (!gitLines(dir, ["ls-tree", "-r", "--name-only", "HEAD"]).some((p) => erClass(p) === "test")) return empty(f.repo, f.type_prov, f.copyleft, "no_tests", windowChanges);
    const before = m.points();
    const r = mineClone({ repoDir: dir, repo: f.repo, licence: f.licence, branch: "HEAD", meta: m.meta(f.repo), minedAt });
    withPlans(r, m.plans);
    return countRepo(r, f.type_prov, f.copyleft, exclude, Math.max(0, before - m.points()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The repositories to try in seeded order: until usable is reached and each licence group has GROUP_MIN usable or runs out. */
export function wantMore(done: RepoCount[], usable: number, left: { copyleft: number; permissive: number }): boolean {
  if (done.length >= MAX_TRIES) return false;
  const u = done.filter((d) => d.usable);
  if (u.length < usable) return true;
  return (u.filter((d) => d.copyleft).length < GROUP_MIN && left.copyleft > 0) || (u.filter((d) => !d.copyleft).length < GROUP_MIN && left.permissive > 0);
}

export interface TypeRead {
  type: ProjectType;
  group: "all" | "permissive";
  frame: number;
  tried: number;
  usable: number;
  window_changes: number;
  features: number;
  pre_plan: number;
  with_pr: number;
  plan120: number;
  keyable_strict: { w1: number; w2: number };
  keyable_wide: { w1: number; w2: number };
  capped_strict: number;
  capped_wide: number;
  projection_strict: number;
  projection_strict_at_precision: number;
  projection_wide: number;
}

export function readType(type: ProjectType, group: "all" | "permissive", frame: FrameRepo[], counts: RepoCount[]): TypeRead {
  const fr = frame.filter((f) => f.type_prov === type && (group === "all" || !f.copyleft));
  const c = counts.filter((x) => x.type === type && (group === "all" || !x.copyleft));
  const sum = (f: (x: RepoCount) => number) => c.reduce((s, x) => s + f(x), 0);
  const per = (k: number) => (c.length ? (k / c.length) * fr.length : 0);
  const capped = sum((x) => x.capped.strict);
  return {
    type, group, frame: fr.length, tried: c.length, usable: c.filter((x) => x.usable).length, window_changes: sum((x) => x.window_changes), features: sum((x) => x.features), pre_plan: sum((x) => x.pre_plan),
    with_pr: sum((x) => x.with_pr), plan120: sum((x) => x.plan120), keyable_strict: { w1: sum((x) => x.keyable.strict.w1), w2: sum((x) => x.keyable.strict.w2) }, keyable_wide: { w1: sum((x) => x.keyable.wide.w1), w2: sum((x) => x.keyable.wide.w2) },
    capped_strict: capped, capped_wide: sum((x) => x.capped.wide), projection_strict: Math.round(per(capped)), projection_strict_at_precision: Math.round(per(capped) * B_PRECISION), projection_wide: Math.round(per(sum((x) => x.capped.wide))),
  };
}

export function funnelTable(reads: TypeRead[]): string {
  const head = "| Type | Licences | Frame | Usable / tried | Window changes | Features | Eligible before plan | With PR | Plan 120+ | Keyable strict (wave 1 + 2) | Capped strict | Projection strict (raw / 45%) | Capped with C | Projection with C |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  return head + "\n" + reads.map((r) => "| " + [r.type, r.group === "all" ? "with copyleft" : "permissive only", r.frame, r.usable + " / " + r.tried, r.window_changes, r.features, r.pre_plan, r.with_pr, r.plan120, r.keyable_strict.w1 + " + " + r.keyable_strict.w2, r.capped_strict, r.projection_strict + " / " + r.projection_strict_at_precision, r.capped_wide, r.projection_wide].join(" | ") + " |").join("\n") + "\n";
}

export function recount(o: { frame: FrameRepo[]; work: string; out: string; usable: number; types: ProjectType[]; exclude: Set<string>; minedAt: string; miner?: Miner; io: Io }): TypeRead[] {
  const m = o.miner ?? realMiner;
  mkdirSync(join(o.work, "repos"), { recursive: true, mode: 0o700 });
  mkdirSync(o.out, { recursive: true });
  const all: RepoCount[] = [];
  const startLeft = m.points();
  for (const type of o.types) {
    const rows = o.frame.filter((f) => f.type_prov === type).sort((a, b) => (a.order < b.order ? -1 : 1));
    const done: RepoCount[] = [];
    for (const [i, f] of rows.entries()) {
      const rest_ = rows.slice(i);
      if (!wantMore(done, o.usable, { copyleft: rest_.filter((x) => x.copyleft).length, permissive: rest_.filter((x) => !x.copyleft).length })) break;
      const usableLeft = done.filter((d) => d.usable);
      if (usableLeft.length >= o.usable && (f.copyleft ? usableLeft.filter((d) => d.copyleft).length >= GROUP_MIN : usableLeft.filter((d) => !d.copyleft).length >= GROUP_MIN)) continue;
      const file = join(o.work, "repos", order(f.repo).slice(0, 16) + ".json");
      const c = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RepoCount) : mineOne(f, o.work, o.minedAt, o.exclude, m);
      writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
      done.push(c);
      appendFileSync(join(o.out, "progress.log"), JSON.stringify({ at: new Date().toISOString(), type, tried: done.length, usable: done.filter((d) => d.usable).length, plan120: c.plan120, capped_strict: c.capped.strict }) + "\n");
    }
    all.push(...done);
  }
  const reads = o.types.flatMap((t) => [readType(t, "all", o.frame, all), readType(t, "permissive", o.frame, all)]);
  const endLeft = m.points();
  writeJson(join(o.out, "funnel.json"), { at: new Date().toISOString(), mined_at: o.minedAt, excluded_changes: o.exclude.size, graphql_left_before: startLeft, graphql_left_after: endLeft, reads });
  writeFileSync(join(o.out, "funnel.md"), funnelTable(reads));
  o.io.out("er frame recount: " + all.length + " repositories tried, " + all.filter((x) => x.usable).length + " usable; funnel written to " + join(o.out, "funnel.md"));
  return reads;
}

const USAGE = "er frame search --out <dir> [--types a,b] | er frame recount --frame <frame.jsonl> --work <custody dir> --out <counts dir> [--usable 10] [--types a,b] [--exclude <file>] [--mined-at <date>]";

export function run(argv: string[], io: Io): number {
  const [sub, ...rest_] = argv;
  const a = parseArgs(rest_, { out: "one", types: "one", frame: "one", work: "one", usable: "one", exclude: "one", "mined-at": "one" }, USAGE);
  const types = (a.one.types ?? PROJECT_TYPES.join(",")).split(",") as ProjectType[];
  if (types.some((t) => !PROJECT_TYPES.includes(t))) throw new PvError("E_USAGE", "--types takes " + PROJECT_TYPES.join(", "));
  if (sub === "search") {
    need(a, ["out"], USAGE);
    return search(a.one.out!, types, io);
  }
  if (sub !== "recount") throw new PvError("E_USAGE", USAGE);
  need(a, ["frame", "work", "out"], USAGE);
  for (const f of ["work", "out"]) refuseInRepo("--" + f, a.one[f]!);
  const exclude = new Set(a.one.exclude ? readFileSync(a.one.exclude, "utf8").split(/\s+/).filter(Boolean) : []);
  recount({ frame: readRecords<FrameRepo>(a.one.frame!, "--frame"), work: a.one.work!, out: a.one.out!, usable: Number(a.one.usable ?? 10), types, exclude, minedAt: a.one["mined-at"] ?? new Date().toISOString().slice(0, 10), io });
  return 0;
}
