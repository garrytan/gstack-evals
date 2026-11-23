// Copyright (c) 2026 Garry Tan. MIT License.
// pv taste (prereg 2026-11-08-geva-403, section 15): the owner's 10 blind taste pairs from calibration units. It never
// counts toward any score. From each family's stage 1 rows it pairs every Opus skill list with the Opus none list on the
// same unit (its lowest pass with a block) and, where one exists, the Opus lens list. It draws 7 plan and 3 brief pairs
// in seeded order, hides the arms and orders each pair by a seeded coin. One Opus call per drawn (family, unit) writes a
// summary of at most 150 words from plan.md (or brief.md) and context/ only, metered on the render item. pairs.md
// carries no unit id, arm or key; --answers (outside --out) maps each pair to its unit, arms, sessions and lists.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Io } from "./cli.ts";
import { loadUnits, need, parseArgs, PvError, readRows, refuseAliases, refuseInRepo, writeJson } from "./io.ts";
import { openJudge } from "./judge.ts";
import { SEED } from "./stats.ts";
import type { ArmId, Family, Row } from "./types.ts";

export const TASTE_COUNTS: Readonly<Record<Family, number>> = { plan: 7, brief: 3 };
export const SUMMARY_WORDS = 150;
const CONTEXT_CHARS = 60_000;

export function summaryPrompt(family: Family, input: string, context: string): string {
  const what = family === "plan" ? "a software team's plan for a change to its product" : "the problem a software team faced before it planned a change to its product";
  return [
    "Below is " + what + ", and what the team knew about the product at the time.",
    "Write a plain summary of at most " + SUMMARY_WORDS + " words for a reader who will compare lists of changes proposed for it: what the product is, who uses it, and " + (family === "plan" ? "what the plan sets out to do." : "what the problem is."),
    "Use only what the text says. Add no opinion, risk, suggestion, outcome or anything that happened later, and name no real project, company or person. Output only the summary.",
    "",
    "<" + (family === "plan" ? "plan" : "brief") + ">",
    input.trim(),
    "</" + (family === "plan" ? "plan" : "brief") + ">",
    "",
    "<context>",
    context.trim(),
    "</context>",
  ].join("\n");
}

export const PROMPT_TEMPLATE_SHA256 = createHash("sha256").update(summaryPrompt("plan", "{input}", "{context}") + "\n" + summaryPrompt("brief", "{input}", "{context}")).digest("hex");

const hex = (s: string) => createHash("sha256").update(s).digest("hex");

export interface Candidate {
  family: Family;
  unit: string;
  partner: Exclude<ArmId, "skill">;
  skill: Row;
  other: Row;
}

/** Every (Opus skill list, Opus none or lens list) pair on one unit, both with a block. */
export function candidates(family: Family, rows: readonly Row[]): Candidate[] {
  const opus = rows.filter((r) => r.family === family && r.model === "opus" && r.end === "block" && r.list && r.list.length > 0);
  const out: Candidate[] = [];
  for (const skill of opus.filter((r) => r.arm === "skill").sort((a, b) => (a.unit + "/" + a.pass < b.unit + "/" + b.pass ? -1 : 1))) {
    if (out.some((c) => c.unit === skill.unit)) continue;
    for (const partner of ["none", "lens"] as const) {
      const other = opus.filter((r) => r.unit === skill.unit && r.arm === partner).sort((a, b) => a.pass - b.pass)[0];
      if (other) out.push({ family, unit: skill.unit, partner, skill, other });
    }
  }
  return out;
}

export interface Drawn extends Candidate {
  pair: number;
  skillIsA: boolean;
}

/** The seeded draw: candidates in sha256(seed, family, unit, partner) order, the first n per family; plan pairs come first. */
export function draw(rows: readonly Row[], seed = SEED): Drawn[] {
  const out: Drawn[] = [];
  for (const family of ["plan", "brief"] as const) {
    const pool = candidates(family, rows).map((c) => ({ c, k: hex(seed + "\n" + family + "\n" + c.unit + "\n" + c.partner) })).sort((a, b) => (a.k < b.k ? -1 : 1));
    if (pool.length < TASTE_COUNTS[family]) throw new PvError("E_USAGE", "the " + family + " family has " + pool.length + " Opus skill pairs with a block on both sides, and the taste packet needs " + TASTE_COUNTS[family]);
    for (const { c } of pool.slice(0, TASTE_COUNTS[family])) out.push({ ...c, pair: out.length + 1, skillIsA: parseInt(hex(seed + "\nab\n" + family + "\n" + c.unit + "\n" + c.partner).slice(0, 2), 16) < 128 });
  }
  return out;
}

function readContext(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  return files.map((f) => "## " + relative(dir, f) + "\n" + readFileSync(f, "utf8")).join("\n\n").slice(0, CONTEXT_CHARS);
}

/** Cuts a summary to SUMMARY_WORDS words; reports whether it cut. */
export function capWords(text: string): { text: string; cut: boolean } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= SUMMARY_WORDS ? { text: words.join(" "), cut: false } : { text: words.slice(0, SUMMARY_WORDS).join(" ") + " ...", cut: true };
}

export function renderPairs(drawn: readonly Drawn[], summaries: ReadonlyMap<string, string>): string {
  const list = (xs: readonly string[]) => xs.map((x, i) => (i + 1) + ". " + x).join("\n");
  return drawn.map((d) => {
    const [a, b] = d.skillIsA ? [d.skill.list!, d.other.list!] : [d.other.list!, d.skill.list!];
    return ["## Pair " + d.pair, "", summaries.get(d.family + "/" + d.unit)!, "", "**List A**", "", list(a), "", "**List B**", "", list(b)].join("\n");
  }).join("\n\n") + "\n";
}

const USAGE = "gstack-evals pv taste --units <dir> --plan-rows <rows> --brief-rows <rows> --out <dir> --answers <answers.json> --item <ledger item> --run-id <id> --cache <dir> [--record <dir>] [--ledger <path>]";

export async function run(argv: string[], io: Io, o: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {}): Promise<number> {
  const a = parseArgs(argv, { units: "one", "plan-rows": "one", "brief-rows": "one", out: "one", answers: "one", item: "one", "run-id": "one", cache: "one", record: "one", ledger: "one" }, USAGE);
  need(a, ["units", "plan-rows", "brief-rows", "out", "answers", "item", "run-id", "cache"], USAGE);
  const paths: Array<[string, string]> = [["--units", a.one.units!], ["--plan-rows", a.one["plan-rows"]!], ["--brief-rows", a.one["brief-rows"]!], ["--out", a.one.out!], ["--answers", a.one.answers!], ["--cache", a.one.cache!]];
  for (const f of ["record", "ledger"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  for (const f of ["out", "answers", "cache"]) refuseInRepo("--" + f, a.one[f]!);
  if (relative(a.one.out!, a.one.answers!).split("/")[0] !== "..") throw new PvError("E_USAGE", "--answers must sit outside --out, so the packet folder holds no arm or unit id");
  const units = loadUnits(a.one.units!, { keys: false });
  const rows = [...readRows(a.one["plan-rows"]!).filter((r) => r.family === "plan"), ...readRows(a.one["brief-rows"]!).filter((r) => r.family === "brief")];
  const drawn = draw(rows);
  for (const d of drawn) {
    const u = units.get(d.unit);
    if (!u) throw new PvError("E_USAGE", d.unit + " has rows but no unit folder under " + a.one.units);
    if (u.meta.set !== "calibration") throw new PvError("E_USAGE", d.unit + " is in set " + u.meta.set + ", and the taste packet draws calibration units only");
  }
  mkdirSync(a.one.out!, { recursive: true, mode: 0o700 });
  const judge = await openJudge({ item: a.one.item!, runId: a.one["run-id"]!, out: a.one.out!, cacheDir: a.one.cache!, record: a.one.record, ledger: a.one.ledger, env: o.env, fetch: o.fetch, io });
  const summaries = new Map<string, string>();
  const notes: Record<string, { cut: boolean; version: string | null }> = {};
  try {
    for (const d of drawn) {
      const k = d.family + "/" + d.unit;
      if (summaries.has(k)) continue;
      const dir = units.get(d.unit)!.dir;
      const input = readFileSync(join(dir, d.family === "plan" ? "plan.md" : "brief.md"), "utf8");
      const r = await judge.call({ judge: "opus", prompt: summaryPrompt(d.family, input, existsSync(join(dir, "context")) ? readContext(join(dir, "context")) : ""), effort: "medium", maxTokens: 4_000, label: "taste-" + k });
      if (!r.text) throw new PvError("E_PV_INFRA_MISSING", "the summary call for pair " + d.pair + " returned no text (" + (r.problem ?? "no reason") + ")");
      const s = capWords(r.text);
      summaries.set(k, s.text);
      notes[k] = { cut: s.cut, version: r.version };
    }
  } finally {
    await judge.close();
  }
  writeFileSync(join(a.one.out!, "pairs.md"), renderPairs(drawn, summaries), { mode: 0o600 });
  writeJson(a.one.answers!, { version: 1, seed: SEED, prompt_template_sha256: PROMPT_TEMPLATE_SHA256, pairs: drawn.map((d) => ({ pair: d.pair, family: d.family, unit: d.unit, A: d.skillIsA ? "skill" : d.partner, B: d.skillIsA ? d.partner : "skill", skill_session: d.skill.session, other_session: d.other.session, summary_cut: notes[d.family + "/" + d.unit]!.cut, summary_version: notes[d.family + "/" + d.unit]!.version })) });
  io.out("pv taste: " + drawn.length + " pairs (" + drawn.filter((d) => d.family === "plan").length + " plan, " + drawn.filter((d) => d.family === "brief").length + " brief), " + summaries.size + " summaries; pairs in " + join(a.one.out!, "pairs.md") + ", answers in " + a.one.answers);
  return 0;
}
