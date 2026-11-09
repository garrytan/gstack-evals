// Copyright (c) 2026 Garry Tan. MIT License.
// Section 3's labeller packets and section 10's judge packets, stock diffs and R78 check, on invented units, diffs and
// answers. No model is called: every answer here is written by hand. Kappa values are worked out by hand in comments.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blocks } from "../../lanes/outcome-skills/statemachines/secondary.ts";
import {
  cohenKappa, combineLabels, DIFF_LINE_CAP, judgeFor, judgePacket, judgeQueue, labelAgreement, labelPacket, r78Check, readJudgeAnswer, readLabelAnswer, stockDiffs, stockFlag,
  type JudgeAnswer, type LabelAnswer,
} from "../../lanes/outcome-skills/statemachines/packets.ts";

const dir = mkdtempSync(join(tmpdir(), "sm-packets-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const head = (p: string) => "diff --git a/" + p + " b/" + p + "\n--- a/" + p + "\n+++ b/" + p + "\n";
const block = (p: string, line: number, n: number) => head(p) + "@@ -" + line + ",0 +" + (line + 1) + "," + n + " @@\n" + Array.from({ length: n }, (_, i) => "+line " + i + "\n").join("");

describe("labeller packet", () => {
  writeFileSync(join(dir, "issue.md"), "The counter does not reset after close.\n");
  writeFileSync(join(dir, "fix.patch"), head("src/c.go") + "@@ -1,1 +1,1 @@\n-a\n+b\n");
  writeFileSync(join(dir, "test.patch"), head("src/c_test.go") + "@@ -1,0 +2,1 @@\n+t\n");
  writeFileSync(join(dir, "unit.json"), JSON.stringify({ id: "acme__widget-1", repo: "acme/widget" }));
  test("holds the issue, the fix and the fix's tests, the frozen questions, and nothing that names the unit", () => {
    const { packet, key } = labelPacket(dir);
    expect(Object.keys(packet).sort()).toEqual(["answer_format", "fix", "fix_tests", "issue", "packet", "questions", "schema", "state_shaped"]);
    expect(packet.issue).toContain("does not reset");
    expect(packet.fix).toContain("+b");
    expect(packet.fix_tests).toContain("+t");
    expect(JSON.stringify(packet)).not.toContain("acme__widget-1");
    expect(key).toEqual({ schema: "sm-label-key.v1", packet: packet.packet, unit: "acme__widget-1" });
    expect(labelPacket(dir).packet.packet).toBe(packet.packet);
  });
  test("adds the fix's in-source test hunks to the tests when the unit has them", () => {
    writeFileSync(join(dir, "fix-tests.patch"), head("src/c.rs") + "@@ -9,0 +10,1 @@\n+#[test] fn t() {}\n");
    expect(labelPacket(dir).packet.fix_tests).toContain("#[test] fn t()");
    rmSync(join(dir, "fix-tests.patch"));
  });
});

describe("label answers fail closed", () => {
  const ok = { defect: "yes", state_shaped: "no", reason: "crashes on valid input" };
  test("a well-formed reply reads", () => {
    expect(readLabelAnswer(JSON.stringify(ok))).toEqual({ ok: true, answer: ok as LabelAnswer });
    expect(readLabelAnswer("  " + JSON.stringify(ok) + "\n").ok).toBe(true);
  });
  test("anything else is malformed", () => {
    for (const bad of [
      "yes", "", "[" + JSON.stringify(ok) + "]", "~~~json\n" + JSON.stringify(ok) + "\n~~~", JSON.stringify(ok) + " thanks",
      JSON.stringify({ ...ok, defect: "Yes" }), JSON.stringify({ ...ok, extra: 1 }), JSON.stringify({ defect: "yes", state_shaped: "no" }),
      JSON.stringify({ ...ok, reason: "" }), JSON.stringify({ ...ok, state_shaped: true }),
    ]) {
      const r = readLabelAnswer(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("E_SM_JUDGE_ANSWER");
    }
  });
  const ans = (defect: "yes" | "no", state: "yes" | "no"): LabelAnswer => ({ defect, state_shaped: state, reason: "r" });
  test("eligible only when both say defect; state or other only when both agree", () => {
    expect(combineLabels(ans("yes", "yes"), ans("yes", "yes"))).toMatchObject({ eligible: true, stratum: "state" });
    expect(combineLabels(ans("yes", "no"), ans("yes", "no"))).toMatchObject({ eligible: true, stratum: "other" });
    expect(combineLabels(ans("yes", "yes"), ans("yes", "no"))).toMatchObject({ eligible: true, stratum: "unclear" });
    expect(combineLabels(ans("yes", "yes"), ans("no", "yes"))).toMatchObject({ eligible: false });
    expect(combineLabels(ans("yes", "yes"), null)).toMatchObject({ eligible: false, stratum: "unclear", malformed: ["opus"] });
  });
  test("Cohen's kappa by hand", () => {
    // 20 yes-yes, 15 no-no, 5 yes-no, 10 no-yes: po = 0.7, pe = 0.5 * 0.6 + 0.5 * 0.4 = 0.5, kappa = 0.4.
    const pairs = [...Array(20).fill(["yes", "yes"]), ...Array(15).fill(["no", "no"]), ...Array(5).fill(["yes", "no"]), ...Array(10).fill(["no", "yes"])] as [string, string][];
    expect(cohenKappa(pairs)).toBeCloseTo(0.4, 12);
    expect(cohenKappa([["yes", "yes"], ["yes", "yes"]])).toBeNull();
    expect(cohenKappa([])).toBeNull();
    const rows = pairs.map(([a, b]) => ({ astra: ans(a as "yes", "no"), opus: ans(b as "yes", "no") }));
    expect(labelAgreement([...rows, { astra: null, opus: ans("yes", "no") }])).toMatchObject({ n: 50, malformed: 1 });
    expect(labelAgreement(rows).defect).toBeCloseTo(0.4, 12);
  });
});

describe("judge packet", () => {
  const files = ["pkg/a.go", "pkg/b.go"];
  test("cuts the diff at 1,500 lines with a flag and lists at most 8 hunks inside the cut, largest first", () => {
    const parts: string[] = [];
    for (let k = 0; k < 12; k++) parts.push(block("pkg/f" + k + ".go", 10, 10 + k * 5));
    parts.push(block("pkg/big.go", 1, 2000));
    const diff = parts.join("");
    const { packet, lines_total } = judgePacket({ diff, files });
    expect(lines_total).toBe(diff.split("\n").length - 1);
    expect(packet.cut).toBe(true);
    expect(packet.diff.split("\n").length - 1).toBe(DIFF_LINE_CAP);
    expect(packet.hunks.length).toBe(8);
    expect(packet.hunks.map((h) => h.lines)).toEqual([65, 60, 55, 50, 45, 40, 35, 30]);
    expect(packet.hunks.map((h) => h.id)).toEqual(["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"]);
    expect(Object.keys(packet).sort()).toEqual(["answer_format", "cut", "diff", "files", "hunks", "packet", "questions", "schema"]);
  });
  test("a short diff is not cut, and the packet id depends only on what the judge sees", () => {
    const a = judgePacket({ diff: block("pkg/a.go", 3, 4), files });
    expect(a.packet.cut).toBe(false);
    expect(judgePacket({ diff: block("pkg/a.go", 3, 4), files }).packet.packet).toBe(a.packet.packet);
  });
  test("each session model goes to its frozen judge", () => {
    expect(judgeFor("claude-opus-5-5")).toBe("openai/gpt-6-astra");
    expect(judgeFor("openai/gpt-6.1-sol")).toBe("anthropic/claude-opus-5-5");
    expect(judgeFor("particle-ai/particle-1")).toBe("anthropic/claude-opus-5-5");
    expect(() => judgeFor("other")).toThrow("E_SM_PACKET");
  });
});

describe("judge answers fail closed", () => {
  const { packet } = judgePacket({ diff: block("pkg/a.go", 3, 4) + block("pkg/b.go", 9, 2), files: ["pkg/a.go"] });
  const ok = { ux: { score: 0, reason: "no user-facing change" }, dx: { score: 1, reason: "clearer" }, ax: { score: -2, reason: "worse for agents" }, hunks: [{ id: "h1", real_defect: "no" }, { id: "h2", real_defect: "yes" }] };
  test("a well-formed reply reads", () => {
    const r = readJudgeAnswer(JSON.stringify(ok), packet);
    expect(r.ok).toBe(true);
  });
  test("out of range, fractional, missing, extra or duplicated fields are malformed", () => {
    const bads = [
      { ...ok, ux: { score: 3, reason: "x" } }, { ...ok, dx: { score: 1.5, reason: "x" } }, { ...ok, ax: { score: -1 } },
      { ...ok, hunks: [{ id: "h1", real_defect: "no" }] }, { ...ok, hunks: [...ok.hunks, { id: "h3", real_defect: "no" }] },
      { ...ok, hunks: [{ id: "h1", real_defect: "no" }, { id: "h1", real_defect: "no" }] }, { ...ok, hunks: [{ id: "h1", real_defect: "maybe" }, ok.hunks[1]] },
      { ...ok, model: "x" },
    ];
    for (const b of bads) expect(readJudgeAnswer(JSON.stringify(b), packet).ok).toBe(false);
    expect(readJudgeAnswer("The diff is fine.", packet).ok).toBe(false);
  });
});

describe("stock diffs", () => {
  const text = ["package core", "", "func Count(items []int) int {", "\ttotal := 0", "\tfor _, v := range items {", "\t\ttotal += v", "\t}", "\treturn total", "}", "", "func Reset() {", "}", ""].join("\n");
  const s = stockDiffs({ lang: "go", path: "pkg/core/c.go", text });
  test("builds the three frozen kinds from the unit's own file", () => {
    expect(s.map((x) => x.kind)).toEqual(["comments_whitespace", "rename_only", "logging"]);
    for (const x of s) expect(x.diff).not.toBeNull();
  });
  test("comments and whitespace only adds nothing but comments and blank lines", () => {
    const added = s[0]!.diff!.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1).trim());
    expect(added.length).toBeGreaterThan(0);
    for (const l of added) expect(l === "" || l.startsWith("//")).toBe(true);
  });
  test("rename only changes the lines holding the renamed name, and logging adds a log call to each function", () => {
    const r = s[1]!.diff!;
    const removed = r.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(removed.length).toBe(3);
    for (const l of removed) expect(l).toContain("total");
    const logs = s[2]!.diff!.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    expect(logs).toEqual(["+\tlog.Println(\"enter\")", "+\tlog.Println(\"enter\")"]);
    expect(blocks(s[2]!.diff!).length).toBe(2);
  });
  test("a file with no local to rename gives no rename diff", () => {
    expect(stockDiffs({ lang: "go", path: "x.go", text: "package x\n" })[1]!.diff).toBeNull();
  });
});

describe("judge queue and the stock flag", () => {
  test("three stock diffs follow every 50th diff", () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ id: "d" + i }));
    const q = judgeQueue(items, (it) => ["s1", "s2", "s3"].map((k) => ({ id: it.id + k })));
    expect(q.length).toBe(126);
    expect(q.slice(50, 53).map((x) => x.id)).toEqual(["d49s1", "d49s2", "d49s3"]);
    expect(q.slice(103, 106).map((x) => x.id)).toEqual(["d99s1", "d99s2", "d99s3"]);
  });
  const ja = (ux: number, dx = 0, ax = 0): JudgeAnswer => ({ ux: { score: ux, reason: "r" }, dx: { score: dx, reason: "r" }, ax: { score: ax, reason: "r" }, hunks: [] });
  test("more than 10% of stock diffs above 0 on any axis flags the judge; a malformed answer counts against it", () => {
    const thirty = (above: number) => Array.from({ length: 30 }, (_, i) => (i < above ? ja(0, 1) : ja(0)));
    expect(stockFlag(thirty(3))).toEqual({ n: 30, above: 3, malformed: 0, flagged: false });
    expect(stockFlag(thirty(4)).flagged).toBe(true);
    expect(stockFlag([...thirty(3).slice(1), null])).toEqual({ n: 30, above: 3, malformed: 1, flagged: false });
    expect(stockFlag([...thirty(3).slice(1), null, null]).flagged).toBe(true);
  });
});

describe("R78 check", () => {
  const ja = (s: number): JudgeAnswer => ({ ux: { score: s, reason: "r" }, dx: { score: s, reason: "r" }, ax: { score: s, reason: "r" }, hunks: [] });
  const agree = (i: number) => ({ id: "a" + i, a: ja([-2, 1, 2][i % 3]!), b: ja([-1, 2, 1][i % 3]!) });
  const split = (i: number) => ({ id: "s" + i, a: ja(1), b: ja(-1) });
  test("adds diffs past 60 in order until 40 are labelled", () => {
    const rows = [...Array.from({ length: 60 }, (_, i) => (i < 30 ? agree(i) : split(i))), ...Array.from({ length: 15 }, (_, i) => agree(100 + i))];
    const r = r78Check(rows);
    expect(r).toMatchObject({ used: 70, labelled: 40, short: false });
    // Literal reading: on the label set both judges agree by construction, so catch is 1 and false fail 0.
    expect(r.judges.a.ux).toEqual({ bad: 13, good: 27, catch_rate: 1, false_fail_rate: 0 });
  });
  test("runs short when supply ends, and gates each axis at kappa 0.6", () => {
    const r = r78Check(Array.from({ length: 65 }, (_, i) => (i < 35 ? agree(i) : split(i))));
    expect(r).toMatchObject({ used: 65, labelled: 35, short: true });
    for (const ax of ["ux", "dx", "ax"] as const) expect(r.axes[ax].reading).toBe(r.axes[ax].kappa !== null && r.axes[ax].kappa! >= 0.6 ? "passes its check" : "judge failed its check");
    const perfect = r78Check(Array.from({ length: 60 }, (_, i) => agree(i)));
    expect(perfect.axes.ux).toEqual({ kappa: 1, n: 60, reading: "passes its check" });
  });
  test("a malformed answer leaves the diff unlabelled and out of kappa", () => {
    const rows = [...Array.from({ length: 59 }, (_, i) => agree(i)), { id: "m", a: null, b: ja(1) }];
    const r = r78Check(rows);
    expect(r).toMatchObject({ used: 60, labelled: 59, malformed: 1 });
    expect(r.axes.dx.n).toBe(59);
  });
});
