// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit read's three review arms (prereg 2026-11-15-geva-537 section 4), on the eng-build lane's review arms
// (lanes/eng-build/arms.ts) without changing them. Each planted arm runs as the eng-build arm with the same prompt shape,
// method, detector and Stop hook: plain as plain, engphase as engphase, standalone as precut (the forced
// /plan-eng-review). Only the gstack commit moves: both skill arms run at RESTORE_PIN with the default install.
//
// - Prompts: standalone is "/plan-eng-review plan.md", then the forced sentence, then the common line; engphase is the
//   unit's rendered Phase 3 opening (lanes/eng-review/render.ts at the pin), the forced sentence and the common line;
//   plain is the common line alone. Lines join with one newline, as eng-build's reviewPrompt joins them.
// - Skill arms: GSTACK_SESSION_KIND=unattended, every AskUserQuestion answered "Go with your recommendation." (REC_REPLY),
//   and the Stop hook (lanes/eng-review/stophook.ts) on the arm's frozen detector, at most FROZEN.stopHook.maxBlocks
//   blocks. Session limits and settings are eng-build's REVIEW_SESSION, which FROZEN.sessions.review matches.
// - Pin: skillPin refuses, with E_USAGE, a pin with no full commit, no VERSION, or no sha256 for a file the arm's method
//   or detector reads (exposure.ts ER_DETECTOR_FILES), so every paid path refuses an empty RESTORE_PIN.
// - plain has no gstack, no drive and no gstack path in its container, by construction: reviewArmSpec gives it
//   { kind: "bare" } (lanes/eng-build/review-stage.ts), so the install layer adds nothing to the trial image, whose
//   Dockerfile installs no gstack (docker/trial.Dockerfile); the review launcher runs it with stateRoot false and no
//   read-only mounts (lanes/eng-build/launch.ts reviewLauncher, only engphase gets the opening's mounts); and the Docker
//   sandbox's agent container mounts only the session's work dir at /work plus those mounts (src/trial/sandbox.ts
//   dockerSandbox agent), where the work dir holds plan.md and the stripped one-commit repo/ alone. plainArmProblems
//   checks the first two before any session.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EB_ASK_ANSWER, EB_COMMON, EB_FORCED, REVIEW_SESSION, reviewPrompt, reviewStopHook } from "../../eng-build/arms.ts";
import { reviewArmSpec } from "../../eng-build/review-stage.ts";
import { detectorPinProblems, detectorStringProblems, ER_DETECTOR_FILES, type ErEvidence } from "../../eng-review/exposure.ts";
import { renderEngPhase } from "../../eng-review/render.ts";
import type { ArmSpec } from "../../../src/types.ts";
import type { DigestPin } from "../../../src/trial/review/eng-review.ts";
import type { ReadOnlyMount } from "../../../src/trial/sandbox.ts";
import { fail } from "../errors.ts";
import { FROZEN, RESTORE_PIN } from "../frozen.ts";
import type { ReviewArm, SkillArm } from "../types.ts";

export const REVIEW_ARMS: readonly ReviewArm[] = ["plain", "engphase", "standalone"];
export const SKILL_ARMS: readonly SkillArm[] = ["engphase", "standalone"];
export const isSkillArm = (arm: ReviewArm): arm is SkillArm => arm !== "plain";

/** The eng-build arm each planted arm runs as: the same prompt shape, detector, Stop hook and installed skill. */
export const EB_ARM: Readonly<Record<ReviewArm, "plain" | "engphase" | "precut">> = { plain: "plain", engphase: "engphase", standalone: "precut" };
/** The exposure detector each skill arm reads its sessions with. */
export const DETECTOR: Readonly<Record<SkillArm, "engphase" | "precut">> = { engphase: "engphase", standalone: "precut" };

export interface PlantedArm {
  arm: ReviewArm;
  /** The skill command that opens the prompt, or null. */
  command: string | null;
  /** The prompt opens with the unit's rendered eng phase opening. */
  opening: boolean;
  forced: boolean;
  gstack: boolean;
  stopHook: boolean;
  env: Readonly<Record<string, string>>;
}

export const PLANTED_ARMS: Readonly<Record<ReviewArm, PlantedArm>> = {
  plain: { arm: "plain", command: null, opening: false, forced: false, gstack: false, stopHook: false, env: {} },
  engphase: { arm: "engphase", command: null, opening: true, forced: true, gstack: true, stopHook: true, env: { GSTACK_SESSION_KIND: "unattended" } },
  standalone: { arm: "standalone", command: "/plan-eng-review plan.md", opening: false, forced: true, gstack: true, stopHook: true, env: { GSTACK_SESSION_KIND: "unattended" } },
};

/** The fixed lines every arm shares, from eng-build's arms. */
export const COMMON_LINE = EB_COMMON;
export const FORCED_SENTENCE = EB_FORCED;
export const ASK_ANSWER = EB_ASK_ANSWER;
export const SESSION = REVIEW_SESSION;
if (SESSION.maxTurns !== FROZEN.sessions.review.turns || SESSION.timeoutS !== FROZEN.sessions.review.minutes * 60 || SESSION.allowanceMicros !== FROZEN.sessions.review.usd * 1_000_000) fail("E_INTERNAL", "eng-build's review session limits no longer match FROZEN.sessions.review");

/** The pin both skill arms run at. A pin with no full commit, no VERSION, or no digest for a file either arm reads is
 * refused with E_USAGE, so nothing paid starts at an empty pin. */
export function skillPin(pin: { sha: string; version: string; digests: Readonly<Record<string, string>> } = RESTORE_PIN): DigestPin {
  if (!/^[0-9a-f]{40}$/.test(pin.sha) || !pin.version) return fail("E_USAGE", "the skill arms' gstack pin is empty (sha " + JSON.stringify(pin.sha) + ", VERSION " + JSON.stringify(pin.version) + "); RESTORE_PIN is set when the prereg freezes, and no paid path runs before it");
  const missing = [...new Set(Object.values(ER_DETECTOR_FILES).flat())].filter((f) => !/^[0-9a-f]{64}$/.test(pin.digests[f] ?? ""));
  if (missing.length) return fail("E_USAGE", "the skill arms' gstack pin " + pin.sha.slice(0, 9) + " records no sha256 for " + missing.join(", ") + "; every file the arms and detectors read is pinned by digest");
  return { sha: pin.sha, version: pin.version, digests: pin.digests };
}

/** The review prompt for an arm; engphase needs its unit's rendered opening. */
export const plantedPrompt = (arm: ReviewArm, opening: string | null = null): string => reviewPrompt(EB_ARM[arm], arm === "engphase" ? opening : null);

/** The install the arm runs: plain bare, each skill arm gstack at the pin with the default install. */
export function plantedArmSpec(arm: ReviewArm, pin: DigestPin | null): ArmSpec {
  const spec = reviewArmSpec(EB_ARM[arm], isSkillArm(arm) ? (pin ?? fail("E_USAGE", "arm " + arm + " needs the skill arms' pin")) : undefined);
  return { ...(spec ?? fail("E_INTERNAL", "arm " + arm + " has no review session")), name: arm };
}

/** A fresh Stop hook for one session of a skill arm, or null for plain. */
export const plantedStopHook = (arm: ReviewArm, evidence: (transcript: string) => ErEvidence) => reviewStopHook(EB_ARM[arm], evidence);

/** Why the plain arm would see gstack: its install must be bare. */
export function plainArmProblems(spec: ArmSpec): string[] {
  return spec.kind === "bare" ? [] : ["the plain arm's install is " + spec.kind + ", not bare, so gstack would reach its container"];
}

/** Why a gstack checkout is not the pin for a skill arm: the digests of every file the arm reads, then the strings its
 * detector relies on. */
export function armCheckoutProblems(arm: SkillArm, gstack: string, pin: DigestPin): string[] {
  const read = (rel: string) => {
    try {
      return readFileSync(join(gstack, rel));
    } catch {
      return null;
    }
  };
  return [...detectorPinProblems(DETECTOR[arm], pin, read), ...detectorStringProblems((rel) => read(rel)?.toString("utf8") ?? null, [DETECTOR[arm]])];
}

export interface Opening {
  text: string;
  sha256: string;
  methodology: string;
  readRanges: Array<{ offset: number; limit: number }>;
  mounts: ReadOnlyMount[];
}

/** One unit's eng phase opening, rendered at the pin from a checkout at it, after the checkout's digests and detector
 * strings are checked. out must sit outside the repository and be empty, as render.ts requires. */
export function plantedOpening(o: { gstack: string; plan: string; out: string; pin: DigestPin }): Opening {
  const problems = armCheckoutProblems("engphase", o.gstack, o.pin);
  if (problems.length) return fail("E_USAGE", "the gstack checkout " + o.gstack + " is not the eng phase arm's pin:\n" + problems.join("\n"));
  const r = renderEngPhase({ gstack: o.gstack, plan: o.plan, out: o.out, pin: { repo: "garrytan/gstack", sha: o.pin.sha, version: o.pin.version } });
  return { text: r.text, sha256: r.sha256, methodology: r.methodology, readRanges: r.readRanges, mounts: r.files.map((f) => ({ host: f.host, path: f.mount })) };
}
