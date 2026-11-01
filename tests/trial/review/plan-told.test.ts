// GEVA-115's forced-procedure gstack plan arm (GST-849), keyless. A gstack stack arm named gstack-<suffix> runs plan arm
// gstack; only a gstack plan arm takes a told prefix, which must open with the lens's command; none, lens, placebo and
// gstack-auto refuse one; and with no prefix every plan arm's prompt is today's byte for byte. The run loop test drives
// the real Claude Code driver on the real pinned Agent SDK against the stub CLI, which records the user message the SDK
// hands it, so each prompt is checked where it crosses the SDK; plan-told-sdk.ts runs that half in its own process.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { PLAN_PARSER_SHA256, planPrompt, REC_USER_SHA256, TOLD_PLAN_SHA256, TOLD_PLAN_TEMPLATE, type PlanArm } from "../../../src/trial/review/plan.ts";
import { planArmFor, planPrefixProblem, planToldLine, planToldPrompt } from "../../../src/trial/review/plan-told.ts";
import { runReviewUnits, type ReviewRunInput } from "../../../src/trial/review/run.ts";
import { collect } from "../../cli/helpers.ts";
import { PANEL_REPO, planPanel } from "../../noloss/plan-panel.ts";
import { ARMS as RUN_ARMS, FORCED } from "./plan-told-sdk.ts";

const OPUS = "claude-opus-5-5";
const ASK = "Review this plan for problems.";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const ARMS: PlanArm[] = ["none", "gstack", "gstack-auto", "lens", "placebo"];
/** Each plan arm's whole prompt at e305ed0, R1a's pin, and at #119's head e8b9a6b: the same digests at both. */
const TODAY: Record<PlanArm, string> = {
  none: "92065b8ca7f0769794b431609996422306ef8cc41f541171bf0a669509e88030",
  gstack: "e4348aca4d1d7ffb9be09c3a54ef19958ec87a5c3b08416595535c19ac2dc35a",
  "gstack-auto": "8507a1aea7c329b8bcacc8ede8d0b6299ee5e3fadbc7866112c9d4a30af52d8f",
  lens: "016e3c7ae989f73e0ce2ca99545c83b8a7e47a22b60f3465889e63a87b6dabf6",
  placebo: "e4348aca4d1d7ffb9be09c3a54ef19958ec87a5c3b08416595535c19ac2dc35a",
};
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
const durable = () => {
  const d = mkdtempSync(join(REPO_ROOT, ".plan-told-test-"));
  roots.push(d);
  return d;
};

describe("GEVA-115: the forced gstack plan arm's line (keyless)", () => {
  // Value: protects=a second gstack arm can sit beside the default one in a plan run, and nothing else becomes a gstack arm; fails_when=gstack-<suffix> is refused, gstack-auto stops being its own arm, or a bare, placebo or non-gstack arm with a gstack- name runs gstack; why_new=GEVA-115's admission pilot needs gstack and a forced gstack arm in one run; seam=planArmFor
  test("a gstack stack arm named gstack-<suffix> runs plan arm gstack; other names and kinds keep today's mapping", () => {
    const gstack = { repo: "garrytan/gstack", sha: "a".repeat(40) };
    const stack = (name: string, s: { repo: string; sha: string; path?: string } = gstack) => planArmFor({ name, kind: "stack", stack: s, install: {} });
    expect([stack("gstack"), stack("gstack-forced"), stack("gstack-2"), stack("gstack-auto")]).toEqual(["gstack", "gstack", "gstack", "gstack-auto"]);
    expect([stack("gstack-"), stack("gstack_forced"), stack("forced"), stack("gstack-forced", { ...gstack, path: "sub" }), stack("gstack-forced", { repo: "cursor/plugins", sha: "b".repeat(40) })]).toEqual([null, null, null, null, null]);
    expect([planArmFor({ name: "none", kind: "bare" }), planArmFor({ name: "lens", kind: "bare" }), planArmFor({ name: "gstack-forced", kind: "bare" }), planArmFor({ name: "placebo", kind: "placebo", of: "gstack" }), planArmFor({ name: "gstack-forced", kind: "placebo", of: "gstack" })]).toEqual(["none", "lens", null, "placebo", null]);
  });

  // Value: protects=GEVA-115 spec items 2 and 3: only a gstack plan arm takes a prefix, it is one line opening with /plan-ceo-review, and the arm's line becomes it plus the plan ask; fails_when=none, lens, placebo or gstack-auto accept a prefix, a prefix names another command or spans lines, or the line or prompt is built another way; seam=planPrefixProblem, planToldLine, planToldPrompt
  test("only a gstack plan arm takes a prefix, which opens with the lens's command and replaces the command in its line", () => {
    expect(planPrefixProblem("gstack", "ceo", FORCED)).toBeNull();
    for (const arm of ["none", "lens", "placebo", "gstack-auto"] as const) expect(planPrefixProblem(arm, "ceo", FORCED)).toBe("plan arm " + arm + " takes no told prefix; only a gstack plan arm (gstack or gstack-<suffix>) does");
    for (const bad of ["/review Look hard.", "/plan-ceo-reviewer Look hard.", "Look hard. /plan-ceo-review", ""]) expect([bad, planPrefixProblem("gstack", "ceo", bad)]).toEqual([bad, "the prefix must be one line that opens with /plan-ceo-review"]);
    expect(planToldLine("gstack", "ceo", FORCED)).toBe(FORCED + " " + ASK);
    expect(planToldPrompt("gstack", "ceo", FORCED)).toBe(FORCED + " " + ASK + "\n\n" + TOLD_PLAN_TEMPLATE);
  });

  // Value: protects=#123 /ship Step 11 findings 1 and 4: a prefix that adds nothing, repeats the ask, has edge whitespace or holds a control character is refused, and each refusal names its cause; fails_when=the bare command or a prefix holding the ask passes (the arm equals gstack or sends the ask twice), a trailing space gives a double space before the ask, or a CR, tab, BOM or line feed is refused without naming it; seam=planPrefixProblem
  test("a prefix that adds nothing, repeats the ask, has edge whitespace or holds a control character is refused by name", () => {
    const refuse = (prefix: string) => planPrefixProblem("gstack", "ceo", prefix);
    expect(refuse("/plan-ceo-review")).toBe("the prefix adds nothing after /plan-ceo-review, so the arm would send the default gstack line; put the forced instruction after the command");
    for (const twice of ["/plan-ceo-review " + ASK, "/plan-ceo-review Look hard. " + ASK, "/plan-ceo-review " + ASK + " Look hard.", "/plan-ceo-review review this plan for problems."]) expect([twice, refuse(twice)]).toEqual([twice, "the prefix contains " + JSON.stringify(ASK) + ", which the harness appends after it, so the arm would send the ask twice"]);
    for (const edge of [FORCED + " ", " " + FORCED, "/plan-ceo-review ", FORCED + "\u00a0"]) expect([edge, refuse(edge)]).toEqual([edge, "the prefix must not start or end with whitespace; the harness puts one space between it and " + JSON.stringify(ASK)]);
    expect(refuse(FORCED + "\r")).toBe("the prefix must be one line of plain text, but it has a carriage return (U+000D) at character " + (FORCED.length + 1));
    expect(refuse("/plan-ceo-review Look.\nThen look again.")).toBe("the prefix must be one line of plain text, but it has a line feed (U+000A) at character 23");
    expect(refuse("/plan-ceo-review\tLook.")).toBe("the prefix must be one line of plain text, but it has a tab (U+0009) at character 17");
    expect(refuse("\ufeff" + FORCED)).toBe("the prefix must be one line of plain text, but it has a byte order mark (U+FEFF) at character 1");
    expect(refuse("/plan-ceo-review Look\u0000.")).toBe("the prefix must be one line of plain text, but it has a control character (U+0000) at character 22");
  });

  // Value: protects=GEVA-115's prereg forced line is still accepted and sends the prompt it sent at e5ff264 (#123's head); fails_when=a new guard refuses it or its prompt moves by a byte; seam=planPrefixProblem, planToldPrompt
  test("GEVA-115's prereg forced line is accepted and sends the prompt it sent at e5ff264", () => {
    const prereg = "/plan-ceo-review Run this skill's full procedure before you answer: complete Step 0 (Nuclear Scope Challenge + Mode Selection) and state the mode you choose, then Read sections/review-sections.md and write its Review Sections 1 to 10 in order, plus Section 11 or its skip note, before your findings.";
    expect(planPrefixProblem("gstack", "ceo", prereg)).toBeNull();
    expect(sha256(planToldPrompt("gstack", "ceo", prereg))).toBe("d45b910ae3b72927ea7db69ddabd20ee1bb54ad3eaf78324a763bfc74ab45392");
  });

  // Value: protects=GEVA-115 spec item 4: with no prefix every plan arm's prompt is today's byte for byte, the template and parser digests stay R1a's, so frozen preregs replay unchanged and default plan sessions keep their keys; fails_when=any arm's default prompt moves by a byte, or plan.ts (the parser digest's source) changes; why_new=the cut line: a default plan arm must send what it sends today; seam=planToldPrompt, plan.ts
  test("with no prefix every plan arm's prompt is today's byte for byte, and the template and parser digests are R1a's", () => {
    for (const arm of ARMS) expect([arm, sha256(planToldPrompt(arm, "ceo")), planToldPrompt(arm, "ceo", undefined), planToldLine(arm, "ceo")]).toEqual([arm, TODAY[arm], planPrompt(arm, "ceo"), planPrompt(arm, "ceo").split("\n\n")[0]!]);
    expect([TOLD_PLAN_SHA256, PLAN_PARSER_SHA256]).toEqual(["48a6f6a32049f111023e6d15958d1263f94611116d14ccb703809a97eff44291", "048b1f22600b504b7bccccb48c5e2b9b54cdd7a433ad9b35e3261d2df49d0e46"]);
  });
});

describe("GEVA-115: the forced arm in the run loop, through the pinned Agent SDK and the stub CLI (keyless)", () => {
  // Value: protects=the forced arm's prompt crosses the real pinned SDK to the CLI as its prefixed line and the frozen block, arm.json's told block records the prefix and its sha256 the way the code-unit block does, and every arm with no prefix (gstack beside it included) sends today's prompt byte for byte with today's told block; fails_when=the prefix leaks into another arm, the SDK or driver alters the prompt, the default block grows a field, or the two gstack arms share a session key; why_new=GEVA-115's admission pilot; the CREW driver lesson (test where the prompt crosses the SDK); seam=runReviewUnits' taskOf and arm.json, claudeCodeDriver, @anthropic-ai/claude-agent-sdk 0.3.314, in its own process (plan-told-sdk.ts); no_claim=the real CLI or a model
  test("the forced arm sends its prefixed line and records it; every other arm sends today's prompt", () => {
    const records = scratch("plan-told-records-");
    const out = durable();
    const child = spawnSync(process.execPath, [join(import.meta.dir, "plan-told-sdk.ts"), records, out, scratch("plan-told-sdk-")], { encoding: "utf8", timeout: 110_000 });
    expect([child.status, child.stderr]).toEqual([0, ""]);
    expect(JSON.parse(child.stdout.trim().split("\n").at(-1)!)).toEqual([]);
    const sent = (arm: string) => {
      const users = readFileSync(join(records, arm + ".ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.type === "user");
      const content = users[0].message.content;
      return { users: users.length, text: typeof content === "string" ? content : content.map((b: { text: string }) => b.text).join("") };
    };
    expect(sent("gstack-forced")).toEqual({ users: 1, text: FORCED + " " + ASK + "\n\n" + TOLD_PLAN_TEMPLATE });
    for (const arm of ["none", "lens", "placebo", "gstack"] as const) {
      const s = sent(arm);
      expect([arm, s.users, sha256(s.text), s.text]).toEqual([arm, 1, TODAY[arm], planPrompt(arm, "ceo")]);
    }
    const armJson = (id: string) => JSON.parse(readFileSync(join(out, "arms", id, "arm.json"), "utf8"));
    for (const a of RUN_ARMS) expect([a.name, armJson(a.name + "-opus").status]).toEqual([a.name, "complete"]);
    expect(armJson("gstack-forced-opus").told).toEqual({ arm: "gstack", lens: "ceo", line: FORCED + " " + ASK, prefix: FORCED, prefix_sha256: sha256(FORCED), template_sha256: TOLD_PLAN_SHA256, rec_user_sha256: REC_USER_SHA256 });
    for (const arm of ["none", "lens", "placebo", "gstack"] as const) expect(JSON.stringify(armJson(arm + "-opus").told)).toBe(JSON.stringify({ arm, lens: "ceo", line: planPrompt(arm, "ceo").split("\n\n")[0], template_sha256: TOLD_PLAN_SHA256, rec_user_sha256: REC_USER_SHA256 }));
    expect(armJson("gstack-forced-opus").question_preferences_sha256).toBe(armJson("gstack-opus").question_preferences_sha256);
    const keys = readFileSync(join(out, "cells.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.cell.arm.startsWith("gstack")).map((e) => JSON.stringify(e.key));
    expect(keys.length === 2 && keys[0] !== keys[1]).toBe(true);
  }, 120_000);

  // Value: protects=runReviewUnits itself refuses a prefix on none, lens, placebo and gstack-auto, and a malformed one on a gstack arm, with E_USAGE before any binding; fails_when=a caller other than the CLI gets a prefixed prompt onto a non-gstack plan arm; seam=runReviewUnits
  test("the run loop refuses a prefix on any other plan arm, a malformed one, and a gstack-<suffix> arm with none, before any binding", async () => {
    let bound = 0;
    const rig = { arms: {}, bind: async () => { bound++; throw new Error("bound"); } } as unknown as HostRig;
    const input = { host: "claude", suite: { id: "s", sha256: null }, units: [], arms: [], models: [OPUS], passes: 1, parallel: 1, timeoutS: 120, cap: 0, runId: "r", out: durable(), date: "2026-11-01", policy, keyBase: { image_digest: null, recipe: "t", host_version: null, adapter_sha256: "t", isolation: "process" }, journal: null, plan: { lens: "ceo" }, env: {} } as ReviewRunInput;
    for (const told of ["none", "lens", "placebo", "gstack-auto"] as const) await expect(runReviewUnits({ ...input, arms: [{ name: told, told, toldPrefix: FORCED }] }, rig)).rejects.toThrow("E_USAGE: arm " + told + ": --told-prefix: plan arm " + told + " takes no told prefix; only a gstack plan arm (gstack or gstack-<suffix>) does");
    await expect(runReviewUnits({ ...input, arms: [{ name: "gstack-forced", told: "gstack", toldPrefix: "/review " + ASK }] }, rig)).rejects.toThrow("E_USAGE: arm gstack-forced: --told-prefix: the prefix must be one line that opens with /plan-ceo-review");
    await expect(runReviewUnits({ ...input, arms: [{ name: "gstack-forced", told: "gstack", toldPrefix: FORCED + " " }] }, rig)).rejects.toThrow("E_USAGE: arm gstack-forced: --told-prefix: the prefix must not start or end with whitespace");
    await expect(runReviewUnits({ ...input, arms: [{ name: "gstack-forced", told: "gstack", toldPrefix: "/plan-ceo-review" }] }, rig)).rejects.toThrow("E_USAGE: arm gstack-forced: --told-prefix: the prefix adds nothing after /plan-ceo-review");
    await expect(runReviewUnits({ ...input, arms: [{ name: "gstack", told: "gstack" }, { name: "gstack-forced", told: "gstack" }] }, rig)).rejects.toThrow("E_USAGE: arm gstack-forced runs plan arm gstack with no --told-prefix; a gstack-<suffix> plan arm needs a told prefix");
    await expect(runReviewUnits({ ...input, arms: [{ name: "gstack", told: "gstack", toldPrefix: FORCED }, { name: "placebo", told: "placebo" }] }, rig)).rejects.toThrow("E_USAGE: the placebo arm runs the gstack arm's default line, so arm gstack takes no --told-prefix beside it; give the forced line to a gstack-<suffix> arm");
    expect(bound).toBe(0);
  });
});

describe("GEVA-115: review-units --plan --told-prefix (keyless)", () => {
  // Value: protects=the CLI admits a forced gstack-<suffix> arm beside gstack and shows both lines in the dry run, and refuses a prefix on none, lens, placebo and gstack-auto, a malformed, no-op or ask-repeating prefix (naming a control character or edge whitespace), a gstack-<suffix> arm with no prefix, and a prefix on the gstack arm placebo mirrors, all with E_USAGE before anything is built; fails_when=any of those regress, or the old blanket refusal returns; why_new=GEVA-115; seam=main
  test("refusals and the dry run", async () => {
    const panel = planPanel(scratch("plan-told-cli-"), { seeded: 1 });
    const dir = scratch("plan-told-prefix-");
    const file = (name: string, text: string) => {
      writeFileSync(join(dir, name), text);
      return join(dir, name);
    };
    const forced = file("forced.txt", FORCED + "\n");
    const run = async (argv: string[]) => {
      const io = collect();
      const code = await main(argv, io, {});
      return { code, ...io.text() };
    };
    const out = join(scratch("plan-told-cli-out-"), "out");
    const ref = "garrytan/gstack@" + "a".repeat(40);
    const base = ["--suite", panel.stubPath, "--sealed-root", panel.sealedRoot, "--units", "all", "--models", OPUS, "--out", out, "--source", PANEL_REPO + "=" + panel.clone, "--base-branch", PANEL_REPO + "=main", "--plan", "ceo", "--dry-run"];
    for (const [arm, arms] of [["none", ["none"]], ["lens", ["lens"]], ["placebo", ["placebo", "gstack=" + ref]], ["gstack-auto", ["gstack-auto=" + ref]]] as const) {
      const r = await run([...base, "--arms", ...arms, "--told-prefix", arm + "=" + forced]);
      expect([arm, r.code, r.err.split("\n")[0]]).toEqual([arm, 2, "E_USAGE review-units: --told-prefix " + arm + ": plan arm " + arm + " takes no told prefix; only a gstack plan arm (gstack or gstack-<suffix>) does"]);
    }
    for (const [bad, why] of [["/review " + ASK + "\n", "the prefix must be one line that opens with /plan-ceo-review"], ["/plan-ceo-review Look.\nThen look again.\n", "the prefix must be one line of plain text, but it has a line feed (U+000A) at character 23"], [FORCED + "\r\n", "the prefix must be one line of plain text, but it has a carriage return (U+000D) at character " + (FORCED.length + 1)], [FORCED + " \n", "the prefix must not start or end with whitespace; the harness puts one space between it and " + JSON.stringify(ASK)], ["/plan-ceo-review\n", "the prefix adds nothing after /plan-ceo-review, so the arm would send the default gstack line; put the forced instruction after the command"], ["/plan-ceo-review " + ASK + "\n", "the prefix contains " + JSON.stringify(ASK) + ", which the harness appends after it, so the arm would send the ask twice"]] as const) {
      const r = await run([...base, "--arms", "gstack-forced=" + ref, "--told-prefix", "gstack-forced=" + file("bad.txt", bad)]);
      expect([bad, r.code, r.err.split("\n")[0]]).toEqual([bad, 2, "E_USAGE review-units: --told-prefix gstack-forced: " + why]);
    }
    const lone = await run([...base, "--arms", "gstack=" + ref, "gstack-forced=" + ref]);
    expect([lone.code, lone.err.split("\n")[0]]).toEqual([2, "E_USAGE review-units: arm gstack-forced runs plan arm gstack with no --told-prefix; a gstack-<suffix> plan arm needs a told prefix"]);
    const mirrored = await run([...base, "--arms", "gstack=" + ref, "placebo", "--told-prefix", "gstack=" + forced]);
    expect([mirrored.code, mirrored.err.split("\n")[0]]).toEqual([2, "E_USAGE review-units: the placebo arm runs the gstack arm's default line, so arm gstack takes no --told-prefix beside it; give the forced line to a gstack-<suffix> arm"]);
    const dry = await run([...base, "--arms", "none", "gstack=" + ref, "gstack-forced=" + ref, "placebo", "--told-prefix", "gstack-forced=" + forced]);
    expect([dry.code, dry.err]).toEqual([0, ""]);
    expect(dry.out).toContain('gstack ("/plan-ceo-review ' + ASK + '" on ' + OPUS + ")");
    expect(dry.out).toContain("gstack-forced (" + JSON.stringify(FORCED + " " + ASK) + " on " + OPUS + ")");
    expect(dry.out).toContain('placebo ("/plan-ceo-review ' + ASK + '" on ' + OPUS + ")");
    const alone = await run([...base, "--arms", "gstack=" + ref, "--told-prefix", "gstack=" + forced]);
    expect([alone.code, alone.out]).toEqual([0, expect.stringContaining("gstack (" + JSON.stringify(FORCED + " " + ASK) + " on " + OPUS + ")")]);
  });
});
