// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's frozen values (preregistration sections 4, 9 and 11, with pre-run change 1): the three arms, prove-it on Codex,
// the pilot tasks, the items and their caps, the session allowance, the part machinery's settings, the Codex install in
// each task image, the proxy route and the route table's digest. Every other file of part R takes its frozen values here.
// The rig is B1's (lanes/delivery-route): its 60 tasks, task images, verifiers, plain prompt, closing line, part machinery
// and ledger, with the Claude Code agent swapped for a Codex one (quick/laneb/runner/agent/laneb_codex.py).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { B1, CLOSING, SMOKE_TASKS, TASK_SETUP as B1_TASK_SETUP } from "../../delivery-route/pins.ts";
import { ARM_SETTINGS, CHANGE_1, CODEX, EFFORT, GSTACK, MODEL, PREREG, REPO } from "../pins.ts";

export { ARM_SETTINGS, CHANGE_1, CLOSING, CODEX, EFFORT, GSTACK, MODEL, PREREG, REPO };
export const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
export const HERE = "lanes/codex-hooks/r";

// The part machinery's settings: B1's seed orders each part's tasks and arms (seeded() in quick/laneb/l1/l1.ts), six
// sessions at once, 20 tasks a part (60 sessions with three arms), its own host root, ledger port and manifests.
export const R = {
  seed: B1.seed,
  tasks: B1.tasks,
  concurrent: 6,
  partTasks: 20,
  hostRoot: "codex-hooks-r",
  ledgerPort: "9951",
  armManifests: "arms/manifests/codex-hooks-r",
  // An arm with more than this many of its 60 sessions not graded reads INCOMPLETE (section 4.7).
  gapMax: 6,
  // The coverage gate (section 4.4): prove-it named on fewer than this many of the 60 prompts holds part R.
  gate: 30,
  // The session allowance (section 4.7): a session that reaches it is a limit stop.
  allowanceUsd: 5,
} as const;

// The arms (section 4.2) as Lane B arm specs. Every arm runs unattended, with B1's snapshot strip and closing line, and
// GSTACK_SESSION_KIND set; the gstack arms pass the hook-trust bypass. r-on and r-off share every file but gstack's
// skill_routing switch. r-none has no gstack, no skill, no hooks and no ~/.gstack (section 4.2; section 2's seeded
// ~/.gstack in no-gstack arms is not built, see README "Readings").
const TAIL = ":session_kind=unattended:strip_snapshot=true:closing_line=" + CLOSING.key;
export const ARMS = {
  "r-on": { spec: "r-on:tar=r-on" + TAIL, tar: "r-on", gstack: true, routing: "on" },
  "r-off": { spec: "r-off:tar=r-off" + TAIL, tar: "r-off", gstack: true, routing: "off" },
  "r-none": { spec: "r-none:tar=r-none" + TAIL, tar: "r-none", gstack: false, routing: null },
} as const;
export type RArm = keyof typeof ARMS;
export const ARM_NAMES = Object.keys(ARMS) as RArm[];
export const TARS = ARM_NAMES.map((a) => ARMS[a].tar);
export const isArm = (x: string): x is RArm => Object.hasOwn(ARMS, x);

// prove-it on Codex (section 4.3): B1's gstack-shaped skill with its four ~/.claude/skills/gstack paths changed to
// ~/.codex/skills/gstack and nothing else, at $CODEX_HOME/skills/prove-it/SKILL.md.
export const PROVE_IT = {
  source: "lanes/delivery-route/arms/gstack-shaped-SKILL.md",
  sourceSha256: "4aeeb6e4a3e2a4b129b75eb8f1a751eee895e707abbd4c5804cdd7d4f06fdc51",
  from: "~/.claude/skills/gstack",
  to: "~/.codex/skills/gstack",
  replacements: 4,
  sha256: "3e6c46b4c9e8eee71bfdd5f88da23cb22b355794480abe7a02029839f9084f26",
  path: ".codex/skills/prove-it/SKILL.md",
  // The line that says the steps arrived (section 4.5).
  stepLine: "1. Write a test that reproduces the bug (must FAIL)",
} as const;

// The skills the load detector reads (section 4.5): prove-it, and gstack's verify skill for the /verify loads, by their
// paths in the arm home. Their lines and the ones unique to each sit in the arm manifests (skill-lines.json, arms.ts).
export const DETECT_SKILLS = { "prove-it": ".codex/skills/prove-it/SKILL.md", "gstack-verify": ".codex/skills/gstack-verify/SKILL.md" } as const;
export type DetectSkill = keyof typeof DETECT_SKILLS;

/** prove-it as installed on Codex, built from B1's file and checked against both digests. */
export function proveItText(repo = REPO): string {
  const src = readFileSync(join(repo, PROVE_IT.source), "utf8");
  if (sha256(src) !== PROVE_IT.sourceSha256) throw new Error("E_CODEX_R_PIN " + PROVE_IT.source + " hashes to " + sha256(src) + ", not " + PROVE_IT.sourceSha256);
  const n = src.split(PROVE_IT.from).length - 1;
  if (n !== PROVE_IT.replacements) throw new Error("E_CODEX_R_PIN " + PROVE_IT.source + " holds " + n + " " + PROVE_IT.from + " paths, not " + PROVE_IT.replacements);
  const out = src.split(PROVE_IT.from).join(PROVE_IT.to);
  if (sha256(out) !== PROVE_IT.sha256) throw new Error("E_CODEX_R_PIN prove-it on Codex hashes to " + sha256(out) + ", not " + PROVE_IT.sha256);
  return out;
}

// The arm homes: gstack's checkout where its README puts a Codex install (~/gstack), set up with ./setup --host codex
// --no-browser, CODEX_HOME at ~/.codex, and gstack's state root at ~/.gstack. Paths inside the trial container.
export const HOME = "/root";
export const CODEX_HOME = "/root/.codex";
export const GSTACK_SRC = "/root/gstack";
export const GSTACK_CONFIG = GSTACK_SRC + "/bin/gstack-config";
// The onboarded user every gstack arm starts as: the skill-eval trial's seed (src/trial/state-root.ts ONBOARDING_MARKERS
// and seedConfig at proactive core), written with gstack's own config command.
export const SEED_CONFIG = { telemetry: "off", update_check: "false", artifacts_sync_mode: "off", artifacts_sync_mode_prompted: "true", codex_reviews: "disabled", routing_declined: "true", proactive: "core" } as const;

// Codex 0.170.0 in every task image, from npm's linux-x64 tarball by its sha256, with every binary of its musl vendor
// folder kept whole under /opt/laneb/codex (bin/codex beside bin/codex-code-mode-host). The lines follow B1's task setup
// byte for byte (TASK_SETUP below).
export const CODEX_TARBALL = "https://registry.npmjs.org/@openai/codex/-/codex-" + CODEX.version + "-linux-x64.tgz";
export const CODEX_BIN = "/opt/laneb/codex/bin/codex";
export const TASK_SETUP = { file: join(REPO, HERE, "task-setup.Dockerfile"), sha256: "153dca92670706a3c13c8d45167a78712073472cb5b4410506f04136a3146488", b1: B1_TASK_SETUP } as const;

// The metering proxy's route for part R (proxy.json beside this file): the OpenAI Responses API at api.openai.com, keyed by
// OPENAI_API_KEY, served by Lane B's session proxy (quick/laneb/runner/responses.ts).
export const PROXY_CONFIG = join(REPO, HERE, "proxy.json");
export const PROXY_MODEL = "gpt-6.1-sol";
export const PROXY_KEY_ENV = "OPENAI_API_KEY";
export const PROXY_SLOT = "laneb";

// The session settings (section 2): effort low in every arm of part R, the question reply the driver gives, and the agent
// that runs the session in the task container.
export const R_EFFORT = EFFORT.low;
export const QUESTION_REPLY = "No one is available. Treat this question as answered with your recommended option, and keep going.";
export const AGENT = { name: "laneb-codex", import_path: "laneb_codex:LanebCodexAgent", cells: "cells.codex-hooks-r.json" } as const;

// The pilot (section 9 and change 1 section 4): B1's two smoke tasks and the first four covered candidates.
export const PILOT_TASKS = [...SMOKE_TASKS, "BerriAI__litellm-16997", "narwhals-dev__narwhals-3480", "delgan__loguru-1425", "koxudaxi__datamodel-code-generator-2996"] as const;

// Items (section 11): central and cap in USD, the sessions each pays for, and the VM share its central leaves out. r-main's
// central includes its VM share; r-pilot's pays for sessions only, so its host and part VM ($7.20) go on top, and pre-run
// change 2 (decision A, 2026-11-21) records its cap at $50.
export const ITEMS_USD = {
  "r-pilot": { central: 9, cap: 50, sessions: 18, vmOutside: 7.2 },
  "r-main": { central: 99, cap: 165, sessions: 180, vmOutside: 0 },
} as const;
export type Item = keyof typeof ITEMS_USD;
export const ITEM_NAMES = Object.keys(ITEMS_USD) as Item[];
export const isItem = (x: string): x is Item => Object.hasOwn(ITEMS_USD, x);
// Planning prices per session (section 11): a bug task at $0.55 in a gstack arm and $0.45 in r-none.
export const RATES_USD = { gstack: 0.55, none: 0.45 } as const;
export const armRate = (arm: RArm) => (ARMS[arm].gstack ? RATES_USD.gstack : RATES_USD.none);

// The route table (section 4.4, change 1 section 3): its bytes as change 1 attached them.
export const ROUTE_TABLE_SHA256 = "5dae5c05a32e0c71df273387e7649a239a41341d0a9c99fdd6cf56303e754b25";
