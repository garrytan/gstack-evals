// Copyright (c) 2026 Garry Tan. MIT License.
// The author area's dry-run cases (build plan section 15, prereg start rule 5, addendum R2-9, R2-16 and R2-21): each
// runs the lane's real functions on the invented fixture with a scripted caller and names the rule it drives.
import { DcError } from "../errors.ts";
import { STOCK_ROWS } from "../frozen.ts";
import type { AuthorFamily, DryRunCase, ItemClass } from "../types.ts";
import { authorBundle, cutMarker, rankScreens } from "./bundle.ts";
import { parseLabels } from "./checks.ts";
import { draw, drawRuleProblems, kindOrder, pilotPositions } from "./draws.ts";
import { appView, authorReply, CONTEXT, DECOY, EVIDENCE, EVIDENCE_2X, FIXTURE_APP, FIXTURE_APP_2, ITEMS, ITEMS_2X, PLAN, transformReply, WRONG_WAY } from "./fixture.ts";
import { enforceGateCheck, keylessGates, runGateCheck, tableOf, type PlantedName, type PlantedUnit } from "./gatecheck.ts";
import { checkPilot, pilotCost, reproject } from "./pilot.ts";
import { runUnit, wrongWayShort, type UnitJob, type UnitOutcome } from "./pipeline.ts";
import { runPilot, type PilotReport } from "./run.ts";
import { authorPrompt } from "./prompts.ts";
import { scripted, defaultBlock, STAND_IN_VOCABULARY, type Script } from "./scripted.ts";
import { screen2x, screenUnit, vocabularyFrom } from "./screen.ts";
import type { Caller, Deps } from "./seams.ts";
import { fillSets, replaceDropped, type Member } from "./sets.ts";
import { sha256 } from "./text.ts";
import { sourceTwins, type CalibrationUnit } from "./twins.ts";
import { digestOf, idSeed, inheritIds, intake, standing, type UnitFiles } from "./unit.ts";
import { run2x } from "./x2.ts";

const BUNDLE = authorBundle(FIXTURE_APP, "k1").text;
const job = (unitId = "u1", author: AuthorFamily = "sol"): UnitJob => ({ unitId, app: FIXTURE_APP, author, bundle: BUNDLE, prompt: authorPrompt(BUNDLE, "k1") });
const ID = Object.fromEntries(intake("u1", ITEMS, []).map((i) => [i.class, i.id])) as Record<ItemClass, string>;
const want = (ok: boolean, why: string): string | null => (ok ? null : why);
const item = (o: UnitOutcome, c: ItemClass) => o.files!.key.items.find((i) => i.class === c)!;
const brief = (o: UnitOutcome) => o.status + " at " + o.step + " (" + o.reason + "), primary " + o.primary.join(",");

async function unit(script: Script, id = "u1") {
  const w = scripted(script);
  const o = await runUnit(job(id), w.deps);
  return { o, w };
}

/** The fixture unit's files with ids and context, as a base unit that passed with all five items primary. */
export function baseFiles(unitId = "u1"): UnitFiles {
  return { plan: PLAN, context: CONTEXT, evidence: EVIDENCE.map((e) => ({ ...e })), key: { items: intake(unitId, ITEMS, []), wrongWay: [...WRONG_WAY], decoy: null } };
}

async function x2(script: Script) {
  const w = scripted(script);
  const base = baseFiles();
  const before = JSON.stringify(base);
  const o = await run2x({ unitId: "u1", app: FIXTURE_APP, author: "sol", bundle: BUNDLE, base, primary: base.key.items.map((i) => i.id) }, w.deps);
  return { o, w, baseUnchanged: JSON.stringify(base) === before };
}

/** Routes each call to its unit's own scripted world, by the unit id that starts every label. */
function routed(worlds: Record<string, Deps>): Deps {
  const call: Caller = (req) => worlds[req.label.split(":")[0]!]!.call(req);
  const any = Object.values(worlds)[0]!;
  return { ...any, call };
}

export const PLANTED: Record<PlantedName, { cls: ItemClass | null; script: Script }> = {
  G1: { cls: null, script: {} },
  G2: { cls: null, script: {} },
  B1: { cls: null, script: { audit: (_r, a) => (a === "opus" ? { inputFailures: ["plan-signposts"] } : {}) } },
  B2: { cls: "S", script: { audit: (_r, a) => (a === "opus" ? { verdicts: { S: "drop" } } : {}) } },
  B3: { cls: null, script: { audit: (_r, a) => (a !== "opus" ? { inputFailures: ["evidence-recommends"] } : {}) } },
  B4: { cls: "H", script: { block: (step, v) => (step === "unanimous" && v === "sol" ? defaultBlock(step).filter((c) => !c.includes("[H")) : defaultBlock(step)) } },
  B5: { cls: "R", script: { generic: (l) => (l === "opus" ? ["R"] : []) } },
  B6: { cls: "Y", script: { audit: (_r, a) => (a !== "opus" ? { verdicts: { Y: "drop" } } : {}) } },
};

/** The fixture line that holds no word of the S item's detail, for B2's unsupported pointer. */
const UNSUPPORTED = (() => {
  const e = EVIDENCE.find((x) => x.path.includes("releases"))!;
  return { file: e.path, line: e.text.split("\n").findIndex((l) => l.startsWith("- The dashboard shows cash")) + 1 };
})();

/** A detail the UNSUPPORTED line holds words of. */
const SUPPORTED = "cash received this week shown as two numbers";

/** The fixture unit with its planted defect: B2's item points only at UNSUPPORTED, and B6's Y item names StatusPill where DataTable.tsx holds DataTable. */
function plantedFiles(name: PlantedName): UnitFiles {
  const f = baseFiles("gate" + name);
  for (const i of f.key.items) {
    if (name === "B2" && i.class === PLANTED.B2.cls) i.evidence = [{ ...UNSUPPORTED }];
    if (name === "B6" && i.class === PLANTED.B6.cls) i.statement = i.statement.replace("shared DataTable in", "shared StatusPill in");
  }
  return f;
}

/** The first audit marks the class's item fix (Opus), the fix returns the given text and the second audit keeps every item. */
const fixThenKeep = (cls: ItemClass, statement: string, detail: string): Script => ({
  audit: (round, a) => (round.startsWith("audit2") || a !== "opus" ? {} : { verdicts: { [cls]: "fix" } }),
  fix: (ids) => JSON.stringify({ items: ids.map((id) => ({ id, statement, detail })) }),
});

/** The E_DC_GATE_CHECK message the gate check stops with, or why it didn't stop. */
async function gateStop({ units, deps }: { units: PlantedUnit[]; deps: Deps }): Promise<string> {
  try {
    await enforceGateCheck(units, deps, tableOf(units));
    return "no stop";
  } catch (e) {
    return e instanceof DcError && e.code === "E_DC_GATE_CHECK" ? e.message : "other error: " + String(e);
  }
}

function planted(overrides: Partial<Record<PlantedName, Script>> = {}): { units: PlantedUnit[]; deps: Deps } {
  const names = Object.keys(PLANTED) as PlantedName[];
  const units = names.map((name) => ({ name, unitId: "gate" + name, files: plantedFiles(name), app: FIXTURE_APP, author: "sol" as AuthorFamily, bundle: BUNDLE, plantedClass: PLANTED[name].cls }));
  const worlds = Object.fromEntries(names.map((name) => ["gate" + name, scripted(overrides[name] ?? PLANTED[name].script).deps]));
  return { units, deps: routed(worlds) };
}

const member = (position: number, apps = 20): Member => ({ id: "p" + position, position, app: (position - 1) % apps, kind: "k1", author: "sol", digest: sha256("p" + position) });

const throwsCode = (f: () => unknown, code: string): boolean => {
  try {
    f();
    return false;
  } catch (e) {
    return e instanceof DcError && e.code === code;
  }
};

/** A first-found matcher, for contrast: items in input order, each takes its first free change. */
function firstFound(items: { id: string; edges: number[] }[]): string[] {
  const used = new Set<number>();
  const got: string[] = [];
  for (const i of items) {
    const c = i.edges.find((e) => !used.has(e));
    if (c !== undefined) {
      used.add(c);
      got.push(i.id);
    }
  }
  return got.sort();
}

export function cases(): DryRunCase[] {
  const order = kindOrder();
  const vector = sha256("20261114\nu-vector").slice(0, 8);
  return [
    // ---- PD-12 and R2-21: item ids at intake
    {
      rule: "PD-12",
      name: "seed test vector: sha256 of 20261114, a newline and u-vector starts " + vector + ", read as " + idSeed("u-vector") + "; canonical S,H,R,A,Y take ids i01 to i05 as A,R,H,Y,S",
      check: () => {
        const ids = intake("u-vector", ITEMS, []).map((i) => i.id + i.class).join(" ");
        return want(vector === "376f53e7" && idSeed("u-vector") === 930042855 && ids === "i01A i02R i03H i04Y i05S", "got " + vector + " " + idSeed("u-vector") + " " + ids);
      },
    },
    {
      rule: "PD-12",
      name: "ids never follow the author's array order: the reversed and rotated item lists get the same ids",
      check: () => {
        const a = JSON.stringify(intake("u1", ITEMS, []));
        const b = JSON.stringify(intake("u1", [...ITEMS].reverse(), []));
        const c = JSON.stringify(intake("u1", [...ITEMS.slice(2), ...ITEMS.slice(0, 2)], []));
        return want(a === b && b === c, "ids moved with the author's order");
      },
    },
    // ---- K1: order and early exits
    {
      rule: "K1",
      name: "a passing unit runs author, context writer, step 3, the audit, the generic screen, step 5 and step 6 in that order",
      check: async () => {
        const { o, w } = await unit({});
        const roles = w.calls.map((l) => l.split(":")).map((p) => (p[2] === "generic" ? "generic" : p[1]!.replace(/-\d+$/, "")));
        const firsts = [...new Set(roles)].join(" ");
        return want(o.status === "pass" && o.primary.length === 5 && o.log.map((e) => e.step).join(" ") === "screen audit generic unanimous give-away" && firsts === "author context audit generic unanimous give-away", brief(o) + "; " + firsts);
      },
    },
    {
      rule: "K1",
      name: "early exit after the audit: 2 items left, so no generic screen and no validator runs",
      check: async () => {
        const { o, w } = await unit({ audit: (_r, a) => (a === "opus" ? { verdicts: { S: "drop", H: "drop", R: "drop" } } : {}) });
        return want(o.status === "drop" && o.step === "audit" && w.count("generic") === 0 && w.count("block") === 0, brief(o) + ", generic " + w.count("generic") + ", blocks " + w.count("block"));
      },
    },
    {
      rule: "K1",
      name: "early exit inside step 5: Opus's block credits 2 items, so Sol and Astra are never asked",
      check: async () => {
        const { o, w } = await unit({ block: (step, v) => (step === "unanimous" && v === "opus" ? ["Handle [S+].", "Handle [H+]."] : defaultBlock(step)) });
        return want(o.status === "drop" && o.step === "unanimous" && w.count("block") === 1 && o.record.unanimous!.earlyExit, brief(o) + ", blocks " + w.count("block"));
      },
    },
    {
      rule: "K1",
      name: "early exit inside step 6: Opus's give-away block credits 3 of 5, so no further give-away block runs",
      check: async () => {
        const { o, w } = await unit({ block: (step, v) => (step === "give-away" && v === "opus" ? ["Handle [S].", "Handle [H].", "Handle [R]."] : defaultBlock(step)) });
        const gb = w.calls.filter((l) => l.includes(":give-away:block:")).length;
        return want(o.status === "drop" && o.step === "give-away" && gb === 1, brief(o) + ", give-away blocks " + gb);
      },
    },
    // ---- K2: digests
    {
      rule: "K2",
      name: "flags leave the digest alone; a wording change moves it",
      check: () => {
        const u = baseFiles();
        const d = digestOf(u);
        const f = structuredClone(u);
        f.key.items[0]!.drop = "given-away";
        f.key.items[1]!.mentioned = true;
        f.key.items[2]!.generic = true;
        f.key.items[3]!.detailKeyed = true;
        const w = structuredClone(u);
        w.key.items[0]!.statement += " Again.";
        return want(digestOf(f) === d && digestOf(w) !== d, "flags moved it or wording didn't");
      },
    },
    {
      rule: "K2",
      name: "a result read on another digest is void unless it is the first audit carried across the fix round",
      check: () => {
        const log = [
          { step: "screen", digest: "a", ok: true, detail: "", void: false, carried: false },
          { step: "audit", digest: "a", ok: true, detail: "", void: false, carried: true },
          { step: "screen", digest: "b", ok: true, detail: "", void: false, carried: false },
          { step: "audit", digest: "a", ok: true, detail: "", void: true, carried: true },
        ];
        const s = standing(log, "b").map((e) => e.step + e.digest).join(" ");
        return want(s === "audita screenb", "standing: " + s);
      },
    },
    {
      rule: "K2",
      name: "first-audit drops carry across the fix's digest change",
      check: async () => {
        const { o } = await unit({ audit: (r, a) => (r === "audit-0" ? (a === "opus" ? { verdicts: { R: "drop" } } : { verdicts: { S: "fix" } }) : {}) });
        const audit = o.log.find((e) => e.step === "audit")!;
        const final = digestOf(o.files!);
        return want(o.status === "pass" && item(o, "R").drop === "audit" && item(o, "S").statement.includes("the new src/") && audit.carried && audit.digest !== final && standing(o.log, final).includes(audit) && o.primary.length === 4, brief(o));
      },
    },
    // ---- K3, PD-2 and R2-9: the audit and its one fix round
    {
      rule: "K3",
      name: "fix round: the second audit still marks the fixed item fix, so it drops",
      check: async () => {
        const { o, w } = await unit({ audit: (r, a) => (r === "audit-0" && a === "argon" ? { verdicts: { S: "fix" } } : r === "audit2-0" && a === "opus" ? { verdicts: { S: "fix" } } : {}) });
        return want(o.status === "pass" && item(o, "S").drop === "audit-2" && o.fixRounds === 1 && w.count("fix") === 1 && w.count("audit2") === 2 && o.primary.length === 4, brief(o));
      },
    },
    {
      rule: "R2-9",
      name: "a fix round whose second audit drops an unfixed item: H was never marked fix and drops at audit 2",
      check: async () => {
        const { o } = await unit({ audit: (r, a) => (r === "audit-0" && a === "argon" ? { verdicts: { S: "fix" } } : r === "audit2-0" && a === "argon" ? { verdicts: { H: "fix" } } : {}) });
        return want(o.status === "pass" && item(o, "H").drop === "audit-2" && item(o, "S").drop === null && o.droppedAtSecondAudit.join() === ID.H, brief(o) + ", unfixed dropped " + o.droppedAtSecondAudit);
      },
    },
    {
      rule: "K3",
      name: "an input failure beside a fix: the unit is rewritten and the fix is moot",
      check: async () => {
        const { o, w } = await unit({ audit: (r, a) => (r === "audit-0" ? (a === "opus" ? { verdicts: { S: "fix" } } : { inputFailures: ["evidence-recommends"] }) : {}) });
        return want(o.status === "pass" && o.rewrites === 1 && w.count("fix") === 0 && w.count("rewrite") === 1 && item(o, "S").drop === null, brief(o) + ", fix calls " + w.count("fix"));
      },
    },
    {
      rule: "K3",
      name: "a per-item drop beside a unit-level input failure: the input failure wins, the rewrite reruns, and the drop doesn't stand",
      check: async () => {
        const { o } = await unit({ audit: (r, a) => (r === "audit-0" ? (a === "opus" ? { verdicts: { H: "drop" } } : { inputFailures: ["plan-signposts"] }) : {}) });
        return want(o.status === "pass" && o.rewrites === 1 && item(o, "H").drop === null && o.primary.length === 5, brief(o));
      },
    },
    {
      rule: "K3",
      name: "a second input failure drops the unit",
      check: async () => {
        const { o, w } = await unit({ audit: (_r, a) => (a === "opus" ? { inputFailures: ["real-person"] } : {}) });
        return want(o.status === "drop" && o.step === "audit" && o.rewrites === 1 && w.count("rewrite") === 1, brief(o));
      },
    },
    // ---- K4: resends
    {
      rule: "K4",
      name: "an unparsable audit reply is resent once with the output cap doubled; a second failure drops the unit",
      check: async () => {
        const once = await unit({ audit: (_r, a, n) => (a === "opus" && n === 1 ? "no json here" : {}) });
        const twice = await unit({ audit: (_r, a) => (a === "opus" ? "no json here" : {}) });
        const caps = twice.w.requests.filter((r) => r.label.startsWith("u1:audit-0:opus")).map((r) => r.maxTokens).join(",");
        return want(once.o.status === "pass" && twice.o.status === "drop" && twice.o.step === "audit" && caps === "16000,32000", brief(once.o) + " / " + brief(twice.o) + " caps " + caps);
      },
    },
    {
      rule: "K4",
      name: "an author reply that doesn't parse is resent once; a second failure drops the attempt",
      check: async () => {
        const once = await unit({ author: (n) => (n === 1 ? "Sorry, here is a plan." : authorReply()) });
        const twice = await unit({ author: () => "Sorry, here is a plan." });
        return want(once.o.status === "pass" && twice.o.status === "drop" && twice.o.step === "author" && twice.o.calls === 2, brief(once.o) + " / " + brief(twice.o));
      },
    },
    {
      rule: "K4",
      name: "a validator reply with no block is resent once; a second failure drops the unit",
      check: async () => {
        const once = await unit({ block: (step, v, n) => (step === "unanimous" && v === "sol" && n === 1 ? null : defaultBlock(step)) });
        const twice = await unit({ block: (step, v) => (step === "unanimous" && v === "sol" ? null : defaultBlock(step)) });
        return want(once.o.status === "pass" && twice.o.status === "drop" && twice.o.step === "unanimous" && /no parsable block/.test(twice.o.reason), brief(once.o) + " / " + brief(twice.o));
      },
    },
    {
      rule: "K4",
      name: "a label packet with an unlabelled cell is resent once whole; a second failure drops the unit",
      check: async () => {
        const once = await unit({ dropLabels: (step, v, n) => step === "give-away" && v === "astra" && n === 1 });
        const twice = await unit({ dropLabels: (step, v) => step === "give-away" && v === "astra" });
        return want(once.o.status === "pass" && twice.o.status === "drop" && twice.o.step === "give-away", brief(once.o) + " / " + brief(twice.o));
      },
    },
    {
      rule: "K4",
      name: "a generic-screen cell missing twice makes its item generic; missing once, it doesn't",
      check: async () => {
        const once = await unit({ generic: (l, n) => (l === "astra" && n === 1 ? { missing: ["H"] } : []) });
        const twice = await unit({ generic: (l) => (l === "astra" ? { missing: ["H"] } : []) });
        return want(!item(once.o, "H").generic && item(twice.o, "H").generic && twice.o.record.generic!.missing.join() === ID.H && twice.o.primary.length === 4, brief(once.o) + " / " + brief(twice.o));
      },
    },
    {
      rule: "R2-18",
      name: "a yes with no change index is an unlabelled cell",
      check: () => {
        const cells = parseLabels(JSON.stringify({ cells: [{ list: "a", item: "i01", anticipated: true, anticipated_changes: [], screen_hit: false, screen_hit_changes: [] }, { list: "a", item: "i02", anticipated: false, anticipated_changes: [], screen_hit: true, screen_hit_changes: [9] }] }), [{ id: "a", changes: ["x", "y"] }], [{ id: "i01", detail: null }, { id: "i02", detail: null }, { id: "i03", detail: null }], false);
        const k = ["i01", "i02", "i03"].map((i) => cells.a![i]!.kind).join(",");
        return want(k === "unlabelled,unlabelled,unlabelled", k);
      },
    },
    // ---- K5: mentioned and generic
    {
      rule: "K5",
      name: "an item the author marks mentioned leaves the primary and is labelled only for its stratum",
      check: async () => {
        const { o } = await unit({ author: () => authorReply({ mentioned: ["R"] }) });
        const strata = o.record.unanimous!.blocks[0]!.strata.assigned;
        return want(o.status === "pass" && item(o, "R").mentioned && !o.primary.includes(ID.R) && strata[ID.R] !== undefined, brief(o));
      },
    },
    {
      rule: "K5",
      name: "an item either auditor flags mentioned, or either labeller marks generic, leaves the primary",
      check: async () => {
        const { o } = await unit({ audit: (_r, a) => (a === "opus" ? { mentioned: ["R"] } : {}), generic: (l) => (l === "opus" ? ["Y"] : []) });
        return want(o.status === "pass" && item(o, "R").mentioned && item(o, "Y").generic && o.primary.length === 3, brief(o));
      },
    },
    {
      rule: "K5",
      name: "the generic screen labels stock rows 1 and 2 only; row 3 never screens",
      check: async () => {
        const { w } = await unit({});
        const gp = w.requests.filter((r) => r.label.includes(":generic:"));
        const ok = gp.length === 2 && gp.every((r) => r.prompt.includes(STOCK_ROWS[0].changes[0]) && r.prompt.includes(STOCK_ROWS[1].changes[0]) && !r.prompt.includes(STOCK_ROWS[2].changes[0]));
        return want(ok, "generic packets " + gp.length);
      },
    },
    // ---- start rule 5: the unanimous rule, the give-away rule and the floor
    {
      rule: "SR5",
      name: "unanimous at 2 and 3 of 3: R credited by 2 blocks drops, the rest credited by 3 stay",
      check: async () => {
        const { o } = await unit({ block: (step, v) => (step === "unanimous" && v === "sol" ? defaultBlock(step).filter((c) => !c.includes("[R")) : defaultBlock(step)) });
        return want(o.status === "pass" && item(o, "R").drop === "not-unanimous" && o.primary.length === 4, brief(o));
      },
    },
    {
      rule: "SR5",
      name: "give-away with none and one model credited: Y credited by Astra alone drops, none credited keeps all",
      check: async () => {
        const none = await unit({});
        const one = await unit({ block: (step, v) => (step === "give-away" && v === "astra" ? ["Reuse the [Y] table."] : defaultBlock(step)) });
        return want(none.o.primary.length === 5 && item(one.o, "Y").drop === "given-away" && one.o.primary.length === 4, brief(none.o) + " / " + brief(one.o));
      },
    },
    {
      rule: "SR5",
      name: "the 3-item floor: 3 primary items pass, 2 drop",
      check: async () => {
        const three = await unit({ author: () => authorReply({ mentioned: ["R"] }), generic: (l) => (l === "astra" ? ["Y"] : []) });
        const two = await unit({ author: () => authorReply({ mentioned: ["R"] }), generic: (l) => (l === "astra" ? ["Y"] : []), block: (step, v) => (step === "unanimous" && v === "astra" ? defaultBlock(step).filter((c) => !c.includes("[S")) : defaultBlock(step)) });
        return want(three.o.status === "pass" && three.o.primary.length === 3 && two.o.status === "drop" && two.o.step === "unanimous", brief(three.o) + " / " + brief(two.o));
      },
    },
    // ---- PD-1 and M9: key construction reads fixedMatching over the items left
    {
      rule: "PD-1",
      name: "a generic item and a real item sharing the one giving-away change: the real item is given away, the generic one prints in its stratum",
      check: async () => {
        const { o } = await unit({ generic: (l) => (l === "opus" ? ["A"] : []), block: (step, v) => (step === "give-away" && v === "opus" ? ["Mark the [A][H] rows clearly."] : defaultBlock(step)) });
        const b = o.record.giveAway!.blocks[0]!;
        return want(ID.A < ID.H && item(o, "H").drop === "given-away" && item(o, "A").drop === null && item(o, "A").generic && b.matching.assigned[ID.H] === 1 && b.strata.assigned[ID.A] === 1 && o.status === "pass", brief(o));
      },
    },
    {
      rule: "PD-1",
      name: "tied matchings in step 5 retain one fixed key with changes and the author's item order permuted; a first-found matcher doesn't",
      check: async () => {
        const shared = "One change on the [A][H] rows.";
        const a = await unit({ block: (step) => (step === "unanimous" ? [shared, "Handle [S+].", "Handle [R+].", "Handle [Y+]."] : defaultBlock(step)) });
        const b = await unit({ author: () => authorReply({ items: [...ITEMS].reverse() }), block: (step) => (step === "unanimous" ? ["Handle [Y+].", "Handle [R+].", shared, "Handle [S+]."] : defaultBlock(step)) });
        const same = a.o.primary.join() === b.o.primary.join() && a.o.files!.key.items.map((i) => i.id + i.class + i.drop).join() === b.o.files!.key.items.map((i) => i.id + i.class + i.drop).join();
        const ff1 = firstFound([{ id: ID.A, edges: [1] }, { id: ID.H, edges: [1] }]);
        const ff2 = firstFound([{ id: ID.H, edges: [1] }, { id: ID.A, edges: [1] }]);
        return want(same && item(a.o, "H").drop === "not-unanimous" && ff1.join() !== ff2.join(), brief(a.o) + " / " + brief(b.o));
      },
    },
    // ---- K6: rewrites
    {
      rule: "K6",
      name: "a step 3 failure sends the unit back once with a note naming the failed checks; the rewrite voids every earlier result",
      check: async () => {
        const { o, w } = await unit({ author: () => authorReply({ plan: "# Payments\n\nDate: 2026-10-20\n\nA short plan.\n" }) });
        const note = w.requests.find((r) => r.label.startsWith("u1:rewrite"))?.prompt ?? "";
        return want(o.status === "pass" && o.rewrites === 1 && o.log[0]!.void && !o.log.at(-1)!.void && note.includes("- plan-words: plan.md has"), brief(o));
      },
    },
    {
      rule: "K6",
      name: "the context writer reruns after a rewrite only when plan.md or the evidence file list changed",
      check: async () => {
        const fail0 = (r: string, a: string) => (r === "audit-0" && a === "opus" ? { inputFailures: ["dated-after-plan"] } : {});
        const same = await unit({ audit: fail0 });
        const changed = await unit({ audit: fail0, rewrite: () => authorReply({ plan: PLAN + "\nOwners will get a one-line note in the weekly email.\n" }) });
        return want(same.o.status === "pass" && same.w.count("context") === 1 && changed.o.status === "pass" && changed.w.count("context") === 2, "context calls " + same.w.count("context") + " and " + changed.w.count("context"));
      },
    },
    {
      rule: "K6",
      name: "one rewrite in all: a step 3 failure then an audit input failure drops the unit",
      check: async () => {
        const { o } = await unit({ author: () => authorReply({ plan: "# Payments\n\nToo short.\n" }), audit: (_r, a) => (a === "opus" ? { inputFailures: ["method-wording"] } : {}) });
        return want(o.status === "drop" && o.step === "audit" && o.rewrites === 1, brief(o));
      },
    },
    // ---- step 3: the structure and vocabulary screen
    {
      rule: "SR5",
      name: "vocabulary screen at four and five shared words: four pass, five fail",
      check: () => {
        const vocab = vocabularyFrom(["the ledger sync banner warns clerks early"]);
        const u = baseFiles();
        u.plan = PLAN + "\nThe ledger sync banner stays.\n";
        const four = screenUnit(u, FIXTURE_APP, { vocabulary: vocab, today: "2026-11-01" });
        u.plan = PLAN + "\nThe ledger sync banner warns us.\n";
        const five = screenUnit(u, FIXTURE_APP, { vocabulary: vocab, today: "2026-11-01" });
        return want(four.pass && !five.pass && five.failures.every((f) => f.check === "vocabulary"), JSON.stringify(five.failures));
      },
    },
    {
      rule: "SR5",
      name: "vocabulary screen on each pass name and each barred word, in any case and with punctuation",
      check: () => {
        const terms = ["Information Architecture", "interaction state coverage", "USER JOURNEY", "Emotional Arc", "AI Slop", "Design System Alignment", "Responsive & Accessibility", "Unresolved Design Decisions", "gstack", "plan-design-review", "autoplan", "office-hours"];
        const missed = terms.filter((t) => {
          const u = baseFiles();
          u.evidence[0]!.text += "\nA note on " + t + ".\n";
          return screenUnit(u, FIXTURE_APP, { vocabulary: STAND_IN_VOCABULARY, today: "2026-11-01" }).failures.every((f) => f.check !== "vocabulary");
        });
        return want(missed.length === 0, "missed " + missed.join(", "));
      },
    },
    {
      rule: "SR5",
      name: "step 3 fails a Y item citing a missing file, an evidence path that exists, one with an instruction-file name, a date after the plan and a name-shaped string",
      check: () => {
        const o = { vocabulary: STAND_IN_VOCABULARY, today: "2026-11-01" };
        const checkOf = (f: (u: UnitFiles) => void) => {
          const u = baseFiles();
          f(u);
          return screenUnit(u, FIXTURE_APP, o).failures.map((x) => x.check);
        };
        const y = checkOf((u) => (u.key.items.find((i) => i.class === "Y")!.evidence = [{ file: "docs/design/2026-06-table-notes.md", line: 5 }, { file: "src/components/Missing.tsx", line: 1 }]));
        const exists = checkOf((u) => (u.evidence[0]!.path = "docs/ARCHITECTURE.md"));
        const instr = checkOf((u) => (u.evidence[0]!.path = "docs/.claude/notes.md"));
        const agents = checkOf((u) => (u.evidence[0]!.path = "docs/AGENTS.md"));
        const date = checkOf((u) => (u.evidence[1]!.text += "\nUpdated on November 3, 2026.\n"));
        const name = checkOf((u) => (u.evidence[1]!.text += "\nNotes taken by Priya Raman.\n"));
        const email = checkOf((u) => (u.plan += "\nQuestions to ops@tallyhall.example.\n"));
        const ok = y.includes("y-file") && y.includes("pointers") && exists.includes("evidence-paths") && instr.includes("evidence-paths") && agents.includes("evidence-paths") && date.includes("dates") && name.includes("names") && email.includes("names");
        return want(ok, JSON.stringify({ y, exists, instr, agents, date, name, email }));
      },
    },
    // ---- K7, R2-16 and M10: the 2x tier
    {
      rule: "K7",
      name: "the needle check passes a split detail and fails an unsplit one",
      check: () => {
        const base = baseFiles();
        const items = inheritIds(base.key.items, ITEMS_2X) as ReturnType<typeof intake>;
        const u2: UnitFiles = { ...base, evidence: EVIDENCE_2X, key: { items, wrongWay: WRONG_WAY, decoy: DECOY } };
        const split = screen2x(u2, items, FIXTURE_APP, { vocabulary: STAND_IN_VOCABULARY, today: "2026-11-01" });
        const un = structuredClone(u2);
        un.evidence[2]!.text += "\nBranch staff work on a portrait tablet at 800 by 1280 pixels.\n";
        const unsplit = screen2x(un, items, FIXTURE_APP, { vocabulary: STAND_IN_VOCABULARY, today: "2026-11-01" });
        return want(split.pass && unsplit.failures.some((f) => f.check === "needle" && f.detail.includes(un.evidence[2]!.path)), JSON.stringify(split.failures) + " / " + JSON.stringify(unsplit.failures));
      },
    },
    {
      rule: "K7",
      name: "a detail with no needle word left fails the 2x screen",
      check: () => {
        const base = baseFiles();
        const items = (inheritIds(base.key.items, ITEMS_2X) as ReturnType<typeof intake>).map((i) => (i.class === "H" ? { ...i, detail: "for the and of it" } : i));
        const u2: UnitFiles = { ...base, evidence: EVIDENCE_2X, key: { items, wrongWay: WRONG_WAY, decoy: DECOY } };
        const s = screen2x(u2, items, FIXTURE_APP, { vocabulary: STAND_IN_VOCABULARY, today: "2026-11-01" });
        return want(s.failures.some((f) => f.check === "needle" && f.detail.includes("no needle word")), JSON.stringify(s.failures));
      },
    },
    {
      rule: "K7",
      name: "a 2x key that reorders items inherits each base id by byte-identical statement",
      check: async () => {
        const { o } = await x2({ transform: () => transformReply({ items: [...ITEMS_2X].reverse() }) });
        const base = baseFiles().key.items.map((i) => i.id + i.class).join();
        return want(o.status === "pass" && o.files!.key.items.map((i) => i.id + i.class).join() === base && o.key.length === 5, o.status + " " + o.reason);
      },
    },
    {
      rule: "K7",
      name: "a 2x key that rewords a statement is refused at the 2x screen, rewritten once from the transform, and dropped on a second refusal without touching the base unit",
      check: async () => {
        const reworded = ITEMS_2X.map((i) => (i.class === "S" ? { ...i, statement: i.statement.replace("waits", "sits") } : i));
        let sent = 0;
        const once = await x2({ transform: () => (++sent === 1 ? transformReply({ items: reworded }) : transformReply()) });
        const twice = await x2({ transform: () => transformReply({ items: reworded }) });
        return want(once.o.status === "pass" && once.o.rewrites === 1 && twice.o.status === "drop" && twice.o.step === "screen" && twice.baseUnchanged && /byte for byte|matches 0/.test(twice.o.reason), once.o.reason + " / " + twice.o.reason);
      },
    },
    {
      rule: "K7",
      name: "an unsplit 2x version fails its screen twice and drops the 2x version, never the base unit",
      check: async () => {
        const { o, baseUnchanged } = await x2({ transform: () => transformReply({ evidence: EVIDENCE_2X.map((e, i) => (i === 2 ? { ...e, text: e.text + "\nBranch staff work on a portrait tablet at 800 by 1280 pixels.\n" } : e)) }) });
        return want(o.status === "drop" && o.step === "screen" && o.rewrites === 1 && baseUnchanged, o.status + " " + o.reason);
      },
    },
    {
      rule: "R2-16",
      name: "a fix verdict in the 2x audit drops the item from the 2x key",
      check: async () => {
        const { o, w } = await x2({ audit: (_r, a) => (a === "opus" ? { verdicts: { S: "fix" } } : {}) });
        return want(o.status === "pass" && !o.key.some((k) => k.id === ID.S) && o.key.length === 4 && w.count("fix") === 0, o.status + " " + o.reason);
      },
    },
    {
      rule: "K7",
      name: "the 2x version carries the give-away result and the generic screen: no give-away block or generic packet runs",
      check: async () => {
        const { o, w } = await x2({});
        const gave = w.calls.filter((l) => l.includes("give-away") || l.includes(":generic:")).length;
        return want(o.status === "pass" && gave === 0 && w.count("audit2x") === 2, "calls " + w.calls.length + ", give-away or generic " + gave);
      },
    },
    {
      rule: "K7",
      name: "fewer than 3 base primary items unanimous on the 2x evidence: the 2x version leaves the 2x read",
      check: async () => {
        const { o } = await x2({ block: (step, v) => (step === "unanimous-2x" && v === "sol" ? ["Handle [S+].", "Handle [H+]."] : defaultBlock(step)) });
        return want(o.status === "left" && o.step === "unanimous", o.status + " " + o.reason);
      },
    },
    {
      rule: "M10",
      name: "an item's detail is keyed for the 10x read only when all three 2x unanimous blocks carry it",
      check: async () => {
        const { o } = await x2({ block: (step, v) => (step === "unanimous-2x" && v === "sol" ? defaultBlock(step).map((c) => c.replace("[S+]", "[S]")) : defaultBlock(step)) });
        const keyed = o.key.filter((k) => k.detailKeyed).map((k) => k.class).sort().join("");
        return want(o.status === "pass" && o.key.length === 5 && keyed === "AHRY", "keyed " + keyed);
      },
    },
    // ---- K8: twins
    {
      rule: "K8",
      name: "a repairable second skin passes after its one rewrite, translated by the other family onto the next base app",
      check: async () => {
        const w = scripted({ author: () => authorReply({ plan: PLAN.replace("## Rollout", "## Rollout, as Priya Raman asked") }) });
        let seen: UnitOutcome | null = null;
        let target = "";
        const cal: CalibrationUnit[] = [{ unitId: "c1", position: 2, app: 1, kind: "k1", author: "argon", files: baseFiles("c1") }];
        const t = await sourceTwins(cal, [FIXTURE_APP, FIXTURE_APP_2], w.deps, async (j, d) => {
          target = j.app.label + " " + j.author;
          seen = await runUnit(j, d);
          return seen;
        });
        const s = seen as UnitOutcome | null;
        return want(t.passing === 1 && s !== null && s.rewrites === 1 && target === FIXTURE_APP.label + " sol" && t.pairs[0]!.second === "c1-t", JSON.stringify(t.pairs) + " " + target);
      },
    },
    {
      rule: "K8",
      name: "twin supply: stops at 8 passing pairs, tries at most 16, and the twin check runs only with 6 or more passing",
      check: async () => {
        const cal = Array.from({ length: 16 }, (_, i): CalibrationUnit => ({ unitId: "c" + (i + 1), position: i + 1, app: i, kind: "k1", author: "sol", files: baseFiles("c" + (i + 1)) }));
        const apps = Array.from({ length: 16 }, () => FIXTURE_APP);
        const stub = (passes: number) => async (j: UnitJob): Promise<UnitOutcome> => ({ unitId: j.unitId, status: Number(j.unitId.slice(1, -2)) <= passes ? "pass" : "drop", step: null, reason: "", files: null, primary: [], log: [], funnel: [], rewrites: 0, fixRounds: 0, droppedAtSecondAudit: [], calls: 0, record: { audits: [], generic: null, unanimous: null, giveAway: null } });
        const deps = scripted().deps;
        const all = await sourceTwins(cal, apps, deps, stub(16));
        const five = await sourceTwins(cal, apps, deps, stub(5));
        const six = await sourceTwins(cal, apps, deps, stub(6));
        const ok = all.tried === 8 && all.passing === 8 && five.tried === 16 && five.admission === "captain" && six.tried === 16 && six.passing === 6 && six.admission === "runs";
        return want(ok, [all, five, six].map((t) => t.tried + "/" + t.passing + "/" + t.admission).join(" "));
      },
    },
    // ---- K9: draws
    {
      rule: "K9",
      name: "kind order from seed 20261114: " + order.join(","),
      check: () => want(order.join(",") === "k5,k3,k6,k4,k2,k1", order.join(",")),
    },
    {
      rule: "K9",
      name: "draw rule at 16, 18 and 20 base apps: both families on every app over 2N positions, all six kinds per family per round",
      check: () => {
        const p = [16, 18, 20].map(drawRuleProblems);
        return want(p.every((x) => x === null), JSON.stringify(p));
      },
    },
    {
      rule: "K9",
      name: "the pilot is positions 1 to 4 and N+1 to N+4: the first 4 base apps, 2 each, kind indices 0 to 2; authors alternate by position",
      check: () => {
        const ps = pilotPositions(16);
        const ds = ps.map((p) => draw(p, 16));
        const apps = ds.map((d) => d.app).join();
        const ok = ps.join() === "1,2,3,4,17,18,19,20" && apps === "0,1,2,3,0,1,2,3" && ds.every((d) => d.kindIndex <= 2) && draw(1, 16).author === "sol" && draw(2, 16).author === "argon" && draw(17, 16).author === "argon";
        return want(ok, ps.join() + " apps " + apps);
      },
    },
    // ---- K10: the author input bundle
    {
      rule: "K10",
      name: "the bundle cuts the README at 30,000 bytes, the tree at 4,000 paths, design files at 60,000 in all and each screen at 30,000, each with a marker",
      check: () => {
        const files: Record<string, string> = { "README.md": "r".repeat(40000) };
        for (let i = 0; i < 4100; i++) files["src/f" + String(i).padStart(4, "0") + ".ts"] = "x";
        for (const d of ["a", "b", "c"]) files["src/theme/" + d + ".css"] = d.repeat(25000);
        const routes = ["src/pages/About.tsx", "src/pages/InvoiceListTable.tsx", "src/pages/list.tsx", "src/pages/Big.tsx", "src/pages/Table.tsx", "src/pages/x1.tsx", "src/pages/x2.tsx", "src/pages/x3.tsx"];
        for (const r of routes) files[r] = r.includes("Big") ? "b".repeat(31000) : "page";
        const app = appView("big", files, ["src/theme/a.css", "src/theme/b.css", "src/theme/c.css"], routes);
        const b = authorBundle(app, "k1");
        const ok = b.text.includes(cutMarker(30000)) && b.text.includes("[" + (b.treeTotal - 4000) + " more paths not shown]") && b.treeShown === 4000 && b.text.includes(cutMarker(10000)) && b.screens.length === 6 && b.screens[0] === "src/pages/InvoiceListTable.tsx";
        return want(ok, "screens " + b.screens.join(","));
      },
    },
    {
      rule: "K10",
      name: "screen files rank by the kind's noun words in the path, then size, then path",
      check: () => {
        const files: Record<string, string> = { "README.md": "", "src/pages/Settings.tsx": "aaaa", "src/pages/ProfileForm.tsx": "aa", "src/pages/FormSettings.tsx": "a", "src/pages/Zebra.tsx": "aaaaaaaa", "src/pages/Alpha.tsx": "aaaaaaaa" };
        const app = appView("rank", files, [], Object.keys(files).filter((p) => p.startsWith("src/")));
        const got = rankScreens(app, "k2").join(",");
        return want(got === "src/pages/FormSettings.tsx,src/pages/Settings.tsx,src/pages/ProfileForm.tsx,src/pages/Alpha.tsx,src/pages/Zebra.tsx", got);
      },
    },
    // ---- K11: sets
    {
      rule: "K11",
      name: "sets: calibration is the first passing unit on each of the first 16 apps; 64 comparison units, at most 4 an app; then 6 reserves",
      check: () => {
        const s = fillSets(Array.from({ length: 100 }, (_, i) => member(i + 1)).reverse());
        const perApp = new Map<number, number>();
        for (const m of s.comparison) perApp.set(m.app, (perApp.get(m.app) ?? 0) + 1);
        const ok = s.calibration.map((m) => m.position).join() === Array.from({ length: 16 }, (_, i) => i + 1).join() && s.comparison.length === 64 && Math.max(...perApp.values()) === 4 && s.reserve.map((m) => m.position).join() === "81,82,83,84,85,86";
        return want(ok, s.calibration.length + " " + s.comparison.length + " " + s.reserve.map((m) => m.position));
      },
    },
    {
      rule: "K11",
      name: "a reserve replaces a dropped comparison unit only before any stage 2 session: same app first, else an app that then holds at most 4",
      check: () => {
        const s = fillSets(Array.from({ length: 100 }, (_, i) => member(i + 1)));
        const same = replaceDropped(s, "p21", new Set());
        const other = replaceDropped(s, "p17", new Set());
        const late = replaceDropped(s, "p21", new Set(["p21"]));
        return want(same.replacedBy === "p81" && other.replacedBy === "p81" && /at most 4/.test(other.reason) && late.replacedBy === null, [same.replacedBy, other.replacedBy, other.reason, late.reason].join(" / "));
      },
    },
    // ---- K12 and start rule 12: the pilot stop and the re-projection
    {
      rule: "K12",
      name: "the pilot stop at $10.00 and $10.01 a passing unit, settled, in-flight and unknown spend all counted",
      check: () => {
        const at10 = pilotCost({ settledUsd: 60, inFlightUsd: 10, unknownUsd: 10 }, 8);
        const at1001 = { settledUsd: 50, inFlightUsd: 0, unknownUsd: 0.05 };
        const ok = !at10.stop && at10.perPassingUsd === 10 && throwsCode(() => checkPilot(at1001, 5), "E_DC_AUTHOR_COST") && !pilotCost({ settledUsd: 50, inFlightUsd: 0, unknownUsd: 0 }, 5).stop;
        return want(ok, JSON.stringify(at10));
      },
    },
    {
      rule: "K12",
      name: "a pilot with no passing unit reads infinite and stops",
      check: () => want(pilotCost({ settledUsd: 3, inFlightUsd: 0, unknownUsd: 0 }, 0).perPassingUsd === Infinity && throwsCode(() => checkPilot({ settledUsd: 3, inFlightUsd: 0, unknownUsd: 0 }, 0), "E_DC_AUTHOR_COST"), "no stop"),
    },
    {
      rule: "SR12",
      name: "the re-sizing at 64, 56 and 47 projected comparison units: 64 and 56 run, 47 stops with E_DC_SUPPLY_SHORT",
      check: () => {
        const zero = { settledUsd: 0, inFlightUsd: 0, unknownUsd: 0 };
        const at = (spent: number, unknown = 0) => reproject({ perPassingUsd: 5, spend1: zero, spend2: { settledUsd: spent, inFlightUsd: 0, unknownUsd: unknown }, calibrationNeeded: 12, x2Usd: 1.4, x2Needed: 16, twinTries: 16 });
        const a = at(0);
        const b = at(40, 10);
        const ok = a.comparison === 64 && a.reserves === 2 && b.comparison === 56 && throwsCode(() => at(95), "E_DC_SUPPLY_SHORT");
        return want(ok, a.comparison + " " + b.comparison);
      },
    },
    {
      rule: "K12",
      name: "the pilot runs positions 1 to 4 and N+1 to N+4 end to end, prints its funnel and kind rates, and stops above $10.00 a passing unit",
      check: async () => {
        const apps = [FIXTURE_APP, FIXTURE_APP_2, FIXTURE_APP, FIXTURE_APP_2];
        const spend = (usd: number) => () => ({ settledUsd: usd, inFlightUsd: 0, unknownUsd: 0 });
        const ok = await runPilot(apps, scripted().deps, spend(80));
        let seen: PilotReport | null = null;
        const stopped = await runPilot(apps, scripted().deps, spend(80.08), (r) => (seen = r)).then(() => false, (e) => e instanceof DcError && e.code === "E_DC_AUTHOR_COST");
        const s = seen as PilotReport | null;
        return want(ok.outcomes.length === 8 && ok.cost.perPassingUsd === 10 && ok.draws.map((d) => d.app).join() === "0,1,2,3,0,1,2,3" && ok.funnel.find((f) => f.step === "unanimous")!.units === 8 && stopped && s !== null && s.cost.perPassingUsd === 10.01, "per passing " + ok.cost.perPassingUsd);
      },
    },
    {
      rule: "M14",
      name: "key construction counts the credits a tie-break decided, per class and step",
      check: async () => {
        const { o } = await unit({ block: (step) => (step === "unanimous" ? ["One change on the [A][H] rows.", "Handle [S+].", "Handle [R+].", "Handle [Y+]."] : defaultBlock(step)) });
        const row = o.funnel.find((f) => f.step === "unanimous")!;
        return want(o.record.unanimous!.blocks.every((b) => b.tieDecided.join() === ID.A) && row.tieDecided.join() === "A,A,A", JSON.stringify(row));
      },
    },
    // ---- section 16: the gate check
    {
      rule: "GATE",
      name: "keyless half: a fixture unit obeying every authoring rule passes every keyless gate",
      check: () => {
        const f = keylessGates({ unitId: "u1", raw: ITEMS, files: baseFiles(), x2: { evidence: EVIDENCE_2X, raw: ITEMS_2X, decoy: DECOY }, app: FIXTURE_APP, vocabulary: STAND_IN_VOCABULARY, today: "2026-11-01" });
        return want(f.length === 0, f.join("; "));
      },
    },
    {
      rule: "GATE",
      name: "the runner reads every gate on all eight planted cases and passes when each listed expectation holds",
      check: async () => {
        const { units, deps } = planted();
        const r = await runGateCheck(units, deps, tableOf(units));
        const bad = r.results.filter((x) => !x.ok);
        return want(r.ok && r.results.length === 18 && r.readings.length === 8, bad.map((x) => x.name + " " + x.expectation.is + " " + x.detail).join("; "));
      },
    },
    {
      rule: "GATE",
      name: "a wrong verdict on a planted case stops authoring with E_DC_GATE_CHECK",
      check: async () => {
        const { units, deps } = planted({ B4: {} });
        try {
          await enforceGateCheck(units, deps, tableOf(units));
          return "no stop";
        } catch (e) {
          return want(e instanceof DcError && e.code === "E_DC_GATE_CHECK" && e.message.includes("B4 unanimous"), String(e));
        }
      },
    },
    {
      rule: "GATE",
      name: "PD-21: a planted drop item an auditor marks fix counts as caught when the second audit keeps it changed, and the reading records the fix",
      check: async () => {
        const fixThenKeep: Script = { audit: (round, a) => (round.startsWith("audit2") || a !== "opus" ? {} : { verdicts: { S: "fix" } }), fix: (ids) => JSON.stringify({ items: ids.map((id) => ({ id, statement: "A rewritten statement for " + id, detail: SUPPORTED })) }) };
        const { units, deps } = planted({ B2: fixThenKeep });
        const r = await runGateCheck(units, deps, tableOf(units));
        const b2 = r.results.find((x) => x.name === "B2")!;
        const fix = r.readings.find((x) => x.name === "B2")!.fix;
        return want(r.ok && b2.ok && b2.detail.includes("caught: marked fix") && fix !== null && !fix.unchanged && fix.audit2 !== null, b2.detail);
      },
    },
    {
      rule: "GATE",
      name: "PD-21: an auditor saying fix while the planted item survives unchanged, or marked fix again, is a miss and stops authoring with E_DC_GATE_CHECK",
      check: async () => {
        const base = planted();
        const s = base.units.find((u) => u.name === "B2")!.files.key.items.find((i) => i.class === "S")!;
        const same: Script = { audit: (round, a) => (round.startsWith("audit2") || a !== "opus" ? {} : { verdicts: { S: "fix" } }), fix: (ids) => JSON.stringify({ items: ids.map((id) => ({ id, statement: s.statement, detail: s.detail })) }) };
        const again: Script = { audit: (_round, a) => (a !== "opus" ? {} : { verdicts: { S: "fix" } }) };
        const out: string[] = [];
        for (const [label, script, why] of [["unchanged", same, "left it as planted"], ["fix again", again, "the second audit: opus fix"]] as const) {
          const { units, deps } = planted({ B2: script });
          try {
            await enforceGateCheck(units, deps, tableOf(units));
            out.push(label + ": no stop");
          } catch (e) {
            if (!(e instanceof DcError && e.code === "E_DC_GATE_CHECK" && e.message.includes("B2 audit") && e.message.includes(why))) out.push(label + ": " + String(e));
          }
        }
        return want(out.length === 0, out.join("; "));
      },
    },
    {
      rule: "PD-35",
      name: "B2-style: a fix that rewrites the item but leaves its cited evidence line holding no word of its detail is a miss with E_DC_GATE_CHECK; a fix whose detail the line supports is caught; the report prints the text before and after",
      check: async () => {
        const out: string[] = [];
        const s = plantedFiles("B2").key.items.find((i) => i.class === PLANTED.B2.cls)!;
        const stopped = await gateStop(planted({ B2: fixThenKeep("S", s.statement.replace("clerks reload", "clerks often reload"), s.detail) }));
        if (!stopped.includes("B2 audit") || !stopped.includes("left the planted defect") || !stopped.includes("hold no word of its detail")) out.push("reworded: " + stopped);
        if (!stopped.includes("before the fix " + JSON.stringify(s.statement)) || !stopped.includes("clerks often reload")) out.push("reworded, no before and after text: " + stopped);
        const { units, deps } = planted({ B2: fixThenKeep("S", s.statement, SUPPORTED) });
        const r = await runGateCheck(units, deps, tableOf(units));
        const b2 = r.results.find((x) => x.name === "B2")!;
        const fx = r.readings.find((x) => x.name === "B2")!.fix;
        if (!(r.ok && b2.detail.includes("defect gone") && fx?.defect?.before !== null && fx?.defect?.after === null && fx?.screen?.pass)) out.push("real fix: " + b2.detail);
        return want(out.length === 0, out.join("; "));
      },
    },
    {
      rule: "PD-35",
      name: "B6-style: a fix that rewrites the Y item but still names a component its cited file doesn't hold is a miss with E_DC_GATE_CHECK; a fix naming the cited file's component is caught",
      check: async () => {
        const out: string[] = [];
        const y = plantedFiles("B6").key.items.find((i) => i.class === PLANTED.B6.cls)!;
        const stopped = await gateStop(planted({ B6: fixThenKeep("Y", y.statement.replace("needs sortable", "needs fully sortable"), y.detail) }));
        if (!stopped.includes("B6 audit") || !stopped.includes("left the planted defect") || !stopped.includes("names StatusPill")) out.push("reworded: " + stopped);
        const { units, deps } = planted({ B6: fixThenKeep("Y", y.statement.replace("shared StatusPill in", "shared DataTable in"), y.detail) });
        const r = await runGateCheck(units, deps, tableOf(units));
        const b6 = r.results.find((x) => x.name === "B6")!;
        const fx = r.readings.find((x) => x.name === "B6")!.fix;
        if (!(r.ok && b6.detail.includes("defect gone") && fx?.defect?.check === "component" && fx.defect.before !== null && fx.defect.after === null)) out.push("real fix: " + b6.detail);
        return want(out.length === 0, out.join("; "));
      },
    },
    {
      rule: "PD-35",
      name: "a fixed unit that fails step 3's re-screen is a miss with E_DC_GATE_CHECK, even with the defect gone, and its second audit never runs",
      check: async () => {
        const s = plantedFiles("B2").key.items.find((i) => i.class === PLANTED.B2.cls)!;
        const long = s.statement + " " + Array.from({ length: 30 }, () => "today").join(" ");
        const { units, deps } = planted({ B2: fixThenKeep("S", long, SUPPORTED) });
        const r = await runGateCheck(units, deps, tableOf(units));
        const fx = r.readings.find((x) => x.name === "B2")!.fix;
        const stopped = await gateStop(planted({ B2: fixThenKeep("S", long, SUPPORTED) }));
        return want(fx?.screen?.pass === false && fx.audit2 === null && fx.defect?.after === null && stopped.includes("fails step 3: statement-words"), stopped);
      },
    },
    // ---- section 2 items PD-29 accepted with code
    {
      rule: "PD-29",
      name: "section 2 item 7: a passing unit whose key.json holds fewer than two wrong-way facts says so in its reason and is counted; the fixture's two facts print nothing",
      check: async () => {
        const one = "Here is the case.\n\n" + JSON.stringify({ plan: PLAN, evidence: EVIDENCE, key: { items: ITEMS, mentioned: [], wrong_way: WRONG_WAY.slice(0, 1) } });
        const { o: short } = await unit({ author: () => one });
        const { o: full } = await unit({});
        return want(short.status === "pass" && short.reason.endsWith("key.json holds 1 wrong-way facts, fewer than two") && wrongWayShort([short, full]).join() === "u1" && full.status === "pass" && !full.reason.includes("wrong-way"), brief(short) + " | " + brief(full));
      },
    },
    {
      rule: "PD-29",
      name: "section 2 item 8: each 2x outcome prints its renamed paths and the evidence's change in words, naming a file past 10%; the fixture's transform keeps every path and grows its support summary past 10%",
      check: async () => {
        const support = EVIDENCE_2X.find((e) => e.path.includes("support"))!.path;
        const releases = EVIDENCE_2X.find((e) => e.path.includes("releases"))!.path;
        const evidence = EVIDENCE_2X.map((e) => (e.path === support ? { ...e, path: "docs/support/payments-tickets.md" } : e.path === releases ? { ...e, text: e.text + "\n" + Array.from({ length: 60 }, () => "filler").join(" ") + "\n" } : e));
        const moved = await x2({ transform: () => transformReply({ evidence }) });
        const kept = await x2({});
        const out: string[] = [];
        if (!moved.o.reason.includes("renamed paths: gone " + support + "; new docs/support/payments-tickets.md") || !moved.o.reason.includes("files past 10%: " + releases + " +")) out.push("moved: " + moved.o.reason);
        if (!kept.o.reason.includes("every evidence path kept; evidence words ") || !kept.o.reason.endsWith("files past 10%: " + support + " +14.8%")) out.push("kept: " + kept.o.reason);
        return want(out.length === 0, out.join("; "));
      },
    },
  ];
}
