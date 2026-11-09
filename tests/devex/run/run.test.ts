// Copyright (c) 2026 Garry Tan. MIT License.
// The devex run side (prereg 2026-11-09-geva-417, sections 5, 6, 10 and 11; section 15 rule 4): every run/checks.ts
// line passes, the prompts are the frozen text, the rec persona's one answer rule, both detectors on the committed
// fixtures, and review-units --plan devex's dry run and refusals.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checks } from "../../../lanes/devex/run/checks.ts";
import { sessionExposure } from "../../../lanes/devex/run/exposure.ts";
import { answerCounts, DX_FINISH, DX_FOLLOW_UP, dxAnswer } from "../../../lanes/devex/run/persona.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { DX_GSTACK, DX_TEMPLATE, dxPrompt } from "../../../src/trial/review/devex.ts";

const FIX = join(import.meta.dir, "fixtures");

describe("the run side's dry-run lines", () => {
  // Value: protects=every frozen run-side rule is driven on both sides of its edge; fails_when=any line fails; why_new=dryrun.ts runs these lines; seam=checks; no_claim=a paid run
  test("every line passes", async () => {
    const lines = await checks();
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(lines.filter((l) => !l.pass).map((l) => l.rule + ": " + l.detail)).toEqual([]);
  }, 60_000);
});

describe("arms, persona and detectors", () => {
  // Value: protects=section 5's exact lines and section 6's template; fails_when=a byte moves; why_new=the frozen prompts; seam=dxPrompt; no_claim=model behavior
  test("each prompt is its lines, the common line, a blank line and the template", () => {
    const common = "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it.";
    expect(dxPrompt("none")).toBe(common + "\n\n" + DX_TEMPLATE);
    expect(dxPrompt("lens")).toBe("Do a developer-experience lead's review of this plan.\n" + common + "\n\n" + DX_TEMPLATE);
    expect(dxPrompt("plan-devex-review")).toBe("/plan-devex-review plan.md\nRun its whole procedure unattended, taking your recommended option at every decision.\n" + common + "\n\n" + DX_TEMPLATE);
    expect(dxPrompt("autoplan")).toBe("/autoplan --kind feature plan.md\nRun its whole procedure, taking your recommended option at every decision.\n" + common + "\n\n" + DX_TEMPLATE);
  });
  // Value: protects=the one answer rule; fails_when=a question gets other than the recommended, else first, option; why_new=section 5's persona; seam=dxAnswer, answerCounts, DX_FOLLOW_UP; no_claim=the simulator's own effect gating
  test("recommended, else first, else the prose reply; the follow-up only without a block", () => {
    expect(dxAnswer("Pick?\n- A) Fast: quick\n- B) Safe (recommended): slow")).toEqual({ text: "B) Safe (recommended)", rule: "recommended" });
    expect(dxAnswer("Pick?\n- A) Fast: quick\n- B) Safe: slow")).toEqual({ text: "A) Fast", rule: "first" });
    expect(dxAnswer("Shall I go on?").rule).toBe("prose");
    expect(DX_FOLLOW_UP.text).toBe(DX_FINISH);
    expect(DX_FOLLOW_UP.needed("")).toBe(true);
    const c = answerCounts('{"kind":"ask","source":"freeform"}\n{"kind":"prose","source":"non_approving"}\n', '{"rule":"first"}\n', '{"follow_up":true}');
    expect(c).toEqual({ asks: 1, recommended: 0, first: 1, prose: 1, not_rec: 1, finish: true });
  });
  // Value: protects=section 5's autoplan detector, each marker on its own fixture; fails_when=an unexposed run reads exposed; why_new=AP-DX-1; seam=sessionExposure; no_claim=gstack's real run directory beyond the pin's documented files
  test("autoplan: exposed, and unexposed without the dx lens, the gate or the cell's model", () => {
    const read = (d: string) => sessionExposure(join(FIX, d), "autoplan", "claude-opus-5-5") as unknown as { exposed: boolean; markers: Record<string, boolean>; dx_lens: boolean | null };
    expect(read("autoplan-exposed").exposed).toBe(true);
    expect(read("autoplan-nodx")).toMatchObject({ exposed: false, dx_lens: false, markers: { lean_dx: false } });
    expect(read("autoplan-nogate").markers.gate).toBe(false);
    expect(read("autoplan-othermodel").markers.reviewer).toBe(false);
  });
});

describe("review-units --plan devex", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
  };
  const units = () => {
    const dir = mkdtempSync(join(tmpdir(), "dx-cli-"));
    mkdirSync(join(dir, "u1", "repo"), { recursive: true });
    writeFileSync(join(dir, "u1", "unit.json"), JSON.stringify({ id: "u1" }));
    writeFileSync(join(dir, "u1", "plan.md"), "Add an init command.\n");
    writeFileSync(join(dir, "u1", "key.json"), "{}");
    writeFileSync(join(dir, "u1", "repo", "a.ts"), "export {};\n");
    return dir;
  };
  const stack = DX_GSTACK.repo + "@" + DX_GSTACK.sha;
  // Value: protects=the dry run checks mounts and prints every arm, and a paid run refuses before anything is built; fails_when=it spends or skips a check; why_new=the devex lens; seam=main dispatch, dxMain; no_claim=the paid loop, which is not built
  test("the dry run prints every arm with key.json unmounted; a paid run and a wrong pin refuse", async () => {
    const dir = units();
    try {
      const base = ["--plan", "devex", "--units-dir", dir, "--units", "all", "--models", "claude-opus-5-5", "--out", join(dir, "out")];
      const arms = ["--arms", "none", "lens", "plan-devex-review=" + stack, "autoplan=" + stack];
      const a = io();
      expect(await main([...base, ...arms, "--dry-run"], a.io, {})).toBe(0);
      expect(a.out.join("\n")).toContain("key.json, alias.json and unit.json are never mounted");
      expect(a.out.filter((l) => l.startsWith("arm ")).length).toBe(4);
      expect(a.out.join("\n")).toContain("GSTACK_SESSION_KIND=interactive");
      const b = io();
      expect(await main([...base, ...arms], b.io, {})).toBe(2);
      expect(b.err.join("\n")).toMatch(/^E_USAGE .*session loop is not built/);
      const c = io();
      expect(await main([...base, "--arms", "autoplan=" + DX_GSTACK.repo + "@" + "0".repeat(40), "--dry-run"], c.io, {})).toBe(2);
      expect(c.err.join("\n")).toContain("the prereg pins");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
