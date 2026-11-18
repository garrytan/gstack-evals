// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite lane's authoring seams for the keyless dry run (prereg section 12 stage 1's "every gate on planted
// known-good and known-bad cases"): each drives one frozen rule of section 3, section 13's authoring line or pre-run
// change 1 item 4d on one side of its edge through this area's real code, with invented fixtures, a scripted caller, the
// fixture block parser and a word labeller, so the lane's dry run prints PASS or FAIL per edge and makes no model call.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallRequest } from "../../product-value/meter.ts";
import { REPO_ROOT } from "../../product-value/io.ts";
import { wilson } from "../../autoplan-audit/stats.ts";
import { CAPS } from "../frozen.ts";
import type { Seam } from "../types.ts";
import { runDraft, type Outcome, type Partner } from "./brief.ts";
import { openCustody } from "./custody.ts";
import { schedule, type Slot } from "./draws.ts";
import { digestOf, goalFactProblem, twinProblem, type BriefFiles } from "./files.ts";
import { BUILDER, FIRST, FIRST_TWIN_CALL, FIXTURE_SCREEN, SECOND, T7, blockReply, fixtureParser, happy, runCaller, stubCaller, wordLabeller } from "./fixtures.ts";
import { PLANNING, line, pilotRead } from "./pilot.ts";
import { ANTI_PATTERNS, NAMED_TERMS } from "./prompts.ts";
import { authorRun, haltOf, type AuthorRun } from "./run.ts";
import { buildScreen, screenVocabulary } from "./screens.ts";
import { placeSets, replaceDropped, type Member } from "./sets.ts";

type Route = (req: CallRequest) => string | null | undefined;
const SLOTS = schedule();
const PAIR = SLOTS.find((s) => s.kind === "pair")!;
const T7_SLOT = SLOTS.find((s) => s.type === "T7")!;
const say = (ok: boolean, detail: string) => ({ ok, detail });
const said = (ok: boolean, o: Outcome) => say(ok, o.status + (o.step ? " at " + o.step + ": " + o.reason : "") + ", rewrites " + o.rewrites);

function deps(briefs: Record<string, BriefFiles>, over: Route = () => undefined, label = wordLabeller()) {
  const route = happy(briefs, { d1a: FIRST_TWIN_CALL, d2a: FIRST_TWIN_CALL });
  const call = stubCaller((req) => {
    const o = over(req);
    return o === undefined ? route(req) : o;
  });
  return { call, label, parse: fixtureParser, screen: FIXTURE_SCREEN };
}
const draft = (slot: Slot, d: ReturnType<typeof deps>, draw = 1) => runDraft(slot, slot.kind === "pair" ? "first" : "unpaired", { draw, attempt: 1, author: draw % 2 ? "sol" : "argon", pilot: false, partner: null }, d);
const second = (d: ReturnType<typeof deps>, author: "sol" | "argon") => runDraft(PAIR, "second", { draw: 1, attempt: 2, author, pilot: false, partner: { id: "d1a", files: FIRST, twin_call: FIRST_TWIN_CALL } satisfies Partner }, d);
const t7 = (over: Route = () => undefined, label = wordLabeller()) => draft(T7_SLOT, deps({ d1: T7 }, over, label));
const AUDIT_FAIL = '{"a": "pass", "b": "fail", "c": "pass", "d": "pass", "e": "pass", "f": "pass"}';
const total = (r: AuthorRun) => r.sets.calibration.length + r.sets.comparison.length + r.sets.reserve.length;
function whole(o: { secondFails?: (n: number) => boolean; usd?: number; cap?: number; screen?: typeof FIXTURE_SCREEN; pilotOnly?: boolean; pilot?: AuthorRun["pilot"] } = {}) {
  const call = runCaller({ secondFails: o.secondFails });
  return authorRun({ call, label: wordLabeller(), parse: fixtureParser, screen: o.screen ?? FIXTURE_SCREEN, spent: () => call.state.drafts * (o.usd ?? 1.04) }, { cap: o.cap ?? CAPS.authoring, concurrency: 8, pilotOnly: o.pilotOnly, pilot: o.pilot });
}
const mem = (id: string, set: Member["set"], kind: Member["kind"], draw: number, twin: string | null = null): Member => ({ id, slot: id, set, kind, type: "T1", skin: set === "comparison" ? 3 : 0, cluster: "d" + draw, draw, twin, digest: id, pilot: false });
const SETS = placeSets([mem("d1a", "comparison", "pair", 1, "d1b"), mem("d1b", "comparison", "pair", 1, "d1a"), mem("d2", "comparison", "founder", 2), mem("d4", "reserve", "builder", 4), mem("d5a", "reserve", "pair", 5, "d5b"), mem("d5b", "reserve", "pair", 5, "d5a"), mem("d6", "reserve", "founder", 6)]);
const refused = (f: () => unknown) => {
  try {
    f();
    return "opened";
  } catch (e) {
    return (e as Error).message;
  }
};

export const seams: Seam[] = [
  {
    name: "schedule: each comparison skin holds the eight types as 14 briefs in 8 clusters",
    run: () => {
      const bad = [1, 2, 3, 4, 5].filter((k) => SLOTS.filter((s) => s.set === "comparison" && s.skin === k && s.kind !== "builder").reduce((n, s) => n + (s.kind === "pair" ? 2 : 1), 0) !== 14);
      return say(bad.length === 0 && SLOTS.reduce((n, s) => n + (s.kind === "pair" ? 2 : 1), 0) === 110, "skins off 14: " + (bad.join(", ") || "none"));
    },
  },
  {
    name: "schedule: every named anti-pattern appears in a comparison opening",
    run: () => {
      const used = new Set(SLOTS.filter((s) => s.set === "comparison").map((s) => s.anti_pattern));
      const missing = ANTI_PATTERNS.filter((a) => !used.has(a.id)).map((a) => a.id);
      return say(missing.length === 0, "missing: " + (missing.join(", ") || "none"));
    },
  },
  {
    name: "schedule: a schedule without one anti-pattern is caught",
    run: () => {
      const cut = SLOTS.filter((s) => s.anti_pattern !== ANTI_PATTERNS[0]!.id);
      const used = new Set(cut.filter((s) => s.set === "comparison").map((s) => s.anti_pattern));
      return say(!used.has(ANTI_PATTERNS[0]!.id), "planted gap " + ANTI_PATTERNS[0]!.id + " found: " + !used.has(ANTI_PATTERNS[0]!.id));
    },
  },
  ...([[1, "sol"], [2, "gemini"]] as const).map(([draw, model]): Seam => ({
    name: "authors alternate: draw " + draw + " is written by " + model,
    run: async () => {
      const d = deps({ ["d" + draw]: T7 });
      await draft(T7_SLOT, d, draw);
      return say(d.call.calls[0]!.model === model, "first call to " + d.call.calls[0]!.model);
    },
  })),
  ...([["sol", "sol"], ["argon", "gemini"]] as const).map(([family, model]): Seam => ({
    name: "a top-up twin of a " + family + " pair is written by " + model,
    run: async () => {
      const d = deps({ d1b: SECOND });
      const o = await second(d, family);
      return say(o.status === "pass" && d.call.calls[0]!.model === model, "twin author call to " + d.call.calls[0]!.model + ", " + o.status);
    },
  })),
  { name: "builder goal fact: a sheet stating its goal passes", run: () => say(goalFactProblem(BUILDER.sheet, "hackathon") === null, String(goalFactProblem(BUILDER.sheet, "hackathon"))) },
  { name: "builder goal fact: a sheet stating another goal fails", run: () => say(goalFactProblem(BUILDER.sheet, "research") !== null, String(goalFactProblem(BUILDER.sheet, "research"))) },
  { name: "vocabulary screen: four shared words pass", run: () => say(screenVocabulary(FIXTURE_SCREEN, { opening: "Which neighbor would lend a hand?" }).pass, "four words") },
  { name: "vocabulary screen: five shared words fail", run: () => say(!screenVocabulary(FIXTURE_SCREEN, { opening: "Which neighbor would lend you a hand?" }).pass, "five words") },
  ...NAMED_TERMS.map((term): Seam => ({ name: "vocabulary screen: the named term " + term + " fails", run: () => say(!screenVocabulary(FIXTURE_SCREEN, { key: { ...T7.key, call: "Use " + term.toUpperCase() } }).pass, term) })),
  { name: "unanimous key: three validators making the call with an action pass", run: async () => { const o = await t7(); return said(o.status === "pass", o); } },
  { name: "unanimous key: one validator missing the call drops the brief", run: async () => { const o = await t7(undefined, wordLabeller((r) => (r.judge === "astra" && r.label.includes(":unanimous:") ? { decision: false } : undefined))); return said(o.reason === "not unanimous", o); } },
  { name: "unanimous key: one validator with no acceptable action drops the brief", run: async () => { const o = await t7(undefined, wordLabeller((r) => (r.label.includes(":unanimous:astra") ? { action: false } : undefined))); return said(o.reason === "not unanimous", o); } },
  { name: "give-away screen: no validator calling it from the opening passes", run: async () => { const o = await t7(); return said(o.checks.some((c) => c.step === "give-away" && c.ok), o); } },
  { name: "give-away screen: one validator calling it from the opening drops the brief", run: async () => { const o = await t7((r) => (r.label === "d1:give-away:sol:1" ? blockReply(T7.key.call, "x") : undefined)); return said(o.reason === "given away", o); } },
  { name: "give-away screen: a pair's first twin sends no opening-only prompt", run: async () => { const d = deps({ d1a: FIRST }); const o = await draft(PAIR, d); return said(o.status === "pass" && !d.call.calls.some((c) => c.label.includes(":give-away:")), o); } },
  { name: "blind audit: both auditors passing passes", run: async () => { const o = await t7(); return said(o.checks.some((c) => c.step === "audit" && c.ok), o); } },
  { name: "blind audit: a failed check after the one rewrite drops the brief", run: async () => { const o = await t7((r) => (r.label.includes(":audit:") ? AUDIT_FAIL : undefined)); return said(o.step === "audit" && o.rewrites === 1, o); } },
  { name: "recognition probe: no counted guess passes", run: async () => { const o = await t7(); return said(o.checks.some((c) => c.step === "probe" && c.ok), o); } },
  { name: "recognition probe: a counted guess sends the brief back, then drops it", run: async () => { const o = await t7((r) => (r.label.includes(":probe:sol:opening") ? (r.label.includes(":judge:") ? '{"matches": ["Acme"]}' : "Acme.") : undefined)); return said(o.step === "probe" && o.rewrites === 1, o); } },
  { name: "generic screen: no stock row credited passes", run: async () => { const o = await t7(); return said(o.checks.some((c) => c.step === "generic" && c.ok), o); } },
  { name: "generic screen: a credited stock row drops the brief", run: async () => { const o = await t7(undefined, wordLabeller((r, id) => (r.label.includes(":generic:astra") && id === "b1" ? { decision: true } : undefined))); return said(o.step === "generic", o); } },
  {
    name: "one rewrite: a vocabulary hit rewritten clean passes, and every live check binds the final digest",
    run: async () => {
      let n = 0;
      const bad = { ...T7, opening: T7.opening + " Which neighbor would lend you a hand?\n" };
      const o = await t7((r) => (/:author:1$/.test(r.label) && n++ === 0 ? happy({ d1: bad })(r) : undefined));
      const bound = o.checks.filter((c) => !c.void).every((c) => c.digest === digestOf(o.files!)) && o.checks.some((c) => c.void);
      return said(o.status === "pass" && o.rewrites === 1 && bound, o);
    },
  },
  {
    name: "one rewrite: a vocabulary hit and then an audit failure drops with no second rewrite",
    run: async () => {
      let n = 0;
      const bad = { ...T7, opening: T7.opening + " Which neighbor would lend you a hand?\n" };
      const o = await t7((r) => (/:author:1$/.test(r.label) && n++ === 0 ? happy({ d1: bad })(r) : r.label.includes(":audit:") ? AUDIT_FAIL : undefined));
      return said(o.status === "drop" && o.step === "audit" && o.rewrites === 1, o);
    },
  },
  { name: "twins: one decisive fact apart with opposite calls pass", run: () => say(twinProblem(FIRST, SECOND) === null, String(twinProblem(FIRST, SECOND))) },
  { name: "twins: a changed non-decisive fact fails", run: () => { const p = twinProblem(FIRST, { ...SECOND, sheet: { ...SECOND.sheet, facts: SECOND.sheet.facts.map((f) => (f.id === "F6" ? { ...f, text: "Another channel." } : f)) } }); return say(p !== null, String(p)); } },
  { name: "Wilson interval: Newcombe 1998's 81 of 263 gives 0.2553 to 0.3662", run: () => { const [l, h] = wilson(81, 263, 1.959964); return say(l.toFixed(4) === "0.2553" && h.toFixed(4) === "0.3662", l.toFixed(4) + " to " + h.toFixed(4)); } },
  { name: "pilot line: the planning inputs give 0.244", run: () => { const l = line(PLANNING.draw_usd, PLANNING.first_pass)!; return say(l.toFixed(3) === "0.244", l.toFixed(4)); } },
  { name: "pilot line: 1.04 a draw and a first-pass rate of 0.30 leave no line", run: () => say(line(1.04, 0.3) === null, String(line(1.04, 0.3))) },
  ...([[7, 16, "go"], [1, 16, "stop"], [4, 16, "more"]] as const).map(([k, n, v]): Seam => ({ name: "pilot read: " + k + " of " + n + " reads " + v, run: () => { const r = pilotRead([{ k, n }], line(PLANNING.draw_usd, PLANNING.first_pass)); return say(r.verdict === v, r.verdict); } })),
  { name: "pilot read: 4 of 16 then 8 of 32 stays open", run: () => { const r = pilotRead([{ k: 4, n: 16 }, { k: 8, n: 32 }], line(PLANNING.draw_usd, PLANNING.first_pass)); return say(r.verdict === "open", r.verdict); } },
  { name: "pilot, driven: every second twin passing reads go and authoring places all 110 briefs", run: async () => { const r = await whole(); return say(r.pilot.verdict === "go" && total(r) === 110 && haltOf(r, () => 0.1) === null, r.pilot.verdict + ", placed " + total(r)); } },
  { name: "pilot, driven: no second twin passing halts with E_OHR_PILOT_STOP", run: async () => { const r = await whole({ secondFails: () => true }); return say(haltOf(r, () => 0.1)?.code === "E_OHR_PILOT_STOP", r.pilot.verdict); } },
  { name: "pilot, driven: a read open at 16 and at 32 halts with E_OHR_PILOT_OPEN", run: async () => { const r = await whole({ secondFails: (n) => n % 4 !== 0 }); return say(haltOf(r, () => 0.1)?.code === "E_OHR_PILOT_OPEN", r.pilot.reads.map((x) => x.k + "/" + x.n).join(", ")); } },
  { name: "pilot, driven: a cost per draw with no room for second twins halts with no line", run: async () => { const r = await whole({ usd: 4 }); return say(r.pilot.verdict === "no-line" && haltOf(r, () => 0.1)?.code === "E_OHR_PILOT_STOP", r.pilot.verdict); } },
  { name: "supply: a cap stop before 110 briefs reports a shortfall with the count", run: async () => { const r = await whole({ secondFails: (n) => n > 16 }); const e = haltOf(r, () => 0.1); return say(e?.code === "E_OHR_SUPPLY_SHORT" && r.unmatched.length > 0, e?.message.slice(0, 120) ?? "no halt"); } },
  { name: "pilot briefs: a continuation with unchanged inputs places them", run: async () => { const p = await whole({ pilotOnly: true }); const r = await whole({ pilot: p.pilot }); return say(r.pilot_placed && total(r) === 110, "placed " + total(r)); } },
  { name: "pilot briefs: a continuation with a changed screen places none of them", run: async () => { const p = await whole({ pilotOnly: true }); const r = await whole({ pilot: p.pilot, screen: buildScreen(["a different source line for the screen"]) }); const ids = new Set([...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].map((m) => m.id)); return say(!r.pilot_placed && p.pilot.outcomes.every((x) => !ids.has(x.id)), "pilot placed " + r.pilot_placed); } },
  { name: "reserves: a dropped comparison pair is replaced by a reserve pair, whole", run: () => { const r = replaceDropped(SETS, "d1a", new Set()); return say(JSON.stringify(r.replaced) === '["d5a","d5b"]', String(r.replaced)); } },
  { name: "reserves: an unpaired founder is replaced by an unpaired founder, not a builder", run: () => { const r = replaceDropped(SETS, "d2", new Set()); return say(JSON.stringify(r.replaced) === '["d6"]', String(r.replaced)); } },
  { name: "reserves: nothing replaces a brief once stage 2 ran on it", run: () => { const r = replaceDropped(SETS, "d1a", new Set(["d1b"])); return say(r.replaced === null, String(r.replaced)); } },
  { name: "custody: a sealed output inside the repository is refused", run: () => { const m = refused(() => openCustody("/dev/shm/ohr-seam-never/work", join(REPO_ROOT, "x.age"))); return say(m.startsWith("E_OHR_CUSTODY"), m); } },
  { name: "custody: a work directory outside /dev/shm is refused", run: () => { const m = refused(() => openCustody(join(tmpdir(), "ohr-seam-work"), join(tmpdir(), "ohr-seam-never.age"))); return say(m.startsWith("E_OHR_CUSTODY"), m); } },
  {
    name: "custody: a fresh /dev/shm work directory and an outside output open",
    run: () => {
      const parent = mkdtempSync("/dev/shm/ohr-seam-");
      try {
        const m = refused(() => openCustody(join(parent, "work"), join(parent, "..", "ohr-seam-out-" + parent.slice(-6) + ".age")));
        return say(m === "opened", m);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
  },
];
