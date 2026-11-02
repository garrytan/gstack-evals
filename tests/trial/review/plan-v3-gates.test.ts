// Panel v3 C1 (GEVA-165 plan, sections 4 and 5), keyless, on the real pinned Agent SDK 0.3.314 against the stub CLI.
// plan-v3-gates-sdk.ts runs each session through runReviewUnits in its own process, for the reason plan-told-sdk.ts gives.
//
// Scope gates: a gstack arm under --plan eng and --plan design sends "/plan-eng-review plan.md" or
// "/plan-design-review plan.md" verbatim as turn 1 and PLAN_TURN2_TEXT verbatim as turn 2, at the SDK's edge. Its skill
// reaches the CLI only through the session's HOME and --setting-sources (the driver hands the SDK no skill name or root;
// it keeps the lens's skill on the evaluator side for the opened signal), so the test checks the SKILL.md is in the CLI's
// HOME and that the driver credits a Skill call naming the lens's own skill. The skill's scope gate, asked in turn 1 as an
// AskUserQuestion, gets the rec user's "Go with your recommendation.", and the session goes on to turn 2 and scores.
//
// No carryover (section 4): every session gets a fresh home and a fresh gstack state root, and no gstack learnings, review
// log or plan state survives from one unit-pass to the next. The first of two passes writes those files where gstack and
// Claude Code keep them; the second probes the same relative paths in its own roots and the first session's absolute
// state-root paths, which are gone, as is every state-root file after the run. Under the process sandbox a session's HOME
// stays under its run dir after the trial, and only the docker rig removes it, so for HOME the test checks what the next
// pass sees: its own HOME, a different directory, with none of the first session's files.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { PLAN_LENSES, PLAN_TURN2_SHA256, PLAN_TURN2_TEXT, REC_REPLY, REC_USER_SHA256 } from "../../../src/trial/review/plan.ts";
import { CARRY, GATES, LENSES, SKILL_MD } from "./plan-v3-gates-sdk.ts";

const OPUS = "claude-opus-5-5";
const LINE = { eng: "/plan-eng-review plan.md", design: "/plan-design-review plan.md" } as const;
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
const durable = () => {
  const d = mkdtempSync(join(REPO_ROOT, ".plan-v3-gates-test-"));
  roots.push(d);
  return d;
};
type Line = Record<string, any>;
const lines = (file: string): Line[] => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const text = (c: string | { text: string }[]) => (typeof c === "string" ? c : c.map((b) => b.text).join(""));

/** Runs plan-v3-gates-sdk.ts in its own process and reads its JSON line. */
function runner(mode: "gates" | "carryover") {
  const records = scratch("plan-v3-records-");
  const out = durable();
  const child = spawnSync(process.execPath, [join(import.meta.dir, "plan-v3-gates-sdk.ts"), mode, records, out, scratch("plan-v3-sdk-")], { encoding: "utf8", timeout: 110_000 });
  expect([child.status, child.stderr]).toEqual([0, ""]);
  const printed = JSON.parse(child.stdout.trim().split("\n").at(-1)!) as { stops: Record<string, unknown[]>; sessions: { home: string; state_root: string }[] };
  return { records, out, ...printed };
}

/** The run's one unit and its single gstack arm's records under out. */
const unitOf = (out: string) => JSON.parse(readFileSync(join(out, "units.json"), "utf8")).units[0] as { id: string; task: string };
const terminations = (out: string) => readFileSync(join(out, "terminations.tsv"), "utf8").trim().split("\n").slice(1).map((r) => r.split("\t"));

// Value: protects=panel v3's gstack arm on the eng and design lenses: turn 1 is the lens's command and plan.md verbatim, turn 2 is PLAN_TURN2_TEXT verbatim, the arm's own skill is in the CLI's HOME and credited to the session, its scope gate asked as an AskUserQuestion gets "Go with your recommendation." through canUseTool and the session still reaches turn 2 and scores, and arm.json and terminations.tsv record it; fails_when=run.ts sends another lens's command or appends words, the follow-up changes or is not sent after an answered gate, planSkill hands the driver another lens's skill, the rec user declines or misses a scope gate (an E_USER_TURNS_MISSING or E_APPROVAL_BYPASS gap, or "No, not now."), or the told block or termination row drifts; why_new=section 4's gstack arm runs four lenses and only CEO had a run-loop test; seam=runReviewUnits through the Claude Code driver, the real Agent SDK 0.3.314 and the stub CLI's script calls; no_claim=the real CLI expanding a slash command or loading skills from HOME, which a keyless stub cannot show
describe("GEVA-203: panel v3 scope gates through runReviewUnits on the pinned SDK (keyless)", () => {
  test("a gstack arm under --plan eng and --plan design sends its own lines, loads its own skill, gets the rec user's answer to its scope gate and scores in turn 2", () => {
    const run = runner("gates");
    expect(run.stops).toEqual({ eng: [], design: [] });
    for (const lens of LENSES) {
      const skill = PLAN_LENSES[lens].skill;
      const out = join(run.out, lens);
      const record = lines(join(run.records, lens + ".ndjson"));
      const users = record.filter((m) => m.type === "user");
      expect([lens, users.length, text(users[0]!.message.content), text(users[1]!.message.content)]).toEqual([lens, 2, LINE[lens], PLAN_TURN2_TEXT]);

      expect([lens, record.filter((m) => m.argv).length, record[0]!.argv]).toEqual([lens, 1, expect.arrayContaining(["--setting-sources=user,project,local"])]);
      const init = record.find((m) => m.type === "control_request" && m.request?.subtype === "initialize")!;
      expect([lens, "skills" in init.request, "plugins" in init.request]).toEqual([lens, false, false]);
      expect([lens, record.filter((m) => m.probe).map((m) => m.probe)]).toEqual([lens, [{ ["$HOME/.claude/skills/" + skill + "/SKILL.md"]: true }, { ["$HOME/.claude/skills/" + skill + "/SKILL.md"]: true }]]);

      const permits = record.filter((m) => m.type === "control_response").map((m) => m.response.response);
      expect([lens, permits]).toEqual([lens, [
        { behavior: "allow", updatedInput: { skill }, toolUseID: "tu_u1k1" },
        { behavior: "allow", updatedInput: { questions: [GATES[lens]], answers: { [GATES[lens].question]: REC_REPLY } }, toolUseID: "tu_u1k2" },
      ]]);
      expect(REC_REPLY).toBe("Go with your recommendation.");
      const answered = record.findIndex((m) => m.type === "control_response" && m.response.request_id === "perm_tu_u1k2");
      expect([lens, answered > record.indexOf(users[0]!) && answered < record.indexOf(users[1]!)]).toEqual([lens, true]);

      const unit = unitOf(out);
      const dir = join(out, "runs", OPUS, "gstack", unit.task, "p1");
      const trial = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8")).record;
      expect([lens, trial.termination, trial.follow_up, trial.opened, trial.files_read, trial.loaded_bytes]).toEqual([lens, { kind: "completed" }, { sent: true, model_turns: 1 }, true, ["SKILL.md"], Buffer.byteLength(SKILL_MD[lens])]);
      const asks = lines(join(dir, "host", "usersim.ndjson")).filter((e) => e.kind === "ask").map((e) => [e.question, e.reply, e.source]);
      expect([lens, asks]).toEqual([lens, [[GATES[lens].question, REC_REPLY, "freeform"]]]);

      expect([lens, terminations(out)]).toEqual([lens, [["gstack-opus", "gstack", OPUS, unit.id, "1", "completed", "2", "true", "findings", "1"]]]);
      const arm = JSON.parse(readFileSync(join(out, "arms", "gstack-opus", "arm.json"), "utf8"));
      expect([lens, arm.status, arm.parse_outcomes.findings]).toEqual([lens, "complete", 1]);
      expect(JSON.stringify(arm.told)).toBe(JSON.stringify({ arm: "gstack", lens, line: LINE[lens], turn2_sha256: PLAN_TURN2_SHA256, rec_user_sha256: REC_USER_SHA256 }));
    }
  }, 120_000);
});

let carry: ReturnType<typeof runner> | null = null;
const carried = () => (carry ??= runner("carryover"));
const at = (s: { home: string; state_root: string }, p: string) => p.replace("$HOME", s.home).replace("$GSTACK_STATE_ROOT", s.state_root);
const STATE = CARRY.filter((p) => p.startsWith("$GSTACK_STATE_ROOT/"));
const HOME = CARRY.filter((p) => p.startsWith("$HOME/"));
const probes = (n: number) => lines(join(carried().records, "s" + n + ".ndjson")).filter((m) => m.probe).map((m) => m.probe as Record<string, boolean>);
const all = (paths: string[], value: boolean) => Object.fromEntries(paths.map((p) => [p, value]));

describe("GEVA-203: panel v3 no carryover between unit-passes on the pinned SDK (keyless)", () => {
  // Value: protects=section 4's no-carryover rule for gstack's own state: learnings, the review log and plan state written under one unit-pass's GSTACK_STATE_ROOT are absent from the next pass's state root, gone from the first pass's absolute paths before the next pass starts, and gone after the run, while both passes still score; fails_when=two passes share a state root, runTrial stops removing the work dir that holds .gstack-home, or the seed copies state from an earlier pass; why_new=the plan requires this test of the scorer PR; seam=runReviewUnits and runTrial's cleanup, through the real Agent SDK 0.3.314 and the stub CLI's STUB_TOUCH and STUB_PROBE; no_claim=what a real gstack bin writes, which the stub stands in for at gstack's documented paths
  test("gstack's learnings, review log and plan state in the state root start fresh in each unit-pass and are gone after the run", () => {
    const run = carried();
    expect(run.stops).toEqual({ carryover: [] });
    const [first, second] = run.sessions as [{ home: string; state_root: string }, { home: string; state_root: string }];
    expect(run.sessions.length === 2 && first.home !== second.home && first.state_root !== second.state_root).toBe(true);
    const touched = (n: number) => lines(join(run.records, "s" + n + ".ndjson")).filter((m) => m.touched).map((m) => m.touched);
    expect([touched(1), touched(2)]).toEqual([[CARRY.map((p) => at(first, p))], [CARRY.map((p) => at(second, p))]]);
    expect(probes(1)).toEqual([all(CARRY, false), all(CARRY, true)]);
    const before = probes(2)[0]!;
    expect(Object.fromEntries(Object.entries(before).filter(([p]) => CARRY.includes(p)))).toEqual(all(CARRY, false));
    expect(Object.fromEntries(STATE.map((p) => [at(first, p), before[at(first, p)]]))).toEqual(all(STATE.map((p) => at(first, p)), false));
    const left = [first, second].flatMap((s) => [s.state_root, ...STATE.map((p) => at(s, p))]).filter((p) => existsSync(p));
    expect(left).toEqual([]);
    const unit = unitOf(run.out);
    expect(terminations(run.out)).toEqual(["1", "2"].map((pass) => ["gstack-opus", "gstack", OPUS, unit.id, pass, "completed", "2", "true", "findings", "1"]));
  }, 120_000);

  // Value: protects=section 4's no-carryover rule for HOME: the next unit-pass gets its own HOME, a different directory, and gstack's default-root learnings and Claude Code's plan file the first session wrote there are absent from it; fails_when=two passes share a HOME or the install copies an earlier pass's HOME; why_new=the plan requires this test of the scorer PR; seam=runReviewUnits, runTrial and the sandbox's homePath, through the real Agent SDK 0.3.314 and the stub CLI; no_claim=that a HOME is removed after the trial, which only the docker rig does (under the process sandbox it stays under the run dir), or that the next pass cannot read an earlier HOME, which the sandbox's isolation decides and the local test sandbox does not have
  test("the next unit-pass gets its own HOME, with none of the files the first session wrote under its HOME", () => {
    const run = carried();
    const [first, second] = run.sessions as [{ home: string; state_root: string }, { home: string; state_root: string }];
    expect(second.home).not.toBe(first.home);
    expect(probes(1)[1]!).toMatchObject(all(HOME, true));
    const before = probes(2)[0]!;
    expect(Object.fromEntries(HOME.map((p) => [p, before[p]]))).toEqual(all(HOME, false));
  }, 120_000);
});
