// Calibration (plan v3, "Calibration"; U10): before any trial, per host and model, a few short sessions prove the rig
// measures what it claims. Each check that fails stops the run with exit 3 and its code, naming the arm, host, model,
// what was read and a fix.
//
// - CALIBRATION_SKILL: each arm that holds the skill runs on a calibration copy whose SKILL.md ends with a sentinel line
//   only that copy holds. The session must quote its own sentinel, quote no other arm's, and show a read of the copy.
// - CALIBRATION_NONE_LEAK: each arm without the skill (none, bare) must answer NO-SKILL, quote no sentinel and read no
//   copy, so nothing leaks into the trial HOME.
// - CALIBRATION_SHELL: a shell command's output (computed by the shell, not in the prompt) comes back in the answer,
//   and the command shows in the host's calls as a call that succeeded.
// - CALIBRATION_USERSIM: when a task has scripted user replies (Claude Code only), one AskUserQuestion round trip
//   completes with the scripted answer.
// - CALIBRATION_EGRESS: the evaluator, not the model, runs an egress probe to a non-model host from an agent session
//   on the trial network; it must fail.
// - CALIBRATION_CONFIG needs a gstack base, which real hosts do not install until GST-272, so it stays null.
import type { ReasonCode } from "../errors/codes.ts";
import type { Call } from "../grade/transcript.ts";
import type { SidecarTask } from "../skill-eval/contract/sidecar.ts";
import type { ContractTask } from "../skill-eval/contract/tasks.ts";
import type { AgentOutcome } from "../trial/trial.ts";
import type { CalibrationResult, Host } from "../types.ts";

export const SENTINEL = "gstack-evals-sentinel";
export const NO_SKILL = "NO-SKILL";

/** The line only one arm's calibration copy holds. */
export const sentinelFor = (nonce: string, arm: string): string => SENTINEL + ": " + nonce + "-" + arm;

/** A calibration copy's SKILL.md: the arm's own text, then its sentinel line as an HTML comment. */
export const withSentinel = (skillMd: string, line: string): string => skillMd.replace(/\n*$/, "\n") + "\n<!-- " + line + " -->\n";

export type ProbeCheck = "skill" | "none" | "shell" | "usersim";

export interface Probe {
  check: ProbeCheck;
  arm: string;
  task: ContractTask;
  entry?: SidecarTask;
  interactive: boolean;
}

export interface CalibrationArm {
  name: string;
  /** The arm installs the target skill. */
  holdsSkill: boolean;
}

/** The model sessions calibration runs for one model: one per arm, then the shell check and, when needed, the user simulator check. */
export function calibrationProbes(o: { host: Host; skill: string; arms: readonly CalibrationArm[]; interactive: boolean; nonce: string }): Probe[] {
  const probes: Probe[] = o.arms.map((arm) =>
    arm.holdsSkill
      ? { check: "skill", arm: arm.name, interactive: false, task: { id: "calibration-skill-" + arm.name, prompt: "Calibration check. Open the " + o.skill + " skill that is installed for you and read its SKILL.md. Reply with only the line in it that contains \"" + SENTINEL + ":\"." } }
      : { check: "none", arm: arm.name, interactive: false, task: { id: "calibration-none-" + arm.name, prompt: "Calibration check. If a skill named " + o.skill + " is installed for you, open it and reply with only the line in its SKILL.md that contains \"" + SENTINEL + ":\". If no such skill is installed, reply with exactly " + NO_SKILL + "." } },
  );
  const first = o.arms[0]!.name;
  probes.push({ check: "shell", arm: first, interactive: false, task: { id: "calibration-shell", prompt: "Calibration check. Run this shell command and reply with only what it prints: echo " + o.nonce + "-$((6*7))" } });
  if (o.interactive && o.host === "claude") {
    probes.push({ check: "usersim", arm: first, interactive: true, entry: { user: { replies: { approach: "Approach B" } } }, task: { id: "calibration-usersim", prompt: "Calibration check. Use the AskUserQuestion tool once to ask me \"Which approach should we take?\" with the options \"Approach A\" and \"Approach B\". Then reply with only the label I chose." } });
  }
  return probes;
}

export interface ProbeRun {
  probe: Probe;
  outcome: AgentOutcome;
  calls: readonly Call[];
}

export interface CalibrationFailure {
  code: ReasonCode;
  message: string;
  fix: string;
}

const FIX: Record<ProbeCheck | "egress", string> = {
  skill: "Check that the arm installs the skill where the host reads it (~/.claude/skills/<name> for Claude Code, ~/.codex/skills/<name> for Codex) and that the model can open it; rerun with --calibrate.",
  none: "Something reaches the trial HOME beyond the arm: check the arm image's layers and the host's config dirs; rerun with --calibrate.",
  shell: "Check that the host's shell tool runs in the agent container and that the adapter records its calls; rerun with --calibrate.",
  usersim: "Check that AskUserQuestion reaches the adapter's canUseTool and that the simulator answers it; rerun with --calibrate.",
  egress: "Check that the agent runs on the trial network from createTrialNetwork with the isolated gateway (Docker Engine 28 or newer); rerun with --calibrate.",
};

const CODE: Record<ProbeCheck, ReasonCode> = { skill: "CALIBRATION_SKILL", none: "CALIBRATION_NONE_LEAK", shell: "CALIBRATION_SHELL", usersim: "CALIBRATION_USERSIM" };

/** Why one probe failed, or null when it passed. */
function probeProblem(run: ProbeRun, nonce: string, sentinels: Readonly<Record<string, string>>): string | null {
  const { probe, outcome, calls } = run;
  if (outcome.termination.kind !== "completed") return "the session ended as " + outcome.termination.kind + ("code" in outcome.termination ? " " + outcome.termination.code : "");
  const text = outcome.turns.join("\n");
  const quoted = Object.entries(sentinels).filter(([, s]) => text.includes(s)).map(([arm]) => arm);
  if (probe.check === "skill") {
    if (!text.includes(sentinels[probe.arm]!)) return "the answer did not quote this arm's sentinel";
    if (quoted.some((a) => sentinels[a] !== sentinels[probe.arm])) return "the answer quoted the sentinel of " + quoted.filter((a) => sentinels[a] !== sentinels[probe.arm]).join(", ");
    if (outcome.opened !== true) return "the calls show no read of the arm's copy";
    return null;
  }
  if (probe.check === "none") {
    if (quoted.length) return "the answer quoted the sentinel of " + quoted.join(", ");
    if (outcome.opened === true) return "the calls show a read of a skill copy";
    if (!text.includes(NO_SKILL)) return "the answer did not say " + NO_SKILL;
    return null;
  }
  if (probe.check === "shell") {
    if (!text.includes(nonce + "-42")) return "the answer did not carry the command's output " + nonce + "-42";
    if (!calls.some((c) => c.ok === true && (c.input.command ?? "").includes(nonce))) return "no successful shell call with the command shows in the host's calls";
    return null;
  }
  if (!outcome.asked.includes("approach")) return "no question reached the user simulator as an approach question";
  if (!(outcome.turns.at(-1) ?? "").includes("Approach B")) return "the final answer did not carry the scripted answer Approach B";
  return null;
}

/** The calibration result for one model, and a failure line for each check that failed. */
export function judgeCalibration(o: { host: Host; model: string; nonce: string; sentinels: Readonly<Record<string, string>>; runs: readonly ProbeRun[]; egress: { open: boolean; detail: string } | null; usersim: boolean }): { result: CalibrationResult; failures: CalibrationFailure[] } {
  const failures: CalibrationFailure[] = [];
  const passed = (check: ProbeCheck): boolean | null => {
    const runs = o.runs.filter((r) => r.probe.check === check);
    if (!runs.length) return null;
    let ok = true;
    for (const run of runs) {
      const why = probeProblem(run, o.nonce, o.sentinels);
      if (why === null) continue;
      ok = false;
      failures.push({ code: CODE[check], message: "arm " + run.probe.arm + " on " + o.host + ", model " + o.model + ": " + why + "; read: " + (run.outcome.files_read.length ? run.outcome.files_read.join(", ") : "nothing"), fix: FIX[check] });
    }
    return ok;
  };
  const result: CalibrationResult = { skill: passed("skill"), none: passed("none"), shell: passed("shell"), config: null, usersim: o.usersim ? passed("usersim") ?? false : null, egress: o.egress ? !o.egress.open : null };
  if (o.usersim && !o.runs.some((r) => r.probe.check === "usersim")) failures.push({ code: "CALIBRATION_USERSIM", message: "a task has scripted user replies but no user simulator check ran on " + o.host + ", model " + o.model, fix: FIX.usersim });
  if (o.egress?.open) failures.push({ code: "CALIBRATION_EGRESS", message: "an agent session on the trial network reached a non-model host on " + o.host + ", model " + o.model + ": " + o.egress.detail, fix: FIX.egress });
  return { result, failures };
}
