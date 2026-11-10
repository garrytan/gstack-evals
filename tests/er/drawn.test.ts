// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../lanes/eng-review/cli.ts";
import { run as judge } from "../../lanes/eng-review/judge.ts";
import { run as probe } from "../../lanes/eng-review/probe.ts";
import { isDrawn, type Set_ } from "../../lanes/eng-review/types.ts";
import { fakeUpstream } from "../../lanes/product-value/dryrun.ts";
import { ledgerWith } from "../pv/fixtures.ts";
import { capture, ENV, fakeAnswer, item, keyOf, meta, row, tmp, writeUnits } from "./fixtures.ts";

const jsonOf = (p: string) => JSON.parse(readFileSync(p, "utf8"));

/** u1 to u4 drawn into the set (ranks 1 to 4); u5 carries only the label er author writes, with rank 0. Rows cover all five. */
function fixture(set: Set_) {
  const d = tmp();
  const units = join(d, "units");
  const spec = (i: number, rank: number) => ({ meta: meta("u" + i, { set, rank, repo: "example/r" + (i % 2) }), key: keyOf("u" + i, [item("a" + i), item("t" + i, { kind: "T", sites: undefined })]) });
  writeUnits(units, [...[1, 2, 3, 4].map((i) => spec(i, i)), spec(5, 0)]);
  const rows = join(d, "rows.jsonl");
  const rs = [1, 2, 3, 4, 5].flatMap((i) => (["opus", "sol", "particle"] as const).flatMap((m) => [1, 2].map((p) => row({ unit: "u" + i, session: "u" + i + m + p, model: m, pass: p, checks: ["Unit test in src/import.ts readRows for tag-a" + i, "A CI job on Windows"] }))));
  writeFileSync(rows, rs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { d, units, rows, c: capture() };
}

describe("only drawn units enter a set (F7)", () => {
  test("isDrawn: a draw wrote the set and a rank of 1 or more", () => {
    expect(isDrawn({ set: "calibration", rank: 1 })).toBe(true);
    expect(isDrawn({ set: "calibration", rank: 2 }, "calibration")).toBe(true);
    expect(isDrawn({ set: "calibration", rank: 1 }, "comparison")).toBe(false);
    expect(isDrawn({ set: "calibration", rank: 0 })).toBe(false);
    expect(isDrawn({ set: "comparison" })).toBe(false);
    expect(isDrawn({ set: "pilot", rank: 3 })).toBe(false);
  });

  test("stage 1, oracle lists: drawn calibration units only", async () => {
    const { d, units, c } = fixture("calibration");
    expect(await main(["oracle", "--units", units, "--out", join(d, "oracle.json")], c.io)).toBe(0);
    expect(Object.keys(jsonOf(join(d, "oracle.json")).units).sort()).toEqual(["u1", "u2", "u3", "u4"]);
  });

  test("stage 1, packets: a rank-0 unit needs no oracle list; a drawn unit without one stops", async () => {
    const { d, units, rows, c } = fixture("calibration");
    const oracle = (ids: string[]) => {
      const f = join(d, "oracle-" + ids.length + ".json");
      writeFileSync(f, JSON.stringify({ version: 1, units: Object.fromEntries(ids.map((u) => [u, { checks: ["Test src/import.ts: tag-a" + u.slice(1)], items: ["a" + u.slice(1)] }])) }));
      return f;
    };
    const build = (o: string, out: string) => main(["packets", "--kind", "label", "--stage", "1", "--units", units, "--rows", rows, "--oracle", o, "--out", join(d, out), "--map", join(d, out + ".json")], c.io);
    expect(await build(oracle(["u1", "u2", "u3", "u4"]), "p4")).toBe(0);
    expect(await build(oracle(["u1", "u2", "u3"]), "p3")).toBe(2);
  });

  test("stage 1, recognition probe: drawn calibration units only", async () => {
    const { d, units, c } = fixture("calibration");
    const { record, ledger } = ledgerWith(d, ["er-probe"]);
    const reply = fakeUpstream(() => JSON.stringify({ changes: ["The importer was fixed."] }));
    expect(await probe(["ask", "--units", units, "--item", "er-probe", "--run-id", "p", "--out", join(d, "replies.json"), "--cache", join(d, "pc"), "--run", join(d, "pr"), "--record", record, "--ledger", ledger], c.io, { fetch: reply, env: ENV })).toBe(0);
    expect(Object.keys(jsonOf(join(d, "replies.json")).units).sort()).toEqual(["u1", "u2", "u3", "u4"]);
  });

  test("stage 1 and stage 2 readings key drawn units only", async () => {
    const { d, units, rows, c } = fixture("calibration");
    const { record, ledger } = ledgerWith(d, ["er-s1-labels", "er-s1-check"]);
    const o = { version: 1, units: Object.fromEntries([1, 2, 3, 4, 5].map((i) => ["u" + i, { checks: ["Test src/import.ts: tag-a" + i], items: ["a" + i] }])) };
    writeFileSync(join(d, "oracle.json"), JSON.stringify(o));
    for (const kind of ["label", "check"]) expect(await main(["packets", "--kind", kind, "--stage", "1", "--units", units, "--rows", rows, "--oracle", join(d, "oracle.json"), "--out", join(d, kind + "p"), "--map", join(d, kind + "map.json")], c.io)).toBe(0);
    const up = fakeUpstream((_, p) => fakeAnswer(p));
    expect(await judge(["--packets", join(d, "labelp"), "--map", join(d, "labelmap.json"), "--item", "er-s1-labels", "--run-id", "l", "--out", join(d, "lj"), "--cache", join(d, "lc"), "--record", record, "--ledger", ledger], c.io, { fetch: up, env: ENV })).toBe(0);
    expect(await judge(["--packets", join(d, "checkp"), "--map", join(d, "checkmap.json"), "--item", "er-s1-check", "--run-id", "c", "--out", join(d, "cj"), "--cache", join(d, "cc"), "--record", record, "--ledger", ledger], c.io, { fetch: up, env: ENV })).toBe(0);
    expect(await main(["score", "--units", units, "--rows", rows, "--map", join(d, "labelmap.json"), "--labels", join(d, "lj", "labels.ndjson"), "--out", join(d, "scores.json")], c.io)).toBe(0);
    const common = ["--units", units, "--scores", join(d, "scores.json"), "--rows", rows, "--map", join(d, "labelmap.json"), "--labels", join(d, "lj", "labels.ndjson")];
    expect(await main(["readings", "--stage", "1", ...common, "--check-map", join(d, "checkmap.json"), "--check-labels", join(d, "cj", "labels.ndjson"), "--out", join(d, "r1.json")], c.io)).toBe(0);
    for (const i of [1, 2, 3, 4, 5]) {
      const f = join(units, "u" + i, "unit.json");
      writeFileSync(f, JSON.stringify({ ...jsonOf(f), set: "comparison" }));
    }
    expect(await main(["readings", "--stage", "2", ...common, "--stage1", join(d, "r1.json"), "--out", join(d, "r2.json")], c.io)).toBe(0);
    expect([jsonOf(join(d, "r1.json")).leak.opus.units, jsonOf(join(d, "r2.json")).leak.opus.units]).toEqual([4, 4]);
  }, 120_000);
});
