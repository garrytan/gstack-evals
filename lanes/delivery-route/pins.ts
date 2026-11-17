// Copyright (c) 2026 Garry Tan. MIT License.
// The delivery route eval's frozen values (prereg bundle BUNDLE): the four arms, the step text's sources, the models, the
// items and their caps, the planning rates and the bundle loader. Every other file of this lane takes its frozen values here.
// The rig is the harness mechanics eval's: its task setup, its closing line, its Claude Code and SDK pins, and L1's host and
// part machinery (quick/laneb/l1/l1.ts).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CLOSING, TASK_SETUP } from "../harness-mechanics/pins.ts";

export { CLOSING, TASK_SETUP };
export const REPO = resolve(import.meta.dir, "../..");
export const BUNDLE = "wiki/plans/2026-11-17-geva-547-delivery-route-prereg";
export const B1 = {
  // The draw's seed (draw.py), minted from random bytes; seeded() shuffles each part's task and arm order from it too.
  seed: 2104467713,
  tasks: 60,
  concurrent: 6,
  // 20 tasks x 4 arms is 80 sessions a part, the harness mechanics part size.
  partTasks: 20,
  hostRoot: "b1",
  ledgerPort: "9947",
  armManifests: "arms/manifests/b1",
  // The all-in stop: every item's projection plus the crew's counter past this goes to the Captain before the next launch.
  stopUsd: 930,
  // The bar each arm is read against, per model, and the gap rule: more than gapMax of an arm's planned sessions not graded
  // reads INCOMPLETE for that arm.
  bar: 0.8,
  gapMax: 0.1,
} as const;

// The step text and where it comes from. agent-skills (MIT, Copyright (c) 2025 Addy Osmani) at its pin: steps are lines 13
// to 18 of .claude/commands/test.md, the described skill's description is line 3 of skills/test-driven-development/SKILL.md,
// and the command's front matter is lines 1 to 4 of test.md. The gstack-shaped wrapper is gstack's verify/SKILL.md at its
// pin, every byte before "# /verify", with four substitutions (arms.ts SUBSTITUTIONS).
export const AGENT_SKILLS = {
  repo: "https://github.com/addyosmani/agent-skills",
  sha: "39b723ceebf81474d0557c1fecd01eddab585563",
  blobs: { ".claude/commands/test.md": "f77b5a4ebd140bf1147a838fb45cbca4c59d4404", "skills/test-driven-development/SKILL.md": "5dc0ae7e4ae4e4f6d60a6815f2643cda6ba3e99c" },
  steps: { file: ".claude/commands/test.md", from: 13, to: 18 },
  frontMatter: { file: ".claude/commands/test.md", from: 1, to: 4 },
  description: { file: "skills/test-driven-development/SKILL.md", line: 3 },
} as const;
export const GSTACK_WRAPPER = {
  repo: "https://github.com/garrytan/gstack",
  sha: "5b4fa9ea335e3ba743a36e3269da95980b77b32d",
  version: "1.99.5.0",
  blobs: { "verify/SKILL.md": "ee6e6e266db59422264aeca53ba26459bdcc8352" },
  before: "# /verify",
} as const;
export const ARM_SOURCES = "lanes/delivery-route/arms";
export const SKILL = "prove-it";
export const DESCRIBED_SKILL = "test-driven-development";

// The four arms as Lane B arm specs (grid.ts armSpec), on the harness mechanics tail: Claude Code's own system prompt, the
// hook-state and transcript copy, the snapshot strip and the STATUS closing line. The typed arms open the prompt with
// "/prove-it ". No arm runs gstack-checks trust, since no tar holds gstack.
const TAIL = ":system_prompt=claude-code-preset:gstack_hooks=copy:strip_snapshot=true:closing_line=" + CLOSING.key;
export const ARMS = {
  none: { spec: "none" + TAIL, tar: "none", typed: false },
  described: { spec: "described:tar=described" + TAIL, tar: "described", typed: false },
  "gstack-shaped": { spec: "gstack-shaped:tar=gstack-shaped:told=" + SKILL + TAIL, tar: "gstack-shaped", typed: true },
  command: { spec: "command:tar=command:told=" + SKILL + TAIL, tar: "command", typed: true },
} as const;
export type B1Arm = keyof typeof ARMS;
export const ARM_NAMES = Object.keys(ARMS) as B1Arm[];
export const TARS = ARM_NAMES.map((a) => ARMS[a].tar);
export const isArm = (x: string): x is B1Arm => Object.hasOwn(ARMS, x);

// Models under test as the harness mechanics eval ran them in Claude Code, at its Stage 4 allowances.
export const MODELS = {
  opus: { id: "claude-opus-5-5", cells: "cells.l1.json", allowanceUsd: 5 },
  sol: { id: "gpt-6.1-sol", cells: "cells.hm-sol-s4.json", allowanceUsd: 10 },
  p1: { id: "particle-1", cells: "cells.hm-p1.json", allowanceUsd: 2 },
} as const;
export type ModelKey = keyof typeof MODELS;
export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];
export const modelKey = (id: string) => MODEL_KEYS.find((k) => MODELS[k].id === id);

// Planning rates per session: the harness mechanics Stage 4 mean cost, rounded up to the cent. The plain arms (none,
// described) take that eval's none arm; the typed arms take the larger of its none and verify-prose arms.
export const RATES_USD = {
  plain: { opus: 0.28, sol: 0.46, p1: 0.11 },
  typed: { opus: 0.45, sol: 0.46, p1: 0.13 },
} as const;
export const armRate = (arm: B1Arm, m: ModelKey) => (ARMS[arm].typed ? RATES_USD.typed : RATES_USD.plain)[m];
export const VM_HOURS_PER_SESSION = 0.05;

// The two smoke tasks run every arm on every model before the main run; their sessions feed the scorer hand-check, never the
// primary. Each is in the screened pool and outside the drawn 60.
export const SMOKE_TASKS = ["yt-project__unyt-628", "getmoto__moto-9590"];
// Ledger items and their caps in USD: ceil10(1.35 x expected model spend + concurrent x allowance + VM share), money.ts capOf.
export const CAPS_USD = { "b1-smoke": 90, "b1-opus": 170, "b1-sol": 230, "b1-p1": 70 } as const;
export type Item = keyof typeof CAPS_USD;
export const ITEM_NAMES = Object.keys(CAPS_USD) as Item[];
export const isItem = (x: string): x is Item => Object.hasOwn(CAPS_USD, x);
export const ITEM_MODEL: Record<Exclude<Item, "b1-smoke">, ModelKey> = { "b1-opus": "opus", "b1-sol": "sol", "b1-p1": "p1" };

export const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const input = (m: string): never => { throw new Error("E_B1_INPUT " + m); };

// The attachments block of the prereg's front matter: "  - <sha256>  <name>" lines.
export function frontMatterDigests(readme: string): Map<string, string> {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(readme)?.[1] ?? input(BUNDLE + "/README.md has no front matter");
  const out = new Map<string, string>();
  let inside = false;
  for (const line of fm.split("\n")) {
    if (/^attachments:\s*$/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    const m = /^  - ([0-9a-f]{64})  (\S+)$/.exec(line);
    if (m) out.set(m[2]!, m[1]!);
    else if (/^\S/.test(line)) inside = false;
  }
  if (!out.size) input(BUNDLE + "/README.md lists no attachments");
  return out;
}

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

/** draw.py's output, tasks.txt: "run <task>" lines in the draw's order, then "smoke <task>" lines. The run holds 60 tasks
 *  from 60 repositories (quick/laneb/tasks/swerebench-r3a4.json, case-folded), and the smoke is SMOKE_TASKS, from others. */
export function drawnTasks(b: Bundle = loadBundle()): { run: string[]; smoke: string[] } {
  const out = { run: [] as string[], smoke: [] as string[] };
  for (const line of b.text("tasks.txt").split("\n").filter((l) => l.trim())) {
    const m = /^(run|smoke) (\S+)$/.exec(line.trim()) ?? input("a tasks.txt line is not '<run|smoke> <task>': " + line);
    out[m[1] as "run" | "smoke"].push(m[2]!);
  }
  const repo = new Map<string, string>((JSON.parse(readFileSync(join(REPO, "quick/laneb/tasks/swerebench-r3a4.json"), "utf8")).tasks as { task_id: string; repo: string }[]).map((t) => [t.task_id, t.repo.toLowerCase()]));
  const all = [...out.run, ...out.smoke];
  if (all.some((t) => !repo.has(t))) input("tasks.txt names a task the SWE-rebench list does not hold: " + all.find((t) => !repo.has(t)));
  if (out.run.length !== B1.tasks || new Set(all.map((t) => repo.get(t))).size !== all.length) input("tasks.txt must hold " + B1.tasks + " run tasks and the smoke, each from its own repository");
  if (out.smoke.join() !== SMOKE_TASKS.join()) input("tasks.txt's smoke is " + out.smoke.join(", ") + ", not " + SMOKE_TASKS.join(", "));
  return out;
}
