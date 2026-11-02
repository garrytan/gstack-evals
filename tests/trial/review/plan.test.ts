import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArm } from "../../../lanes/review-noloss/contract.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { REPO_ROOT } from "../../../src/cli.ts";
import { dirTreeSha256 } from "../../../src/trial/cache.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { AgentOutcome } from "../../../src/trial/trial.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { ceoMode, compareVersions, GLOBAL_PREFERENCES, GSTACK_AUTO, gstackAutoProblem, gstackDir, gstackVersion, neverAskPreferences, PLAN_SEVERITY_MAP, planArmLine, planArmOf, parsePlanSession, planSkill, REC_DECLINE, REC_REPLY, REC_USER, REC_USER_SHA256, recAnswer, recFreeformFor, renderPlanFindings, PLAN_TURN2, PLAN_TURN2_SHA256, PLAN_TURN2_TEXT, type PlanLens } from "../../../src/trial/review/plan.ts";
import { readReviewJournal, runReviewUnits, type PreparedUnit, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import { NON_APPROVING, UserSim } from "../../../src/usersim/sim.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { collect } from "../../cli/helpers.ts";
import { CUSTODY, PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

const OPUS = "claude-opus-5-5";
const HAIKU = "claude-haiku-5-5";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
const durable = () => {
  const d = mkdtempSync(join(REPO_ROOT, ".review-plan-test-"));
  roots.push(d);
  return d;
};
const block = (items: unknown) => "```plan-findings\n" + JSON.stringify(items, null, 2) + "\n```";
const files = (dir: string) => {
  const map = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : map.set(relative(dir, join(d, n)), readFileSync(join(d, n)));
  };
  walk(dir);
  return map;
};

describe("the plan told prompt and arms (B2, B3)", () => {
  // Value: protects=every plan arm gets the same frozen output block and only its own line; fails_when=the block changes without this pin moving on purpose, or an arm's line drifts from the plan's section 2; seam=plan.ts
  test("the template's sha256 is pinned and each arm differs only by its line", () => {
    expect([PLAN_TURN2_SHA256, PLAN_TURN2]).toEqual(["c5a5680ba13f9c91ebc625ca61627d65037a9dab4b002803ae4f3d2ebbb3187c", { text: PLAN_TURN2_TEXT, maxTurns: 5, timeoutS: 300 }]);
    expect(["none", "gstack", "gstack-auto", "lens", "placebo"].map((a) => planArmLine(a as never, "ceo"))).toEqual(["Review plan.md for problems.", "/plan-ceo-review plan.md", "/autoplan --ceo-only plan.md", "Do a CEO/founder-mode review of this plan. Review plan.md for problems.", "/plan-ceo-review plan.md"]);
    expect((["eng", "devex", "design"] as const).map((l) => [planArmLine("lens", l), planArmLine("gstack", l)])).toEqual([["Do an eng manager-mode review of this plan. Review plan.md for problems.", "/plan-eng-review plan.md"], ["Do a developer experience review of this plan. Review plan.md for problems.", "/plan-devex-review plan.md"], ["Do a designer's eye review of this plan. Review plan.md for problems.", "/plan-design-review plan.md"]]);
    expect(PLAN_TURN2_TEXT.split("\n").slice(0, 2)).toEqual(["List every problem you found in plan.md.", ""]);
    for (const field of ["severity", "section", "line", "claim", "evidence", "fix"]) expect(PLAN_TURN2_TEXT).toContain('"' + field + '"');
    expect(PLAN_TURN2_TEXT).toContain("info string is plan-findings");
    expect(PLAN_TURN2_TEXT).not.toMatch(/\u2014|gstack/);
    expect(["none", "gstack", "gstack-auto", "lens", "placebo"].map((a) => planSkill(a as never, "ceo"))).toEqual([null, "plan-ceo-review", "autoplan", null, "plan-ceo-review"]);
  });

  test("arm specs map to plan arms by name and kind", () => {
    const gstack = { repo: "garrytan/gstack", sha: "a".repeat(40) };
    expect(planArmOf({ name: "none", kind: "bare" })).toBe("none");
    expect(planArmOf({ name: "lens", kind: "bare" })).toBe("lens");
    expect(planArmOf({ name: "placebo", kind: "placebo", of: "gstack" })).toBe("placebo");
    expect(planArmOf({ name: "gstack", kind: "stack", stack: gstack, install: {} })).toBe("gstack");
    expect(planArmOf({ name: "gstack-auto", kind: "stack", stack: gstack, install: {} })).toBe("gstack-auto");
    expect(planArmOf({ name: "other", kind: "bare" })).toBeNull();
    expect(planArmOf({ name: "gstack", kind: "stack", stack: { repo: "cursor/plugins", sha: "b".repeat(40), path: "harness/pstack/claude-code" }, install: {} })).toBeNull();
  });

  test("gstack-auto is a frozen placeholder that refuses every gstack until a release sets its version", () => {
    expect(GSTACK_AUTO).toEqual({ issue: "GST-537", command: "/autoplan --ceo-only", min_version: null });
    expect(gstackAutoProblem("1.91.379.0")).toMatch(/^gstack-auto \(GST-537\) is not released; its told command "\/autoplan --ceo-only" is a placeholder/);
    expect(gstackAutoProblem("1.91.379.0", "1.92.0.0")).toBe("gstack 1.91.379.0 is older than 1.92.0.0, the release that ships gstack-auto (GST-537)");
    expect([gstackAutoProblem("1.92.0.0", "1.92.0.0"), gstackAutoProblem("1.92.1.0", "1.92.0.0")]).toEqual([null, null]);
    expect(gstackAutoProblem(null, "1.92.0.0")).toMatch(/no readable VERSION/);
    expect([compareVersions("1.91.379.0", "1.91.38.0"), compareVersions("1.9", "1.9.0.0"), compareVersions("1.10.0", "1.9.9")]).toEqual([1, 0, 1]);
  });
});

describe("the rec user (B4, open item 3)", () => {
  // Value: protects=every arm's questions get one deterministic answer that takes the recommendation and declines chaining and docs, under the simulator's binding rules; fails_when=a chain or docs offer is accepted, or a gated effect is approved; seam=recAnswer through UserSim
  test("it takes every recommendation and declines another skill, another review and promoting or committing docs", () => {
    for (const q of ["Review mode: push scope up, cherry-pick expansions, hold scope, or cut to minimum?", "Which approach should we take?", "Read /work/plan.md first?"]) expect(recAnswer(q, "ceo")).toBe(REC_REPLY);
    for (const q of ["Run /plan-eng-review next?", "Want me to start the eng review now?", "Hand off to /autoplan?", "Promote this CEO plan to docs/designs?", "Shall I commit the plan?", "Continue with office hours?"]) expect(recAnswer(q, "ceo")).toBe(REC_DECLINE);
    // GST-925 (GSTA-2's ruling): a mode or Step 0 question gets the recommendation even when it names /ship or a commit; the question uses the CEO skill's own mode names at v1.93.17.0
    for (const q of ["Step 0E, mode selection. A) SCOPE EXPANSION B) SELECTIVE EXPANSION C) HOLD SCOPE (recommended) D) SCOPE REDUCTION. Each mode ends with /ship and a commit.", "How deep should this DX review go?"]) expect(recAnswer(q, "ceo")).toBe(REC_REPLY);
    expect([recAnswer("Run /plan-eng-review next?", "eng"), recAnswer("Want me to start the eng review now?", "eng"), recAnswer("Run /plan-ceo-review next?", "eng"), recAnswer("Want me to start the design review now?", "eng"), recAnswer("Start the dx review?", "devex")]).toEqual([REC_REPLY, REC_REPLY, REC_DECLINE, REC_DECLINE, REC_REPLY]);
    expect(REC_USER).toEqual({ persona: expect.stringContaining("Go with your recommendation.") });
    expect(REC_USER_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("through the simulator, a gated effect still gets the non-approving answer", async () => {
    const sim = new UserSim({ task: "t", script: REC_USER, log: join(scratch("rec-"), "usersim.ndjson"), freeform: async (p, q) => ((await recFreeformFor("ceo")(p, q)) as { text: string }).text });
    const ask = async (question: string, options: string[] = ["A", "B"]) => ((await sim.answerAsk([{ question, options: options.map((label) => ({ label })) }])) as { answers: Record<string, string> }).answers[question];
    expect(await ask("Review mode: hold scope or cut to minimum?", ["HOLD SCOPE", "SCOPE REDUCTION"])).toBe(REC_REPLY);
    expect(await ask("Run /plan-eng-review next?")).toBe(REC_DECLINE);
    expect(await ask("Write the revised plan to plan.md?")).toBe(NON_APPROVING);
    expect(await ask("Promote the plan to docs/designs?")).toBe(REC_DECLINE);
  });

  // Value: protects=GST-925: a mode, scope-gate or Step 0 question that names /ship or a commit gets the recommendation through the simulator, because the rec user marks that answer a choice; without the mode words it gets the decline (it names /ship) or the non-approving answer; fails_when=the binding rules swap a choice for "Not yet", or a gated question with no mode words is approved; seam=recFreeformFor through UserSim, as the driver adapts it
  test("a mode, scope-gate or Step 0 question passes the simulator as a choice; without the mode words it does not", async () => {
    const through = (lens: PlanLens) => {
      const sim = new UserSim({ task: "t", script: REC_USER, log: join(scratch("rec-choice-"), "usersim.ndjson"), freeform: async (p, q) => {
        const a = await recFreeformFor(lens)(p, q);
        return "text" in a && a.text !== null ? (a.choice ? { text: a.text, choice: true as const } : a.text) : null;
      } });
      return async (question: string, options: string[]) => ((await sim.answerAsk([{ question, options: options.map((label) => ({ label })) }])) as { answers: Record<string, string> }).answers[question];
    };
    const gated = " Each option ends with /ship and a commit.";
    // The devex mode question and the eng and design scope gates quote gstack v1.93.17.0 (plan-devex-review, plan-eng-review and plan-design-review SKILL.md).
    const cases: [PlanLens, string, string[]][] = [
      ["ceo", "Step 0E, mode selection. A) SCOPE EXPANSION B) SELECTIVE EXPANSION C) HOLD SCOPE (recommended) D) SCOPE REDUCTION.", ["SCOPE EXPANSION", "SELECTIVE EXPANSION", "HOLD SCOPE", "SCOPE REDUCTION"]],
      ["devex", "How deep should this DX review go? A) DX EXPANSION B) DX POLISH C) DX TRIAGE: Focus only on the critical DX gaps that would block adoption. Fast, surgical, for plans that need to ship soon.", ["DX EXPANSION", "DX POLISH", "DX TRIAGE"]],
      ["eng", "What should I review? A) The current branch diff B) A plan or design doc I'll paste or point you to. C) A specific file, directory, or path.", ["A", "B", "C"]],
      ["design", "What should I review? A) The current branch diff B) A plan or design doc I'll paste or point you to. C) A specific page, file, or path.", ["A", "B", "C"]],
    ];
    for (const [lens, q, options] of cases) {
      const ask = through(lens);
      expect([lens, await ask(q, options), await ask(q + gated, options)]).toEqual([lens, REC_REPLY, REC_REPLY]);
    }
    expect(await through("ceo")("Pick one: A) keep the plan B) cut the plan." + gated, ["A", "B"])).toBe(REC_DECLINE);
    expect(await through("ceo")("Pick one: A) keep the plan B) cut the plan. Each option ends with a deploy.", ["A", "B"])).toBe(NON_APPROVING);
    expect(await through("devex")("Which should we do? A) tighten the error messages B) skip ahead for plans that need to ship soon", ["A", "B"])).toBe(NON_APPROVING);
  });

  test("an arm's installed gstack registry becomes never-ask preferences, and its VERSION is read", () => {
    const home = scratch("gstack-home-");
    const dir = join(home, ".claude", "skills", "gstack");
    mkdirSync(join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "VERSION"), "1.91.379.0\n");
    writeFileSync(join(dir, "scripts", "question-registry.ts"), "export const R = {\n  'b-q': { id: 'b-q', skill: 'x' },\n  'a-q': { id: 'a-q', skill: 'y' },\n};\n");
    const install = { gstack: ".claude/skills/gstack/bin/gstack-skill-start", layers: [{ src: home, dest: "" }] };
    expect(gstackDir(install)).toBe(dir);
    expect(gstackVersion(gstackDir(install))).toBe("1.91.379.0");
    expect(JSON.parse(neverAskPreferences(dir)!)).toEqual({ "a-q": "never-ask", "b-q": "never-ask" });
    expect([gstackDir({ gstack: null, layers: [] }), neverAskPreferences(null), neverAskPreferences(home)]).toEqual([null, null, null]);
  });
});

describe("the plan findings parser (B2, open items 2 and 10)", () => {
  const done = { kind: "completed" } as const;
  const item = { severity: "high", section: "Problem", line: 3, claim: "It solves a problem readers do not have.", evidence: "context/goals.md", fix: "Plan offline reading." };
  // Value: protects=the finding contract keeps section, fix and the native label, reads the last plan-findings block in any turn, and tells malformed, missing and incomplete apart; fails_when=a json block parses as findings, a later prose turn hides the block, or a bad label passes; seam=parsePlanSession
  test("findings, the last block in any turn, and the three failures", () => {
    const ok = parsePlanSession({ termination: done, turns: ["Mode: HOLD SCOPE; approved decisions: none.", block([item]), "Want me to apply these to plan.md?"] });
    expect(ok).toEqual({ kind: "findings", findings: [{ ...item, severity: "High" }] });
    expect(renderPlanFindings((ok as Extract<typeof ok, { kind: "findings" }>).findings, 2)).toEqual([{ severity: "High", path: "plan.md", line: 3, summary: item.claim, section: "Problem", evidence: "context/goals.md", fix: "Plan offline reading.", pass: 2, id: "p2-1" }]);
    expect(parsePlanSession({ termination: done, turns: [block([item]), block([])] })).toEqual({ kind: "findings", findings: [] });
    expect(parsePlanSession({ termination: done, turns: ["```json\n[]\n```"] })).toEqual({ kind: "missing" });
    expect(parsePlanSession({ termination: done, turns: [block([{ ...item, severity: "P0" }])] })).toEqual({ kind: "malformed", reason: "item 0: severity is not Critical, High, Medium or Low" });
    expect(parsePlanSession({ termination: done, turns: [block([{ ...item, section: "" }])] })).toEqual({ kind: "malformed", reason: "item 0: section is not a heading" });
    expect(parsePlanSession({ termination: done, turns: [block({ findings: [] })] })).toEqual({ kind: "malformed", reason: "the plan-findings block is not an array" });
    expect(parsePlanSession({ termination: { kind: "timeout" }, turns: [block([item])] })).toEqual({ kind: "incomplete", reason: "the session ended timeout" });
  });

  test("ceoMode reads the mode handoff line, auto-decided or chosen", () => {
    expect(ceoMode(["Auto-decided review mode \u2192 SELECTIVE EXPANSION (your preference). Change with /plan-tune."])).toBe("SELECTIVE EXPANSION");
    expect(ceoMode(["thinking", "Mode: HOLD SCOPE; approved decisions: none.", "Mode: SCOPE REDUCTION; approved decisions: none."])).toBe("HOLD SCOPE");
    expect(ceoMode(["We could hold scope."])).toBeNull();
  });

  // Value: protects=the exact prompt's output reaches the scorer with its labels mapped through the arm's severity map; fails_when=the rendered lines fail contract v1 or High stops counting as must-fix; seam=parsePlanSession, renderPlanFindings, parseArm
  test("end to end: a reply in the exact told format parses, renders and maps through the arm's severity map", () => {
    const panel = planPanel(scratch("plan-e2e-"), { seeded: 1 });
    const unit = panel.suite.units[0]!;
    const reply = "I read plan.md and context/goals.md.\n\n" + block([item, { ...item, severity: "Medium", section: "Scope", line: null, claim: "The first release is large." }]);
    const parsed = parsePlanSession({ termination: done, turns: [reply] });
    const lines = renderPlanFindings((parsed as Extract<typeof parsed, { kind: "findings" }>).findings, 1).map((f) => JSON.stringify(f) + "\n").join("");
    const arm = JSON.parse(readFileSync(join(REPO_ROOT, "lanes/review-noloss/example/arm-example/arm.json"), "utf8"));
    const armJson = { ...arm, id: "gstack-opus", label: "gstack on opus", suite: panel.suite.id, passes: 1, status: "complete", severity_map: PLAN_SEVERITY_MAP };
    delete armJson.coverage_gaps;
    const parsedArm = parseArm(new Map([["arm.json", Buffer.from(JSON.stringify(armJson))], ["findings/" + unit.pr + ".jsonl", Buffer.from(lines)], ["cost.tsv", Buffer.from("pr\tscope\ttotal_tokens\tmeter_source\n1\tall\t1\tlane-counter-delta\n")]]), panel.suite);
    const found = parsedArm.findings!.get(unit.id)!;
    expect(found.map((f) => [f.raw, f.path, f.line, f.fields.section, f.fix])).toEqual([["High", "plan.md", 3, "Problem", "Plan offline reading."], ["Medium", "plan.md", null, "Scope", "Plan offline reading."]]);
  });
});

describe("plan units in the run loop (keyless)", () => {
  // Value: protects=plan mode runs every arm with the rec user and no second model, sets gstack's questions to auto-decide in the throwaway state root, scores failed passes as finding nothing with a diagnostic instead of stopping the arm, keeps stopped for cells not run, honours per-arm model lists, and records each session's CEO mode; fails_when=any of those regress; seam=runReviewUnits on a test rig; no_claim=Claude Code and the Docker rig
  test("rec user, no voice, auto-decide, failed passes as misses, per-arm models and modes", async () => {
    const h = harness(() => [{ type: "text", text: "ok" }]);
    roots.push(h.dir);
    const panel = planPanel(scratch("plan-run-"), { seeded: 1 });
    const u = panel.suite.units[0]!;
    const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
    const repoDir = join(scratch("plan-unit-"), "repo");
    const repo = buildUnitRepo({ unit, source: panel.clone, dest: repoDir, baseBranch: "main" });
    const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("plan-tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("plan-scratch-"), run: () => { throw new Error("a plan unit runs no container"); } });
    expect([tree.problems, tree.install, tree.test]).toEqual([[], null, null]);
    const prepared: PreparedUnit = { unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null };
    const home = scratch("plan-gstack-");
    const gdir = join(home, ".claude", "skills", "gstack");
    mkdirSync(join(gdir, "bin"), { recursive: true });
    mkdirSync(join(gdir, "scripts"), { recursive: true });
    writeFileSync(join(gdir, "scripts", "question-registry.ts"), "  'plan-ceo-review-mode': { id: 'plan-ceo-review-mode' },\n");
    const bound: { arm: string; models: string[] }[] = [];
    const slots = new Map<string, { arm: string; model: string }>();
    const seen: Record<string, { prompt: string; entry: unknown; freeform: boolean; codex: unknown; config: string; prefs: string }> = {};
    const turns: Record<string, AgentOutcome["turns"]> = {
      ["gstack " + OPUS]: ["Mode: HOLD SCOPE; approved decisions: none.", block([{ severity: "Critical", section: "Problem", line: 3, claim: "Wrong problem.", evidence: "context/goals.md", fix: "Plan offline reading." }]), "Want me to apply these to plan.md?"],
      ["none " + OPUS]: [block([{ severity: "P0", section: "Problem", line: 3, claim: "x", evidence: "", fix: "" }])],
      ["lens " + OPUS]: ["```json\n[]\n```"],
      ["none " + HAIKU]: [],
    };
    const post = (base: string, token: string, body: unknown) => fetch(base + "/anthropic/v1/messages", { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", authorization: "Bearer " + token }, body: JSON.stringify(body) });
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => {
        const b = h.proxy.bind(request);
        slots.set(b.slot, { arm: request.cell.arm, model: request.cell.model });
        bound.push({ arm: request.cell.arm, models: request.models });
        return b;
      },
      finalize: (m) => h.proxy.finalize(m),
      arms: { none: { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] }, lens: { tree_sha256: "lens-tree", skill: null, gstack: null, plugins: [] }, gstack: { tree_sha256: "gstack-tree", skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], layers: [{ src: home, dest: "" }] } },
      cells: { gstack: { [OPUS]: { cell: { model: OPUS, voice: null }, layer: null, gstack_config: { agent_model: "host", codex_reviews: "disabled" }, codex: null, tree_sha256: "gstack-opus" } } },
      sandbox: () => localSandbox(() => {}),
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
      driver: (o) => ({
        async run(session, task): Promise<AgentOutcome> {
          const cell = slots.get(o.proxy.slot)!;
          await (await post(o.proxy.baseUrl + "/" + o.proxy.slot, o.proxy.token, { model: o.model, max_tokens: 64, messages: [{ role: "user", content: task.prompt }] })).text();
          const read = (f: string) => session.exec('cat "$GSTACK_STATE_ROOT/' + f + '" 2>/dev/null', 10_000).stdout;
          seen[cell.arm + " " + cell.model] = { prompt: task.prompt, entry: o.entry, freeform: typeof o.freeform === "function", codex: o.codex ?? null, config: read("config.yaml"), prefs: read(GLOBAL_PREFERENCES) };
          const t = turns[cell.arm + " " + cell.model]!;
          return { turns: t, termination: cell.model === HAIKU ? { kind: "timeout" } : { kind: "completed" }, model_output: true, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: t.length, loaded_bytes: null };
        },
      }),
    };
    const out = durable();
    const input: ReviewRunInput = { host: "claude", suite: { id: panel.suite.id, sha256: null }, units: [prepared], arms: [{ name: "none", told: "none" }, { name: "gstack", told: "gstack" }, { name: "lens", told: "lens" }], models: [OPUS, HAIKU], armModels: { gstack: [OPUS], lens: [OPUS] }, passes: 1, parallel: 2, timeoutS: 120, cap: 50_000_000, runId: "plan-run", out, date: "2026-10-31", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: join(h.dir, "journal.ndjson"), plan: { lens: "ceo" }, severityMap: { none: PLAN_SEVERITY_MAP, gstack: PLAN_SEVERITY_MAP, lens: PLAN_SEVERITY_MAP }, env: {} };
    try {
      const run = await runReviewUnits(input, rig);
      expect(run.stops).toEqual([]);
      expect(Object.keys(seen).sort()).toEqual(["gstack " + OPUS, "lens " + OPUS, "none " + HAIKU, "none " + OPUS]);
      for (const s of Object.values(seen)) expect([s.entry, s.freeform, s.codex]).toEqual([{ user: REC_USER }, true, null]);
      expect(bound.every((b) => b.models.length === 1)).toBe(true);
      expect(seen["gstack " + OPUS]!.prompt).toBe(planArmLine("gstack", "ceo"));
      expect(seen["gstack " + OPUS]!.config).toContain("codex_reviews: disabled\n");
      expect(seen["gstack " + OPUS]!.config).toContain("agent_model: host\n");
      expect(seen["gstack " + OPUS]!.config).not.toContain("codex_reviews: enabled");
      expect(JSON.parse(seen["gstack " + OPUS]!.prefs)).toEqual({ "plan-ceo-review-mode": "never-ask" });
      expect(seen["none " + OPUS]!.prefs).toBe("");
      expect(readdirSync(join(out, "arms")).sort()).toEqual(["gstack-opus", "lens-opus", "none-haiku", "none-opus"]);
      const arm = (id: string) => JSON.parse(readFileSync(join(out, "arms", id, "arm.json"), "utf8"));
      for (const id of ["gstack-opus", "lens-opus", "none-haiku", "none-opus"]) expect([id, arm(id).status, arm(id).coverage_gaps]).toEqual([id, "complete", undefined]);
      expect(arm("gstack-opus")).toMatchObject({ models: [{ role: "driver", model: OPUS }], told: { arm: "gstack", lens: "ceo", turn2_sha256: PLAN_TURN2_SHA256 }, ceo_modes: { "HOLD SCOPE": 1 }, severity_map: PLAN_SEVERITY_MAP });
      expect(arm("none-opus").diagnostics).toEqual([unit.id + " pass 1: malformed, item 0: severity is not Critical, High, Medium or Low; scored as finding nothing"]);
      expect(arm("none-haiku").diagnostics).toEqual([expect.stringMatching(/^example\/plan-panel#1@[0-9a-f]{12} pass 1: missing; ended timeout in turn 1, settled spend \$[0-9.]+, scored as finding nothing$/)]);
      expect(arm("lens-opus").diagnostics).toEqual([unit.id + " pass 1: missing; scored as finding nothing"]);
      expect(arm("lens-opus").ceo_modes).toEqual({ unstated: 1 });
      const file = "findings/" + unit.id.replaceAll("/", "__") + ".jsonl";
      expect(readFileSync(join(out, "arms", "gstack-opus", file), "utf8").trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ severity: "Critical", path: "plan.md", line: 3, summary: "Wrong problem.", section: "Problem", evidence: "context/goals.md", fix: "Plan offline reading.", pass: 1, id: "p1-1" }]);
      expect(readFileSync(join(out, "modes.tsv"), "utf8")).toContain("gstack-opus\tgstack\t" + OPUS + "\t" + unit.id + "\t1\tHOLD SCOPE");
      for (const id of ["gstack-opus", "none-opus"]) expect(() => parseArm(files(join(out, "arms", id)), panel.suite)).not.toThrow();
      const capped = await runReviewUnits({ ...input, out: durable(), cap: 1 }, rig);
      expect(capped.stops.map((s) => s.code)).toEqual(["CAP_STOP"]);
      expect(JSON.parse(readFileSync(join(capped.armDirs[0]!, "arm.json"), "utf8")).status).toBe("stopped");
      const again = await runReviewUnits({ ...input, reuse: readReviewJournal(out) }, rig);
      expect(again.spent).toBe(0);
      const voiced = { ...rig, cells: { gstack: { [OPUS]: { ...rig.cells!.gstack![OPUS]!, cell: { model: OPUS, voice: "gpt-6.1-sol" }, codex: { model: "gpt-6.1-sol" } } } } };
      const before = bound.length;
      await expect(runReviewUnits({ ...input, out: durable() }, voiced)).rejects.toThrow("E_USAGE: plan units run no second model, but arm gstack's cell on " + OPUS + " keeps the voice gpt-6.1-sol");
      expect(bound.length).toBe(before);
      const failing: HostRig = { ...rig, driver: (o) => ({ async run(session, task, hooks) { const r = await rig.driver!(o).run(session, task, hooks); const c = slots.get(o.proxy.slot)!; if (c.arm === "lens") return { ...r, termination: { kind: "missing" as const, code: "UPSTREAM" as const } }; if (c.arm === "gstack") return { ...r, model_output: true, termination: { kind: "arm_failure" as const, failure: "harness_crash" as const } }; return c.model === OPUS ? { ...r, turns: [], model_output: false } : { ...r, turns: [], model_output: false, termination: { kind: "arm_failure" as const, failure: "harness_crash" as const } }; } }) };
      const broken = await runReviewUnits({ ...input, out: durable() }, failing);
      const lensArm = JSON.parse(readFileSync(join(broken.armDirs.find((d) => d.endsWith("lens-opus"))!, "arm.json"), "utf8"));
      expect([lensArm.status, lensArm.coverage_gaps, lensArm.diagnostics]).toEqual(["stopped", [unit.id + " pass 1: incomplete, the session ended missing (UPSTREAM)"], undefined]);
      const brokenArm = (id: string) => JSON.parse(readFileSync(join(broken.armDirs.find((d) => d.endsWith(id))!, "arm.json"), "utf8"));
      expect([brokenArm("gstack-opus").status, brokenArm("gstack-opus").coverage_gaps, brokenArm("gstack-opus").diagnostics]).toEqual(["complete", undefined, [unit.id + " pass 1: incomplete, the session ended arm_failure; scored as finding nothing"]]);
      expect([brokenArm("none-opus").status, brokenArm("none-opus").coverage_gaps]).toEqual(["stopped", [unit.id + " pass 1: incomplete, the session completed with no assistant turn and no model output"]]);
      expect([brokenArm("none-haiku").status, brokenArm("none-haiku").coverage_gaps]).toEqual(["stopped", [unit.id + " pass 1: incomplete, the session ended arm_failure before any model output"]]);
    } finally {
      h.proxy.stop();
    }
  }, 120_000);

  test("a gstack-auto arm is refused before any spend while gstack-auto is unreleased", async () => {
    const home = scratch("plan-auto-");
    mkdirSync(join(home, "g", "bin"), { recursive: true });
    const rig = { arms: { "gstack-auto": { tree_sha256: "t", skill: null, gstack: "g/bin/gstack-skill-start", plugins: [], layers: [{ src: home, dest: "" }] } } } as unknown as HostRig;
    const input = { host: "claude", suite: { id: "s", sha256: null }, units: [], arms: [{ name: "gstack-auto", told: "gstack-auto" }], models: [OPUS], passes: 1, parallel: 1, timeoutS: 120, cap: 0, runId: "r", out: durable(), date: "2026-10-31", policy, keyBase: { image_digest: null, recipe: "t", host_version: null, adapter_sha256: "t", isolation: "process" }, journal: null, plan: { lens: "ceo" }, env: {} } as ReviewRunInput;
    await expect(runReviewUnits(input, rig)).rejects.toThrow("E_USAGE: arm gstack-auto: gstack-auto (GST-537) is not released");
  });
});

describe("review-units --plan arguments (keyless)", () => {
  // Value: protects=plan runs refuse what they cannot do before building or spending, and the dry run shows each arm's line, its models and no install or test step; fails_when=gstack-auto runs unreleased, a placebo runs with no gstack arm, a code suite runs as plan, or --arm-models names a model outside --models; seam=main
  test("refusals and the dry run", async () => {
    const panel = planPanel(scratch("plan-cli-"), { seeded: 2, decoy: 1 });
    const run = async (argv: string[]) => {
      const io = collect();
      const code = await main(argv, io, {});
      return { code, ...io.text() };
    };
    const out = join(scratch("plan-cli-out-"), "out");
    const GSTACK = "gstack=garrytan/gstack@" + "a".repeat(40);
    const base = ["--suite", panel.stubPath, "--sealed-root", panel.sealedRoot, "--units", "all", "--models", OPUS, "particle-ai/particle-1", "--out", out, "--source", PANEL_REPO + "=" + panel.clone, "--base-branch", PANEL_REPO + "=main"];
    expect((await run([...base, "--arms", "none"])).err).toMatch(/^E_USAGE .*is a plan suite; pass --plan <lens>/);
    const fable = ["--suite", panel.stubPath, "--sealed-root", panel.sealedRoot, "--units", "all", "--models", "claude-fable-5-1", "--out", out, "--source", PANEL_REPO + "=" + panel.clone, "--base-branch", PANEL_REPO + "=main", "--plan", "ceo", "--arms", "none", "--item", "planning-r1a", "--dry-run"];
    expect((await run(fable)).err).toMatch(/^E_USAGE review-units: --models: claude-fable-5-1 as a model under test: the policy allows it only in smoke runs \(--smoke\); ledger item planning-r1a is not named/);
    const rungPolicy = join(scratch("plan-policy-"), "models.json");
    const def = JSON.parse(readFileSync(DEFAULT_POLICY, "utf8"));
    writeFileSync(rungPolicy, JSON.stringify({ ...def, models: { ...def.models, "claude-fable-5-1": { ...def.models["claude-fable-5-1"], rungs: ["planning-r1a"] } } }));
    expect((await run([...fable, "--policy", rungPolicy])).code).toBe(0);
    const MAP = join(REPO_ROOT, "src", "trial", "review", "reader-maps", "gstack-77fe28c39796.json");
    expect((await run([...base, "--arms", "none", "--plan", "ceo", "--reader-map", MAP])).err).toMatch(/^E_USAGE .*--reader-map runs on code units, not with --plan/);
    expect((await run([...base, "--arms", "none", "--plan", "ceo", "--cap-stops"])).err).toMatch(/^E_USAGE review-units: a run needs a ledger line item/);
    expect((await run([...base, "--plan", "qa", "--arms", "none"])).err).toMatch(/^E_USAGE .*--plan takes a lens: ceo, eng, devex, design/);
    expect((await run(["--suite", "gsta167-14pr", "--units", "3593", "--models", OPUS, "--out", out, "--source", "garrytan/gstack=/nowhere", "--plan", "ceo", "--arms", "none"])).err).toMatch(/^E_USAGE .*--plan needs a plan suite, and suite gsta167-14pr is noloss/);
    expect((await run([...base.slice(0, 2), ...base.slice(4), "--plan", "ceo", "--arms", "none"])).err).toMatch(/pass --sealed-root <dir>/);
    expect((await run([...base, "--plan", "ceo", "--arms", "gstack-auto=garrytan/gstack@" + "a".repeat(40)])).err).toMatch(/^E_USAGE .*arm gstack-auto: gstack-auto \(GST-537\) is not released/);
    expect((await run([...base, "--plan", "ceo", "--arms", "none", "placebo"])).err).toMatch(/^E_USAGE .*the placebo arm is generated from the gstack arm/);
    expect((await run([...base, "--plan", "ceo", "--arms", "pstack=cursor/plugins@" + "c".repeat(40) + ":harness/pstack/claude-code"])).err).toMatch(/^E_USAGE .*plan units run none, lens, placebo/);
    expect((await run([...base, "--plan", "ceo", "--arms", "none", "lens", "--arm-models", "lens=" + HAIKU])).err).toMatch(/^E_USAGE .*--arm-models gives arm lens model claude-haiku-5-5, which --models does not run/);
    expect((await run([...base, "--plan", "ceo", "--arms", "none", "--arm-models", "lens=" + OPUS])).err).toMatch(/^E_USAGE .*--arm-models names arm lens, which --arms does not run/);
    const dry = await run([...base, "--plan", "ceo", "--arms", "none", "lens", GSTACK, "placebo", "--arm-models", "lens=" + OPUS, "placebo=particle-ai/particle-1", "--passes", "3", "--dry-run"]);
    expect([dry.code, dry.err]).toEqual([0, ""]);
    expect(dry.out).toContain("plan lens ceo; turn 2 sha256 " + PLAN_TURN2_SHA256);
    expect(dry.out).toContain("plan unit: no install or test");
    expect(dry.out).toContain('lens ("Do a CEO/founder-mode review of this plan. Review plan.md for problems." on ' + OPUS + ")");
    expect(dry.out).toContain('placebo ("/plan-ceo-review plan.md" on particle-ai/particle-1)');
    expect(dry.out).toContain("sessions " + 3 * 3 * (2 + 1 + 2 + 1));
    expect(existsSync(out)).toBe(false);
    const inRepo = join(REPO_ROOT, ".review-units-cli-sealed-out");
    expect((await run([...base.map((a) => (a === out ? inRepo : a)), "--plan", "ceo", "--arms", "none", "--dry-run"])).err).toMatch(/^E_USAGE .*suite \S+ is sealed, and --out .* is inside the repo; write sealed runs outside it/);
    const pub = planPanel(scratch("plan-cli-pub-"), { seeded: 1 }, { visibility: "public" });
    expect((await run(["--suite", pub.suitePath, "--sealed-root", pub.sealedRoot, "--units", "all", "--models", OPUS, "--out", inRepo, "--source", PANEL_REPO + "=" + pub.clone, "--base-branch", PANEL_REPO + "=main", "--plan", "ceo", "--arms", "none", "--dry-run"])).err).toMatch(/^E_USAGE .*suite \S+ reads catalogs under the sealed root, and --out .* is inside the repo/);
    expect(existsSync(inRepo)).toBe(false);
    for (const [suiteArgs, why] of [[["--suite", panel.stubPath, "--sealed-root", panel.sealedRoot], "is sealed"], [["--suite", pub.suitePath, "--sealed-root", pub.sealedRoot], "reads catalogs under the sealed root"]] as const) {
      const io = collect();
      const code = await main([...suiteArgs, ...base.slice(4).map((a) => (a === panel.clone ? (why === "is sealed" ? panel.clone : pub.clone) : a)), "--plan", "ceo", "--arms", "none", "--dry-run"], io, { GSTACK_EVALS_EPHEMERAL: "1", GSTACK_EVALS_RECEIPTS: join(REPO_ROOT, "receipts") });
      expect([code, io.text().err]).toEqual([2, expect.stringMatching(new RegExp("^E_USAGE .*suite \\S+ " + why + ", and the receipts sink " + join(REPO_ROOT, "receipts") + " \\(GSTACK_EVALS_RECEIPTS\\) is inside the repo"))]);
    }
    expect(CUSTODY).toMatch(/^procedural custody/);
  });
});
