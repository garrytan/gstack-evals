// Family SM's arms (the implicit state machines prereg, sections 5, 6 and 17): the shape registry.json's "sm" block must
// keep, the turn each arm sends, and the limits for the model a session runs. Family G's arms and checks stay in
// registry.ts untouched; loadRegistry calls checkSm when the file holds an "sm" block, so a broken SM arm stops every
// caller that loads the registry, as a broken G arm does.
import type { Registry } from "../arms/registry.ts";

export const SM_ARMS = ["sm:A0", "sm:A1", "sm:A2", "sm:S2", "sm:followon", "qa:told"] as const;
export type SmArmName = (typeof SM_ARMS)[number];
export const FIRST_STAGE = ["sm:A0", "sm:A1", "sm:A2", "sm:S2"] as const;
export const CELL_OF: Record<SmArmName, string> = { "sm:A0": "A0", "sm:A1": "A1", "sm:A2": "A2", "sm:S2": "S2", "sm:followon": "F", "qa:told": "A3" };
const LIMIT_KEYS = ["bg_wait_sec", "max_turns", "quiet_sec", "session_cap_usd", "wall_limit_sec"];
const SCOPE = "{scope}";
const STATEMENT = "{statement}";

export type SmLimits = { session_cap_usd: Record<string, number>; wall_limit_sec: number; max_turns: number; quiet_sec: number; bg_wait_sec: number };
export type SmArm = { family: "SM"; skill: string | null; kind: "prompt" | "followon" | "told"; install: "none" | "gstack"; clean_room: boolean; turns: Array<{ phase: string; text: string; skill_turn?: boolean }>; limits: SmLimits };
export type SmBlock = {
  prereg: string;
  suffix: string;
  no_answer: string;
  models: Record<string, "anthropic" | "openrouter">;
  pins: { qa: { repo: string; sha: string | null; version: string | null; install: string | null } };
  arms: Record<string, SmArm>;
};

const fail = (why: string): never => {
  throw new Error("E_SM_ARM " + why);
};

export function checkSm(sm: SmBlock, path: string): void {
  const bad = (why: string) => fail(path + ": family SM " + why);
  if (!sm || typeof sm.suffix !== "string" || !sm.arms || !sm.models || !sm.pins?.qa) bad("needs suffix, no_answer, models, pins.qa and arms");
  if (sm.suffix.split(SCOPE).length !== 2 || sm.suffix.includes("\n")) bad("suffix must be one line with {scope} once");
  if (sm.no_answer !== "No one is available to answer. Use your own judgment.") bad("no_answer is not section 6's fixed reply");
  const models = Object.keys(sm.models).sort();
  if (!models.length || Object.values(sm.models).some((p) => p !== "anthropic" && p !== "openrouter")) bad("models must map each model id to anthropic or openrouter");
  if (Object.keys(sm.arms).sort().join() !== [...SM_ARMS].sort().join()) bad("must hold exactly the arms " + SM_ARMS.join(", "));
  for (const [name, arm] of Object.entries(sm.arms)) {
    const no = (why: string) => bad("arm " + name + " " + why);
    if (arm.family !== "SM") no("is not in family SM");
    const want = name === "qa:told" ? { kind: "told", skill: "qa", install: "gstack", clean_room: false } : { kind: name === "sm:followon" ? "followon" : "prompt", skill: null, install: "none", clean_room: true };
    if (arm.kind !== want.kind || arm.skill !== want.skill || arm.install !== want.install || arm.clean_room !== want.clean_room) no("must have kind " + want.kind + ", skill " + want.skill + ", install " + want.install + " and clean_room " + want.clean_room);
    if (!Array.isArray(arm.turns) || arm.turns.length !== 1 || arm.turns[0]!.phase !== "t1" || typeof arm.turns[0]!.text !== "string") no("needs exactly one turn, t1");
    const text = arm.turns[0]!.text;
    if (arm.kind === "followon") {
      if (!text.startsWith(STATEMENT + "\n\n") || text.split(STATEMENT).length !== 2 || text.includes(SCOPE)) no("must open with {statement} and a blank line, once, with no {scope}");
    } else {
      if (!text.endsWith("\n\n" + sm.suffix) || text.split(SCOPE).length !== 2 || text.includes(STATEMENT)) no("must be its sentence, a blank line and the shared suffix, with {scope} once and no {statement}");
      if ((arm.turns[0]!.skill_turn === true) !== (arm.kind === "told")) no("marks skill_turn on the told turn only");
      if (arm.kind === "told" && !text.startsWith("/" + arm.skill + " ")) no("must open with /" + arm.skill);
    }
    const l = arm.limits;
    if (!l || Object.keys(l).sort().join() !== LIMIT_KEYS.join() || [l.wall_limit_sec, l.max_turns, l.quiet_sec, l.bg_wait_sec].some((v) => typeof v !== "number" || !(v > 0))) no("needs the limits " + LIMIT_KEYS.join(", ") + ", each positive");
    const caps = l.session_cap_usd ?? {};
    if (Object.keys(caps).sort().join() !== models.join() || Object.values(caps).some((v) => typeof v !== "number" || !(v > 0))) no("needs a positive session_cap_usd for each model: " + models.join(", "));
  }
}

const smBlock = (reg: Registry): SmBlock => reg.sm ?? fail("the registry has no family SM block");
export const isSmArm = (reg: Registry, arm: string): boolean => !!reg.sm && Object.hasOwn(reg.sm.arms, arm);
export const smArm = (reg: Registry, arm: string): SmArm => (isSmArm(reg, arm) ? reg.sm!.arms[arm]! : fail("unknown SM arm " + arm + "; family SM runs " + SM_ARMS.join(", ")));

export function smProvider(reg: Registry, model: string): "anthropic" | "openrouter" {
  const sm = smBlock(reg);
  return Object.hasOwn(sm.models, model) ? sm.models[model]! : fail("model " + model + " is not one of family SM's models: " + Object.keys(sm.models).join(", "));
}

/** The arm's limits for one model: section 6's wall, turns and that model's allowance. */
export function smLimits(reg: Registry, arm: string, model: string) {
  const l = smArm(reg, arm).limits;
  smProvider(reg, model);
  return { session_cap_usd: l.session_cap_usd[model]!, wall_limit_sec: l.wall_limit_sec, max_turns: l.max_turns, quiet_sec: l.quiet_sec, bg_wait_sec: l.bg_wait_sec };
}

/** The one user turn an SM arm sends. A prompt or told arm takes the unit's scope (one line); the follow-on takes the issue text with JavaScript's trailing whitespace removed. qa:told refuses until the /qa pin is recorded. */
export function smTurn(reg: Registry, arm: string, input: { scope?: string; statement?: string }): string {
  const spec = smArm(reg, arm);
  const text = spec.turns[0]!.text;
  if (spec.kind === "followon") {
    const statement = (input.statement ?? "").replace(/\s+$/, "");
    if (!statement.trim()) fail("arm " + arm + ": the issue text is empty");
    return statement + text.slice(STATEMENT.length);
  }
  if (spec.kind === "told" && !smBlock(reg).pins.qa.sha) fail("arm qa:told runs only once the /qa pin (gstack sha and version) is recorded in registry.json sm.pins.qa at freeze");
  const scope = input.scope ?? "";
  if (!scope || /[\n\r`]/.test(scope)) fail("arm " + arm + ": the scope must be one line with no backtick, not " + JSON.stringify(scope));
  return text.replace(SCOPE, () => scope);
}
