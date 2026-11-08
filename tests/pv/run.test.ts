// Copyright (c) 2026 Garry Tan. MIT License.
// review-units --plan product-value: the run loop through the real pinned Agent SDK and the stub CLI (pv-sdk.ts runs the
// sessions in its own process): each arm's frozen prompt, the journal's one parse with the parser's sha256, end states
// after the one retry per infrastructure failure, web contamination, the mount, arm.json's product_value counts, then
// pv rows over that run and its refusals, the prompts against the frozen post, and the state root copy. Keyless.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { copyDir } from "../../src/trial/trial.ts";
import { CAPPED_PARSER_SHA256 } from "../../src/trial/review/capped.ts";
import { PV_ARMS, PV_FALLBACK_SENTENCE, PV_GATE_ARM, PV_TEMPLATE, PV_TEMPLATE_SHA256, pvArm, pvPrompt, pvTaskId } from "../../src/trial/review/product-value.ts";
import { READERS_SHA256 } from "../../src/trial/review/readers.ts";
import { PV_PARSER_SHA256 } from "../../lanes/product-value/parse.ts";
import { run as rows } from "../../lanes/product-value/rows.ts";
import type { Row } from "../../lanes/product-value/types.ts";
import { OPUS, UNIT } from "./pv-sdk.ts";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => removeTree(r)));
const scratch = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  roots.push(d);
  return d;
};
/** A run's out dir: outside the repo (a product-value run holds review text). */
const durable = () => {
  const d = mkdtempSync(join(homedir(), ".gstack-evals-pv-test-"));
  roots.push(d);
  return d;
};
const lines = (f: string) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const io = () => {
  const o = { out: [] as string[], err: [] as string[] };
  return { o, io: { out: (t: string) => o.out.push(t), err: (t: string) => o.err.push(t) } };
};

describe("the product-value run loop, through the pinned Agent SDK and the stub CLI", () => {
  const records = scratch("pv-records-");
  const out = durable();
  let ran: { status: number | null; stderr: string; stdout: string } | null = null;
  const run = () => (ran ??= spawnSync(process.execPath, [join(import.meta.dir, "pv-sdk.ts"), records, out, scratch("pv-sdk-")], { encoding: "utf8", timeout: 170_000 }));
  const sent = (arm: string) => lines(join(records, arm + ".ndjson")).filter((m) => m.type === "user").map((m) => (typeof m.message.content === "string" ? m.message.content : m.message.content.map((b: { text: string }) => b.text).join("")));
  const journal = () => new Map(lines(join(out, "cells.ndjson")).map((e) => [e.cell.arm + " " + e.cell.pass, e]));
  const task = pvTaskId(UNIT);
  const session = (arm: string, pass: number) => join(out, "runs", OPUS, arm, task, "p" + pass);

  test("each attempt sends its arm's frozen prompt, the retry included", () => {
    const child = run();
    expect([child.status, child.stderr]).toEqual([0, ""]);
    expect(JSON.parse(child.stdout.trim().split("\n").at(-1)!)).toEqual({ stops: [], spawned: { none: 2, lens: 3, "plan-ceo-review": 3 } });
    for (const [arm, n] of [["none", 2], ["lens", 3], ["plan-ceo-review", 3]] as const) expect(sent(arm)).toEqual(Array(n).fill(pvPrompt("plan", arm, false)));
  }, 180_000);

  test("one parse per session with the parser's sha256; end states after the one retry; contamination and missing", () => {
    run();
    const j = journal();
    expect(j.size).toBe(6);
    const want: Record<string, [string, string, (string | null)[], number]> = {
      "none 1": ["block", "changes", [null], 0],
      "none 2": ["contaminated", "changes", [null], 1],
      "lens 1": ["no-block", "no-block", [null], 0],
      "lens 2": ["missing", "no-block", ["API error", "API error"], 0],
      "plan-ceo-review 1": ["block", "changes", ["API error", null], 0],
      "plan-ceo-review 2": ["block", "changes", [null], 0],
    };
    for (const [cell, [end, parse, reasons, web]] of Object.entries(want)) {
      const e = j.get(cell)!;
      expect([cell, e.pv.end_state, e.parse.kind, e.pv.attempts.map((a: { reason: string | null }) => a.reason), e.pv.web]).toEqual([cell, end, parse, reasons, web]);
      expect(e.pv.parser_sha256).toBe(PV_PARSER_SHA256);
      expect(e.pv.reason).toBe(end === "missing" ? "API error" : null);
      expect(e.pv.usd).toBe(0);
      expect(Object.keys(e).filter((k) => /parse/i.test(k))).toEqual(["parse"]);
      expect(e.key.parts.verifier).toBe(sha256(JSON.stringify(PV_PARSER_SHA256 + "+" + CAPPED_PARSER_SHA256 + "+" + READERS_SHA256)));
      expect(existsSync(session(cell.split(" ")[0]!, Number(cell.split(" ")[1])) + "-attempt1")).toBe(reasons.length === 2);
    }
    expect(j.get("plan-ceo-review 2")!.parse.lenient).toEqual(["label", "commas", "array"]);
  });

  test("the session sees plan.md and context/ only; units.json and stops.json record the run", () => {
    run();
    const tree = join(out, "units", task, "tree");
    expect(existsSync(join(tree, "plan.md")) && existsSync(join(tree, "context", "readme.md"))).toBe(true);
    for (const f of ["key.json", "unit.json", "brief.md"]) expect(existsSync(join(tree, f))).toBe(false);
    const units = JSON.parse(readFileSync(join(out, "units.json"), "utf8"));
    expect([units.lens, units.told_sha256, units.parser_sha256, units.pv.family, units.pv.fallback, units.pv.passes, units.pv.units.map((u: { id: string; task: string }) => [u.id, u.task])]).toEqual(["product-value", PV_TEMPLATE_SHA256, PV_PARSER_SHA256, "plan", false, 2, [[UNIT, task]]]);
    expect(JSON.parse(readFileSync(join(out, "stops.json"), "utf8")).stops).toEqual([]);
  });

  test("arm.json counts end states, retries and lenient parses, and lists missing sessions against coverage", () => {
    run();
    const pv = (arm: string) => JSON.parse(readFileSync(join(out, "arms", arm + "-opus", "arm.json"), "utf8")).product_value;
    expect([pv("none").end_states, pv("none").retries, pv("none").missing.length]).toEqual([{ block: 1, "no-block": 0, missing: 0, contaminated: 1, not_run: 0 }, 0, 1]);
    expect(pv("none").missing[0]).toContain("E_PV_WEB_CONTAMINATED: 1 successful web result");
    expect([pv("lens").end_states, pv("lens").retries]).toEqual([{ block: 0, "no-block": 1, missing: 1, contaminated: 0, not_run: 0 }, 1]);
    expect(pv("lens").missing[0]).toContain("E_PV_INFRA_MISSING: API error, then API error");
    expect([pv("plan-ceo-review").end_states.block, pv("plan-ceo-review").retries, pv("plan-ceo-review").lenient, pv("plan-ceo-review").missing]).toEqual([2, 1, 1, []]);
  });

  test("pv rows: one row per planned session with its end state, normalized list, exposure and spend", () => {
    run();
    const file = join(durable(), "rows.jsonl");
    const r = io();
    expect(rows(["--run", out, "--out", file], r.io)).toBe(0);
    expect(r.o.out).toEqual([6 + " rows to " + file + ": block 3, no-block 1, missing 1, contaminated 1"]);
    const got: Row[] = lines(file);
    const by = (arm: string, pass: number) => got.find((x) => x.arm === arm && x.pass === pass)!;
    expect(by("none", 1)).toEqual({ unit: UNIT, family: "plan", arm: "none", model: "opus", pass: 1, end: "block", list: ["Ship the importer before the sync engine", "Add a rollback plan for the nightly job"], words: 15, items: 2, cut: 0, exposed: null, spend_micros: 0, session: session("none", 1) });
    expect([by("none", 2).end, by("none", 2).list, by("lens", 2).end, by("lens", 2).list, by("lens", 2).exposed]).toEqual(["contaminated", null, "missing", null, null]);
    expect(by("lens", 1)).toMatchObject({ end: "no-block", list: null, words: 0, items: 0 });
    expect(by("skill", 1)).toMatchObject({ end: "block", exposed: false, mode: null, proposals: 0, pending: 0 });
    expect(by("skill", 2).list).toEqual(["Cut the admin console", "Keep CSV export"]);
    expect("mode" in by("none", 1)).toBe(false);
  });

  test("pv rows refuses an out inside the repo, a run planned twice and a dir that is not a product-value run", () => {
    run();
    const r = io();
    expect(rows(["--run", out, "--out", join(REPO_ROOT, "rows.jsonl")], r.io)).toBe(2);
    expect(rows(["--run", out, "--run", out, "--out", join(durable(), "rows.jsonl")], r.io)).toBe(2);
    expect(rows(["--run", scratch("not-pv-"), "--out", join(durable(), "rows.jsonl")], r.io)).toBe(2);
    expect(rows(["--out", join(durable(), "rows.jsonl")], r.io)).toBe(2);
    expect(r.o.err.map((l) => l.split(" ")[0])).toEqual(["E_USAGE:", "E_USAGE:", "E_USAGE:", "E_USAGE:"]);
    expect(r.o.err[0]).toContain("inside the repo");
    expect(r.o.err[1]).toContain("planned in both");
    expect(existsSync(join(REPO_ROOT, "rows.jsonl"))).toBe(false);
  });
});

describe("the frozen prompts", () => {
  const post = readFileSync(join(REPO_ROOT, "wiki", "plans", "2026-11-08-geva-403-product-value-prereg", "README.md"), "utf8");
  test("each arm's first line is its section 5 table row byte for byte, and the template is section 6's", () => {
    for (const family of ["plan", "brief"] as const) {
      for (const [arm, spec] of Object.entries(PV_ARMS[family])) {
        if (arm === PV_GATE_ARM) continue;
        expect(post).toContain("| " + arm + ' | "' + spec.line + '" |');
        expect(pvPrompt(family, arm, false)).toBe(spec.line + "\n\n" + PV_TEMPLATE);
      }
    }
    expect(pvArm("plan", PV_GATE_ARM)!.line).toBe(pvArm("plan", "plan-ceo-review")!.line);
    expect(pvArm("plan", "office-hours")).toBeNull();
    expect(post).toContain("> " + PV_TEMPLATE + "\n");
  });

  test("smoke rule 2's sentence goes after the first line of every plan-family arm", () => {
    expect(post).toContain('"' + PV_FALLBACK_SENTENCE + '"');
    for (const arm of ["none", "lens", "plan-ceo-review"]) expect(pvPrompt("plan", arm, true)).toBe(pvArm("plan", arm)!.line + "\n" + PV_FALLBACK_SENTENCE + "\n\n" + PV_TEMPLATE);
  });
});

describe("copyDir, for the gstack state root", () => {
  test("copies regular files and directories, skips symlinks, and copies nothing from a missing dir", () => {
    const from = scratch("pv-copy-from-");
    mkdirSync(join(from, "projects", "slug"), { recursive: true });
    writeFileSync(join(from, "projects", "slug", "u-design-1.md"), "# D\n");
    writeFileSync(join(from, "config.yaml"), "a: 1\n");
    symlinkSync("/etc/hostname", join(from, "projects", "link.md"));
    const to = join(scratch("pv-copy-to-"), "gstack-state");
    expect(copyDir(from, to)).toEqual([]);
    expect([readFileSync(join(to, "projects", "slug", "u-design-1.md"), "utf8"), readFileSync(join(to, "config.yaml"), "utf8"), existsSync(join(to, "projects", "link.md"))]).toEqual(["# D\n", "a: 1\n", false]);
    const none = join(scratch("pv-copy-none-"), "out");
    expect(copyDir(join(from, "absent"), none)).toEqual([]);
    expect(existsSync(none)).toBe(false);
  });
});
