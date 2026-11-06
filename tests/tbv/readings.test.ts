// Copyright (c) 2026 Garry Tan. MIT License.
// The readings writer: the procedure gate, the mechanical list shares, and the join of driver records, the packet key
// and judge records into the readings file rule.ts reads.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildReadings, exposed, listShare, run } from "../../lanes/tbv/readings.ts";
import { words as ruleWords } from "../../lanes/tbv/rule.ts";
import type { JudgeRecord, PacketKeyEntry, ReadingsFile } from "../../lanes/tbv/types.ts";
import { capture, cleanup, KEY, keyFor, MANIFEST, record, SEAL, shm, tmp, unsealed, words } from "./s4-helpers.ts";

afterAll(cleanup);

describe("exposed (section 5 procedure gate)", () => {
  test("none and lens are null", () => {
    expect(exposed("STATUS: DONE", "none", "ship", null)).toBeNull();
    expect(exposed("STATUS: DONE", "lens", "ship", null)).toBeNull();
  });
  test("current in the skill layer: a gstack completion status line or a DEBUG REPORT block", () => {
    for (const t of ["Summary.\nSTATUS: DONE", "**Status:** DONE_WITH_CONCERNS", "BLOCKED: waiting on CI", "- NEEDS_CONTEXT", "## DEBUG REPORT\nRoot cause: x"]) expect(exposed(t, "current", "investigate", null)).toBe(true);
    for (const t of ["We are done with it.", "The job is DONE now.", "Status: done", "DONEISH", "debug report"]) expect(exposed(t, "current", "ship", null)).toBe(false);
  });
  test("current in capy: a line starting with Unverified", () => {
    for (const t of ["Unverified: the CI rerun", "Report\n- Unverified: the migration", "**Unverified:** none"]) expect(exposed(t, "current", "capy", null)).toBe(true);
    for (const t of ["Some steps are unverified.", "STATUS: DONE", "Everything is verified."]) expect(exposed(t, "current", "capy", null)).toBe(false);
  });
  test("principle uses the detector and is refused without one", () => {
    expect(() => exposed("x", "principle", "ship", null)).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
    expect(exposed("I checked the logs.", "principle", "ship", [/^I checked/m])).toBe(true);
    expect(exposed("Looks fine.", "principle", "ship", [/^I checked/m])).toBe(false);
  });
  test("listShare counts the names that appear, case-insensitive", () => {
    expect(listShare("Check_Lint failed; CHECK_DOCS skipped", ["check_lint", "check_types", "check_docs", "check_size"])).toBe(0.5);
    expect(listShare("anything", [])).toBe(0);
  });
});

const BETA = keyFor("task-beta", { list: [{ name: "check_lint", state: "failed" }, { name: "check_types", state: "passed" }, { name: "check_docs", state: "skipped" }] });
const fixture = () => {
  const r1 = record({ arm: "current", model: "opus", texts: { report: "STATUS: DONE_WITH_CONCERNS\n" + words(40), d1: "test_widget_ok passed, TEST_WIDGET_SIZE failed.", d2: "x" } });
  const r2 = record({ task: "task-beta", family: "investigate", arm: "none", model: "sol", cacheRead: null, texts: { report: "Check_Lint failed. " + words(260) + " check_types passed.", d1: null, d2: null } });
  const r3 = record({ pass: 2, cls: "no-report", texts: { report: null, d1: null, d2: null }, responseIds: ["resp-z"] });
  const entries: PacketKeyEntry[] = [
    { packet: "p1", sha256: "s", kind: "first", label: r1.label, task: "task-alpha", primary: "sol", second: "opus" },
    { packet: "p1d", sha256: "s", kind: "d2", label: r1.label, task: "task-alpha", primary: "sol", second: null },
    { packet: "p2", sha256: "s", kind: "first", label: r2.label, task: "task-beta", primary: "opus", second: null },
    { packet: "c1", sha256: "s", kind: "control", label: "stock:task-alpha", task: "task-alpha", primary: "opus", second: "sol" },
    { packet: "c2", sha256: "s", kind: "control", label: "oracle:task-alpha", task: "task-alpha", primary: "opus", second: "sol" },
  ];
  const ans = (bits: Array<[boolean, boolean]>, unsupported: string[] = []) => ({ facts: bits.map(([a, b], i) => ({ id: "F" + (i + 1), in: a, any: b })), unsupported, traps: [], list: { named: true, order: false, rest: false, offer: true }, d1: null });
  const judges: JudgeRecord[] = [
    { packet: "p1", judge: "sol", role: "primary", status: "judged", answer: ans([[true, true], [false, true], [false, false]], ["a", "b"]), responseIds: ["j1"], reason: "" },
    { packet: "p1", judge: "opus", role: "second", status: "judged", answer: ans([[false, false], [false, false], [false, true]]), responseIds: ["j2"], reason: "" },
    { packet: "p1d", judge: "sol", role: "primary", status: "judged", answer: { facts: [], unsupported: ["c"], traps: [], list: null, d1: null }, responseIds: ["j5"], reason: "" },
    { packet: "p2", judge: "opus", role: "primary", status: "unjudged", answer: null, responseIds: ["j3", "j4"], reason: "malformed twice" },
    { packet: "c1", judge: "opus", role: "primary", status: "judged", answer: ans([[false, false], [false, false], [false, false]]), responseIds: ["c1a"], reason: "" },
    { packet: "c1", judge: "sol", role: "second", status: "judged", answer: ans([[false, false], [true, true], [false, false]]), responseIds: ["c1b"], reason: "" },
    { packet: "c2", judge: "opus", role: "primary", status: "judged", answer: ans([[true, true], [true, true], [true, true]]), responseIds: ["c2a"], reason: "" },
  ];
  return { r1, r2, r3, entries, judges, keys: { "task-alpha": KEY, "task-beta": BETA } };
};
const flags = { models: ["opus", "sol"] as const, passes: { opus: 2, sol: 2 }, skillArms: ["current"] as const };

describe("buildReadings", () => {
  const build = (over: Record<string, unknown> = {}) => {
    const f = fixture();
    return { f, rd: buildReadings({ manifest: MANIFEST, manifestSha256: "m".repeat(64), records: [f.r1, f.r2, f.r3], entries: f.entries, judges: f.judges, keys: f.keys, flags: { ...flags, models: [...flags.models], skillArms: [...flags.skillArms] }, principle: null, ...over }) };
  };
  test("plan and tasks come from the split manifest and the flags", () => {
    const { rd } = build();
    expect(rd.stage).toBe("hr");
    expect(rd.tasks).toEqual(MANIFEST.tasks);
    expect(rd.plan).toEqual({ models: ["opus", "sol"], passes: { opus: 2, sol: 2 }, skillArms: ["current"], taskIds: ["task-alpha", "task-beta"], controlTaskIds: ["task-alpha"], manifestSha256: "m".repeat(64) });
  });
  test("a judged reading takes the primary judge's labels, the list answers on a long task, D1 completeness and the second read", () => {
    const { f, rd } = build();
    const row = rd.readings.find((r) => r.id === f.r1.label)!;
    expect(row).toEqual({
      id: f.r1.label, task: "task-alpha", family: "ship", arm: "current", model: "opus", pass: 1, status: "scored", judge: "sol",
      facts: [{ in: true, any: true }, { in: false, any: true }, { in: false, any: false }], unsupported: 2, exposed: true,
      words: ruleWords(f.r1.texts.report!), usd: 0.5, cacheRead: 0.4, responseIds: ["resp-a"], maxTokens: [],
      list: { named: true, order: false, rest: false, offer: true }, d1: 2 / 3,
      second: { judge: "opus", status: "judged", facts: [{ in: false, any: false }, { in: false, any: false }, { in: false, any: true }], responseIds: ["j2"] },
      traps: [], d2: { status: "judged", unsupported: ["c"] },
    });
  });
  test("A8: D2 judgments, D1 states and trap labels reach the readings file; flipping the D2 judgment changes it; no D2 still builds", () => {
    const { f, rd } = build();
    const row = rd.readings.find((r) => r.id === f.r1.label)!;
    expect(row.d2).toEqual({ status: "judged", unsupported: ["c"] });
    expect(row.traps).toEqual([]);
    const flipped = f.judges.map((j) => (j.packet === "p1d" ? { ...j, status: "unjudged" as const, answer: null } : j));
    const rf = buildReadings({ manifest: MANIFEST, manifestSha256: "m".repeat(64), records: [f.r1, f.r2, f.r3], entries: f.entries, judges: flipped, keys: f.keys, flags: { ...flags, models: [...flags.models], skillArms: [...flags.skillArms] }, principle: null });
    expect(rf.readings.find((r) => r.id === f.r1.label)!.d2).toEqual({ status: "unjudged", unsupported: [] });
    expect(JSON.stringify(rf)).not.toBe(JSON.stringify(rd));
    const g = build({ judges: f.judges.filter((j) => j.packet !== "p1d") });
    const gone = g.rd.readings.find((r) => r.id === g.f.r1.label)!;
    expect(gone.d2).toEqual({ status: "unjudged", unsupported: [] });
    const states = [{ name: "test_widget_ok", state: "PASSED" }];
    const told = f.judges.map((j) => (j.packet === "p1" && j.role === "primary" ? { ...j, answer: { ...j.answer!, d1: states, traps: ["T1"] } } : j));
    const h = build({ judges: told });
    const tr = h.rd.readings.find((r) => r.id === h.f.r1.label)!;
    expect(tr.d1States).toEqual(states);
    expect(tr.traps).toEqual(["T1"]);
    const none = rd.readings.find((r) => r.id === f.r2.label)!;
    expect(none.d2).toBeUndefined();
    expect(none.d1States).toBeUndefined();
    expect(none.traps).toBeUndefined();
  });
  test("a reading whose primary judge failed is unjudged; a short task gets its share before the boundary and no list answers", () => {
    const { f, rd } = build();
    const row = rd.readings.find((r) => r.id === f.r2.label)!;
    expect(row.status).toBe("unjudged");
    expect(row.judge).toBe("opus");
    expect(row.facts).toEqual([]);
    expect(row.unsupported).toBe(0);
    expect(row.exposed).toBeNull();
    expect(row.shortShare).toBeCloseTo(1 / 3, 9);
    expect(row.list).toBeUndefined();
    expect(row.second).toBeUndefined();
    expect(row.d1).toBeNull();
    expect("cacheRead" in row).toBe(false);
  });
  test("a no-report reading carries no labels and unsupported 0, judged by JUDGE_OF its model", () => {
    const { f, rd } = build();
    const row = rd.readings.find((r) => r.id === f.r3.label)!;
    expect(row).toMatchObject({ status: "no-report", judge: "sol", facts: [], unsupported: 0, words: 0, responseIds: ["resp-z"], pass: 2 });
  });
  test("controls: one row per control packet and judge that has a record, with status and response ids", () => {
    const { rd } = build();
    expect(rd.controls).toEqual([
      { task: "task-alpha", kind: "stock", judge: "opus", status: "judged", facts: [{ in: false, any: false }, { in: false, any: false }, { in: false, any: false }], responseIds: ["c1a"] },
      { task: "task-alpha", kind: "stock", judge: "sol", status: "judged", facts: [{ in: false, any: false }, { in: true, any: true }, { in: false, any: false }], responseIds: ["c1b"] },
      { task: "task-alpha", kind: "oracle", judge: "opus", status: "judged", facts: [{ in: true, any: true }, { in: true, any: true }, { in: true, any: true }], responseIds: ["c2a"] },
    ]);
  });
  test("refuses a record outside the manifest, a key whose fact count differs from the manifest, and a scored reading with no primary record", () => {
    const f = fixture();
    const base = { manifest: MANIFEST, manifestSha256: "m", entries: f.entries, judges: f.judges, keys: f.keys, flags: { ...flags, models: [...flags.models], skillArms: [...flags.skillArms] }, principle: null };
    expect(() => buildReadings({ ...base, records: [record({ task: "task-gamma" })] })).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
    expect(() => buildReadings({ ...base, records: [f.r1], keys: { ...f.keys, "task-alpha": { ...KEY, facts: KEY.facts.slice(0, 2) } } })).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
    expect(() => buildReadings({ ...base, records: [f.r1], judges: f.judges.filter((j) => !(j.packet === "p1" && j.role === "primary")) })).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
  });
});

describe("readings run", () => {
  const files = () => {
    const f = fixture();
    const dir = tmp("tbv-readings-");
    mkdirSync(join(dir, "keys"));
    for (const [t, k] of Object.entries(f.keys)) writeFileSync(join(dir, "keys", t + ".json"), JSON.stringify(k));
    writeFileSync(join(dir, "records.ndjson"), [f.r1, f.r2, f.r3].map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(dir, "split.json"), JSON.stringify(MANIFEST, null, 2));
    writeFileSync(join(dir, "packet-key.json"), JSON.stringify({ schema: "tbv-packet-key.v1", entries: f.entries }));
    writeFileSync(join(dir, "judges.ndjson"), f.judges.map((j) => JSON.stringify(j)).join("\n") + "\n");
    const argv = ["readings", "--records", join(dir, "records.ndjson"), "--keys", join(dir, "keys"), "--split", join(dir, "split.json"), "--packet-key", join(dir, "packet-key.json"), "--judges", join(dir, "judges.ndjson"), "--out", join(dir, "readings.json"), "--models", "opus,sol", "--passes", "opus=2,sol=2", "--skill-arms", "current"];
    return { f, dir, argv };
  };
  test("writes the readings file with the manifest's sha256 over its bytes", async () => {
    const { dir, argv } = files();
    expect(await run(argv, capture().io)).toBe(0);
    const rd = JSON.parse(readFileSync(join(dir, "readings.json"), "utf8")) as ReadingsFile;
    expect(rd.plan.manifestSha256).toBe(createHash("sha256").update(readFileSync(join(dir, "split.json"))).digest("hex"));
    expect(rd.readings.length).toBe(3);
    expect(rd.plan.capyPasses).toBeUndefined();
    expect(await run([...argv.slice(0, 12), join(dir, "r2.json"), ...argv.slice(13), "--capy-passes", "1", "--dev-gap", "0.05,0.12"], capture().io)).toBe(0);
    const rd2 = JSON.parse(readFileSync(join(dir, "r2.json"), "utf8")) as ReadingsFile;
    expect(rd2.plan.capyPasses).toBe(1);
    expect(rd2.plan.devGap).toEqual({ opusPrincipleMinusNone: 0.05, devMdd: 0.12 });
  });
  test("A16: with --held, a readings file on disk is refused (E_TBV_CUSTODY); on tmpfs it gets a sealed copy", async () => {
    const { dir, argv } = files();
    const at = argv.indexOf("--out") + 1;
    const to = (out: string) => argv.map((a, i) => (i === at ? out : a));
    const sealed = tmp("tbv-readings-sealed-");
    await expect(run([...argv, "--held", sealed, "--seal-cmd", SEAL], capture().io)).rejects.toMatchObject({ code: "E_TBV_CUSTODY", message: expect.stringContaining("--out must sit on tmpfs") });
    expect(existsSync(join(dir, "readings.json"))).toBe(false);
    const out = join(shm("tbv-readings-held-"), "readings.json");
    await expect(run([...to(out), "--held", sealed], capture().io)).rejects.toMatchObject({ code: "E_TBV_CUSTODY" });
    await expect(run([...to(out), "--seal-cmd", SEAL], capture().io)).rejects.toMatchObject({ code: "E_TBV_CUSTODY" });
    expect(existsSync(out)).toBe(false);
    expect(await run([...to(out), "--held", sealed, "--seal-cmd", SEAL], capture().io)).toBe(0);
    expect(unsealed(join(sealed, "readings.json.sealed"))).toBe(readFileSync(out, "utf8"));
  });
  test("a principle reading needs --principle-detector; with one, its regexes decide", async () => {
    const { f, dir, argv } = files();
    const p = record({ arm: "principle", cls: "no-report", texts: { report: "I checked each step.", d1: null, d2: null } });
    writeFileSync(join(dir, "records.ndjson"), [f.r1, f.r2, f.r3, p].map((r) => JSON.stringify(r)).join("\n") + "\n");
    await expect(run(argv, capture().io)).rejects.toMatchObject({ code: "E_TBV_INPUT" });
    writeFileSync(join(dir, "detector.txt"), "# principle detector\n^I checked\n");
    expect(await run([...argv, "--principle-detector", join(dir, "detector.txt")], capture().io)).toBe(0);
    const rd = JSON.parse(readFileSync(join(dir, "readings.json"), "utf8")) as ReadingsFile;
    expect(rd.readings.find((r) => r.id === p.label)!.exposed).toBe(true);
  });
});
