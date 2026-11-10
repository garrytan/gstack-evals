// Copyright (c) 2026 Garry Tan. MIT License.
// Section 3's labeller packets and section 10's judge packets, stock diffs and R78 check, on invented units, diffs and
// answers. No model is called: every answer here is written by hand. Kappa values are worked out by hand in comments.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blocks } from "../../lanes/outcome-skills/statemachines/secondary.ts";
import {
  assertBlind, cohenKappa, combineLabels, DIFF_LINE_CAP, judgedVerdict, judgeFor, judgePacket, judgeQueue, labelAgreement, labelledSet, labelPacket, PLANT_UNITS, plantDiffs, r78Check, r78Price, readJudgeAnswer, readLabelAnswer, stockDiffs, stockFlag,
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
    expect(logs).toEqual(["+\tprintln(\"enter\")", "+\tprintln(\"enter\")"]);
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

describe("R78 check with planted items", () => {
  const go = (name: string) => [
    "package core",
    "",
    "// " + name + " holds the values.",
    "// It is safe for one goroutine.",
    "// Callers own the map.",
    "type " + name + " struct{ m map[string]int }",
    "",
    "func (s *" + name + ") Get(key string) (int, error) {",
    "\tcount := s.m[key]",
    "\tif count == 0 {",
    '\t\treturn 0, errors.New("no value for key")',
    "\t}",
    "\treturn count, nil",
    "}",
    "",
  ].join("\n");
  const unit = (i: number, text = go("Store" + i)) => ({ unit: "u" + i, lang: "go" as const, path: "pkg/core/c" + i + ".go", text, files: ["pkg/core/c" + i + ".go", "go.mod"] });
  const units = [unit(0), unit(1, "package x\n"), ...Array.from({ length: 9 }, (_, i) => unit(i + 2))];

  test("each plant is mechanical, aimed at one axis, from the base text alone", () => {
    const p = plantDiffs({ lang: "go", path: "pkg/core/c.go", text: go("Store") });
    expect(p.map((x) => x.axis)).toEqual(["ux", "dx", "ax"]);
    expect(p[0]!.diff).toContain("+\tif !(count == 0) {");
    expect(p[1]!.diff!.split("\n").filter((l) => l.startsWith("-//")).length).toBe(3);
    expect(p[2]!.diff).toContain('+\t\treturn 0, errors.New("failed")');
    expect(plantDiffs({ lang: "go", path: "x.go", text: "package x\n" }).every((x) => x.diff === null)).toBe(true);
  });
  test("the labelled set is deterministic, fixed in its counts, blind, and skips units in draw order", () => {
    const s = labelledSet(units), again = labelledSet(units);
    expect(s).toEqual(again);
    expect(PLANT_UNITS).toBe(8);
    expect(s.skipped).toEqual(["u1"]);
    expect(s.items.length).toBe(48);
    expect(s.items.filter((x) => x.key.kind === "bad").map((x) => x.key.axis).sort()).toEqual([...Array(8).fill("ax"), ...Array(8).fill("dx"), ...Array(8).fill("ux")]);
    expect(s.items.filter((x) => x.key.kind === "neutral").length).toBe(24);
    expect(new Set(s.items.map((x) => x.key.unit))).toEqual(new Set(["u0", "u2", "u3", "u4", "u5", "u6", "u7", "u8"]));
    for (const x of s.items) {
      expect(() => assertBlind(x.packet, ["claude-opus-5-5", "openai/gpt-6.1-sol", "A1"])).not.toThrow();
      const t = JSON.stringify(x.packet);
      for (const w of ["plant", "neutral", "known", "stock", "u0"]) expect(t.includes(w)).toBe(false);
      expect(x.key.packet).toBe(x.packet.packet);
    }
    expect(() => labelledSet(units.slice(0, 5))).toThrow("E_SM_PACKET");
  });

  const ja = (u: number, d = u, x = u): JudgeAnswer => ({ ux: { score: u, reason: "r" }, dx: { score: d, reason: "r" }, ax: { score: x, reason: "r" }, hunks: [] });
  const agree = (i: number) => ({ id: "r" + i, a: ja([-2, 1, 2][i % 3]!), b: ja([-1, 2, 1][i % 3]!) });
  const split = (i: number) => ({ id: "s" + i, a: ja(1), b: ja(-1) });
  const target = (axis: string, s: number) => ja(axis === "ux" ? s : 0, axis === "dx" ? s : 0, axis === "ax" ? s : 0);
  const lab = () => [
    ...["ux", "dx", "ax"].flatMap((axis) => Array.from({ length: 8 }, (_, i) => ({ id: axis + i, kind: "bad" as const, axis: axis as "ux", a: target(axis, -1) as JudgeAnswer | null, b: (axis === "ux" ? target(axis, -2) : ja(0)) as JudgeAnswer | null }))),
    ...Array.from({ length: 24 }, (_, i) => ({ id: "n" + i, kind: "neutral" as const, axis: null, a: ja(0) as JudgeAnswer | null, b: (i < 6 ? ja(0, -1, 0) : i < 9 ? ja(1, 0, 0) : ja(0)) as JudgeAnswer | null })),
  ];

  test("catch and false-fail rates per judge on stub answers, with kappa beside every result", () => {
    const rows = lab();
    rows[0]!.a = null;
    rows[30]!.a = null;
    const r = r78Check({ real: Array.from({ length: 60 }, (_, i) => agree(i)), labelled: rows });
    expect(r.judges.astra.catch).toEqual({ n: 24, caught: 23, rate: 23 / 24 });
    expect(r.judges.astra.false_fail).toEqual({ n: 24, failed: 1, rate: 1 / 24 });
    expect(r.judges.astra.malformed).toBe(2);
    expect(r.judges.opus.catch).toEqual({ n: 24, caught: 8, rate: 8 / 24 });
    expect(r.judges.opus.false_fail).toEqual({ n: 24, failed: 6, rate: 6 / 24 });
    expect(r.judges.opus.stock_above).toEqual({ n: 24, above: 3 });
    for (const j of ["astra", "opus"] as const) expect(r.judges[j].kappa).toEqual({ ux: 1, dx: 1, ax: 1 });
    expect(r.axes.ux).toEqual({ kappa: 1, n: 60, malformed: 0, may_stand: true, reading: "passes its check" });
  });
  test("the gate refuses a judged verdict under kappa 0.6", () => {
    const r = r78Check({ real: Array.from({ length: 60 }, (_, i) => (i < 30 ? agree(i) : split(i))), labelled: lab() });
    expect(r.axes.dx.kappa!).toBeLessThan(0.6);
    expect(r.axes.dx).toMatchObject({ may_stand: false, reading: "judge failed its check" });
    expect(judgedVerdict(r, "dx", "A1 beats A0")).toBe("judge failed its check (kappa " + r.axes.dx.kappa!.toFixed(2) + ")");
    const ok = r78Check({ real: Array.from({ length: 60 }, (_, i) => agree(i)), labelled: lab() });
    expect(judgedVerdict(ok, "dx", "A1 beats A0")).toBe("A1 beats A0 (kappa 1.00)");
    const none = r78Check({ real: [{ id: "m", a: null, b: ja(1) }], labelled: lab() });
    expect(none.axes.ux).toMatchObject({ kappa: null, n: 0, malformed: 1, may_stand: false });
  });
  test("the agreement-set reading is one descriptive line and sets nothing", () => {
    const r = r78Check({ real: Array.from({ length: 60 }, (_, i) => (i < 30 ? agree(i) : split(i))), labelled: lab() });
    expect(r.agreement).toBe("descriptive only: 30 of 60 real diffs got the same sign from both judges on every axis; this is not a catch or false-fail rate");
    expect(Object.keys(r).sort()).toEqual(["agreement", "axes", "judges", "real_used"]);
    expect(r.real_used).toBe(60);
    expect(r78Check({ real: Array.from({ length: 70 }, (_, i) => agree(i)), labelled: lab() }).real_used).toBe(60);
  });
  test("prices the check's judge calls inside the sm-judges item cap", () => {
    const p = r78Price();
    expect(p.calls).toEqual({ real_astra: 240, real_opus: 480, stock_astra: 12, stock_opus: 27, r78_real_second: 60, labelled: 96 });
    expect(p.usd).toBeCloseTo(160.05, 6);
    expect(p.cap_usd).toBe(180);
    expect(p.fits).toBe(true);
  });
});

