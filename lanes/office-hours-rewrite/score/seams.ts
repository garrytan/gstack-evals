// Copyright (c) 2026 Garry Tan. MIT License.
// The score area's dry-run seams (prereg section 12 stage 1: a dry run that drives every frozen rule, and every gate on
// planted known-good and known-bad cases). Each rule gets two seams: "holds", a planted case the rule credits or lets
// through, and "breaks", a planted case it must refuse, cut, score 0 or fail. They run the real parser, packets, judge
// client path (with the stub judge in fixtures.ts in place of any model), judge check, scorer and detectors, keyless and
// fast. Sections driven: 5 (parser, packets, judges, R1 to R3), 7 (kept whole, startup-only), 8 (failure table),
// 10 (G1 to G3), 11 (compliance), 12 (exposure, judge check) and pre-run change 1 (delivered replies, item 4f).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED, STOCK_ROWS } from "../frozen.ts";
import type { Seam, SessionRow } from "../types.ts";
import { parseBlock, renderBlock } from "./block.ts";
import { judgeCheck } from "./check.ts";
import { compliance, datedAndNumbered, exposure, founderReplies, keptWhole, loadCompliance, loadMarkers, markersFrom, questionsAsked, startupOnly } from "./detect.ts";
import { BRIEFS, allRows, block, blockOf, checkInput, faithful, row, stateRoot, stubCaller, transcript, turn, type Says } from "./fixtures.ts";
import { judgePackets, labeller } from "./judge.ts";
import { assertUnique, buildCheckPackets, buildLabelPackets, itemsOf, writePackets, type Built } from "./packets.ts";
import { r1, scoreSessions } from "./score.ts";

type Outcome = boolean | Promise<boolean>;
const seam = (rule: string, side: "holds" | "breaks", name: string, f: () => Outcome): Seam => ({
  name: "score: " + rule + " | " + side + ": " + name,
  run: async () => {
    try {
      const ok = await f();
      return { ok, detail: ok ? side + " as frozen" : "the planted case did not come out as the rule says" };
    } catch (e) {
      return { ok: false, detail: "threw: " + (e as Error).message };
    }
  },
});
const pair = (rule: string, holds: [string, () => Outcome], breaks: [string, () => Outcome]): Seam[] => [seam(rule, "holds", ...holds), seam(rule, "breaks", ...breaks)];
const throws = (f: () => unknown, code: string): boolean => {
  try {
    f();
    return false;
  } catch (e) {
    return (e as Error).message.startsWith(code + " ");
  }
};
const temp = <T>(f: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "ohr-seam-"));
  try {
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const withRoot = <T>(files: Record<string, string>, f: (root: string) => T): T => {
  const r = stateRoot(files);
  try {
    return f(r);
  } finally {
    rmSync(r, { recursive: true, force: true });
  }
};

const label = (rows: SessionRow[], seed = SEED, taken: Built[] = []) => buildLabelPackets({ stage: 1, seed, briefs: BRIEFS, rows, taken: taken.map((b) => b.map) });
async function score(rows: SessionRow[], call = stubCaller()) {
  const built = label(rows);
  const { labels } = await judgePackets({ map: built.map, packets: new Map(built.packets.map((p) => [p.id, p])), call, effort: "medium" });
  return scoreSessions({ rows, briefs: BRIEFS, maps: [built.map], labels });
}
const key = (id: string) => BRIEFS.get(id)!.key;
const D = (t: ReturnType<typeof turn>, delivered = true) => ({ ...t, delivered });
const words = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
const flip = (n: number, kind = "session"): Says => (b, i, k) => (k === kind && i < n ? [i % 2 !== 0, i % 2 !== 0] : faithful(b, i, k));
const verdict = (o: Parameters<typeof checkInput>[0], says: Says = faithful) => judgeCheck(checkInput(o, says)).verdict;

const CUR = loadMarkers("current"), NEW = loadMarkers("new"), C = loadCompliance();
const SKILL_READ = { tool: "Read", input: { file_path: "/s/office-hours/SKILL.md" }, result: "x" };
const BUILDER_READ = { tool: "Read", input: { file_path: "/s/office-hours/sections/phase-2b-builder-brainstorm.md" }, result: "x" };
const Q1 = "What's the strongest evidence you have that someone actually wants this?";
const Q2 = "What are your users doing right now to solve this problem, even badly?";
const REALITY = "Has it produced one real outcome yet: one paying user, or one person who used it this week without being asked?";
const DESIGN = (mode: string, status: string, extra = "") => "# Design: X\nStatus: " + status + "\nMode: " + mode + "\n\n## The Assignment\nDo it.\n" + extra;
const turns3 = [D(turn(1)), D(turn(2)), D(turn(3))];
const exposedWith = (o: { t?: string; kind?: string | null; files?: Record<string, string> }) =>
  withRoot(o.files ?? { "projects/x/u-main-design-1.md": DESIGN("Startup", "APPROVED") }, (root) => exposure({ transcript: o.t ?? transcript([[SKILL_READ, Q1], [Q2], ["advice"]]), stateRoot: root, sessionKind: o.kind === undefined ? "interactive" : o.kind, turns: turns3, markers: CUR }).exposed);
const keptWith = (t: string, files = { "projects/m/u-main-design-1.md": DESIGN("Builder", "APPROVED") }, done = true) => withRoot(files, (root) => keptWhole({ transcript: t, stateRoot: root, founderDone: done, markers: NEW }).kept);
const comply = (o: { t?: string; files?: Record<string, string>; next?: string }) =>
  withRoot(o.files ?? {}, (root) => compliance({ transcript: o.t ?? transcript([["ok"]]), stateRoot: root, block: o.next ? block("a", o.next) : null, arm: "new", kind: "founder", markers: NEW, c: C }));
const commitment = { mode: "commitment", kill_date: "2026-12-01", kill_test: "two bakeries prepay" };

export const seams: Seam[] = [
  ...pair("block: all three labels make a block", ["DECISION, NEXT ACTION and WHY", () => parseBlock("DECISION: a\nNEXT ACTION: b\nWHY: c").kind === "block"], ["NEXT ACTION missing", () => parseBlock("DECISION: a\nWHY: c").kind === "no-block"]),
  ...pair("block: DECISION and NEXT ACTION are non-empty", ["WHY may be empty", () => parseBlock("DECISION: a\nNEXT ACTION: b\nWHY:").kind === "block"], ["an empty DECISION", () => parseBlock("DECISION: **\nNEXT ACTION: b\nWHY: c").kind === "no-block"]),
  ...pair("block: each line is cut at 40 words and the cut is recorded", ["40 words pass whole", () => {
    const p = parseBlock("DECISION: " + words(40) + "\nNEXT ACTION: b\nWHY: c");
    return p.kind === "block" && !p.cut.decision && p.block.decision === words(40);
  }], ["41 words are cut to 40", () => {
    const p = parseBlock("DECISION: " + words(41) + "\nNEXT ACTION: b\nWHY: c");
    return p.kind === "block" && p.cut.decision && p.block.decision === words(40);
  }]),
  ...pair("block: emphasis, list and quote marks and case are tolerated", ["> - **decision:** a / 1. Next Action: b / ### WHY: c", () => {
    const p = parseBlock("> - **decision:** a\n1. Next Action: b\n### WHY: c");
    return p.kind === "block" && p.block.decision === "a" && p.block.next_action === "b";
  }], ["a label in mid-line is not a label", () => parseBlock("My DECISION: a\nNEXT ACTION: b\nWHY: c").kind === "no-block"]),
  ...pair("block: the last of each label wins and a field runs to the next label", ["the later block is read", () => {
    const p = parseBlock("DECISION: old\nNEXT ACTION: old\nWHY: old\nDECISION: new\ncontinued\nNEXT ACTION: new\nWHY: new");
    return p.kind === "block" && p.block.decision === "new continued";
  }], ["a fence ends a field", () => {
    const p = parseBlock("DECISION: a\nNEXT ACTION: b\nWHY: c\n```\nnot why");
    return p.kind === "block" && p.block.why === "c";
  }]),
  ...pair("packets: one per (brief, model) with its arm blocks, three stock rows and one near-miss row", ["7 blocks a packet", () => {
    const b = label(allRows("opus"));
    return b.packets.length === 4 && b.packets.every((p) => p.blocks.length === 7 && STOCK_ROWS.every((s) => p.blocks.some((x) => x.block.decision === s.decision)));
  }], ["a brief with no block builds no packet", () => label(allRows("opus").map((r) => (r.brief === "a" ? { ...r, end: "no-block" as const, block: null } : r))).packets.length === 3]),
  ...pair("packets: the near-miss row is the twin's call or the key's wrong call", ["paired and unpaired contrasts", () => itemsOf("a", BRIEFS).contrast === key("b").call && itemsOf("c", BRIEFS).contrast === key("c").wrong_call], ["an unpaired brief with no wrong call is refused", () => throws(() => itemsOf("c", new Map([["c", { ...BRIEFS.get("c")!, key: { ...key("c"), wrong_call: null } }]])), "E_OHR_PACKET_INPUT")]),
  ...pair("packets: blind, no sheet, opening, fact id, brief id, arm or transcript", ["a built packet carries only id, items and blocks", () => {
    const text = JSON.stringify(label(allRows("opus")).packets);
    return !/"(?:arm|brief|model|transcript|sheet|opening|decisive)"/.test(text) && ![...BRIEFS.values()].some((b) => b.key.decisive.some((f) => text.includes(f)));
  }], ["the arm and brief live only in the map", () => {
    const b = label(allRows("opus"));
    return Object.values(b.map.packets).every((m) => Object.values(m.blocks).some((r) => r.kind === "session" && r.session.arm === "new"));
  }]),
  ...pair("packets: seeded ids and order", ["the same seed builds the same packets", () => JSON.stringify(label(allRows("opus"))) === JSON.stringify(label(allRows("opus")))], ["another seed builds other ids", () => label(allRows("opus"), SEED + 1).packets[0]!.id !== label(allRows("opus")).packets[0]!.id]),
  ...pair("packets: ids unique across every map", ["a check build skips the label map's ids", () => {
    const l = label(allRows("opus"));
    assertUnique([l.map, buildCheckPackets({ seed: SEED, briefs: BRIEFS, rows: allRows("opus"), answers: [], taken: [l.map] }).map]);
    return true;
  }], ["the same build twice clashes", () => throws(() => assertUnique([label(allRows("opus")).map, label(allRows("opus")).map]), "E_OHR_ID_CLASH")]),
  ...pair("packets: the map lives outside the packets folder", ["a sibling map is written", () => temp((d) => (writePackets(label(allRows("opus")), join(d, "p"), join(d, "map.json")), true))], ["a map inside the folder is refused", () => temp((d) => throws(() => writePackets(label(allRows("opus")), join(d, "p"), join(d, "p", "map.json")), "E_OHR_PACKET_INPUT"))]),
  ...pair("judge: routed by frozen.JUDGE_FOR", ["Opus blocks go to Astra, Sol blocks to Opus", async () => {
    const b = label([...allRows("opus"), ...allRows("sol")]);
    const { labels } = await judgePackets({ map: b.map, packets: new Map(b.packets.map((p) => [p.id, p])), call: stubCaller(), effort: "medium" });
    return labels.every((l) => l.judge === (b.map.packets[l.packet]!.model === "opus" ? "astra" : "opus"));
  }], ["the scorer refuses a label from the other judge", async () => {
    const rows = [row({ brief: "a" })];
    const b = label(rows);
    const { labels } = await judgePackets({ map: b.map, packets: new Map(b.packets.map((p) => [p.id, p])), call: stubCaller(), effort: "medium" });
    return throws(() => scoreSessions({ rows, briefs: BRIEFS, maps: [b.map], labels: labels.map((l) => ({ ...l, judge: "opus" as const })) }), "E_OHR_SCORE_INPUT");
  }]),
  ...pair("judge: medium effort in production, max only on a check map", ["a label map runs at medium", async () => {
    const b = label(allRows("opus"));
    return (await judgePackets({ map: b.map, packets: new Map(b.packets.map((p) => [p.id, p])), call: stubCaller(), effort: "medium" })).labels.length > 0;
  }], ["a label map at max is refused", async () => {
    const b = label(allRows("opus"));
    return judgePackets({ map: b.map, packets: new Map(b.packets.map((p) => [p.id, p])), call: stubCaller(), effort: "max" }).then(() => false, (e) => (e as Error).message.startsWith("E_OHR_JUDGE_INPUT "));
  }]),
  ...pair("judge: one resend of a packet with a missing cell, then null", ["a garbled first answer is resent and labelled", async () => {
    const call = stubCaller({ garble: 1 });
    const out = await labeller(call)({ judge: "astra", brief: "a", items: itemsOf("a", BRIEFS), blocks: [{ id: "k", block: blockOf(key("a").call, key("a").actions[0]!).block }], effort: "medium", label: "s" });
    return call.calls === 2 && out.get("k")?.decision === true && out.get("k")?.action === true;
  }], ["two garbled answers leave it null after exactly two calls", async () => {
    const call = stubCaller({ garble: 2 });
    const out = await labeller(call)({ judge: "astra", brief: "a", items: itemsOf("a", BRIEFS), blocks: [{ id: "k", block: block("x", "y") }], effort: "medium", label: "s" });
    return call.calls === 2 && out.get("k") === null;
  }]),
  ...pair("judge check: kappa of at least 0.6 overall", ["a faithful judge passes", () => verdict({ session: 40, near: 4, stock: 3 }) === "PASS"], ["12 flipped blocks fail", () => verdict({ session: 40, near: 4, stock: 3 }, flip(12)) === "FAIL"]),
  ...pair("judge check: kappa of at least 0.6 on real session blocks", ["faithful on sessions passes", () => verdict({ session: 20, answer: 40, near: 4, stock: 3 }) === "PASS"], ["flipped sessions fail while overall kappa holds", () => {
    const r = judgeCheck(checkInput({ session: 20, answer: 40, near: 4, stock: 3 }, flip(7)));
    return r.verdict === "FAIL" && r.kappa! >= 0.6 && r.kappa_real! < 0.6;
  }]),
  ...pair("judge check: each kappa needs 10 gold cells of each class", ["20 of each class reads", () => verdict({ session: 40, near: 12, stock: 3 }) === "PASS"], ["8 real blocks read NO READ", () => verdict({ session: 8, answer: 40, near: 4, stock: 3 }) === "NO READ"]),
  ...pair("judge check: at least 40 outputs from 40 blocks", ["40 session blocks read", () => verdict({ session: 40, near: 4, stock: 3 }) === "PASS"], ["19 session blocks read NO READ", () => verdict({ session: 19, near: 4, stock: 3 }) === "NO READ"]),
  ...pair("judge check: unlabelled cells count against the judge", ["a fully labelled judge passes", () => judgeCheck(checkInput({ session: 40, near: 4, stock: 3 }, faithful)).unlabelled === 0], ["12 unlabelled blocks stay in and fail", () => {
    const r = judgeCheck(checkInput({ session: 40, near: 4, stock: 3 }, (b, i, k) => (k === "session" && i < 12 ? [null, null] : faithful(b, i, k))));
    return r.verdict === "FAIL" && r.outputs === 84;
  }]),
  ...pair("judge check: near-miss accuracy of at least 0.8", ["4 of 5 right passes", () => verdict({ session: 40, near: 5, stock: 3 }, (b, i, k) => (k === "near" && i === 0 ? [true, false] : faithful(b, i, k))) === "PASS"], ["3 of 5 right fails", () => verdict({ session: 40, near: 5, stock: 3 }, (b, i, k) => (k === "near" && i < 2 ? [true, false] : faithful(b, i, k))) === "FAIL"]),
  ...pair("judge check: no stock row credited", ["clean stock rows pass", () => verdict({ session: 40, near: 4, stock: 3 }) === "PASS"], ["one credited stock row fails", () => verdict({ session: 40, near: 4, stock: 3 }, (b, i, k) => (k === "stock" && i === 0 ? [true, false] : faithful(b, i, k))) === "FAIL"]),
  ...pair("judge check: a stock check with zero stock rows fails", ["three stock rows read", () => judgeCheck(checkInput({ session: 40, near: 4, stock: 3 }, faithful)).stock_rows === 3], ["no stock rows fails", () => verdict({ session: 40, near: 4, stock: 0 }) === "FAIL"]),
  ...pair("judge check: anchors at most half the credited gold", ["10 oracles all count", () => judgeCheck(checkInput({ session: 40, oracle: 10, near: 4, stock: 3 }, faithful)).anchors_credited === 20], ["30 oracles are capped at the other credited cells", () => {
    const r = judgeCheck(checkInput({ session: 40, oracle: 30, near: 4, stock: 3 }, faithful));
    return r.anchors_credited === 40 && r.credited === 80;
  }]),
  ...pair("R1: a decisive fact in a delivered founder reply", ["revealed in a delivered reply", () => r1([D(turn(1, ["fa1"]))], key("a")) === 1], ["only in a reply the closing message replaced", () => r1([D(turn(1)), D(turn(2, ["fa1"]), false)], key("a")) === 0]),
  ...pair("R1: a rejected draw never counts", ["the delivered redraw reveals it", () => r1([D(turn(1), false), D(turn(1, ["fa1"]))], key("a")) === 1], ["only the rejected draw reveals it", () => r1([D({ ...turn(1, ["fa1"]), attempts: 2 }, false), D(turn(1))], key("a")) === 0]),
  ...pair("R: R1 and R2 and R3", ["the key's call and action score R = 1", async () => (await score([row({ brief: "a", arm: "new" })]))[0]!.R === 1], ["the twin's call scores R2 = 0 and R = 0", async () => {
    const s = (await score([row({ brief: "a", arm: "new", block: blockOf(key("b").call, key("a").actions[0]!) })]))[0]!;
    return s.R2 === 0 && s.R === 0;
  }]),
  ...pair("R3: a stock action does not count", ["an acceptable action class counts", async () => (await score([row({ brief: "c" })]))[0]!.R3 === 1], ["a stock action scores R3 = 0", async () => (await score([row({ brief: "c", block: blockOf(key("c").call, "Talk to more customers this month.") })]))[0]!.R3 === 0]),
  ...pair("builder right call: scored like R against the builder key", ["the build-first call scores 1", async () => (await score([row({ brief: "d" })]))[0]!.R === 1], ["the builder's wrong call scores 0", async () => (await score([row({ brief: "d", block: blockOf(key("d").wrong_call!, key("d").actions[0]!) })]))[0]!.R === 0]),
  ...pair("failure table: R = 0 events and missing events", ["a safety stop scores R = 0", async () => (await score([row({ brief: "a", end: "safety-stop", block: null })]))[0]!.R === 0], ["a missing session scores null", async () => {
    const s = (await score([row({ brief: "a", end: "missing", block: null })]))[0]!;
    return s.R === null && s.R1 === null;
  }]),
  ...pair("exposure: two questions one at a time, each answered", ["Q1 then Q2 in two replies", () => exposedWith({})], ["Q1 and Q2 in one reply", () => !exposedWith({ t: transcript([[SKILL_READ, Q1 + "\n" + Q2], ["advice"]]) })]),
  ...pair("exposure: read the skill file and printed SESSION_KIND: interactive", ["interactive", () => exposedWith({})], ["unattended", () => !exposedWith({ kind: "unattended" })]),
  ...pair("exposure: the deliverable written to the state root", ["a design doc", () => exposedWith({})], ["nothing written", () => !exposedWith({ files: {} })]),
  ...pair("kept whole: builder mode, no startup question, approved builder doc, before the cap", ["all four hold", () => keptWith(transcript([[SKILL_READ, BUILDER_READ, "What's the coolest version of this?"], ["doc"]]))], ["a draft doc", () => !keptWith(transcript([[SKILL_READ, BUILDER_READ, "What's the coolest version of this?"], ["doc"]]), { "projects/m/u-main-design-1.md": DESIGN("Builder", "DRAFT") })]),
  ...pair("kept whole: done before the reply cap", ["the founder set done", () => keptWith(transcript([[BUILDER_READ, "Who would you show this to?"], ["doc"]]))], ["the cap sent the closing", () => !keptWith(transcript([[BUILDER_READ, "Who would you show this to?"], ["doc"]]), undefined, false)]),
  ...pair("G1: startup-only questions in a builder session", ["generative questions only", () => startupOnly(transcript([["What's the coolest version of this?"], ["Who would you show this to?"]]), NEW).length === 0], ["the reality check is found", () => startupOnly(transcript([[REALITY]]), NEW).includes("reality-check")]),
  ...pair("G2: questions asked, the closing replies left out", ["two questions before the closing", () => questionsAsked(transcript([["Who pays?"], ["How much?"], ["DECISION: a\nNEXT ACTION: b\nWHY: c\nOk?"]]), 1) === 2], ["a question only in the closing reply counts 0", () => questionsAsked(transcript([["Fine."], ["DECISION: a\nNEXT ACTION: b\nWHY: c\nOk?"]]), 1) === 0]),
  ...pair("G3: founder replies before the closing message", ["delivered replies count", () => founderReplies(turns3) === 3], ["a replaced reply and a rejected draw do not", () => founderReplies([D(turn(1)), D(turn(2), false), D({ ...turn(2), attempts: 2 }, false)]) === 1]),
  ...pair("compliance: an action with a date and a number", ["3 buyers by Friday", () => datedAndNumbered("Send a priced payment link to the warmest 3 buyers by Friday", C)], ["a date with no number outside it", () => !datedAndNumbered("Email the buyer by 2026-11-20", C)]),
  ...pair("compliance: a kill line", ["a KILL/CONTINUE line in the memo", () => comply({ files: { "projects/x/u-main-memo-1.md": "# Decision memo\n## KILL/CONTINUE\nBy Dec 1, if no one pays, change direction.\n" } }).kill_line], ["no kill line", () => !comply({ t: transcript([["Kill it if it fails."]]) }).kill_line]),
  ...pair("compliance: no code written", ["a markdown doc is not code", () => !comply({ t: transcript([[{ tool: "Write", input: { file_path: "/w/docs/x.md" } }]]) }).wrote_code], ["a TypeScript file is code", () => comply({ t: transcript([[{ tool: "Write", input: { file_path: "/w/app.ts" } }]]) }).wrote_code]),
  ...pair("compliance: an approved file on disk and its type", ["an approved memo", () => {
    const c = comply({ files: { "projects/x/u-main-memo-1.md": "# Decision memo\nStatus: APPROVED\n" } });
    return c.approved_on_disk && c.deliverable === "memo";
  }], ["nothing on disk", () => {
    const c = comply({});
    return !c.approved_on_disk && c.deliverable === "none";
  }]),
  ...pair("compliance: a SUCCESS line in a startup design doc (change 1, item 4f)", ["a startup doc with SUCCESS — By", () => comply({ files: { "projects/x/u-main-design-1.md": DESIGN("Startup", "APPROVED", "SUCCESS — By Jan 15, two renewals.\n") } }).success_line], ["a builder doc", () => !comply({ files: { "projects/x/u-main-design-1.md": DESIGN("Builder", "APPROVED", "SUCCESS — By Jan 15, it runs.\n") } }).success_line]),
  ...pair("compliance: a commitment entry after approval (change 1, item 4f)", ["approved memo and a commitment entry", () => comply({ files: { "projects/x/u-main-memo-1.md": "# Decision memo\nStatus: APPROVED\n", "developer-profile.json": JSON.stringify({ sessions: [commitment] }) } }).commitment === true], ["a draft memo", () => comply({ files: { "projects/x/u-main-memo-1.md": "# Decision memo\nStatus: DRAFT\n", "developer-profile.json": JSON.stringify({ sessions: [commitment] }) } }).commitment === false]),
  ...pair("markers: candidate sets load per pin and a bad set is refused", ["both pins load", () => CUR.pin === "current" && NEW.pin === "new"], ["an uncompilable pattern", () => throws(() => markersFrom({ ...JSON.parse(JSON.stringify({ pin: "new", sha: NEW.sha, skill_loaded: { reads: ["a"], skill_tool: "o", texts: ["t"] }, builder_mode: { reads: ["b"], doc_mode: "x" }, deliverables: { design: "d" }, startup_only: { questions: { a: "a" }, lines: { b: "b" } } })), questions: { Q1: "(" } }), "E_OHR_MARKERS")]),
  ...pair("block render: what a judge reads round-trips through the parser", ["a rendered block parses back", () => {
    const p = parseBlock(renderBlock({ decision: "a b", next_action: "c", why: "d" }));
    return p.kind === "block" && p.block.decision === "a b";
  }], ["an empty next action does not", () => parseBlock(renderBlock({ decision: "a", next_action: "", why: "d" })).kind === "no-block"]),
];
