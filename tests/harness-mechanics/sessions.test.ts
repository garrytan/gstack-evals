// Copyright (c) 2026 Garry Tan. MIT License.
// Dry-run steps 1 and 2 on the scripted sessions' captures (lanes/harness-mechanics/sessions.ts): the fixtures under
// fixtures/arms/ are cut from live keyless sessions in the real arm images (bun lanes/harness-mechanics/sessions.ts run
// --out <dir> --cut tests/harness-mechanics/fixtures/arms), so every case's scoring is checked here without Docker.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { HM, REPO, VERIFY_RENDER_FIRST200 } from "../../lanes/harness-mechanics/pins.ts";
import { scoreSession } from "../../lanes/harness-mechanics/score.ts";
import { CASES, caseProblems, inImageProblems, loadCaptured, ROUTE_MARK, type Captured } from "../../lanes/harness-mechanics/sessions.ts";

const FX = join(import.meta.dir, "fixtures/arms");
const cap = (name: string) => loadCaptured(join(FX, name));
const kase = (name: string) => CASES.find((c) => c.name === name)!;
const texts = (c: Captured, as = kase("none-stop")) => caseProblems(as, c).map((p) => p.step + " " + p.text);
const row = (name: string) => {
  const c = cap(name), s = scoreSession(parseLog(c.sdk), { pass: null, transcript: c.transcript, record: c.record });
  return [s.adherent, s.claim, s.verify_loads, s.hook.record, s.hook.outcome, s.hook.blocks, s.hook.waived, s.blocked_exit, s.last_edit_before_last_load];
};

describe("the scripted sessions, one per case", () => {
  for (const c of CASES) test(c.name + " meets every assertion of steps 1 and 2", () => expect(caseProblems(c, cap(c.name))).toEqual([]));
  test("score.ts per case: adherent, claim, /verify loads, the contract record, BLOCKED exit, the hook window", () => {
    expect(row("none-stop")).toEqual([false, "FIXED", 0, null, null, null, null, false, false]);
    expect(row("prose-stop")).toEqual([false, "FIXED", 1, null, null, null, null, false, false]);
    expect(row("hook-stop")).toEqual([false, "FIXED", 1, true, "miss", 1, false, false, false]);
    expect(row("hook-waive")).toEqual([false, "FIXED", 1, true, "met_after_block", 1, true, false, false]);
    expect(row("hook-blocked")).toEqual([false, "BLOCKED", 1, true, "met", 0, false, true, false]);
    expect(row("hook-reread")).toEqual([false, "FIXED", 2, true, "met", 0, false, false, true]);
  });
});

describe("the slash-command load", () => {
  test("the installed render's first 200 characters are pinned, and are the prose and hook manifests' verify.first200_sha256", () => {
    expect(createHash("sha256").update(VERIFY_RENDER_FIRST200.text).digest("hex")).toBe(VERIFY_RENDER_FIRST200.sha256);
    for (const arm of ["prose", "hook"]) expect(JSON.parse(readFileSync(join(REPO, "quick/laneb", HM.armManifests, arm + ".json"), "utf8")).verify.first200_sha256).toBe(VERIFY_RENDER_FIRST200.sha256);
  });
  test("counts from Claude Code's transcript only with the rendered body arriving", () => {
    const c = cap("prose-stop"), n = (transcript: string) => scoreSession(parseLog(c.sdk), { pass: null, transcript }).verify_loads;
    expect(n(c.transcript!)).toBe(1);
    expect(n(c.transcript!.replace("<!-- loadout: lite -->", "<!-- loadout: full -->"))).toBe(0);
  });
});

describe("the assertions fail when they should", () => {
  test("the strip-off control loads the hostile files, so the same capture fails a strip-on case", () => {
    const got = texts(cap("none-nostrip"));
    expect(got.some((x) => x.startsWith("1 none-stop: hostile files reached the first request: HM-CANARY-CLAUDE-MD"))).toBe(true);
    expect(got.some((x) => x.includes("the evil project skill loaded"))).toBe(true);
  });
  test("a blocked session fails as prose, and a prose session fails as hook", () => {
    expect(texts(cap("hook-stop"), kase("prose-stop"))).toContain("2 prose-stop: prose was blocked 1 times");
    expect(texts(cap("prose-stop"), kase("hook-stop")).filter((x) => /contract record|blocked 0 times/.test(x)).length).toBe(2);
  });
  test("route context in the first request fails a gstack arm", () => {
    const c = cap("prose-stop");
    expect(texts({ ...c, first: { ...c.first!, messages: [{ role: "user", content: ROUTE_MARK }] } }, kase("prose-stop"))).toContain("1 prose-stop: route context in the first request (routing must be off)");
  });
  test("the SDK log alone carries no /verify expansion: without Claude Code's transcript the load is missed", () => {
    expect(texts({ ...cap("prose-stop"), transcript: null }, kase("prose-stop"))).toContain("2 prose-stop: the '/verify ' prompt gave 0 /verify loads as score.ts counts them");
  });
  test("a waiver, a BLOCKED exit and a reread each fail as a plain stop", () => {
    for (const n of ["hook-waive", "hook-blocked", "hook-reread"]) expect(texts(cap(n), kase("hook-stop")).length).toBeGreaterThan(0);
  });
});

describe("step 1's in-image checks", () => {
  const out = (arm: string) => readFileSync(join(FX, "in-image", arm + ".txt"), "utf8");
  for (const arm of ["none", "prose", "hook"] as const) test(arm + " passes as built", () => expect(inImageProblems(arm, out(arm))).toEqual([]));
  test("each check fails on a changed image", () => {
    expect(inImageProblems("none", out("none").replace("skills=0", "skills=3"))).toEqual(["none: skills=3"]);
    expect(inImageProblems("prose", out("prose").replace("skill_routing=off", "skill_routing=on")).length).toBe(1);
    expect(inImageProblems("hook", out("prose").replace("skill_contracts=off", "skill_contracts=on")).some((x) => x.startsWith("hook: the checkout's verify/SKILL.md is blob"))).toBe(true);
    expect(inImageProblems("prose", out("prose").replace(/claude=\S+/, "claude=2.1.300")).length).toBe(1);
  });
});

describe("sessions-driver.py's agent options", () => {
  test("set every option LanebHooksAgent and LanebAgent read, so the driver can't drift from the agent", () => {
    const read = new Set(["laneb_agent.py", "laneb_hooks.py"].flatMap((f) => [...readFileSync(join(REPO, "quick/laneb/runner/agent", f), "utf8").matchAll(/self\.options\.(\w+)/g)].map((m) => m[1]!)));
    const opts = readFileSync(join(REPO, "lanes/harness-mechanics/sessions-driver.py"), "utf8").match(/a\.options = types\.SimpleNamespace\(([\s\S]*?)\n\)/)![1]!;
    const set = new Set([...opts.matchAll(/(\w+)=/g)].map((m) => m[1]!));
    expect([...read].filter((o) => !set.has(o))).toEqual([]);
  });
});
