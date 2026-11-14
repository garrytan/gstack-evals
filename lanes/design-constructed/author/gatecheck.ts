// Copyright (c) 2026 Garry Tan. MIT License.
// The gate check of plan section 16 and prereg start rule 6: planted units run once through every model-judged gate at
// frozen settings with no rewrite: the audit by both auditors, the generic screen by both labellers,
// the unanimous key by three validators with labels and the give-away check by three with labels. Every unit runs every
// gate over all its items, so each gate's verdict on each case is read. The expectations are data; a wrong verdict, or
// a gate that returns none, stops authoring (E_DC_GATE_CHECK). The planted units are written and sealed by the
// integrator; this file holds the runner, the expectation table, the check against their committed digests
// (planted.json) and the keyless half (a unit obeying every authoring rule passes every keyless gate).
// A planted drop item (B2, B6) counts as caught only if it doesn't reach the key unchanged (the Captain's pre-data
// ruling, PD-21): an auditor drops it, or an auditor marks it fix and, after the one fix step by the unit's author,
// the second audit keeps it with its statement or detail changed. A fix that leaves the item as planted, or a second
// audit that still marks it fix or drop, is a miss. Which way it was caught is recorded on the reading.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { AUTHORING, MONEY } from "../frozen.ts";
import type { AnyModel, AuthorFamily, ItemClass, KeyItem } from "../types.ts";
import { ask, genericScreen, readAudits, runAudits, validatorStep, type AuditReading, type GenericReading, type StepReading } from "./checks.ts";
import { fixReply, otherFamily } from "./pipeline.ts";
import { auditPrompt, fixPrompt, validatorPrompt } from "./prompts.ts";
import { screen2x, screenUnit } from "./screen.ts";
import type { BaseAppView, Deps } from "./seams.ts";
import { sha256 } from "./text.ts";
import { digestOf, inheritIds, intake, type RawItem, type UnitFiles } from "./unit.ts";

export type PlantedName = "G1" | "G2" | "B1" | "B2" | "B3" | "B4" | "B5" | "B6";

export type Expectation =
  | { gate: "audit"; is: "all-kept" | "no-input-failure" | "input-failure" | "planted-dropped" }
  | { gate: "unanimous"; is: "all-unanimous" | "planted-not-unanimous" }
  | { gate: "give-away"; is: "none-given-away" }
  | { gate: "generic"; is: "none-generic" | "planted-generic" }
  | { gate: "primary"; is: "five" };

const GOOD: Expectation[] = [
  { gate: "audit", is: "all-kept" },
  { gate: "audit", is: "no-input-failure" },
  { gate: "unanimous", is: "all-unanimous" },
  { gate: "give-away", is: "none-given-away" },
  { gate: "generic", is: "none-generic" },
  { gate: "primary", is: "five" },
];

/** Section 16's table. planted is the class of the planted item where the case has one (B6's is Y by construction). */
export const GATE_EXPECTATIONS: Record<PlantedName, { planted: string; plantedClass: ItemClass | "unit" | "named-by-unit"; expect: Expectation[] }> = {
  G1: { planted: "evidence states each of the five items plainly", plantedClass: "unit", expect: GOOD },
  G2: { planted: "evidence states each of the five items plainly", plantedClass: "unit", expect: GOOD },
  B1: { planted: "plan.md names two items' conditions without marking them mentioned", plantedClass: "unit", expect: [{ gate: "audit", is: "input-failure" }] },
  B2: { planted: "one item no evidence file supports", plantedClass: "named-by-unit", expect: [{ gate: "audit", is: "planted-dropped" }] },
  B3: { planted: "an evidence file recommends the design", plantedClass: "unit", expect: [{ gate: "audit", is: "input-failure" }] },
  B4: { planted: "one item that the evidence points away from", plantedClass: "named-by-unit", expect: [{ gate: "unanimous", is: "planted-not-unanimous" }] },
  B5: { planted: "one item restating stock row 1", plantedClass: "named-by-unit", expect: [{ gate: "generic", is: "planted-generic" }] },
  B6: { planted: "a Y item citing a real file but misstating its component", plantedClass: "Y", expect: [{ gate: "audit", is: "planted-dropped" }] },
};

export interface PlantedUnit {
  name: PlantedName;
  unitId: string;
  /** The planted unit's files, context included, items with ids. */
  files: UnitFiles;
  app: BaseAppView;
  author: AuthorFamily;
  bundle: string;
  /** The class of the planted item, for the cases that plant one item; null for unit-level cases. */
  plantedClass: ItemClass | null;
}

/** The planted drop item's one fix step and second audit, run only when the first audit marked it fix. */
export interface GateFix {
  plantedId: string;
  /** The fixed statement and detail, or why the fix reply failed. */
  fixed: { statement: string; detail: string } | { failed: string };
  /** True when the fix left the planted statement and detail exactly as they were. */
  unchanged: boolean;
  audit2: AuditReading | null;
}

export interface GateReading {
  name: PlantedName;
  digest: string;
  audit: AuditReading | null;
  /** The fix step on the planted drop item, when the first audit marked it fix; null otherwise. */
  fix: GateFix | null;
  generic: GenericReading;
  unanimous: StepReading;
  giveAway: StepReading;
  /** Items primary under every gate's reading together: kept by both auditors, unmentioned, not generic, unanimous, not given away. */
  primary: string[];
}

export interface GateResult {
  name: PlantedName;
  expectation: Expectation;
  ok: boolean;
  detail: string;
}

/** One planted unit's committed digests: digestOf and each file's sha256 by role (plan.md, context/project.md, evidence/<n>, key.json, unit.json). */
export interface PlantedDigests {
  digest: string;
  files: Record<string, string>;
}

/** planted.json: the sealed planted units' digests, committed so the gate check reads only those units. */
export interface PlantedTable {
  sealed_tar_sha256: string;
  units: Partial<Record<PlantedName, PlantedDigests>>;
}

export const loadPlantedTable = (): PlantedTable => JSON.parse(readFileSync(join(import.meta.dir, "planted.json"), "utf8"));

/** The digests a unit's files give: digestOf, plan.md, context/project.md and each evidence file in order. */
export function plantedDigests(files: UnitFiles): PlantedDigests {
  const out: Record<string, string> = { "plan.md": sha256(files.plan), "context/project.md": sha256(files.context ?? "") };
  files.evidence.forEach((e, i) => (out["evidence/" + (i + 1)] = sha256(e.text)));
  return { digest: digestOf(files), files: out };
}

/** A table for the given units, as the tests and the dry run build one for invented units. */
export const tableOf = (units: readonly PlantedUnit[]): PlantedTable => ({ sealed_tar_sha256: "", units: Object.fromEntries(units.map((u) => [u.name, plantedDigests(u.files)])) });

/** Refuses (E_PLANTED_DIGEST) any planted unit whose digest, plan, context or evidence differs from the table. */
export function checkPlantedDigests(units: readonly PlantedUnit[], table: PlantedTable): void {
  const bad: string[] = [];
  for (const u of units) {
    const want = table.units[u.name];
    if (!want) {
      bad.push(u.name + ": not in the table");
      continue;
    }
    const got = plantedDigests(u.files);
    const evidence = (f: Record<string, string>) => Object.keys(f).filter((k) => k.startsWith("evidence/")).length;
    const parts = Object.keys(got.files).filter((k) => want.files[k] !== got.files[k]);
    if (evidence(want.files) !== evidence(got.files)) parts.push(evidence(got.files) + " evidence files, table " + evidence(want.files));
    if (got.digest !== want.digest) parts.push("digest");
    if (parts.length) bad.push(u.name + ": " + parts.join(", "));
  }
  if (bad.length) fail("E_PLANTED_DIGEST", "planted units differ from the committed table: " + bad.join("; "));
}

/** Runs every gate on one planted unit. dropId names the planted drop item, for the fix step on it. */
export async function readGates(p: PlantedUnit, deps: Deps, dropId: string | null = null): Promise<GateReading> {
  const items = p.files.key.items;
  const auditors: AnyModel[] = ["opus", otherFamily(p.author) as AnyModel];
  const a = await runAudits(deps, auditors, auditPrompt(p.bundle, p.files, items, false), items.map((i) => i.id), p.unitId + ":audit-0", false);
  const audit = a.audits ? readAudits(a.audits) : null;
  let fix: GateFix | null = null;
  if (audit && dropId !== null && audit.fix.includes(dropId)) {
    const before = items.find((i) => i.id === dropId)!;
    const writer = p.author as AnyModel;
    const f = await ask(deps.call, { model: writer, effort: "high", maxTokens: MONEY.outputCaps.author, prompt: fixPrompt(p.files, [dropId], audit.notes), label: p.unitId + ":fix:" + writer }, (t) => fixReply(t, [dropId]));
    if (!f.ok) fix = { plantedId: dropId, fixed: { failed: f.reason }, unchanged: true, audit2: null };
    else {
      const fixed = f.value[dropId]!;
      const u: UnitFiles = structuredClone(p.files);
      const live = u.key.items.filter((i) => !audit.drop.includes(i.id));
      for (const i of live) if (i.id === dropId) Object.assign(i, fixed);
      const a2 = await runAudits(deps, auditors, auditPrompt(p.bundle, u, live, false), live.map((i) => i.id), p.unitId + ":audit2-0", false);
      fix = { plantedId: dropId, fixed, unchanged: fixed.statement === before.statement && fixed.detail === before.detail, audit2: a2.audits ? readAudits(a2.audits) : null };
    }
  }
  const generic = await genericScreen(deps.call, items, p.unitId + ":0");
  const cited = [...new Set(items.flatMap((i) => i.evidence.map((e) => e.file)))].filter((f) => p.app.tree.includes(f)).sort();
  const opts = { details: false, earlyExit: false, minPrimary: AUTHORING.minPrimaryItems };
  const unanimous = await validatorStep(deps, "unanimous", items, [], validatorPrompt("unanimous", p.files, p.app, cited), { ...opts, label: p.unitId + ":unanimous" });
  const giveAway = await validatorStep(deps, "give-away", items, [], validatorPrompt("give-away", p.files, p.app, cited), { ...opts, label: p.unitId + ":give-away" });
  const keptByAudit = (i: KeyItem) => !!audit && audit.notes.filter((n) => n.id === i.id).every((n) => n.verdict === "keep") && !audit.mentioned.includes(i.id) && !i.mentioned;
  const primary = items.filter((i) => keptByAudit(i) && !generic.generic.includes(i.id) && unanimous.kept.includes(i.id) && giveAway.kept.includes(i.id)).map((i) => i.id);
  return { name: p.name, digest: digestOf(p.files), audit, fix, generic, unanimous, giveAway, primary };
}

/** One expectation against one reading. */
export function judge(r: GateReading, e: Expectation, plantedId: string | null): { ok: boolean; detail: string } {
  const need = (id: string | null) => (id === null ? { ok: false, detail: "the case names no planted item" } : null);
  switch (e.gate) {
    case "audit": {
      if (!r.audit) return { ok: false, detail: "an auditor returned no verdict" };
      if (e.is === "all-kept") {
        const bad = r.audit.notes.filter((n) => n.verdict !== "keep");
        return { ok: bad.length === 0, detail: bad.length ? "not kept: " + bad.map((n) => n.id + " " + n.auditor + " " + n.verdict).join(", ") : "every item kept by both auditors" };
      }
      if (e.is === "no-input-failure") return { ok: r.audit.inputFailures.length === 0, detail: "input failures: " + (r.audit.inputFailures.map((f) => f.auditor + " " + f.check).join(", ") || "none") };
      if (e.is === "input-failure") return { ok: r.audit.inputFailures.length > 0, detail: "input failures: " + (r.audit.inputFailures.map((f) => f.auditor + " " + f.check).join(", ") || "none") };
      if (plantedId === null) return { ok: false, detail: "the case names no planted item" };
      if (r.audit.drop.includes(plantedId)) return { ok: true, detail: plantedId + " caught: dropped by the audit" };
      const fx = r.fix;
      if (fx && fx.plantedId === plantedId && fx.audit2 && !fx.unchanged && fx.audit2.inputFailures.length === 0 && !fx.audit2.drop.includes(plantedId) && !fx.audit2.fix.includes(plantedId)) return { ok: true, detail: plantedId + " caught: marked fix, then kept changed by the second audit" };
      const why = !fx ? "" : "failed" in fx.fixed ? "; the fix reply failed: " + fx.fixed.failed : fx.unchanged ? "; the fix left it as planted" : !fx.audit2 ? "; an auditor returned no second verdict" : "; the second audit: " + (fx.audit2.notes.filter((n) => n.id === plantedId).map((n) => n.auditor + " " + n.verdict).join(", ") || "no verdict") + (fx.audit2.inputFailures.length ? ", input failures " + fx.audit2.inputFailures.map((x) => x.check).join(",") : "");
      return { ok: false, detail: plantedId + " not caught: " + r.audit.notes.filter((n) => n.id === plantedId).map((n) => n.auditor + " " + n.verdict).join(", ") + why };
    }
    case "unanimous":
      if (r.unanimous.dropped) return { ok: false, detail: r.unanimous.dropped };
      if (e.is === "all-unanimous") return { ok: r.unanimous.removed.length === 0, detail: "not unanimous: " + (r.unanimous.removed.join(",") || "none") };
      return need(plantedId) ?? { ok: r.unanimous.removed.includes(plantedId!), detail: plantedId + (r.unanimous.removed.includes(plantedId!) ? " not unanimous" : " unanimous") };
    case "give-away":
      if (r.giveAway.dropped) return { ok: false, detail: r.giveAway.dropped };
      return { ok: r.giveAway.removed.length === 0, detail: "given away: " + (r.giveAway.removed.join(",") || "none") };
    case "generic":
      if (e.is === "none-generic") return { ok: r.generic.generic.length === 0, detail: "generic: " + (r.generic.generic.join(",") || "none") };
      return need(plantedId) ?? { ok: r.generic.generic.includes(plantedId!), detail: plantedId + (r.generic.generic.includes(plantedId!) ? " generic" : " not generic") };
    case "primary":
      return { ok: r.primary.length === AUTHORING.itemsPerKey, detail: r.primary.length + " primary items" };
  }
}

/**
 * Runs every planted unit through every gate and checks each listed expectation. Other readings print and decide
 * nothing. Units that differ from the committed digest table are refused before any call.
 */
export async function runGateCheck(units: readonly PlantedUnit[], deps: Deps, table: PlantedTable = loadPlantedTable()): Promise<{ ok: boolean; readings: GateReading[]; results: GateResult[] }> {
  const names = units.map((u) => u.name).sort();
  const all = (Object.keys(GATE_EXPECTATIONS) as PlantedName[]).sort();
  if (names.join(",") !== all.join(",")) fail("E_USAGE", "the gate check needs exactly the planted units " + all.join(", ") + ", got " + names.join(", "));
  for (const u of units) {
    const want = GATE_EXPECTATIONS[u.name].plantedClass;
    const fits = want === "unit" ? u.plantedClass === null : want === "named-by-unit" ? u.plantedClass !== null : u.plantedClass === want;
    if (!fits) fail("E_USAGE", u.name + " names planted class " + u.plantedClass + ", but its case is " + want);
  }
  checkPlantedDigests(units, table);
  const readings: GateReading[] = [];
  const results: GateResult[] = [];
  for (const u of units) {
    const plantedId = u.plantedClass ? (u.files.key.items.find((i) => i.class === u.plantedClass)?.id ?? null) : null;
    const dropCase = GATE_EXPECTATIONS[u.name].expect.some((e) => e.gate === "audit" && e.is === "planted-dropped");
    const r = await readGates(u, deps, dropCase ? plantedId : null);
    readings.push(r);
    for (const e of GATE_EXPECTATIONS[u.name].expect) results.push({ name: u.name, expectation: e, ...judge(r, e, plantedId) });
  }
  return { ok: results.every((r) => r.ok), readings, results };
}

/** The check that stops authoring: E_DC_GATE_CHECK names every wrong verdict. */
export async function enforceGateCheck(units: readonly PlantedUnit[], deps: Deps, table: PlantedTable = loadPlantedTable()): Promise<{ readings: GateReading[]; results: GateResult[] }> {
  const r = await runGateCheck(units, deps, table);
  const wrong = r.results.filter((x) => !x.ok);
  if (wrong.length) fail("E_DC_GATE_CHECK", wrong.map((w) => w.name + " " + w.expectation.gate + " expected " + w.expectation.is + ": " + w.detail).join("; "));
  return r;
}

/**
 * The keyless half: a unit that obeys every authoring rule passes every keyless gate. It checks intake (ids in the
 * seeded order, the same whatever the author's order), the digest (stable across flag changes, moved by a wording
 * change), step 3, and on its 2x version the id inheritance and the 2x screen with the needle check. Returns the
 * failures; empty means it passes.
 */
export function keylessGates(p: { unitId: string; raw: readonly RawItem[]; files: UnitFiles; x2: { evidence: UnitFiles["evidence"]; raw: readonly RawItem[]; decoy: string }; app: BaseAppView; vocabulary: ReadonlySet<string>; today: string }): string[] {
  const out: string[] = [];
  const a = intake(p.unitId, p.raw, []);
  const b = intake(p.unitId, [...p.raw].reverse(), []);
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push("intake: ids depend on the author's order");
  const s = screenUnit(p.files, p.app, { vocabulary: p.vocabulary, today: p.today });
  if (!s.pass) out.push("step 3: " + s.failures.map((f) => f.check + " " + f.detail).join("; "));
  const flagged = structuredClone(p.files);
  flagged.key.items[0]!.drop = "audit";
  flagged.key.items[1]!.generic = true;
  if (digestOf(flagged) !== digestOf(p.files)) out.push("digest: a flag moved the digest");
  const items = inheritIds(p.files.key.items, p.x2.raw);
  if (typeof items === "string") out.push("2x ids: " + items);
  else {
    const u2: UnitFiles = { ...p.files, evidence: p.x2.evidence, key: { items, wrongWay: p.files.key.wrongWay, decoy: p.x2.decoy } };
    const s2 = screen2x(u2, items, p.app, { vocabulary: p.vocabulary, today: p.today });
    if (!s2.pass) out.push("2x screen: " + s2.failures.map((f) => f.check + " " + f.detail).join("; "));
  }
  return out;
}
