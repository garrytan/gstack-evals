// Copyright (c) 2026 Garry Tan. MIT License.
// B1e's frozen values (prereg bundle B1E_BUNDLE): gstack at its newest stable tag, installed by its own setup with B1's
// prove-it skill beside it, in four arms that differ only in how prove-it can be found (the prompt-routing hook on, or the
// hook off with prove-it's own description, the long rewrite or the REQUIRED rewrite), and B1's no-gstack arm; the two task
// sets, the pilot, the items and caps, and the margin and bound the readings use. B1's, B1b's, B1c's and B1d's frozen values
// stay as merged.
import { B1D_SMOKE, PROVE_IT } from "./b1d-pins.ts";
import { ARMS } from "./pins.ts";

export const B1E_BUNDLE = "wiki/plans/2026-11-21-capy-b1e-description-rewrite-prereg";

// gstack at the newest stable tag when this plan froze, fetched by sha. Each file below is checked against its git blob at the
// pin in every built tree (b1e.ts treeProblems). The hook registrations and the user-only skills are what ./setup wrote at the
// pin in the built tree.
export const GSTACK_STABLE = {
  repo: "https://github.com/garrytan/gstack.git",
  tag: "v1.102.1.0",
  sha: "29bff55dd8a14b32ff282d5a37097e3a53e3250a",
  version: "1.102.1.0",
  loadout: "full",
  setup: "./setup --host claude --no-browser --loadout full",
  blobs: {
    "lib/skill-route.ts": "db4b687142b58cf5f0855f6aa6b8eb312c6b6c6c",
    "lib/skill-triggers.ts": "b7d29d9edb90764b4d2a9329fad904ab23cbd541",
    "hosts/claude/hooks/skill-route-hook": "7fdcd2d71243bc36a4c4503687c1be5a304861bd",
    "hosts/claude/hooks/skill-route-hook.ts": "a55f877c28778e66cf9d5d4883e75f6379be36c5",
    "hosts/claude/hooks/destructive-guard-hook": "186fb61e61f172acb88f488cb3cb790910ad59ed",
    "bin/gstack-skill-start": "90eea840791dd4f182e6b302bc14f471e8d125d1",
    "bin/gstack-skill-load": "5bd5623abd7592a6c3e74d6af24163a3ff50245f",
    "bin/gstack-config": "d3a4a4d29d9878b44dee58c4ab1d9e5178974046",
    "bin/gstack-session-kind": "5071ad0fb36baa9160c9456515132e95f09ca10f",
    setup: "64f01d4057fb33441cade69b293df181d646a3b0",
  },
  // ./setup's hook registrations in ~/.claude/settings.json: event, matcher, command under
  // ~/.claude/skills/gstack/hosts/claude/hooks/, timeout and gstack's source tag. The same four as at B1d's pin.
  hooks: [
    ["Stop", null, "timeline-stop-hook", 5, "gstack-timeline-stop"],
    ["Stop", null, "skill-contract-stop-hook", 10, "gstack-skill-contract"],
    ["UserPromptSubmit", null, "skill-route-hook", 5, "gstack-skill-route"],
    ["PreToolUse", "Bash|PowerShell", "destructive-guard-hook", 10, "gstack-destructive-guard"],
  ] as [string, string | null, string, number, string][],
  // The full loadout installs 65 skill folders, prove-it included. Two set disable-model-invocation, so Claude Code lists
  // the other 63, each with its whole description, beside its own plugin-authoring.
  listed: 63,
  userOnly: ["land-and-deploy", "modernize"],
} as const;

// The arms. hook is gstack as installed, its prompt-routing hook on by default, prove-it at its own description. own, long and
// required are the hook arm's tree with one gstack-config switch, `gstack-config set skill_routing off`, and, for long and
// required, prove-it's SKILL.md replaced by the same file with only its description line rewritten (lanes/delivery-route/
// arms/b1e). none is B1's no-gstack arm. Every gstack arm lists gstack's skills in full; no arm sets
// CLAUDE_CODE_DISABLE_1M_CONTEXT.
const TAIL = ARMS.none.spec.slice("none".length);
const arm = (name: string, routing: "on" | "off", skill: string, rateUsd: number) => ({ spec: name + ":tar=" + name + TAIL, routing, skill, rateUsd });
export const B1E_ARMS = {
  hook: arm("hook", "on", PROVE_IT.source, 0.48),
  own: arm("own", "off", PROVE_IT.source, 0.48),
  long: arm("long", "off", "b1e/prove-it-long.md", 0.48),
  required: arm("required", "off", "b1e/prove-it-required.md", 0.48),
  none: { spec: ARMS.none.spec, routing: null, skill: null, rateUsd: 0.31 },
} as const;
export type B1eArm = keyof typeof B1E_ARMS;
export const B1E_ARM_NAMES = Object.keys(B1E_ARMS) as B1eArm[];
export const GSTACK_ARMS = ["hook", "own", "long", "required"] as const;
export type GstackArm = (typeof GSTACK_ARMS)[number];
export const isB1eArm = (x: string): x is B1eArm => Object.hasOwn(B1E_ARMS, x);
// The description lines the arms' prove-it files carry, frozen byte for byte (the rewrites from our quick look of 2026-11-19).
export const DESCRIPTIONS = {
  own: { sha256: "4aeeb6e4a3e2a4b129b75eb8f1a751eee895e707abbd4c5804cdd7d4f06fdc51", chars: 81 },
  long: { sha256: "b6862147bc42dd9de1b76adb41a7ec8f300b69b00307fa68257d3a2ecd415e3f", chars: 546 },
  required: { sha256: "8fa9e4484e775507c131598924aaaa2001b92903672f2db15fb82e2a46ff7cfe", chars: 289 },
} as const;

// The task sets (B1E_BUNDLE/sets.py): primary is B1d's held-out pool minus its feature-titled tasks; extension is 81 more
// bug-fix tasks that passed swerebench-r3a4's oracle preflight, run on the hook and the two rewrites so their comparisons
// read on 162 tasks; non-fit is every feature-titled swerebench-r3a4 task outside B1's 62, the primary set and the pilot
// tasks. reserve replaces an extension task the pilot can't supply, in its order; supply is the pilot's supply sample,
// each task on one arm.
export const EXT_ARMS = ["hook", "long", "required"] as const;
export const TASK_SETS = {
  pool: { tasks: 89, sortedSha256: "36c7b92de330e618c4560b121f987c32491bf8bac6b0bd5de07b85c0951fecf7" },
  primary: { file: "primary.txt", tasks: 81, repos: 71, sortedSha256: "b4e9dea8d3cef6e93e5baeaea8af8fe43aeb5e96d63137569ea0a738d7d38aeb", arms: [...B1E_ARM_NAMES] },
  extension: { file: "extension.txt", tasks: 81, repos: 67, sortedSha256: "eff3f3777e45937b8c605058e6cad927a5ad4e05f3d405bba8a3f5d654c25af4", arms: [...EXT_ARMS] },
  nonfit: { file: "nonfit.txt", tasks: 27, repos: 24, sortedSha256: "f9ac8566e250d70139f127c5d2f47dcb79e49556ae4bbbdc30e46e4acd56670d", arms: [...GSTACK_ARMS] },
} as const;
export const RESERVE = { file: "reserve.txt", tasks: 34, sha256: "9d31f8c9f56895d7bced4223678b36c679e4817fdb15a446e00f8a4709f86688" } as const;
export const SUPPLY = { file: "supply.txt", cells: 10, sha256: "7645bd3018c8af16bb797b8c4a44aa6b7b30af9288b6ed04bd228079d3ef946f" } as const;
export const B1E_PILOT = [B1D_SMOKE[0]] as const;

export const B1E = {
  // The all-in stop: every item's spend or projection plus B1e's share of this lane's own counter.
  stopUsd: 700,
  hostRoot: "b1e",
  ledgerPort: "9951",
  armManifests: "arms/manifests/b1e",
  armsDirEnv: "B1E_ARMS_DIR",
  partTasks: 21,
  // The non-inferiority margin on steps followed (B1c's and B1d's margin), in proportion points.
  margin: 0.15,
  // Over-loading: a rewrite loads prove-it anywhere in at least this share of its graded non-fit sessions.
  overload: 1 / 3,
} as const;

// Items and caps. b1e-pilot is the pilot (R111): the pilot task on the four gstack arms and the supply sample; b1e-main holds
// the three task sets. Planning rates per session (B1E_ARMS): the gstack arms at B1d's gstack-main rate ($0.48), none at B1's
// none rate ($0.31).
export const B1E_CAPS_USD = { "b1e-pilot": 50, "b1e-main": 560 } as const;
export type B1eItem = keyof typeof B1E_CAPS_USD;
export const B1E_ITEMS = Object.keys(B1E_CAPS_USD) as B1eItem[];
export const isB1eItem = (x: string): x is B1eItem => Object.hasOwn(B1E_CAPS_USD, x);
