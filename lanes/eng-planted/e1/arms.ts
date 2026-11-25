// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's five review arms (prereg 2026-11-24-geva-587-design-time-state-modeling section 4): the prompt, the install
// and the environment for each arm on each model. Every prompt ends with attempt 3's common line, and lines join with one
// newline, as eng-build's reviewPrompt joins them.
//
// - N is the common line alone; D and C put their plain-words line before it; P opens with /statechart (or the
//   /pstack:statechart form the dry run records when the pinned Claude Code does not resolve the bare name); G opens
//   with the skill command for its host, then attempt 3's forced sentence.
// - N, D and C are bare, so no gstack, pstack or drive path reaches their container. P is pstack at the pin, as a Claude
//   Code plugin directory through the stack arms' installer (src/arms/stacks.ts). G is gstack at 9a550bca with the
//   default install on Claude Code and ./setup --host codex on Codex. P does not run on Sol.
// - G runs with GSTACK_SESSION_KIND=unattended and no Stop hook on every model (section 4, G and the Stop hook).
// - P's exposure marker is the first body line of statechart's SKILL.md, read from the pinned checkout after its sha256
//   is checked, so no pstack text is stored here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EB_COMMON, EB_FORCED } from "../../eng-build/arms.ts";
import { stackKind } from "../../../src/arms/stacks.ts";
import type { ArmSpec } from "../../../src/types.ts";
import { fail } from "../errors.ts";
import { E1_HOST, PINS, RUNS_ON, type E1Arm, type E1Model } from "./frozen.ts";

export const COMMON = EB_COMMON;
export const D_LINE = "For every new stateful object, add an ASCII state diagram to the plan. Include impossible or invalid transitions and what prevents them.";
export const C_LINE = "Write a small TLA+ model of the states this plan adds, write each rule as an invariant, check it with TLC, change the plan to fix each counterexample, and add to the plan a code test that replays each counterexample. TLC is installed: $TLA2TOOLS names its jar and $JAVA its Java.";
export const P_COMMANDS = ["/statechart", "/pstack:statechart"] as const;
export type PCommand = (typeof P_COMMANDS)[number];
export const P_TAIL = "model the states this plan adds and the rules they must keep, then improve the plan.";
export const G_COMMAND: Readonly<Record<"claude" | "codex", string>> = { claude: "/plan-eng-review plan.md", codex: "$plan-eng-review plan.md" };

/** The pinned trees section 1 names for P. */
export const PSTACK_TREES = {
  harness: "7f8353b7412793e2dd572244f52355c52ffc2b79",
  statechart: "d3d60f78916e8c17a598c39738e45ab419603f06",
  skillSha256: "ca7b3e43b1ddc4fb2425a33960f9390357323a869e1d921b6e2aff4f3004d55e",
  markerSha256: "7e2eccb45bd94009f5fe8417e6da30f7e587d411d67e52dc397b44c8e4ad0bae",
} as const;

const runsOn = (arm: E1Arm, model: E1Model) => RUNS_ON[arm].includes(model) || fail("E_USAGE", "arm " + arm + " does not run on " + model + " (prereg section 4)");

export function e1Prompt(arm: E1Arm, model: E1Model, pCommand: PCommand = "/statechart"): string {
  runsOn(arm, model);
  const lead: Record<E1Arm, string[]> = {
    N: [],
    D: [D_LINE],
    C: [C_LINE],
    P: [pCommand + " " + P_TAIL],
    G: [G_COMMAND[E1_HOST[model]], EB_FORCED],
  };
  return [...lead[arm], COMMON].join("\n");
}

export function e1ArmSpec(arm: E1Arm, model: E1Model): ArmSpec {
  runsOn(arm, model);
  const name = "e1-" + arm;
  if (arm === "N" || arm === "D" || arm === "C") return { name, kind: "bare" };
  if (arm === "P") {
    const stack = { repo: PINS.pstack.repo, sha: PINS.pstack.sha, path: PINS.pstack.harness };
    const install = stackKind(stack)?.install.claude ?? fail("E_INTERNAL", "src/arms/stacks.ts lists no pstack installer for Claude Code");
    return { name, kind: "stack", stack, install: { claude: install } };
  }
  return { name, kind: "stack", stack: { repo: PINS.gstack.repo, sha: PINS.gstack.sha }, install: E1_HOST[model] === "codex" ? { codex: "./setup --host codex" } : {} };
}

export const e1Env = (arm: E1Arm): Readonly<Record<string, string>> => (arm === "G" ? { GSTACK_SESSION_KIND: "unattended" } : {});

/** statechart's first body line, from a pstack checkout at the pin, with the file's and the line's digests checked. */
export function pMarker(harness: string): string {
  const body = readFileSync(join(harness, "skills", "statechart", "SKILL.md"));
  const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
  if (sha(body) !== PSTACK_TREES.skillSha256) return fail("E_USAGE", "statechart's SKILL.md under " + harness + " is not the pinned file (sha256 " + sha(body) + ")");
  const lines = body.toString("utf8").split("\n");
  const h = lines.findIndex((l) => l === "# Statechart");
  const line = lines.slice(h + 1).find((l) => l.trim() !== "");
  if (h < 0 || line === undefined || sha(line) !== PSTACK_TREES.markerSha256) return fail("E_USAGE", "statechart's SKILL.md under " + harness + " has no pinned marker line after its title");
  return line;
}
