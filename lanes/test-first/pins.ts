// Copyright (c) 2026 Garry Tan. MIT License.
// B2's frozen values (prereg bundle BUNDLE, wiki/plans/2026-11-21-capy-b2-test-first-prereg): the bundle and its attachment
// digests, the 183 run tasks in run order and the three pilot tasks, the interim half, the seed, gstack and Codex at their
// pins, the models, their hosts and allowances, the four arms on each host, the line, the bounds, the procedure gate, the
// INCOMPLETE rule, the items and caps with their planning rates, and the all-in stop. Every other file of this lane takes its
// frozen values here. The rig is B1's (lanes/delivery-route) on Claude Code and the Codex hooks eval's part R
// (lanes/codex-hooks/r) on Codex CLI.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CLOSING, frontMatterDigests, sha256, TASK_SETUP as CC_TASK_SETUP } from "../delivery-route/pins.ts";
import { CODEX } from "../codex-hooks/pins.ts";
import { PROVE_IT as CODEX_PROVE_IT, TASK_SETUP as CODEX_TASK_SETUP_PIN } from "../codex-hooks/r/pins.ts";

export { CLOSING, CODEX, sha256 };
export { QUESTION_REPLY } from "../codex-hooks/r/pins.ts";
export const REPO = resolve(import.meta.dir, "../..");
export const HERE = "lanes/test-first";
export const BUNDLE = "wiki/plans/2026-11-21-capy-b2-test-first-prereg";

const input = (m: string): never => { throw new Error("E_B2_INPUT " + m); };

// The run (sections 3, 11 and 15): 183 tasks from 126 repositories in one seeded order, the first 92 the interim look's
// half, eight parts of 23 tasks a model (the last 22), a task's four arms in one part, six sessions at once.
export const B2 = {
  seed: 771515331,
  tasks: 183,
  repos: 126,
  half: 92,
  partTasks: 23,
  parts: 8,
  // Parts 1 to 4 hold the look's half: 4 x 23 = 92.
  lookParts: 4,
  concurrent: 6,
  hostRoot: "b2",
  ledgerPort: "9953",
  armManifests: "arms/manifests/b2",
  armsDirEnv: "B2_ARMS_DIR",
  // The all-in stop (Agent notes): every item's projection plus this thread's own counter.
  stopUsd: 1860,
  // Section 8: a model is INCOMPLETE when any of its arms has more than this share of its tasks not graded.
  gapMax: 0.1,
} as const;
// draw.txt's digests: the sorted and ordered run, and the ordered half.
export const DRAW = {
  sortedSha256: "2eda910bfe0bfaa63d44da33f4c4d3cad4851444d514095e9aff83c778f2c23e",
  orderedSha256: "ddd9e4ce127de02b679880711a5d6d53063f776b6768ddc2ddf2534440ce5f53",
  halfSha256: "6bca01083a4abb5de9ac4c51109905294bde5da0eab79a00ddabe6a51eb4afb2",
} as const;
export const PILOT_TASKS = ["koxudaxi__datamodel-code-generator-3071", "tox-dev__tox-3810", "imperialcollegelondon__pyrealm-593"] as const;

// gstack at the newest stable tag when the plan froze, fetched by sha (section 4).
export const GSTACK = {
  repo: "https://github.com/garrytan/gstack.git",
  tag: "v1.102.1.0",
  sha: "29bff55dd8a14b32ff282d5a37097e3a53e3250a",
  version: "1.102.1.0",
  loadout: "full",
  claudeSetup: "./setup --host claude --no-browser --loadout full",
  codexSetup: "./setup --host codex --no-browser",
} as const;

// The line (section 4), the whole of the user's instructions file in the line arm on each host.
export const LINE = "When you fix a bug, first write a test that reproduces it and run it to see it fail, then fix the bug and run the test again to see it pass.";
export const LINE_FILE = LINE + "\n";
export const SKILL = "prove-it";
// B1's gstack-shaped prove-it skill (lanes/delivery-route/arms/gstack-shaped-SKILL.md, 9,343 bytes), and its Codex rewrite as
// part R installs it (four ~/.claude/skills/gstack paths changed to ~/.codex/skills/gstack).
export const PROVE_IT = {
  source: "lanes/delivery-route/arms/gstack-shaped-SKILL.md",
  sha256: "4aeeb6e4a3e2a4b129b75eb8f1a751eee895e707abbd4c5804cdd7d4f06fdc51",
  bytes: 9343,
  claudePath: ".claude/skills/prove-it/SKILL.md",
  codexPath: CODEX_PROVE_IT.path,
  codexSha256: CODEX_PROVE_IT.sha256,
  // The Prove-It steps: lines 13 to 18 of .claude/commands/test.md in agent-skills at 39b723ce (MIT).
  stepsSha256: "47bfc31f877aef8938dfabc4984a759eaaa1f8f7588a408c542199bde6e34557",
  stepLine: CODEX_PROVE_IT.stepLine,
} as const;

// The two hosts. Claude Code: B1's rig, Claude Code 2.1.312, the SDK at 0.2.174, B1's task setup. Codex: Codex CLI 0.170.0
// (tarball and binary by sha256), part R's task setup (B1's lines plus Codex), CODEX_HOME /root/.codex.
export const HOSTS = {
  claude: { cli: "claude-code", version: "2.1.312", sdk: "0.2.174", taskSetup: { file: CC_TASK_SETUP.file, sha256: CC_TASK_SETUP.sha256 } },
  codex: { cli: "codex", version: CODEX.version, tarballSha256: CODEX.tarballSha256, binarySha256: CODEX.binarySha256, taskSetup: { file: CODEX_TASK_SETUP_PIN.file, sha256: CODEX_TASK_SETUP_PIN.sha256 } },
} as const;
export type Host = keyof typeof HOSTS;
export const CODEX_HOME = "/root/.codex";
export const CODEX_BIN = "/opt/laneb/codex/bin/codex";

// Section 5: the models, each on its host, with its route's cells and its session allowance in USD. Sol's reasoning effort is
// pinned low.
export const MODELS = {
  opus: { id: "claude-opus-5-5", host: "claude", cells: "cells.l1.json", allowanceUsd: 5, effort: null },
  sol: { id: "gpt-6.2-sol", host: "codex", cells: "cells.b2-sol.json", allowanceUsd: 5, effort: "low" },
  p1: { id: "particle-1", host: "claude", cells: "cells.hm-p1.json", allowanceUsd: 2, effort: null },
} as const;
export type ModelKey = keyof typeof MODELS;
export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];
export const modelKey = (id: string): ModelKey | undefined => MODEL_KEYS.find((k) => MODELS[k].id === id);
export const SOL_EFFORT = MODELS.sol.effort;

// Section 4: the four arms. Claude Code arms take B1's tail (Claude Code's own system prompt, the hook-state copy, the strip
// and the closing line); Codex arms take the strip and the closing line. The gstack arms run with GSTACK_SESSION_KIND
// unattended; the prove-it arm is typed (told=prove-it), "/prove-it " on Claude Code and "$prove-it " on Codex.
export const ARM_KEYS = ["none", "line", "gstack", "prove-it"] as const;
export type Arm = (typeof ARM_KEYS)[number];
export const isArm = (x: string): x is Arm => (ARM_KEYS as readonly string[]).includes(x);
const CC_TAIL = ":system_prompt=claude-code-preset:gstack_hooks=copy:strip_snapshot=true:closing_line=" + CLOSING.key;
const CX_TAIL = ":strip_snapshot=true:closing_line=" + CLOSING.key;
const GSTACK_ARM: Record<Arm, boolean> = { none: false, line: false, gstack: true, "prove-it": true };
export type ArmDef = { label: string; arm: Arm; host: Host; tar: string; spec: string; gstack: boolean; typed: boolean };
export const labelOf = (host: Host, arm: Arm) => (host === "codex" ? "cx-" : "") + arm;
const def = (host: Host, arm: Arm): ArmDef => {
  const label = labelOf(host, arm);
  const spec = label + (arm === "prove-it" ? ":told=" + SKILL : "") + (GSTACK_ARM[arm] ? ":session_kind=unattended" : "") + (host === "codex" ? CX_TAIL : CC_TAIL);
  return { label, arm, host, tar: label, spec, gstack: GSTACK_ARM[arm], typed: arm === "prove-it" };
};
// Every arm label the launcher knows, Claude Code's four and Codex's four (cx-*), each with its own tar.
export const ARM_DEFS: Record<string, ArmDef> = Object.fromEntries((["claude", "codex"] as Host[]).flatMap((h) => ARM_KEYS.map((a) => def(h, a))).map((d) => [d.label, d]));
export const LABELS = Object.keys(ARM_DEFS);
export const TARS = LABELS.map((l) => ARM_DEFS[l]!.tar);
export const labelsOf = (host: Host) => ARM_KEYS.map((a) => labelOf(host, a));
export const hostOf = (m: ModelKey): Host => MODELS[m].host;
// B1's none tar, byte for byte (section 4).
export const B1_NONE_SHA256 = "8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e";

// Sections 9 and 6.3: the bounds and the procedure gate.
export const BOUNDS = { look: 2.917, end: 2.068, regression: 2.576, z95: 1.959963984540054 } as const;
export const GATE = { pooledPoints: 0.2, opusRate: 0.5 } as const;

// Agent notes: the items, their caps, expected model spend, sessions, and the planning rates per session (USD), from B1's
// measured means and B1d's gstack arm. The caps are pre-run change 1's (wiki/plans/2026-11-21-geva-569-b2-test-first-change-1.md):
// $250 moved from b2-sol to b2-opus after the pilot's cost per session.
export const CAPS_USD = { "b2-pilot": 65, "b2-opus": 715, "b2-sol": 355, "b2-p1": 230 } as const;
export const CHANGE_1 = "wiki/plans/2026-11-21-geva-569-b2-test-first-change-1.md";
// The cap rule's output on the drawn plan, as the preregistration recorded it before change 1. Change 1 moves cap between
// items and keeps their sum.
export const PREREG_CAPS_USD: Record<keyof typeof CAPS_USD, number> = { "b2-pilot": 65, "b2-opus": 465, "b2-sol": 605, "b2-p1": 230 };
export type Item = keyof typeof CAPS_USD;
export const ITEM_NAMES = Object.keys(CAPS_USD) as Item[];
export const isItem = (x: string): x is Item => Object.hasOwn(CAPS_USD, x);
export type CountedItem = Exclude<Item, "b2-pilot">;
export const COUNTED: CountedItem[] = ["b2-opus", "b2-sol", "b2-p1"];
export const ITEM_MODEL: Record<CountedItem, ModelKey> = { "b2-opus": "opus", "b2-sol": "sol", "b2-p1": "p1" };
export const EXPECTED_USD = { "b2-pilot": 12.87, "b2-opus": 281.82, "b2-sol": 384.3, "b2-p1": 118.95 } as const;
export const SESSIONS = { "b2-pilot": 36, "b2-opus": 732, "b2-sol": 732, "b2-p1": 732 } as const;
export const RATES_USD: Record<ModelKey, Record<Arm, number>> = {
  opus: { none: 0.31, line: 0.31, gstack: 0.42, "prove-it": 0.5 },
  sol: { none: 0.45, line: 0.45, gstack: 0.55, "prove-it": 0.65 },
  p1: { none: 0.15, line: 0.15, gstack: 0.17, "prove-it": 0.18 },
};
// The cap rule rounds up to $5 (ceil5); a session's VM time for the part VM's blocks.
export const CAP_ROUND_USD = 5;
export const VM_HOURS_PER_SESSION = 0.05;
// Section 12: each arm's pilot cap, for the pilot report.
export const PILOT_ARM_CAPS_USD: Record<Arm, number> = { none: 13.79, line: 13.79, gstack: 17.27, "prove-it": 20.14 };

/** The prereg bundle, every attachment checked against its front-matter sha256. */
export type Bundle = { digests: Map<string, string>; text: (name: string) => string };
export function loadBundle(repo = REPO): Bundle {
  const dir = join(repo, BUNDLE);
  const digests = frontMatterDigests(readFileSync(join(dir, "README.md"), "utf8"));
  const texts = new Map<string, string>();
  for (const [name, want] of digests) {
    const bytes = readFileSync(join(dir, name));
    if (sha256(bytes) !== want) input(BUNDLE + "/" + name + " hashes to " + sha256(bytes) + ", not the front matter's " + want);
    texts.set(name, bytes.toString("utf8"));
  }
  return { digests, text: (name) => texts.get(name) ?? input(name + " is not an attachment of " + BUNDLE) };
}

const lines = (xs: string[]) => xs.join("\n") + "\n";
/** Every SWE-rebench task's repository, case-folded (quick/laneb/tasks/swerebench-r3a4.json): the cluster of section 9.2. */
export function repoOf(repo = REPO): Map<string, string> {
  return new Map((JSON.parse(readFileSync(join(repo, "quick/laneb/tasks/swerebench-r3a4.json"), "utf8")).tasks as { task_id: string; repo: string }[]).map((t) => [t.task_id, t.repo.toLowerCase()]));
}

/** tasks.txt: "run <task>" lines in run order, then "pilot <task>" lines, checked against draw.txt's digests and counts. */
export function drawnTasks(b: Bundle = loadBundle()): { run: string[]; half: string[]; pilot: string[] } {
  const run: string[] = [], pilot: string[] = [];
  for (const line of b.text("tasks.txt").split("\n").filter((l) => l.trim())) {
    const m = /^(run|pilot) (\S+)$/.exec(line.trim()) ?? input("a tasks.txt line is not '<run|pilot> <task>': " + line);
    (m[1] === "run" ? run : pilot).push(m[2]!);
  }
  const repo = repoOf();
  const unknown = [...run, ...pilot].find((t) => !repo.has(t));
  if (unknown) input("tasks.txt names a task the SWE-rebench list does not hold: " + unknown);
  if (run.length !== B2.tasks || new Set(run).size !== B2.tasks) input("tasks.txt holds " + run.length + " run tasks, not " + B2.tasks + " distinct");
  if (sha256(lines([...run].sort())) !== DRAW.sortedSha256 || sha256(lines(run)) !== DRAW.orderedSha256) input("tasks.txt's run is not draw.txt's (sorted or ordered sha256)");
  const half = run.slice(0, B2.half);
  if (sha256(lines(half)) !== DRAW.halfSha256) input("the first " + B2.half + " run tasks are not draw.txt's interim half");
  const repos = new Set(run.map((t) => repo.get(t))).size;
  if (repos !== B2.repos) input("the run tasks come from " + repos + " repositories, not " + B2.repos);
  if (pilot.join() !== PILOT_TASKS.join()) input("tasks.txt's pilot is " + pilot.join(", ") + ", not " + PILOT_TASKS.join(", "));
  if (pilot.some((t) => run.includes(t))) input("a pilot task is also a run task");
  return { run, half, pilot };
}
