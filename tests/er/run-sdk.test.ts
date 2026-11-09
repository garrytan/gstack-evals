// Copyright (c) 2026 Garry Tan. MIT License.
// review-units --plan eng-review: the session loop through the real pinned Agent SDK and a stub CLI (er-sdk.ts runs the
// loop in its own process), then er rows over what it wrote.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as rowsRun } from "../../lanes/eng-review/rows.ts";
import type { Row } from "../../lanes/eng-review/types.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { erCellId, erOrder, erPrompt } from "../../src/trial/review/eng-review.ts";
import { readErJournal, readErStops } from "../../src/trial/review/er-run.ts";
import { ARMS, OPUS, UNIT } from "./er-sdk.ts";

const root = mkdtempSync(join(tmpdir(), "er-sdk-test-"));
afterAll(() => removeTree(root));
function launch(name: string, cap: string, parallel: string) {
  const dir = join(root, name);
  mkdirSync(join(dir, "records"), { recursive: true });
  mkdirSync(join(dir, "scratch"), { recursive: true });
  const r = spawnSync(process.execPath, [join(import.meta.dir, "er-sdk.ts"), join(dir, "records"), join(dir, "out"), join(dir, "scratch"), cap, parallel], { encoding: "utf8", timeout: 170_000 });
  const last = r.stdout.trim().split("\n").at(-1) ?? "{}";
  return { out: join(dir, "out"), records: join(dir, "records"), log: r.stderr, result: JSON.parse(last) as { stops: Array<{ code: string }>; most: number; spawned: Record<string, number>; stopped: number } };
}
let main: ReturnType<typeof launch> | null = null;
const ran = () => (main ??= launch("main", "25", "3"));
const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);

describe("the eng-review session loop through the real Agent SDK", () => {
  test("each attempt sends its arm's frozen prompt with web tools denied and the frozen turn cap", () => {
    const { records } = ran();
    for (const arm of ARMS) {
      const rec = lines(join(records, arm + ".ndjson"));
      const prompts = rec.filter((m) => m.type === "user" && typeof m.message?.content === "string").map((m) => m.message.content);
      const first = rec.filter((m) => m.type === "user").map((m) => (typeof m.message.content === "string" ? m.message.content : m.message.content?.[0]?.text));
      expect(first.length).toBeGreaterThan(0);
      expect(new Set([...prompts, ...first.filter(Boolean)])).toEqual(new Set([erPrompt(arm)]));
      const argv = rec.filter((m) => m.argv).map((m) => m.argv.join(" "));
      expect(argv.every((a) => /WebSearch/.test(a) && /WebFetch/.test(a) && /--max-turns=200/.test(a) && /--disallowedTools=WebSearch,WebFetch/.test(a))).toBe(true);
    }
  });
  test("end states after the one retry: an arm stop scores as no-block, a provider error twice is missing, web is contaminated", () => {
    const { out } = ran();
    const by = (arm: string) => [...readErJournal(out).values()].filter((e) => e.cell.arm === arm).sort((a, b) => a.attempts.length - b.attempts.length);
    expect(by("none").map((e) => e.end_state)).toEqual(["block", "block"]);
    expect(by("lens").map((e) => e.end_state).sort()).toEqual(["block", "no-block"]);
    expect(by("lens").find((e) => e.end_state === "block")!.parse).toMatchObject({ kind: "block", lenient: ["label", "commas"] });
    const [web, stop] = by("precut");
    expect(web!.end_state).toBe("contaminated");
    expect(web!.web).toBe(1);
    expect(stop!.end_state).toBe("no-block");
    expect(stop!.arm_stop).toBe(true);
    expect(stop!.attempts.map((a) => a.reason)).toEqual(["turn limit", "turn limit"]);
    expect(stop!.attempts.map((a) => a.dir.split("/").at(-1))).toEqual(["a1", "a2"]);
    const [blocked, missing] = by("candidate");
    expect(missing!.end_state).toBe("missing");
    expect(missing!.attempts.map((a) => a.reason)).toEqual(["API error", "API error"]);
    expect(blocked!.end_state).toBe("block");
    expect(blocked!.decisions).not.toBeNull();
    expect(by("none")[0]!.decisions).toBeNull();
  });
  test("the logs name E_ER_ARM_STOP, E_ER_INFRA_MISSING and E_ER_WEB_CONTAMINATED", () => {
    const { log } = ran();
    expect(log).toMatch(/^E_ER_ARM_STOP precut\//m);
    expect(log).toMatch(/^E_ER_INFRA_MISSING candidate\//m);
    expect(log).toMatch(/^E_ER_WEB_CONTAMINATED precut\//m);
  });
  test("--enforce candidate: the Stop hook blocks twice with its fixed message, then releases", () => {
    const { out, records, log } = ran();
    const hooks = lines(join(records, "candidate.ndjson")).filter((m) => m.hook);
    expect(hooks.map((h) => h.hook)).toEqual(["block", "block", "release"]);
    expect(hooks[0].reason).toMatch(/^Do not stop yet\. The skill's procedure has not shown these required outputs: /);
    const blocked = [...readErJournal(out).values()].find((e) => e.cell.arm === "candidate" && e.end_state === "block")!;
    expect(blocked.enforced).toBe(true);
    expect(blocked.blocks).toBe(2);
    expect(log).toMatch(/a1: the Stop hook blocked 2 stops/);
    expect(lines(join(records, "precut.ndjson")).some((m) => m.hook)).toBe(false);
  });
  test("admission: with --parallel 3 and a $25 cap, at most two $10 attempts are in flight", () => {
    const { result } = ran();
    expect(result.most).toBe(2);
    expect(result.stops).toEqual([]);
    expect(result.spawned).toEqual({ none: 2, lens: 2, precut: 3, candidate: 3 });
  });
  test("a cap that can't hold one attempt's allowance stops before any session, every cell unstarted", () => {
    const capped = launch("capped", "9.99", "1");
    expect(capped.result.stops.map((s) => s.code)).toEqual(["CAP_STOP"]);
    expect(capped.result.spawned).toEqual({});
    expect(readErStops(capped.out).map((s) => s.how)).toEqual(Array(8).fill("unstarted"));
    expect(readErJournal(capped.out).size).toBe(0);
  });
});

describe("er rows", () => {
  const io = () => {
    const o = { out: [] as string[], err: [] as string[] };
    return { o, io: { out: (t: string) => o.out.push(t), err: (t: string) => o.err.push(t) } };
  };
  test("one row per planned session with its end state, normalized lists, exposure and spend", () => {
    const { out } = ran();
    writeFileSync(join(out, "units.json"), JSON.stringify({ lens: "eng-review", er: { enforce: "candidate" }, order: erOrder([UNIT], ARMS, [OPUS], 2).map(erCellId) }));
    const file = join(root, "rows.jsonl");
    const x = io();
    expect(rowsRun(["--run", out, "--out", file], x.io)).toBe(0);
    const rows = lines(file) as Row[];
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.model === "opus" && r.unit === UNIT)).toBe(true);
    const none = rows.filter((r) => r.arm === "none");
    expect(none.map((r) => r.end)).toEqual(["block", "block"]);
    expect(none[0]!.paths).toEqual(["app/export.py export_ledger", "app/cli.py main"]);
    expect(none[0]!.checks).toEqual(["Unit test that export_ledger writes an empty file when the ledger has no rows"]);
    expect(none.every((r) => r.exposed === null && r.enforced === false)).toBe(true);
    const stop = rows.find((r) => r.arm === "precut" && r.arm_stop)!;
    expect(stop.end).toBe("no-block");
    expect(stop.exposed).toBe(false);
    expect(rows.find((r) => r.arm === "precut" && r.end === "contaminated")!.exposed).toBeNull();
    const cand = rows.filter((r) => r.arm === "candidate");
    expect(cand.find((r) => r.end === "missing")!.exposed).toBeNull();
    expect(cand.find((r) => r.end === "block")).toMatchObject({ exposed: false, enforced: true, blocks: 2 });
    expect(rows.every((r) => typeof r.spend_micros === "number")).toBe(true);
  });
  test("refuses an out inside the repo, a session planned twice and a dir that is not an eng-review run", () => {
    const { out } = ran();
    const x = io();
    expect(rowsRun(["--run", out, "--out", join(import.meta.dir, "rows.jsonl")], x.io)).toBe(2);
    expect(x.o.err.join("\n")).toMatch(/inside the repo/);
    expect(rowsRun(["--run", out, "--run", out, "--out", join(root, "twice.jsonl")], x.io)).toBe(2);
    expect(x.o.err.join("\n")).toMatch(/planned in both/);
    expect(rowsRun(["--run", root, "--out", join(root, "none.jsonl")], x.io)).toBe(2);
    expect(x.o.err.join("\n")).toMatch(/no units.json/);
  });
});
