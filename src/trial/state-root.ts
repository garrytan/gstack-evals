// The trial's gstack state root (plan v3.2, "State root"; interface v0.5). gstack skills keep state under the root that
// GSTACK_STATE_ROOT, then GSTACK_HOME, names. Each work dir gets a .gstack-home, seeded after the task's setup and before
// the baseline snapshot, so a setup that commits its tree never commits the markers. The seed is an onboarded user: the
// first-run markers gstack-skill-start checks (gstack 1.91.x), and config with telemetry, update checks, artifact sync
// and codex reviews off, the CLAUDE.md routing offer declined (routing_declined, so no base arm's preamble asks to add
// routing rules or injects its routing instruction block), and proactive mode at the run's preregistered value. Both variables point at it through the env
// allowlist; the agent's changes under it come across in the graded delta, since the import includes git-excluded files.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STATE_ROOT_DIR = ".gstack-home";

/** gstack-skill-start's first-run markers in gstack 1.91.x; with each present, no onboarding prompt fires. */
export const ONBOARDING_MARKERS: readonly string[] = [
  ".completeness-intro-seen", ".telemetry-prompted", ".proactive-prompted", ".activated", ".first-loop-tip-shown",
  ".feature-prompted-model-overlay", ".writing-style-prompted", ".question-tuning-prompted", ".redact-prepush-prompted", ".declared-setup-prompted",
];

export type Proactive = "core" | "all" | "off";

export function seedConfig(proactive: Proactive): Record<string, string> {
  return { telemetry: "off", update_check: "false", artifacts_sync_mode: "off", artifacts_sync_mode_prompted: "true", codex_reviews: "disabled", routing_declined: "true", proactive };
}

/**
 * Seeds <work>/.gstack-home and returns the two variables for the env allowlist, pointing at it under the work dir's
 * path in the child (workPath). extra overrides seed keys, such as a stack cell's gstack config (src/arms/cells.ts). Existing files are kept; the harness's config keys are appended after any the fixture
 * wrote, and gstack reads the last value of a key. files are written at the root's top level over any file or symlink the
 * fixture put there, such as a plan run's global question preferences, so the seeded state is what the run records.
 */
export function seedStateRoot(work: string, workPath: string, proactive: Proactive = "core", extra: Record<string, string> = {}, files: Record<string, string> = {}): { GSTACK_STATE_ROOT: string; GSTACK_HOME: string } {
  const root = join(work, STATE_ROOT_DIR);
  mkdirSync(root, { recursive: true });
  for (const marker of ONBOARDING_MARKERS) if (!existsSync(join(root, marker))) writeFileSync(join(root, marker), "");
  for (const [name, text] of Object.entries(files)) {
    rmSync(join(root, name), { recursive: true, force: true });
    writeFileSync(join(root, name), text);
  }
  const config = join(root, "config.yaml");
  const before = existsSync(config) ? readFileSync(config, "utf8") : "";
  const lines = Object.entries({ ...seedConfig(proactive), ...extra }).map(([k, v]) => k + ": " + v);
  writeFileSync(config, before + (before && !before.endsWith("\n") ? "\n" : "") + "# seeded by gstack-evals for a trial\n" + lines.join("\n") + "\n");
  const path = workPath.replace(/\/+$/, "") + "/" + STATE_ROOT_DIR;
  return { GSTACK_STATE_ROOT: path, GSTACK_HOME: path };
}
