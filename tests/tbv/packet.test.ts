// Copyright (c) 2026 Garry Tan. MIT License.
// Packets (prereg section 7): the boundary line, the oracle report, blind first, D2 and control packets, and the packet
// key kept apart from the packets.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOUNDARY, buildPackets, oracleReport, run, withBoundary, writePackets } from "../../lanes/tbv/packet.ts";
import * as rule from "../../lanes/tbv/rule.ts";
import { BUNDLE, JUDGE_OF, otherJudge, type Packet, type PacketKeyEntry } from "../../lanes/tbv/types.ts";
import { capture, cleanup, KEY, keyFor, MANIFEST, record, REPO, tmp, words } from "./s4-helpers.ts";

afterAll(cleanup);
const STOCK = readFileSync(join(REPO, BUNDLE.stock.path), "utf8");
const doubleRead = (label: string) => (rule as unknown as { doubleRead: (l: string) => boolean }).doubleRead(label);

describe("boundary and oracle", () => {
  test("the boundary line sits right after the 250th word and removing it gives the reply back", () => {
    const reply = "Intro | --\n" + words(300);
    const b = withBoundary(reply);
    expect(BOUNDARY).toBe("<<<BOUNDARY>>>");
    const [before, after] = b.split("\n" + BOUNDARY + "\n");
    expect(rule.words(before!)).toBe(250);
    expect(before!.endsWith("word249")).toBe(true);
    expect(after!.startsWith(" word250")).toBe(true);
    expect(b.replace("\n" + BOUNDARY + "\n", "")).toBe(reply);
    expect(b.split(BOUNDARY).length).toBe(2);
  });
  test("a reply under 250 words gets the boundary at its end", () => {
    expect(withBoundary("Short reply.")).toBe("Short reply.\n" + BOUNDARY + "\n");
  });
  test("the oracle report joins the fact statements in key order, cut to 250 words", () => {
    expect(oracleReport(KEY)).toBe(KEY.facts.map((f) => f.statement).join(" "));
    const long = { ...KEY, facts: KEY.facts.map((f) => ({ ...f, statement: words(120, "s") })) };
    expect(rule.words(oracleReport(long))).toBe(250);
  });
});

describe("buildPackets", () => {
  const keys = { "task-alpha": KEY, "task-beta": keyFor("task-beta", { list: null }) };
  const recs = [
    record({ model: "opus", arm: "current" }),
    record({ model: "sol", task: "task-beta", texts: { report: "beta report", d1: null, d2: null } }),
    record({ cls: "no-report", texts: { report: null, d1: null, d2: null } }),
    record({ cls: "gap", responseIds: [] }),
  ];
  const built = () => buildPackets({ records: recs, keys, controlTaskIds: ["task-alpha"], stock: STOCK, doubleRead: () => false });
  test("one first packet per scored reading, a D2 packet when D2 answered, two controls per control task", () => {
    const { packets, entries } = built();
    const kinds = entries.map((e) => e.kind + ":" + e.label);
    expect(kinds.filter((k) => k.startsWith("first:")).sort()).toEqual(["first:" + recs[0]!.label, "first:" + recs[1]!.label].sort());
    expect(kinds.filter((k) => k.startsWith("d2:"))).toEqual(["d2:" + recs[0]!.label]);
    expect(kinds.filter((k) => k.startsWith("control:")).sort()).toEqual(["control:oracle:task-alpha", "control:stock:task-alpha"]);
    expect(packets.length).toBe(entries.length);
  });
  test("a first packet holds the digest, facts and traps with ids, the bounded reply and D1, and nothing that names the arm, model, task or label", () => {
    const { packets, entries } = built();
    const e = entries.find((x) => x.label === recs[0]!.label && x.kind === "first")!;
    const p = packets.find((x) => x.id === e.packet)!;
    expect(p.schema).toBe("tbv-packet.v1");
    expect(p.digest).toBe(KEY.digest);
    expect(p.facts).toEqual(KEY.facts.map((f) => ({ id: f.id, statement: f.statement })));
    expect(p.traps).toEqual([{ id: "T1", claim: KEY.traps[0]!.claim }]);
    expect(p.list).toEqual(KEY.list);
    expect(p.reply).toBe(withBoundary(recs[0]!.texts.report!));
    expect(p.d1).toBe(recs[0]!.texts.d1);
    for (const q of packets) {
      const s = JSON.stringify(q);
      for (const bad of ["task-alpha", "task-beta", "opus", "sol", "particle", "current", recs[0]!.label, "tbv-hr"]) expect(s).not.toContain(bad);
    }
    const second = packets.find((x) => x.id === entries.find((y) => y.label === recs[1]!.label)!.packet)!;
    expect(second.d1).toBeNull();
    expect(second.list).toBeNull();
  });
  test("the D2 packet is small: the digest and D2's reply, no facts, traps or list", () => {
    const { packets, entries } = built();
    const p = packets.find((x) => x.id === entries.find((e) => e.kind === "d2")!.packet)!;
    expect(p).toMatchObject({ kind: "d2", digest: KEY.digest, facts: [], traps: [], list: null, d1: null, reply: "Nothing else to add." });
  });
  test("controls: the stock report verbatim and the oracle report, both bounded, read by both judges", () => {
    const { packets, entries } = built();
    const stock = entries.find((e) => e.label === "stock:task-alpha")!;
    const oracle = entries.find((e) => e.label === "oracle:task-alpha")!;
    expect(packets.find((p) => p.id === stock.packet)!.reply).toBe(withBoundary(STOCK));
    expect(packets.find((p) => p.id === oracle.packet)!.reply).toBe(withBoundary(oracleReport(KEY)));
    for (const e of [stock, oracle]) expect([e.primary, e.second].sort()).toEqual(["opus", "sol"]);
  });
  test("packet ids are random and distinct; the judge is JUDGE_OF the model", () => {
    const a = built();
    const b = built();
    const ids = a.entries.map((e) => e.packet);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16,}$/);
    expect(a.entries.map((e) => e.packet)).not.toEqual(b.entries.map((e) => e.packet));
    expect(a.entries.find((e) => e.label === recs[0]!.label)!.primary).toBe(JUDGE_OF.opus);
    expect(a.entries.find((e) => e.label === recs[1]!.label)!.primary).toBe(JUDGE_OF.sol);
  });
  test("the second judge follows rule.ts doubleRead on the reading's label (needs doubleRead in rule.ts)", () => {
    const many = Array.from({ length: 40 }, () => record());
    const { entries } = buildPackets({ records: many, keys, controlTaskIds: [], stock: STOCK });
    for (const e of entries.filter((x) => x.kind === "first")) expect(e.second).toBe(doubleRead(e.label) ? otherJudge(e.primary) : null);
  });
  test("refuses a scored reading whose task has no key", () => {
    expect(() => buildPackets({ records: [record({ task: "task-gamma" })], keys, controlTaskIds: [], stock: STOCK, doubleRead: () => false })).toThrow(expect.objectContaining({ code: "E_TBV_INPUT" }));
  });
});

describe("writePackets and run", () => {
  const one = () => buildPackets({ records: [record()], keys: { "task-alpha": KEY }, controlTaskIds: [], stock: "stock", doubleRead: () => false });
  test("refuses a packet key inside the packets directory", () => {
    const dir = tmp("tbv-packets-");
    for (const key of [join(dir, "p", "key.json"), join(dir, "p", "sub", "key.json")]) expect(() => writePackets(join(dir, "p"), key, one())).toThrow(expect.objectContaining({ code: "E_TBV_JUDGE" }));
  });
  test("writes one file per packet whose sha256 the key records, and the key apart", () => {
    const dir = tmp("tbv-packets-");
    const built = one();
    writePackets(join(dir, "p"), join(dir, "key.json"), built);
    const files = readdirSync(join(dir, "p")).sort();
    expect(files).toEqual(built.entries.map((e) => e.packet + ".json").sort());
    const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8")) as { entries: PacketKeyEntry[] };
    for (const e of key.entries) expect(createHash("sha256").update(readFileSync(join(dir, "p", e.packet + ".json"))).digest("hex")).toBe(e.sha256);
    expect((JSON.parse(readFileSync(join(dir, "p", files[0]!), "utf8")) as Packet).schema).toBe("tbv-packet.v1");
  });
  test("run reads records, keys and the split manifest and writes the packets", async () => {
    const dir = tmp("tbv-packets-run-");
    mkdirSync(join(dir, "keys"));
    writeFileSync(join(dir, "keys", "task-alpha.json"), JSON.stringify(KEY));
    writeFileSync(join(dir, "records.ndjson"), [record(), record({ cls: "gap" })].map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(dir, "split.json"), JSON.stringify(MANIFEST));
    const argv = ["packets", "--records", join(dir, "records.ndjson"), "--keys", join(dir, "keys"), "--split", join(dir, "split.json"), "--out", join(dir, "packets"), "--key", join(dir, "packet-key.json")];
    const c = capture();
    expect(await run(argv, c.io)).toBe(0);
    expect(readdirSync(join(dir, "packets")).length).toBe(4);
    await expect(run([...argv.slice(0, -1), join(dir, "packets2", "k.json")].map((a) => (a === join(dir, "packets") ? join(dir, "packets2") : a)), c.io)).rejects.toMatchObject({ code: "E_TBV_JUDGE" });
  });
});
