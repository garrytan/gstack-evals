// Copyright (c) 2026 Garry Tan. MIT License.
// B1c's frozen values (prereg bundle B1C_BUNDLE): one arm, B1b's CLAUDE.md routing block in the task's project CLAUDE.md
// instead of the user's, on B1b's setup. B1b's two arms are read from B1b's published rows as controls. B1's and B1b's
// frozen values (pins.ts, b1b-pins.ts) stay as merged.
import { B1_RUN, B1B_ARMS, GSTACK_MAIN } from "./b1b-pins.ts";

export const B1C_BUNDLE = "wiki/plans/2026-11-18-capy-b1c-project-route-prereg";

// The arm: B1b's claude-md arm with the block moved. Its tar holds B1's gstack-shaped tree byte for byte, the routing block
// and a placement script at the path of the one pre-session command the rig runs at the task's working directory after the
// tar (laneb_hooks.py CHECKS_TRUST, switched on by checks_trust=true). Everything else in the spec is B1b's tail.
export const B1C_ARM = "project-md" as const;
export type B1cArm = typeof B1C_ARM;
export const isB1cArm = (x: string): x is B1cArm => x === B1C_ARM;
export const B1C_SPEC = B1C_ARM + ":tar=" + B1C_ARM + B1B_ARMS["claude-md"].spec.slice("claude-md:tar=claude-md".length) + ":checks_trust=true";

// Where the block goes and how it gets there. gstack's project install (bin/gstack-skill-start at B1b's gstack pin) tells the
// agent: if no CLAUDE.md exists in the project root, create it; append the routing section to its end; commit it with
// gstack's own message. The snapshot strip has already removed every CLAUDE.md from the task's tree, so in every task the
// file is created and holds the block alone. The block's bytes are B1b's route file (arms/b1b/CLAUDE.md), not a copy.
export const PLACEMENT = {
  script: ".claude/skills/gstack/bin/gstack-checks",
  scriptSource: "b1c/place-block",
  block: ".b1c/CLAUDE.md",
  blockSource: "b1b/CLAUDE.md",
  blockSha256: "2f2016daef2b8bf2542b0998d028087000c123ad4725db42e2a90d47870b750d",
  project: "/testbed/CLAUDE.md",
  message: "chore: add gstack skill routing rules to CLAUDE.md",
  placed: "b1c: placed the routing block at /testbed/CLAUDE.md and committed it as ",
  label: "Contents of /testbed/CLAUDE.md (project instructions, checked into the codebase):",
  userLabel: "Contents of /root/.claude/CLAUDE.md",
} as const;
// gstack's own words for the project install, each checked to appear once in bin/gstack-skill-start at the pin.
export const GSTACK_INSTALL = {
  sha: GSTACK_MAIN.sha,
  file: "bin/gstack-skill-start",
  blob: GSTACK_MAIN.blobs["bin/gstack-skill-start"],
  lines: [
    "If no CLAUDE.md exists in the project root, create it.",
    "If A: append this section to the end of CLAUDE.md, then commit it (`git add CLAUDE.md && git commit -m \"" + PLACEMENT.message + "\"`):",
  ],
} as const;

// Items, caps and the all-in stop. The planning rate is B1b's measured hook-arm mean ($0.403 a session, the arm that loaded
// the skill in 58 of 60) rounded up to the cent. Caps: ceil10(1.35 x expected + min(concurrent, sessions) x allowance + VM
// share), the crew's amended rule; the all-in stop counts this lane's own counter.
export const B1C = {
  stopUsd: 150,
  hostRoot: "b1c",
  ledgerPort: "9949",
  armManifests: "arms/manifests/b1c",
  rateUsd: 0.41,
  // The non-inferiority margin against the hook line, in proportion points.
  margin: 0.15,
} as const;
export const B1C_CAPS_USD = { "b1c-smoke": 20, "b1c-opus": 80 } as const;
export type B1cItem = keyof typeof B1C_CAPS_USD;
export const B1C_ITEMS = Object.keys(B1C_CAPS_USD) as B1cItem[];
export const isB1cItem = (x: string): x is B1cItem => Object.hasOwn(B1C_CAPS_USD, x);

// The B1b run whose two arms B1c reads as controls: its counted runs' commit, its results bundle (sessions.jsonl, pinned by
// the bundle's front matter), and the paths whose trees decide what a session gets. They are reused only while each tree is
// the same at B1c's run commit as at B1b's (b1c.ts reuseB1b). B1's own list (B1_RUN.harness) comes first; then B1b's arm
// manifests and route files, B1's gstack-shaped skill and its three stand-in scripts, the tar builder and B1b's pins.
export const B1B_RUN = {
  commit: "6191ded62f9496ceb864e7be254f438fcb2a9941",
  results: "wiki/board/2026-11-18-capy-b1b-prose-route-results",
  harness: [
    ...B1_RUN.harness,
    "quick/laneb/arms/manifests/b1b",
    "lanes/delivery-route/arms/b1b",
    "lanes/delivery-route/arms/gstack-shaped-SKILL.md",
    "lanes/delivery-route/arms/gstack-skill-start",
    "lanes/delivery-route/arms/gstack-skill-end",
    "lanes/delivery-route/arms/gstack-learnings-log",
    "lanes/delivery-route/arms.ts",
    "lanes/delivery-route/b1b-pins.ts",
  ],
} as const;
