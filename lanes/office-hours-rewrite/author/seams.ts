// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite lane's authoring seams for the keyless dry run (prereg section 12 stage 1's "every gate on planted
// known-good and known-bad cases"): each drives one frozen rule of section 3 or section 13's authoring line on one side
// of its edge through this area's real code, with invented fixtures, a scripted caller, the fixture block parser and a
// word labeller, so the lane's dry run prints PASS or FAIL per edge and makes no model call. The second attempt's
// sections 4 and 5 add the driven seams its build step names: each slot's fixed draws, the bound, the pilot, the
// projection stop on planted yields that go and that stop, the reserve order, both sides of the cap stop, a restart at a
// new concurrency on a fake provider, and the reuse check on a planted digest mismatch. The 16 and 32 draw pilot read is
// gone, and its seams with it.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallRequest } from "../../product-value/meter.ts";
import { MeterError } from "../../product-value/meter.ts";
import { REPO_ROOT } from "../../product-value/io.ts";
import { CAPS, PAIRED_TYPES, PILOT, QUOTA, REUSED_SLOTS, TOP_UP_BOUND } from "../frozen.ts";
import type { Seam } from "../types.ts";
import { runDraft, type Outcome, type Partner } from "./brief.ts";
import { openCustody, readJournal, readReuse, sealedJournal } from "./custody.ts";
import { drawOf, familyOf, schedule, type Slot } from "./draws.ts";
import { digestOf, goalFactProblem, twinProblem, type BriefFiles } from "./files.ts";
import { BUILDER, FIRST, FIRST_TWIN_CALL, FIXTURE_SCREEN, SECOND, T7, answersOf, blockReply, fakeDecrypter, fakeMeter, fakeSealer, fixtureParser, happy, plantedFirstAttempt, runCaller, stubCaller, wordLabeller, writeFirstAttempt } from "./fixtures.ts";
import { ATTEMPT_1, projection, roomLeft } from "./pilot.ts";
import { ANTI_PATTERNS, NAMED_TERMS } from "./prompts.ts";
import { authorRun, haltOf, kindOf, metaOf, type AuthorRun, type Checkpoint, type Journal, type Reuse } from "./run.ts";
import { screenVocabulary } from "./screens.ts";
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
const bySlot = new Map(SLOTS.map((s) => [s.slot, s]));
const slotOfRef = (ref: string) => SLOTS.find((s) => s.p === Math.floor(Number(/^d(\d+)/.exec(ref)![1]) / 1000) - 1)!;
const hashed = (ref: string, below: number) => createHash("sha256").update(ref).digest()[0]! < below;
const SOME = (ref: string) => hashed(ref, 52);
const REF = (x: Outcome) => x.id + (x.attempt > 1 ? "." + x.attempt : "");
let planted: Promise<Outcome[]> | null = null;
const reused = async (): Promise<Reuse> => {
  const placed = await (planted ??= plantedFirstAttempt());
  return { placed, answers: answersOf(placed), failed: [] };
};
/** A whole authoring run on the scripted caller and a fake meter at the first attempt's costs a draft. */
async function whole(o: { fails?: (ref: string) => boolean; hang?: (label: string) => boolean; label?: ReturnType<typeof wordLabeller>; cap?: number; concurrency?: number; reuse?: Reuse; resume?: Checkpoint; journal?: Journal } = {}) {
  const call = runCaller({ fails: o.fails, hang: o.hang });
  const m = fakeMeter(call);
  const run = authorRun({ call: m.call, label: o.label ?? wordLabeller(), parse: fixtureParser, screen: FIXTURE_SCREEN, spent: m.spent, spentOn: m.spentOn }, { cap: o.cap ?? CAPS.authoring, concurrency: o.concurrency ?? 8, reuse: o.resume ? undefined : (o.reuse ?? (await reused())), resume: o.resume, journal: o.journal });
  return { run, call };
}
const done = async (o: Parameters<typeof whole>[0] = {}) => (await whole(o)).run;
const placedSet = (r: AuthorRun) => [...r.sets.calibration, ...r.sets.comparison, ...r.sets.reserve].map((m) => m.id + " " + m.digest).sort().join(",");
const capStopOn = (match: (ref: string) => boolean) => {
  const base = wordLabeller();
  return Object.assign(async (req: Parameters<typeof base>[0]) => {
    if (/^d\d+/.test(req.label) && match(req.label.split(":")[0]!)) throw new MeterError("CAP_STOP", "brief label: the ledger refused the call");
    return base(req);
  }, { calls: base.calls });
};
/** Runs body with fresh folders, one under the system temp and one under /dev/shm, and deletes both after. */
async function inTemp<T>(body: (dir: string, shm: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ohr-seam-")), shm = mkdtempSync("/dev/shm/ohr-seam-");
  try {
    return await body(dir, shm);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shm, { recursive: true, force: true });
  }
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
    name: "schedule: the kept slots hold 96 briefs, 56 comparison founders, 24 builders, 8 calibration and 8 reserve",
    run: () => {
      const briefs = (xs: Slot[]) => xs.reduce((n, s) => n + (s.kind === "pair" ? 2 : 1), 0);
      const got = [briefs(SLOTS), briefs(SLOTS.filter((s) => s.set === "comparison" && s.kind !== "builder")), briefs(SLOTS.filter((s) => s.set === "comparison" && s.kind === "builder")), briefs(SLOTS.filter((s) => s.set === "calibration")), briefs(SLOTS.filter((s) => s.set === "reserve"))];
      return say(JSON.stringify(got) === JSON.stringify([96, QUOTA.founder, QUOTA.builder, QUOTA.calibration, QUOTA.reserve]), "briefs, founders, builders, calibration, reserve: " + got.join(", "));
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
    name: "authors: a draft from the " + (draw % 2 ? "sol" : "argon") + " family is written by " + model,
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
  {
    name: "draws: every slot's k-th first-twin or unpaired draft is draw 1000 * (p + 1) + k from the family p + k names, and a second twin takes its partner's",
    run: async () => {
      const r = await done({ fails: SOME });
      const bad = SLOTS.filter((s) => {
        const mine = r.outcomes.filter((x) => x.slot === s.slot);
        const own = mine.filter((x) => x.role !== "second").some((x, i) => x.draw !== drawOf(s.p, i + 1) || x.author !== familyOf(s.p, i + 1));
        return own || mine.filter((x) => x.role === "second").some((x) => { const p = mine.find((y) => y.id === x.id.replace(/b$/, "a"))!; return x.draw !== p.draw || x.author !== p.author; });
      });
      return say(bad.length === 0 && r.stopped === "quotas", "slots off their sequence: " + (bad.map((s) => s.slot).join(", ") || "none") + "; stopped at " + r.stopped);
    },
  },
  {
    name: "draws: concurrency 1 and 8 place the same briefs",
    run: async () => {
      const [a, b] = await Promise.all([done({ fails: SOME, concurrency: 1 }), done({ fails: SOME, concurrency: 8 })]);
      return say(placedSet(a) === placedSet(b) && total(a) === 96, "placed " + total(a) + " and " + total(b));
    },
  },
  {
    name: "bound: a partner whose " + TOP_UP_BOUND + " second twins all fail drops, unplaced, and its slot draws its next first twin",
    run: async () => {
      const slot = SLOTS.find((s) => s.kind === "pair" && s.set === "comparison" && !REUSED_SLOTS.includes(s.slot))!;
      const first = "d" + drawOf(slot.p, 1);
      const r = await done({ fails: (ref) => ref.startsWith(first + "b") });
      const mine = r.outcomes.filter((x) => x.slot === slot.slot).map((x) => x.role + ":" + x.status);
      const want = ["first:pass", ...Array.from({ length: TOP_UP_BOUND }, () => "second:drop"), "first:pass", "second:pass"];
      return say(JSON.stringify(mine) === JSON.stringify(want) && TOP_UP_BOUND === 30, mine.length + " drafts in " + slot.slot + ", " + mine.filter((x) => x === "second:drop").length + " second twins dropped");
    },
  },
  {
    name: "pilot: two open slots of each pair type, each settling one partner, and 8 drafts of each unpaired kind or its open slots come first",
    run: async () => {
      const r = await done();
      const p = r.outcomes.slice(0, r.outcomes.findIndex((x) => !x.pilot));
      const main = SLOTS.filter((s) => s.set !== "reserve" && !REUSED_SLOTS.includes(s.slot));
      const pairs = PAIRED_TYPES.flatMap((t) => main.filter((s) => s.type === t).slice(0, PILOT.pair_slots).map((s) => s.slot)).sort();
      const kinds = (["T7", "T8", "builder"] as const).map((u) => p.filter((x) => kindOf(bySlot.get(x.slot)!) === u).length);
      const ok = JSON.stringify([...new Set(p.filter((x) => x.role !== "unpaired").map((x) => x.slot))].sort()) === JSON.stringify(pairs) && JSON.stringify(kinds) === "[3,5,8]" && r.outcomes.slice(p.length).every((x) => !x.pilot);
      return say(ok, p.length + " pilot drafts; T7, T8 and builder drafts " + kinds.join(", "));
    },
  },
  {
    name: "projection: the first attempt's counts within the bound, T8 at T7's, give sizing.txt's $127.52 against $337.83 of room after a $43.17 pilot",
    run: () => {
      const p = projection({ ...ATTEMPT_1, unpaired: { ...ATTEMPT_1.unpaired, T8: ATTEMPT_1.unpaired.T7 } }, { pairs: { T1: 4, T2: 3, T3: 3, T4: 3, T5: 4, T6: 3 }, unpaired: { T7: 3, T8: 5, builder: 21 } }, 1);
      return say(p.toFixed(2) === "127.52" && roomLeft(409, 43.17).toFixed(2) === "337.83", "$" + p.toFixed(2) + " against $" + roomLeft(409, 43.17).toFixed(2));
    },
  },
  {
    name: "projection stop, driven: planted yields that go fill calibration, comparison and then the reserves, and no read stops",
    run: async () => {
      const r = await done({ fails: SOME });
      return say(r.reads.length > 1 && r.reads.every((x) => !x.stop) && r.full && total(r) === 96 && haltOf(r, () => 0.14) === null, r.reads.length + " reads, placed " + total(r));
    },
  },
  {
    name: "projection stop, driven: T1 and T4 never matching and unpaired briefs rarely passing end authoring with E_OHR_PROJECTION_STOP before the cap",
    run: async () => {
      const r = await done({ fails: (ref) => (/^d\d+b/.test(ref) && ["T1", "T4"].includes(slotOfRef(ref).type)) || (/^d\d+(\.\d+)?$/.test(ref) && hashed(ref, 200)) });
      const last = r.reads.at(-1)!;
      const e = haltOf(r, () => 0.14);
      return say(r.stopped === "projection" && !r.full && last.stop && last.committed < CAPS.authoring - 28 && e?.code === "E_OHR_PROJECTION_STOP", e?.message.slice(0, 160) ?? "no halt");
    },
  },
  {
    name: "reserves: no reserve slot draws until calibration and comparison are full",
    run: async () => {
      const r = await done({ fails: SOME });
      const last = r.outcomes.map((x) => bySlot.get(x.slot)!.set !== "reserve").lastIndexOf(true);
      const first = r.outcomes.findIndex((x) => bySlot.get(x.slot)!.set === "reserve");
      return say(first > last && r.sets.reserve.length === QUOTA.reserve, "first reserve draft at " + first + ", last main draft at " + last);
    },
  },
  {
    name: "cap stop: after calibration and comparison are full it ends authoring with the reserves placed so far and no halt",
    run: async () => {
      const r = await done({ label: capStopOn((ref) => slotOfRef(ref).set === "reserve") });
      return say(r.stopped === "cap" && r.full && haltOf(r, () => 0.14) === null, "stopped at " + r.stopped + ", full " + r.full + ", reserves " + r.sets.reserve.length);
    },
  },
  {
    name: "cap stop: before they are full it halts, and a pilot batch the cap cannot cover reports a shortfall with the count",
    run: async () => {
      const thrown = await done({ label: capStopOn((ref) => slotOfRef(ref).set === "comparison") });
      const short = await done({ cap: 20 });
      const a = haltOf(thrown, () => 0.14), b = haltOf(short, () => 0.14);
      return say(a?.code === "CAP_STOP" && !thrown.full && b?.code === "E_OHR_SUPPLY_SHORT" && short.stopped === "cap", (a?.code ?? "no halt") + "; " + (b?.message.slice(0, 120) ?? "no halt"));
    },
  },
  {
    name: "restart: a run stopped between a draft's seal and its batch's checkpoint, resumed at concurrency 3, requests no sealed draft again and places what an unbroken run places",
    run: () =>
      inTemp(async (dir, shm) => {
        const unbroken = await done({ fails: SOME });
        const target = unbroken.outcomes[60]!;
        let hung = false;
        const journal = (n: string) => sealedJournal({ dir, work: join(shm, n), sealer: fakeSealer, runId: "ohr-author-seams" });
        void (await whole({ fails: SOME, hang: (l) => l === REF(target) + ":author:1" && (hung = true), journal: journal("a") })).run;
        while (!hung) await new Promise((r) => setTimeout(r, 1));
        await new Promise((r) => setTimeout(r, 50));
        const names = readdirSync(dir);
        const newest = names.filter((n) => n.startsWith("checkpoint-")).sort().at(-1)!;
        const resumed = readJournal(join(dir, newest), fakeDecrypter, join(shm, "open"));
        const sealedRefs = new Set(resumed.log.map(REF));
        const again = await whole({ fails: SOME, concurrency: 3, resume: resumed, journal: journal("b") });
        const r = await again.run;
        const asked = again.call.calls.filter((c) => /:author:1$/.test(c.label)).map((c) => c.label.split(":")[0]!);
        const twice = asked.filter((ref) => sealedRefs.has(ref));
        const between = names.filter((n) => n.startsWith("draft-")).length > Number(/(\d{6})/.exec(newest)![1]);
        return say(between && twice.length === 0 && asked.includes(REF(target)) && placedSet(r) === placedSet(unbroken) && resumed.run_id === "ohr-author-seams", resumed.log.length + " sealed drafts of run " + resumed.run_id + " resumed from " + newest + "; sealed drafts requested again: " + (twice.join(", ") || "none"));
      }),
  },
  {
    name: "reuse: a planted brief whose files no longer match its recorded digest is not placed, and its slot is drafted again",
    run: () =>
      inTemp(async (dir, shm) => {
        const placed = (await reused()).placed;
        const tampered = placed.find((x) => x.role === "unpaired" && bySlot.get(x.slot)!.kind === "builder")!;
        const plain = join(dir, "plain");
        writeFirstAttempt(plain, placed, (x) => metaOf(bySlot.get(x.slot)!, x));
        writeFileSync(join(plain, "briefs", tampered.id, "opening.md"), tampered.files!.opening + "One more line.\n");
        fakeSealer(plain, join(dir, "authoring.tar.age"));
        const reuse = readReuse(join(dir, "authoring.tar.age"), fakeDecrypter, join(shm, "w"));
        const r = await done({ reuse });
        const again = r.outcomes.find((x) => x.slot === tampered.slot);
        return say(reuse.failed.map((f) => f.id).join() === tampered.id && reuse.placed.length === placed.length - 1 && again?.draw === drawOf(bySlot.get(tampered.slot)!.p, 1) && total(r) === 96, "failed: " + reuse.failed.map((f) => f.id + " " + f.why).join("; "));
      }),
  },
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
