// Copyright (c) 2026 Garry Tan. MIT License.
// B1d's frozen values (prereg bundle B1D_BUNDLE): the gstack-main arm (gstack main at the commit that makes installed skills
// routable, installed by its own setup with its hooks on by default, B1's prove-it skill beside it), the held-out draw and
// its arms, the smoke tasks, the items and caps, the all-in stop, and the earlier runs B1d reads rows from. B1's, B1b's and
// B1c's frozen values stay as merged; every B1d file takes its frozen values here.
import { B1B_RUN, B1C_SPEC } from "./b1c-pins.ts";
import { ARMS } from "./pins.ts";

export const B1D_BUNDLE = "wiki/plans/2026-11-19-capy-b1d-hook-default-prereg";

// The arm: gstack main at the pin, installed by gstack's own ./setup in Lane B's builder (quick/laneb/arms/Dockerfile,
// target gstack-l1-tar) with Lane B's seeded long-time user, plus B1's prove-it skill (arms/gstack-shaped-SKILL.md) at
// ~/.claude/skills/prove-it/SKILL.md byte for byte. The prompt is B1's plain prompt; nothing names the skill but the hook.
const TAIL = ARMS.none.spec.slice("none".length);
export const B1D_ARM = "gstack-main" as const;
export const B1D_SPEC = B1D_ARM + ":tar=" + B1D_ARM + TAIL;
export const PROVE_IT = { path: ".claude/skills/prove-it/SKILL.md", source: "gstack-shaped-SKILL.md", mode: 0o644 } as const;

// gstack main at the pin. The hook line comes from these files; each is checked against its git blob at the pin and, in the
// built tree, its sha256 (b1d.ts armProblems).
export const GSTACK_ARM = {
  repo: "https://github.com/garrytan/gstack.git",
  sha: "5afef04e31de1cb30c727c7f827bdd729d04713e",
  version: "1.101.0.0",
  loadout: "full",
  setup: "./setup --host claude --no-browser --loadout full",
  blobs: {
    "lib/skill-route.ts": "955948149bf27bffa3fb7b8a31b99edd407a7a32",
    "lib/skill-triggers.ts": "b7d29d9edb90764b4d2a9329fad904ab23cbd541",
    "hosts/claude/hooks/skill-route-hook": "7fdcd2d71243bc36a4c4503687c1be5a304861bd",
    "hosts/claude/hooks/skill-route-hook.ts": "9b204073f7cc9af14adf34f2bd3d64c71ea4b680",
    "hosts/claude/hooks/destructive-guard-hook": "186fb61e61f172acb88f488cb3cb790910ad59ed",
    "bin/gstack-skill-start": "c371df7b3bcda8c808989d6015db8bd5f9574aac",
    "bin/gstack-config": "ed96fcae570dd55c3469f518856c19c6894ace5a",
    "bin/gstack-session-kind": "88959293fc851aabe08e42c36daa60a49a9dc4e2",
    setup: "a2112cf281162b7c6673a5690b4341a997612dae",
  },
  // The hook registrations ./setup writes at the pin, in ~/.claude/settings.json: event, matcher, command under
  // ~/.claude/skills/gstack/hosts/claude/hooks/, timeout and gstack's source tag.
  hooks: [
    ["Stop", null, "timeline-stop-hook", 5, "gstack-timeline-stop"],
    ["Stop", null, "skill-contract-stop-hook", 10, "gstack-skill-contract"],
    ["UserPromptSubmit", null, "skill-route-hook", 5, "gstack-skill-route"],
    ["PreToolUse", "Bash|PowerShell", "destructive-guard-hook", 10, "gstack-destructive-guard"],
  ] as [string, string | null, string, number, string][],
  // gstack-config's view of the two switches in the built arm: both on, by default.
  config: { skill_routing: "on", skill_contracts: "on" },
  // The full loadout installs 65 skill folders, prove-it included. Two set disable-model-invocation, so Claude Code lists
  // the other 63, each with its whole description, beside its own plugin-authoring.
  listed: 63,
  userOnly: ["land-and-deploy", "modernize"],
} as const;

/** A gstack pin as the arm checks read it; B1e's arm (b1e-pins.ts) is another one. */
export type GstackPin = { repo: string; sha: string; version: string; setup: string; blobs: Readonly<Record<string, string>>; hooks: readonly (readonly [string, string | null, string, number, string])[]; config: Readonly<Record<string, string>> };

// The held-out arms. project-md is B1c's arm unchanged (spec, tar and manifest). project-md-noescape is B1c's arm with one
// change to its block: the escape clause after "Route only to skills in the session's available-skills list" goes, and
// nothing else in the block, the placement script or the tree changes. none is B1's no-gstack arm.
export const NOESCAPE = { arm: "project-md-noescape", from: "; answer directly for quick questions or small scoped edits.", to: ".", source: "b1d/CLAUDE-noescape.md" } as const;
export const NOESCAPE_SPEC = NOESCAPE.arm + ":tar=" + NOESCAPE.arm + B1C_SPEC.slice("project-md:tar=project-md".length);
export const B1D_ARMS = {
  [B1D_ARM]: { spec: B1D_SPEC, rateUsd: 0.48 },
  "project-md": { spec: B1C_SPEC, rateUsd: 0.42 },
  [NOESCAPE.arm]: { spec: NOESCAPE_SPEC, rateUsd: 0.42 },
  none: { spec: ARMS.none.spec, rateUsd: 0.31 },
} as const;
export type B1dArm = keyof typeof B1D_ARMS;
export const B1D_ARM_NAMES = Object.keys(B1D_ARMS) as B1dArm[];
export const isB1dArm = (x: string): x is B1dArm => Object.hasOwn(B1D_ARMS, x);
// Manifests under quick/laneb/arms/manifests/b1d: the two new arms', and B1c's and B1's, copied byte for byte so the rig's
// one manifest folder covers every held-out arm (b1d.ts armsCheck).
export const COPIED_MANIFESTS = { "project-md": "arms/manifests/b1c/project-md.json", none: "arms/manifests/b1/none.json" } as const;

// The held-out draw (B1D_BUNDLE/draw.py). The task list stays outside this repo until every held-out arm finishes; the run
// reads it from B1D_HELDOUT and refuses it unless it is this draw.
export const HELDOUT = {
  seedSha256: "47efaf1f6d41d69991d0b36a1f05f835a04a24467a8b69265618879a485d7255",
  pool: { tasks: 89, repos: 77, sortedSha256: "36c7b92de330e618c4560b121f987c32491bf8bac6b0bd5de07b85c0951fecf7" },
  tasks: 60,
  sortedSha256: "918664d3b44dcb0bb9480d8cc30bc4293be832f625fdf1d998e1257e655f12c0",
  drawSha256: "c12ff26d9fd21cd7c8615e0615cd8d036763462a3808092da5c5882e56868cd5",
  // The keyless route of the hook at the pin on the 60 held-out prompts (b1d.ts routes, run on the sealed list): where it
  // puts prove-it. Counts only; the per-task table stays sealed with the list.
  coverage: { only: 39, first: 3, second: 7, none: 11 },
  env: "B1D_HELDOUT",
} as const;

// The smoke: two calibration tasks of B1's screened list outside B1's 62 tasks' repositories, picked by their keyless route
// before any session: in sorted order, the first the hook names prove-it alone on and the first it names nothing on.
export const B1D_SMOKE = ["aallan__vera-662_interface", "imperialcollegelondon__pyrealm-593"] as const;

// Items, caps and the all-in stop. Planning rates per session (B1D_ARMS): gstack-main at B1's gstack-shaped Opus mean ($0.4773)
// rounded up, the two project-file arms at B1c's measured mean ($0.4143) rounded up, none at B1's Opus none mean ($0.3072)
// rounded up. The caps are the ones the Captain recorded. The all-in stop went from $340 to $400 on 2026-11-19, before the
// pilot, measured on the whole thread's counter (a dated pre-data change the results list).
export const B1D = {
  stopUsd: 400,
  hostRoot: "b1d",
  ledgerPort: "9950",
  armManifests: "arms/manifests/b1d",
  // Garry's bar: the hook loads prove-it in at least this many of the 60 in-sample sessions.
  bar: 39,
  partTasks: 20,
  // The non-inferiority margin for "near the hook's" (B1c's margin), in proportion points.
  margin: 0.15,
  // The held-out MDD for the disagreement rule (b1d.ts hoMdd): with the block at B1c's 39 of 60, the hook's shortfall that 60
  // paired tasks detect with 80% power, in whole points.
  hoMdd: 0.26,
} as const;
export const B1D_CAPS_USD = { "b1d-smoke": 50, "b1d-in": 90, "b1d-ho": 185 } as const;
export type B1dItem = keyof typeof B1D_CAPS_USD;
export const B1D_ITEMS = Object.keys(B1D_CAPS_USD) as B1dItem[];
export const isB1dItem = (x: string): x is B1dItem => Object.hasOwn(B1D_CAPS_USD, x);

// The B1c run whose published rows are the in-sample control (paired by task) and whose arm the held-out set runs again: its
// counted runs' commit, its results bundle, and the paths whose trees decide what its sessions got. B1c's arm is run again
// only while each tree is the same at B1d's run commit as at B1c's (b1d.ts reuseB1c), and B1's none arm likewise (b1b.ts
// reuseCheck, B1_RUN).
export const B1C_RUN = {
  commit: "6a72369dcecf099011295db6fa79ae5a3add0a17",
  results: "wiki/board/2026-11-18-capy-b1c-project-route-results",
  harness: [...B1B_RUN.harness, "lanes/delivery-route/arms/b1c", "lanes/delivery-route/b1c-pins.ts", "quick/laneb/arms/manifests/b1c"],
} as const;
