// The review-models eval's cells (GEVA-590; wiki/plans/2026-11-24-geva-590-review-models-prereg, section 3, and its pre-run
// change 1). One review-units run holds them all: arms none, gstack-sol and gstack-astra on models Opus 5.5 and Fable 5.2,
// with none on Opus only. A gstack arm's voice comes from --arm-voice, and every voice runs Codex 0.170.0 from the trial
// image's /opt/codex-0.170.0/bin without Codex's own sandbox (--voice-cli). rm-check.ts checks the cells keylessly before
// the pilot, and rm-exposure.ts reads each review's exposure (section 6).
export const RM_GSTACK = { repo: "garrytan/gstack", sha: "284214fd896f493471b1bb5e98bcdc899a87bcdb", version: "1.103.2.0" } as const;
/** The trial image's Codex 0.170.0 (docker/trial.Dockerfile); the image's PATH codex is 0.166.0. */
export const RM_CODEX_DIR = "/opt/codex-0.170.0/bin";
export const RM_CODEX_VERSION = "codex-cli 0.170.0";
export const RM_OPUS = "claude-opus-5-5";
export const RM_FABLE = "claude-fable-5-2";
export const RM_SOL = "gpt-6.2-sol";
export const RM_ASTRA = "gpt-6.2-astra";
/** The reader map for /review at the pin (reader-maps/). */
export const RM_READER_MAP = "gstack-284214fd896f.json";

export interface RmCell {
  /** The prereg's arm name: OS, OA, FS, FA or N. */
  id: "OS" | "OA" | "FS" | "FA" | "N";
  /** The review-units arm. */
  arm: "gstack-sol" | "gstack-astra" | "none";
  model: string;
  voice: string | null;
}

export const RM_CELLS: readonly RmCell[] = [
  { id: "OS", arm: "gstack-sol", model: RM_OPUS, voice: RM_SOL },
  { id: "OA", arm: "gstack-astra", model: RM_OPUS, voice: RM_ASTRA },
  { id: "FS", arm: "gstack-sol", model: RM_FABLE, voice: RM_SOL },
  { id: "FA", arm: "gstack-astra", model: RM_FABLE, voice: RM_ASTRA },
  { id: "N", arm: "none", model: RM_OPUS, voice: null },
];

/** The review-units flags that hold the five cells in one run. */
export function rmArgs(): string[] {
  const ref = RM_GSTACK.repo + "@" + RM_GSTACK.sha;
  return ["--arms", "none", "gstack-sol=" + ref, "gstack-astra=" + ref, "--models", RM_OPUS, RM_FABLE, "--arm-models", "none=" + RM_OPUS, "--arm-voice", "gstack-sol=" + RM_SOL, "gstack-astra=" + RM_ASTRA, "--voice-cli", RM_CODEX_DIR];
}

/** The prereg cell an arm and model name, or null. */
export const rmCellOf = (arm: string, model: string): RmCell | null => RM_CELLS.find((c) => c.arm === arm && c.model === model) ?? null;
