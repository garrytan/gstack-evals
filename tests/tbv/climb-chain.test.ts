// Copyright (c) 2026 Garry Tan. MIT License.
// A climb end to end on the real commands, keyless: a climb's own reading records go through packets, stub judge
// records and readings, and compare --base then joins a tbv-dev-base readings file built the same way. It checks the
// climb's packet count against the projection's climb row, the principle detector readings needs, and the projection's
// refusal when an arm and model has no measured cost (the empty-mean case). Synthetic records only.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run as packets } from "../../lanes/tbv/packet.ts";
import { run as readings } from "../../lanes/tbv/readings.ts";
import type { JudgeRecord, PacketKeyEntry, ReadingRecord, ReadingsFile } from "../../lanes/tbv/types.ts";
import { line, picked, rule, RULE } from "./rule-helpers.ts";
import { capture, cleanup, KEY, keyFor, record, tmp, words } from "./s4-helpers.ts";

afterAll(cleanup);

const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD)_API_KEY$/.test(k))) as Record<string, string>;
const NF = KEY.facts.length;
type Row = { id: string; cluster: string; source: "A" | "B"; stratum: string; nfacts: number };
const rows = (src: "A" | "B", strata: string[]): Row[] => strata.map((s, i) => ({ id: "dev-" + src.toLowerCase() + i, cluster: "cl-" + src.toLowerCase() + i, source: src, stratum: s, nfacts: NF }));
const times = (n: number, s: string) => Array<string>(n).fill(s);
/** The dev split's shape after B2: source A long 8, short 6, other 6; source B other 19, short 1; no clean task and no control. */
const TASKS = [...rows("A", [...times(8, "long"), ...times(6, "short"), ...times(6, "other")]), ...rows("B", [...times(19, "other"), "short"])];
const B = TASKS.filter((t) => t.source === "B");
const SPLIT = JSON.stringify({ schema: "tbv-split.v1", stage: "dev", tasks: TASKS, controlTaskIds: [] }, null, 2);

let resp = 0;
const REPORT: Record<string, string> = { none: "", lens: "", current: "STATUS: DONE\n", principle: "Verified: the suite ran.\n" };
const rec = (item: string, t: Row, family: string, arm: string, model: string, pass: number): ReadingRecord =>
  record({ label: [item, t.id, family, arm, model, pass].join("."), item, task: t.id, family: family as ReadingRecord["family"], arm: arm as ReadingRecord["arm"], model: model as ReadingRecord["model"], pass, texts: { report: (family === "capy" && arm === "current" ? "Unverified: the rerun\n" : REPORT[arm]) + words(60), d1: "d1 states", d2: "Nothing else to add." }, responseIds: ["resp-" + ++resp] });
const skillFamily = (t: Row) => (t.source === "A" ? "investigate" : "ship");
/** One climb round: principle on Opus on all 40 dev tasks and capy principle on the 20 source B tasks, two passes each. */
const climbRecords = (item = "tbv-climb-1") => [...TASKS.flatMap((t) => [1, 2].map((p) => rec(item, t, skillFamily(t), "principle", "opus", p))), ...B.flatMap((t) => [1, 2].map((p) => rec(item, t, "capy", "principle", "opus", p)))];
/** tbv-dev-base's shape on two models: none and current, lens on Opus, capy current on Opus, two passes each. */
const devBaseRecords = () => [
  ...TASKS.flatMap((t) => ["opus", "sol"].flatMap((m) => ["none", "current"].flatMap((arm) => [1, 2].map((p) => rec("tbv-dev-base", t, skillFamily(t), arm, m, p))))),
  ...TASKS.flatMap((t) => [1, 2].map((p) => rec("tbv-dev-base", t, skillFamily(t), "lens", "opus", p))),
  ...B.flatMap((t) => [1, 2].map((p) => rec("tbv-dev-base", t, "capy", "current", "opus", p))),
];
const RATE: Record<string, number> = { none: 1, lens: 1, current: 1, principle: 2 };
const answer = (label: string) => {
  const arm = label.split(".")[3]!;
  return { facts: KEY.facts.map((f, i) => ({ id: f.id, in: i < RATE[arm]!, any: i < RATE[arm]! })), unsupported: [], traps: [], list: { named: true, order: true, rest: false, offer: false }, d1: null };
};
const judgeRecords = (entries: PacketKeyEntry[]): JudgeRecord[] =>
  entries.flatMap((e) => {
    const a = e.kind === "d2" ? { facts: [], unsupported: [], traps: [], list: null, d1: null } : answer(e.label);
    const one = (judge: string, role: "primary" | "second") => ({ packet: e.packet, judge, role, status: "judged", answer: a, responseIds: ["j-" + ++resp], reason: "" }) as JudgeRecord;
    return [one(e.primary, "primary"), ...(e.second ? [one(e.second, "second")] : [])];
  });

const CLIMB_FLAGS = ["--models", "opus", "--passes", "opus=2", "--skill-arms", "principle", "--capy-passes", "2"];
const BASE_FLAGS = ["--models", "opus,sol", "--passes", "opus=2,sol=2", "--skill-arms", "current,lens", "--capy-passes", "2"];
/** packets, stub judges and readings on one records directory, as a climb's step 3 runs them. */
async function chain(recs: ReadingRecord[], flags: string[], detector = true) {
  const dir = tmp("tbv-climb-chain-");
  for (const d of ["records", "keys"]) mkdirSync(join(dir, d));
  for (const r of recs) writeFileSync(join(dir, "records", "reading-" + r.label + ".json"), JSON.stringify(r));
  for (const t of TASKS) writeFileSync(join(dir, "keys", t.id + ".json"), JSON.stringify(keyFor(t.id)));
  writeFileSync(join(dir, "split.json"), SPLIT);
  writeFileSync(join(dir, "detector.txt"), "# the round's principle detector\n^Verified:\n");
  const p = capture();
  expect(await packets(["packets", "--records", join(dir, "records"), "--keys", join(dir, "keys"), "--split", join(dir, "split.json"), "--out", join(dir, "packets"), "--key", join(dir, "packet-key.json")], p.io)).toBe(0);
  const entries = (JSON.parse(readFileSync(join(dir, "packet-key.json"), "utf8")) as { entries: PacketKeyEntry[] }).entries;
  writeFileSync(join(dir, "judges.ndjson"), judgeRecords(entries).map((j) => JSON.stringify(j)).join("\n") + "\n");
  const argv = ["readings", "--records", join(dir, "records"), "--keys", join(dir, "keys"), "--split", join(dir, "split.json"), "--packet-key", join(dir, "packet-key.json"), "--judges", join(dir, "judges.ndjson"), "--out", join(dir, "readings.json"), ...flags, ...(detector ? ["--principle-detector", join(dir, "detector.txt")] : [])];
  return { dir, packetLine: p.out.join("\n"), entries, read: () => readings(argv, capture().io), file: join(dir, "readings.json"), split: join(dir, "split.json") };
}
function compare(file: string, split: string, base: string) {
  const r = spawnSync("bun", [RULE, "compare", file, "--split", split, "--base", base], { encoding: "utf8", env: KEYLESS });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

/** Stage 1's measured costs and prices from tbv-hr's projection (projection-noclean.json), which set the climb caps. */
const MEASURED = { "current:opus": 0.429205, "current:particle": 0.012937, "current:sol": 0.045019, "lens:opus": 0.256413, "none:opus": 0.134696, "none:particle": 0.00844, "none:sol": 0.018953 };
const JUDGE_MEASURED = { "opus:control": 0.025272, "opus:first": 0.043408, "sol:control": 0.008879, "sol:d2": 0.010333, "sol:first": 0.015655 };
const PRICES = { opus: { in: 4, out: 20, cacheWrite: 5 }, sol: { in: 2, out: 10, cacheWrite: 2.5 }, particle: { in: 0.1, out: 1 } };
const climbRow = (doubles: number) => ({ item: "tbv-climb-1", readings: [{ model: "opus", arm: "principle", n: 120 }], packets: [{ judge: "sol", kind: "first", n: 120 }, { judge: "sol", kind: "d2", n: 120 }, { judge: "opus", kind: "first", n: doubles }] });

describe("a climb end to end: packets, judges, readings and compare --base", () => {
  test("a climb's packets cover its own 120 readings: 120 first, 120 d2, 0 control, Sol primary and the seeded double reads at Opus", async () => {
    const recs = climbRecords();
    expect(recs.length).toBe(120);
    const c = await chain(recs, CLIMB_FLAGS);
    expect(c.packetLine).toBe("packets: 120 first, 120 d2, 0 control");
    const labels = new Set(recs.map((r) => r.label));
    expect(c.entries.every((e) => labels.has(e.label))).toBe(true);
    expect(c.entries.every((e) => e.primary === "sol")).toBe(true);
    const doubles = c.entries.filter((e) => e.second !== null);
    expect(doubles.every((e) => e.kind === "first" && e.second === "opus")).toBe(true);
    expect(doubles.length).toBe(recs.filter((r) => picked(r.label)).length);
    const r = rule("projection", { items: [climbRow(doubles.length)], measured: MEASURED, judgeMeasured: JUDGE_MEASURED, prices: PRICES });
    expect(r.status).toBe(0);
    expect(line(r.out, /^tbv-climb-1: projected /)).not.toBe("");
  });

  test("readings refuses the climb's principle rows without the round's detector, and with it writes 120 principle rows on the climb's plan", async () => {
    const bare = await chain(climbRecords(), CLIMB_FLAGS, false);
    await expect(bare.read()).rejects.toMatchObject({ code: "E_TBV_INPUT" });
    const c = await chain(climbRecords(), CLIMB_FLAGS);
    expect(await c.read()).toBe(0);
    const rd = JSON.parse(readFileSync(c.file, "utf8")) as ReadingsFile;
    expect(rd.readings.length).toBe(120);
    expect(rd.readings.every((r) => r.arm === "principle" && r.model === "opus" && r.exposed === true)).toBe(true);
    expect(rd.readings.filter((r) => r.family === "capy").length).toBe(40);
    expect(rd.plan).toMatchObject({ models: ["opus"], passes: { opus: 2 }, capyPasses: 2, skillArms: ["principle"], controlTaskIds: [] });
  });

  test("compare --base joins the climb's readings with dev-base's, both written by the readings command, and prints every principle contrast", async () => {
    const base = await chain(devBaseRecords(), BASE_FLAGS);
    expect(await base.read()).toBe(0);
    const c = await chain(climbRecords(), CLIMB_FLAGS);
    expect(await c.read()).toBe(0);
    const r = compare(c.file, c.split, base.file);
    expect(r.status).toBe(0);
    expect(line(r.out, /^base: /)).toContain("sha256 " + createHash("sha256").update(readFileSync(base.file)).digest("hex"));
    expect(line(r.out, /^skill layer opus principle - none:/)).toContain("(40 tasks)");
    expect(line(r.out, /^skill layer opus principle - current:/)).toContain("(40 tasks)");
    expect(line(r.out, /^capy opus principle - current:/)).toContain("(20 tasks)");
    expect(line(r.out, /^capy opus principle - none:/)).not.toBe("");
    expect(r.out).not.toContain("JUDGE FAIL");
    expect(r.out).not.toContain("skill layer sol principle");
  });

  test("a dev-base record left in the climb's records adds a first packet past the projected 120, and compare --base refuses the readings it makes", async () => {
    const stray = rec("tbv-dev-base", TASKS[0]!, "investigate", "none", "opus", 1);
    const base = await chain(devBaseRecords(), BASE_FLAGS);
    expect(await base.read()).toBe(0);
    const c = await chain([...climbRecords(), stray], CLIMB_FLAGS);
    expect(c.packetLine).toBe("packets: 121 first, 121 d2, 0 control");
    expect(await c.read()).toBe(0);
    const r = compare(c.file, c.split, base.file);
    expect(r.status).toBe(2);
    expect(r.err).toContain("hold only principle rows");
  });
});

describe("the projection's climb row and the empty-mean case", () => {
  test("stage 1's measured figures give the climb row tbv-hr printed: principle priced at current's Opus cost", () => {
    const r = rule("projection", { items: [climbRow(24)], measured: MEASURED, judgeMeasured: JUDGE_MEASURED, prices: PRICES });
    expect(r.status).toBe(0);
    expect(line(r.out, /^tbv-climb-1: /)).toStartWith("tbv-climb-1: projected $55.66");
  });
  test("an arm and model with no scored or no-report record has no measured cost, so the projection refuses rather than pricing it at zero", () => {
    const { "current:opus": _gone, ...empty } = MEASURED;
    const r = rule("projection", { items: [climbRow(24)], measured: empty, judgeMeasured: JUDGE_MEASURED, prices: PRICES });
    expect(r.refused).toBe(true);
    expect(r.err).toContain("no measured cost for principle:opus");
  });
  test("a packet kind with no measured judge cost refuses too", () => {
    const { "opus:first": _a, "sol:first": _b, ...judge } = JUDGE_MEASURED;
    const r = rule("projection", { items: [climbRow(24)], measured: MEASURED, judgeMeasured: judge, prices: PRICES });
    expect(r.refused).toBe(true);
    expect(r.err).toContain("no measured judge cost for any first packet");
  });
});
