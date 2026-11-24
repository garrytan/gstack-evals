// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 rerun-analyze's input refusals: a new cso arm read from one rerun stage that covers every cell of --units, a
// session that lost its helper records, and a judge check under the rerun's gold floor. No key file but the test's own.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS } from "../../lanes/outcome-skills/cso/cli.ts";
import { sealCheck } from "../../lanes/outcome-skills/cso/analysis/readout.ts";

const dir = mkdtempSync(join(tmpdir(), "cso-rerun-analyze-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const work = join(dir, "work");
mkdirSync(join(work, "units"), { recursive: true });
for (const u of ["u0", "u1"]) writeFileSync(join(work, "units", u + ".json"), JSON.stringify({ unit: u, repo: "r", part: "part1", kind: "library", source_files: 10, published: "2026-08-01", ecosystem: "npm" }));
writeFileSync(join(dir, "units.json"), JSON.stringify(["u0", "u1"]));
writeFileSync(join(dir, "empty.jsonl"), "");
mkdirSync(join(dir, "old"));
const ses = (unit: string, model: string, stage: string) => JSON.stringify({ unit, arm: "cso", model, stage, end: "completed", exposure: { loaded: true, procedure_ran: true } });
const write = (name: string, rows: string[]) => {
  writeFileSync(join(dir, name), rows.join("\n") + "\n");
  return join(dir, name);
};
const run = (sessions: string, newDir: string, extra: string[] = ["--print-check"]) =>
  COMMANDS["rerun-analyze"]!(["--work", work, "--units", join(dir, "units.json"), "--old-dir", join(dir, "old"), "--old-scores", join(dir, "empty.jsonl"), "--sessions", sessions, "--scores", join(dir, "empty.jsonl"), "--new-dir", newDir, ...extra]);
const all = (stage: string) => ["u0", "u1"].flatMap((u) => ["opus", "particle"].map((m) => ses(u, m, stage)));

test("rerun-analyze refuses new sessions from another stage, from two stages, or missing a cell of --units", async () => {
  const before = process.env.CSO_PLAN;
  process.env.CSO_PLAN = "rerun";
  try {
    const empty = join(dir, "none");
    await expect(run(write("s2.jsonl", all("stage2")), empty)).rejects.toThrow(/^E_USAGE .*one of rerun or rerun-pilot/);
    await expect(run(write("mixed.jsonl", [...all("rerun").slice(1), ses("u0", "opus", "rerun-pilot")]), empty)).rejects.toThrow(/^E_USAGE .*one of rerun or rerun-pilot/);
    await expect(run(write("short.jsonl", all("rerun").slice(1)), empty)).rejects.toThrow(/^E_USAGE .*no new cso session for 1 cells of --units, first u0 opus/);
  } finally {
    if (before === undefined) delete process.env.CSO_PLAN;
    else process.env.CSO_PLAN = before;
  }
});

test("rerun-analyze refuses a session whose helper records were lost", async () => {
  const before = process.env.CSO_PLAN;
  process.env.CSO_PLAN = "rerun";
  try {
    const nd = join(dir, "lost");
    mkdirSync(join(nd, "u1", "cso-particle-0"), { recursive: true });
    writeFileSync(join(nd, "u1", "cso-particle-0", "h2h-summary.json"), JSON.stringify({ cso_records: { files: [], error: "the tar is over the 8388608-byte cap" } }));
    await expect(run(write("ok.jsonl", all("rerun")), nd)).rejects.toThrow(/^E_USAGE u1\/cso-particle-0 lost its helper records/);
  } finally {
    if (before === undefined) delete process.env.CSO_PLAN;
    else process.env.CSO_PLAN = before;
  }
});

test("rerun-analyze refuses a judge check under the rerun's 100-gold floor, such as the parent's", async () => {
  const before = process.env.CSO_PLAN;
  process.env.CSO_PLAN = "rerun";
  try {
    const keyFile = join(dir, "readout.key");
    writeFileSync(keyFile, "ab".repeat(32));
    chmodSync(keyFile, 0o600);
    const k = Buffer.from("ab".repeat(32), "hex");
    const f = join(dir, "parent.sealed");
    sealCheck({ schema: "cso-judge-check.v1", check: { route: "fallback-opus-particle", detail: { gold_reports: 85 } } as never, reports: [], formats: [], fill: null }, k, f);
    await expect(run(write("ok2.jsonl", all("rerun")), join(dir, "none"), ["--check", f, "--key", keyFile])).rejects.toThrow(/^E_USAGE .*85 gold reports, under the rerun's floor of 100/);
  } finally {
    if (before === undefined) delete process.env.CSO_PLAN;
    else process.env.CSO_PLAN = before;
  }
});
