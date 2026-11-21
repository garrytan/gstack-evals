// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 15's export (cso/export.ts) on a planted run dir, keyless: stage 0 items copied byte for byte, items already
// sealed copied as they are, plain stage 1 and re-pilot items sealed on the way, scored texts from both kinds of session
// record, unit trees left out and a sha256 manifest of every file. It refuses without the key when the run holds stage 1
// material, and refuses a run that holds the key, an existing out dir and a key under the run, writing nothing.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { exportCmd } from "../../lanes/outcome-skills/cso/export.ts";
import { isSealedRow, openBytes, openRow, readKey, sealBytes, sealRow } from "../../lanes/outcome-skills/cso/analysis/readout.ts";
import type { SessionRecord } from "../../lanes/outcome-skills/cso/types.ts";

const root = mkdtempSync(join(tmpdir(), "cso-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (p: string, t: string | Buffer) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, t));
const keyPath = join(root, "readout.key");
writeFileSync(keyPath, "ef".repeat(32));
chmodSync(keyPath, 0o600);
const key = readKey(keyPath);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const capture = async (f: () => Promise<number>) => {
  const log = console.log, out: string[] = [];
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  try {
    return { code: await f(), out: out.join("\n") };
  } finally {
    console.log = log;
  }
};
const sess = (stage: "stage0" | "stage1", text: string): SessionRecord => ({ schema: "cso-session.v1", unit: "u1", arm: "cso", model: "opus", stage, model_id: "m", harness: "claude-code", harness_version: "x", end: "completed", reason: null, attempts: 1, continuations: 0, done_seen: true, texts: [text + " src/a.js:1 joins the path.\nDONE"], opened: [], helper: { snapshot_root: null, handles: {} }, exposure: { loaded: true, procedure_ran: true, run_id: "r", completeness: "complete", findings_submitted: 1, tooling_errors: 0, host_reads_after_start: 0, scope: "daily/default" }, cost_usd: 3, wall_sec: 1, turns: 1, tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0 } }) as SessionRecord;

function plant(): string {
  const run = mkdtempSync(join(root, "run-"));
  put(join(run, "sessions/stage0/u1/cso-opus-0/session.json"), JSON.stringify(sess("stage0", "S0-REPORT"), null, 1) + "\n");
  put(join(run, "sessions/stage0/u1/cso-opus-0/sdk-messages.jsonl"), "{\"t\":\"S0-TRANSCRIPT\"}\n");
  put(join(run, "sessions/stage1/u1/cso-opus-1/session.json"), sealRow(sess("stage1", "S1-REPORT"), key) + "\n");
  put(join(run, "sessions/stage1/u1/cso-opus-1/sdk-messages.jsonl.sealed"), sealBytes(Buffer.from("{\"t\":\"S1-TRANSCRIPT\"}\n"), key));
  put(join(run, "judge/judged.jsonl"), JSON.stringify({ unit: "u1", stage: "stage0", judged: "S0-JUDGED" }) + "\n" + sealRow({ unit: "u1", stage: "stage1", judged: "S1-JUDGED" }, key) + "\n");
  put(join(run, "judge/requests/a.json"), JSON.stringify({ model: "x", messages: [{ content: "S0-PACKET" }] }));
  put(join(run, "judge/replies/b.json"), sealRow({ content: "S1-REPLY" }, key));
  put(join(run, "scores.jsonl"), JSON.stringify({ unit: "u1", stage: "stage0", named: true }) + "\n" + sealRow({ unit: "u1", stage: "stage1", named: true }, key) + "\n");
  put(join(run, "ledger/ledger.sqlite"), Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(64, 7)]));
  put(join(run, "logs/stage0-judge.log"), "S0-LOG judged 10 sessions\n");
  put(join(run, "logs/stage1-judge.log"), "S1-LOG judged 10 sessions\n");
  put(join(run, "logs/repilot/rerun.log"), "S1-REPILOT-LOG rerun done\n");
  put(join(run, "notes/sessions.jsonl"), JSON.stringify({ unit: "u1", stage: "stage1", texts: ["S1-STRAY"] }) + "\n");
  put(join(run, "trees/u1/index.js"), "TREE\n");
  return run;
}

describe("cso export", () => {
  test("copies stage 0 as it is, keeps sealed items sealed, seals plain stage 1 items, writes scored texts and a manifest", async () => {
    const run = plant(), out = join(root, "out1");
    const r = await capture(() => exportCmd(["--run", run, "--out", out, "--key", keyPath]));
    expect(r.code).toBe(0);
    const got = walk(out).map((f) => relative(out, f)).sort();
    const manifest = readFileSync(join(out, "MANIFEST.sha256"), "utf8").trim().split("\n").map((l) => l.split("  ") as [string, string]);
    expect(manifest.map(([, f]) => f).sort()).toEqual(got.filter((f) => f !== "MANIFEST.sha256"));
    for (const [sha, f] of manifest) expect(createHash("sha256").update(readFileSync(join(out, f))).digest("hex")).toBe(sha);
    expect(r.out).toBe("exported " + manifest.length + " files to " + out + "; MANIFEST.sha256 sha256 " + createHash("sha256").update(readFileSync(join(out, "MANIFEST.sha256"))).digest("hex"));
    expect(got.some((f) => f.startsWith("trees"))).toBe(false);
    for (const f of ["sessions/stage0/u1/cso-opus-0/session.json", "sessions/stage0/u1/cso-opus-0/sdk-messages.jsonl", "sessions/stage1/u1/cso-opus-1/session.json", "sessions/stage1/u1/cso-opus-1/sdk-messages.jsonl.sealed", "judge/judged.jsonl", "judge/requests/a.json", "judge/replies/b.json", "scores.jsonl", "ledger/ledger.sqlite", "logs/stage0-judge.log"]) expect([f, readFileSync(join(out, f)).equals(readFileSync(join(run, f)))]).toEqual([f, true]);
    for (const f of ["logs/stage1-judge.log", "logs/repilot/rerun.log", "notes/sessions.jsonl"]) {
      expect(existsSync(join(out, f))).toBe(false);
      expect(openBytes(readFileSync(join(out, f + ".sealed"), "utf8"), key, f).equals(readFileSync(join(run, f)))).toBe(true);
    }
    const texts = readFileSync(join(out, "scored-texts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(texts.filter((x) => !isSealedRow(x)).map((x) => [x.stage, x.session, x.scored.text.includes("S0-REPORT")])).toEqual([["stage0", "sessions/stage0/u1/cso-opus-0", true]]);
    const sealed = texts.filter(isSealedRow).map((x) => openRow<{ stage: string; scored: { text: string } }>(x, key, "t"));
    expect(sealed.map((x) => [x.stage, x.scored.text.includes("S1-REPORT")])).toEqual([["stage1", true]]);
    for (const f of walk(out)) {
      const t = readFileSync(f, "utf8");
      expect([f, /S1-/.test(t), t.includes(key.toString("hex"))]).toEqual([f, false, false]);
    }
  });
  test("needs --key when the run holds stage 1 material, and writes nothing without it", async () => {
    const run = plant(), out = join(root, "out2");
    await expect(exportCmd(["--run", run, "--out", out])).rejects.toThrow(/^E_USAGE .*pass --key/);
    expect(existsSync(out)).toBe(false);
  });
  test("refuses a run holding the key, an existing out dir and a key under the run", async () => {
    const run = plant();
    put(join(run, "logs/oops.txt"), "key " + "ef".repeat(32) + "\n");
    await expect(exportCmd(["--run", run, "--out", join(root, "out3"), "--key", keyPath])).rejects.toThrow(/^E_CSO_EXPORT logs\/oops.txt holds the readout key/);
    expect(existsSync(join(root, "out3"))).toBe(false);
    const run2 = plant();
    mkdirSync(join(root, "out4"));
    await expect(exportCmd(["--run", run2, "--out", join(root, "out4"), "--key", keyPath])).rejects.toThrow(/^E_CSO_EXPORT .*exists/);
    const inner = join(run2, "k");
    writeFileSync(inner, "ef".repeat(32));
    chmodSync(inner, 0o600);
    await expect(exportCmd(["--run", run2, "--out", join(root, "out5"), "--key", inner])).rejects.toThrow(/^E_CSO_EXPORT the readout key sits under --run/);
    expect(existsSync(join(root, "out5"))).toBe(false);
  });
});
