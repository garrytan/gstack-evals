// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals er sets (prereg 2026-11-08-geva-405, section 4, sets and timing): the calibration, comparison and reserve
// sets in seeded order (seed 20261108), quotas first, from audited units only, with the units digest; and the drop step
// that removes any candidate or unit matching a list of (repository, commit) pairs, for the counts-only custody opening
// against the sealed T-G and H task lists.
//   er sets calibration|comparison|reserve --work <custody dir> --out <sets.json> [--write]
//   er sets drop --work <custody dir> --pairs <file> [--candidates <mine.json> ...]
// The rules: 16 calibration units, 4 a type, only from units whose keys exist; then 56 comparison units, aiming at 14 a
// type and holding at least 10 of each; then 6 reserve units. At most 4 units a repository for mobile and consumer and
// 3 for the others, counted across every set, and no two units where one's aftermath holds the other.
// Build-time choices where the prereg is silent (lanes/eng-review/README.md, authoring side):
// - Audited: unit.json, key.json with at least one primary item that is neither generic nor mentioned, and a classifier
//   label. Pilot units are full units and may be drawn. A unit already in a set never enters a later draw.
// - Seeded order is sha256("20261108\n" + unit id). Quotas take each type's first units in that order (4, or 14 for the
//   comparison set); the comparison set's free places then take the next units of any type in the same order. The cap
//   and the aftermath rule skip a unit at its turn.
// - Supply stops (section 16, item 9) raise E_ER_SUPPLY_SHORT: a type short of 4 calibration units, a type short of 10
//   comparison units, or fewer than 48 comparison units in all. Transposed units are not built here, so the stop goes
//   to the Captain, who decides whether transposition fills a type.
// - The units digest is sha256 over the set's sorted lines "id, sha256 of unit.json, plan.md and key.json, and the
//   repo/ tree hash", after --write records set and rank.
// - drop matches a repository case-insensitively and a commit of at least 7 hex as a prefix of the unit's merge or base
//   commit (the candidate's change or base). A matched unit's folders are deleted; a matched candidate becomes
//   ineligible with the reason sealed_task_match. Only counts are printed.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../real-outcome/mine/git.ts";
import { pinnedHead } from "../../product-value/author/run.ts";
import { need, parseArgs, PvError, refuseInRepo, writeJson } from "../../product-value/io.ts";
import type { Io } from "../cli.ts";
import { PROJECT_TYPES, type Key, type ProjectType, type Set_, type UnitMeta } from "../types.ts";
import { CAP } from "./frame.ts";
import type { MineResult } from "./mine.ts";
import { order } from "./mine.ts";
import { custody, put, readJson } from "./run.ts";

export const SIZES = { calibration: { total: 16, quota: 4, floor: 4 }, comparison: { total: 56, quota: 14, floor: 10 }, reserve: { total: 6, quota: 0, floor: 0 } } as const;
export const MIN_COMPARISON = 48;
type Draw = keyof typeof SIZES;

export interface PoolUnit {
  id: string;
  type: ProjectType;
  repo: string;
  set: Set_;
  merge_sha: string;
  aftermath: string[];
}

const byOrder = (a: PoolUnit, b: PoolUnit) => (order(a.id) < order(b.id) ? -1 : 1);
const holds = (a: PoolUnit, b: PoolUnit) => a.aftermath.includes(b.merge_sha) || b.aftermath.includes(a.merge_sha);

/** One draw from the pool: units already in a set are skipped but count toward the caps and the aftermath rule. */
export function draw(what: Draw, pool: readonly PoolUnit[]): PoolUnit[] {
  const size = SIZES[what];
  const taken = pool.filter((u) => u.set === "calibration" || u.set === "comparison" || u.set === "reserve");
  const free = pool.filter((u) => !taken.includes(u)).sort(byOrder);
  const chosen: PoolUnit[] = [];
  const fits = (u: PoolUnit) => [...taken, ...chosen].filter((x) => x.repo === u.repo).length < CAP[u.type] && ![...taken, ...chosen].some((x) => holds(x, u));
  for (const t of PROJECT_TYPES) {
    let n = 0;
    for (const u of free.filter((x) => x.type === t)) {
      if (n >= size.quota) break;
      if (fits(u)) chosen.push(u), n++;
    }
  }
  const counts = PROJECT_TYPES.map((t) => t + " " + chosen.filter((u) => u.type === t).length).join(", ");
  const short = PROJECT_TYPES.filter((t) => chosen.filter((u) => u.type === t).length < size.floor);
  if (short.length) throw new PvError("E_ER_SUPPLY_SHORT", "the " + what + " set needs at least " + size.floor + " units of each type; " + short.join(" and ") + " fall short (" + counts + ")");
  for (const u of free) {
    if (chosen.length >= size.total) break;
    if (!chosen.includes(u) && fits(u)) chosen.push(u);
  }
  if (what === "comparison" && chosen.length < MIN_COMPARISON) throw new PvError("E_ER_SUPPLY_SHORT", "only " + chosen.length + " comparison units can be drawn, under " + MIN_COMPARISON + " (" + counts + ")");
  return chosen.sort(byOrder);
}

/** Why a unit is not audited. */
export function auditProblems(dir: string): string[] {
  const p: string[] = [];
  if (!existsSync(join(dir, "unit.json"))) p.push("no unit.json");
  const c = existsSync(join(dir, "classify.json")) ? readJson(join(dir, "classify.json")) : null;
  if (!c?.type) p.push("no classifier label");
  if (!existsSync(join(dir, "key.json"))) return [...p, "no key"];
  const key = readJson(join(dir, "key.json")) as Key;
  const items = new Map(key.items.map((i) => [i.id, i]));
  if (!key.primary.some((id) => items.get(id) && !items.get(id)!.generic && !items.get(id)!.mentioned)) p.push("no primary item");
  return p;
}

const fileHash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

export function unitsDigest(units: string, ids: readonly string[]): string {
  const lines = [...ids].sort().map((id) => [id, fileHash(join(units, id, "unit.json")), fileHash(join(units, id, "plan.md")), fileHash(join(units, id, "key.json")), git(join(units, id, "repo"), ["rev-parse", "HEAD^{tree}"]).trim()].join(" "));
  return createHash("sha256").update(lines.join("\n") + "\n").digest("hex");
}

export interface Pair {
  repo: string;
  commit: string;
}

export function readPairs(text: string): Pair[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [repo, commit] = l.split(/[\s,]+/);
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !commit || !/^[0-9a-f]{7,40}$/i.test(commit)) throw new PvError("E_USAGE", "a pairs line needs <owner/name> <commit of at least 7 hex>");
    return { repo: repo.toLowerCase(), commit: commit.toLowerCase() };
  });
}

export const matches = (pairs: readonly Pair[], repo: string, shas: readonly string[]) => pairs.some((p) => p.repo === repo.toLowerCase() && shas.some((s) => s.toLowerCase().startsWith(p.commit)));

const USAGE = "er sets calibration|comparison|reserve --work <custody dir> --out <sets.json> [--write] | er sets drop --work <custody dir> --pairs <file> [--candidates <mine.json> ...]";

export function run(argv: string[], io: Io, o: { custodyRoot?: string; head?: string } = {}): number {
  const [what, ...rest] = argv;
  const a = parseArgs(rest, { work: "one", out: "one", write: "flag", pairs: "one", candidates: "many" }, USAGE);
  need(a, ["work"], USAGE);
  const work = custody(a.one.work!, o.custodyRoot);
  const units = join(work, "units");
  const ids = existsSync(units) ? readdirSync(units).sort() : [];
  if (what === "drop") {
    need(a, ["pairs"], USAGE);
    const pairs = readPairs(readFileSync(a.one.pairs!, "utf8"));
    let removed = 0, ineligible = 0;
    for (const id of ids) {
      const f = join(units, id, "unit.json");
      if (!existsSync(f)) continue;
      const m = readJson(f) as UnitMeta;
      if (!matches(pairs, m.repo, [m.merge_sha, m.base_sha])) continue;
      rmSync(join(units, id), { recursive: true, force: true });
      rmSync(join(work, "scratch", id), { recursive: true, force: true });
      removed++;
    }
    for (const file of a.many.candidates ?? []) {
      const r = readJson(file) as MineResult;
      for (const c of r.candidates) if (c.eligible && matches(pairs, c.repo, [c.change, c.base])) Object.assign(c, { eligible: false, reasons: [...c.reasons, "sealed_task_match"] }), ineligible++;
      put(file, r);
    }
    io.out("er sets drop: " + pairs.length + " pairs read, " + removed + " units removed, " + ineligible + " candidates made ineligible");
    return 0;
  }
  if (!(what && what in SIZES)) throw new PvError("E_USAGE", USAGE);
  need(a, ["out"], USAGE);
  refuseInRepo("--out", a.one.out!);
  if (existsSync(a.one.out!)) throw new PvError("E_USAGE", a.one.out + " exists; each set is drawn once");
  const pool: PoolUnit[] = ids.filter((id) => !auditProblems(join(units, id)).length).map((id) => {
    const m = readJson(join(units, id, "unit.json")) as UnitMeta;
    return { id, type: m.type, repo: m.repo, set: m.set, merge_sha: m.merge_sha, aftermath: m.aftermath ?? [] };
  });
  const chosen = draw(what as Draw, pool);
  if (a.flag.has("write")) chosen.forEach((u, i) => put(join(units, u.id, "unit.json"), { ...(readJson(join(units, u.id, "unit.json")) as UnitMeta), set: what, rank: i + 1 }));
  const digest = unitsDigest(units, chosen.map((u) => u.id));
  const counts = Object.fromEntries(PROJECT_TYPES.map((t) => [t, chosen.filter((u) => u.type === t).length]));
  writeJson(a.one.out!, { seed: "20261108", head: o.head ?? pinnedHead(), set: what, pool: pool.length, drawn: chosen.map((u, i) => ({ rank: i + 1, id: u.id, type: u.type })), counts, units_digest: digest, written: a.flag.has("write") });
  io.out("er sets " + what + ": " + chosen.length + " drawn from " + pool.length + " audited units (" + PROJECT_TYPES.map((t) => t + " " + counts[t]).join(", ") + "); units digest " + digest);
  return 0;
}
