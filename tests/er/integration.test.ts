// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../lanes/eng-review/cli.ts";
import { fakeUpstream } from "../../lanes/product-value/dryrun.ts";
import { run as generic } from "../../lanes/eng-review/author/generic.ts";
import { run as judge } from "../../lanes/eng-review/judge.ts";
import { run as probe } from "../../lanes/eng-review/probe.ts";
import { ledgerWith } from "../pv/fixtures.ts";
import { capture, ENV, fakeAnswer, item, keyOf, meta, row, tmp, writeUnits } from "./fixtures.ts";

const jsonOf = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("the score side end to end, keyless", () => {
  test("oracle, packets, judge on a fake upstream, score and stage 1 readings", async () => {
    const d = tmp();
    const units = join(d, "units");
    writeUnits(units, [1, 2, 3, 4].map((i) => ({ meta: meta("u" + i, { set: "calibration", repo: "example/r" + (i % 2) }), key: keyOf("u" + i, [item("a" + i), item("t" + i, { kind: "T", sites: undefined })]) })));
    const rows = join(d, "rows.jsonl");
    const rs = [1, 2, 3, 4].flatMap((i) => (["opus", "sol", "particle"] as const).flatMap((m) => [1, 2].map((p) => row({ unit: "u" + i, session: "u" + i + m + p, model: m, pass: p, checks: ["Unit test in src/import.ts readRows for tag-a" + i, "A CI job on Windows"] }))));
    writeFileSync(rows, rs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const c = capture();
    expect(await main(["oracle", "--units", units, "--out", join(d, "oracle.json")], c.io)).toBe(0);
    expect(jsonOf(join(d, "oracle.json")).units.u1.checks[0]).toBe("Test src/import.ts readRows: The importer failed on tag-a1 (src/import.ts).");
    expect(await main(["packets", "--kind", "label", "--stage", "1", "--units", units, "--rows", rows, "--oracle", join(d, "oracle.json"), "--out", join(d, "lp"), "--map", join(d, "lmap.json")], c.io)).toBe(0);
    expect(await main(["packets", "--kind", "check", "--stage", "1", "--units", units, "--rows", rows, "--oracle", join(d, "oracle.json"), "--out", join(d, "cp"), "--map", join(d, "cmap.json")], c.io)).toBe(0);
    const { record, ledger } = ledgerWith(d, ["er-s1-labels", "er-s1-check"]);
    const up = fakeUpstream((_, p) => fakeAnswer(p));
    expect(await judge(["--packets", join(d, "lp"), "--map", join(d, "lmap.json"), "--item", "er-s1-labels", "--run-id", "l", "--out", join(d, "lj"), "--cache", join(d, "lc"), "--record", record, "--ledger", ledger], c.io, { fetch: up, env: ENV })).toBe(0);
    expect(await judge(["--packets", join(d, "cp"), "--map", join(d, "cmap.json"), "--item", "er-s1-check", "--run-id", "c", "--out", join(d, "cj"), "--cache", join(d, "cc"), "--record", record, "--ledger", ledger], c.io, { fetch: up, env: ENV })).toBe(0);
    const labels = readFileSync(join(d, "lj", "labels.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(labels.every((l: { version: string | null; effort: string; prompt_sha256: string }) => l.version && l.effort === "medium" && l.prompt_sha256.length === 64)).toBe(true);
    expect(labels.some((l: { judge: string }) => l.judge === "panel")).toBe(true);
    expect(await main(["score", "--units", units, "--rows", rows, "--map", join(d, "lmap.json"), "--labels", join(d, "lj", "labels.ndjson"), "--out", join(d, "scores.json")], c.io)).toBe(0);
    const s = jsonOf(join(d, "scores.json"));
    const r = s.reviews.find((x: { session: string }) => x.session === "u1opus1");
    expect([r.A, r.A_B, r.A_T, r.site_checks, r.map_files, r.mix.ci, r.mix.unit]).toEqual([0.5, 1, 0, 1, 1, 1, 1]);
    expect(r.shuffled).toBe(0);
    expect(s.baseline.u1.functions).toBe(1);
    expect(await main(["readings", "--stage", "1", "--units", units, "--scores", join(d, "scores.json"), "--rows", rows, "--map", join(d, "lmap.json"), "--labels", join(d, "lj", "labels.ndjson"), "--check-map", join(d, "cmap.json"), "--check-labels", join(d, "cj", "labels.ndjson"), "--out", join(d, "r1.json")], c.io)).toBe(0);
    const r1 = jsonOf(join(d, "r1.json"));
    expect(r1.admission.reading).toBe("NO READ");
    expect(r1.judges[0].short_anticipated).toBe(true);
    expect(c.err.some((l) => l.startsWith("E_ER_NO_READ"))).toBe(true);
    expect(await main(["packets", "--kind", "label", "--stage", "1", "--units", units, "--rows", rows, "--out", join(process.cwd(), "lanes", "x"), "--map", join(d, "m2.json")], c.io)).toBe(2);
  }, 120_000);

  test("the generic screen writes flags and the primary; the recognition probe asks and tallies", async () => {
    const d = tmp();
    const units = join(d, "units");
    writeUnits(units, [1, 2].map((i) => ({ meta: meta("u" + i, { set: "calibration" }), key: keyOf("u" + i, [item("a" + i), item("g" + i, { statement: "Later the project added Windows tag-win to CI." })]) })));
    const { record, ledger } = ledgerWith(d, ["er-generic", "er-probe", "er-probe-labels"]);
    const up = fakeUpstream((_, p) => fakeAnswer(p.replace("Run the test suite on Linux, macOS and Windows in CI.", "Run tag-win in CI.")));
    const c = capture();
    expect(await generic(["--units", units, "--item", "er-generic", "--out", join(d, "gr"), "--cache", join(d, "gc"), "--record", record, "--ledger", ledger], c.io, { fetch: up, env: ENV })).toBe(0);
    const k = jsonOf(join(units, "u1", "key.json"));
    expect(k.items.find((i: { id: string }) => i.id === "g1").generic).toBe(true);
    expect(k.primary).toEqual(["a1"]);
    const reply = fakeUpstream(() => JSON.stringify({ changes: ["The importer was fixed for tag-a1."] }));
    expect(await probe(["ask", "--units", units, "--item", "er-probe", "--run-id", "p", "--out", join(d, "replies.json"), "--cache", join(d, "pc"), "--run", join(d, "pr"), "--record", record, "--ledger", ledger], c.io, { fetch: reply, env: ENV })).toBe(0);
    expect(jsonOf(join(d, "replies.json")).units.u1.changes).toEqual(["The importer was fixed for tag-a1."]);
    expect(await main(["packets", "--kind", "recognition", "--stage", "1", "--units", units, "--replies", join(d, "replies.json"), "--out", join(d, "rp"), "--map", join(d, "rmap.json")], c.io)).toBe(0);
    expect(await judge(["--packets", join(d, "rp"), "--map", join(d, "rmap.json"), "--item", "er-probe-labels", "--run-id", "r", "--out", join(d, "rj"), "--cache", join(d, "rc"), "--record", record, "--ledger", ledger], c.io, { fetch: up, env: ENV })).toBe(0);
    expect(await probe(["tally", "--map", join(d, "rmap.json"), "--labels", join(d, "rj", "labels.ndjson"), "--replies", join(d, "replies.json"), "--out", join(d, "rec.json")], c.io)).toBe(0);
    expect(jsonOf(join(d, "rec.json"))).toEqual({ version: 1, recognized: ["u1"], not: ["u2"], unread: [] });
  }, 120_000);
});
