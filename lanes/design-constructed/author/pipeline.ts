// Copyright (c) 2026 Garry Tan. MIT License.
// One unit through key construction in K1's order: author (1), context writer (2), structure and vocabulary screen (3),
// the audit with its one fix round (4; K3, PD-2, R2-9), the generic screen and the mentioned flag right after the
// audit (PD-3), the unanimous key (5) and the give-away check (6) with every credit from fixedMatching over the items
// left (M9), then the 3-item floor. Once the items left can't reach 3 primary items, no further paid check runs and
// the unit drops at that step. A step 3 failure or an audit input failure sends the unit back to its author once (K6);
// the rewrite voids every result and the unit reruns from step 3. Every result binds the digest of the files it read
// (K2). The same runner serves first units and second skins; only the first write differs.
// The write, check and rewrite loop is adapted from lanes/office-hours-founder/author/constructed.ts at 14fbe35b2a3cb6d7477bc1eea4e61577650d4243.
import { AUTHORING, MONEY } from "../frozen.ts";
import type { AnyModel, AuthorFamily, ItemClass, KeyItem } from "../types.ts";
import { ask, genericScreen, readAudits, runAudits, validatorStep, type AuditReading, type GenericReading, type StepReading } from "./checks.ts";
import { auditPrompt, contextPrompt, fixPrompt, rewritePrompt, unitJson, validatorPrompt } from "./prompts.ts";
import { DOCS_DIR, screenUnit, type Failure } from "./screen.ts";
import type { BaseAppView, Caller, Deps } from "./seams.ts";
import { lastJsonObject } from "./text.ts";
import { candidates, digestOf, live, parseUnitReply, standing, unitFromReply, type CheckEntry, type UnitFiles } from "./unit.ts";
import { designBlock } from "./bundle.ts";

export const otherFamily = (f: AuthorFamily): AuthorFamily => (f === "sol" ? "argon" : "sol");

export interface UnitJob {
  unitId: string;
  app: BaseAppView;
  /** Who writes the unit, revises its fixes and rewrites it. */
  author: AuthorFamily;
  /** Exactly what the author saw, which each auditor sees too. */
  bundle: string;
  /** The first write's prompt: the author prompt, or the twin translation. */
  prompt: string;
}

/** The steps a unit can stop at, in K1's order. */
export const STEPS = ["author", "context", "screen", "audit", "fix", "audit-2", "generic", "unanimous", "give-away", "floor"] as const;
export type Step = (typeof STEPS)[number];

/** One step's reach: the classes of the items that reached it and of those it removed, on one unit version. */
export interface FunnelRow {
  step: Step;
  version: number;
  reached: ItemClass[];
  removed: ItemClass[];
  /** M14 (steps 5 and 6): the classes of credits a tie-break decided, one entry per block credit. */
  tieDecided: ItemClass[];
}

export interface UnitOutcome {
  unitId: string;
  status: "pass" | "drop";
  /** The step the unit dropped at; null on a pass. */
  step: Step | null;
  reason: string;
  files: UnitFiles | null;
  /** The primary item ids on a pass. */
  primary: string[];
  log: CheckEntry[];
  funnel: FunnelRow[];
  rewrites: number;
  fixRounds: number;
  /** Items either auditor left unfixed that dropped only at the second audit (K3 prints the count). */
  droppedAtSecondAudit: string[];
  /** Model calls made, resends included. */
  calls: number;
  /** What the checks read, sealed beside key.json. */
  record: { audits: AuditReading[]; generic: GenericReading | null; unanimous: StepReading | null; giveAway: StepReading | null };
}

/** Counts calls on the way through. */
const counting = (call: Caller, n: { calls: number }): Caller => async (req) => {
  n.calls++;
  return call(req);
};

export const fixReply = (text: string, ids: readonly string[]): Record<string, { statement: string; detail: string }> | string => {
  const j = lastJsonObject(text);
  if (!j || !Array.isArray(j.items)) return "no fix JSON with items";
  const out: Record<string, { statement: string; detail: string }> = {};
  for (const v of j.items) {
    const o = v as Record<string, unknown>;
    if (!o || typeof o.id !== "string" || typeof o.statement !== "string" || typeof o.detail !== "string") return "a fixed item lacks id, statement or detail";
    if (ids.includes(o.id)) out[o.id] = { statement: o.statement, detail: o.detail };
  }
  const missing = ids.filter((id) => !out[id]);
  return missing.length ? "the fix reply leaves out " + missing.join(", ") : out;
};

/** Runs one unit end to end. Errors the seams throw (a provider drift) pass through. */
export async function runUnit(job: UnitJob, depsIn: Deps): Promise<UnitOutcome> {
  const n = { calls: 0 };
  const deps: Deps = { ...depsIn, call: counting(depsIn.call, n) };
  const writer = job.author as AnyModel;
  const contextWriter = otherFamily(job.author) as AnyModel;
  const auditors: AnyModel[] = ["opus", contextWriter];
  const log: CheckEntry[] = [];
  const funnel: FunnelRow[] = [];
  const record: UnitOutcome["record"] = { audits: [], generic: null, unanimous: null, giveAway: null };
  const droppedAtSecondAudit: string[] = [];
  let rewrites = 0;
  let fixRounds = 0;
  let u: UnitFiles | null = null;

  const out = (status: "pass" | "drop", step: Step | null, reason: string, primary: string[] = []): UnitOutcome => ({ unitId: job.unitId, status, step, reason, files: u, primary, log, funnel, rewrites, fixRounds, droppedAtSecondAudit, calls: n.calls, record });
  const entry = (step: string, ok: boolean, detail: string) => log.push({ step, digest: digestOf(u!), ok, detail, void: false, carried: false });
  const row = (step: Step, reached: readonly KeyItem[], removed: readonly string[], st?: StepReading) =>
    funnel.push({ step, version: rewrites, reached: reached.map((i) => i.class), removed: reached.filter((i) => removed.includes(i.id)).map((i) => i.class), tieDecided: (st?.blocks ?? []).flatMap((b) => b.tieDecided.map((id) => reached.find((i) => i.id === id)!.class)) });

  const write = async (prompt: string, label: string): Promise<UnitFiles | string> => {
    const r = await ask(deps.call, { model: writer, effort: "high", maxTokens: MONEY.outputCaps.author, prompt, label: job.unitId + ":" + label + ":" + writer }, (t) => parseUnitReply(t, { needPlan: true }));
    return r.ok ? unitFromReply(job.unitId, r.value) : r.reason;
  };
  const writeContext = async (): Promise<string | null> => {
    const prompt = contextPrompt(job.app, designBlock(job.app), u!, DOCS_DIR);
    const r = await ask(deps.call, { model: contextWriter, effort: "medium", maxTokens: MONEY.outputCaps.contextWriter, prompt, label: job.unitId + ":context:" + contextWriter }, (t) => (t.trim() ? { text: t.trim() + "\n" } : "an empty context reply"));
    return r.ok ? r.value.text : null;
  };
  /** K6: one rewrite in all. Returns null when the rewrite ran and the loop should go on, else the drop. */
  const rewriteOrDrop = async (step: Step, failures: readonly Failure[]): Promise<UnitOutcome | null> => {
    const why = failures.map((f) => f.check + ": " + f.detail).join("; ");
    if (rewrites >= AUTHORING.rewritesPerUnit) return out("drop", step, "a second failure after the one rewrite: " + why);
    rewrites++;
    fixRounds = 0;
    for (const e of log) e.void = true;
    const before = u!;
    const again = await write(rewritePrompt(job.prompt, unitJson(before), failures), "rewrite");
    if (typeof again === "string") return out("drop", "author", "the rewrite didn't parse twice: " + again);
    const paths = (x: UnitFiles) => x.evidence.map((e) => e.path).sort().join("\n");
    again.context = again.plan === before.plan && paths(again) === paths(before) ? before.context : null;
    u = again;
    return null;
  };

  const first = await write(job.prompt, "author");
  if (typeof first === "string") return out("drop", "author", "the author reply didn't parse twice: " + first);
  u = first;

  for (;;) {
    if (u.context === null) {
      const c = await writeContext();
      if (c === null) return out("drop", "context", "the context writer's reply didn't parse twice");
      u.context = c;
    }

    const s = screenUnit(u, job.app, { vocabulary: deps.vocabulary, today: deps.today });
    entry("screen", s.pass, s.pass ? "every structure and vocabulary check passes" : s.failures.map((f) => f.check).join(", "));
    row("screen", u.key.items, []);
    if (!s.pass) {
      const r = await rewriteOrDrop("screen", s.failures);
      if (r) return r;
      continue;
    }

    const ids1 = live(u.key).map((i) => i.id);
    const a1 = await runAudits(deps, auditors, auditPrompt(job.bundle, u, live(u.key), false), ids1, job.unitId + ":audit-" + rewrites, false);
    if (!a1.audits) return out("drop", "audit", a1.reason);
    const r1 = readAudits(a1.audits);
    record.audits.push(r1);
    entry("audit", r1.inputFailures.length === 0, "input failures " + (r1.inputFailures.map((f) => f.check).join(",") || "none") + "; drop " + (r1.drop.join(",") || "none") + "; fix " + (r1.fix.join(",") || "none"));
    if (r1.inputFailures.length) {
      row("audit", live(u.key), []);
      const r = await rewriteOrDrop("audit", r1.inputFailures.map((f) => ({ check: f.check, detail: f.auditor + ": " + f.reason })));
      if (r) return r;
      continue;
    }
    row("audit", live(u.key), r1.drop);
    for (const i of u.key.items) {
      if (r1.drop.includes(i.id)) i.drop = "audit";
      if (r1.mentioned.includes(i.id)) i.mentioned = true;
    }

    const fixIds = r1.fix.filter((id) => u!.key.items.some((i) => i.id === id && i.drop === null));
    if (fixIds.length && fixRounds < AUTHORING.fixRoundsPerVersion) {
      fixRounds++;
      const f = await ask(deps.call, { model: writer, effort: "high", maxTokens: MONEY.outputCaps.author, prompt: fixPrompt(u, fixIds, r1.notes), label: job.unitId + ":fix:" + writer }, (t) => fixReply(t, fixIds));
      if (!f.ok) return out("drop", "fix", "the fix reply didn't parse twice: " + f.reason);
      for (const e of log) {
        if (e.void) continue;
        if (e.step === "audit") e.carried = true;
        else e.void = true;
      }
      for (const i of u.key.items) if (f.value[i.id]) Object.assign(i, f.value[i.id]);
      const s2 = screenUnit(u, job.app, { vocabulary: deps.vocabulary, today: deps.today });
      entry("screen", s2.pass, s2.pass ? "the fixed unit passes step 3" : s2.failures.map((x) => x.check).join(", "));
      if (!s2.pass) {
        const r = await rewriteOrDrop("screen", s2.failures);
        if (r) return r;
        continue;
      }
      const ids2 = live(u.key).map((i) => i.id);
      const a2 = await runAudits(deps, auditors, auditPrompt(job.bundle, u, live(u.key), false), ids2, job.unitId + ":audit2-" + rewrites, false);
      if (!a2.audits) return out("drop", "audit-2", a2.reason);
      const r2 = readAudits(a2.audits);
      record.audits.push(r2);
      entry("audit-2", r2.inputFailures.length === 0, "input failures " + (r2.inputFailures.map((x) => x.check).join(",") || "none") + "; drop " + ([...r2.drop, ...r2.fix].sort().join(",") || "none"));
      if (r2.inputFailures.length) {
        row("audit-2", live(u.key), []);
        const r = await rewriteOrDrop("audit-2", r2.inputFailures.map((x) => ({ check: x.check, detail: x.auditor + ": " + x.reason })));
        if (r) return r;
        continue;
      }
      const gone = [...r2.drop, ...r2.fix];
      row("audit-2", live(u.key), gone);
      for (const i of u.key.items) {
        if (i.drop === null && gone.includes(i.id)) {
          i.drop = "audit-2";
          if (!fixIds.includes(i.id)) droppedAtSecondAudit.push(i.id);
        }
        if (r2.mentioned.includes(i.id)) i.mentioned = true;
      }
    }

    if (candidates(u.key).length < AUTHORING.minPrimaryItems) return out("drop", fixRounds ? "audit-2" : "audit", "fewer than " + AUTHORING.minPrimaryItems + " items left after the audit and the mentioned flag");

    const g = await genericScreen(deps.call, live(u.key), job.unitId + ":" + rewrites);
    record.generic = g;
    const genericNow = candidates(u.key).filter((i) => g.generic.includes(i.id)).map((i) => i.id);
    row("generic", candidates(u.key), genericNow);
    for (const i of u.key.items) if (g.generic.includes(i.id)) i.generic = true;
    entry("generic", true, "generic " + (g.generic.join(",") || "none") + "; made generic by a missing cell " + (g.missing.join(",") || "none"));
    if (candidates(u.key).length < AUTHORING.minPrimaryItems) return out("drop", "generic", "fewer than " + AUTHORING.minPrimaryItems + " items left after the generic screen");

    const strata = () => live(u!.key).filter((i) => i.mentioned || i.generic);
    const cited = [...new Set(u.key.items.flatMap((i) => i.evidence.map((e) => e.file)))].filter((p) => job.app.tree.includes(p) && !u!.evidence.some((e) => e.path === p)).sort();
    const c5 = candidates(u.key);
    const st5 = await validatorStep(deps, "unanimous", c5, strata(), validatorPrompt("unanimous", u, job.app, cited), { label: job.unitId + ":unanimous", details: false, earlyExit: true, minPrimary: AUTHORING.minPrimaryItems });
    record.unanimous = st5;
    row("unanimous", c5, st5.removed, st5);
    for (const i of u.key.items) if (st5.removed.includes(i.id)) i.drop = "not-unanimous";
    entry("unanimous", st5.dropped === null && st5.kept.length >= AUTHORING.minPrimaryItems, st5.dropped ?? "kept " + st5.kept.join(","));
    if (st5.dropped !== null) return out("drop", "unanimous", st5.dropped);
    if (st5.kept.length < AUTHORING.minPrimaryItems) return out("drop", "unanimous", "only " + st5.kept.length + " items unanimous");

    const c6 = candidates(u.key);
    const st6 = await validatorStep(deps, "give-away", c6, strata(), validatorPrompt("give-away", u, job.app, cited), { label: job.unitId + ":give-away", details: false, earlyExit: true, minPrimary: AUTHORING.minPrimaryItems });
    record.giveAway = st6;
    row("give-away", c6, st6.removed, st6);
    for (const i of u.key.items) if (st6.removed.includes(i.id)) i.drop = "given-away";
    entry("give-away", st6.dropped === null && st6.kept.length >= AUTHORING.minPrimaryItems, st6.dropped ?? "kept " + st6.kept.join(","));
    if (st6.dropped !== null) return out("drop", "give-away", st6.dropped);
    if (st6.kept.length < AUTHORING.minPrimaryItems) return out("drop", "give-away", "only " + st6.kept.length + " items not given away");

    const primary = candidates(u.key).map((i) => i.id);
    row("floor", candidates(u.key), []);
    const stale = log.filter((e) => !e.void && !standing(log, digestOf(u!)).includes(e));
    if (stale.length) return out("drop", "floor", "a result binds another digest: " + stale.map((e) => e.step).join(","));
    return out("pass", null, "passed with " + primary.length + " primary items", primary);
  }
}

/** The pass rate per step and the removal rate per class at each step, over the units and items that reached it (BT). */
export function funnelTable(outcomes: readonly UnitOutcome[]): { step: Step; units: number; passed: number; byClass: Record<ItemClass, { reached: number; removed: number; tieDecided: number }> }[] {
  return STEPS.map((step) => {
    const reached = outcomes.filter((o) => o.funnel.some((f) => f.step === step) || o.step === step);
    const byClass = Object.fromEntries((["S", "H", "R", "A", "Y"] as ItemClass[]).map((c) => [c, { reached: 0, removed: 0, tieDecided: 0 }])) as Record<ItemClass, { reached: number; removed: number; tieDecided: number }>;
    for (const o of reached)
      for (const f of o.funnel.filter((x) => x.step === step)) {
        for (const c of f.reached) byClass[c].reached++;
        for (const c of f.removed) byClass[c].removed++;
        for (const c of f.tieDecided) byClass[c].tieDecided++;
      }
    return { step, units: reached.length, passed: reached.filter((o) => o.step !== step).length, byClass };
  });
}
