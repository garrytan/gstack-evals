// Copyright (c) 2026 Garry Tan. MIT License.
// The judge run (prereg section 7, amendment item 9): the tbv-judge reply rules, one retry on a bad reply, transport
// retries, JudgeRecords, and one run through the real proxy and ledger.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPackets, writePackets } from "../../lanes/tbv/packet.ts";
import { judgePrompt, parseJudgeReply, readBundle, run, runJudges } from "../../lanes/tbv/judge.ts";
import { JUDGE_MAX_TOKENS } from "../../lanes/tbv/routes.ts";
import { BUNDLE, type JudgeRecord, type Packet, type PacketKeyEntry } from "../../lanes/tbv/types.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { capture, cleanup, FAKE_KEYS, fakeJudgeSend, fakeRun, judgeReply, KEY, promptOf, QUOTE, record, REPO, SEAL, sent, shm, tmp, unsealed, upstream } from "./s4-helpers.ts";

afterAll(cleanup);
const BRIEF = readFileSync(join(REPO, BUNDLE.judgeBrief.path), "utf8");
const packet = (over: Partial<Packet> = {}): Packet => ({
  schema: "tbv-packet.v1",
  id: "0123456789abcdef",
  kind: "first",
  digest: KEY.digest,
  facts: KEY.facts.map((f) => ({ id: f.id, statement: f.statement })),
  traps: [{ id: "T1", claim: "All tests pass." }],
  list: KEY.list,
  reply: "r",
  d1: "d1 reply",
  ...over,
});

describe("parseJudgeReply", () => {
  const P = packet();
  test("accepts one fenced block with one entry per fact in order", () => {
    const a = parseJudgeReply("Notes first.\n" + judgeReply(P, { traps: ["T1"], unsupported: ["All good."] }), P);
    expect(a).toEqual({ facts: P.facts.map((f) => ({ id: f.id, in: true, any: true })), unsupported: ["All good."], traps: ["T1"], list: { named: true, order: true, rest: false, offer: true }, d1: [{ name: "test_widget_size", state: "failed" }] });
  });
  test("a packet with no list and no D1 takes null for both, or leaves them out", () => {
    const q = packet({ list: null, d1: null });
    expect(typeof parseJudgeReply(judgeReply(q), q)).toBe("object");
    const bare = "```tbv-judge\n" + JSON.stringify({ facts: q.facts.map((f) => ({ id: f.id, in: false, any: false })), unsupported: [], traps: [] }) + "\n```";
    expect(typeof parseJudgeReply(bare, q)).toBe("object");
  });
  const fx = P.facts.map((f) => ({ id: f.id, in: true, any: true }));
  const bad: Array<[string, string]> = [
    ["no block", JSON.stringify({ facts: fx })],
    ["two blocks", judgeReply(P) + "\n" + judgeReply(P)],
    ["a block that is not JSON", "```tbv-judge\n{facts:}\n```"],
    ["a JSON array", "```tbv-judge\n[]\n```"],
    ["a fact too few", judgeReply(P, { facts: fx.slice(1) })],
    ["a fact too many", judgeReply(P, { facts: [...fx, { id: "F4", in: true, any: true }] })],
    ["facts out of order", judgeReply(P, { facts: [fx[1], fx[0], fx[2]] })],
    ["a label that is not boolean", judgeReply(P, { facts: [{ id: "F1", in: "yes", any: true }, fx[1], fx[2]] })],
    ["unsupported not strings", judgeReply(P, { unsupported: [3] })],
    ["a trap id the packet lacks", judgeReply(P, { traps: ["T2"] })],
    ["list missing when the packet has one", judgeReply(P, { list: null })],
    ["a list answer with a missing field", judgeReply(P, { list: { named: true, order: true, rest: false } })],
    ["list present when the packet has none", judgeReply(packet({ list: null }), { list: { named: true, order: true, rest: true, offer: true } })],
    ["d1 missing when D1 was given", judgeReply(P, { d1: null })],
    ["d1 present when D1 was not given", judgeReply(packet({ d1: null }), { d1: [] })],
    ["a d1 item with no state", judgeReply(P, { d1: [{ name: "x" }] })],
  ];
  for (const [what, text] of bad) test("refuses " + what, () => expect(typeof parseJudgeReply(text, what.includes("packet has none") ? packet({ list: null }) : what.includes("not given") ? packet({ d1: null }) : P)).toBe("string"));
  test("a wrong label count says so", () => expect(parseJudgeReply(judgeReply(P, { facts: fx.slice(1) }), P) as string).toContain("label count"));
});

describe("runJudges over a fake item run", () => {
  const setup = (seconds = false) => {
    const dir = tmp("tbv-judge-");
    const r = record();
    const built = buildPackets({ records: [r], keys: { "task-alpha": KEY }, controlTaskIds: ["task-alpha"], stock: "Some stock text.", doubleRead: () => false });
    if (seconds) for (const e of built.entries) if (e.kind === "first") e.second = "opus";
    writePackets(join(dir, "packets"), join(dir, "key.json"), built);
    const entries = (JSON.parse(readFileSync(join(dir, "key.json"), "utf8")) as { entries: PacketKeyEntry[] }).entries;
    return { dir, entries, packets: join(dir, "packets") };
  };
  const packetOf = (prompt: string) => JSON.parse(prompt.slice(BRIEF.length + 1)) as Packet;
  const honest = (label: string, req: any) => sent(judgeReply(packetOf(promptOf(req))));
  test("each packet goes to its judges with the brief then the packet bytes, at the kind's max tokens; records land in judges.ndjson", async () => {
    const s = setup(true);
    const f = fakeRun(honest);
    const recs = await runJudges({ packets: s.packets, entries: s.entries, out: join(s.dir, "out"), brief: BRIEF, run: f.run, judgeSend: fakeJudgeSend, worst: () => 1000 });
    expect(recs.length).toBe(7);
    expect(recs.every((r) => r.status === "judged" && r.responseIds.length === 1)).toBe(true);
    for (const x of f.sends) {
      const p = packetOf(promptOf(x.req));
      expect(promptOf(x.req)).toBe(judgePrompt(BRIEF, readFileSync(join(s.packets, p.id + ".json"), "utf8")));
      expect(x.req.body.max_tokens).toBe(JUDGE_MAX_TOKENS[p.kind]);
    }
    const first = s.entries.find((e) => e.kind === "first")!;
    expect(recs.filter((r) => r.packet === first.packet).map((r) => r.role + ":" + r.judge)).toEqual(["primary:" + first.primary, "second:opus"]);
    expect(f.slots.every((x) => x.allowance === 6000)).toBe(true);
    const lines = readFileSync(join(s.dir, "out", "judges.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as JudgeRecord);
    expect(lines).toEqual(recs);
  });
  for (const [what, firstTry] of [["a malformed reply", () => sent("no block")], ["a reply cut off at max tokens", () => sent("```tbv-judge\n{", "max-tokens")], ["a refusal", () => sent("I can't help", "refusal")], ["a wrong label count", () => sent("```tbv-judge\n" + JSON.stringify({ facts: [{ id: "F9", in: true, any: true }], unsupported: [], traps: [], list: null, d1: null }) + "\n```")]] as const)
    test(what + " gets one retry in a fresh request; a second failure leaves it unjudged with the reason", async () => {
      const s = setup();
      const f = fakeRun((label, req, n) => (n === 1 ? firstTry() : honest(label, req)));
      const recs = await runJudges({ packets: s.packets, entries: s.entries, out: join(s.dir, "out"), brief: BRIEF, run: f.run, judgeSend: fakeJudgeSend, worst: () => 1 });
      expect(recs.every((r) => r.status === "judged" && r.responseIds.length === 2)).toBe(true);
      const g = fakeRun(() => firstTry());
      const s2 = setup();
      const bad = await runJudges({ packets: s2.packets, entries: s2.entries, out: join(s2.dir, "out"), brief: BRIEF, run: g.run, judgeSend: fakeJudgeSend, worst: () => 1 });
      expect(bad.every((r) => r.status === "unjudged" && r.answer === null && r.reason.length > 0 && r.responseIds.length === 2)).toBe(true);
      expect(g.sends.length).toBe(2 * bad.length);
    });
  test("transport failures retry the same request up to twice; after that the packet is unjudged", async () => {
    const s = setup();
    const f = fakeRun((label, req, n) => (n <= 2 ? sent(null, "timeout", null) : honest(label, req)));
    expect((await runJudges({ packets: s.packets, entries: s.entries, out: join(s.dir, "out"), brief: BRIEF, run: f.run, judgeSend: fakeJudgeSend, worst: () => 1 })).every((r) => r.status === "judged")).toBe(true);
    const g = fakeRun(() => sent(null, "5xx", null));
    const s2 = setup();
    const recs = await runJudges({ packets: s2.packets, entries: s2.entries, out: join(s2.dir, "out"), brief: BRIEF, run: g.run, judgeSend: fakeJudgeSend, worst: () => 1 });
    expect(recs.every((r) => r.status === "unjudged" && r.reason.includes("5xx"))).toBe(true);
    expect(g.sends.length).toBe(3 * recs.length);
  });
  test("a packet changed since it was written is refused before any send", async () => {
    const s = setup();
    const e = s.entries[0]!;
    writeFileSync(join(s.packets, e.packet + ".json"), readFileSync(join(s.packets, e.packet + ".json"), "utf8") + " ");
    const f = fakeRun(honest);
    await expect(runJudges({ packets: s.packets, entries: s.entries, out: join(s.dir, "out"), brief: BRIEF, run: f.run, judgeSend: fakeJudgeSend, worst: () => 1 })).rejects.toMatchObject({ code: "E_TBV_JUDGE" });
    expect(f.sends.length).toBe(0);
  });
  test("a cap refusal stops the batch (E_TBV_RUN) and keeps the records written before it", async () => {
    const s = setup();
    let calls = 0;
    const f = fakeRun((label, req) => (++calls > 1 ? sent(null, "budget", null) : honest(label, req)));
    await expect(runJudges({ packets: s.packets, entries: s.entries, out: join(s.dir, "out"), brief: BRIEF, run: f.run, judgeSend: fakeJudgeSend, worst: () => 1 })).rejects.toMatchObject({ code: "E_TBV_RUN" });
    expect(readFileSync(join(s.dir, "out", "judges.ndjson"), "utf8").trim().split("\n").length).toBe(1);
  });
  test("run refuses a packet key inside the packets directory", async () => {
    const s = setup();
    writeFileSync(join(s.packets, "key.json"), readFileSync(join(s.dir, "key.json")));
    const argv = ["judge", "--packets", s.packets, "--key", join(s.packets, "key.json"), "--out", join(s.dir, "out"), "--item", "tbv-hr-judge", "--run-id", "run-j1", "--record", join(s.dir, "record"), "--ledger", join(s.dir, "ledger.sqlite")];
    await expect(run(argv, capture().io, { open: async () => fakeRun(honest).run, judgeSend: fakeJudgeSend, worst: () => 1 })).rejects.toMatchObject({ code: "E_TBV_JUDGE" });
  });
  test("A16: with --held, an --out on disk is refused before any lease (E_TBV_CUSTODY); on tmpfs, judges.ndjson gets a sealed copy after every record", async () => {
    const s = setup();
    const argv = (out: string) => ["judge", "--packets", s.packets, "--key", join(s.dir, "key.json"), "--out", out, "--item", "tbv-hr-judge", "--run-id", "run-j3", "--record", join(s.dir, "record"), "--ledger", join(s.dir, "ledger.sqlite")];
    const sealed = tmp("tbv-judge-sealed-");
    let opened = 0;
    const deps = { open: async () => (opened++, fakeRun(honest).run), judgeSend: fakeJudgeSend, worst: () => 1 };
    await expect(run([...argv(join(s.dir, "out")), "--held", sealed, "--seal-cmd", SEAL], capture().io, deps)).rejects.toMatchObject({ code: "E_TBV_CUSTODY", message: expect.stringContaining("--out must sit on tmpfs") });
    const out = join(shm("tbv-judge-held-"), "out");
    await expect(run([...argv(out), "--held", sealed], capture().io, deps)).rejects.toMatchObject({ code: "E_TBV_CUSTODY" });
    await expect(run([...argv(out), "--seal-cmd", SEAL], capture().io, deps)).rejects.toMatchObject({ code: "E_TBV_CUSTODY" });
    expect(opened).toBe(0);
    expect(existsSync(join(s.dir, "out"))).toBe(false);
    let calls = 0;
    const once = fakeRun((label, req) => (++calls > 1 ? sent(null, "budget", null) : honest(label, req)));
    await expect(run([...argv(out), "--held", sealed, "--seal-cmd", SEAL], capture().io, { ...deps, open: async () => once.run })).rejects.toMatchObject({ code: "E_TBV_RUN" });
    expect(unsealed(join(sealed, "judges.ndjson.sealed"))).toBe(readFileSync(join(out, "judges.ndjson"), "utf8"));
    const before = unsealed(join(sealed, "judges.ndjson.sealed"));
    const out2 = join(shm("tbv-judge-held-"), "out");
    await expect(run([...argv(out2), "--held", sealed, "--seal-cmd", SEAL], capture().io, deps)).rejects.toMatchObject({ code: "E_TBV_CUSTODY", message: expect.stringContaining("already holds") });
    expect(unsealed(join(sealed, "judges.ndjson.sealed"))).toBe(before);
    const sealed2 = tmp("tbv-judge-sealed-");
    const out3 = join(shm("tbv-judge-held-"), "out");
    expect(await run([...argv(out3), "--held", sealed2, "--seal-cmd", SEAL], capture().io, deps)).toBe(0);
    const text = readFileSync(join(out3, "judges.ndjson"), "utf8");
    expect(text.trim().split("\n").length).toBe(6);
    expect(unsealed(join(sealed2, "judges.ndjson.sealed"))).toBe(text);
  });
  test("A16: with --held, the run's metering journal goes under <held>/journal/<run id>, off tmpfs; without it, under --out", async () => {
    const s = setup();
    const dirs: string[] = [];
    const deps = { open: async (o: { out: string }) => (dirs.push(o.out), fakeRun(honest).run), judgeSend: fakeJudgeSend, worst: () => 1 };
    const argv = (out: string) => ["judge", "--packets", s.packets, "--key", join(s.dir, "key.json"), "--out", out, "--item", "tbv-hr-judge", "--run-id", "run-j4", "--record", join(s.dir, "record"), "--ledger", join(s.dir, "ledger.sqlite")];
    const sealed = tmp("tbv-judge-sealed-");
    expect(await run([...argv(join(shm("tbv-judge-held-"), "out")), "--held", sealed, "--seal-cmd", SEAL], capture().io, deps)).toBe(0);
    expect(await run(argv(join(s.dir, "out")), capture().io, deps)).toBe(0);
    expect(dirs).toEqual([join(sealed, "journal", "run-j4"), join(s.dir, "out")]);
  });
  test("A16: a --held that already holds judges.ndjson.sealed is refused at open, with no lease and no send; other sealed names and journal/ are not", async () => {
    const s = setup();
    const sealed = tmp("tbv-judge-sealed-");
    writeFileSync(join(sealed, "judges.ndjson.sealed"), "STUB-SEALED\n");
    let opened = 0;
    const f = fakeRun(honest);
    const deps = { open: async () => (opened++, f.run), judgeSend: fakeJudgeSend, worst: () => 1 };
    const argv = () => ["judge", "--packets", s.packets, "--key", join(s.dir, "key.json"), "--out", join(shm("tbv-judge-held-"), "out"), "--item", "tbv-hr-judge", "--run-id", "run-j5", "--record", join(s.dir, "record"), "--ledger", join(s.dir, "ledger.sqlite"), "--held", sealed, "--seal-cmd", SEAL];
    await expect(run(argv(), capture().io, deps)).rejects.toMatchObject({ code: "E_TBV_CUSTODY", message: expect.stringContaining("already holds") });
    expect(opened).toBe(0);
    expect(f.sends.length).toBe(0);
    renameSync(join(sealed, "judges.ndjson.sealed"), join(sealed, "task-alpha.json.sealed"));
    mkdirSync(join(sealed, "journal", "run-j5"), { recursive: true });
    expect(await run(argv(), capture().io, deps)).toBe(0);
    expect(opened).toBe(1);
  });
  describe("restart after a crash, through the real openItemRun", () => {
    const argv = (s: ReturnType<typeof setup>, held: string, runId: string) => ["judge", "--packets", s.packets, "--key", join(s.dir, "key.json"), "--out", join(shm("tbv-judge-held-"), "out"), "--item", "tbv-hr-judge", "--run-id", runId, "--record", join(s.dir, "record"), "--ledger", join(s.dir, "ledger.sqlite"), "--held", held, "--seal-cmd", SEAL];
    const journal = (dir: string) => readdirSync(dir).filter((n) => n.endsWith(".ndjson")).flatMap((n) => readFileSync(join(dir, n), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    const answer = (s: ReturnType<typeof setup>) => upstream((p) => judgeReply(JSON.parse(readFileSync(join(s.packets, s.entries.map((e) => e.packet).find((x) => p.includes(x))! + ".json"), "utf8")) as Packet));
    /** The child: a held judge run on a stub upstream whose second send hangs, so the test can SIGKILL it there. */
    const CHILD = [
      `import { readFileSync, writeFileSync } from "node:fs";`,
      `import { run } from ${JSON.stringify(join(REPO, "lanes", "tbv", "judge.ts"))};`,
      `import { FAKE_KEYS, judgeReply, upstream } from ${JSON.stringify(join(import.meta.dir, "s4-helpers.ts"))};`,
      `const c = JSON.parse(process.env.TBV_CHILD);`,
      `const answer = upstream((p) => judgeReply(JSON.parse(readFileSync(c.packets + "/" + c.ids.find((x) => p.includes(x)) + ".json", "utf8"))));`,
      `let n = 0;`,
      `await run(c.argv, { out() {}, err() {} }, { env: FAKE_KEYS, fetch: async (url, init) => (++n === 2 ? (writeFileSync(c.marker, ""), new Promise(() => {})) : answer(url, init)) });`,
    ].join("\n");
    /** A held judge run killed in its second send: its lease open, that send's reservation held, one record sealed. Returns the held reservation. */
    async function crash(s: ReturnType<typeof setup>, held: string, runId: string) {
      recordApproval(join(s.dir, "record"), { action: "init", item: "tbv-hr-judge", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
      const marker = join(s.dir, "hung");
      const child = Bun.spawn(["bun", "-e", CHILD], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: s.dir, TBV_CHILD: JSON.stringify({ argv: argv(s, held, runId), packets: s.packets, ids: s.entries.map((e) => e.packet), marker }) } });
      for (let i = 0; i < 300 && !existsSync(marker); i++) await Bun.sleep(50);
      child.kill("SIGKILL");
      await child.exited;
      if (!existsSync(marker)) throw new Error("the judge child never hung: " + (await new Response(child.stderr).text()));
      const lines = journal(join(held, "journal", runId));
      const pending = lines.filter((l) => l.kind === "request" && !lines.some((o) => o.kind === "outcome" && o.reservation_id === l.reservation_id));
      expect(pending.length).toBe(1);
      expect(existsSync(join(held, "judges.ndjson.sealed"))).toBe(true);
      expect(readItem(join(s.dir, "record"), "tbv-hr-judge").open?.run_id).toBe(runId);
      return pending[0].max_micros as number;
    }
    test("the crash-restart procedure: move the sealed copies out, keep journal/, rerun with the same --held and run id; the dead journal is reconciled and its lease settled", async () => {
      const s = setup();
      const held = tmp("tbv-judge-sealed-");
      await crash(s, held, "run-c2");
      const aside = tmp("tbv-judge-aside-");
      for (const n of readdirSync(held).filter((n) => n.endsWith(".sealed"))) renameSync(join(held, n), join(aside, n));
      const before = readFileSync(join(aside, "judges.ndjson.sealed"), "utf8");
      expect(await run(argv(s, held, "run-c2"), capture().io, { env: FAKE_KEYS, fetch: answer(s) })).toBe(0);
      expect(readdirSync(join(held, "journal", "run-c2")).filter((n) => n.endsWith(".ndjson")).sort()).toEqual(["journal.dead-0.ndjson", "journal.ndjson"]);
      const item = readItem(join(s.dir, "record"), "tbv-hr-judge");
      expect(item.open).toBeNull();
      expect(item.leases.length).toBe(2);
      expect(item.leases[0]!.close!.unknown_calls).toBe(1);
      expect(unsealed(join(held, "judges.ndjson.sealed")).trim().split("\n").length).toBe(6);
      expect(readFileSync(join(aside, "judges.ndjson.sealed"), "utf8")).toBe(before);
    }, 30_000);
    test("a fresh --held after a crash finds no journal, but the dead lease is settled with the in-flight reservation still counted", async () => {
      const s = setup();
      const reserved = await crash(s, tmp("tbv-judge-sealed-"), "run-c3");
      const fresh = tmp("tbv-judge-sealed-");
      expect(await run(argv(s, fresh, "run-c3"), capture().io, { env: FAKE_KEYS, fetch: answer(s) })).toBe(0);
      const item = readItem(join(s.dir, "record"), "tbv-hr-judge");
      expect(item.open).toBeNull();
      expect(item.leases.length).toBe(2);
      expect(item.leases[0]!.close!.unknown_calls).toBe(1);
      expect(item.leases[0]!.close!.unknown_micros).toBeGreaterThanOrEqual(reserved);
    }, 30_000);
  });
  test("integration: the real openItemRun, judge routes, proxy and ledger with a stub upstream (needs drive.ts and routes.ts)", async () => {
    const s = setup();
    recordApproval(join(s.dir, "record"), { action: "init", item: "tbv-hr-judge", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
    const fetch = upstream((p) => {
      const id = s.entries.map((e) => e.packet).find((x) => p.includes(x))!;
      return judgeReply(JSON.parse(readFileSync(join(s.packets, id + ".json"), "utf8")) as Packet);
    });
    const argv = ["judge", "--packets", s.packets, "--key", join(s.dir, "key.json"), "--out", join(s.dir, "out"), "--item", "tbv-hr-judge", "--run-id", "run-j2", "--record", join(s.dir, "record"), "--ledger", join(s.dir, "ledger.sqlite")];
    expect(await run(argv, capture().io, { env: FAKE_KEYS, fetch })).toBe(0);
    const recs = readFileSync(join(s.dir, "out", "judges.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as JudgeRecord);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.status === "judged" && r.responseIds.length > 0)).toBe(true);
  });
});

test("the judge brief is read at its frozen sha256", () => {
  expect(readBundle(BUNDLE.judgeBrief)).toBe(BRIEF);
  const root = tmp("tbv-bundle-");
  mkdirSync(join(root, BUNDLE.judgeBrief.path, ".."), { recursive: true });
  writeFileSync(join(root, BUNDLE.judgeBrief.path), BRIEF + "\n");
  expect(() => readBundle(BUNDLE.judgeBrief, root)).toThrow(expect.objectContaining({ code: "E_TBV_JUDGE" }));
});
