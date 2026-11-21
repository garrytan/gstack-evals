// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contain } from "../../lanes/outcome-skills/statemachines/contain.ts";
import type { Candidate } from "../../lanes/outcome-skills/statemachines/source.ts";
import type { Gate } from "../../lanes/outcome-skills/h2h/ordinary/draw.ts";
import type { LicenceRead } from "../../lanes/outcome-skills/h2h/ordinary/frame.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { readSuUnits } from "../../lanes/outcome-skills/h2h/ext/units.ts";
import { basePools, cappedRows, drawLines, L_FRAME_PATH, L_ORDER_PATH, lOrder, lPlan, readLFrame, readLOrder, walkL, type LUnit, type Pool } from "../../lanes/outcome-skills/h2h/ext/lframe.ts";
import { containReading, L_GATES, lGates, type LGateInputs } from "../../lanes/outcome-skills/h2h/ext/lgates.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BASE = join(ROOT, "wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg");
const base = readPrereg();
const x = readExtPrereg();

describe("part L's frame and order", () => {
  const frame = readLFrame();
  test("pool 2 replays the base walk's cap to its recorded 56 rows, and pool 3 is the pool's 110 tasks of 2026-03 to 2026-05", () => {
    const order: string[] = JSON.parse(readFileSync(join(BASE, "o-order.json"), "utf8")).order;
    const of = new Map((JSON.parse(readFileSync(join(BASE, "o-frame.json"), "utf8")).units as { id: string; repo: string; entry: "bug" | "feature" }[]).map((u) => [u.id, u]));
    const placed = new Map(readSuUnits().units.filter((u) => u.kind === "O").map((u) => [u.id, u.position] as [string, number]));
    placed.set("cc65__cc65-2761", 123);
    placed.set("OpenAPITools__openapi-generator-21579", 132);
    const reserves = frame.units.filter((u) => u.pool === 1 && u.source.includes("custody log")).map((u) => u.id);
    const bp = basePools({ order, frame: of, placed, reserves, drops: new Set(), usable: 132, reservePositions: [112, 113, 114, 115, 116, 117, 118, 119, 121, 122], passedPositions: [124, 125, 126, 127, 128, 129, 130, 131], cap: 3, capped: 56 });
    expect(bp.pool2.sort()).toEqual(frame.units.filter((u) => u.pool === 2).map((u) => u.id).sort());
    expect(bp.pool1Missing.map((w) => [w.role, w.need])).toEqual([["reserve", 4], ["reserve", 1], ["passed_unassigned", 8]]);
    expect(frame.pools[1].missing!.map((w) => [w.role, w.from_index, w.to_index, w.positions, w.need, w.candidates.length])).toEqual([
      ["reserve", 490, 498, [112, 113], 1, 7], ["reserve", 508, 523, [115, 116, 117, 118], 3, 12], ["reserve", 538, 543, [122], 1, 4],
      ["passed_unassigned", 548, 553, [124, 125], 2, 5], ["passed_unassigned", 561, 565, [126, 127], 2, 4], ["passed_unassigned", 567, 568, [129], 1, 2], ["passed_unassigned", 572, 588, [130, 131], 2, 12],
    ]);
    expect(frame.units.filter((u) => u.pool === 1 && !u.source.includes("custody log")).map((u) => [u.id, u.source.includes("walk log") && u.source.includes("position 128")])).toEqual([["apache__lucene-14932", true]]);
    expect(Object.keys(frame.sources).some((k) => k.startsWith("walk-logs MANIFEST.sha256"))).toBe(true);
    expect(frame.pools[2]).toMatchObject({ expected: 56, recovered: 56, complete: true });
    expect(frame.pools[3]).toMatchObject({ expected: 110, recovered: 110, complete: true });
    expect(frame.units.filter((u) => u.pool === 3 && u.reused?.verdict === "kept").length).toBe(24);
    expect(frame.units.filter((u) => u.pool === 3 && u.reused).length).toBe(29);
    const counted = new Set(readSuUnits().units.filter((u) => u.kind === "O" && u.stage === "stage2").map((u) => u.id));
    expect(frame.units.some((u) => counted.has(u.id))).toBe(false);
  });

  test("pool 1 is incomplete, so the committed order is provisional and a walk refuses it", () => {
    expect(frame.pools[1]).toMatchObject({ expected: 18, recovered: 6, complete: false });
    expect(frame.complete).toBe(false);
    const order = JSON.parse(readFileSync(L_ORDER_PATH, "utf8"));
    expect(order).toEqual(lOrder(frame, readFileSync(L_FRAME_PATH, "utf8")));
    expect(order.draw_seed).toBe(x.draw_seed);
    expect(order.months[0] > order.months[order.months.length - 1]).toBe(true);
    expect(() => readLOrder()).toThrow(/^E_H2HX_UNITS_POOL.*pool 1: 6 of 18/);
  });

  test("a complete frame's order reads, and an order that is not the frame's refuses", () => {
    const d = mkdtempSync(join(tmpdir(), "h2hx-l-"));
    const f = { ...frame, complete: true, pools: { ...frame.pools, 1: { ...frame.pools[1], complete: true } } };
    const text = JSON.stringify(f);
    writeFileSync(join(d, "f.json"), text);
    writeFileSync(join(d, "o.json"), JSON.stringify(lOrder(f, text)));
    expect(readLOrder(join(d, "f.json"), join(d, "o.json")).order.order.length).toBe(172);
    writeFileSync(join(d, "o.json"), JSON.stringify({ ...lOrder(f, text), order: [...lOrder(f, text).order].reverse() }));
    expect(() => readLOrder(join(d, "f.json"), join(d, "o.json"))).toThrow(/^E_H2HX_UNITS_INPUT/);
  });
});

describe("basePools and cappedRows on a planted walk", () => {
  const order = ["a1", "a2", "b1", "a3", "a4", "c1", "b2", "d1", "c2", "e1"];
  const frame = new Map(order.map((id) => [id, { repo: id[0]!, entry: (id === "c2" ? "feature" : "bug") as "bug" | "feature" }]));
  test("a row is capped once its repository holds 3 drawn units earlier in the order, and passed-unassigned units never count", () => {
    expect(cappedRows(order, (id) => id[0]!, new Set(["a1", "a2", "a3"]), 3, "e1")).toEqual(["a4"]);
    expect(cappedRows(order, (id) => id[0]!, new Set(["a1", "a2"]), 3, "e1")).toEqual([]);
    expect(cappedRows(order, (id) => id[0]!, new Set(["a1", "a2", "a3"]), 3, "a3")).toEqual([]);
  });
  test("finds the missing reserve and passed windows, and refuses a cap count the replay does not give", () => {
    const placed = new Map([["a1", 1], ["a2", 2], ["a3", 4], ["e1", 7]]);
    const r = { order, frame, placed, reserves: ["b1"], drops: new Set(["c1"]), usable: 7, reservePositions: [3, 5], passedPositions: [6], cap: 3, capped: 1 };
    const bp = basePools(r);
    expect(bp.pool2).toEqual(["a4"]);
    expect(bp.pool1Missing).toEqual([{ from_index: 4, to_index: 8, positions: [5], role: "reserve", need: 1, candidates: ["b2", "d1", "c2"] }, { from_index: 4, to_index: 8, positions: [6], role: "passed_unassigned", need: 1, candidates: ["b2", "d1"] }]);
    expect(() => basePools({ ...r, capped: 2 })).toThrow(/^E_H2HX_UNITS_INPUT.*recorded 2/);
    expect(() => basePools({ ...r, placed: new Map([["a2", 1], ["a1", 2], ["a3", 4], ["e1", 7]]) })).toThrow(/^E_H2HX_UNITS_INPUT.*does not follow/);
    expect(() => basePools({ ...r, reserves: ["b1", "b2", "d1"] })).toThrow(/^E_H2HX_UNITS_INPUT.*named reserves/);
  });
  test("the walk log's draw lines fix a window's units where the usable delta equals its candidates, narrow the rest, and refuse counts that do not fit", () => {
    const line = (at: string, usable: number, dropped: number, capped: number, waits?: string) => at + " draw exit " + (waits ? 2 : 0) + ": O: usable " + usable + ", stage 1 0, stage 2 0, reserves 0, stage 0 0, dropped " + dropped + ", capped " + capped + (waits ? " | E_H2H_DRAW_PENDING O waits on " + waits + " at gate oracle (no oracle result)" : "");
    const log = (t3: [number, number], t4: [number, number]) => drawLines(["converted 10 units", line("t1", 3, 0, 0, "a3"), line("t2", 4, 1, 1, "b2"), line("t3", t3[0], t3[1], 1, "d1"), line("t4", t4[0], t4[1], 1, "e1"), line("t5", 7, 2, 1), line("t6 WALK_DONE", 7, 2, 1)].join("\n"));
    expect(log([5, 1], [6, 2]).map((d) => [d.at, d.usable, d.dropped, d.capped, d.waits])).toEqual([["t1", 3, 0, 0, "a3"], ["t2", 4, 1, 1, "b2"], ["t3", 5, 1, 1, "d1"], ["t4", 6, 2, 1, "e1"], ["t5", 7, 2, 1, null], ["t6", 7, 2, 1, null]]);
    const r = { order, frame, placed: new Map([["a1", 1], ["a2", 2], ["a3", 4], ["e1", 7]]), reserves: ["b1"], drops: new Set(["c1"]), usable: 7, reservePositions: [3, 5], passedPositions: [6], cap: 3, capped: 1 };
    const fixed = basePools({ ...r, draws: log([5, 1], [6, 2]) });
    expect(fixed.pool1).toEqual(["b1", "b2", "d1"]);
    expect(fixed.pool1Logged.map((u) => [u.id, u.positions, u.evidence])).toEqual([["b2", [5], "o-walk.out line at t3: usable 4 to 5 over o-order.json rows 6 to 6"], ["d1", [6], "o-walk.out line at t4: usable 5 to 6 over o-order.json rows 7 to 8"]]);
    expect(fixed.pool1Missing).toEqual([]);
    const open = basePools({ ...r, draws: log([4, 2], [6, 2]) });
    expect(open.pool1Logged).toEqual([]);
    expect(open.pool1Missing).toEqual([{ from_index: 7, to_index: 8, positions: [5], role: "reserve", need: 1, candidates: ["d1", "c2"] }, { from_index: 7, to_index: 8, positions: [6], role: "passed_unassigned", need: 1, candidates: ["d1"] }]);
    expect(() => basePools({ ...r, draws: log([5, 2], [6, 2]) })).toThrow(/^E_H2HX_UNITS_INPUT.*line at t3 resolves 2 units over order rows 6 to 6/);
    expect(() => basePools({ ...r, draws: log([5, 1], [6, 2]).map((d) => (d.at === "t2" ? { ...d, capped: 0, dropped: 2 } : d)) })).toThrow(/^E_H2HX_UNITS_INPUT.*cap replay puts 1 capped rows in order rows 3 to 5/);
  });
});

const lu = (id: string, pool: Pool, repo = id): LUnit => ({ id, pool, repo, month: "2026-05", language: "python", entry: "bug", licence: "MIT", source: "planted" });
const gate = (drop: Set<string>, wait = new Set<string>()): Gate => ({ name: "planted", check: (id) => (wait.has(id) ? { pending: true, why: "planted" } : drop.has(id) ? { ok: false, code: "E_H2HX_UNITS_ORACLE", reason: "planted" } : { ok: true }) });

describe("walkL, part L's stratified walk", () => {
  const plan = { ...lPlan(x), n: 4, reserve: 2 };
  test("the plan reads prereg.json: 4 and 2 pilot units, 100 counted, 5 reserves, a cap of 3 and 60 at least", () => {
    expect(lPlan(x)).toEqual({ pilot12: 4, pilot3: 2, n: 100, reserve: 5, repoCap: 3, minCounted: 60 });
  });
  test("fills the pilot from pools 1 and 2 and from pool 3, then counted units and reserves, skipping drops and capped repositories", () => {
    const order = [lu("p3a", 3), lu("m1", 1, "r"), lu("m2", 2, "r"), lu("bad", 2), lu("m3", 2, "r"), lu("m4", 2, "r"), lu("m5", 1), lu("p3b", 3), lu("p3c", 3), lu("m6", 2), lu("m7", 2), lu("m8", 1), lu("m9", 2), lu("m10", 2), lu("late", 2)];
    const w = walkL(order, [gate(new Set(["bad"]))], plan, 1);
    expect(w.units.map((u) => [u.id, u.role, u.position])).toEqual([["p3a", "pilot", 5], ["m1", "pilot", 1], ["m2", "pilot", 2], ["m3", "pilot", 3], ["m5", "pilot", 4], ["p3b", "pilot", 6], ["p3c", "counted", 1], ["m6", "counted", 2], ["m7", "counted", 3], ["m8", "counted", 4], ["m9", "reserve", 5], ["m10", "reserve", 6]]);
    expect([w.capped, w.drops.map((d) => d.id), w.short, w.counted, w.pending]).toEqual([["m4"], ["bad"], false, 4, null]);
  });
  test("stops at a pending gate, and when the order runs out keeps the reserves at the last positions", () => {
    const order = [lu("a", 1), lu("b", 1), lu("c", 2), lu("d", 2), lu("e", 3), lu("f", 3), lu("g", 2), lu("h", 2), lu("i", 2)];
    expect(walkL(order, [gate(new Set(), new Set(["c"]))], plan, 1).pending).toEqual({ id: "c", gate: "planted", why: "planted" });
    const w = walkL(order, [gate(new Set())], plan, 1);
    expect([w.short, w.counted, w.underpowered]).toEqual([true, 1, true]);
    expect(w.units.filter((u) => u.role !== "pilot").map((u) => [u.id, u.role])).toEqual([["g", "counted"], ["h", "reserve"], ["i", "reserve"]]);
    expect(walkL(order.slice(0, 7), [gate(new Set())], plan, 1).counted).toBe(0);
  });
});

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@e", "-c", "init.defaultBranch=main", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const HIDDEN = "test_hidden_regression_probe";
/** A repository at its base commit with a later commit made and then left behind as plant says. */
const planted = (plant: "clean" | "tag" | "object" | "alternates" | "nested" | "name") => {
  const root = mkdtempSync(join(tmpdir(), "h2hx-contain-"));
  const w = join(root, "w");
  mkdirSync(w);
  git(w, "init", "-q");
  writeFileSync(join(w, "a.py"), "def f():\n    return 1\n");
  git(w, "add", "-A");
  git(w, "commit", "-qm", "base");
  const want = git(w, "rev-parse", "HEAD");
  if (plant === "tag" || plant === "object") {
    writeFileSync(join(w, "test_a.py"), "def " + HIDDEN + "():\n    assert True\n");
    git(w, "add", "-A");
    git(w, "commit", "-qm", "fix");
    if (plant === "tag") git(w, "tag", "v-fix");
    git(w, "reset", "-q", "--hard", want);
    if (plant === "object") git(w, "reflog", "expire", "--expire=now", "--all");
  }
  if (plant === "alternates") {
    const other = join(root, "other");
    mkdirSync(other);
    git(other, "init", "-q", "--bare");
    writeFileSync(join(w, ".git/objects/info/alternates"), join(other, "objects") + "\n");
  }
  if (plant === "nested") {
    const n = join(w, "vendor/up");
    mkdirSync(n, { recursive: true });
    git(n, "init", "-q");
    writeFileSync(join(n, "b.py"), "x = 2\n");
    git(n, "add", "-A");
    git(n, "commit", "-qm", "later");
  }
  if (plant === "name") {
    mkdirSync(join(root, "tmp"));
    writeFileSync(join(root, "tmp/cache.txt"), "ran " + HIDDEN + "\n");
  }
  return containReading(contain({ kind: "host", root, repo: w }, { want, names: [HIDDEN], markers: [] }));
};

describe("lGates, part L's gates on planted known-good and known-bad cases", () => {
  const units = new Map([lu("ml", 1, "good/repo"), lu("rb", 3, "py/ok"), lu("rbgpl", 3, "py/gpl"), lu("rbnone", 3, "py/none"), lu("ex", 3, "garrytan/gstack"), lu("rbshort", 3, "py/ok2"), lu("rbf2p", 3, "py/ok3")].map((u) => [u.id, u]));
  const licences: LicenceRead = { schema: "h2h-o-licences.v1", read_at: "t", query: "q", repos: { "py/ok": { spdx: "MIT", name_with_owner: "py/ok" }, "py/gpl": { spdx: "GPL-3.0", name_with_owner: "py/gpl" }, "py/ok2": { spdx: "MIT", name_with_owner: "py/ok2" }, "py/ok3": { spdx: "Apache-2.0", name_with_owner: "py/ok3" }, "garrytan/gstack": { spdx: "MIT", name_with_owner: "garrytan/gstack" } } };
  const cand = (id: string, f2p: number): Candidate => ({ id, source: "rebench-r3a4", revision: "v", repo: "py/ok", pull_number: "1", created_at: "2026-05-01", month: "2026-05", lang: "python", docker_image: "i", image_digest: "sha256:" + "a".repeat(64), base_commit: "f".repeat(40), f2p, p2p: 3, fix_files: 1, fix_source_files: 1, test_files: 1, tests_share_fix_file: false, feature_screen: true, issue_sha256: "", row_sha256: "" });
  const long = "The parser drops the trailing field when a quoted value holds a comma. ".repeat(4);
  const inputs: LGateInputs = {
    licences,
    candidates: new Map([["rb", cand("rb", 2)], ["rbshort", cand("rbshort", 1)], ["rbf2p", cand("rbf2p", 0)]]),
    rows: new Map([["rb", { problem_statement: long, patch: "" }], ["rbshort", { problem_statement: "too short", patch: "" }]]),
    oracle: { ml: { verdict: "kept", base_runs: 3, fixed_runs: 3, from: "fresh" }, rb: { verdict: "kept", base_runs: 3, fixed_runs: 3, from: "GEVA-520" } },
    contain: { ml: { ok: true, findings: [] }, rb: { ok: true, findings: [] } },
    homes: { ml: { ok: true, findings: [] }, rb: { ok: true, findings: [] } },
  };
  const run = (id: string, i: LGateInputs = inputs) => {
    for (const g of lGates(units, base, i)) {
      const r = g.check(id);
      if ("pending" in r) return g.name + ": pending";
      if (!r.ok) return g.name + ": " + r.code;
    }
    return "ok";
  };
  test("the gates run in the base walk's order", () => {
    expect(lGates(units, base, inputs).map((g) => g.name)).toEqual([...L_GATES]);
  });
  test("a pool 1 or 2 unit and a pool 3 unit with every reading pass", () => {
    expect([run("ml"), run("rb")]).toEqual(["ok", "ok"]);
  });
  test("each gate drops its planted bad case and waits on a missing input", () => {
    expect(run("ex")).toBe("exclusion: E_H2H_O_EXCLUDED");
    expect(run("rbgpl")).toBe("licence: E_H2H_O_NOT_PERMISSIVE");
    expect(run("rbnone")).toBe("licence: pending");
    expect(run("rbf2p")).toBe("harness_screen: E_SM_INELIGIBLE");
    expect(run("rbshort")).toBe("told: E_H2H_O_TOLD");
    expect(run("rb", { ...inputs, oracle: { rb: { verdict: "E_SM_ORACLE_UNSTABLE", base_runs: 3, fixed_runs: 3, from: "fresh" } } })).toBe("oracle: E_H2HX_UNITS_ORACLE");
    expect(run("rb", { ...inputs, oracle: { rb: { verdict: "kept", base_runs: 2, fixed_runs: 3, from: "fresh" } } })).toBe("oracle: E_H2HX_UNITS_ORACLE");
    expect(run("rb", { ...inputs, oracle: {} })).toBe("oracle: pending");
    expect(run("rb", { ...inputs, contain: { rb: { ok: false, findings: ["refs (1)"] } } })).toBe("contain: E_H2HX_UNITS_CONTAIN");
    expect(run("rb", { ...inputs, homes: { rb: { ok: false, findings: ["marker"] } } })).toBe("homes: E_H2HX_UNITS_CONTAIN");
    expect(run("rb", { ...inputs, homes: {} })).toBe("homes: pending");
  });
  test("the object-level check passes a clean base and fails a tag past it, a stray later commit object, alternates, a nested .git and a hidden name outside the repository", () => {
    const readings = Object.fromEntries((["clean", "tag", "object", "alternates", "nested", "name"] as const).map((p) => [p, planted(p)]));
    expect(readings.clean).toEqual({ ok: true, findings: [] });
    expect(readings.tag!.findings.some((x) => x.startsWith("refs"))).toBe(true);
    expect(readings.object!.findings).toContain("objects (1)");
    expect(readings.alternates!.findings.some((f) => f.startsWith("stores"))).toBe(true);
    expect(readings.nested!.findings.some((f) => f.startsWith("stores"))).toBe(true);
    expect(readings.name!.findings).toContain("scan (1)");
    for (const p of ["tag", "object", "alternates", "nested", "name"]) expect(run("rb", { ...inputs, contain: { rb: readings[p]! } })).toBe("contain: E_H2HX_UNITS_CONTAIN");
  });
});
