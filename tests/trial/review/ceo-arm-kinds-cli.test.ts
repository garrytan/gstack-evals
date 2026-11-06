// review-units' per-arm session kinds on the command line (the CEO stage 2 amendment, section 3.3 item 3): the
// --arm-session-kind refusals, the run.json resume check against the kinds a run recorded, and the dry run's listing of
// each arm's kind. Keyless; every call is a dry run, so nothing is built, written or spent.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../src/trial/review/cli.ts";

const OPUS = "claude-opus-5-5";
const SHA = "4743132ca027d487fb02bb5f8ce94f2816ff8e7c";
const dir = mkdtempSync(join(tmpdir(), "gse-arm-kinds-"));
const unit = { repo: "acme/widgets", pr: 7, head: "a".repeat(40), base: "b".repeat(40) };
writeFileSync(join(dir, "suite.json"), JSON.stringify({ schema_version: 1, id: "ceo-arm-kinds", title: "t", kind: "ceo-outcome", development_only: true, purpose: "p", sealed: false, catalogs: ["units"], sources: [], prereg_freezes: [], judging_rule: "judge-brief.md", shelf_life: { rule: "r", released: null }, groups: {}, units: [{ id: "acme/widgets#7@" + "a".repeat(12), ...unit, cluster: "acme/widgets#7", group: null, blockers: [] }], ineligible: [], excluded: [], frozen_bars: [] }));
const ARMS = ["--arms", "none", "lens", "gstack-forced=garrytan/gstack@" + SHA, "gstack-enforced=garrytan/gstack@" + SHA];
const base = (out: string) => ["--suite", join(dir, "suite.json"), "--plan", "ceo-outcome", ...ARMS, "--units", "all", "--models", OPUS, "--source", "acme/widgets=" + dir, "--base-branch", "acme/widgets=main", "--out", out, "--dry-run"];
const kinds = (...arms: string[]) => arms.flatMap((a) => ["--arm-session-kind", a]);
async function cli(argv: string[]) {
  const o: string[] = [];
  const e: string[] = [];
  const code = await main(argv, { out: (t) => o.push(t), err: (t) => e.push(t) }, {});
  return { code, out: o.join("\n"), err: e.join("\n") };
}
/** An out dir holding a run.json as an earlier run of this command line wrote it, with these arm kinds. */
function priorRun(arm_session_kinds?: Record<string, string>): string {
  const out = mkdtempSync(join(dir, "out-"));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "run.json"), JSON.stringify({ run_id: "review-units-earlier", max_turns: 60, session_kind: null, ...(arm_session_kinds ? { arm_session_kinds } : {}), background_wait_s: 3600 }));
  return out;
}

describe("review-units --arm-session-kind (keyless dry runs)", () => {
  // Value: protects=section 3.3 item 3's per-arm session kind at the command line: the dry run names every arm's kind, none and lens included, the flag refuses a bad value, an arm --arms does not run, an arm named twice and --session-kind beside it, and a resume refuses kinds other than the ones the run recorded; fails_when=a kind is set silently on the wrong arm, a bad flag runs, or a resume mixes kinds inside one run's journal; why_new=GEVA-351, the --arm-session-kind tests GEVA-348 left; seam=src/trial/review/cli.ts main; no_claim=a session's env or key (ceo-enforced.test.ts)
  test("the dry run lists each arm's session kind, and sets the 200,000-token window on every arm", async () => {
    const r = await cli([...base(join(dir, "fresh")), ...kinds("gstack-forced=unattended", "gstack-enforced=unattended")]);
    expect([r.code, r.err]).toEqual([0, ""]);
    expect(r.out).toContain("\narm session kinds: none not set, lens not set, gstack-forced unattended, gstack-enforced unattended\n");
    expect(r.out).toContain("every arm's agent env sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1 (a 200,000-token window)");
    const plain = await cli(base(join(dir, "fresh")));
    expect(plain.code).toBe(0);
    expect(plain.out).not.toContain("arm session kinds");
  });
  test("refusals: --session-kind beside it, a value other than unattended, an arm --arms does not run, an arm named twice, a value with no arm", async () => {
    const refusals: [string[], string][] = [
      [[...kinds("gstack-enforced=unattended"), "--session-kind", "unattended"], "--arm-session-kind sets one arm's session kind, and --session-kind sets every arm's; pass one of them"],
      [kinds("gstack-enforced=interactive"), "--arm-session-kind gives arm gstack-enforced \"interactive\"; it takes unattended"],
      [kinds("gstack-auto=unattended"), "--arm-session-kind names arm gstack-auto, which --arms does not run"],
      [kinds("gstack-enforced=unattended", "gstack-enforced=unattended"), "--arm-session-kind names arm gstack-enforced twice"],
      [kinds("unattended"), "--arm-session-kind takes <arm>=<value>"],
    ];
    for (const [extra, message] of refusals) {
      const r = await cli([...base(join(dir, "fresh")), ...extra]);
      expect([r.code, r.err]).toEqual([2, expect.stringContaining(message)]);
    }
    const both = await cli([...base(join(dir, "fresh")), ...kinds("gstack-enforced=unattended"), "--session-kind", "unattended"]);
    expect(both.err).toContain("\n  fix: name each arm that runs unattended with --arm-session-kind, and leave out --session-kind");
  });
  test("a resume must give the arm kinds its run.json recorded: the same kinds pass, any other set is E_CACHE_STALE with a fix line", async () => {
    const recorded = { "gstack-enforced": "unattended", "gstack-forced": "unattended" };
    const same = await cli([...base(priorRun(recorded)), "--resume", ...kinds("gstack-enforced=unattended", "gstack-forced=unattended")]);
    expect([same.code, same.err]).toEqual([0, ""]);
    const stale: [string, string[], string][] = [
      [priorRun(recorded), kinds("gstack-enforced=unattended"), '{"gstack-enforced":"unattended","gstack-forced":"unattended"}, and this resume gives {"gstack-enforced":"unattended"}'],
      [priorRun(recorded), [], '{"gstack-enforced":"unattended","gstack-forced":"unattended"}, and this resume gives {}'],
      [priorRun(), kinds("gstack-enforced=unattended"), 'ran with arm session kinds {}, and this resume gives {"gstack-enforced":"unattended"}'],
    ];
    for (const [out, extra, message] of stale) {
      const r = await cli([...base(out), "--resume", ...extra]);
      expect([r.code, r.err]).toEqual([2, expect.stringContaining("E_CACHE_STALE review-units: run review-units-earlier ran with arm session kinds ")]);
      expect(r.err).toContain(message);
      expect(r.err).toContain("\n  fix: resume with the run's own --arm-session-kind flags, or start a new run in a new --out");
    }
  });
});
