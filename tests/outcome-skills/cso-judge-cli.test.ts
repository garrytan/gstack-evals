// Copyright (c) 2026 Garry Tan. MIT License.
// The judging commands end to end on a temporary work dir, keyless: judge (passes A and B, --check and --probe) on a fake
// transport, then score, stage0, analyze and readout over the files they wrote.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { COMMANDS } from "../../lanes/outcome-skills/cso/cli.ts";
import { judgeCmd } from "../../lanes/outcome-skills/cso/cli-judge.ts";
import type { Transport } from "../../lanes/outcome-skills/cso/judge/client.ts";
import type { CsoArm, CsoModel, CsoStage, SessionRecord, UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";

const dir = mkdtempSync(join(tmpdir(), "cso-cli-"));
const work = join(dir, "work");
const put = (p: string, t: string) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, t));
const lines = Array.from({ length: 120 }, (_, i) => "line " + (i + 1)).join("\n") + "\n";
const units = ["u1", "u2"];
for (const u of units) {
  const rec: UnitRecord = { schema: "cso-unit.v1", unit: u, position: 1, part: "part1", index: 0, repo: "acme/" + u, ghsa: "GHSA-2222-3333-4444", cves: [], fix_commit: "f".repeat(40), parent: "e".repeat(40), ecosystem: "npm", published: "2026-08-01", month: "2026-08", cwe_ids: ["CWE-22"], cwe_families: ["path-traversal"], fix_files: ["src/parse.js"], hunks: [{ file: "src/parse.js", start: 40, end: 44, insert_only: false, text: "a\nb\nc\nd\ne" }], advisory: { summary: "Path traversal", details: "joins input" }, source_files: 1, kind: "library", known_open: [], tree_sha256: "0".repeat(64) };
  put(join(work, "units", u + ".json"), JSON.stringify(rec));
  put(join(work, "trees", u, "src", "parse.js"), lines);
}
for (const a of ["none", "cso", "untold"]) put(join(work, "arms", a + ".json"), JSON.stringify({ schema: "cso-arm.v1", arm: a, home: a === "none" ? "none" : "gstack" }));
const cells: [CsoModel, CsoArm][] = [["opus", "none"], ["opus", "cso"], ["opus", "untold"], ["particle", "none"], ["particle", "cso"]];
const sess = (unit: string, model: CsoModel, arm: CsoArm, stage: CsoStage): SessionRecord => ({ schema: "cso-session.v1", unit, arm, model, stage, model_id: "m", harness: "claude-code", harness_version: "x", end: "completed", reason: null, attempts: 1, continuations: 0, done_seen: true, texts: [arm === "none" ? "No issues found.\nDONE" : "src/parse.js:41 joins the request path without normalizing it.\nDONE"], opened: ["src/parse.js"], helper: { snapshot_root: null, handles: {} }, exposure: { loaded: arm !== "none", procedure_ran: arm === "cso", run_id: arm === "cso" ? "r" : null, completeness: "complete", findings_submitted: 1, tooling_errors: 0, host_reads_after_start: 0, scope: arm === "cso" ? "daily/default" : null }, cost_usd: arm === "cso" ? 3 : 1, wall_sec: 1, turns: 1, tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 } });
const sessions = [...units.flatMap((u) => cells.map(([m, a]) => sess(u, m, a, "stage0"))), ...units.flatMap((u) => cells.map(([m, a]) => sess(u, m, a, "stage1")))];
put(join(dir, "sessions.jsonl"), sessions.map((s) => JSON.stringify(s)).join("\n") + "\n");

const FINDING = { text: "src/parse.js:41 joins the request path without normalizing it", source: "final", citations: [{ path: "src/parse.js", start: 41, end: 41, symbol: null }] };
const lab = { location: "yes", class: "yes", same_defect: "yes", grounding: "yes", file_level: "yes", known: null, validity: "supported", quotes: {} };
const count = (t: string, head: string) => (t.split(head)[1]?.split("\n=== ")[0]?.match(/^Finding \d+:/gm) ?? []).length;
const fake: Transport = async (r) => {
  const t = String(((r.body.messages ?? r.body.input) as { content: string }[])[0]!.content);
  let out: unknown;
  if (t.includes("connection check")) out = "OK";
  else if (!t.includes("You label findings")) out = { findings: t.includes("src/parse.js") ? [FINDING] : [] };
  else if (t.includes("=== Findings to rate for validity ===")) out = { own: Array.from({ length: count(t, "=== Findings to label ===") }, (_, i) => ({ finding: i + 1, ...lab })), pass_a: Array.from({ length: count(t, "=== Findings to rate for validity ===") }, (_, i) => ({ finding: i + 1, validity: "supported" })) };
  else out = { labels: Array.from({ length: count(t, "=== Findings to label ===") }, (_, i) => ({ finding: i + 1, ...lab })) };
  const text = typeof out === "string" ? out : JSON.stringify(out);
  const body = r.provider === "openai" ? { output: [{ type: "message", content: [{ type: "output_text", text }] }] } : r.provider === "anthropic" ? { content: [{ type: "text", text }], stop_reason: "end_turn" } : { choices: [{ message: { content: text }, finish_reason: "stop" }] };
  return { status: 200, body };
};
const capture = async (f: () => Promise<number>) => {
  const log = console.log, err = console.error, out: string[] = [];
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = () => {};
  try {
    return { code: await f(), out: out.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
};

describe("cso judging commands", () => {
  test("judge --probe passes every route on a transport that answers", async () => {
    const r = await capture(() => judgeCmd(["--out", join(dir, "probe"), "--run", "t", "--probe"], { transport: fake }));
    expect(r.code).toBe(0);
    expect(r.out.split("\n").filter((l) => l.startsWith("PASS")).length).toBe(6);
  });
  test("judge, then score and stage0 over what it wrote; a rerun judges nothing new", async () => {
    const j = await capture(() => judgeCmd(["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--out", join(dir, "j"), "--run", "t"], { transport: fake }));
    expect([j.code, j.out]).toEqual([0, "judged 20 sessions into " + join(dir, "j", "judged.jsonl")]);
    expect((await capture(() => judgeCmd(["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--out", join(dir, "j"), "--run", "t"], { transport: fake }))).out).toStartWith("judged 0 sessions");
    expect((await capture(() => COMMANDS.score!(["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--judged", join(dir, "j", "judged.jsonl"), "--out", join(dir, "scores.jsonl")]))).out).toBe("scored 20 sessions");
    const scores = readFileSync(join(dir, "scores.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(scores.filter((s) => s.named).length).toBe(12);
    const s0 = await capture(() => COMMANDS.stage0!(["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--scores", join(dir, "scores.jsonl")]));
    expect(s0.code).toBe(0);
    expect(s0.out.split("\n").filter((l) => l.startsWith("PASS")).length).toBe(5);
  });
  test("judge --check writes the route's check file and prints only its release", async () => {
    const r = await capture(() => judgeCmd(["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--out", join(dir, "c"), "--run", "t", "--check"], { transport: fake }));
    expect(r.code).toBe(0);
    const file = JSON.parse(readFileSync(join(dir, "c", "check-production.json"), "utf8"));
    expect(file.reports.length).toBe(24);
    expect(file.reports.filter((x: { anchor: string | null }) => x.anchor).length).toBe(4);
    expect(file.formats.length).toBe(2);
    expect(r.out.split("\n")[0]).not.toMatch(/[0-9]/);
  });
  test("readout seals stage 1 and prints the release; analyze prints rows and verdicts", async () => {
    const keyPath = join(dir, "key");
    writeFileSync(keyPath, "cd".repeat(32));
    chmodSync(keyPath, 0o600);
    put(join(dir, "stage1.json"), JSON.stringify(units));
    const r = await capture(() => COMMANDS.readout!(["--sessions", join(dir, "sessions.jsonl"), "--scores", join(dir, "scores.jsonl"), "--units", join(dir, "stage1.json"), "--check", join(dir, "c", "check-production.json"), "--key", keyPath, "--sealed", join(dir, "s1.sealed"), "--spent", "100", "--judging-per-session", "0.12", "--vm", "40", "--vm-stage2", "20"]));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).items.length).toBe(6);
    expect(existsSync(join(dir, "s1.sealed"))).toBe(true);
    const a = await capture(() => COMMANDS.analyze!(["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--scores", join(dir, "scores.jsonl"), "--units", join(dir, "stage1.json"), "--check", join(dir, "c", "check-production.json")]));
    expect(JSON.parse(a.out).verdicts.map((v: { step: number }) => v.step)).toEqual([1, 1]);
  });
});
