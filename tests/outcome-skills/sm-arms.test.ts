// Family SM's arms in the registry (the implicit state machines prereg, sections 5, 6 and 17): every turn text is the
// post's, byte for byte, and pinned by sha256; the loader refuses a broken SM arm with E_SM_ARM and leaves G's checks as
// they were; smTurn substitutes the scope and the issue text; the limits are section 6's per model.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistry, REGISTRY_PATH } from "../../lanes/outcome-skills/arms/registry.ts";
import { smLimits, smTurn } from "../../lanes/outcome-skills/statemachines/arms.ts";

const POST = readFileSync(join(import.meta.dir, "../../wiki/plans/2026-11-09-geva-409-state-machines-prompt-prereg/README.md"), "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PINS: Record<string, string> = {
  "sm:A0": "bd5c8a0272151e7fcc06caa2383600db41f4642d0063c1216984ed871fb67cc6",
  "sm:A1": "4e826bdf22c268093330470bfb2370d7c8d45871432f3fee982996910b023c00",
  "sm:A2": "6a80d748989b0a3f3969d9f17ad69019f12c64ba65e26d8fd11e887356b69aa8",
  "sm:S2": "2a494be1224de1b17b79ecc1c02169f62f36678e65743d019584ddbfb31208f9",
  "sm:followon": "d9f686f730e7bb3ff8ece9d8523130238bce0a2438b472dac7349b741f6181dc",
  "qa:told": "7e6969c97352af061e08914206a9b646cc05a360e1f91a0862b9ef16c5212a3a",
};

// Value: protects=the frozen arm texts (post sections 5 and 17); fails_when=a registry text drifts from the post by a byte, or the post's text moves; why_new=GEVA-436 P2; seam=registry.json sm.arms; no_claim=how the model reads them
test("every SM turn text is the post's sentence, a blank line and the post's suffix, pinned by sha256", () => {
  const reg = loadRegistry();
  const sm = reg.sm!;
  const quoted = (label: string) => POST.match(new RegExp("- \\*\\*" + label + ":\\*\\* \"([^\"]+)\""))![1]!;
  const suffix = POST.match(/\n> (My app is the repository in this directory\. Focus on `\{scope\}`\. Don't stop to ask\.)\n/)![1]!;
  expect(sm.suffix).toBe(suffix);
  const want: Record<string, string> = {
    "sm:A0": quoted("A0, plain"),
    "sm:A1": quoted("A1, verbatim"),
    "sm:A2": quoted("A2, lens swap"),
    "sm:S2": quoted("S2, refactor lens"),
    "qa:told": POST.match(/\*\*A3, gstack \/qa told:\*\* "([^"]+)" plus the shared suffix/)![1]!,
  };
  for (const [arm, sentence] of Object.entries(want)) expect([arm, sm.arms[arm]!.turns[0]!.text]).toEqual([arm, sentence + "\n\n" + suffix]);
  expect(POST).toContain("> {issue text}\n>\n> Fix this issue in this repository. Don't stop to ask.\n");
  expect(sm.arms["sm:followon"]!.turns[0]!.text).toBe("{statement}\n\nFix this issue in this repository. Don't stop to ask.");
  expect(Object.fromEntries(Object.entries(sm.arms).map(([k, a]) => [k, sha(a.turns[0]!.text)]))).toEqual(PINS);
  expect(sm.no_answer).toBe(POST.match(/AskUserQuestion tool gets one fixed reply in every arm, the no-gstack arm included: "([^"]+)"/)![1]!);
  expect(Object.keys(reg.arms).sort()).toEqual(["autoplan:told", "none", "plan-eng-review:told"]);
});

// Value: protects=section 6's limits per model; fails_when=a wall, turn or allowance figure moves; why_new=GEVA-436 P2; seam=registry.json sm.arms limits, arms.ts smLimits; no_claim=the admission doubling rule (P4)
test("limits are section 6's, per model, first stage and follow-on", () => {
  const reg = loadRegistry();
  const row = (arm: string, m: string) => {
    const l = smLimits(reg, arm, m);
    return [l.wall_limit_sec, l.max_turns, l.session_cap_usd];
  };
  for (const arm of ["sm:A0", "sm:A1", "sm:A2", "sm:S2", "qa:told"]) expect([row(arm, "claude-opus-5-5"), row(arm, "openai/gpt-6.1-sol"), row(arm, "particle-ai/particle-1")]).toEqual([[5400, 200, 15], [5400, 200, 15], [5400, 200, 3]]);
  expect([row("sm:followon", "claude-opus-5-5"), row("sm:followon", "openai/gpt-6.1-sol"), row("sm:followon", "particle-ai/particle-1")]).toEqual([[3600, 150, 6], [3600, 150, 6], [3600, 150, 1]]);
  expect(() => smLimits(reg, "sm:A0", "claude-sonnet-5-5")).toThrow(/^E_SM_ARM /);
});

// Value: protects=A3's /qa pin as the Captain approved it on 2026-11-10 (A1, B1): gstack main's last commit on 2026-11-08 UTC, its VERSION, and the install command qa-install.sh runs; fails_when=the pin, its version or its install command moves; why_new=GST-1959 C1; seam=registry.json sm.pins.qa; no_claim=that the sha is main's last commit that day (the PR body shows the clone commands and their output)
test("the /qa pin is gstack b6155921 at 1.98.0.0, installed with ./setup --host claude", () => {
  expect(loadRegistry().sm!.pins.qa).toEqual({ repo: "garrytan/gstack", sha: "b6155921a564ba9ec2470fd2cb3894c05e2c2d13", version: "1.98.0.0", install: "./setup --host claude" });
});

// Value: protects=the one user turn each arm sends; fails_when=the scope or issue text is substituted wrongly, a bad scope passes, or qa:told runs while its pin is null; why_new=GEVA-436 P2; seam=arms.ts smTurn (real_agent's sm_user.sm_turn matches it, sm-session.test.ts); no_claim=the scope rule itself (P1 scope.ts)
test("smTurn fills the scope and the issue text, and refuses a bad scope and an unpinned qa:told", () => {
  const reg = loadRegistry();
  expect(smTurn(reg, "sm:A0", { scope: "src/core" })).toBe("Find and fix the bugs in my app.\n\nMy app is the repository in this directory. Focus on `src/core`. Don't stop to ask.");
  expect(smTurn(reg, "sm:followon", { statement: "Crash on empty input.\n\n  " })).toBe("Crash on empty input.\n\nFix this issue in this repository. Don't stop to ask.");
  expect(smTurn(reg, "sm:A1", { scope: "$&x" })).toContain("Focus on `$&x`.");
  for (const scope of ["", "a\nb", "a`b"]) expect(() => smTurn(reg, "sm:A0", { scope })).toThrow(/^E_SM_ARM /);
  expect(() => smTurn(reg, "sm:followon", { statement: " \n" })).toThrow(/^E_SM_ARM /);
  const unpinned = structuredClone(reg);
  unpinned.sm!.pins.qa = { repo: "garrytan/gstack", sha: null, version: null, install: null };
  expect(() => smTurn(unpinned, "qa:told", { scope: "src" })).toThrow(/qa pin/);
  expect(smTurn(reg, "qa:told", { scope: "src" })).toBe(reg.sm!.arms["qa:told"]!.turns[0]!.text.replace("{scope}", "src"));
});

// Value: protects=the loader's family SM branch; fails_when=a broken SM arm loads, or the branch changes what G accepts; why_new=GEVA-436 P2; seam=registry.ts loadRegistry, arms.ts checkSm; no_claim=G's own refusals (registry.test.ts)
test("the loader refuses broken SM arms with E_SM_ARM, and a registry with no SM block loads as G alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-reg-"));
  try {
    const base = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    const load = (edit: (r: any) => void) => {
      const r = structuredClone(base);
      edit(r);
      const p = join(dir, "r.json");
      writeFileSync(p, JSON.stringify(r));
      return () => loadRegistry(p);
    };
    const bad: Array<[string, (r: any) => void]> = [
      ["text drift", (r) => (r.sm.arms["sm:A1"].turns[0].text = r.sm.arms["sm:A1"].turns[0].text.replace("\n\n", " "))],
      ["missing arm", (r) => delete r.sm.arms["sm:S2"]],
      ["extra arm", (r) => (r.sm.arms["sm:A9"] = r.sm.arms["sm:A0"])],
      ["no cap for a model", (r) => delete r.sm.arms["sm:A0"].limits.session_cap_usd["particle-ai/particle-1"]],
      ["second turn", (r) => r.sm.arms["sm:A0"].turns.push({ phase: "t2", text: "more" })],
      ["told without install", (r) => (r.sm.arms["qa:told"].install = "none")],
      ["prompt with install", (r) => (r.sm.arms["sm:A0"].install = "gstack")],
      ["follow-on with scope", (r) => (r.sm.arms["sm:followon"].turns[0].text += " {scope}")],
      ["another reply", (r) => (r.sm.no_answer = "Ask me later.")],
      ["unknown provider", (r) => (r.sm.models["x"] = "openai")],
    ];
    for (const [name, edit] of bad) expect([name, (() => { try { load(edit)(); return "loaded"; } catch (e) { return String((e as Error).message).split(" ")[0]; } })()]).toEqual([name, "E_SM_ARM"]);
    expect(Object.keys(load((r) => delete r.sm)().arms).sort()).toEqual(["autoplan:told", "none", "plan-eng-review:told"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
