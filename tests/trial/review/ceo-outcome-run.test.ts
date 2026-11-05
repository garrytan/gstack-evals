// Copyright (c) 2026 Garry Tan. MIT License.
// review-units --plan ceo-outcome: the follow-up turn through the real pinned Agent SDK and the stub CLI, the journal's one
// parse, the end states, gaps that drop per contrast instead of stopping the arm, and stops.json for a cap stop
// (ceo-outcome-sdk.ts runs the sessions in their own process). Then the CLI's ceo-outcome refusals and dry run. Keyless.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../../src/cli.ts";
import { removeTree } from "../../../src/trial/cleanup.ts";
import { CAPPED_PARSER_SHA256 } from "../../../src/trial/review/capped.ts";
import { CEO_PARSER_SHA256, CEO_TEMPLATE_SHA256, ceoPrompt, FOLLOW_UP, FORCED_LINE } from "../../../src/trial/review/ceo-outcome.ts";
import { main } from "../../../src/trial/review/cli.ts";
import { READERS_SHA256 } from "../../../src/trial/review/readers.ts";
import { BODY, OPUS, SONNET } from "./ceo-outcome-sdk.ts";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
/** A run's out dir: outside the repo (a ceo-outcome run holds review text) and off tmp (receipts must outlive the machine). */
const durable = () => {
  const d = mkdtempSync(join(homedir(), ".gstack-evals-ceo-outcome-test-"));
  roots.push(d);
  return d;
};
const lines = (f: string) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

describe("item2-one-parse and item4-parser-shapes: the ceo-outcome run loop, through the pinned Agent SDK and the stub CLI", () => {
  // Value: protects=the follow-up turn fires once at a completed session's success result when no parsable block was written, never twice and never after another termination; the journal holds one parse per session with the parser's sha256, the end state, the follow-up flag, wall_s and usd; a gap drops per contrast with no E_COVERAGE_GAP stop; a cap stop lists the unit-passes it left unstarted; fails_when=the follow-up repeats or fires on a turn cap or an API error, the session key misses the parser or the allowance, a gap stops the arm, or a cap stop's cells go unrecorded; why_new=binding items 2 and 4, F3, F7, F11, readings 3 and 9; the CREW driver lesson (test where the prompt crosses the SDK); seam=runReviewUnits with plan.lens ceo-outcome, claudeCodeDriver's followUp, @anthropic-ai/claude-agent-sdk in its own process (ceo-outcome-sdk.ts); no_claim=the real CLI or a model
  const records = scratch("ceo-outcome-records-");
  const out = durable();
  const capOut = durable();
  let ran: { status: number | null; stderr: string; stdout: string } | null = null;
  const run = () => (ran ??= spawnSync(process.execPath, [join(import.meta.dir, "ceo-outcome-sdk.ts"), records, out, capOut, scratch("ceo-outcome-sdk-")], { encoding: "utf8", timeout: 170_000 }));
  const sent = (arm: string, model: string) => lines(join(records, arm + "-" + model + ".ndjson")).filter((m) => m.type === "user").map((m) => (typeof m.message.content === "string" ? m.message.content : m.message.content.map((b: { text: string }) => b.text).join("")));
  const journal = () => new Map(lines(join(out, "cells.ndjson")).map((e) => [e.cell.arm + " " + e.cell.model, e]));

  test("the follow-up turn: once after a completed session with no parsable block, never twice, never after a turn cap or an API error", () => {
    const child = run();
    expect([child.status, child.stderr]).toEqual([0, ""]);
    expect(JSON.parse(child.stdout.trim().split("\n").at(-1)!).stops).toEqual([]);
    expect(sent("none", OPUS)).toEqual([ceoPrompt("none"), FOLLOW_UP]);
    expect(sent("lens", OPUS)).toEqual([ceoPrompt("lens")]);
    expect(sent("gstack-auto", OPUS)).toEqual([ceoPrompt("gstack-auto"), FOLLOW_UP]);
    expect(sent("gstack-forced", OPUS)).toEqual([ceoPrompt("gstack-forced")]);
    expect(sent("none", SONNET)).toEqual([ceoPrompt("none")]);
    expect(sent("lens", SONNET)).toEqual([ceoPrompt("lens"), FOLLOW_UP]);
    expect(ceoPrompt("gstack-forced").startsWith(FORCED_LINE + " Review this plan for problems.\n\n")).toBe(true);
  }, 180_000);

  test("each journal entry holds one parse with the parser's sha256, the end state, the follow-up flag, wall_s and usd", () => {
    run();
    const j = journal();
    expect(j.size).toBe(6);
    const want: Record<string, [string, string, boolean, string]> = {
      ["none " + OPUS]: ["completed", "scored", true, "block"],
      ["lens " + OPUS]: ["completed", "scored", false, "block"],
      ["gstack-auto " + OPUS]: ["completed", "no-block", true, "missing"],
      ["gstack-forced " + OPUS]: ["turn_cap", "scored", false, "block"],
      ["none " + SONNET]: ["missing", "gap", false, "missing"],
      ["lens " + SONNET]: ["completed", "no-block", true, "malformed"],
    };
    for (const [cell, [termination, state, followUp, kind]] of Object.entries(want)) {
      const e = j.get(cell)!;
      expect([cell, e.record.termination.kind, e.ceo_outcome.end_state, e.ceo_outcome.follow_up, e.parse.kind]).toEqual([cell, termination, state, followUp, kind]);
      expect(e.ceo_outcome.parser_sha256).toBe(CEO_PARSER_SHA256);
      // gstack-timing-ok: wall_s is the recorded session clock (reading 11); a stub session takes well under a second, so the bound only checks the field is that clock and not an epoch
      expect(typeof e.ceo_outcome.wall_s === "number" && e.ceo_outcome.wall_s >= 0 && e.ceo_outcome.wall_s <= 60).toBe(true);
      expect(e.ceo_outcome.usd).toBe(0);
      expect(Object.keys(e).filter((k) => /parse/i.test(k))).toEqual(["parse"]);
      expect(e.key.parts.verifier).toBe(sha256(JSON.stringify(CEO_PARSER_SHA256 + "+" + CAPPED_PARSER_SHA256 + "+" + READERS_SHA256)));
    }
    const stale: string[] = JSON.parse(run().stdout.trim().split("\n").at(-1)!).stale;
    expect(stale).toHaveLength(6);
    for (const s of stale) expect(s).toEndWith("the cached session's key no longer matches; changed: task");
    for (const cell of ["none " + OPUS, "lens " + OPUS, "gstack-forced " + OPUS]) expect(j.get(cell)!.parse).toEqual({ kind: "block", top: [{ issue: JSON.parse(BODY).top[0].issue, evidence: "plan.md, Rollout", fix: JSON.parse(BODY).top[0].fix }], forecast: 35, body_sha256: sha256(BODY) });
  });

  test("a gap is listed in arm.json and drops per contrast; no E_COVERAGE_GAP stop; stops.json is empty", () => {
    run();
    const arm = JSON.parse(readFileSync(join(out, "arms", "none-sonnet", "arm.json"), "utf8"));
    expect(arm.status).toBe("complete");
    expect(arm.coverage_gaps).toBeUndefined();
    expect(arm.ceo_outcome.end_states).toEqual({ scored: 0, "no-block": 0, gap: 1, not_run: 0 });
    expect(arm.ceo_outcome.gaps).toHaveLength(1);
    expect(arm.ceo_outcome.gaps[0]).toContain("missing (UPSTREAM)");
    expect(JSON.parse(readFileSync(join(out, "arms", "none-opus", "arm.json"), "utf8")).ceo_outcome).toMatchObject({ end_states: { scored: 1, "no-block": 0, gap: 0, not_run: 0 }, follow_ups: 1, parser_sha256: CEO_PARSER_SHA256, template_sha256: CEO_TEMPLATE_SHA256 });
    expect(JSON.parse(readFileSync(join(out, "stops.json"), "utf8"))).toEqual({ schema_version: 1, stops: [] });
  });

  test("a cap stop writes stops.json with every unit-pass it left unstarted", () => {
    const child = run();
    const cap = JSON.parse(child.stdout.trim().split("\n").at(-1)!).cap;
    expect(cap.map((s: { code: string }) => s.code)).toEqual(["CAP_STOP"]);
    const stops = JSON.parse(readFileSync(join(capOut, "stops.json"), "utf8"));
    expect(stops.stops).toHaveLength(1);
    expect(stops.stops[0].code).toBe("CAP_STOP");
    const cells = stops.stops[0].cells.map((c: { model: string; arm: string; pass: number; how: string }) => c.arm + " " + c.model + " " + c.pass + " " + c.how).sort();
    expect(cells).toEqual(["gstack-auto " + OPUS + " 1 unstarted", "gstack-forced " + OPUS + " 1 unstarted", "lens " + OPUS + " 1 unstarted", "lens " + SONNET + " 1 unstarted", "none " + OPUS + " 1 unstarted", "none " + SONNET + " 1 unstarted"]);
  });
});

describe("review-units --plan ceo-outcome on the command line (keyless)", () => {
  // Value: protects=--plan ceo-outcome needs a ceo-outcome suite and its four arm names, takes no other told prefix, refuses an in-repo --out, ends each refusal with a fix line, and prints each arm's line in its dry run; fails_when=a plan suite runs the ceo-outcome lens, a fifth arm or a changed forced line slips in, or a run writes review text into the repo; why_new=plan section 2 and 12 (d4, F13); seam=src/trial/review/cli.ts main; no_claim=a real run
  const dir = scratch("ceo-outcome-cli-");
  const unit = { repo: "acme/widgets", pr: 7, head: "a".repeat(40), base: "b".repeat(40) };
  const suite = { schema_version: 1, id: "ceo-outcome-cli", title: "t", kind: "ceo-outcome", development_only: true, purpose: "p", sealed: false, catalogs: ["units"], sources: [], prereg_freezes: [], judging_rule: "judge-brief.md", shelf_life: { rule: "r", released: null }, groups: {}, units: [{ id: "acme/widgets#7@" + "a".repeat(12), ...unit, cluster: "acme/widgets#7", group: null, blockers: [] }], ineligible: [], excluded: [], frozen_bars: [] };
  writeFileSync(join(dir, "suite.json"), JSON.stringify(suite));
  writeFileSync(join(dir, "plan-suite.json"), JSON.stringify({ ...suite, id: "plan-cli", kind: "plan", units: [{ ...suite.units[0], blockers: [{ id: "B1", case: "c1", paths: ["plan.md"], file: "plan.md", line: 1, location: "added", counts: "blocking" }] }] }));
  writeFileSync(join(dir, "forced.txt"), FORCED_LINE + "\n");
  writeFileSync(join(dir, "other.txt"), "/plan-ceo-review Run every section.\n");
  const base = ["--units", "all", "--models", OPUS, "--source", "acme/widgets=" + dir, "--base-branch", "acme/widgets=main", "--dry-run"];
  const cli = async (argv: string[]) => {
    const o: string[] = [];
    const e: string[] = [];
    const code = await main(argv, { out: (t) => o.push(t), err: (t) => e.push(t) }, {});
    return { code, out: o.join("\n"), err: e.join("\n") };
  };
  const arms = ["none", "lens", "gstack-auto=garrytan/gstack@" + "1".repeat(40), "gstack-forced=garrytan/gstack@" + "1".repeat(40)];
  test("the dry run prints each arm's line", async () => {
    const r = await cli(["--suite", join(dir, "suite.json"), "--plan", "ceo-outcome", "--arms", ...arms, "--out", join(dir, "out"), ...base]);
    expect([r.code, r.err]).toEqual([0, ""]);
    for (const a of ["none", "lens", "gstack-auto", "gstack-forced"] as const) expect(r.out).toContain(JSON.stringify(ceoPrompt(a).split("\n\n")[0]));
    expect(r.out).toContain("ceo-outcome template sha256 " + CEO_TEMPLATE_SHA256 + "; ceo parser sha256 " + CEO_PARSER_SHA256);
  });
  test("refusals: a plan suite, another arm, another told prefix, an in-repo --out; each ends with a fix line", async () => {
    const refusals: [string[], string][] = [
      [["--suite", join(dir, "plan-suite.json"), "--plan", "ceo-outcome", "--arms", "none", "--out", join(dir, "out")], "--plan ceo-outcome needs a ceo-outcome suite"],
      [["--suite", join(dir, "suite.json"), "--plan", "ceo", "--arms", "none", "--out", join(dir, "out")], "is a ceo-outcome suite; pass --plan ceo-outcome"],
      [["--suite", join(dir, "suite.json"), "--plan", "ceo-outcome", "--arms", "placebo", "--out", join(dir, "out")], "--plan ceo-outcome runs arms none, lens, gstack-auto and gstack-forced"],
      [["--suite", join(dir, "suite.json"), "--plan", "ceo-outcome", "--arms", ...arms, "--told-prefix", "gstack-forced=" + join(dir, "other.txt"), "--out", join(dir, "out")], "takes its line from the lens"],
      [["--suite", join(dir, "suite.json"), "--plan", "ceo-outcome", "--arms", "none", "--out", join(REPO_ROOT, ".ceo-outcome-out")], "inside the repo"],
    ];
    for (const [argv, message] of refusals) {
      const r = await cli([...argv, ...base]);
      expect([r.code, r.err.split("\n")[0]]).toEqual([2, expect.stringContaining(message)]);
      expect(r.err).toContain("\n  fix: ");
    }
    const same = await cli(["--suite", join(dir, "suite.json"), "--plan", "ceo-outcome", "--arms", ...arms, "--told-prefix", "gstack-forced=" + join(dir, "forced.txt"), "--out", join(dir, "out"), ...base]);
    expect(same.code).toBe(0);
  });
});
