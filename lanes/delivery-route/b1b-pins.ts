// Copyright (c) 2026 Garry Tan. MIT License.
// B1b's frozen values (prereg bundle B1B_BUNDLE): the two prose-route arms, the gstack commit their route files come from,
// the items and caps, the all-in stop, and the B1 run whose Opus none and typed-route arms B1b reads as references. B1's own
// frozen values (pins.ts) stay as merged; every B1b file takes its frozen values here.
import { ARMS, SKILL } from "./pins.ts";

export const B1B_BUNDLE = "wiki/plans/2026-11-18-capy-b1b-prose-route-prereg";

// Two arms on B1's rig tail. Neither is typed: both send B1's plain prompt. Each holds B1's gstack-shaped tree byte for byte
// (the prove-it skill and its three stand-in scripts) plus its route's own files (arms.ts LAYOUT, B1B_EXTRA in b1b.ts).
const TAIL = ARMS.none.spec.slice("none".length);
export const B1B_ARMS = {
  "claude-md": { spec: "claude-md:tar=claude-md" + TAIL, tar: "claude-md", typed: false },
  hook: { spec: "hook:tar=hook" + TAIL, tar: "hook", typed: false },
} as const;
export type B1bArm = keyof typeof B1B_ARMS;
export const B1B_ARM_NAMES = Object.keys(B1B_ARMS) as B1bArm[];
export const isB1bArm = (x: string): x is B1bArm => Object.hasOwn(B1B_ARMS, x);

// gstack main at the pin: the routing block's writer, the routing hook and the files it imports, and the two commands that
// write the hook's registration and its switch. Each is checked against its git blob when sources are regenerated.
export const GSTACK_MAIN = {
  repo: "https://github.com/garrytan/gstack",
  sha: "bbf48aa7ef195459afcf7d7840af7073cd050734",
  version: "1.100.0.0",
  blobs: {
    "bin/gstack-skill-start": "c371df7b3bcda8c808989d6015db8bd5f9574aac",
    "hosts/claude/hooks/skill-route-hook": "7fdcd2d71243bc36a4c4503687c1be5a304861bd",
    "hosts/claude/hooks/skill-route-hook.ts": "61ae7abfdd37d2ea542710d48f442b54bdecf607",
    "lib/skill-route.ts": "b74e7374a3c642dab8733f414c2997eca8857710",
    "lib/skill-contract.ts": "a6996e2db0d3d4410defa85e3e1053044eb69aa2",
    "lib/fs-atomic.ts": "4b453b455213041b08d8d8a245a914d6f11adc49",
    "lib/skill-triggers.ts": "b7d29d9edb90764b4d2a9329fad904ab23cbd541",
    "lib/state-root.ts": "34a0fa75638678c74f8fb7c7c799ab8c22463cf8",
    "bin/gstack-settings-hook": "bf63cd84efafd44a8e0808b1adfeab5beb6d78f5",
    "bin/gstack-config": "239c1ee1bd8a1ccc32e5f94b8ee70e5a861eb6e7",
  },
} as const;

// The claude-md arm's file: the "## Skill routing" section gstack-skill-start offers to append to a project's CLAUDE.md, from
// its heading to the line before "If B:", with one line changed so the block names the arm's skill. At the pin the bug line
// routes to no skill ("fix them directly"), so that line, and only that line, becomes the block's own "invoke" form.
export const ROUTING = {
  file: "bin/gstack-skill-start",
  heading: "## Skill routing\n",
  end: "\n\nIf B: ",
  bug: ["- Bugs/errors \u2192 fix them directly: one read-only check of the cause, or a focused failing test first when the cause is unclear; then fix it and run that test\n", "- Bugs/errors \u2192 invoke /" + SKILL + "\n"] as [string, string],
  // Where the arm puts it: the user's CLAUDE.md, which Claude Code loads with the user setting source. The rig strips every
  // CLAUDE.md from the task's tree before the arm lands, and a file in the tree would join the graded diff.
  path: ".claude/CLAUDE.md",
} as const;

// The hook arm's files under ~/.claude/skills/gstack, where ./setup's global install puts them, each with its upstream mode.
// The repo keeps the TypeScript files as <name>.txt (they are arm bytes, never compiled here).
export const HOOK_DIR = ".claude/skills/gstack";
export const HOOK_FILES: { file: string; mode: number }[] = [
  { file: "hosts/claude/hooks/skill-route-hook", mode: 0o755 },
  { file: "hosts/claude/hooks/skill-route-hook.ts", mode: 0o755 },
  { file: "lib/skill-route.ts", mode: 0o644 },
  { file: "lib/skill-contract.ts", mode: 0o644 },
  { file: "lib/fs-atomic.ts", mode: 0o644 },
  { file: "lib/skill-triggers.ts", mode: 0o644 },
  { file: "lib/state-root.ts", mode: 0o644 },
];
// The one change to gstack's hook: it names the arm's skill on every prompt. gstack routes only /review, /qa and /verify
// (ROUTED_SKILLS), and its matcher fires on a prompt only when a trigger scores 0.66, so as shipped it never names prove-it.
// Patched, it takes the skill's best-scoring trigger from gstack's own scorer, or its first trigger when none scores, and
// prints gstack's own hint line (hintLine) for it. Everything else in the hook runs as shipped.
export const HOOK_SUBSTITUTIONS: [string, string][] = [
  ["  scanInstalledSkills, type RouteCandidate,\n", "  scanInstalledSkills, scorePrompt, type RouteCandidate,\n"],
  ["  const decision = routePrompt(p.prompt, skills);\n",
    "  const arm = skills.find(s => s.name === '" + SKILL + "');\n" +
    "  const best = arm ? scorePrompt(p.prompt, [arm])[0] : undefined;\n" +
    "  const decision = arm ? { route: best ?? { skill: arm.name, score: 0, matched: 0, trigger: arm.triggers[0] ?? arm.name, file: arm.file }, candidates: best ? [best] : [] } : routePrompt(p.prompt, skills);\n"],
];
// The registration and the switch, as gstack writes them at the pin (b1b.ts sources runs the two commands).
export const HOOK_REGISTRATION = { settings: ".claude/settings.json", event: "UserPromptSubmit", command: "/root/" + HOOK_DIR + "/hosts/claude/hooks/skill-route-hook", source: "gstack-skill-route", timeout: 5 };
export const HOOK_SWITCH = { config: ".gstack/config.yaml", key: "skill_routing", value: "on" };

// Items, caps and the all-in stop. A session's planning rate is B1's measured Opus gstack-shaped mean (0.4773), rounded up
// to the cent: the session that loads the skill runs its setup, as the typed gstack-shaped arm did.
export const B1B = {
  stopUsd: 250,
  hostRoot: "b1b",
  ledgerPort: "9948",
  armManifests: "arms/manifests/b1b",
  rateUsd: 0.48,
} as const;
export const B1B_CAPS_USD = { "b1b-smoke": 40, "b1b-opus": 130 } as const;
export type B1bItem = keyof typeof B1B_CAPS_USD;
export const B1B_ITEMS = Object.keys(B1B_CAPS_USD) as B1bItem[];
export const isB1bItem = (x: string): x is B1bItem => Object.hasOwn(B1B_CAPS_USD, x);

// The B1 run B1b reads its references from: its counted runs' commit, its results bundle (sessions.jsonl, pinned by the
// bundle's front matter), and the paths whose trees decide what a session gets. The none arm is reused only while each of
// these trees is the same at B1b's run commit as at B1's (b1b.ts reuseCheck).
export const B1_RUN = {
  commit: "b12a7b755cdfec9c8f9054864f7e1245f1d054f3",
  results: "wiki/board/2026-11-18-geva-548-delivery-route-results",
  harness: [
    "quick/laneb/runner",
    "quick/laneb/l1",
    "quick/laneb/config",
    "quick/laneb/tasks/swerebench-r3a4.json",
    "quick/laneb/arms/manifests/b1/none.json",
    "lanes/harness-mechanics/pins.ts",
    "lanes/harness-mechanics/task-setup.Dockerfile",
    "lanes/delivery-route/pins.ts",
    "lanes/delivery-route/plans.ts",
    "lanes/delivery-route/detect.ts",
    "wiki/plans/2026-11-17-geva-547-delivery-route-prereg/tasks.txt",
  ],
} as const;
