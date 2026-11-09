// Copyright (c) 2026 Garry Tan. MIT License.
// The authoring part's lines in the keyless dry run (prereg 2026-11-09-geva-417, section 15 rule 4, on the rules of
// sections 3, 4 and 11): the funnel's three steps on fixtures (a screen-negative, a triage-negative and a keyed unit)
// through the shared metered client on a temporary ledger with a fake upstream; the key read's mechanical drops, the
// audits' one revision round, the generic screen and the primary; the recognition probe; each supply rule on both sides
// of its edge; the miss sample; and the DX scope rate at 0.79 and 0.80 of comparison plans (rate and flag only; the
// stage 2 lease gate is leases.ts's). No key is read and nothing leaves the process.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import type { ModelKey } from "../../aftermath/meter.ts";
import type { AliasMap, DryCheck, KeyItem } from "../types.ts";
import { aliasText } from "../unit/alias.ts";
import { run as authorRun, type Outcome } from "./cli.ts";
import { DRY_ENV, fakeModels, jsonReply } from "./fake.ts";
import { DxError, namesProject, normalizeItems, rankPrimary, recognitionPrompt, type FunnelUnit } from "./funnel.ts";
import * as P from "./prompts.ts";
import { scopeRate } from "./scope.ts";
import { fillCalibration, fillComparison, LINE_MICROS, missSample, projectAt, RULE1_MICROS, sizeRule, supplyReading, type Draw } from "./sets.ts";

const T = (rule: string, pass: boolean, detail?: string): DryCheck => ({ rule, pass, detail });
const WINDOW = { from: "2026-08-01T00:00:00Z", to: "2026-09-30T00:00:00Z" };
const NOW = "2026-11-09T00:00:00Z";
const ALIAS: AliasMap = { entries: [{ original: "zorbit", alias: "quentra", kind: "project" }], kept: [] };
const words = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");

/** A fixture unit; its marker in the source steers the fake models. */
export function fixtureFunnelUnit(id: string, marker: string, candidates = 1): FunnelUnit & { draw_digest: string } {
  const c = (i: number) => ({ ref: "issue " + (10 + i), date: "2026-08-10T00:00:00Z", title: "zorbit export --json fails on Windows", association: "NONE", passage: "running zorbit export --json prints nothing", body: "running zorbit export --json prints nothing and exits 0" });
  return {
    id,
    draw_digest: id,
    release_at: WINDOW.from,
    window: WINDOW,
    source: "Add a --json flag to the zorbit export command. " + marker,
    identifiers: ["--json", "export"],
    candidates: Array.from({ length: candidates }, (_, i) => c(i)),
    records: [{ ref: "issue 10", date: "2026-08-10T00:00:00Z", title: "zorbit export --json fails on Windows", body: "body" }, { ref: "pr 12", date: "2026-08-20T00:00:00Z", title: "Unrelated", body: null }],
    readme: ["# Zorbit", ...Array.from({ length: 45 }, (_, i) => "readme line " + (i + 2))].join("\n"),
    real_names: ["fixture-owner/zorbit", "zorbit"],
  };
}

const item = (o: Partial<Record<string, unknown>> = {}) => ({ class: "E", statement: "Developers on Windows running zorbit export --json saw no output and exit code 0", surface: "zorbit export --json", context: null, source: "outside", outside_developers: 2, evidence: [{ ref: "issue 10", date: "2026-08-10" }], mentioned: false, ...o });

/** The fake models' answers, by prompt kind and the unit's marker. */
export function fakeAnswer(model: ModelKey, prompt: string): string {
  const marker = /UNIT-[A-Z0-9-]+/.exec(prompt)?.[0] ?? "";
  if (prompt.startsWith(P.TRIAGE.slice(0, 40))) return jsonReply({ flag: marker !== "UNIT-TRIAGE-NEG", candidates: [] });
  if (prompt.startsWith(P.REWRITE.slice(0, 40))) return "The team will add a --json flag to the zorbit export command. " + marker;
  if (prompt.startsWith(P.KEY.slice(0, 40))) {
    const revised = prompt.includes("Your earlier key");
    const base = [item(), item({ statement: words(31) }), item({ statement: "Outside the window", evidence: [{ ref: "issue 99", date: "2026-10-15" }] }), item({ class: "X", statement: "Unknown class" })];
    if (marker === "UNIT-GENERIC") return jsonReply({ items: [item({ statement: "GENERICME zorbit export printed nothing" })] });
    if (marker === "UNIT-MENTIONED") return jsonReply({ items: [item({ mentioned: true })] });
    return jsonReply({ items: revised ? [item({ statement: "Revised: zorbit export --json printed nothing on Windows" })] : base });
  }
  if (prompt.startsWith(P.AUDIT.slice(0, 40))) {
    const revised = prompt.includes("Revised:");
    const pass = marker === "UNIT-AUDIT-TWICE" ? false : marker === "UNIT-AUDIT-ONCE" ? revised : true;
    return jsonReply({ pass, problems: pass ? [] : ["unsupported"], items: [{ id: "k1", foreseeable: "no" }] });
  }
  if (prompt.startsWith(P.RECOGNITION.slice(0, 40))) {
    const hit = (marker === "UNIT-RECOG-OPUS" && model === "opus") || (marker === "UNIT-RECOG-SOL" && model === "sol");
    return jsonReply({ project: hit ? "Zorbit (fixture-owner/zorbit)" : "quentra, unknown", changes: "unknown" });
  }
  const labels: unknown[] = [];
  const lists = [...prompt.matchAll(/^List (\S+)$/gm)].map((m) => m[1]!);
  for (const m of prompt.matchAll(/^\[(\S+)\] (.*)\n {4}surface: .*; developer context: (.*)$/gm)) {
    const yes = m[2]!.includes("GENERICME");
    for (const l of lists) labels.push({ list: l, item: m[1], anticipated: yes, changes: yes ? [1] : [], surface: false, surface_changes: [], who: m[3] === "none" ? null : false, who_changes: [] });
  }
  return jsonReply({ labels });
}

async function funnel(): Promise<DryCheck[]> {
  const dir = mkdtempSync(join(tmpdir(), "dx-author-dry-"));
  try {
    const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite"), units = join(dir, "units"), work = join(dir, "work");
    recordApproval(record, { action: "init", item: "dx-auth-dry", cap_micros: 50_000_000, quotes: [{ words: "dry run", by: "dry run", source: "dry run" }], admission: "warn" });
    const fixtures = [fixtureFunnelUnit("u-screen", "UNIT-SCREEN-NEG", 0), fixtureFunnelUnit("u-triage", "UNIT-TRIAGE-NEG"), fixtureFunnelUnit("u-keyed", "UNIT-KEYED"), fixtureFunnelUnit("u-once", "UNIT-AUDIT-ONCE"), fixtureFunnelUnit("u-twice", "UNIT-AUDIT-TWICE"), fixtureFunnelUnit("u-generic", "UNIT-GENERIC"), fixtureFunnelUnit("u-mentioned", "UNIT-MENTIONED"), fixtureFunnelUnit("u-ropus", "UNIT-RECOG-OPUS"), fixtureFunnelUnit("u-rsol", "UNIT-RECOG-SOL"), { ...fixtureFunnelUnit("u-open", "UNIT-KEYED"), window: { from: "2026-10-01T00:00:00Z", to: "2026-11-30T00:00:00Z" } }];
    for (const f of fixtures) {
      mkdirSync(join(units, f.id), { recursive: true });
      writeFileSync(join(units, f.id, "funnel.json"), JSON.stringify(f));
      writeFileSync(join(units, f.id, "alias.json"), JSON.stringify(ALIAS));
    }
    const calls: Array<{ unit: string; model: ModelKey }> = [];
    const answer = (model: ModelKey, prompt: string) => {
      calls.push({ unit: /UNIT-[A-Z0-9-]+/.exec(prompt)?.[0] ?? "", model });
      return fakeAnswer(model, prompt);
    };
    const over = { record, ledger, env: DRY_ENV, fetch: fakeModels(answer) };
    const io = { out: () => {}, err: () => {} };
    const ids = fixtures.filter((f) => f.id !== "u-open").map((f) => f.id);
    await authorRun(["--units", units, "--work", work, "--item", "dx-auth-dry", "--ids", ids.join(","), "--now", NOW], io, over);
    const out = new Map(ids.map((id) => [id, JSON.parse(readFileSync(join(work, "units", id, "outcome.json"), "utf8")) as Outcome]));
    const key = (id: string) => JSON.parse(readFileSync(join(work, "units", id, "key.json"), "utf8"));
    const st = (id: string) => out.get(id)!.stage;
    const by = (marker: string) => calls.filter((c) => c.unit === marker).map((c) => c.model);
    const keyed = key("u-keyed");
    const plan = readFileSync(join(work, "units", "u-keyed", "plan.md"), "utf8");
    const lines: DryCheck[] = [];
    lines.push(T("funnel's three steps on fixtures: a unit with no candidate drops screen-negative with no model call; an unflagged unit drops triage-negative after one Argon call and no Opus call; a flagged unit is key-read by Opus, audited, screened and keyed", st("u-screen") === "screen-negative" && by("UNIT-SCREEN-NEG").length === 0 && st("u-triage") === "triage-negative" && JSON.stringify(by("UNIT-TRIAGE-NEG")) === JSON.stringify(["gemini"]) && st("u-keyed") === "keyed" && by("UNIT-KEYED")[0] === "gemini" && by("UNIT-KEYED").includes("opus") && by("UNIT-KEYED").includes("sol"), JSON.stringify(Object.fromEntries([...out].map(([k, v]) => [k, v.stage])))));
    lines.push(T("key read's mechanical drops: an item over 30 words, one dated outside the window and one outside the classes drop and are counted; statements carry the alias map", out.get("u-keyed")!.dropped_items === 3 && keyed.items.length === 1 && !/zorbit/i.test(JSON.stringify(keyed.items)) && /quentra/.test(keyed.items[0].statement) && !/zorbit/i.test(plan), "dropped " + out.get("u-keyed")!.dropped_items));
    lines.push(T("the two audits: Opus and Sol both audit; one failed round gets one revision and then keys; a unit that fails twice drops", st("u-once") === "keyed" && key("u-once").items[0].statement.startsWith("Revised:") && st("u-twice") === "audit-failed" && by("UNIT-AUDIT-TWICE").filter((m) => m === "sol").length === 2, st("u-once") + " " + st("u-twice")));
    lines.push(T("the generic screen and the mentioned flag leave the primary; a unit with no primary item left drops", st("u-generic") === "no-primary" && key("u-generic").items[0].generic === true && st("u-mentioned") === "no-primary" && keyed.items[0].generic === false && keyed.primary.length === 1, st("u-generic") + " " + st("u-mentioned")));
    lines.push(T("the recognition probe: a correct project name from Opus moves the unit to the descriptive stratum; a Sol hit keeps it, out of Sol's primary; an aliased name is no hit", st("u-ropus") === "recognized-opus" && out.get("u-ropus")!.recognized?.opus === true && st("u-rsol") === "keyed" && JSON.stringify(out.get("u-rsol")!.recognized) === JSON.stringify({ opus: false, sol: true, particle: false }) && JSON.stringify(out.get("u-keyed")!.recognized) === JSON.stringify({ opus: false, sol: false, particle: false })));
    const refusals: string[] = [];
    const tryRun = async (argv: string[], o: object) => {
      try {
        await authorRun(argv, io, o);
        refusals.push("ran");
      } catch (e) {
        refusals.push(String((e as { code?: string }).code));
      }
    };
    await tryRun(["--units", units, "--work", work, "--ids", "u-keyed"], over);
    await tryRun(["--units", units, "--work", join(dir, "w2"), "--item", "dx-auth-unapproved", "--ids", "u-keyed", "--now", NOW], over);
    await tryRun(["--units", units, "--work", join(import.meta.dir, "sealed-out"), "--item", "dx-auth-dry", "--ids", "u-keyed"], over);
    const before = calls.length;
    await tryRun(["--units", units, "--work", join(dir, "w3"), "--item", "dx-auth-dry", "--ids", "u-open", "--now", NOW], over);
    lines.push(T("dx author is keyless-safe: it refuses without a ledger item, on an item with no approved cap, with a work directory inside the repository, and on a unit whose window has not closed, before any call", JSON.stringify(refusals) === JSON.stringify(["E_USAGE", "E_LEDGER_MISSING", "E_USAGE", "E_USAGE"]) && calls.length === before, JSON.stringify(refusals)));
    return lines;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function probe(): DryCheck[] {
  const u = fixtureFunnelUnit("p", "UNIT-P");
  const p = recognitionPrompt("The team will change Zorbit's export.", u.readme, (t) => aliasText(t, ALIAS));
  const inputs = p.startsWith(P.RECOGNITION) && p.includes("readme line 40") && !p.includes("readme line 41") && p.includes("# Quentra") && !/zorbit/i.test(p.slice(P.RECOGNITION.length).replace("The team will change Zorbit's export.", ""));
  const names = namesProject("It is ZORBIT.", u.real_names) && namesProject("fixture-owner/zorbit", u.real_names) && !namesProject("zorbits", u.real_names) && !namesProject("quentra", u.real_names) && !namesProject("unknown", u.real_names);
  return [T("the recognition probe's inputs are plan.md and the README's first 40 lines, aliased; the mechanical check marks a whole-word real name in any case and nothing else", inputs && names)];
}

function mechanics(): DryCheck[] {
  const n = normalizeItems({ items: [item({ statement: words(30) }), item({ statement: words(31) }), item({ evidence: [{ ref: "x", date: "2026-07-31T23:59:59Z" }] }), item({ evidence: [{ ref: "x", date: WINDOW.to }] }), item({ class: "B" })] }, WINDOW, (t) => t);
  const it = (id: string, source: KeyItem["source"], dev: number, o: Partial<KeyItem> = {}): KeyItem => ({ id, class: "E", statement: "s", surface: "s", context: null, source, outside_developers: dev, evidence: [], mentioned: false, generic: false, foreseeable: null, ...o });
  const ranked = rankPrimary("u", [it("f1", "followup", 0), it("o1", "outside", 1), it("l1", "followup-linked", 0), it("o3", "outside", 3), it("m", "outside", 9, { mentioned: true }), it("g", "outside", 9, { generic: true }), it("o2", "outside", 2), it("f2", "followup", 0), it("f3", "followup", 0)]);
  return [
    T("key read's mechanical rules on both sides: 30 words stays and 31 drops; the window's first and last instants stay and a date just before drops; an unknown class drops", n.items.length === 2 && n.dropped === 3, JSON.stringify({ kept: n.items.length, dropped: n.dropped })),
    T("primary ranking: outside items by distinct outside developers, then linked follow-ups, then other follow-ups, at most 6, mentioned and generic never", JSON.stringify(ranked.slice(0, 4)) === JSON.stringify(["o3", "o2", "o1", "l1"]) && ranked.length === 6 && !ranked.includes("m") && !ranked.includes("g"), JSON.stringify(ranked)),
  ];
}

const draws = (n: number, release = "2026-09-01T00:00:00Z"): Draw[] => Array.from({ length: n }, (_, i) => ({ id: "d" + String(i).padStart(5, "0"), draw_digest: String(i).padStart(6, "0"), release_at: release, window_to: "2026-10-31T00:00:00Z" }));
const outcome = (id: string, stage: Outcome["stage"], spent = 0, plan: string | null = null): Outcome => ({ id, stage, plan, recognized: stage === "keyed" ? { opus: false, sol: false, particle: false } : null, dropped_items: 0, spent_micros: spent });

async function supply(): Promise<DryCheck[]> {
  const lines: DryCheck[] = [];
  const keyedAt = (positions: Set<number>, spent: (i: number) => number = () => 0) => async (d: Draw) => {
    const i = Number(d.draw_digest);
    return outcome(d.id, positions.has(i) ? "keyed" : i % 2 ? "screen-negative" : "triage-negative", spent(i));
  };
  const last = (k: number) => new Set([...Array.from({ length: 15 }, (_, i) => i), k]);
  const at1000 = await fillCalibration(draws(1200), keyedAt(last(999)));
  const at1001 = await fillCalibration(draws(1200), keyedAt(last(1000)));
  lines.push(T("supply rule 1 at 1,000 draws: a calibration set that fills on draw 1,000 stands; one that would need draw 1,001 stops with E_DX_SUPPLY_SHORT", at1000.status === "filled" && at1000.walked.length === 1000 && at1001.status === "short" && at1001.walked.length === 1000 && /rule 1/.test(at1001.reason ?? ""), at1000.status + " " + at1001.status));
  const sixteen = new Set(Array.from({ length: 16 }, (_, i) => i));
  const exact = await fillCalibration(draws(40), keyedAt(sixteen, () => RULE1_MICROS / 16));
  const past = await fillCalibration(draws(40), keyedAt(sixteen, (i) => RULE1_MICROS / 16 + (i === 15 ? 1 : 0)));
  let seen = -1;
  const refused = await fillCalibration(draws(40), async (d, remaining) => {
    seen = remaining ?? -1;
    if (Number(d.draw_digest) === 3) throw new DxError("E_DX_SUPPLY_SHORT", "authoring spend reached the calibration bound");
    return outcome(d.id, "keyed", 80_000_000);
  });
  lines.push(T("supply rule 1 at $250: a calibration set that fills at exactly $250 of authoring spend stands; one micro past stops; a call refused at the bound stops with E_DX_SUPPLY_SHORT", exact.status === "filled" && exact.spent_micros === RULE1_MICROS && past.status === "short" && refused.status === "short" && seen === RULE1_MICROS - 240_000_000, [exact.status, past.status, refused.status, seen].join(" ")));
  const early = await fillCalibration([...draws(20, "2026-09-10T00:00:00Z"), ...draws(30).map((d) => ({ ...d, id: "e" + d.id, draw_digest: "z" + d.draw_digest }))], keyedAt(new Set()));
  lines.push(T("the calibration set draws only from units released by 2026-09-09", early.walked.every((o) => o.id.startsWith("e")) && early.walked.length === 30, String(early.walked.length)));
  const p = (other: number) => ({ other_micros: other, per_keyed_micros: 10_000_000, stage2_per_unit_micros: 20_000_000 });
  const edge = (size: number) => LINE_MICROS - projectAt(p(0), size);
  const sizes = [sizeRule(p(edge(64))).size, sizeRule(p(edge(64) + 1)).size, sizeRule(p(edge(56))).size, sizeRule(p(edge(56) + 1)).size, sizeRule(p(edge(48))).size, sizeRule(p(edge(48) + 1)).size];
  lines.push(T("supply rule 2, the size rule: 64 at exactly $3,960 all-in and 56 one micro past; 56 at its edge and 48 past it; 48 at its edge and none (E_DX_SUPPLY_SHORT) past it; a size under 64 owes start rule 5's MDD bound", JSON.stringify(sizes) === JSON.stringify([64, 56, 56, 48, 48, null]) && !sizeRule(p(edge(64))).mdd_bound_applies && sizeRule(p(edge(56))).mdd_bound_applies, JSON.stringify(sizes)));
  const keyedFirst = (k: number) => async (d: Draw) => outcome(d.id, Number(d.draw_digest) < k ? "keyed" : "screen-negative");
  const full = await fillComparison(draws(80), 64, new Set(), keyedFirst(70), NOW);
  const r48 = await fillComparison(draws(48), 64, new Set(), keyedFirst(48), NOW);
  const r47 = await fillComparison(draws(47), 64, new Set(), keyedFirst(47), NOW);
  const skip = await fillComparison(draws(10), 4, new Set(["d00000"]), keyedFirst(10), NOW);
  const wait = await fillComparison(draws(10).map((d, i) => (i === 2 ? { ...d, window_to: "2026-11-29T00:00:00Z" } : d)), 4, new Set(), keyedFirst(10), NOW);
  lines.push(T("supply rule 3: the comparison set fills at its size, then 6 reserves; a frame that runs out at 48 ends at 48 with every MDD reprinted; at 47 it stops with E_DX_SUPPLY_SHORT; calibration's draws are never redrawn; no key is read before its window closes", full.status === "filled" && full.comparison.length === 64 && full.reserves.length === 6 && r48.status === "exhausted" && r48.comparison.length === 48 && r47.status === "short" && !skip.walked.some((o) => o.id === "d00000") && wait.status === "waiting" && wait.walked.length === 2, [full.status, r48.status, r47.status, wait.status].join(" ")));
  const walked = Array.from({ length: 60 }, (_, i) => outcome("m" + String(i).padStart(2, "0"), i < 16 ? "keyed" : i % 2 ? "screen-negative" : "triage-negative", 1_000_000, i < 16 ? (i < 13 ? "Add a CLI flag." : "Tidy colors.") : null));
  const miss = missSample(walked);
  const reading = supplyReading({ status: "filled", reason: null, walked, spent_micros: 60_000_000, set: walked.slice(0, 16).map((o) => o.id) }, { screen: miss.screen.map((id, i) => ({ id, items: i < 2 ? 1 : 0, dropped_items: 0, spent_micros: 1 })), triage: miss.triage.map((id) => ({ id, items: 0, dropped_items: 0, spent_micros: 1 })) }, walked.filter((o) => o.stage === "keyed").map((o) => o.plan!), { other_micros: 0, stage2_per_unit_micros: 0 });
  lines.push(T("the miss sample takes the first 12 screen-negative and 12 triage-negative calibration draws in draw order, none in a set; the supply reading counts every step, cost per keyed unit and the DX scope rate", miss.screen.length === 12 && miss.triage.length === 12 && miss.screen[0] === "m17" && miss.triage[0] === "m16" && reading.draws === 60 && reading.keyed === 16 && reading.screen_positive === 38 && reading.cost_per_keyed_micros === 3_750_000 && reading.miss.screen.with_items === 2 && reading.dx_scope.loads === 13 && reading.stop === null, JSON.stringify({ k: reading.keyed, sp: reading.screen_positive, c: reading.cost_per_keyed_micros, dx: reading.dx_scope.rate })));
  return lines;
}

function scope(): DryCheck[] {
  const plans = (k: number) => [...Array.from({ length: k }, () => "The team will add a CLI flag."), ...Array.from({ length: 100 - k }, () => "The team will tidy the colors.")];
  const a = scopeRate(plans(79)), b = scopeRate(plans(80));
  return [T("the DX scope rate at 0.79 and 0.80 of comparison plans: 0.79 reads under the bar and 0.80 passes (rate and flag; the stage 2 lease gate is leases.ts's)", a.rate === 0.79 && !a.passes && b.rate === 0.8 && b.passes, JSON.stringify([a.rate, a.passes, b.rate, b.passes]))];
}

export async function checks(): Promise<DryCheck[]> {
  return [...(await funnel()), ...probe(), ...mechanics(), ...(await supply()), ...scope()];
}
