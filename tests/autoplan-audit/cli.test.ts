// Copyright (c) 2026 Garry Tan. MIT License.
// The audit's CLI and stage 1 on a constructed frame: the frame check refuses drift, stage 1 writes only into a new sink
// and prints counts only.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../lanes/autoplan-audit/cli.ts";
import { checkFrame } from "../../lanes/autoplan-audit/frame.ts";
import { at, manifest, preGateSkill, repo, tmp, writeRecord } from "../../lanes/autoplan-audit/fixtures.ts";
import { Matrix } from "../../lanes/autoplan-audit/matrix.ts";
import { openSink, printLines, stage1 } from "../../lanes/autoplan-audit/stage1.ts";

const io = () => {
  const out: string[] = [], err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

function frame() {
  const dir = tmp("frame");
  mkdirSync(join(dir, "records"), { recursive: true });
  const opts = ["Apply the fix: state the retry ceiling as three attempts within fifteen minutes for each call", "Keep your direction"];
  writeRecord(join(dir, "records"), { id: "run-a", plan: "---\nid: 2030-01-01-fixture-post\n---\n# Plan\n", decisions: [{ id: "run-a-d1", options: opts, chosen: "a", answered_at: at(3), owner_reply: "yes" }], run: { gstack_version: "9.1.0.0", created_at: "2000-01-01T00:00:00Z" } });
  writeRecord(join(dir, "records"), { id: "run-b", kind: "full", decisions: [{ id: "run-b-d1", options: opts, chosen: "a", answered_at: at(3), owner_reply: "yes" }], run: { gstack_version: "9.1.0.0" } });
  return { dir, frozen: manifest(dir, ["run-a", "run-b"], { "a/approvals.jsonl": JSON.stringify({ by: "ZZZZ-1", words: "", ask: "run-a gate_rev 1", source: "manual", outcome: "approved" }) + "\n" }) };
}

describe("autoplan audit cli", () => {
  test("help and an unknown command", async () => {
    const a = io();
    expect(await main([], a.io)).toBe(2);
    expect(await main(["nope"], a.io)).toBe(2);
    expect(a.err.join("\n")).toContain("E_USAGE");
  });
  test("the frame check passes on its manifest and refuses a changed file", async () => {
    const f = frame();
    expect(checkFrame(f.dir, f.frozen).ids).toEqual(["run-a", "run-b"]);
    writeFileSync(join(f.dir, "records", "run-a", "restore.md"), "changed\n");
    expect(() => checkFrame(f.dir, f.frozen)).toThrow(/digest/);
    const a = io();
    expect(await main(["frame", "--frame", f.dir], a.io)).toBe(2);
    expect(a.err[0]).toStartWith("E_AR_FRAME_DRIFT");
  });
  test("stage 1 on a constructed frame writes a new sink and prints counts only", () => {
    const f = frame();
    const wiki = repo([{ "wiki/plans/2030-01-01-fixture-post/README.md": "---\nid: 2030-01-01-fixture-post\n---\n# Post\n\nThe retry ceiling is three attempts within fifteen minutes for each call.\n" }]);
    const gs = repo([{ VERSION: "9.1.0.0\n", "autoplan/SKILL.md": preGateSkill() }]);
    const sink = openSink(join(tmp("sink"), "s1"), "stage1");
    expect(() => openSink(sink, "stage1")).toThrow(/already exists/);
    const out = stage1({ frame: f.dir, repo: wiki.dir, commit: wiki.commits[0]!, matrix: new Matrix(gs.dir, gs.commits[0]!), sink, frozenFrame: f.frozen });
    expect(out.counts.records).toBe(2);
    expect(out.counts.units_lean_primary).toBe(1);
    expect(out.counts.mechanical_hits_primary).toBe(1);
    expect(out.gate2.ok).toBe(false);
    for (const name of ["stage1.json", "matched.json", "units.json", "draws.json", "SINK.json"]) expect(existsSync(join(sink, name))).toBe(true);
    const text = printLines(out).join("\n");
    expect(text).not.toContain("retry ceiling");
    expect(text).toContain("AP-X-3 NOT MET BY DESIGN");
  });
});
