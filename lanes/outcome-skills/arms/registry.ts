// The outcome-skills arm registry (plan v3 13 step 2, O1). registry.json holds family G's arms as the G admission prereg
// writes them (sections 2 to 5): the none arm and one told arm per G skill, each turn text pinned by sha256 in
// tests/outcome-skills/registry.test.ts, and the limits real_agent reads. loadRegistry refuses a file that breaks that
// shape; turnScript gives the turns an arm sends, in order, in one conversation, each after the previous goes quiet.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REGISTRY_PATH = join(import.meta.dir, "registry.json");
const LIMITS = ["session_cap_usd", "wall_limit_sec", "max_turns", "quiet_sec", "bg_wait_sec"] as const;
const STATEMENT = "{statement}";

export type Turn = { phase: string; text: string; skill_turn?: boolean };
export type Arm = { family: string; skill: string | null; kind: "none" | "told"; install: "none" | "gstack"; clean_room: boolean; turns: Turn[]; limits: Record<(typeof LIMITS)[number], number> };
export type Registry = {
  schema: 1;
  prereg: string;
  pins: { gstack: { repo: string; sha: string; version: string; install: string }; model: string };
  families: Record<string, { skills: string[]; built: boolean; why?: string }>;
  arms: Record<string, Arm>;
  not_run: Record<string, Record<string, string>>;
};
export type ScriptTurn = { phase: string; text: string; skill_turn: boolean };

const fail = (why: string): never => {
  throw new Error("E_OUTCOME_ARM " + why);
};
const lookup = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

export function loadRegistry(path = REGISTRY_PATH): Registry {
  const reg = JSON.parse(readFileSync(path, "utf8")) as Registry;
  if (reg.schema !== 1 || !reg.arms || !reg.families || !reg.not_run) fail(path + ": not a schema 1 registry with arms, families and not_run");
  for (const [name, arm] of Object.entries(reg.arms)) {
    const bad = (why: string) => fail(path + ": arm " + name + " " + why);
    const family = lookup(reg.families, arm.family);
    if (family?.built !== true) bad("is in family " + arm.family + ", which is not built");
    const keys = Object.keys(arm.limits ?? {}).sort();
    if (keys.join() !== [...LIMITS].sort().join() || Object.values(arm.limits).some((v) => typeof v !== "number" || !(v > 0))) bad("needs exactly these limits, each a positive number: " + LIMITS.join(", "));
    if (!Array.isArray(arm.turns) || !arm.turns.length || arm.turns.some((t, i) => t.phase !== "t" + (i + 1) || typeof t.text !== "string" || (i > 0 && t.text.includes(STATEMENT)))) bad("needs turns t1, t2 and so on, with {statement} in turn 1 only");
    if (!arm.turns[0]!.text.startsWith(STATEMENT + "\n\n")) bad("must open turn 1 with {statement} and a blank line");
    const skillTurns = arm.turns.filter((t) => t.skill_turn === true);
    if (arm.kind === "none") {
      if (name !== "none" || arm.skill !== null || arm.install !== "none" || arm.clean_room !== true || arm.turns.length !== 1 || skillTurns.length) bad("must be the one-turn none arm, with no skill, no install and the clean room");
    } else if (arm.kind === "told") {
      if (!arm.skill || name !== arm.skill + ":told" || arm.install !== "gstack" || arm.clean_room !== false) bad("must be <skill>:told, with the gstack install and no clean room");
      if (!family!.skills.includes(arm.skill!)) bad("has the skill " + arm.skill + ", which family " + arm.family + " does not hold");
      if (skillTurns.length !== 1 || skillTurns[0]!.text.split(" ")[0] !== "/" + arm.skill) bad("needs exactly one skill turn, and it must open with /" + arm.skill);
    } else bad("has kind " + arm.kind + "; G runs only none and told arms");
  }
  if (!lookup(reg.arms, "none")) fail(path + ": no none arm");
  for (const [family, f] of Object.entries(reg.families)) if (f.built) for (const skill of f.skills) if (!lookup(reg.arms, skill + ":told")) fail(path + ": family " + family + " skill " + skill + " has no told arm");
  return reg;
}

const familyOf = (reg: Registry, skill: string) => {
  const hit = Object.entries(reg.families).find(([, f]) => f.skills.includes(skill));
  if (!hit) return fail("no family holds the skill " + skill + "; G holds " + Object.values(reg.families).filter((f) => f.built).flatMap((f) => f.skills).join(" and "));
  return hit;
};

/** The arms that run for a skill, none first. A skill in a family that is not built is refused. */
export function armNames(reg: Registry, skill: string): string[] {
  const [family, f] = familyOf(reg, skill);
  if (!f.built) fail("skill " + skill + " is in family " + family + ", and family " + family + " is not built: " + f.why);
  return Object.entries(reg.arms).filter(([, a]) => a.family === family && (a.skill === null || a.skill === skill)).map(([name]) => name);
}

/** The turns an arm sends, in order. {statement} is the task statement with trailing whitespace removed. */
export function turnScript(reg: Registry, arm: string, statement: string): ScriptTurn[] {
  const spec = lookup(reg.arms, arm);
  if (!spec) {
    const [skill, kind] = arm.split(":");
    const notRun = skill ? lookup(reg.not_run, skill) : undefined;
    const why = notRun && kind ? lookup(notRun, kind) : undefined;
    if (why) fail("arm " + arm + " is not run in G: " + why);
    fail("unknown arm " + arm + "; G runs " + Object.keys(reg.arms).join(", "));
  }
  const text = statement.replace(/\s+$/, "");
  if (!text.trim()) fail("arm " + arm + ": the task statement is empty");
  return spec!.turns.map((t) => ({ phase: t.phase, text: t.text.startsWith(STATEMENT) ? text + t.text.slice(STATEMENT.length) : t.text, skill_turn: t.skill_turn === true }));
}

/** The phase of the arm's skill turn, or null for the none arm. */
export function skillTurn(reg: Registry, arm: string): string | null {
  const spec = lookup(reg.arms, arm) ?? fail("unknown arm " + arm);
  return spec.turns.find((t) => t.skill_turn === true)?.phase ?? null;
}
