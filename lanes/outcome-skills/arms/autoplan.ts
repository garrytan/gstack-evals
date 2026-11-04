// autoplan's told invocation at gstack 699a41cb, frozen (G prereg section 4; plan v3 13 step 2, O1). At the pin,
// autoplan runs its lean feature kind only when told --kind feature or in an unattended Capy session
// (lib/autoplan-lean.ts leanMode); the told arm sets neither, so it runs the full kind with the phases its scope chooses.
// Its outside voice is a Claude subagent on the cell's model, with no codex binary and no OpenAI or Codex key, and the
// rec persona gives the gate's recommended reply. checkAutoplanConfig runs the pin's own bin/gstack-session-kind and
// leanMode on the arm's environment and refuses anything else, so autoplan's admission does not start on it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOLD_PIN } from "./told.ts";

export const AUTOPLAN_TOLD = {
  pin: TOLD_PIN.sha,
  slash: "/autoplan PLAN.md",
  kind: "full",
  session_kind: "interactive",
  phases: { always: ["ceo", "eng"], design: "uiRequired", dx: "dxRequired", order: ["ceo", "design", "dx", "eng"], last: "eng" },
  outside_voice: { provider: "claude-subagent", model: "claude-opus-5-5", codex_modes: ["not_installed", "disabled"] },
  gate_answer: { persona: "rec", ask_user_question: "the option marked (recommended)", prose: "Go with your recommendation." },
} as const;

/** real_agent.py's FROZEN_ENV: what the image may set that claude and its children never see. */
export const FROZEN_ENV = /^((GSTACK|CONDUCTOR)_[A-Za-z0-9_]*|CI|GITHUB_ACTIONS|OPENCLAW_SESSION)$/;
const OTHER_VOICE = /^(OPENAI|CODEX)_/;

const fail = (why: string): never => {
  throw new Error("E_OUTCOME_AUTOPLAN_CONFIG " + why + "; autoplan's admission does not start, and the question goes to the Captain (G prereg section 4)");
};

/** The plan path from the told slash line. Any flag, a second argument or another skill is refused. */
export function parseSlash(line: string): { plan: string; flags: string[] } {
  const m = /^\/autoplan ([^\s-]\S*)$/.exec(line);
  if (!m) fail("the slash line " + JSON.stringify(line) + " is not " + JSON.stringify(AUTOPLAN_TOLD.slash) + "'s form, /autoplan and the plan path with no flag");
  return { plan: m![1]!, flags: [] };
}

/** The told session's environment: the image's, less every frozen variable and any OpenAI or Codex variable, plus the arm's fixed ones. */
export function sessionEnv(image: Record<string, string>): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(image).filter(([k]) => !FROZEN_ENV.test(k) && !OTHER_VOICE.test(k)));
  const model = AUTOPLAN_TOLD.outside_voice.model;
  return { ...kept, HOME: "/root", CLAUDE_CONFIG_DIR: "/root/.claude", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", ANTHROPIC_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL: model };
}

/** Runs the pin's own session-kind script and leanMode on env (as the SDK starts claude: CLAUDE_CODE_ENTRYPOINT=sdk-py). */
export async function checkAutoplanConfig(o: { pin: string; env: Record<string, string>; slash?: string; codex: boolean }) {
  const head = spawnSync("git", ["-C", o.pin, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  if (head !== AUTOPLAN_TOLD.pin) fail(o.pin + " is at " + (head || "no commit") + ", not the pin " + AUTOPLAN_TOLD.pin);
  const files: Record<string, string> = {};
  for (const f of ["bin/gstack-session-kind", "lib/autoplan-lean.ts"] as const) {
    files[f] = createHash("sha256").update(readFileSync(join(o.pin, f))).digest("hex");
    if (files[f] !== TOLD_PIN.sources[f]) fail(o.pin + "/" + f + " has sha256 " + files[f] + ", not the pin's " + TOLD_PIN.sources[f]);
  }
  const slash = o.slash ?? AUTOPLAN_TOLD.slash;
  parseSlash(slash);
  if (o.codex) fail("a codex binary is on the arm's PATH, so the outside voice would not be the cell's model");
  for (const k of Object.keys(o.env)) if (OTHER_VOICE.test(k)) fail("the arm's environment sets " + k + ", so a second outside voice could run");
  const env = { ...o.env, CLAUDE_CODE_ENTRYPOINT: "sdk-py" };
  const sk = spawnSync("bash", [join(o.pin, "bin/gstack-session-kind")], { encoding: "utf8", env });
  const sessionKind = sk.stdout?.trim();
  if (sk.status !== 0 || !sessionKind) fail("the pin's gstack-session-kind did not run (exit " + sk.status + ")");
  const lean = spawnSync(process.execPath, ["-e", "const { leanMode } = await import(process.argv[1]); const [sessionKind, env] = JSON.parse(process.argv[2]); console.log(JSON.stringify(leanMode({ sessionKind, env }) ?? null));", join(o.pin, "lib/autoplan-lean.ts"), JSON.stringify([sessionKind, env])], { encoding: "utf8" });
  if (lean.status !== 0) fail("the pin's leanMode did not run: " + lean.stderr.trim().slice(-300));
  const mode = JSON.parse(lean.stdout.trim()) as { kind: string; source: string } | null;
  if (mode) fail("the arm's environment selects kind " + mode.kind + " (" + mode.source + "), not the full kind");
  if (sessionKind !== AUTOPLAN_TOLD.session_kind) fail("the arm's environment gives session kind " + sessionKind + ", not " + AUTOPLAN_TOLD.session_kind);
  return { ok: true as const, kind: AUTOPLAN_TOLD.kind, session_kind: sessionKind, slash, outside_voice: AUTOPLAN_TOLD.outside_voice.provider, pin_sha: head, files };
}
