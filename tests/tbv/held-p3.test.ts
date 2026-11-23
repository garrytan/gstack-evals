// Copyright (c) 2026 Garry Tan. MIT License.
// tbv-held-p3 (the scorer pin post left its command not settled): Opus's third skill-layer pass runs as its own item with
// drive --first-pass 3, so passes 1 and 2 stay tbv-held's; its readings are packeted with --controls none, judged under
// tbv-held-p3, and readings joins both packet keys and both judge files into one held-out readings file. Keyless: the
// driver runs on the scripted provider stub behind the real metering proxy, and the judges are stub replies the real judge
// parser reads.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readingOrder, run as drive, runItem, type DrivePlan } from "../../lanes/tbv/drive.ts";
import { parseJudgeReply } from "../../lanes/tbv/judge.ts";
import { run as packets } from "../../lanes/tbv/packet.ts";
import { run as readings } from "../../lanes/tbv/readings.ts";
import type { Arm, JudgeRecord, Model, Packet, PacketKeyEntry, ReadingRecord, ReadingsFile } from "../../lanes/tbv/types.ts";
import { cleanup as driveCleanup, clock, fakeBuild, history, KEYS, ledgerDir, shape, stub, text, TURNS, type Script } from "./drive-fixture.ts";
import { capture, cleanup, judgeReply, KEY, keyFor, record, tmp, words } from "./s4-helpers.ts";

afterAll(() => {
  cleanup();
  driveCleanup();
});

const ITEM = "tbv-held-p3";
const plan = (o: { firstPass?: number; passes?: number; arms?: Arm[]; tasks?: string[] } = {}): DrivePlan => ({
  item: ITEM,
  tasks: (o.tasks ?? ["t1", "t2"]).map((t) => history(t)),
  arms: o.arms ?? ["none", "current"],
  models: ["opus"],
  passes: { opus: o.passes ?? 3 },
  ...(o.firstPass === undefined ? {} : { firstPass: o.firstPass }),
  turns: TURNS,
  shape: (a) => shape(a),
  splice: () => null,
  roundWorstMicros: 1,
});
async function go(p: DrivePlan, script: Script) {
  const L = ledgerDir(ITEM, 50);
  const s = stub(script);
  const c = clock();
  return runItem({ item: ITEM, runId: "p3-run-1", record: L.record, ledger: L.ledger, out: L.out, env: KEYS, fetch: s.fetch, sleep: c.sleep, now: c.now, plan: p, plaintext: L.plain, sealCmd: null, unsealCmd: null, devPlaintext: true, held: false, deps: { build: fakeBuild, validate: () => ({ ok: true }), closer: () => true }, log: () => {} });
}

describe("drive --first-pass", () => {
  test("the reading order starts at the first pass; with none given it is passes 1 to N as before", () => {
    expect(readingOrder(plan({ firstPass: 3 })).map((r) => r.task + " " + r.arm + " " + r.pass)).toEqual(["t1 none 3", "t1 current 3", "t2 none 3", "t2 current 3"]);
    expect(readingOrder(plan()).map((r) => r.pass)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
  });

  test("an item run at --first-pass 3 sends and records only pass 3, every reading scored", async () => {
    const res = await go(plan({ firstPass: 3 }), () => text());
    expect(res.records.map((r) => [r.task, r.arm, r.pass, r.cls, r.item])).toEqual([["t1", "none", 3, "scored", ITEM], ["t1", "current", 3, "scored", ITEM], ["t2", "none", 3, "scored", ITEM], ["t2", "current", 3, "scored", ITEM]]);
    expect(res.stop).toBeNull();
  });

  test("the first pass's report turn still finishes before a later pass of that task, arm and model starts", async () => {
    const events: string[] = [];
    const script: Script = async (c) => {
      events.push("start " + c.arm + " " + c.turn + " " + c.n);
      await Bun.sleep(c.turn === "report" && c.n === 1 ? 40 : 2);
      events.push("end " + c.arm + " " + c.turn + " " + c.n);
      return text();
    };
    const res = await go(plan({ firstPass: 2, arms: ["none"], tasks: ["t1"] }), script);
    expect(res.records.map((r) => r.pass)).toEqual([2, 3]);
    const firstEnd = events.indexOf("end none report 1");
    expect(events[0]).toBe("start none report 1");
    expect(events.filter((e, i) => e.startsWith("start ") && i > 0).every((e) => events.indexOf(e) > firstEnd)).toBe(true);
  });

  test("--first-pass refuses 0, a non-number and a pass past any model's --passes, before anything opens", async () => {
    const argv = (fp: string, passes = "opus=3") => ["drive", "--models", "opus,sol", "--arms", "none", "--passes", passes.includes("sol") ? passes : passes + ",sol=3", "--first-pass", fp];
    for (const [fp, passes] of [["0", "opus=3"], ["x", "opus=3"], ["4", "opus=3"], ["3", "opus=3,sol=2"], ["1.5", "opus=3"]] as const) {
      await expect(drive(argv(fp, passes), { out: () => {}, err: () => {} })).rejects.toMatchObject({ code: "E_TBV_INPUT", message: expect.stringContaining("--first-pass") });
    }
  });
});

// ---------- the p3 chain: two packet batches, two judge runs, one readings file ----------

const NF = KEY.facts.length;
type Row = { id: string; cluster: string; source: "A" | "B"; stratum: string; nfacts: number };
const TASKS: Row[] = [
  { id: "held-a0", cluster: "ca0", source: "A", stratum: "long", nfacts: NF },
  { id: "held-a1", cluster: "ca1", source: "A", stratum: "other", nfacts: NF },
  { id: "held-b0", cluster: "cb0", source: "B", stratum: "other", nfacts: NF },
  { id: "held-b1", cluster: "cb1", source: "B", stratum: "short", nfacts: NF },
];
const SPLIT = JSON.stringify({ schema: "tbv-split.v1", stage: "held", tasks: TASKS, controlTaskIds: ["held-a0", "held-b0"] }, null, 2);
let resp = 0;
const REPORT: Record<string, string> = { none: "", current: "STATUS: DONE\n", principle: "Verified: the suite ran.\n" };
const fam = (t: Row) => (t.source === "A" ? "investigate" : "ship");
const rec = (item: string, t: Row, family: string, arm: string, model: Model, pass: number): ReadingRecord =>
  record({ label: [item, t.id, family, arm, model, pass].join("."), item, task: t.id, family: family as ReadingRecord["family"], arm: arm as Arm, model, pass, texts: { report: (family === "capy" && arm === "current" ? "Unverified: the rerun\n" : REPORT[arm]) + words(60), d1: "d1 states", d2: "Nothing else to add." }, responseIds: ["resp-" + ++resp] });
const ARMS = ["none", "current", "principle"];
/** tbv-held: three arms on Opus and Sol, two passes, and capy current and principle on Opus on the source B tasks. */
const heldRecords = () => [
  ...TASKS.flatMap((t) => (["opus", "sol"] as Model[]).flatMap((m) => ARMS.flatMap((a) => [1, 2].map((p) => rec("tbv-held", t, fam(t), a, m, p))))),
  ...TASKS.filter((t) => t.source === "B").flatMap((t) => ["current", "principle"].flatMap((a) => [1, 2].map((p) => rec("tbv-held", t, "capy", a, "opus", p)))),
];
/** tbv-held-p3: Opus's third pass on the skill layer, three arms. */
const p3Records = () => TASKS.flatMap((t) => ARMS.map((a) => rec("tbv-held-p3", t, fam(t), a, "opus", 3)));
const packetOf = (dir: string, id: string) => JSON.parse(readFileSync(join(dir, id + ".json"), "utf8")) as Packet;
function judges(dir: string, entries: PacketKeyEntry[]): string {
  return entries.flatMap((e) => {
    const packet = packetOf(dir, e.packet);
    const answer = parseJudgeReply(judgeReply(packet, { facts: packet.facts.map((f, i) => ({ id: f.id, in: i < 1, any: i < 1 })) }), packet);
    if (typeof answer === "string") throw new Error("the judge parser refused a stub reply: " + answer);
    const one = (judge: string, role: "primary" | "second") => JSON.stringify({ packet: e.packet, judge, role, status: "judged", answer, responseIds: ["j-" + ++resp], reason: "" } as JudgeRecord);
    return [one(e.primary, "primary"), ...(e.second ? [one(e.second, "second")] : [])];
  }).join("\n") + "\n";
}
async function world() {
  const dir = tmp("tbv-held-p3-");
  for (const d of ["held-records", "p3-records", "records", "keys"]) mkdirSync(join(dir, d));
  const held = heldRecords(), p3 = p3Records();
  for (const r of held) for (const d of ["held-records", "records"]) writeFileSync(join(dir, d, "reading-" + r.label + ".json"), JSON.stringify(r));
  for (const r of p3) for (const d of ["p3-records", "records"]) writeFileSync(join(dir, d, "reading-" + r.label + ".json"), JSON.stringify(r));
  for (const t of TASKS) writeFileSync(join(dir, "keys", t.id + ".json"), JSON.stringify(keyFor(t.id)));
  writeFileSync(join(dir, "split.json"), SPLIT);
  writeFileSync(join(dir, "detector.txt"), "^Verified:\n");
  const batch = async (name: string, extra: string[] = []) => {
    const p = capture();
    const rc = await packets(["packets", "--records", join(dir, name + "-records"), "--keys", join(dir, "keys"), "--split", join(dir, "split.json"), "--out", join(dir, name + "-packets"), "--key", join(dir, name + "-key.json"), ...extra], p.io);
    const entries = (JSON.parse(readFileSync(join(dir, name + "-key.json"), "utf8")) as { entries: PacketKeyEntry[] }).entries;
    writeFileSync(join(dir, name + "-judges.ndjson"), judges(join(dir, name + "-packets"), entries));
    return { rc, line: p.out.join("\n"), entries };
  };
  const read = (keys: string[], js: string[], out = "readings.json") =>
    readings(["readings", "--records", join(dir, "records"), "--keys", join(dir, "keys"), "--split", join(dir, "split.json"), "--packet-key", keys.map((k) => join(dir, k + "-key.json")).join(","), "--judges", js.map((j) => join(dir, j + "-judges.ndjson")).join(","), "--out", join(dir, out), "--models", "opus,sol", "--passes", "opus=3,sol=2", "--skill-arms", "current,principle", "--capy-passes", "2", "--principle-detector", join(dir, "detector.txt")], capture().io);
  return { dir, held, p3, batch, read };
}

describe("the p3 chain", () => {
  test("p3's batch has no control packets under --controls none, and the held batch keeps the split's controls", async () => {
    const w = await world();
    const h = await w.batch("held");
    expect(h.rc).toBe(0);
    expect(h.line).toBe("packets: " + w.held.length + " first, " + w.held.length + " d2, 4 control");
    const p = await w.batch("p3", ["--controls", "none"]);
    expect(p.rc).toBe(0);
    expect(p.line).toBe("packets: 12 first, 12 d2, 0 control");
    expect(p.entries.every((e) => e.label.startsWith("tbv-held-p3."))).toBe(true);
  });

  test("readings joins both packet keys and both judge files: Opus has passes 1 to 3 on every skill arm, Sol 1 to 2, and the controls come once", async () => {
    const w = await world();
    await w.batch("held");
    await w.batch("p3", ["--controls", "none"]);
    expect(await w.read(["held", "p3"], ["held", "p3"])).toBe(0);
    const rd = JSON.parse(readFileSync(join(w.dir, "readings.json"), "utf8")) as ReadingsFile;
    expect(rd.readings.length).toBe(w.held.length + w.p3.length);
    for (const arm of ARMS) {
      const opus = rd.readings.filter((r) => r.model === "opus" && r.arm === arm && r.family !== "capy");
      expect([arm, opus.length, [...new Set(opus.map((r) => r.pass))].sort()]).toEqual([arm, 12, [1, 2, 3]]);
    }
    expect(rd.readings.every((r) => r.status === "scored")).toBe(true);
    expect(rd.controls!.length).toBe(8);
    expect(rd.plan).toMatchObject({ models: ["opus", "sol"], passes: { opus: 3, sol: 2 }, capyPasses: 2 });
  });

  test("other direction: with the held batch's key and judges alone, p3's scored readings have no packet and readings refuses", async () => {
    const w = await world();
    await w.batch("held");
    await w.batch("p3", ["--controls", "none"]);
    await expect(w.read(["held"], ["held"])).rejects.toMatchObject({ code: "E_TBV_INPUT", message: expect.stringContaining("has no first packet") });
  });

  test("a packet key or a reading's packets given twice refuses, and --controls takes only split or none", async () => {
    const w = await world();
    await w.batch("held");
    await w.batch("p3", ["--controls", "none"]);
    await expect(w.read(["held", "p3", "p3"], ["held", "p3"])).rejects.toMatchObject({ code: "E_TBV_INPUT" });
    await expect(w.read(["held", "p3"], ["held", "p3", "p3"])).rejects.toMatchObject({ code: "E_TBV_INPUT" });
    await expect(packets(["packets", "--records", join(w.dir, "p3-records"), "--keys", join(w.dir, "keys"), "--split", join(w.dir, "split.json"), "--out", join(w.dir, "x-packets"), "--key", join(w.dir, "x-key.json"), "--controls", "some"], capture().io)).rejects.toMatchObject({ code: "E_TBV_INPUT" });
  });

  test("a refusal for a batch given twice prints counts only: no task, packet or label, even when both batches carry the controls", async () => {
    const refused = async (w: Awaited<ReturnType<typeof world>>, keys: string[], js: string[]) => {
      const e = await w.read(keys, js).then(() => null, (x: { code?: string; message?: string }) => x);
      return { code: e?.code, message: String(e?.message) };
    };
    const both = await world();
    const ids = [...(await both.batch("held")).entries, ...(await both.batch("p3")).entries].map((e) => e.packet);
    const once = await world();
    ids.push(...[...(await once.batch("held")).entries, ...(await once.batch("p3", ["--controls", "none"])).entries].map((e) => e.packet));
    const got = [await refused(both, ["held", "p3"], ["held", "p3"]), await refused(once, ["held", "p3", "p3"], ["held", "p3"]), await refused(once, ["held", "p3"], ["held", "p3", "p3"])];
    expect(got.map((g) => g.code)).toEqual(["E_TBV_INPUT", "E_TBV_INPUT", "E_TBV_INPUT"]);
    for (const g of got) expect([g.message, /held-[ab]\d|stock:|tbv-held/.test(g.message) || ids.some((id) => g.message.includes(id))]).toEqual([g.message, false]);
  });
});
