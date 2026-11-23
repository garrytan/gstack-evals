// Copyright (c) 2026 Garry Tan. MIT License.
// The R78 addendum's tooling: the Astra run's packet key and route, the judge check, Astra's controls, the Astra readings
// file and compare's Astra stand-in, and the tasks-worse counts. Keyless.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { worstOf } from "../../lanes/tbv/judge.ts";
import { astraControls, astraKey, astraReadings, astraRecords, judgeCheck, kappaInterval, kappaOf, r78Floor, run, tasksWorse } from "../../lanes/tbv/r78.ts";
import { buildReadings } from "../../lanes/tbv/readings.ts";
import { judgeSend } from "../../lanes/tbv/routes.ts";
import { otherJudge, type Judge, type JudgeRecord, type PacketKeyEntry, type PacketKind, type ReadingsFile } from "../../lanes/tbv/types.ts";
import { chatPrice } from "../../src/runner/pricing/prices.ts";
import { type Any, controls, file, reading, rule, task } from "./rule-helpers.ts";
import { capture, cleanup, KEY, keyFor, MANIFEST, record, SEAL, shm, tmp, unsealed } from "./s4-helpers.ts";

afterAll(cleanup);

const ans = (bits: boolean[], unsupported: string[] = []) => ({ facts: bits.map((b, i) => ({ id: "F" + (i + 1), in: b, any: b })), unsupported, traps: [], list: null, d1: null });
const rec = (packet: string, judge: Judge, role: "primary" | "second", bits: boolean[] | null, unsupported: string[] = []): JudgeRecord => ({ packet, judge, role, status: bits ? "judged" : "unjudged", answer: bits ? ans(bits, unsupported) : null, responseIds: [packet + "-" + judge + "-" + role], reason: bits ? "" : "malformed twice" });
const entry = (packet: string, kind: PacketKind, task: string, primary: Judge, second: Judge | null, label = "lbl-" + packet): PacketKeyEntry => ({ packet, sha256: "s", kind, label, task, primary, second });
const byKey = (rs: JudgeRecord[]) => new Map(rs.map((j) => [j.packet + ":" + j.role, j]));

describe("the Astra run's packet key and route", () => {
  test("every packet Sol read, as primary or second read, goes to Astra once; packets only Opus read stay out", () => {
    const es = [entry("a", "first", "t1", "sol", "opus"), entry("b", "first", "t1", "sol", null), entry("c", "d2", "t1", "sol", null), entry("d", "first", "t2", "opus", "sol"), entry("e", "first", "t2", "opus", null), entry("f", "d2", "t2", "opus", null), entry("g", "control", "t1", "opus", "sol", "stock:t1")];
    expect(astraKey(es)).toEqual(["a", "b", "c", "d", "g"].map((p) => ({ ...es.find((e) => e.packet === p)!, primary: "astra", second: null })));
  });
  test("Astra stands in for Sol, so its other judge is Opus; the frozen pair is unchanged", () => {
    expect([otherJudge("sol"), otherJudge("opus"), otherJudge("astra")]).toEqual(["opus", "sol", "opus"]);
  });
  test("Astra is GPT-6.2 Astra on OpenAI's Responses route at medium effort, priced at its list row, 4 times Sol's", () => {
    const req = judgeSend("astra", "a packet", 16000);
    expect(req).toMatchObject({ provider: "openai", route: "/v1/responses", stream: false, body: { model: "gpt-6.2-astra", max_output_tokens: 16000, reasoning: { effort: "medium" } } });
    expect(chatPrice("openai:gpt-6.2-astra")).toMatchObject({ input: 8, output: 40, cache_read: 0.4, cache_write: 10 });
    expect(worstOf(req, 16000) / worstOf(judgeSend("sol", "a packet", 16000), 16000)).toBeCloseTo(4, 2);
  });
});

describe("kappa", () => {
  test("Cohen's kappa against labels, and n/a with no facts or a single class", () => {
    expect(kappaOf({ tp: 40, fn: 10, tn: 40, fp: 10 })).toBeCloseTo(0.6, 12);
    expect(kappaOf({ tp: 1, fn: 0, tn: 1, fp: 0 })).toBe(1);
    expect(kappaOf({ tp: 0, fn: 0, tn: 0, fp: 0 })).toBeNaN();
    expect(kappaOf({ tp: 5, fn: 0, tn: 0, fp: 0 })).toBeNaN();
  });
  test("the interval is seeded: the same tasks give the same interval, around the point estimate", () => {
    const ts = [...Array(30)].map((_, i) => ({ tp: 3 + (i % 3), fn: i % 2, tn: 3, fp: i % 4 === 0 ? 1 : 0 }));
    const ci = kappaInterval(ts)!;
    expect(kappaInterval(ts)).toEqual(ci);
    const k = kappaOf(ts.reduce((a, t) => ({ tp: a.tp + t.tp, fn: a.fn + t.fn, tn: a.tn + t.tn, fp: a.fp + t.fp })));
    expect(ci[0]).toBeLessThanOrEqual(k);
    expect(ci[1]).toBeGreaterThanOrEqual(k);
    expect(kappaInterval([])).toBeNull();
  });
});

describe("judgeCheck (addendum section 2)", () => {
  const es = [entry("pA", "first", "t1", "sol", "opus"), entry("pB", "first", "t2", "sol", "opus"), entry("pC", "first", "t2", "sol", "opus"), entry("pD", "first", "t3", "sol", null), entry("pE", "first", "t4", "opus", "sol")];
  const frozen = [
    rec("pA", "sol", "primary", [true, false, true, false]), rec("pA", "opus", "second", [true, false, false, false]),
    rec("pB", "sol", "primary", [false, true]), rec("pB", "opus", "second", [true, true]),
    rec("pC", "sol", "primary", [true]), rec("pC", "opus", "second", null),
    rec("pD", "sol", "primary", [true]),
    rec("pE", "opus", "primary", [true, true, false]), rec("pE", "sol", "second", [true, false, false]),
  ];
  const astra = astraRecords([rec("pA", "astra", "primary", [true, false, true, true]), rec("pB", "astra", "primary", [true, true]), rec("pC", "astra", "primary", [true]), rec("pD", "astra", "primary", [false]), rec("pE", "astra", "primary", [true, true, false])]);
  test("Sol is checked against facts where Astra and Opus agree; a packet with an unjudged read leaves and is counted", () => {
    const c = judgeCheck("sol", es, byKey(frozen), astra);
    expect(c).toMatchObject({ packets: 2, outputs: 2, excluded: 1, labelled: 4, unlabelled: 2, pass: false });
    expect(c.kappa).toBeCloseTo(0.5, 12);
    expect(c.line).toContain("catch rate 1.000 (1/1), false-fail rate 0.333 (1/3), kappa 0.500");
    expect(c.line).toContain("failed the R78 judge check");
  });
  test("Opus is checked against facts where Astra and Sol agree, on Sol and particle-1 packets; one labelled output is under R78's floor, so it fails at kappa 1", () => {
    const c = judgeCheck("opus", es, byKey(frozen), astra);
    expect(c).toMatchObject({ packets: 1, outputs: 1, labelled: 2, unlabelled: 1, kappa: 1, floor: 40, pass: false });
    expect(c.line).toEndWith("failed the R78 judge check (1 labelled outputs, under R78's floor of 40)");
  });
  test("R78's floor: 40 labelled outputs pass at kappa 1 and 39 fail; the floor is 40 before 2026-11-22 and 100 from that date", () => {
    const at = (n: number) => {
      const ps = [...Array(n)].map((_, i) => "q" + i);
      const es = ps.map((p, i) => entry(p, "first", "t" + (i % 10), "opus", "sol"));
      const fz = ps.flatMap((p) => [rec(p, "opus", "primary", [true, false]), rec(p, "sol", "second", [true, false])]);
      return judgeCheck("opus", es, byKey(fz), astraRecords(ps.map((p) => rec(p, "astra", "primary", [true, false]))));
    };
    expect(at(40)).toMatchObject({ outputs: 40, kappa: 1, pass: true });
    expect(at(40).line).toEndWith("passes the R78 judge check");
    expect(at(39)).toMatchObject({ outputs: 39, kappa: 1, pass: false });
    expect(at(39).line).toEndWith("failed the R78 judge check (39 labelled outputs, under R78's floor of 40)");
    expect([r78Floor("2026-11-05"), r78Floor("2026-11-21"), r78Floor("2026-11-22"), r78Floor("2026-12-01")]).toEqual([40, 40, 100, 100]);
  });
  const twenty = () => {
    const ps = [...Array(20)].map((_, i) => "q" + i);
    const es = ps.map((p, i) => entry(p, "first", "t" + (i % 10), "opus", "sol"));
    const fz = byKey(ps.flatMap((p) => [rec(p, "opus", "primary", [true, false]), rec(p, "sol", "second", [true, false])]));
    return { es, fz, as: astraRecords(ps.map((p) => rec(p, "astra", "primary", [true, false]))) };
  };
  test("an output listed twice in the packet key is refused, so repeats can't reach R78's floor", () => {
    const { es, fz, as } = twenty();
    expect(() => judgeCheck("opus", [...es, ...es.map((e) => ({ ...e, packet: e.packet + "-again" }))], fz, as)).toThrow(expect.objectContaining({ code: "E_TBV_INPUT", message: expect.stringContaining("lists one output's first packet twice") }));
  });
  test("one packet listed under two output labels is refused, so one judged packet can't count twice", () => {
    const { es, fz, as } = twenty();
    expect(() => judgeCheck("opus", [...es, { ...es[0]!, label: "another-output" }], fz, as)).toThrow(expect.objectContaining({ code: "E_TBV_INPUT", message: expect.stringContaining("lists one packet twice") }));
  });
  test("other direction: the same outputs listed once count once each and stay under the floor", () => {
    const { es, fz, as } = twenty();
    expect(judgeCheck("opus", es, fz, as)).toMatchObject({ outputs: 20, kappa: 1, pass: false });
  });
  test("the checked judge makes no label: changing its own reads moves the score, never the label count", () => {
    const flipped = frozen.map((j) => (j.judge === "sol" && j.role === "primary" ? { ...j, answer: ans(j.answer!.facts.map((f) => !f.in)) } : j));
    const c = judgeCheck("sol", es, byKey(flipped), astra);
    expect(c).toMatchObject({ labelled: 4, unlabelled: 2 });
    expect(c.kappa).toBeCloseTo(-0.5, 12);
  });
  test("refuses reads whose judges or fact counts do not match the key", () => {
    expect(() => judgeCheck("sol", es, byKey(frozen.map((j) => (j.packet === "pA" && j.role === "second" ? { ...j, judge: "sol" as const } : j))), astra)).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
    expect(() => judgeCheck("sol", es, byKey(frozen), astraRecords([rec("pA", "astra", "primary", [true]), rec("pB", "astra", "primary", [true, true])]))).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
  });
  test("an Astra file holds Astra primary records, each packet once", () => {
    expect(() => astraRecords([rec("pA", "sol", "primary", [true])])).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
    expect(() => astraRecords([rec("pA", "astra", "primary", [true]), rec("pA", "astra", "primary", [false])])).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
  });
});

describe("astraControls", () => {
  const es = [entry("c1", "control", "t1", "opus", "sol", "stock:t1"), entry("c2", "control", "t1", "opus", "sol", "oracle:t1")];
  test("Astra's stock and oracle rates against the frozen bounds", () => {
    expect(astraControls(es, astraRecords([rec("c1", "astra", "primary", [false, false, false]), rec("c2", "astra", "primary", [true, true, true])]), ["t1"])).toEqual({ ok: true, line: "controls (astra): stock 0.000 (max 0.1), oracle 1.000 (min 0.85); planned on 1 tasks, never attempted 0, unjudged 0; within bounds" });
    expect(astraControls(es, astraRecords([rec("c1", "astra", "primary", [true, false, false]), rec("c2", "astra", "primary", [true, true, true])]), ["t1"]).ok).toBe(false);
    const missing = astraControls(es, astraRecords([rec("c1", "astra", "primary", [false, false, false])]), ["t1"]);
    expect(missing.ok).toBe(false);
    expect(missing.line).toContain("never attempted 1");
  });
});

const BETA = keyFor("task-beta", { list: [{ name: "check_lint", state: "failed" }, { name: "check_types", state: "passed" }, { name: "check_docs", state: "skipped" }] });
const fixture = () => {
  const r1 = record({ arm: "current", model: "opus", texts: { report: "STATUS: DONE\n" + "word ".repeat(40), d1: null, d2: "x" } });
  const r2 = record({ task: "task-beta", family: "investigate", arm: "none", model: "sol", texts: { report: "Check_Lint failed.", d1: null, d2: null } });
  const r3 = record({ pass: 2, cls: "no-report", texts: { report: null, d1: null, d2: null }, responseIds: ["resp-z"] });
  const entries = [entry("p1", "first", "task-alpha", "sol", "opus", r1.label), entry("p1d", "d2", "task-alpha", "sol", null, r1.label), entry("p2", "first", "task-beta", "opus", "sol", r2.label), entry("c1", "control", "task-alpha", "opus", "sol", "stock:task-alpha"), entry("c2", "control", "task-alpha", "opus", "sol", "oracle:task-alpha")];
  const judges = [
    rec("p1", "sol", "primary", [true, false, false], ["a", "b"]), rec("p1", "opus", "second", [false, false, false]), rec("p1d", "sol", "primary", [], ["c"]),
    rec("p2", "opus", "primary", [true, true, false]), rec("p2", "sol", "second", [true, false, false]),
    rec("c1", "opus", "primary", [false, false, false]), rec("c1", "sol", "second", [false, true, false]), rec("c2", "opus", "primary", [true, true, true]),
  ];
  const astra = [rec("p1", "astra", "primary", [true, true, false], ["u"]), rec("p1d", "astra", "primary", [], ["v", "w"]), rec("p2", "astra", "primary", [true, true, false]), rec("c1", "astra", "primary", [false, false, false]), rec("c2", "astra", "primary", [true, true, true])];
  return { r1, r2, r3, entries, judges, astra, keys: { "task-alpha": KEY, "task-beta": BETA } };
};
const input = (f: ReturnType<typeof fixture>) => ({ manifest: MANIFEST, manifestSha256: "m".repeat(64), records: [f.r1, f.r2, f.r3], entries: f.entries, judges: f.judges, keys: f.keys, flags: { models: ["opus", "sol"] as ("opus" | "sol")[], passes: { opus: 2, sol: 2 }, skillArms: ["current" as const] }, principle: null });

describe("astraReadings (addendum section 3)", () => {
  test("every reading Sol judged takes Astra's labels and names Astra; Opus's reads, second reads and controls stay; the plan names the stand-in", () => {
    const f = fixture();
    const frozen = buildReadings(input(f));
    const rd = astraReadings(input(f), astraRecords(f.astra));
    const r1 = rd.readings.find((r) => r.id === f.r1.label)!;
    expect(r1).toMatchObject({ judge: "astra", status: "scored", facts: [{ in: true, any: true }, { in: true, any: true }, { in: false, any: false }], unsupported: 1, d2: { status: "judged", unsupported: ["v", "w"] } });
    expect(r1.second).toEqual(frozen.readings.find((r) => r.id === f.r1.label)!.second!);
    expect(rd.readings.find((r) => r.id === f.r2.label)).toEqual(frozen.readings.find((r) => r.id === f.r2.label)!);
    expect(rd.readings.find((r) => r.id === f.r3.label)!.judge).toBe("astra");
    expect(rd.controls).toEqual(frozen.controls!);
    expect(rd.plan).toEqual({ ...frozen.plan, standIn: { for: "sol", by: "astra" } });
  });
  test("a packet Sol read with no Astra record refuses: the Astra run must be complete", () => {
    const f = fixture();
    expect(() => astraReadings(input(f), astraRecords(f.astra.filter((j) => j.packet !== "p1d")))).toThrow(expect.objectContaining({ code: "E_TBV_INPUT", message: expect.stringContaining("1 packets Sol read have no Astra record") }));
  });
});

describe("compare with Astra standing in for Sol", () => {
  const held = (judge: string, plan: Any = {}, stage: "held" | "dev" = "held") => {
    const ts = [...Array(20)].map((_, i) => task("t" + i, "A", ["long", "short", "other"][i % 3]!, 3));
    const rate: Record<string, number> = { none: 1 / 3, current: 2 / 3, principle: 2 / 3 };
    const rs = ts.flatMap((t, i) => ["none", "current", "principle"].flatMap((arm) => [1, 2].map((p) => reading(t, arm, "opus", p, rate[arm]! + (i % 2 && arm === "principle" ? 1 / 3 : 0), { second: (i + p) % 4 === 0, judge }))));
    return file(stage, ts, rs, { controls: controls(ts), controlTaskIds: ts.map((t) => t.id), plan });
  };
  const STAND = { standIn: { for: "sol", by: "astra" } };
  test("the same labels score the same: the only new line names the stand-in", () => {
    const a = held("sol");
    const b = held("astra", STAND);
    const ra = rule("compare", a.data, a.split), rb = rule("compare", b.data, b.split);
    expect(ra.status).toBe(0);
    expect(rb.status).toBe(0);
    const lines = rb.out.split("\n");
    expect(lines[0]).toBe("judge stand-in (R78 addendum): astra's labels in place of sol's on every reading sol read; second reads and controls as judged");
    expect(lines.slice(1).join("\n")).toBe(ra.out);
    expect(ra.out).not.toContain("stand-in");
  });
  test("Astra's readings without the stand-in, a stand-in on dev readings and any other stand-in are refused", () => {
    const plain = held("astra");
    expect(rule("compare", plain.data, plain.split)).toMatchObject({ refused: true, err: expect.stringContaining("is judged by astra, but opus arms are judged by sol") });
    const dev = held("astra", STAND, "dev");
    expect(rule("compare", dev.data, dev.split)).toMatchObject({ refused: true, err: expect.stringContaining("is not the R78 addendum's Astra reading") });
    const other = held("opus", { standIn: { for: "sol", by: "opus" } });
    expect(rule("compare", other.data, other.split)).toMatchObject({ refused: true, err: expect.stringContaining("is not the R78 addendum's Astra reading") });
  });
});

describe("tasksWorse", () => {
  test("per contrast, the tasks whose mean recall went down, up or stayed, over matched judged passes", () => {
    const ts = ["t1", "t2", "t3"].map((id) => task(id, "A", "long", 3));
    const p: Record<string, number> = { t1: 0, t2: 2 / 3, t3: 1 / 3 };
    const rs = ts.flatMap((t) => [1, 2].flatMap((pass) => [reading(t, "none", "opus", pass, 1 / 3), reading(t, "current", "opus", pass, 1 / 3), reading(t, "principle", "opus", pass, p[t.id]!)]));
    const lines = tasksWorse(file("held", ts, rs).data as ReadingsFile);
    expect(lines).toEqual(["skill layer opus principle - none: tasks worse 1, better 1, same 1 of 3", "skill layer opus principle - current: tasks worse 1, better 1, same 1 of 3", "skill layer opus current - none: tasks worse 0, better 0, same 3 of 3"]);
  });
});

describe("r78-key and r78 runs", () => {
  const files = () => {
    const f = fixture();
    const dir = tmp("tbv-r78-"), plain = shm("tbv-r78-out-"), held = join(tmp("tbv-r78-sealed-"), "sealed");
    mkdirSync(join(dir, "keys"));
    for (const [t, k] of Object.entries(f.keys)) writeFileSync(join(dir, "keys", t + ".json"), JSON.stringify(k));
    writeFileSync(join(dir, "records.ndjson"), [f.r1, f.r2, f.r3].map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(dir, "split.json"), JSON.stringify(MANIFEST, null, 2));
    writeFileSync(join(dir, "packet-key.json"), JSON.stringify({ schema: "tbv-packet-key.v1", entries: f.entries }));
    writeFileSync(join(dir, "judges.ndjson"), f.judges.map((j) => JSON.stringify(j)).join("\n") + "\n");
    writeFileSync(join(dir, "astra.ndjson"), f.astra.map((j) => JSON.stringify(j)).join("\n") + "\n");
    const argv = ["r78", "--records", join(dir, "records.ndjson"), "--keys", join(dir, "keys"), "--split", join(dir, "split.json"), "--packet-key", join(dir, "packet-key.json"), "--judges", join(dir, "judges.ndjson"), "--astra", join(dir, "astra.ndjson"), "--out", join(plain, "astra-readings.json"), "--held", held, "--seal-cmd", SEAL, "--models", "opus,sol", "--passes", "opus=2,sol=2", "--skill-arms", "current"];
    return { f, dir, plain, held, argv };
  };
  const without = (argv: string[], flag: string) => argv.filter((_, i) => i !== argv.indexOf(flag) && i !== argv.indexOf(flag) + 1);
  test("r78-key writes the Astra key, seals it and prints counts", async () => {
    const { f, dir, plain, held } = files();
    const c = capture();
    expect(await run(["r78-key", "--key", join(dir, "packet-key.json"), "--out", join(plain, "astra-key.json"), "--held", held, "--seal-cmd", SEAL], c.io)).toBe(0);
    const want = { schema: "tbv-packet-key.v1", entries: astraKey(f.entries) };
    expect(JSON.parse(readFileSync(join(plain, "astra-key.json"), "utf8"))).toEqual(want);
    expect(JSON.parse(unsealed(join(held, "astra-key.json.sealed")))).toEqual(want);
    expect(c.out.join("\n")).toBe("r78-key: 5 of 5 packets for Astra (first 2, d2 1, control 2)");
  });
  test("both R78 commands write their plaintext owner-only (0600)", async () => {
    const { dir, plain, held, argv } = files();
    expect(await run(["r78-key", "--key", join(dir, "packet-key.json"), "--out", join(plain, "astra-key.json"), "--held", held, "--seal-cmd", SEAL], capture().io)).toBe(0);
    expect(await run(argv, capture().io)).toBe(0);
    expect([statSync(join(plain, "astra-key.json")).mode & 0o777, statSync(join(plain, "astra-readings.json")).mode & 0o777]).toEqual([0o600, 0o600]);
  });
  test("other direction: an --out that already exists is refused and left as it was, since this run did not set its mode", async () => {
    const { dir, plain, held } = files();
    writeFileSync(join(plain, "astra-key.json"), "old");
    await expect(run(["r78-key", "--key", join(dir, "packet-key.json"), "--out", join(plain, "astra-key.json"), "--held", held, "--seal-cmd", SEAL], capture().io)).rejects.toMatchObject({ code: "E_TBV_CUSTODY", message: expect.stringContaining("already exists") });
    expect(readFileSync(join(plain, "astra-key.json"), "utf8")).toBe("old");
  });
  test("both R78 commands refuse with E_USAGE without --held or --seal-cmd, before they read or write anything", async () => {
    const { plain, held, argv } = files();
    const key = ["r78-key", "--key", join(plain, "no-such-key.json"), "--out", join(plain, "astra-key.json"), "--held", held, "--seal-cmd", SEAL];
    for (const a of [without(without(key, "--held"), "--seal-cmd"), without(key, "--held"), without(key, "--seal-cmd")]) await expect(run(a, capture().io)).rejects.toMatchObject({ code: "E_USAGE", message: expect.stringContaining("pass --held <sealed dir> and --seal-cmd <cmd>") });
    const noRecords = argv.map((x, i) => (argv[i - 1] === "--records" ? join(plain, "no-such-records.ndjson") : x));
    for (const a of [without(without(noRecords, "--held"), "--seal-cmd"), without(noRecords, "--held"), without(noRecords, "--seal-cmd")]) await expect(run(a, capture().io)).rejects.toMatchObject({ code: "E_USAGE" });
    expect([existsSync(join(plain, "astra-key.json")), existsSync(join(plain, "astra-readings.json")), existsSync(held)]).toEqual([false, false, false]);
  });
  test("r78 writes the Astra readings file and prints the judge check, Astra's controls and tasks worse, naming no task", async () => {
    const { f, plain, held, argv } = files();
    const c = capture();
    expect(await run(argv, c.io)).toBe(0);
    const rd = JSON.parse(readFileSync(join(plain, "astra-readings.json"), "utf8")) as ReadingsFile;
    expect({ ...rd, plan: { ...rd.plan, manifestSha256: "m".repeat(64) } }).toEqual(astraReadings(input(f), astraRecords(f.astra)));
    expect(unsealed(join(held, "astra-readings.json.sealed"))).toBe(readFileSync(join(plain, "astra-readings.json"), "utf8"));
    const out = c.out.join("\n");
    expect(out).toContain("r78: astra records for 5 of the 5 packets sol read in this line (unjudged 0); astra readings 2 of 3");
    expect(out).toContain("judge check sol: 1 first packets read by sol and opus");
    expect(out).toContain("judge check opus: 1 first packets read by opus and sol");
    expect(out).toContain("controls (astra): stock 0.000 (max 0.1), oracle 1.000 (min 0.85)");
    expect(out).toMatch(/^sol reading: skill layer opus/m);
    expect(out).toMatch(/^astra reading: skill layer opus/m);
    expect(out).not.toMatch(/task-alpha|task-beta|lbl-/);
  });
  test("r78 and r78-key refuse a packet key that lists one output twice before writing or sealing anything", async () => {
    const { f, dir, plain, held, argv } = files();
    writeFileSync(join(dir, "packet-key.json"), JSON.stringify({ schema: "tbv-packet-key.v1", entries: [...f.entries, { ...f.entries[0]!, packet: "p1-again" }] }));
    await expect(run(argv, capture().io)).rejects.toMatchObject({ code: "E_TBV_INPUT", message: expect.stringContaining("lists one output's first packet twice") });
    await expect(run(["r78-key", "--key", join(dir, "packet-key.json"), "--out", join(plain, "astra-key.json"), "--held", held, "--seal-cmd", SEAL], capture().io)).rejects.toMatchObject({ code: "E_TBV_INPUT" });
    expect([existsSync(join(plain, "astra-readings.json")), existsSync(join(plain, "astra-key.json")), existsSync(held)]).toEqual([false, false, false]);
  });
  test("r78 refuses a missing --astra and an incomplete Astra run", async () => {
    const { f, dir, argv } = files();
    await expect(run(without(argv, "--astra"), capture().io)).rejects.toMatchObject({ code: "E_TBV_INPUT" });
    writeFileSync(join(dir, "astra.ndjson"), f.astra.filter((j) => j.packet !== "p1").map((j) => JSON.stringify(j)).join("\n") + "\n");
    await expect(run(argv, capture().io)).rejects.toMatchObject({ code: "E_TBV_INPUT", message: expect.stringContaining("Astra run is incomplete") });
  });
});
