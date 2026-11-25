// Copyright (c) 2026 Garry Tan. MIT License.
// SR's keyless core: the BIC gates and the change under review on a scratch repo, the draw, the plan, the arms' turns,
// the readings, exposure, labels and the prereg reader.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyse, cells, look, verdictAt, type SrSession, type UnitFacts } from "../../lanes/outcome-skills/smreview/analysis.ts";
import { GSTACK, SR_ARMS, SR_MODELS, SUFFIX, TEXT, srLimits, srTaskTurn } from "../../lanes/outcome-skills/smreview/arms.ts";
import { findBic, stripped, trivial, type BicRecord } from "../../lanes/outcome-skills/smreview/bic.ts";
import { detectStateMachine } from "../../lanes/outcome-skills/smreview/detect.ts";
import { srDraw, srOrder } from "../../lanes/outcome-skills/smreview/draw.ts";
import { srExposure, SPECIALIST, ARMY } from "../../lanes/outcome-skills/smreview/exposure.ts";
import { labelsFromPublished, labelsFromReplies, labelsFromSmUnits } from "../../lanes/outcome-skills/smreview/labels.ts";
import { readSrPrereg } from "../../lanes/outcome-skills/smreview/prereg.ts";
import { srPlan } from "../../lanes/outcome-skills/smreview/session.ts";
import { labelsGate, readLabels, type Gate } from "../../lanes/outcome-skills/pfchecks/draw.ts";

const g = (dir: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...a], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(a.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
};
function repo(): { dir: string; bic: string; base: string; patch: string; tests: string } {
  const dir = mkdtempSync(join(tmpdir(), "sr-bic-"));
  g(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "flag"));
  const v = (reset: string, extra = "") => "package flag\n\nvar done = false\n\nfunc Run() {\n\tdone = true\n\treset(" + reset + ")\n" + extra + "}\n";
  writeFileSync(join(dir, "flag/flag.go"), v("true"));
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "a");
  writeFileSync(join(dir, "flag/flag.go"), v("false", "\tlog(done)\n"));
  writeFileSync(join(dir, "CLAUDE.md"), "notes\n");
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "bic");
  const bic = g(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "other.go"), "package flag\n");
  g(dir, "add", "-A"); g(dir, "commit", "-qm", "c");
  const base = g(dir, "rev-parse", "HEAD");
  writeFileSync(join(dir, "flag/flag.go"), v("true", "\tlog(done)\n"));
  writeFileSync(join(dir, "flag/flag_test.go"), "package flag\n");
  const patch = g(dir, "diff", "--", "flag/flag.go") + "\n";
  g(dir, "add", "-N", "flag/flag_test.go");
  const tests = g(dir, "diff", "--", "flag/flag_test.go") + "\n";
  g(dir, "checkout", "-q", "-f", base); spawnSync("git", ["clean", "-fdq"], { cwd: dir });
  return { dir, bic, base, patch, tests };
}

test("SZZ finds the BIC; the change under review is the BIC reversed at the fix base, stripped paths left out", () => {
  const r = repo();
  const u = findBic(r.dir, { instance_id: "o__r-1", repo: "o/r", base_commit: r.base, patch: r.patch, test_patch: r.tests }, "go");
  expect(u.record.drop).toBeNull();
  expect(u.record.bic).toBe(r.bic);
  expect(u.record.basis).toBe("deleted");
  expect(u.record.share).toBe(1);
  expect(u.record.in_pr).toBe(1);
  expect(u.record.pr_files).toEqual(["flag/flag.go"]);
  expect(u.record.pr_added).toBe(2);
  expect(u.record.pr_deleted).toBe(1);
  expect(u.record.kept).toBe(u.record.hunks!);
  expect(u.pr).toContain("+\treset(false)");
  expect(u.pr).not.toContain("CLAUDE.md");
  expect(u.pr).not.toContain("other.go");
});
test("a fix that only touches lines no commit before it wrote drops as E_SR_NO_BIC", () => {
  const r = repo();
  const u = findBic(r.dir, { instance_id: "o__r-2", repo: "o/r", base_commit: r.base, patch: "", test_patch: r.tests }, "go");
  expect(u.record.drop).toBe("E_SR_NO_BIC");
  expect(u.pr).toBe("");
});
test("strip rule and trivial lines", () => {
  expect([".claude/x", "a/CLAUDE.md", "AGENTS.md", "CLAUDE.local.md", "src/claude.ts"].map(stripped)).toEqual([true, true, true, true, false]);
  expect(["}", "  );", "else", "return;", "x = 1"].map(trivial)).toEqual([true, true, true, true, false]);
});
test("the vendored detector fires on its subject and action words in added code lines only", () => {
  const d = (path: string, line: string) => "+++ b/" + path + "\n@@ -1,0 +1,1 @@\n+" + line + "\n";
  expect(detectStateMachine(d("src/x.go", "if pendingApproval { rejectProposal() }")).detected).toBe(true);
  expect(detectStateMachine(d("src/x_test.go", "if pendingApproval { rejectProposal() }")).detected).toBe(false);
  expect(detectStateMachine(d("src/x.go", "reset = false")).detected).toBe(false);
});

const bicOf = (id: string, repo: string, drop: BicRecord["drop"] = null) => ({ id, repo, drop }) as BicRecord;
const pass: Gate = { name: "all", check: () => ({ ok: true }) };
test("draw: one seeded order, 6 pilot units then the test set, at most 3 a repository, a pending gate stops the walk", () => {
  const bs = Array.from({ length: 60 }, (_, i) => bicOf("u" + String(i).padStart(2, "0"), "r" + (i % 12)));
  expect(srOrder(bs.map((b) => b.id), 9)).toEqual(srOrder([...bs].reverse().map((b) => b.id), 9));
  const d = srDraw([...bs, bicOf("x", "r0", "E_SR_BIC_SIZE")], 9, [pass]);
  expect(d.pilot.length).toBe(6);
  expect(d.test.length).toBe(30);
  expect(d.order).not.toContain("x");
  const per = new Map<string, number>();
  for (const id of [...d.pilot, ...d.test]) per.set(bs.find((b) => b.id === id)!.repo, (per.get(bs.find((b) => b.id === id)!.repo) ?? 0) + 1);
  expect(Math.max(...per.values())).toBe(3);
  const stop = srDraw(bs, 9, [{ name: "labels", check: (id) => (id === d.order[2] ? { pending: true, why: "no label record" } : { ok: true }) }]);
  expect(stop.pending?.id).toBe(d.order[2]!);
  expect(stop.pilot.length).toBe(2);
  expect(() => srDraw([bicOf("a", "r"), bicOf("a", "r")], 1, [pass])).toThrow(/E_SR_INPUT/);
});
test("plan: every model and arm per unit, one session a cell in the pilot and two in the counted run, items by part and model", () => {
  const p = srPlan(["a", "b"], 5, "pilot");
  expect(p.length).toBe(2 * SR_MODELS.length * SR_ARMS.length);
  expect(new Set(p.map((s) => s.item))).toEqual(new Set(["sr-pilot"]));
  const t = srPlan(["a", "b"], 5, "test");
  expect(t.length).toBe(2 * SR_MODELS.length * SR_ARMS.length * 2);
  expect(new Set(t.map((s) => s.item))).toEqual(new Set(["sr-opus", "sr-particle"]));
  expect(t.slice(0, 20).every((s) => s.unit === "a")).toBe(true);
  expect(srPlan(["a", "b"], 5, "test")).toEqual(t);
  expect(srPlan(["a", "b"], 6, "test")).not.toEqual(t);
});
test("arms: each turn is the arm's text then the suffix; G+ and G0 are /review; limits per model", () => {
  for (const a of SR_ARMS) expect(srTaskTurn(a).endsWith(SUFFIX)).toBe(true);
  expect(TEXT["G+"]).toBe("/review");
  expect(TEXT.G0).toBe("/review");
  expect(srTaskTurn("N")).toBe(TEXT.N + "\n\n" + SUFFIX);
  expect(GSTACK["G+"]).not.toBe(GSTACK.G0);
  expect(srLimits(SR_MODELS[0]).task.max_turns).toBe(250);
  expect(() => srLimits("other")).toThrow();
});

const S = (unit: string, model: string, arm: SrSession["arm"], score: 0 | 1 | null, gap: string | null = null): SrSession => ({ unit, repo: "r-" + unit, model, arm, score, gap, exposure: null, false_alarms: 0, checks: 1 });
test("readings: G is G+ where the detector fires and G0 elsewhere; small PRs leave the no_small_pr reading", () => {
  const m = SR_MODELS[0];
  const facts = new Map<string, UnitFacts>([["a", { id: "a", repo: "r-a", detected: true, pr_lines: 40 }], ["b", { id: "b", repo: "r-b", detected: false, pr_lines: 8 }]]);
  const ss = [S("a", m, "G+", 1), S("a", m, "G0", 0), S("b", m, "G+", 1), S("b", m, "G0", 0)];
  const c = cells(ss, facts, "primary");
  expect(c.get("a|" + m + "|G")!.value).toBe(1);
  expect(c.get("b|" + m + "|G")!.value).toBe(0);
  expect([...cells(ss, facts, "no_small_pr").keys()].some((k) => k.startsWith("b|"))).toBe(false);
  expect(cells([S("a", m, "N", null, "E_PF_ARM")], facts, "arm_refusal_as_miss").get("a|" + m + "|N")!.value).toBe(0);
  expect(cells([S("a", m, "N", null, "UPSTREAM")], facts, "arm_refusal_as_miss").size).toBe(0);
  expect(cells([S("a", m, "N", null, "UPSTREAM")], facts, "gaps_as_miss").get("a|" + m + "|N")!.value).toBe(0);
});
test("verdicts, the decision and the one look", () => {
  expect(verdictAt([0.1, 0.3], 0.01, 0.049, false)).toBe("HELPS");
  expect(verdictAt([-0.3, -0.1], 0.01, 0.049, false)).toBe("HURTS");
  expect(verdictAt([0.1, 0.3], 0.06, 0.049, false)).toBe("NO MEASURABLE DIFFERENCE");
  expect(verdictAt([0.1, 0.3], 0.01, 0.049, true)).toBe("INCOMPLETE");
  const units: UnitFacts[] = Array.from({ length: 24 }, (_, i) => ({ id: "u" + i, repo: "r" + i, detected: i % 2 === 0, pr_lines: 30 }));
  const ss = units.flatMap((u) => SR_MODELS.flatMap((m) => SR_ARMS.map((a) => ({ ...S(u.id, m, a, a === "G+" ? 1 : 0), repo: u.repo }))));
  const an = analyse(ss, units, 3, SR_MODELS);
  expect(an.contrasts[0]!.a).toBe("G0");
  expect(an.contrasts[0]!.delta).toBe(1);
  expect(an.decision).toBe("WIDEN");
  const l = look(ss, units, units.map((u) => u.id), 3, SR_MODELS);
  expect(l.units).toBe(12);
  expect(l.stop).toBe(true);
  const half = look(ss.filter((s) => ["u0", "u1", "u2", "u3", "u4", "u5"].includes(s.unit)), units, units.map((u) => u.id), 3, SR_MODELS);
  expect(half.stop).toBe(false);
});
test("exposure: G+ ran the part when the specialist file was read or its matrix helper ran; G0 is clean without either", () => {
  const use = (name: string, input: Record<string, unknown>) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
  const g1 = srExposure("G+", [use("Read", { file_path: ARMY }), use("Read", { file_path: SPECIALIST })]);
  expect([g1.army, g1.specialist_read, g1.ran, g1.part_under_test]).toEqual([true, true, true, "ran"]);
  const g2 = srExposure("G+", [use("Bash", { command: "gstack-state-matrix check x.json" })]);
  expect(g2.matrix_ran).toBe(true);
  const g0 = srExposure("G0", [use("Read", { file_path: ARMY })]);
  expect([g0.ran, g0.part_under_test]).toEqual([false, "absent"]);
});
test("labels: the state machines eval's records and SR's replies both feed pstack-checks' labels gate, failing closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sr-labels-"));
  const sm = labelsFromSmUnits([{ id: "a", labels: { defect: ["yes", "yes"], state_shaped: ["yes", "yes"], malformed: [], packet: "p1" } }, { id: "b", labels: { defect: ["yes", "no"], state_shaped: ["no", "no"], malformed: ["opus"], packet: "p2" } }, { id: "z", labels: {} }], new Set(["a", "b"]), "t");
  expect(sm.labels.b!.opus).toBeNull();
  const keys = [{ schema: "sm-label-key.v1", packet: "p3", unit: "c" }, { schema: "sm-label-key.v1", packet: "p4", unit: "d" }];
  const yes = { defect: "yes", state_shaped: "yes", reason: "r" };
  const rp = labelsFromReplies(keys, [{ event: "reply", packet: "p3", reader: "astra", outcome: "uncharged", answer: null }, { event: "reply", packet: "p3", reader: "astra", outcome: "answered", answer: yes }, { event: "reply", packet: "p3", reader: "opus", outcome: "answered", answer: yes }, { event: "reply", packet: "p4", reader: "opus", outcome: "malformed", answer: null }], "t");
  expect(rp.labels.d).toEqual({ astra: null, opus: null });
  writeFileSync(join(dir, "sm.json"), JSON.stringify(sm));
  writeFileSync(join(dir, "sr.json"), JSON.stringify(rp));
  const gate = labelsGate(readLabels([join(dir, "sm.json"), join(dir, "sr.json")]));
  expect(["a", "b", "c", "d", "e"].map((id) => JSON.stringify(gate.check(id)))).toEqual([JSON.stringify({ ok: true }), JSON.stringify({ ok: false, code: "E_PF_LABELS", reason: "malformed" }), JSON.stringify({ ok: true }), JSON.stringify({ ok: false, code: "E_PF_LABELS", reason: "malformed" }), JSON.stringify({ pending: true, why: "no label record" })]);
  expect(() => labelsFromReplies(keys, [{ event: "reply", packet: "p9", reader: "opus", outcome: "answered", answer: yes }], "t")).toThrow(/E_SR_INPUT/);
});
test("prereg: sr-prereg.v1 seeds, and pins that must match the code", () => {
  const dir = mkdtempSync(join(tmpdir(), "sr-prereg-"));
  const p = join(dir, "prereg.json");
  writeFileSync(p, JSON.stringify({ schema: "sr-prereg.v1", draw_seed: 1, order_seed: 2, bootstrap_seed: 3, pins: { gstack: { pin: GSTACK.pin, "G+": GSTACK["G+"], G0: GSTACK.G0 } } }));
  expect(readSrPrereg(p)).toEqual({ draw_seed: 1, order_seed: 2, bootstrap_seed: 3 });
  writeFileSync(p, JSON.stringify({ schema: "sr-prereg.v1", draw_seed: 1, order_seed: 2, bootstrap_seed: 3, pins: { gstack: { G0: "0".repeat(40) } } }));
  expect(() => readSrPrereg(p)).toThrow(/E_SR_INPUT/);
  writeFileSync(p, JSON.stringify({ schema: "sr-prereg.v1", draw_seed: -1, order_seed: 2, bootstrap_seed: 3 }));
  expect(() => readSrPrereg(p)).toThrow(/E_SR_INPUT/);
});

test("a later edit next to the BIC's lines still leaves its hunk in the change under review (no context lines)", () => {
  const r = repo();
  const f = join(r.dir, "flag/flag.go");
  const t = readFileSync(f, "utf8").replace("\tdone = true\n", "\tdone = true // set\n");
  writeFileSync(f, t);
  g(r.dir, "commit", "-qam", "later edit beside the bug");
  const base = g(r.dir, "rev-parse", "HEAD");
  writeFileSync(f, t.replace("reset(false)", "reset(true)"));
  const patch = g(r.dir, "diff", "--", "flag/flag.go") + "\n";
  g(r.dir, "checkout", "-q", "-f", base);
  const u = findBic(r.dir, { instance_id: "o__r-3", repo: "o/r", base_commit: base, patch, test_patch: r.tests }, "go");
  expect(u.record.drop).toBeNull();
  expect(u.record.left_out).toEqual([]);
  expect(u.pr).toContain("+\treset(false)");
});
test("labels a results post lists as passed count as both readers' yes", () => {
  const f = labelsFromPublished("# note\nunit\tmonth\na\t2025-06\nb\t2025-07\n", new Set(["a"]), "units.tsv");
  expect(Object.keys(f.labels)).toEqual(["a"]);
  expect(f.labels.a!.astra!.state_shaped).toBe("yes");
});
