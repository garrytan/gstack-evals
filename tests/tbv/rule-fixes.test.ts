// Copyright (c) 2026 Garry Tan. MIT License.
// The scorer's build fixes (#233's Step 11 items 1 to 7 and 16, the underscore name gap, fix-check 3's markdown, XML
// and flag forms), each written to fail against the byte-for-byte port of tbv-rule.ts.txt, with a case in the other
// direction that keeps its frozen answer. Item 8 is a comment; the regression table cites its diff.
import { describe, expect, test } from "bun:test";
import { controls, dev, file, label, line, picked, reading, rule, stage1, task, type Any } from "./rule-helpers.ts";

const gap = (r: Any) => { delete r.second; return Object.assign(r, { status: "gap", facts: [], responseIds: [], exposed: r.exposed === null ? null : false }); };
const of = (rs: Any[], t: string, arm: string) => rs.find((r) => r.task === t && r.arm === arm)!;

describe("item 1: a reading's family must match its task", () => {
  test("a source A gap filled by a copy labelled ship is refused", () => {
    const { data, split } = dev(20, (rs) => { const r = of(rs, "t1", "none"); rs.push({ ...r, id: label("copy", false), family: "ship", responseIds: ["msg_copy"] }); gap(r); });
    const r = rule("compare", data, split);
    expect(r.refused).toBe(true);
    expect(r.err).toContain("family ship");
  });
  test("a capy reading on a source A task, and a capy none reading, are refused", () => {
    const b = [task("b0", "B"), task("b1", "B")];
    const base = (x: Any) => dev(2, (rs) => rs.push(reading(b[0], x.arm, "opus", 1, 0.5, { family: "capy", task: x.task })), { tasks: b });
    expect(rule("compare", base({ arm: "current", task: "b0" }).data, base({ arm: "current", task: "b0" }).split).status).toBe(0);
    const a = dev(2, (rs, ts) => rs.push(reading(ts[0], "current", "opus", 1, 0.5, { family: "capy" })));
    expect(rule("compare", a.data, a.split).err).toContain("capy reads source B tasks only");
    const n = base({ arm: "none", task: "b0" });
    expect(rule("compare", n.data, n.split).err).toContain("capy none is the ship reading");
  });
  test("other direction: readings labelled with their task's family run", () => {
    const { data, split } = dev();
    expect(rule("compare", data, split).status).toBe(0);
  });
});

describe("item 2: exposure counts every reading with report text", () => {
  test("unexposed readings outside the matched rows lower exposure", () => {
    const { data, split } = dev(20, (rs) => {
      for (const t of ["t16", "t17", "t18"]) { of(rs, t, "current").exposed = false; gap(of(rs, t, "none")); }
      gap(of(rs, "t19", "current")); gap(of(rs, "t19", "none"));
    });
    const r = rule("compare", data, split);
    expect(line(r.out, /current - none:/)).toContain("exposure current 0.842");
  });
  test("other direction: a gap reading stays out of the denominator", () => {
    const { data, split } = dev(20, (rs) => { gap(of(rs, "t19", "current")); });
    expect(line(rule("compare", data, split).out, /current - none:/)).toContain("exposure current 1.000");
  });
});

describe("item 3: the calibration must be complete", () => {
  test("a sampled double read never attempted reads JUDGE FAIL", () => {
    const { data, split } = stage1((rs) => { delete rs.find((r) => r.second)!.second; });
    const r = rule("headroom", data, split);
    expect(r.verdict).toStartWith("JUDGE FAIL");
    expect(r.verdict).toContain("never attempted");
  });
  test("a planned control never attempted reads JUDGE FAIL", () => {
    const s = stage1();
    s.data.controls = controls(s.data.tasks, { skip: "t3:oracle:opus" });
    const r = rule("headroom", s.data, s.split);
    expect(r.verdict).toStartWith("JUDGE FAIL");
    expect(r.out).toContain("never attempted 1");
  });
  test("a second read on a reading the draw did not pick is refused", () => {
    const { data, split } = stage1((rs) => { const r = rs.find((x) => !x.second)!; r.second = { judge: "opus", status: "judged", facts: r.facts, responseIds: ["msg_extra"] }; });
    expect(rule("headroom", data, split).err).toContain("did not pick");
  });
  test("other direction: a second read or a control attempted and unjudged leaves the sample and keeps the verdict", () => {
    const s = stage1((rs) => { const r = rs.find((x) => x.second)!; r.second = { ...r.second, status: "unjudged", facts: [] }; });
    s.data.controls[0] = { ...s.data.controls[0], status: "unjudged", facts: [] };
    const r = rule("headroom", s.data, s.split);
    expect(r.verdict).toStartWith("HEADROOM");
    expect(r.out).toContain("unjudged 1");
  });
  test("the rule's draw is the stated one", async () => {
    const mod = (await import("../../lanes/tbv/rule.ts")) as Any;
    expect(typeof mod.doubleRead).toBe("function");
    for (let i = 0; i < 500; i++) expect(mod.doubleRead("r" + i)).toBe(picked("r" + i));
  });
});

describe("item 4: denominators come from the split manifest", () => {
  test("a task dropped from the tasks and the plan but held by the manifest is refused", () => {
    const all = [...Array(20)].map((_, i) => task("t" + i, "A", ["long", "short", "other"][i % 3]!, 4));
    const d = dev(19, () => {}, { tasks: all.slice(0, 19) });
    const f = file("dev", all.slice(0, 19), d.data.readings, { passes: 1, manifestTasks: all });
    const r = rule("compare", f.data, f.split);
    expect(r.refused).toBe(true);
    expect(r.err).toContain("split manifest");
  });
  test("compare and headroom need --split", () => {
    const d = dev(), s = stage1();
    expect(rule("compare", d.data).err).toContain("--split");
    expect(rule("headroom", s.data).err).toContain("--split");
  });
  test("a manifest that is not the one the plan records is refused", () => {
    const d = dev();
    expect(rule("compare", d.data, d.split.replace('"dev"', '"held"')).err).toContain("sha256");
  });
  test("other direction: the matching manifest runs", () => {
    const d = dev();
    expect(rule("compare", d.data, d.split).status).toBe(0);
  });
});

describe("item 5: judge routing, second judge and label counts", () => {
  test("a reading judged by the wrong judge is refused", () => {
    const d = dev(20, (rs) => { rs[0].judge = "opus"; });
    expect(rule("compare", d.data, d.split).err).toContain("are judged by sol");
  });
  test("a second read by the same judge is refused", () => {
    const d = dev(20, (rs) => { rs.find((r) => r.second)!.second.judge = "sol"; });
    expect(rule("compare", d.data, d.split).err).toContain("not the other judge");
  });
  test("a truncated second read is refused", () => {
    const d = dev(20, (rs) => { rs.find((r) => r.second)!.second.facts.pop(); });
    expect(rule("compare", d.data, d.split).err).toContain("second read has 3 fact labels");
  });
  test("a control with a truncated label list is refused", () => {
    const s = stage1();
    s.data.controls[0].facts.pop();
    expect(rule("headroom", s.data, s.split).err).toContain("fact labels for a task with 4");
  });
});

describe("item 6: a copied reading is refused by its response ids", () => {
  test("a copy given pass 2 is refused", () => {
    const d = dev(20, (rs) => { const r = of(rs, "t1", "current"); rs.push({ ...r, id: label("copy2", false), pass: 2 }); });
    d.data.plan.passes.opus = 2;
    expect(rule("compare", d.data, d.split).err).toContain("shares response id");
  });
  test("a reading with report text and no response id is refused", () => {
    const d = dev(20, (rs) => { rs[0].responseIds = []; });
    expect(rule("compare", d.data, d.split).err).toContain("no response ids");
  });
  test("other direction: a second pass with its own response ids runs", () => {
    const d = dev(20, (rs) => { const r = of(rs, "t1", "current"); rs.push({ ...r, id: label("pass2", false), pass: 2, responseIds: ["msg_pass2"] }); });
    d.data.plan.passes.opus = 2;
    expect(rule("compare", d.data, d.split).status).toBe(0);
  });
});

describe("item 7: list handling reads long-stratum tasks only", () => {
  test("a short-stratum reading with a list answer does not move the long-list rate", () => {
    const d = dev(20, (rs, ts) => {
      for (const r of rs) if (ts.find((t) => t.id === r.task)!.stratum === "long") r.list = { named: true, order: true, rest: true, offer: true };
      of(rs, "t1", "current").list = { named: false, order: false, rest: false, offer: false };
    });
    expect(line(rule("compare", d.data, d.split).out, /^secondary current:opus/)).toContain("list handling named 1.000 order 1.000");
  });
});

describe("item 16: a review-family task counts", () => {
  test("review readings enter the skill layer and print per family", () => {
    const ts = [...Array(16)].map((_, i) => task("t" + i, "A", ["long", "short", "other"][i % 3]!, 4, i % 2 ? { family: "review" } : {}));
    const d = dev(16, () => {}, { tasks: ts });
    const r = rule("compare", d.data, d.split);
    expect(r.out).toContain("per family review opus principle - none");
    expect(line(r.out, /principle - none:/)).toContain("coverage 1.000");
  });
  test("other direction: a review reading on an investigate task is refused", () => {
    const d = dev(20, (rs) => { rs[0].family = "review"; });
    expect(rule("compare", d.data, d.split).err).toContain("family review");
  });
});

const h = (heldIds: string[], devText: string, artifact: string) => ({ heldIds, devText, heldText: "x", artifact });
const L = (names: string[], addedLines: string[], gstackAtC = "") => ({ addedLines, gstackAtC, material: "unrelated", names });

describe("the underscore name gap (artifact side)", () => {
  test.each([
    ["held-repo-x", "see held_repo_x"],
    ["test_held_only", "calls test-held-only"],
    ["test_held_only", "the test held only once"],
    ["held_repo_x", "see held.repo.x"],
    ["held_repo_x", "see held::repo::x"],
  ])("%s written as %p blocks", (id, artifact) => {
    expect(rule("handoff", h([id], "x", artifact)).verdict).toStartWith("BLOCK");
  });
  test("the leak check's name side uses the same matcher", () => {
    expect(rule("leak", L(["held-repo-x"], ["see held_repo_x"])).verdict).toStartWith("HIT");
    expect(rule("leak", L(["test_held_only"], ["calls test-held-only"])).verdict).toStartWith("HIT");
  });
  test("a block names the identifier and where it sits", () => {
    expect(rule("handoff", h(["held-repo-x"], "x", "see held_repo_x now")).out).toContain('identifier "held-repo-x" at "see held_repo_x now"');
  });
  test("other direction: test_held inside my_test_held in dev stays held-out only", () => {
    expect(rule("handoff", h(["test_held"], "dev touches my_test_held", "mentions test_held")).verdict).toStartWith("BLOCK");
  });
});

describe("fix-check 3: markdown, XML and flag forms on the dev side", () => {
  test.each([
    ["src/x.ts", "edited **src/x.ts** today", "about src/x.ts"],
    ["src/x.ts", "- *src/x.ts* edited", "about src/x.ts"],
    ["src/x.ts", "<path>src/x.ts</path>", "about src/x.ts"],
    ["src/x.ts", "|src/x.ts|ok|", "about src/x.ts"],
    ["held-repo-x", "ran with --repo=held-repo-x", "see held-repo-x"],
  ])("dev citing %s as %p shares it", (id, devText, artifact) => {
    expect(rule("handoff", h([id], devText, artifact)).verdict).toBe("CLEAR");
  });
  test.each([
    ["held-repo-x", "is it held-repo-x? yes"],
    ["held-repo-x", "fixed held-repo-x!"],
    ["src/x.ts", "edited **c/src/x.ts** today"],
    ["src/x.ts", "glob *src/x.ts matched"],
    ["src/x.ts", "see **src/x.ts:42**"],
    ["held-repo-x", "ran with --repo=held-repo-x-2"],
    ["src/x.ts", "<path>src/x.ts.bak</path>"],
    ["src/errors/codes.ts", "see src/errors/codes.ts:42"],
    ["lodash", "installed lodash@4.17.21"],
  ])("other direction: dev citing %s as %p keeps it held-out only", (id, devText) => {
    expect(rule("handoff", h([id], devText, "about " + id)).verdict).toStartWith("BLOCK");
  });
});
