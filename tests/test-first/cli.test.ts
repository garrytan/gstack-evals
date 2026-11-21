// Copyright (c) 2026 Garry Tan. MIT License.
// B2's command lane (lanes/test-first/cli.ts) and image check record (images.ts): the counter flags L1 never sees, the order
// records the guard reads, the look's refusal until parts 1 to 4 of every item are in, and the image record both ways.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookRows, main, readOrder, stripCounter } from "../../lanes/test-first/cli.ts";
import { imageProblems, imagesRecord, readImagesRecord, writeImagesRecord } from "../../lanes/test-first/images.ts";
import { drawnTasks, HOSTS } from "../../lanes/test-first/pins.ts";
import { table } from "./fixtures/rows.ts";

const dir = mkdtempSync(join(tmpdir(), "b2-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("counter flags", () => {
  test("are taken out of argv before L1 sees it", () => {
    expect(stripCounter(["launch", "w", "--counter-usd", "12.5", "--part", "b2-1", "--counter-as-of", "t"])).toEqual({ argv: ["launch", "w", "--part", "b2-1"], usd: "12.5", as_of: "t" });
  });
  test("a guarded launch with no counter is refused before L1 runs", async () => {
    const work = join(dir, "work"), led = join(dir, "ledgers");
    mkdirSync(work, { recursive: true }); mkdirSync(led, { recursive: true });
    writeFileSync(join(work, "plan.json"), JSON.stringify({ item: "b2-opus", parts: [] }));
    process.env.B2_LEDGERS = led;
    expect(await main(["launch", work, "--part", "b2-1"])).toBe(2);
    delete process.env.B2_LEDGERS;
  });
});

describe("order records", () => {
  test("the look and image records are read from B2_LOOK and B2_IMAGES; no file reads as none", () => {
    const look = join(dir, "look.json");
    writeFileSync(look, JSON.stringify({ z: 1.2, bound: 2.917, decision: "continue" }));
    expect(readOrder({}, { B2_LOOK: look })).toEqual({ pilotDone: false, images: null, look: { decision: "continue", z: 1.2 } });
    expect(readOrder({}, {}).look).toBeNull();
  });
});

describe("the look's inputs", () => {
  const half = ["t0", "t1", "t2"];
  test("refused while a model, arm and task on the half has no row", () => {
    const rows = table(3, () => ({})).filter((r) => !(r.label === "cx-line" && r.task === "t2"));
    expect(() => lookRows(rows, half)).toThrow("E_B2_LOOK");
  });
  test("reads only the half's tasks once every row is in", () => {
    expect(lookRows(table(5, () => ({})), half).length).toBe(3 * 4 * 3);
  });
});

describe("image check record", () => {
  const run = drawnTasks().run;
  const shard = (name: string, rows: object[]) => { const d = join(dir, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "images.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); return d; };
  const pass = (t: string) => ({ task: t, pass: true, image: "sha256:x", version: "codex-cli " + HOSTS.codex.version });
  test("a row needs the pinned Codex version", () => {
    expect(imageProblems({ task: "t", version: "codex-cli " + HOSTS.codex.version })).toEqual([]);
    expect(imageProblems({ task: "t", version: "codex-cli 0.171.0" })[0]).toContain("not");
  });
  test("ok only when every run task passes, across shards, the last row of a task winning", () => {
    const a = shard("a", run.slice(0, 100).map(pass)), b = shard("b", [{ task: run[100], pass: false, error: "build failed: x" }, ...run.slice(100).map(pass)]);
    const r = imagesRecord([a, b], run);
    expect([r.ok, r.passed, r.tasks]).toEqual([true, run.length, run.length]);
    const f = join(dir, "images.json");
    writeImagesRecord(f, r);
    expect(readImagesRecord(f)!.ok).toBe(true);
  });
  test("a missing or failed task is not ok, nor a record on another task setup", () => {
    const a = shard("c", [...run.slice(0, 182).map(pass)]);
    const r = imagesRecord([a], run);
    expect(r.ok).toBe(false);
    expect(r.why).toContain("1 run tasks have no row");
    const c = shard("d", [...run.slice(0, 182).map(pass), { task: run[182], pass: false, error: "build failed: y" }]);
    expect(imagesRecord([c], run).why).toContain("build failed: y");
    const f = join(dir, "other.json");
    writeImagesRecord(f, { ...imagesRecord([shard("e", run.map(pass))], run), task_setup_sha256: "0".repeat(64) });
    expect(readImagesRecord(f)!.ok).toBe(false);
    expect(readImagesRecord(join(dir, "nothing.json"))).toBeNull();
  });
});
