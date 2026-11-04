// The outcome-skills arm registry (plan v3 13 step 2, O1) for family G, keyless. Every turn text is pinned by sha256 as
// the G prereg section 4 writes it; the limits are section 5's; no stand-in, forced or untold arm runs in G.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armNames, loadRegistry, REGISTRY_PATH, skillTurn, turnScript } from "../../lanes/outcome-skills/arms/registry.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const STATEMENT = "Add per-key rate limits to the API.";

describe("the G arm registry", () => {
  const reg = loadRegistry();

  test("G holds none and told for plan-eng-review and autoplan, at gstack 699a41cb, and nothing else", () => {
    expect(Object.keys(reg.arms).sort()).toEqual(["autoplan:told", "none", "plan-eng-review:told"]);
    expect(armNames(reg, "plan-eng-review")).toEqual(["none", "plan-eng-review:told"]);
    expect(armNames(reg, "autoplan")).toEqual(["none", "autoplan:told"]);
    expect(reg.pins.gstack).toEqual({ repo: "garrytan/gstack", sha: "699a41cb6808e01240d02e82247693f9170d401a", version: "1.94.39.0", install: "./setup --host claude --loadout lite" });
    expect(reg.arms.none).toMatchObject({ install: "none", clean_room: true, skill: null });
    for (const skill of ["plan-eng-review", "autoplan"]) expect(reg.arms[skill + ":told"]).toMatchObject({ install: "gstack", clean_room: false, skill, kind: "told" });
  });

  test("every turn text is the prereg's, pinned by sha256", () => {
    const pins: Record<string, string[]> = {
      none: ["ced752704b8c243d5b0b18cdbcdbcbb29fb46e7cda5a0c3d8c5e01b6bb8f4eb8"],
      "plan-eng-review:told": ["5ea5ff8926b534aa652f51b843a21d362d6fe9e6705e206dbbe2b1327dfb9c83", "7aa0b5fd2c9c169948996afd2a16422e117e45be204ce5282a2067a8073e528b", "afb21923967181f97b0ff309213d588fb2881a74a68d06dd2e2052f786a3fb4e"],
      "autoplan:told": ["5ea5ff8926b534aa652f51b843a21d362d6fe9e6705e206dbbe2b1327dfb9c83", "aba3211d2f4049aafcf252441771e84c51ea48a15d70cf572edb9daf636fd615", "afb21923967181f97b0ff309213d588fb2881a74a68d06dd2e2052f786a3fb4e"],
    };
    for (const [arm, want] of Object.entries(pins)) expect([arm, reg.arms[arm]!.turns.map((t) => sha(t.text))]).toEqual([arm, want]);
  });

  test("the turn scripts: none is one turn; told is plan, the skill by name, then implement, in one conversation", () => {
    expect(turnScript(reg, "none", STATEMENT + "\n\n")).toEqual([{ phase: "t1", text: STATEMENT + "\n\nWork in this repository. Implement this, and make sure it works. Don't stop to ask.", skill_turn: false }]);
    const plan = STATEMENT + "\n\nBefore you write code, draft your plan in PLAN.md. Don't write code yet.";
    const implement = "Now implement your plan, and make sure it works.";
    expect(turnScript(reg, "plan-eng-review:told", STATEMENT)).toEqual([
      { phase: "t1", text: plan, skill_turn: false },
      { phase: "t2", text: "/plan-eng-review PLAN.md", skill_turn: true },
      { phase: "t3", text: implement, skill_turn: false },
    ]);
    expect(turnScript(reg, "autoplan:told", STATEMENT).map((t) => t.text)).toEqual([plan, "/autoplan PLAN.md", implement]);
    expect([skillTurn(reg, "plan-eng-review:told"), skillTurn(reg, "autoplan:told"), skillTurn(reg, "none")]).toEqual(["t2", "t2", null]);
    expect(turnScript(reg, "none", "Use {statement} as a literal.")[0]!.text).toStartWith("Use {statement} as a literal.\n\n");
  });

  test("the limits are the prereg's admission limits, in the keys real_agent reads", () => {
    const keys = ["session_cap_usd", "wall_limit_sec", "max_turns", "quiet_sec", "bg_wait_sec"];
    for (const spec of Object.values(reg.arms)) expect(Object.keys(spec.limits).sort()).toEqual([...keys].sort());
    expect([reg.arms.none!.limits, reg.arms["plan-eng-review:told"]!.limits, reg.arms["autoplan:told"]!.limits].map((l) => [l.session_cap_usd, l.max_turns, l.wall_limit_sec / 60])).toEqual([[8, 200, 90], [20, 200, 120], [45, 400, 240]]);
  });

  test("no stand-in, forced or untold arm runs in G, and each says why", () => {
    for (const skill of ["plan-eng-review", "autoplan"]) {
      expect(Object.keys(reg.not_run[skill]!).sort()).toEqual(["forced", "stand-in", "untold"]);
      for (const kind of ["stand-in", "forced", "untold"]) expect(() => turnScript(reg, skill + ":" + kind, STATEMENT)).toThrow(/^E_OUTCOME_ARM .*not run in G/);
    }
  });

  test("X and U skills, unknown arms and an empty statement are refused", () => {
    for (const skill of ["plan-devex-review", "devex-review", "plan-design-review", "design-review"]) expect(() => armNames(reg, skill)).toThrow(/^E_OUTCOME_ARM .*family [XU] is not built/);
    expect(() => armNames(reg, "ship")).toThrow(/^E_OUTCOME_ARM /);
    expect(() => turnScript(reg, "gstack", STATEMENT)).toThrow(/^E_OUTCOME_ARM /);
    expect(() => turnScript(reg, "none", "  \n")).toThrow(/^E_OUTCOME_ARM .*statement/);
  });

  test("a registry that breaks its shape is refused at load", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcome-registry-"));
    const good = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    const cases: [string, (r: any) => void][] = [
      ["two skill turns", (r) => (r.arms["autoplan:told"].turns[0].skill_turn = true)],
      ["a told arm with no skill turn", (r) => delete r.arms["autoplan:told"].turns[1].skill_turn],
      ["a missing limit", (r) => delete r.arms.none.limits.max_turns],
      ["a turn with no statement first", (r) => (r.arms.none.turns[0].text = "Work in this repository.")],
      ["a skill turn that does not name its skill", (r) => (r.arms["autoplan:told"].turns[1].text = "/plan-eng-review PLAN.md")],
      ["a clean-room told arm", (r) => (r.arms["autoplan:told"].clean_room = true)],
      ["a G skill without a told arm", (r) => delete r.arms["autoplan:told"]],
    ];
    for (const [name, edit] of cases) {
      const r = structuredClone(good);
      edit(r);
      writeFileSync(join(dir, "r.json"), JSON.stringify(r));
      let err = "";
      try {
        loadRegistry(join(dir, "r.json"));
      } catch (e) {
        err = (e as Error).message;
      }
      expect([name, err.startsWith("E_OUTCOME_ARM ")]).toEqual([name, true]);
    }
  });
});
