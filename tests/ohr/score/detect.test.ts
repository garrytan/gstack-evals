// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's detectors on planted fixtures (prereg sections 7, 10, 11 and 12; pre-run change 1 items 4e and 4f).
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PINS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { compliance, datedAndNumbered, delivered, exposure, founderReplies, keptWhole, loadCompliance, loadMarkers, markersFrom, questionsAsked, startupOnly } from "../../../lanes/office-hours-rewrite/score/detect.ts";
import { block, stateRoot, transcript, turn } from "../../../lanes/office-hours-rewrite/score/fixtures.ts";

const CUR = loadMarkers("current"), NEW = loadMarkers("new"), C = loadCompliance();
const roots: string[] = [];
const root = (files: Record<string, string>) => {
  const r = stateRoot(files);
  roots.push(r);
  return r;
};
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const SKILL_READ = { tool: "Read", input: { file_path: "/s/office-hours/SKILL.md" }, result: "---\nname: office-hours\n---" };
const BUILDER_READ = { tool: "Read", input: { file_path: "/s/office-hours/sections/phase-2b-builder-brainstorm.md" }, result: "### Operating Principles" };
const Q1 = "Q1 — What's the strongest evidence you have that someone actually wants this?\nWhy I'm asking: interest is not demand.\nReply in your own words — I'll wait.";
const Q2 = "Q2 — What are your users doing right now to solve this problem, even badly?";
const REALITY = "Has it produced one real outcome yet: one paying user, or one person who used it this week without being asked? Name them.";
const DESIGN = (mode: string, status: string, extra = "") => "# Design: Ovens\n\nStatus: " + status + "\nMode: " + mode + "\n\n## The Assignment\nCall three bakers.\n" + extra;
const delivered3 = [{ ...turn(1), delivered: true }, { ...turn(2), delivered: true }, { ...turn(3), delivered: true }];
const exposedCurrent = () => ({ transcript: transcript([[SKILL_READ, Q1], [Q2], ["My advice is below."]]), stateRoot: root({ "projects/ovens/u-main-design-1.md": DESIGN("Startup", "APPROVED") }), sessionKind: "interactive", turns: delivered3, markers: CUR });

describe("markers", () => {
  test("candidate markers load for both pins, and the current pin's source files match its frozen hashes", () => {
    expect(CUR.sha).toBe(PINS.current!.sha);
    for (const [f, h] of Object.entries(CUR.source_files)) expect(PINS.current!.files[f]).toBe(h);
    expect(NEW.sha).toBe(PINS.new!.sha);
    for (const [f, h] of Object.entries(NEW.source_files)) expect(PINS.new!.files[f]).toBe(h);
    expect(Object.keys(NEW.questions)).toContain("reality-check");
    expect(Object.keys(CUR.questions)).not.toContain("reality-check");
    expect(CUR.deliverables.memo).toBeNull();
  });
  test("a bad marker set is refused with E_OHR_MARKERS", () => {
    const d = JSON.parse(readFileSync(join(import.meta.dir, "../../../lanes/office-hours-rewrite/score/markers/new.json"), "utf8"));
    expect(() => markersFrom({ ...d, pin: "none" })).toThrow(/^E_OHR_MARKERS/);
    expect(() => markersFrom({ ...d, questions: { Q1: "(" } })).toThrow(/^E_OHR_MARKERS/);
    expect(() => markersFrom({ ...d, questions: {} })).toThrow(/^E_OHR_MARKERS/);
  });
});

const CLONE = process.env.GSTACK_OHR_CLONE || join(homedir(), ".capy", "work", "gstack");
const ready = existsSync(CLONE) && ([PINS.current!.sha, PINS.new!.sha] as const).every((sha) => spawnSync("git", ["-C", CLONE, "cat-file", "-e", sha + "^{commit}"]).status === 0);
if (!ready) console.log("SKIP tests/ohr/score/detect.test.ts pin text check: no gstack clone holding both pins at " + CLONE);
test.skipIf(!ready)("from a clone holding both pins, every new-pin question and startup-only marker matches the new pin's office-hours text (pre-run change 5)", () => {
  const text = Object.keys(NEW.source_files).map((f) => spawnSync("git", ["-C", CLONE, "show", PINS.new!.sha + ":" + f], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout).join("\n");
  expect([NEW.questions, NEW.startup_only.questions, NEW.startup_only.lines].flatMap((set) => Object.entries(set)).filter(([, re]) => !re.test(text)).map(([id]) => id)).toEqual([]);
});

describe("exposure (section 12)", () => {
  test("a session that read the skill, printed interactive, asked two questions one at a time and wrote its doc is exposed", () => {
    expect(exposure(exposedCurrent())).toEqual({ read_skill: true, interactive: true, questions_one_at_a_time: 2, wrote_deliverable: true, exposed: true });
  });
  test("read the skill: a successful Read, the Skill tool or the skill's text in the user turn; a failed Read does not count", () => {
    const e = exposedCurrent();
    expect(exposure({ ...e, transcript: transcript([[Q1], [Q2], ["x"]]) }).read_skill).toBe(false);
    expect(exposure({ ...e, transcript: transcript([[{ ...SKILL_READ, error: true }, Q1], [Q2], ["x"]]) }).exposed).toBe(false);
    expect(exposure({ ...e, transcript: transcript([[{ tool: "Skill", input: { skill: "office-hours" }, result: "Loaded." }, Q1], [Q2], ["x"]]) }).read_skill).toBe(true);
    expect(exposure({ ...e, transcript: transcript([[{ user: "## Phase 2A: Startup Mode — YC Product Diagnostic" }, Q1], [Q2], ["x"]]) }).read_skill).toBe(true);
  });
  test("a session kind other than interactive is not exposed", () => {
    expect(exposure({ ...exposedCurrent(), sessionKind: "unattended" }).exposed).toBe(false);
    expect(exposure({ ...exposedCurrent(), sessionKind: null }).interactive).toBe(false);
  });
  test("two questions in one reply count as neither", () => {
    expect(exposure({ ...exposedCurrent(), transcript: transcript([[SKILL_READ, Q1 + "\n" + Q2], ["x"]]) }).questions_one_at_a_time).toBe(0);
  });
  test("a question counts only when a delivered founder reply answered it", () => {
    const e = exposedCurrent();
    expect(exposure({ ...e, turns: delivered3.slice(0, 1) }).questions_one_at_a_time).toBe(1);
    expect(exposure({ ...e, turns: [delivered3[0]!, { ...turn(2), delivered: false }] }).exposed).toBe(false);
    expect(exposure({ ...e, turns: [turn(1), turn(2)] }).questions_one_at_a_time).toBe(0);
  });
  test("the deliverable: a design doc on either pin, a memo only on the new pin, nothing written is not exposed", () => {
    const e = exposedCurrent();
    expect(exposure({ ...e, stateRoot: root({}) }).exposed).toBe(false);
    const memo = root({ "projects/ovens/u-main-memo-1.md": "# Decision memo: Ovens\nStatus: APPROVED\n" });
    expect(exposure({ ...e, stateRoot: memo }).wrote_deliverable).toBe(false);
    expect(exposure({ ...e, stateRoot: memo, markers: NEW }).wrote_deliverable).toBe(true);
    expect(exposure({ ...e, stateRoot: root({ "projects/ovens/u-main-design-1.md": " \n" }) }).wrote_deliverable).toBe(false);
  });
  test("each pin's own questions: the reality check counts on the new pin only", () => {
    const e = { ...exposedCurrent(), transcript: transcript([[SKILL_READ, REALITY], [Q2], ["x"]]) };
    expect(exposure(e).questions_one_at_a_time).toBe(1);
    expect(exposure({ ...e, markers: NEW }).questions_one_at_a_time).toBe(2);
  });
});

describe("startup-only questions (section 7, G1)", () => {
  const cases: Array<[string, string]> = [
    ["Q1", "What's the strongest evidence you have that someone actually wants this?"],
    ["Q2", "What does the workaround cost them?"],
    ["Q3", "Can you name the actual human who needs this most?"],
    ["Q4", "What's the smallest possible version of this that someone would pay real money for?"],
    ["Q5", "Have you watched someone use this without helping them?"],
    ["Q6", "If the world looks meaningfully different in 3 years, does your product become more essential or less?"],
    ["reality-check", REALITY],
    ["payment-test", "Would they pay for it if you sent a link?"],
    ["evidence-ladder", "Rank evidence: prepay > signed contract > paid pilot."],
    ["kill-line", "KILL/CONTINUE — By Dec 1, if nobody uses it, change direction."],
    ["pivot-love-or-size", "Is the worry that customers don't love it, or that the market is too small?"],
    ["wallet", "If you could keep only one, which gets the wallet out?"],
    ["two-sentence-pitch", "Give me the two-sentence version: what it does, then the proof."],
  ];
  for (const [id, text] of cases)
    test(id + " is found on both pins", () => {
      for (const m of [CUR, NEW]) expect(startupOnly(transcript([[text]]), m)).toContain(id);
    });
  test("the builder's generative questions are not startup-only", () => {
    const t = transcript([["What's the coolest version of this?"], ["Who would you show this to?"], ["What's the fastest path to something you can actually use or share?"], ["What would you add if you had unlimited time?"]]);
    expect(startupOnly(t, CUR)).toEqual([]);
    expect(startupOnly(t, NEW)).toEqual([]);
  });
});

describe("kept whole (section 7)", () => {
  const good = () => ({ transcript: transcript([[SKILL_READ, BUILDER_READ, "What's the coolest version of this?"], ["Great, here is the doc."]]), stateRoot: root({ "projects/map/u-main-design-1.md": DESIGN("Builder", "APPROVED") }), founderDone: true, markers: NEW });
  test("builder mode, no startup question, an approved builder doc and done before the cap is kept", () => {
    expect(keptWhole(good())).toEqual({ builder_mode: true, startup_only: [], builder_doc_approved: true, before_cap: true, kept: true });
  });
  test("each of the four parts failing breaks it", () => {
    const g = good();
    expect(keptWhole({ ...g, transcript: transcript([[SKILL_READ, BUILDER_READ, REALITY], ["doc"]]) })).toMatchObject({ startup_only: ["reality-check"], kept: false });
    expect(keptWhole({ ...g, stateRoot: root({ "projects/map/u-main-design-1.md": DESIGN("Builder", "DRAFT") }) }).kept).toBe(false);
    expect(keptWhole({ ...g, stateRoot: root({ "projects/map/u-main-memo-1.md": "# Decision memo\nStatus: APPROVED\nMode: Builder\n" }) }).builder_doc_approved).toBe(false);
    expect(keptWhole({ ...g, transcript: transcript([[SKILL_READ, "Tell me more."], ["doc"]]), stateRoot: root({ "projects/map/u-main-design-1.md": DESIGN("Startup", "APPROVED") }) })).toMatchObject({ builder_mode: false, builder_doc_approved: false, kept: false });
    expect(keptWhole({ ...g, founderDone: false })).toMatchObject({ before_cap: false, kept: false });
  });
});

describe("guardrail counts", () => {
  test("G2 counts question sentences, leaving out the replies to the closing message", () => {
    const t = transcript([["Who pays? How much?"], ["What happened next?"], ["Anything else?"], ["DECISION: a\nNEXT ACTION: b\nWHY: c\nAny questions?"]]);
    expect(questionsAsked(t, 1)).toBe(4);
    expect(questionsAsked(t, 0)).toBe(5);
    expect(questionsAsked(t, 2)).toBe(3);
  });
  test("G3 counts delivered founder replies only: a replaced reply and a rejected draw do not count", () => {
    const turns = [{ ...turn(1), delivered: true }, { ...turn(2), delivered: false }, { ...turn(3), delivered: true }, turn(4)];
    expect(founderReplies(turns)).toBe(2);
    expect(delivered(turns).map((t) => t.turn)).toEqual([1, 3]);
  });
});

describe("compliance (section 11 and change 1 item 4f)", () => {
  const base = (o: Partial<Parameters<typeof compliance>[0]> = {}) => compliance({ transcript: transcript([["ok"]]), stateRoot: root({}), block: null, arm: "new", kind: "founder", markers: NEW, c: C, ...o });
  test("deliverable type: memo, design, other or none, the newest file winning", () => {
    expect(base().deliverable).toBe("none");
    expect(base({ stateRoot: root({ "projects/x/notes.md": "hi" }) }).deliverable).toBe("other");
    const r = root({ "projects/x/u-main-design-1.md": DESIGN("Startup", "DRAFT"), "projects/x/u-main-memo-2.md": "# Decision memo\nStatus: DRAFT\n" });
    utimesSync(join(r, "projects/x/u-main-design-1.md"), 1000, 1000);
    utimesSync(join(r, "projects/x/u-main-memo-2.md"), 2000, 2000);
    expect(base({ stateRoot: r }).deliverable).toBe("memo");
    utimesSync(join(r, "projects/x/u-main-design-1.md"), 3000, 3000);
    expect(base({ stateRoot: r }).deliverable).toBe("design");
  });
  test("an action with a date and a number, the number outside the date", () => {
    expect(datedAndNumbered("Send a priced payment link to the warmest 3 buyers by Friday", C)).toBe(true);
    expect(datedAndNumbered("Call five bakers within 7 days", C)).toBe(true);
    expect(datedAndNumbered("Email the buyers by Friday", C)).toBe(false);
    expect(datedAndNumbered("Email 3 buyers soon", C)).toBe(false);
    expect(datedAndNumbered("Email the buyer by 2026-11-20", C)).toBe(false);
    expect(base({ block: block("a", "Ask 2 bakers to prepay by Dec 1") }).action_with_date_and_number).toBe(true);
    expect(base({ block: null }).action_with_date_and_number).toBe(false);
  });
  test("a kill line in the memo or in the adviser's text", () => {
    expect(base({ stateRoot: root({ "projects/x/u-main-memo-1.md": "# Decision memo\n## KILL/CONTINUE\nBy Dec 1, if no bakery pays, change direction.\n" }) }).kill_line).toBe(true);
    expect(base({ transcript: transcript([["KILL/CONTINUE — By Dec 1, if no one pays, change direction."]]) }).kill_line).toBe(true);
    expect(base({ transcript: transcript([["Kill it if it fails."]]) }).kill_line).toBe(false);
  });
  test("a SUCCESS line counts only in a startup-mode design doc", () => {
    expect(base({ stateRoot: root({ "projects/x/u-main-design-1.md": DESIGN("Startup", "APPROVED", "## Kill or Success Line\nSUCCESS — By Jan 15, two bakeries renew at $400 a month.\n") }) }).success_line).toBe(true);
    expect(base({ stateRoot: root({ "projects/x/u-main-design-1.md": DESIGN("Builder", "APPROVED", "SUCCESS — By Jan 15, it runs.\n") }) }).success_line).toBe(false);
    expect(base({ stateRoot: root({ "projects/x/u-main-design-1.md": DESIGN("Startup", "APPROVED") }) }).success_line).toBe(false);
  });
  test("code written: a write tool on a code file; a markdown file is not code", () => {
    expect(base({ transcript: transcript([[{ tool: "Write", input: { file_path: "/w/app.ts", content: "x" } }]]) }).wrote_code).toBe(true);
    expect(base({ transcript: transcript([[{ tool: "Write", input: { file_path: "/w/docs/designs/x.md", content: "x" } }]]) }).wrote_code).toBe(false);
  });
  test("an approved file on disk", () => {
    expect(base({ stateRoot: root({ "projects/x/u-main-design-1.md": DESIGN("Startup", "APPROVED") }) }).approved_on_disk).toBe(true);
    expect(base({ stateRoot: root({ "projects/x/u-main-design-1.md": DESIGN("Startup", "DRAFT") }) }).approved_on_disk).toBe(false);
  });
  test("a commitment entry in the developer profile after approval, on new-arm founder sessions only", () => {
    const entry = { date: "2026-11-18T00:00:00Z", mode: "commitment", project_slug: "x", kill_date: "2026-12-01", kill_test: "two bakeries prepay" };
    const memo = "# Decision memo\nStatus: APPROVED\n";
    const ok = root({ "projects/x/u-main-memo-1.md": memo, "developer-profile.json": JSON.stringify({ sessions: [entry] }) });
    expect(base({ stateRoot: ok }).commitment).toBe(true);
    expect(base({ stateRoot: root({ "projects/x/u-main-memo-1.md": "# Decision memo\nStatus: DRAFT\n", "developer-profile.json": JSON.stringify({ sessions: [entry] }) }) }).commitment).toBe(false);
    expect(base({ stateRoot: root({ "projects/x/u-main-memo-1.md": memo, "developer-profile.json": JSON.stringify({ sessions: [{ ...entry, kill_test: "" }] }) }) }).commitment).toBe(false);
    expect(base({ stateRoot: ok, arm: "current", markers: CUR }).commitment).toBeNull();
    expect(base({ stateRoot: ok, kind: "builder" }).commitment).toBeNull();
  });
});
