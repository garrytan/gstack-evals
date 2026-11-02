// The run loop half of plan-v3-gates.test.ts, run as its own process for the reason plan-told-sdk.ts gives: bun test runs
// every file in one process, and quick/lanea-quick/test/session.test.ts mocks @anthropic-ai/claude-agent-sdk there. Here
// runReviewUnits drives the real Claude Code driver on the real pinned Agent SDK, which spawns the stub CLI
// (tests/adapters/fixtures/stub-cli.cjs) through the local sandbox's agent spawn, so the stub runs with the session's own
// env (HOME, GSTACK_STATE_ROOT) and records every user message, control request and control response at the SDK's edge.
// The gstack arm's tree is plan-told-sdk.ts's (a gstack bin folder and a question registry) plus SKILL.md folders for
// plan-eng-review and plan-design-review, installed into each session's HOME.
//
//   bun plan-v3-gates-sdk.ts gates <records dir> <out dir> <scratch dir>
//     One gstack arm under --plan eng, then under --plan design (<out>/eng, <out>/design). In turn 1 the stub probes the
//     lens's SKILL.md in its HOME, calls the lens's skill through the Skill tool and asks the lens's scope gate (GATES)
//     through AskUserQuestion; turn 2 writes BLOCK. Records go to <records>/<lens>.ndjson.
//   bun plan-v3-gates-sdk.ts carryover <records dir> <out dir> <scratch dir>
//     One gstack arm under --plan eng with passes 2. On its first user message each session probes CARRY in its own HOME
//     and state root, then writes CARRY there; the second session also probes the first session's absolute state-root
//     paths.
//     Records go to <records>/s<n>.ndjson.
//
// It prints one JSON line: { stops, sessions }, each run's stops and each session's HOME and GSTACK_STATE_ROOT.
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { PLAN_LENSES, PLAN_SEVERITY_MAP, type PlanLens } from "../../../src/trial/review/plan.ts";
import { runReviewUnits, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../../adapters/harness.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";

export const LENSES = ["eng", "design"] as const satisfies readonly PlanLens[];
type Lens = (typeof LENSES)[number];

/** Each lens's scope gate, asked in turn 1 as one AskUserQuestion question with the plan file as an option. */
export const GATES: Record<Lens, { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }> = {
  eng: { question: "Scope check before the architecture pass. What should I review?", header: "Scope", multiSelect: false, options: [{ label: "plan.md", description: "The plan file in this directory" }, { label: "Another file", description: "Name a different file to review" }] },
  design: { question: "Before the design pass: what should I review?", header: "Scope", multiSelect: false, options: [{ label: "plan.md", description: "The plan and the screens it describes" }, { label: "One screen", description: "Pick a single screen from the plan" }] },
};

/** Each skill's SKILL.md in the arm tree; they differ in length, so loaded_bytes names the folder the driver was handed. */
export const SKILL_MD: Record<Lens, string> = {
  eng: "---\nname: plan-eng-review\ndescription: Review a plan as an engineering manager.\n---\n\n# plan-eng-review\n\nRead the plan, then review its architecture, data flow, edge cases and tests.\n",
  design: "---\nname: plan-design-review\ndescription: Review a plan as a designer.\n---\n\n# plan-design-review\n\nRead the plan and rate each design dimension.\n",
};

export const TURN1 = "I read plan.md and its context.";
export const BLOCK = "Findings.\n\n\x60\x60\x60plan-findings\n" + JSON.stringify([{ severity: "High", section: "Rollout", line: 3, claim: "The rollout has no step that checks the new table before traffic moves.", evidence: "The Rollout section moves traffic first.", fix: "Check the table before moving traffic." }]) + "\n\x60\x60\x60";

/** gstack's learnings, review log and plan state under the session's state root, gstack's default root under HOME, and Claude Code's plan file. */
export const CARRY = [
  "$GSTACK_STATE_ROOT/projects/plan-unit/learnings.jsonl",
  "$GSTACK_STATE_ROOT/projects/plan-unit/main-reviews.jsonl",
  "$GSTACK_STATE_ROOT/projects/plan-unit/ceo-plans/2026-11-02-plan.md",
  "$HOME/.gstack/projects/plan-unit/learnings.jsonl",
  "$HOME/.claude/plans/plan-review.md",
];

const MODEL = "claude-opus-5-5";

if (import.meta.main) {
  const [mode, records, out, root] = process.argv.slice(2) as ["gates" | "carryover", string, string, string];
  const scratch = (name: string) => mkdtempSync(join(root, name));
  const panel = planPanel(scratch("panel-"), { seeded: 1 });
  const u = panel.suite.units[0]!;
  const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
  const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(scratch("unit-"), "repo"), baseBranch: "main" });
  const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(scratch("tree-"), "tree"), image: "unused", test: null, install: null, scratch: scratch("build-"), run: () => { throw new Error("a plan unit runs no container"); } });
  const home = scratch("gstack-");
  const gdir = join(home, ".claude", "skills", "gstack");
  mkdirSync(join(gdir, "bin"), { recursive: true });
  mkdirSync(join(gdir, "scripts"), { recursive: true });
  writeFileSync(join(gdir, "scripts", "question-registry.ts"), "  'plan-review-scope': { id: 'plan-review-scope' },\n");
  for (const lens of LENSES) {
    const skill = PLAN_LENSES[lens].skill;
    mkdirSync(join(gdir, skill), { recursive: true });
    writeFileSync(join(gdir, skill, "SKILL.md"), SKILL_MD[lens]);
    symlinkSync(join("gstack", skill), join(home, ".claude", "skills", skill));
  }
  const stub = join(import.meta.dir, "..", "..", "adapters", "fixtures", "stub-cli.cjs");
  const sessions: { home: string; state_root: string }[] = [];
  const sandbox = (stubEnv: (n: number) => Record<string, string>): Sandbox => {
    const base = localSandbox((h) => cpSync(home, h, { recursive: true, verbatimSymlinks: true }));
    return {
      ...base,
      agent: (task, o) => {
        const a = base.agent(task, o);
        const n = sessions.push({ home: o.env.HOME!, state_root: o.env.GSTACK_STATE_ROOT! });
        return { ...a, spawn: (argv: string[], env: Record<string, string> = {}) => a.spawn(argv[0] === "claude" ? [process.execPath, stub, ...argv.slice(1)] : argv, { ...env, ...stubEnv(n) }) };
      },
    };
  };
  const h = harness(() => [{ type: "text", text: "unused" }]);
  const run = async (lens: PlanLens, passes: number, dir: string, stubEnv: (n: number) => Record<string, string>) => {
    const skill = PLAN_LENSES[lens].skill;
    const sb = sandbox(stubEnv);
    const gstack = { tree_sha256: "gstack-tree", skill: { roots: [".claude/skills/" + skill, ".claude/skills/gstack/" + skill], skillMd: ".claude/skills/gstack/" + skill + "/SKILL.md", dir: join(gdir, skill), file: join(gdir, skill, "SKILL.md") }, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], layers: [{ src: home, dest: "" }] };
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => h.proxy.bind(request),
      finalize: (m) => h.proxy.finalize(m),
      arms: { gstack },
      sandbox: () => sb,
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
    };
    const input: ReviewRunInput = { host: "claude", suite: { id: "plan-v3-gates-test", sha256: null }, units: [{ unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null }], arms: [{ name: "gstack", told: "gstack" }], models: [MODEL], passes, parallel: 1, timeoutS: 60, cap: 50_000_000, runId: "plan-v3-" + mode + "-" + lens, out: dir, date: "2026-11-02", policy: loadPolicy(DEFAULT_POLICY) as LoadedPolicy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens }, severityMap: { gstack: PLAN_SEVERITY_MAP }, env: {} };
    return (await runReviewUnits(input, rig)).stops;
  };
  const stops: Record<string, unknown> = {};
  try {
    if (mode === "gates") {
      for (const lens of LENSES) {
        const skill = PLAN_LENSES[lens].skill;
        const script = [{ calls: [{ name: "Skill", input: { skill } }, { name: "AskUserQuestion", input: { questions: [GATES[lens]] } }], content: [{ type: "text", text: TURN1 }] }, { content: [{ type: "text", text: BLOCK }] }];
        stops[lens] = await run(lens, 1, join(out, lens), () => ({ STUB_MODE: "script", STUB_SCRIPT: JSON.stringify(script), STUB_RECORD: join(records, lens + ".ndjson"), STUB_PROBE: JSON.stringify(["$HOME/.claude/skills/" + skill + "/SKILL.md"]) }));
      }
    } else {
      const script = [{ content: [{ type: "text", text: TURN1 }] }, { content: [{ type: "text", text: BLOCK }] }];
      const first = (p: string) => p.replace("$HOME", sessions[0]!.home).replace("$GSTACK_STATE_ROOT", sessions[0]!.state_root);
      stops.carryover = await run("eng", 2, out, (n) => ({ STUB_MODE: "script", STUB_SCRIPT: JSON.stringify(script), STUB_RECORD: join(records, "s" + n + ".ndjson"), STUB_TOUCH: JSON.stringify(CARRY), STUB_PROBE: JSON.stringify(n === 1 ? CARRY : [...CARRY, ...CARRY.filter((p) => p.startsWith("$GSTACK_STATE_ROOT/")).map(first)]) }));
    }
    console.log(JSON.stringify({ stops, sessions }));
  } finally {
    h.proxy.stop();
    removeTree(h.dir);
  }
}
