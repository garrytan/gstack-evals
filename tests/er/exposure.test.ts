// Copyright (c) 2026 Garry Tan. MIT License.
// er exposure: the pre-cut, eng phase and candidate detectors (prereg 2026-11-08-geva-405 section 5) and the decisions
// read, each count edge on both sides. Keyless; every transcript and file is synthetic.
import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { erDecisions, erExposure, run, sessionEvidence, testPlanArtifacts, type ErEvidence } from "../../lanes/eng-review/exposure.ts";
import { ARTIFACT, call, CONSENSUS, coverageFiles, FAILURES, nd, PLAN_COVERAGE_REPLY, review, say, tick, tree, user, voice } from "./fixtures.ts";

const ev = (transcript: string, over: Partial<ErEvidence> = {}): ErEvidence => ({ transcript, stateRoot: null, coverage: null, opening: null, ...over });
const failed = (e: { checks: { name: string; pass: boolean }[] }) => e.checks.filter((c) => !c.pass && c.name !== "load").map((c) => c.name);
const READ_RS = call("Read", { file_path: "/root/.claude/skills/gstack/plan-eng-review/sections/review-sections.md" }, "## Review preparation");

describe("pre-cut", () => {
  test("exposed with the Scope Challenge, Sections 1 to 4 in order, a 3-line diagram and the artifact; loaded on the section read", () => {
    const e = erExposure("precut", ev(nd(READ_RS, say(review())), { stateRoot: tree(ARTIFACT) }));
    expect([e.exposed, e.loaded, e.missing]).toEqual([true, true, []]);
  });
  test("each edge fails on its other side", () => {
    const root = tree(ARTIFACT);
    expect(failed(erExposure("precut", ev(nd(say(review([1, 2, 3, 4], 2))), { stateRoot: root })))).toEqual(["coverage_diagram"]);
    expect(failed(erExposure("precut", ev(nd(say(review([2, 1, 3, 4]))), { stateRoot: root })))).toEqual(["sections_in_order"]);
    expect(failed(erExposure("precut", ev(nd(say(review().replace(/## Step 0: Scope Challenge\n[^\n]*/, ""))), { stateRoot: root })))).toEqual(["scope_challenge"]);
    const none = erExposure("precut", ev(nd(say(review()))));
    expect([failed(none), none.loaded, none.missing.length]).toEqual([["test_plan_artifact"], false, 1]);
  });
  test("a subagent's review or a failed Write does not count; a successful Write does", () => {
    const root = tree(ARTIFACT);
    expect(erExposure("precut", ev(nd(say(review(), "task-1")), { stateRoot: root })).exposed).toBe(false);
    expect(erExposure("precut", ev(nd(call("Write", { file_path: "/work/plan.md", content: review() }, "denied", true)), { stateRoot: root })).exposed).toBe(false);
    expect(erExposure("precut", ev(nd(call("Write", { file_path: "/work/plan.md", content: review() }, "File written")), { stateRoot: root })).exposed).toBe(true);
  });
  test("artifacts are non-empty regular files named *-eng-review-test-plan-*.md; symlinks and empty files are skipped", () => {
    const d = tree({ "projects/a/u-main-eng-review-test-plan-1.md": "# Test Plan\n", "projects/a/u-main-eng-review-test-plan-2.md": "", "projects/a/eng-review-test-plan.md": "x" });
    symlinkSync(join(d, "projects/a/u-main-eng-review-test-plan-1.md"), join(d, "projects/a/v-eng-review-test-plan-3.md"));
    expect(testPlanArtifacts(d)).toEqual(["projects/a/u-main-eng-review-test-plan-1.md"]);
  });
});

describe("eng phase", () => {
  const opening = { methodology: "/work/autoplan/methodology.md", readRanges: [{ offset: 1, limit: 600 }, { offset: 601, limit: 120 }] };
  const reads = (last: boolean) => [...call("Read", { file_path: "/work/autoplan/methodology.md", offset: 1, limit: 600 }, "a"), ...(last ? call("Read", { file_path: "autoplan/methodology.md", offset: 601, limit: 600 }, "b") : [])];
  const full = (v = voice("sync"), extra = "") => nd(reads(true), v, say(review().replace("## Section 1", CONSENSUS + "\n\n## Section 1") + "\n\n" + FAILURES + extra));
  test("exposed with every output; loaded only when the last readRanges chunk is read", () => {
    const root = tree(ARTIFACT);
    const e = erExposure("engphase", ev(full(), { stateRoot: root, opening }));
    expect([e.exposed, e.loaded]).toEqual([true, true]);
    expect(erExposure("engphase", ev(nd(reads(false), voice("sync"), say(review() + CONSENSUS + FAILURES)), { stateRoot: root, opening })).loaded).toBe(false);
    expect(erExposure("engphase", ev(full(), { stateRoot: root })).loaded).toBe(false);
  });
  test("the eng voice needs a started dispatch with a terminal result", () => {
    const root = tree(ARTIFACT);
    expect(erExposure("engphase", ev(full(voice("async-done")), { stateRoot: root, opening })).exposed).toBe(true);
    expect(failed(erExposure("engphase", ev(full(voice("async-open")), { stateRoot: root, opening })))).toEqual(["native_eng_voice"]);
    expect(failed(erExposure("engphase", ev(full(voice("refused")), { stateRoot: root, opening })))).toEqual(["native_eng_voice"]);
  });
  test("no consensus table, no failure modes registry, or a Scope Challenge with no findings fails", () => {
    const root = tree(ARTIFACT);
    const bare = nd(reads(true), voice("sync"), say(review()));
    expect(failed(erExposure("engphase", ev(bare, { stateRoot: root, opening })))).toEqual(["consensus_table", "failure_modes"]);
    const noFind = nd(reads(true), voice("sync"), say(review().replace("1. The loan helper", "The loan helper") + CONSENSUS + "\n\n" + FAILURES));
    expect(failed(erExposure("engphase", ev(noFind, { stateRoot: root, opening })))).toEqual(["scope_challenge"]);
  });
  test("decisions: audit trail rows are decided, a User Challenge row is pending", () => {
    const trail = "\n\n## Decision Audit Trail\n\n| # | Phase | Decision | Classification | Principle | Rationale | Rejected |\n|---|---|---|---|---|---|---|\n| 1 | eng | Add the fee test | Mechanical | P1 | gap | none |\n| 2 | eng | Split the module | User Challenge | P5 | both voices | none |\n";
    const d = erDecisions("engphase", ev(full(voice("sync"), trail), { stateRoot: tree(ARTIFACT) }));
    expect(d).toEqual({ decided: ["Add the fee test"], pending: ["Split the module"], test_plan_artifact: true });
  });
});

describe("candidate", () => {
  const reply = nd(say("Plan: plan.md\n" + PLAN_COVERAGE_REPLY));
  const dir = (over = {}) => tree(coverageFiles(over));
  test("exposed with the three files, 3 tagged and rated paths, one test and the reply line", () => {
    const e = erExposure("candidate", ev(nd(user([{ type: "text", text: "# /plan-coverage: path map, coverage map, test plan" }]), say("Plan: plan.md\n" + PLAN_COVERAGE_REPLY)), { coverage: dir() }));
    expect([e.exposed, e.loaded]).toEqual([true, true]);
    expect(erExposure("candidate", ev(reply, { coverage: dir() })).loaded).toBe(false);
  });
  test("each edge fails on its other side", () => {
    expect(failed(erExposure("candidate", ev(reply, { coverage: dir({ status: "no-plan" }) })))).toEqual(["status"]);
    expect(failed(erExposure("candidate", ev(reply, { coverage: dir({ paths: 2 }) })))).toEqual(["path_map"]);
    expect(failed(erExposure("candidate", ev(reply, { coverage: dir({ rated: 2 }) })))).toEqual(["coverage_map"]);
    expect(failed(erExposure("candidate", ev(reply, { coverage: dir({ coverageLine: false }) })))).toEqual(["coverage_map"]);
    expect(failed(erExposure("candidate", ev(reply, { coverage: dir({ tests: 0 }) })))).toEqual(["test_plan"]);
    expect(failed(erExposure("candidate", ev(nd(say("done")), { coverage: dir() })))).toEqual(["plan_coverage_line"]);
    const noHeader = dir();
    writeFileSync(join(noHeader, "test-plan.md"), "# Test plan\n### T1: x\n- Kind: unit\n- Catches: y\n");
    expect(failed(erExposure("candidate", ev(reply, { coverage: noHeader })))).toEqual(["files", "test_plan"]);
  });
  test("decisions come from test-plan.md's Decisions section", () => {
    expect(erDecisions("candidate", ev(reply, { coverage: dir() }))).toEqual({ decided: ["Test framework"], pending: [], test_plan_artifact: true });
    expect(erDecisions("candidate", ev(reply)).test_plan_artifact).toBe(false);
  });
});

describe("decisions and the session dir", () => {
  test("pre-cut: AskUserQuestion answered or not, ledger states and unresolved decisions", () => {
    const ledger = "### R1: Add a fee test\nState: approved\n\n### R2: Cache loans\nState: pending\n\n## Unresolved decisions\n- D4 retry budget\n";
    const t = nd(call("AskUserQuestion", { questions: [{ question: "D1 Keep the helper?" }] }, "A"), call("AskUserQuestion", { questions: [{ question: "D2 Drop the cache?" }] }, null), say(ledger));
    expect(erDecisions("precut", ev(t))).toEqual({ decided: ["D1 Keep the helper?", "R1: Add a fee test"], pending: ["D2 Drop the cache?", "R2: Cache loans", "D4 retry budget"], test_plan_artifact: false });
  });
  test("sessionEvidence and run read host/; run refuses a dir with no transcript", () => {
    const s = tree({ "host/transcript.ndjson": nd(READ_RS, say(review())), ...Object.fromEntries(Object.entries(ARTIFACT).map(([k, v]) => ["host/gstack-state/" + k, v])), "host/er-opening.json": JSON.stringify({ sha256: "x", methodology: "/work/autoplan/methodology.md", readRanges: [{ offset: 1, limit: 5 }] }) });
    mkdirSync(join(s, "host", "plan-coverage"));
    const e = sessionEvidence(s);
    expect([e.stateRoot !== null, e.coverage !== null, e.opening?.readRanges.length]).toEqual([true, true, 1]);
    const out: string[] = [], err: string[] = [];
    expect(run(["--session", s, "--arm", "precut"], { out: (t) => out.push(t), err: (t) => err.push(t) })).toBe(0);
    expect(JSON.parse(out[0]!).exposed).toBe(true);
    expect(run(["--session", tree({}), "--arm", "precut"], { out: (t) => out.push(t), err: (t) => err.push(t) })).toBe(2);
    expect(run(["--session", s, "--arm", "none"], { out: (t) => out.push(t), err: (t) => err.push(t) })).toBe(2);
  });
});
