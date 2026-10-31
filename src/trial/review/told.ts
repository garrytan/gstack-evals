// The frozen told prompt for review units (plan 2026-10-30-geva-59-stacks-round-1-plan, section 4; finding T4). One
// instruction for every arm, in our own words, prefixed by the arm's command: none has no prefix, gstack /review,
// pstack /pstack:interrogate and tstack /sol-loop with "run one review round and stop before any fix" (the commands come
// from src/arms/stacks.ts where listed). The preregistration freezes TOLD_SHA256, the sha256 of TOLD_TEMPLATE; a test
// pins it, so any edit to the text fails until the test is changed on purpose.
import { createHash } from "node:crypto";
import { stackKind, STACKS } from "../../arms/stacks.ts";
import type { ArmSpec } from "../../types.ts";

export type ToldArm = "none" | "gstack" | "pstack" | "tstack";
export const TOLD_ARMS: readonly ToldArm[] = ["none", "gstack", "pstack", "tstack"];

/** {base} is replaced by the base branch's name. */
export const TOLD_TEMPLATE = [
  "Review the changes on this branch against the base branch {base}: the commits this branch adds since it left {base}, as git diff {base}...HEAD shows them.",
  "",
  "You may write and run throwaway tests, repro scripts and commands, but only under a scratch directory outside this repository (for example one made with mktemp -d). Do not change the code under review, and do not commit or push.",
  "",
  "End your reply with one fenced json block that lists your findings: a JSON array with one object per finding, or [] when you have none. Each object has these fields:",
  '- "file": the path of the file, relative to the repository root',
  '- "line": the line number on this branch, or null',
  '- "severity": the label your review procedure gives the finding',
  '- "claim": what is wrong, in one or two sentences',
  '- "evidence": what shows it, such as the code involved or a command you ran and what it printed',
  '- "confirmed": true or false when your procedure confirms findings by running something; leave it out otherwise',
].join("\n");

export const TOLD_SHA256 = createHash("sha256").update(TOLD_TEMPLATE).digest("hex");

const stackTold = (name: string): string => STACKS.find((k) => k.name === name)!.told.review;

/** The command each arm's told prompt opens with; none has none. */
export const TOLD_PREFIX: Readonly<Record<ToldArm, string>> = {
  none: "",
  gstack: "/review",
  pstack: stackTold("pstack"),
  tstack: stackTold("tstack") + " Run one review round and stop before any fix.",
};

export function toldPrompt(arm: ToldArm, base: string): string {
  const text = TOLD_TEMPLATE.replaceAll("{base}", base);
  return TOLD_PREFIX[arm] ? TOLD_PREFIX[arm] + " " + text : text;
}

/** The skill the arm's told command names, such as review or interrogate; null for none. */
export const toldSkill = (arm: ToldArm): string | null => (TOLD_PREFIX[arm] ? TOLD_PREFIX[arm].split(" ")[0]!.slice(1).split(":").pop()! : null);

/** Which told arm an arm spec runs: a listed stack by its kind, gstack for a gstack stack or base, none for an arm with no skill; null otherwise. */
export function toldArmOf(arm: ArmSpec): ToldArm | null {
  const isGstack = (repo: string) => repo === "gstack" || repo.endsWith("/gstack");
  if (arm.kind === "bare") return "none";
  if (arm.kind === "overlay" && arm.dir === null) return "none";
  if (arm.kind === "stack") {
    const kind = stackKind(arm.stack)?.name;
    if (kind === "pstack" || kind === "tstack") return kind;
    return isGstack(arm.stack.repo) && !arm.stack.path ? "gstack" : null;
  }
  return null;
}
