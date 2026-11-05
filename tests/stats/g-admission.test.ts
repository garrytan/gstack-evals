import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitG, authPaidFromLedger, t1WritesOutsidePlan, unknownFromRun, type AdmissionInput, type SliceTrial } from "../../src/runner/stats/g-admission.ts";
import { m1Decide, meteredPricer, renderResizeMetered } from "../../src/runner/stats/g-resize.ts";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";

const NONE = "none", PER = "told-plan-eng-review", AP = "told-autoplan";
const LABELS = Array.from({ length: 12 }, (_, i) => "t" + String(i).padStart(2, "0"));
const COST: Record<string, number> = { [NONE]: 0.955, [PER]: 2.101, [AP]: 4.775 };
const SAMPLE = LABELS.slice(0, 8).map((task) => ({ task, trial: 1 }));

/** The slice: 12 tasks x 2 trials per arm; none solves its first trial on every task (12 of 24). */
function slice(): SliceTrial[] {
  return [NONE, PER, AP].flatMap((arm) => LABELS.flatMap((task, i) => [1, 2].map((n): SliceTrial => ({
    task, repo: "repo" + Math.floor(i / 2), arm, trial: n, status: "scored", solved: arm === NONE ? n === 1 : true, truncated: false,
    cost_usd: COST[arm]!, exposed: arm === NONE ? null : true, mutation: "scored", verifier_ran: true, stop_explained: null,
  }))));
}
const edit = (trials: SliceTrial[], hit: (t: SliceTrial, index: number) => boolean, patch: Partial<SliceTrial>) => {
  const counts = new Map<string, number>();
  return trials.map((t) => {
    const i = counts.get(t.arm) ?? 0;
    counts.set(t.arm, i + 1);
    return hit(t, i) ? { ...t, ...patch } : t;
  });
};
const input = (trials: SliceTrial[], o: Partial<AdmissionInput> = {}): AdmissionInput => ({
  arms: { none: NONE, told: { "plan-eng-review": PER, autoplan: AP } }, trials, planned_trials: 24,
  exposure_sample: { "plan-eng-review": SAMPLE, autoplan: SAMPLE }, auth_paid_usd: 1.39, auth_extra_usd: 1.2,
  unknown_calls: { none: { calls: 0, micros: 0 }, "plan-eng-review": { calls: 0, micros: 0 }, autoplan: { calls: 0, micros: 0 } }, ...o,
});
const noneSolved = (k: number) => {
  let i = 0;
  return slice().map((t) => (t.arm === NONE ? { ...t, solved: i++ < k } : t));
};

describe("G admission, plan v3 section 6 and the prereg's section 6", () => {
  test("a slice that passes every item goes to stage 4 at the design M1 prints", () => {
    const a = admitG(input(slice()));
    for (const s of ["plan-eng-review", "autoplan"] as const) {
      expect(a.skills[s].failed).toBeNull();
      expect(a.skills[s].items.map((x) => x.pass)).toEqual([true, true, true, true, true]);
    }
    const o = m1Decide(meteredPricer(a.metered.inputs), []);
    expect(a.skills["plan-eng-review"].design).toEqual(o.runs["plan-eng-review"]);
    expect(a.skills.autoplan.design).toEqual(o.runs.autoplan);
    expect(a.metered.inputs.MULT).toBeCloseTo(5, 12);
    expect(a.metered.inputs.M_PER).toBeCloseTo(2.2, 12);
    expect(a.metered.inputs.M_AP).toBeCloseTo(5, 12);
    expect(a.resize_text).toBe(renderResizeMetered(a.metered.inputs));
  });

  test("item 1, headroom: 5 to 19 of 24 pass; 4 stops both skills as floor, 20 as saturation", () => {
    expect(admitG(input(noneSolved(5))).skills.autoplan.items[0]!.pass).toBe(true);
    expect(admitG(input(noneSolved(19))).skills.autoplan.items[0]!.pass).toBe(true);
    const floor = admitG(input(noneSolved(4)));
    for (const s of ["plan-eng-review", "autoplan"] as const) expect([floor.skills[s].failed, floor.skills[s].route, floor.skills[s].design]).toEqual([1, "FIX-METHOD (floor)", null]);
    const sat = admitG(input(noneSolved(20)));
    expect(sat.skills["plan-eng-review"].route).toBe("FIX-METHOD (saturation)");
    expect(sat.skills.autoplan.route).toBe("FIX-METHOD (saturation)");
  });

  test("item 2, exposure: 7 of 8 sampled pass; 6 stops that skill, and the other re-sizes alone", () => {
    const seven = edit(slice(), (t) => t.arm === AP && t.task === "t00" && t.trial === 1, { exposed: false });
    expect(admitG(input(seven)).skills.autoplan.items[1]!.pass).toBe(true);
    const six = edit(seven, (t) => t.arm === AP && t.task === "t01" && t.trial === 1, { exposed: false });
    const a = admitG(input(six));
    expect([a.skills.autoplan.failed, a.skills.autoplan.route]).toEqual([2, "FIX-METHOD (exposure)"]);
    const alone = m1Decide(meteredPricer(a.metered.inputs), ["autoplan"]);
    expect(alone.runs["plan-eng-review"]).not.toBeNull();
    expect(a.skills["plan-eng-review"].design).toEqual(alone.runs["plan-eng-review"]);
    const per = admitG(input(edit(six, (t) => t.arm === PER && (t.task === "t00" || t.task === "t01") && t.trial === 1, { exposed: false })));
    expect(per.skills["plan-eng-review"].route).toBe("FIX-METHOD (exposure)");
    expect(per.skills["plan-eng-review"].design).toBeNull();
  });

  test("item 2's sample must be 8 told trials on 8 tasks, each scored and read by the detector", () => {
    expect(() => admitG(input(slice(), { exposure_sample: { "plan-eng-review": SAMPLE.slice(1), autoplan: SAMPLE } }))).toThrow(/8/);
    expect(() => admitG(input(slice(), { exposure_sample: { "plan-eng-review": [...SAMPLE.slice(1), { task: "t01", trial: 2 }], autoplan: SAMPLE } }))).toThrow(/twice/);
    const gap = edit(slice(), (t) => t.arm === PER && t.task === "t03" && t.trial === 1, { status: "gap", mutation: null });
    expect(() => admitG(input(gap))).toThrow(/not a scored/);
  });

  test("items read in order and stop at the first failure: an item 1 floor with a malformed or gap-holding sample prints its readings", () => {
    const gapped = edit(noneSolved(4), (t) => t.arm === PER && t.task === "t00" && t.trial === 1, { status: "gap" });
    for (const a of [admitG(input(gapped)), admitG(input(noneSolved(4), { exposure_sample: { "plan-eng-review": SAMPLE.slice(1), autoplan: SAMPLE } }))]) {
      for (const s of ["plan-eng-review", "autoplan"] as const) {
        expect([a.skills[s].failed, a.skills[s].route, a.skills[s].design]).toEqual([1, "FIX-METHOD (floor)", null]);
        expect(a.skills[s].items.map((x) => x.pass)).toEqual([false, null, null, null, null]);
      }
    }
  });

  test("an unreplaced gap in the exposure sample throws even when the told arm's gaps pass item 4's limit: admission never infers that section 5's replacement ran out", () => {
    const trials = edit(slice(), (t) => t.arm === PER && t.trial === 1 && ["t00", "t01", "t02"].includes(t.task), { status: "gap" });
    expect(() => admitG(input(trials))).toThrow(/replace it as prereg section 5 says/);
    const two = edit(slice(), (t) => t.arm === PER && t.trial === 1 && ["t00", "t11"].includes(t.task), { status: "gap" });
    expect(() => admitG(input(two))).toThrow(/replace it as prereg section 5 says/);
  });

  test("a sample repaired by section 5's replacement reads item 2 and routes by it, with the told arm's gaps past item 4's limit", () => {
    const gaps = edit(slice(), (t) => t.arm === PER && t.trial === 1 && ["t00", "t11"].includes(t.task), { status: "gap" });
    const trials = edit(gaps, (t) => t.arm === PER && t.trial === 1 && ["t01", "t02"].includes(t.task), { exposed: false });
    const repaired = [{ task: "t00", trial: 2 }, ...SAMPLE.slice(1)];
    const p = admitG(input(trials, { exposure_sample: { "plan-eng-review": repaired, autoplan: SAMPLE } })).skills["plan-eng-review"];
    expect([p.failed, p.route]).toEqual([2, "FIX-METHOD (exposure)"]);
    expect(p.items[1]!.reading).toMatch(/^6 of 8 sampled told trials exposed/);
    expect(p.items[3]!.pass).toBeNull();
  });

  for (const [skill, arm, key] of [["plan-eng-review", PER, "M_PER"], ["autoplan", AP, "M_AP"]] as const) {
    test("a told arm with no scored trial is refused instead of leaving " + key + " out of item 5, even when an earlier item already stopped it (GST-1374)", () => {
      const trials = edit(noneSolved(4), (t) => t.arm === arm, { status: "gap", cost_usd: null, mutation: null, exposed: null });
      expect(() => admitG(input(trials))).toThrow(new RegExp(skill + ":? .*no scored trial.*" + key));
    });
  }
  test("item 5's AUTH_PAID and AUTH_EXTRA are refused up front outside the (0, 1000) range resize.py reads", () => {
    expect(() => admitG(input(slice(), { auth_extra_usd: 0 }))).toThrow(/auth_extra_usd/);
    expect(() => admitG(input(slice(), { auth_paid_usd: 1000 }))).toThrow(/auth_paid_usd/);
    expect(admitG(input(slice(), { auth_extra_usd: 0.01 })).metered.inputs.AUTH_EXTRA).toBe(0.01);
  });

  test("item 3, instruments: 90% of trees scored without a tool error passes; less, or a tree without a verifier run, fails", () => {
    const four = edit(slice(), (t, i) => t.arm === AP && i < 4, { mutation: "tool_error" });
    expect(admitG(input(four)).skills.autoplan.items[2]!.pass).toBe(true);
    const five = edit(slice(), (t, i) => t.arm === AP && i < 5, { mutation: "tool_error" });
    expect(admitG(input(five)).skills.autoplan.route).toBe("FIX-METHOD (instrument)");
    expect(admitG(input(five)).skills["plan-eng-review"].items[2]!.pass).toBe(true);
    expect(admitG(input(edit(slice(), (t, i) => t.arm === PER && i < 10, { mutation: "no_tests" }))).skills["plan-eng-review"].items[2]!.pass).toBe(true);
    expect(admitG(input(edit(slice(), (t, i) => t.arm === PER && i === 3, { verifier_ran: false }))).skills["plan-eng-review"].failed).toBe(3);
  });

  test("item 4, rig: one gap per arm passes; two, or an unexplained arm stop, fail; none's gaps fail both", () => {
    const one = edit(slice(), (t, i) => t.arm === PER && i === 23, { status: "gap", mutation: null });
    expect(admitG(input(one)).skills["plan-eng-review"].items[3]!.pass).toBe(true);
    const two = edit(slice(), (t, i) => t.arm === PER && i >= 22, { status: "gap", mutation: null });
    expect(admitG(input(two)).skills["plan-eng-review"].route).toBe("FIX-METHOD (rig)");
    const none2 = edit(slice(), (t, i) => t.arm === NONE && i >= 22, { status: "gap", mutation: null });
    const b = admitG(input(none2));
    expect([b.skills["plan-eng-review"].failed, b.skills.autoplan.failed]).toEqual([4, 4]);
    const stop = edit(slice(), (t, i) => t.arm === AP && i === 20, { truncated: true, solved: false, stop_explained: false });
    expect(admitG(input(stop)).skills.autoplan.failed).toBe(4);
    const explained = edit(slice(), (t, i) => t.arm === AP && i === 20, { truncated: true, solved: false, stop_explained: true });
    expect(admitG(input(explained)).skills.autoplan.failed).toBeNull();
  });

  test("item 5, price and power: a told arm too dear for any design stops as FIX-METHOD (price), and the survivor re-sizes alone", () => {
    const dear = edit(slice(), (t) => t.arm === AP, { cost_usd: 0.955 * 30 });
    const a = admitG(input(dear));
    expect([a.skills.autoplan.failed, a.skills.autoplan.route]).toEqual([5, "FIX-METHOD (price)"]);
    expect(a.skills["plan-eng-review"].design).toEqual(m1Decide(meteredPricer(a.metered.inputs), []).runs["plan-eng-review"]);
    expect(a.skills["plan-eng-review"].design).not.toBeNull();
  });

  test("told means print exposed and unexposed apart, and a scored trial with no meter record is refused", () => {
    const mixed = edit(slice(), (t, i) => t.arm === PER && i >= 20, { exposed: false, cost_usd: 1.5 });
    const a = admitG(input(mixed));
    expect(a.metered.told["plan-eng-review"].unexposed_usd).toBeCloseTo(1.5, 12);
    expect(a.metered.told["plan-eng-review"].exposed_usd).toBeCloseTo(2.101, 12);
    expect(a.metered.told["plan-eng-review"].all_usd).toBeCloseTo((20 * 2.101 + 4 * 1.5) / 24, 12);
    expect(() => admitG(input(edit(slice(), (t, i) => t.arm === NONE && i === 0, { cost_usd: null })))).toThrow(/meter/);
  });

  test("item 5's means are settled spend, and calls of unknown cost on each arm's leases print beside them, counted", () => {
    const unknown = { none: { calls: 0, micros: 0 }, "plan-eng-review": { calls: 1, micros: 640_912 }, autoplan: { calls: 2, micros: 1_500_000 } };
    const a = admitG(input(slice(), { unknown_calls: unknown }));
    expect(a.metered.unknown_calls).toEqual(unknown);
    for (const [key, want] of [["MULT", 0.955 / 0.191], ["M_PER", 2.101 / 0.955], ["M_AP", 4.775 / 0.955]] as const) expect(a.metered.inputs[key]).toBeCloseTo(want, 12);
    expect(a.skills["plan-eng-review"].items[4]!.reading).toContain("calls of unknown cost, left out of the metered means: none 0 ($0.00 held), told 1 ($0.640912 held)");
    expect(a.skills.autoplan.items[4]!.reading).toContain("told 2 ($1.50 held)");
    expect(() => admitG(input(slice(), { unknown_calls: undefined as never }))).toThrow(/unknown cost/);
    expect(() => admitG(input(slice(), { unknown_calls: { ...unknown, autoplan: { calls: -1, micros: 0 } } }))).toThrow(/unknown cost/);
    expect(() => admitG(input(slice(), { unknown_calls: { ...unknown, none: { calls: 1, micros: 0.5 } } }))).toThrow(/unknown cost/);
  });

  test("told trials that wrote outside PLAN.md in t1 print beside exposure, report only: no item, route or design moves", () => {
    const read = edit(slice(), (t) => t.arm !== NONE, { t1_outside_plan: false });
    const wrote = edit(read, (t, i) => t.arm === PER && i < 3, { t1_outside_plan: true });
    const unread = edit(wrote, (t, i) => t.arm === AP && i < 2, { t1_outside_plan: null });
    const base = admitG(input(slice()));
    const a = admitG(input(unread));
    expect(a.skills["plan-eng-review"].t1_outside_plan).toEqual({ wrote: 3, read: 24 });
    expect(a.skills.autoplan.t1_outside_plan).toEqual({ wrote: 0, read: 22 });
    expect(base.skills["plan-eng-review"].t1_outside_plan).toEqual({ wrote: 0, read: 0 });
    expect(a.skills["plan-eng-review"].items[1]!.reading).toMatch(/^8 of 8 sampled told trials exposed .*; report only: 3 of 24 told trials wrote outside PLAN\.md in t1$/);
    expect(a.skills.autoplan.items[1]!.reading).toMatch(/; report only: 0 of 22 told trials wrote outside PLAN\.md in t1 \(2 not read\)$/);
    for (const s of ["plan-eng-review", "autoplan"] as const) {
      expect(a.skills[s].items.map((x) => x.pass)).toEqual(base.skills[s].items.map((x) => x.pass));
      expect([a.skills[s].failed, a.skills[s].route, a.skills[s].design]).toEqual([base.skills[s].failed, base.skills[s].route, base.skills[s].design]);
    }
    const stopped = admitG(input(edit(noneSolved(4), (t, i) => t.arm === PER && i < 3, { t1_outside_plan: true })));
    expect(stopped.skills["plan-eng-review"].t1_outside_plan).toEqual({ wrote: 3, read: 3 });
    expect(stopped.skills["plan-eng-review"].items[1]!.pass).toBeNull();
  });
});

describe("t1 writes outside PLAN.md, from the phase-tagged records (report only, G ruling A on red-team #1)", () => {
  const use = (phase: string, id: string, name: string, input: Record<string, unknown>, parent: string | null = null) => ({ type: "AssistantMessage", phase, parent_tool_use_id: parent, content: [{ type: "tool_use", id, name, input }] });
  const result = (phase: string, id: string, content: string, is_error = false, parent: string | null = null) => ({ type: "UserMessage", phase, parent_tool_use_id: parent, content: [{ type: "tool_result", tool_use_id: id, content, is_error }] });
  const bash = (id: string, command: string, phase = "t1") => use(phase, id, "Bash", { command });

  test("an edit tool's write outside PLAN.md in t1 counts, a subagent's included; PLAN.md, later turns, failed edits and reads don't", () => {
    expect(t1WritesOutsidePlan([
      use("t1", "a", "Write", { file_path: "/testbed/PLAN.md", content: "# Plan" }), result("t1", "a", "ok"),
      use("t1", "b", "Edit", { file_path: "/testbed/docs/PLAN.md", old_string: "a", new_string: "b" }), result("t1", "b", "ok"),
      use("t1", "c", "Read", { file_path: "/testbed/src/app.ts" }), result("t1", "c", "..."),
      use("t1", "d", "Edit", { file_path: "/testbed/src/app.ts", old_string: "x", new_string: "y" }), result("t1", "d", "String not found", true),
      use("t1", "e", "Write", { file_path: "/testbed/src/new.ts", content: "x" }), result("t1", "e", "<tool_use_error>denied</tool_use_error>"),
      use("t2", "f", "Write", { file_path: "/testbed/src/later.ts", content: "x" }), result("t2", "f", "ok"),
      use("t3", "g", "Edit", { file_path: "/testbed/src/app.ts", old_string: "x", new_string: "y" }), result("t3", "g", "ok"),
    ])).toEqual([]);
    expect(t1WritesOutsidePlan([
      use("t1", "a", "Write", { file_path: "/testbed/src/app.ts", content: "x" }), result("t1", "a", "ok"),
      use("t1", "b", "MultiEdit", { file_path: "/testbed/src/b.ts", edits: [] }), result("t1", "b", "ok", false, "agent1"),
      use("t1", "c", "NotebookEdit", { notebook_path: "/testbed/n.ipynb", new_source: "x" }),
      use("t1", "d", "Edit", { file_path: "/testbed/PLAN.md.bak", old_string: "a", new_string: "b" }, "agent1"), result("t1", "d", "ok", false, "agent1"),
    ])).toEqual(["Write /testbed/src/app.ts", "MultiEdit /testbed/src/b.ts", "NotebookEdit /testbed/n.ipynb", "Edit /testbed/PLAN.md.bak"]);
  });

  test("a Bash call counts when it redirects into a file, tees or edits in place, even when it exits non-zero; PLAN.md, /dev/null, heredoc bodies and quoted text don't", () => {
    expect(t1WritesOutsidePlan([
      bash("a", "cat > PLAN.md <<'EOF'\n# Plan\nif a > b: use x\nEOF"),
      bash("b", "pytest -q 2>&1 | tail -5; ls > /dev/null"),
      bash("c", "python3 -c \"print(1 if 3 > 2 else 0)\""),
      bash("d", "grep -rn 'a > b' src/"),
      bash("e", "cat > src/app.py <<EOF\nprint(1)\nEOF", "t3"),
      bash("f", "sed -i 's/a/b/' PLAN.md"),
      bash("g", "perl -pi -e 's/a/b/' PLAN.md"),
      bash("h", "grep 'a > \"b\"' src/app.ts"),
      bash("i", "cat PLAN.md | tee /dev/stderr"),
    ])).toEqual([]);
    expect(t1WritesOutsidePlan([
      bash("a", "mkdir -p src && cat > src/app.py <<'EOF'\nprint(1)\nEOF"), result("t1", "a", "exit 1", true),
      bash("b", "echo x >> \"notes/todo.txt\""),
      bash("c", "printf '%s' x | tee -a src/log.ts"),
      bash("d", "sed -i 's/a/b/' src/app.ts"),
      bash("e", "git apply fix.patch"),
      bash("f", "echo x > /tmp/scratch.txt"),
      bash("g", "echo x > PLAN.md"),
      bash("h", "sed -i.bak -e 's/a/b/' PLAN.md src/b.ts"),
      bash("i", "printf x | tee \"src/c.ts\""),
      bash("j", "FOO=1 echo x 1> 'src/d.ts' 2> err.log"),
    ])).toEqual(["Bash > src/app.py", "Bash > notes/todo.txt", "Bash tee src/log.ts", "Bash edit: sed -i 's/a/b/' src/app.ts", "Bash edit: git apply fix.patch", "Bash > /tmp/scratch.txt", "Bash edit: sed -i.bak -e 's/a/b/' PLAN.md src/b.ts", "Bash tee src/c.ts", "Bash > src/d.ts"]);
  });

  test("a write behind a shell keyword or a wrapper counts, and bash -c reads its script; sed -i under xargs counts, since its files come from stdin", () => {
    expect(t1WritesOutsidePlan([
      bash("a", "for f in a; do sed -i 's/a/b/' PLAN.md; done"),
      bash("b", "if true; then sed -i 's/a/b/' PLAN.md; fi"),
      bash("c", "echo x | sudo tee -a PLAN.md"),
      bash("d", "timeout 5 grep -rn tee src"),
      bash("e", "echo sudo sed -i s/a/b/ src/a.ts"),
      bash("f", "bash -c \"sed -i 's/a/b/' PLAN.md\""),
      bash("g", "env LC_ALL=C sed -n 1p src/a.ts"),
      bash("h", "ls | xargs grep -l tee"),
    ])).toEqual([]);
    expect(t1WritesOutsidePlan([
      bash("a", "for f in src/*.ts; do sed -i 's/a/b/' \"$f\"; done"),
      bash("b", "find . -name '*.ts' | xargs sed -i 's/a/b/'"),
      bash("c", "echo x | sudo -u root tee src/x.ts"),
      bash("d", "env LC_ALL=C timeout 10 perl -pi -e 's/a/b/' src/y.ts"),
      bash("e", "if [ -f x ]; then sed -i 's/a/b/' src/z.ts; fi"),
      bash("f", "{ printf x | tee src/w.ts; }"),
      bash("g", "bash -c \"sed -i 's/a/b/' src/v.ts\""),
      bash("h", "xargs -0 -I {} sed -i 's/a/b/' {} < files.txt"),
      bash("i", "sudo bash -lc 'echo x > src/t.ts'"),
      bash("j", "nohup sed -i 's/a/b/' src/u.ts &"),
      bash("k", "echo x | sudo -E tee src/s.ts"),
    ])).toEqual([
      "Bash edit: for f in src/*.ts; do sed -i 's/a/b/' \"$f\"; done",
      "Bash edit: find . -name '*.ts' | xargs sed -i 's/a/b/'",
      "Bash tee src/x.ts",
      "Bash edit: env LC_ALL=C timeout 10 perl -pi -e 's/a/b/' src/y.ts",
      "Bash edit: if [ -f x ]; then sed -i 's/a/b/' src/z.ts; fi",
      "Bash tee src/w.ts",
      "Bash edit: sed -i 's/a/b/' src/v.ts",
      "Bash edit: xargs -0 -I {} sed -i 's/a/b/' {} < files.txt",
      "Bash > src/t.ts",
      "Bash edit: nohup sed -i 's/a/b/' src/u.ts &",
      "Bash tee src/s.ts",
    ]);
  });

  test("sed's and perl's options read as GNU sed and perl read them, and a wrapper flag takes the next word only when it takes a value", () => {
    expect(t1WritesOutsidePlan([
      bash("a", "sed -E -i 's/a/b/' PLAN.md"),
      bash("b", "sed -i '' 's/a/b/' PLAN.md"),
      bash("c", "sed -i .bak 's/a/b/' PLAN.md"),
      bash("d", "sed -r -n -l 80 -i 's/a/b/' PLAN.md"),
      bash("e", "perl -i -f -pe 's/a/b/' PLAN.md"),
      bash("f", "echo x | sudo -E grep -rn tee src/"),
      bash("g", "env -i grep -rn tee src/"),
      bash("h", "sudo -n grep -l sed src/"),
      bash("i", "sed -i.prev 's/a/b/' PLAN.md"),
    ])).toEqual([]);
    expect(t1WritesOutsidePlan([
      bash("a", "sed -E -i 's/a/b/' src/a.ts"),
      bash("b", "sed -i '' 's/a/b/' src/b.ts"),
      bash("c", "sed --expression='s/a/b/' -i src/c.ts"),
      bash("d", "sed -e's/a/b/' -i src/d.ts"),
      bash("e", "perl -pi -e's/a/b/' src/e.ts"),
      bash("f", "sed -ie 's/a/b/' src/f.ts"),
      bash("g", "sed -e 's/a/b/' -i .env"),
      bash("h", "echo x | sudo -n tee src/h.ts"),
      bash("i", "sudo -g staff sed -i 's/a/b/' src/i.ts"),
      bash("j", "env -u HOME timeout -s KILL 5 sed -i 's/a/b/' src/j.ts"),
      bash("k", "xargs -d x -n 1 sed -i 's/a/b/' < list.txt"),
    ])).toEqual([
      "Bash edit: sed -E -i 's/a/b/' src/a.ts",
      "Bash edit: sed -i '' 's/a/b/' src/b.ts",
      "Bash edit: sed --expression='s/a/b/' -i src/c.ts",
      "Bash edit: sed -e's/a/b/' -i src/d.ts",
      "Bash edit: perl -pi -e's/a/b/' src/e.ts",
      "Bash edit: sed -ie 's/a/b/' src/f.ts",
      "Bash edit: sed -e 's/a/b/' -i .env",
      "Bash tee src/h.ts",
      "Bash edit: sudo -g staff sed -i 's/a/b/' src/i.ts",
      "Bash edit: env -u HOME timeout -s KILL 5 sed -i 's/a/b/' src/j.ts",
      "Bash edit: xargs -d x -n 1 sed -i 's/a/b/' < list.txt",
    ]);
  });
});

describe("AUTH_PAID from the slice's U4 leases", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const quote = { words: "Approved", by: "Captain", source: "approvals/test" };
  const usage = { input: 10, output: 5, reasoning: 0, cache_read: 0, cache_write: 0 };
  async function record(spends: number[], closeAll = true) {
    const dir = mkdtempSync(join(tmpdir(), "g-admission-"));
    dirs.push(dir);
    const rec = join(dir, "record"), local = LocalLedger.open(join(dir, "local.sqlite"));
    recordApproval(rec, { action: "init", item: "g-slice-author", cap_micros: 60_000_000, quotes: [quote], admission: "warn" });
    for (const [i, spend] of spends.entries()) {
      const l = openLease(rec, local, { item: "g-slice-author", run_id: "slice", amount_micros: 30_000_000, requireAdmission: () => null });
      const r = await local.reserve({ idempotency_key: "k" + i, lease_id: l.lease_id, cell: { run_id: "slice", arm: "author", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m" }, max_micros: spend });
      if (!r.ok) throw new Error(r.message);
      await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: spend, usage });
      if (closeAll || i < spends.length - 1) settleLease(rec, local, l.lease_id);
    }
    return rec;
  }
  test("settled spend over valid tasks", async () => {
    expect(authPaidFromLedger(await record([10_000_000, 6_680_000]), ["g-slice-author"], 12)).toBeCloseTo(1.39, 12);
  });
  test("an open lease or an item with no lease is refused", async () => {
    const rec = await record([5_000_000, 1_000_000], false);
    expect(() => authPaidFromLedger(rec, ["g-slice-author"], 12)).toThrow(/open/);
    expect(() => authPaidFromLedger(rec, ["g-nothing"], 12)).toThrow(/no lease/);
  });
});

describe("calls of unknown cost from the run directory's close lines", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const run = (lines: object[]) => {
    const dir = mkdtempSync(join(tmpdir(), "g-admission-"));
    dirs.push(dir);
    writeFileSync(join(dir, "sessions.jsonl"), lines.map((l) => JSON.stringify(l) + "\n").join(""));
    return dir;
  };
  const open = (id: string, item: string) => ({ event: "open", id, item, lease_id: item + ".0001.000000" });
  const close = (id: string, item: string, unknown_calls: number, unknown_micros: number) => ({ event: "close", id, item, spent_micros: 300_000, unknown_micros, unknown_calls });
  test("sums the unknown calls and their reservations from each session's close on the arm's items, as counted at the close", () => {
    const dir = run([open("s1", "g-adm-pe"), close("s1", "g-adm-pe", 1, 640_912), open("s2", "g-adm-pe"), close("s2", "g-adm-pe", 2, 1_281_824), open("s3", "g-adm-ap"), close("s3", "g-adm-ap", 5, 9_000_000)]);
    expect(unknownFromRun(dir, ["g-adm-pe"])).toEqual({ calls: 3, micros: 1_922_736 });
    expect(unknownFromRun(dir, ["g-adm-pe", "g-adm-ap"])).toEqual({ calls: 8, micros: 10_922_736 });
  });
  test("refuses a session with an open line and no close line, an item with no session, no items and a close line without its counts", () => {
    expect(() => unknownFromRun(run([open("s1", "g-adm-pe"), close("s1", "g-adm-pe", 0, 0), open("s2", "g-adm-pe")]), ["g-adm-pe"])).toThrow(/s2.*open/);
    expect(() => unknownFromRun(run([open("s1", "g-adm-pe"), close("s1", "g-adm-pe", 0, 0)]), ["g-nothing"])).toThrow(/no session/);
    expect(() => unknownFromRun(run([]), [])).toThrow(/name the line items/);
    expect(() => unknownFromRun(run([open("s1", "g-adm-pe"), { event: "close", id: "s1", item: "g-adm-pe", unknown_micros: 5 }]), ["g-adm-pe"])).toThrow(/whole/);
  });
});
