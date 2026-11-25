// Copyright (c) 2026 Garry Tan. MIT License.
// SR's arms (plan section 4): the task turn of each arm, worded exactly as the plan words it, the suffix every task turn
// ends with, the limits of each turn and which arm mounts what. The wrap-up turn is the pstack-checks eval's CHECKS.json
// turn, unchanged (pfchecks/arms.ts WRAPUP), so scoring reads every arm's checks the same way.
//   - N: a plain review.
//   - C: the State Machines specialist's steps (gstack review/specialists/state-machines.md at the pin) in plain words,
//     with no gstack installed.
//   - P: pstack's two skills, as the pstack-checks eval invokes them, then the review.
//   - G+ and G0: gstack's /review, word for word the same turn. G+'s gstack dispatches the State Machines specialist on
//     every review; G0's never does (gstack_arms.py makes both commits on top of the pin). Shipped gstack is G+ where the
//     detector fires on the change under review and G0 elsewhere, derived per unit at analysis.
import { NAMES, QUIET_SEC, BG_WAIT_SEC, type Names, type TurnLimits } from "../pfchecks/arms.ts";
import { OPUS, P1 } from "../pfchecks/items.ts";
import { srFail } from "./errors.ts";

export type SrArm = "N" | "C" | "P" | "G+" | "G0";
export const SR_ARMS: readonly SrArm[] = ["N", "C", "P", "G+", "G0"];
export const SR_MODELS = [OPUS, P1] as const;

export const TEXT: Record<SrArm, string> = {
  N: "Review this pull request for bugs.",
  C: "Review this pull request for bugs in its state machines. Find each record the changed code handles that has a kind and a pending status an owner action settles, such as proposals, holds, approvals, review queues or invitations, and read the code after the change, not only the changed lines. List every kind the settle path handles and every action that settles a pending record. For each kind and action, write down the result the owner expects, from what the kind means rather than from what the code does. Find the test that exercises exactly that kind and action and checks that result. Report each pair no test covers, each pair where the code gives a different result than expected, and each branch that sends several kinds down one destructive path.",
  P: "/create-formal-verification-skill model the state machines this pull request changes, and use /statechart to visualize the flows it changes. Then review the pull request for bugs.",
  "G+": "/review",
  G0: "/review",
};
export const SUFFIX = "The pull request is checked out here: HEAD is the change and origin/main is its base. If you find a bug, leave a test in the repository that fails because of it. Don't stop to ask.";

/** The gstack commits G+ and G0 install (gstack_arms.py on top of the pin), and the pin itself. */
export const GSTACK = {
  pin: "d74ee528b6df9ddb945be2103a24544babe76e65", version: "1.103.2.0", install: "./setup --host claude --loadout lite",
  "G+": "e69e29daba22b320b2d9a7cde8e458c57fbb8708", G0: "6872290cfad0af7eaf0641f8b3fd9598f9fffc55",
  tree: { "G+": "51c37ad9055001dfc841153b6241b9114248d4d6", G0: "1151ad70c169c0da9e5afb2891ae5a0e1c58d470" },
} as const;
export const loadsGstack = (arm: SrArm): arm is "G+" | "G0" => arm === "G+" || arm === "G0";
export const loadsPstack = (arm: SrArm): boolean => arm === "P";

/** The task turn: the arm's text (P's skill commands under the chosen names), a blank line, then the suffix. */
export function srTaskTurn(arm: SrArm, names: Names = "short"): string {
  const [cmd, chart] = NAMES[names];
  const text = arm === "P" ? TEXT.P.replace(/^\/create-formal-verification-skill /, cmd + " ").replace(/ \/statechart /, " " + chart + " ") : TEXT[arm];
  if (arm === "P" && (!text.startsWith(cmd + " ") || !text.includes(" " + chart + " "))) srFail("E_SR_ARM", "arm P does not carry both skill commands");
  return text + "\n\n" + SUFFIX;
}

/** Every arm's task turn gets the same wall and turn limits; the wrap-up turn is pstack-checks'. Allowances in dollars. */
export const TASK_LIMITS = { wall_limit_sec: 5400, max_turns: 250 } as const;
export const WRAPUP_LIMITS = { wall_limit_sec: 300, max_turns: 20 } as const;
export const ALLOWANCE: Record<string, { task: number; wrapup: number }> = { [OPUS]: { task: 13, wrapup: 13 }, [P1]: { task: 5, wrapup: 0.5 } };

export function srLimits(model: string): { task: TurnLimits; wrapup: TurnLimits } {
  const a = ALLOWANCE[model] ?? srFail("E_SR_ARM", "model " + model + " is not one of " + SR_MODELS.join(", "));
  const rig = { quiet_sec: QUIET_SEC, bg_wait_sec: BG_WAIT_SEC };
  return { task: { ...TASK_LIMITS, allowance_usd: a.task, ...rig }, wrapup: { ...WRAPUP_LIMITS, allowance_usd: a.wrapup, ...rig } };
}
