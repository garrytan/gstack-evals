// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 rerun prereg section 7: the pilot judge gate. pilotGate's rule on fixture reports, and judge --pilot-gate on a
// fake transport under CSO_PLAN=rerun: one judged row per pilot session with its route, and the gate file.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import "../../lanes/outcome-skills/cso/cli.ts";
import { judgeCmd } from "../../lanes/outcome-skills/cso/cli-judge.ts";
import { pilotGate, type GoldResult, type ReportResult } from "../../lanes/outcome-skills/cso/judge/check.ts";
import type { Transport } from "../../lanes/outcome-skills/cso/judge/client.ts";
import type { CsoModel, SessionRecord, UnitRecord } from "../../lanes/outcome-skills/cso/types.ts";

const dir = mkdtempSync(join(tmpdir(), "cso-rerun-judge-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const g = (named: boolean | null, refused = false): GoldResult => ({ named, validity: [], refused, over_cap: false });
const rep = (id: string, named: boolean | null, gold: [boolean | null, boolean | null], o: { refused?: boolean; goldRefused?: boolean } = {}): ReportResult => ({ id, arm: "cso", model: "opus", anchor: null, production: { named, validity: [], refused: o.refused ?? false }, gold: [g(gold[0], o.goldRefused), g(gold[1])] });
const ten = () => Array.from({ length: 10 }, (_, i) => rep("r" + i, i % 2 === 0, [i % 2 === 0, i % 2 === 0]));

test("the pilot gate passes ten agreeing reports and fails a refusal, a judge gap, a short count or a third gold disagreement", () => {
  expect(pilotGate(ten(), 10)).toMatchObject({ pass: true, disagree: [], no_gold: [], why: [] });
  const two = ten();
  two[0] = rep("r0", true, [false, false]);
  two[1] = rep("r1", false, [true, true]);
  two[2] = rep("r2", true, [true, false]);
  expect(pilotGate(two, 10)).toMatchObject({ pass: true, disagree: ["r0", "r1"], no_gold: ["r2"] });
  const three = [...two.slice(0, 2), rep("r2", true, [false, false]), ...two.slice(3)];
  expect(pilotGate(three, 10)).toMatchObject({ pass: false, why: ["gold disagrees on named in 3, more than 2"] });
  const refused = ten();
  refused[4] = rep("r4", true, [true, true], { goldRefused: true });
  expect(pilotGate(refused, 10)).toMatchObject({ pass: false, refused: ["r4"] });
  const gap = ten();
  gap[5] = rep("r5", null, [true, true]);
  expect(pilotGate(gap, 10)).toMatchObject({ pass: false, judge_gaps: ["r5"] });
  expect(pilotGate(ten().slice(1), 10).why).toEqual(["9 pilot reports, not 10"]);
});

const work = join(dir, "work");
const put = (p: string, t: string) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, t));
const lines = Array.from({ length: 120 }, (_, i) => "line " + (i + 1)).join("\n") + "\n";
const units = ["u1", "u2", "u3", "u4", "u5"];
for (const u of units) {
  const rec: UnitRecord = { schema: "cso-unit.v1", unit: u, position: 1, part: "part1", index: 0, repo: "acme/" + u, ghsa: "GHSA-2222-3333-4444", cves: [], fix_commit: "f".repeat(40), parent: "e".repeat(40), ecosystem: "npm", published: "2026-08-01", month: "2026-08", cwe_ids: ["CWE-22"], cwe_families: ["path-traversal"], fix_files: ["src/parse.js"], hunks: [{ file: "src/parse.js", start: 40, end: 44, insert_only: false, text: "a\nb\nc\nd\ne" }], advisory: { summary: "Path traversal", details: "joins input" }, source_files: 1, kind: "library", known_open: [], tree_sha256: "0".repeat(64) };
  put(join(work, "units", u + ".json"), JSON.stringify(rec));
  put(join(work, "trees", u, "src", "parse.js"), lines);
}
const sess = (unit: string, model: CsoModel): SessionRecord => ({ schema: "cso-session.v1", unit, arm: "cso", model, stage: "rerun-pilot", model_id: "m", harness: "claude-code", harness_version: "x", end: "completed", reason: null, attempts: 1, continuations: 0, done_seen: true, texts: ["src/parse.js:41 joins the request path without normalizing it.\nDONE"], opened: ["src/parse.js"], helper: { snapshot_root: null, handles: {} }, exposure: { loaded: true, procedure_ran: true, run_id: "r", completeness: "complete", findings_submitted: 1, tooling_errors: 0, host_reads_after_start: 0, scope: "daily/default" }, cost_usd: 3, wall_sec: 1, turns: 1, tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 } }) as SessionRecord;
put(join(dir, "sessions.jsonl"), units.flatMap((u) => [sess(u, "opus"), sess(u, "particle")]).map((s) => JSON.stringify(s)).join("\n") + "\n");
const FINDING = { text: "src/parse.js:41 joins the request path without normalizing it", source: "final", citations: [{ path: "src/parse.js", start: 41, end: 41, symbol: null }] };
const lab = { location: "yes", class: "yes", same_defect: "yes", grounding: "yes", file_level: "yes", known: null, validity: "supported", quotes: {} };
const count = (t: string, head: string) => (t.split(head)[1]?.split("\n=== ")[0]?.match(/^Finding \d+:/gm) ?? []).length;
const fake: Transport = async (r) => {
  const t = String(((r.body.messages ?? r.body.input) as { content: string }[])[0]!.content);
  let out: unknown;
  if (!t.includes("You label findings")) out = { findings: t.includes("src/parse.js") ? [FINDING] : [] };
  else if (t.includes("=== Findings to rate for validity ===")) out = { own: Array.from({ length: count(t, "=== Findings to label ===") }, (_, i) => ({ finding: i + 1, ...lab })), pass_a: Array.from({ length: count(t, "=== Findings to rate for validity ===") }, (_, i) => ({ finding: i + 1, validity: "supported" })) };
  else out = { labels: Array.from({ length: count(t, "=== Findings to label ===") }, (_, i) => ({ finding: i + 1, ...lab })) };
  const text = JSON.stringify(out);
  const body = r.provider === "openai" ? { output: [{ type: "message", content: [{ type: "output_text", text }] }] } : r.provider === "anthropic" ? { content: [{ type: "text", text }], stop_reason: "end_turn" } : { choices: [{ message: { content: text }, finish_reason: "stop" }] };
  return { status: 200, body };
};
const quiet = async (f: () => Promise<number>) => {
  const log = console.log, out: string[] = [];
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  try {
    return { code: await f(), out: out.join("\n") };
  } finally {
    console.log = log;
  }
};

test("judge --pilot-gate judges each pilot session once with its route, writes the gate and refuses outside the rerun plan", async () => {
  const argv = (out: string) => ["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--out", out, "--run", "t", "--route", "fallback-opus-particle", "--pilot-gate"];
  await expect(judgeCmd(argv(join(dir, "plain")), { transport: fake })).rejects.toThrow(/^E_USAGE .*CSO_PLAN=rerun/);
  const before = process.env.CSO_PLAN;
  process.env.CSO_PLAN = "rerun";
  try {
    const out = join(dir, "gate");
    const r = await quiet(() => judgeCmd(argv(out), { transport: fake }));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ pass: true, reports: 10 });
    const rows = readFileSync(join(out, "judged.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((x) => [x.unit, x.model, x.route])).toEqual(units.flatMap((u) => [[u, "opus", "fallback-opus-particle"], [u, "particle", "fallback-opus-particle"]]));
    expect(rows.every((x) => Array.isArray(x.judged.findings) && x.judged.findings.length === 1)).toBe(true);
    const gate = JSON.parse(readFileSync(join(out, "pilot-gate.json"), "utf8"));
    expect(gate).toMatchObject({ schema: "cso-rerun-pilot-gate.v1", route: "fallback-opus-particle" });
    expect(gate.reports.every((x: ReportResult) => x.production.named === true && x.gold.every((y) => y.named === true))).toBe(true);
    await expect(judgeCmd(argv(out), { transport: fake })).rejects.toThrow(/already holds a pilot gate run/);
    expect(existsSync(join(out, "pilot-gate.json"))).toBe(true);
  } finally {
    if (before === undefined) delete process.env.CSO_PLAN;
    else process.env.CSO_PLAN = before;
  }
});

test("judged rows carry their route, and a resume on another route into the same out dir is refused", async () => {
  const out = join(dir, "routes");
  const argv = (route: string) => ["--work", work, "--sessions", join(dir, "sessions.jsonl"), "--out", out, "--run", "t", "--route", route];
  expect((await quiet(() => judgeCmd(argv("fallback-opus-particle"), { transport: fake }))).code).toBe(0);
  const rows = readFileSync(join(out, "judged.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(rows.length).toBe(10);
  expect(new Set(rows.map((x) => x.route))).toEqual(new Set(["fallback-opus-particle"]));
  await expect(judgeCmd(argv("production"), { transport: fake })).rejects.toThrow(/^E_USAGE .*10 rows judged on route fallback-opus-particle, not production/);
  expect((await quiet(() => judgeCmd(argv("fallback-opus-particle"), { transport: fake }))).out).toContain("judged 0 sessions");
});

