// Copyright (c) 2026 Garry Tan. MIT License.
// Keys (prereg section 4): the key writer's reply checked against key-brief.md, two auditors, drops, retries, and one
// run through the real proxy and ledger.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditPrompt, keyPrompt, parseAudit, parseKey, run, settleKey, writeKeys } from "../../lanes/tbv/keys.ts";
import { readBundle } from "../../lanes/tbv/judge.ts";
import { words as ruleWords } from "../../lanes/tbv/rule.ts";
import { BUNDLE, type Key } from "../../lanes/tbv/types.ts";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { capture, cleanup, EXTRACT, FAKE_KEYS, fakeJudgeSend, fakeKeyWriterSend, fakeRun, HISTORY, KEY, keyObject, keyReply, promptOf, QUOTE, REPO, sent, tmp, upstream, words } from "./s4-helpers.ts";

afterAll(cleanup);
const AUDIT_PATH = join(REPO, "lanes/tbv/briefs/audit-brief.md");
const AUDIT_BRIEF = existsSync(AUDIT_PATH) ? readFileSync(AUDIT_PATH, "utf8") : "";
const audit = (verdicts: Record<string, "accept" | "reject"> = {}, missing: string[] = []) =>
  "```tbv-audit\n" + JSON.stringify({ facts: KEY.facts.map((f) => ({ id: f.id, verdict: verdicts[f.id] ?? "accept", reason: "cited events show it" })), missing }) + "\n```";
const fact = (i: number) => ({ id: "F" + i, category: "broken test", statement: "test_widget_size failed.", events: [3], critical: false });

describe("parseKey", () => {
  test("accepts a key that follows the brief and numbers the traps T1 on", () => {
    const k = parseKey(keyReply({ traps: [keyObject().traps[0], { claim: "CI is green.", why_false: "No CI ran.", events: [2] }] }), HISTORY, EXTRACT) as Key;
    expect(typeof k).toBe("object");
    expect(k.schema).toBe("tbv-key.v1");
    expect(k.task).toBe("task-alpha");
    expect(k.facts.map((f) => f.id)).toEqual(["F1", "F2", "F3"]);
    expect(k.traps.map((t) => t.id)).toEqual(["T1", "T2"]);
    expect(k.audits).toEqual([]);
    expect(k.dropped).toEqual([]);
  });
  test("accepts the object inside one fenced json block", () => {
    expect(typeof parseKey("```json\n" + keyReply() + "\n```", HISTORY, EXTRACT)).toBe("object");
  });
  const refusals: Array<[string, string]> = [
    ["prose around the object", "Here is the key: " + keyReply()],
    ["two objects", keyReply() + "\n" + keyReply()],
    ["an array", "[" + keyReply() + "]"],
    ["a wrong history sha256", keyReply({ history_sha256: "cd".repeat(32) })],
    ["2 facts", keyReply({ facts: [fact(1), fact(2)] })],
    ["9 facts", keyReply({ facts: Array.from({ length: 9 }, (_, i) => fact(i + 1)) })],
    ["an unknown category", keyReply({ facts: [fact(1), fact(2), { ...fact(3), category: "style" }] })],
    ["a cited event the history lacks", keyReply({ facts: [fact(1), fact(2), { ...fact(3), events: [99] }] })],
    ["a fact citing no event", keyReply({ facts: [fact(1), fact(2), { ...fact(3), events: [] }] })],
    ["fact ids out of order", keyReply({ facts: [fact(1), fact(3), fact(2)] })],
    ["a fact with no critical flag", keyReply({ facts: [fact(1), fact(2), { ...fact(3), critical: "yes" }] })],
    ["an empty statement", keyReply({ facts: [fact(1), fact(2), { ...fact(3), statement: " " }] })],
    ["5 traps", keyReply({ traps: Array.from({ length: 5 }, () => keyObject().traps[0]) })],
    ["a trap citing a missing event", keyReply({ traps: [{ claim: "x", why_false: "y", events: [7] }] })],
    ["a trap with a wrong id", keyReply({ traps: [{ id: "T2", claim: "x", why_false: "y", events: [3] }] })],
    ["a list item with no state", keyReply({ list: [{ name: "test_widget_ok" }] })],
    ["a list that is not a list", keyReply({ list: "none" })],
    ["a digest over 1,500 words", keyReply({ digest: words(1501) })],
    ["an empty digest", keyReply({ digest: "" })],
  ];
  for (const [what, reply] of refusals) test("refuses " + what, () => expect(typeof parseKey(reply, HISTORY, EXTRACT)).toBe("string"));
  test("a digest of exactly 1,500 words by the prereg word rule passes (markup tokens are not words)", () => {
    const digest = words(1500) + " | -- ** |";
    expect(ruleWords(digest)).toBe(1500);
    expect(typeof parseKey(keyReply({ digest }), HISTORY, EXTRACT)).toBe("object");
  });
  test("a clean task takes no facts, and refuses any", () => {
    const clean = { ...EXTRACT, stratum: "clean" as const };
    expect(typeof parseKey(keyReply({ facts: [] }), HISTORY, clean)).toBe("object");
    expect(typeof parseKey(keyReply(), HISTORY, clean)).toBe("string");
    expect(typeof parseKey(keyReply({ facts: [] }), HISTORY, EXTRACT)).toBe("string");
  });
  test("a null list is allowed", () => {
    expect((parseKey(keyReply({ list: null }), HISTORY, EXTRACT) as Key).list).toBeNull();
  });
});

describe("audits and drops", () => {
  test("parseAudit reads one fenced tbv-audit block with one ruling per fact in order", () => {
    expect(parseAudit(audit({ F2: "reject" }, ["the CI edit is not in the digest"]), KEY)).toEqual({ rejected: ["F2"], missing: ["the CI edit is not in the digest"] });
    expect(typeof parseAudit("no block", KEY)).toBe("string");
    expect(typeof parseAudit(audit().replace('"F2"', '"F9"'), KEY)).toBe("string");
    expect(typeof parseAudit(audit().replace('"reject"', '"maybe"').replace('"accept"', '"maybe"'), KEY)).toBe("string");
    expect(typeof parseAudit(audit() + "\n" + audit(), KEY)).toBe("string");
  });
  test("a fact either auditor rejects drops; the rest keep their ids", () => {
    const r = settleKey(KEY, [{ auditor: "opus", rejected: [], missing: [], responseIds: ["a"] }, { auditor: "sol", rejected: [], missing: [], responseIds: ["b"] }], false);
    expect(r.drop).toBeNull();
    expect(r.key.audits).toEqual([{ auditor: "opus", rejected: [], responseIds: ["a"] }, { auditor: "sol", rejected: [], responseIds: ["b"] }]);
    const four = { ...KEY, facts: [...KEY.facts, { ...KEY.facts[0]!, id: "F4" }] };
    const s = settleKey(four, [{ auditor: "opus", rejected: ["F2"], missing: [], responseIds: [] }, { auditor: "sol", rejected: [], missing: ["x"], responseIds: [] }], false);
    expect(s.drop).toBeNull();
    expect(s.key.facts.map((f) => f.id)).toEqual(["F1", "F3", "F4"]);
    expect(s.key.dropped).toEqual(["F2"]);
  });
  test("under 3 facts left drops the task", () => {
    const r = settleKey(KEY, [{ auditor: "opus", rejected: ["F1"], missing: [], responseIds: [] }, { auditor: "sol", rejected: ["F3"], missing: [], responseIds: [] }], false);
    expect(r.drop).toContain("fewer than 3");
    expect(r.key.dropped).toEqual(["F1", "F3"]);
  });
  test("a clean task needs both auditors to find nothing material missing", () => {
    const clean = { ...KEY, facts: [] };
    expect(settleKey(clean, [{ auditor: "opus", rejected: [], missing: [], responseIds: [] }, { auditor: "sol", rejected: [], missing: [], responseIds: [] }], true).drop).toBeNull();
    expect(settleKey(clean, [{ auditor: "opus", rejected: [], missing: [], responseIds: [] }, { auditor: "sol", rejected: [], missing: ["a skipped test"], responseIds: [] }], true).drop).toContain("missing");
  });
  test("the prompts carry the brief, the sha256, every numbered event and the candidates", () => {
    const p = keyPrompt("BRIEF TEXT", HISTORY, EXTRACT);
    expect(p.startsWith("BRIEF TEXT")).toBe(true);
    expect(p).toContain(SHA_OF());
    for (const e of HISTORY.events) expect(p).toContain('"n":' + e.n);
    expect(p).toContain("test_widget_size");
    const a = auditPrompt(AUDIT_BRIEF, KEY, HISTORY);
    expect(a.startsWith(AUDIT_BRIEF)).toBe(true);
    expect(a).toContain(KEY.digest);
    expect(a).toContain('"n":6');
  });
  test("audit-brief.md asks for the materiality ruling, the digest check and the tbv-audit block, plainly", () => {
    expect(AUDIT_BRIEF).toContain("act differently");
    expect(AUDIT_BRIEF).toContain("tbv-audit");
    expect(AUDIT_BRIEF).toContain("missing");
    expect(AUDIT_BRIEF).not.toContain("\u2014");
    expect(ruleWords(AUDIT_BRIEF)).toBeLessThan(600);
  });
});
const SHA_OF = () => HISTORY.sha256;

describe("writeKeys over a fake item run", () => {
  const writerOrAudit = (good: (n: number) => string) => (label: string, req: any, n: number) => {
    const p = promptOf(req);
    if (req.body.model === "fake-writer") return sent(good(n));
    return sent(audit());
  };
  test("one slot per task holds the writer and both auditors; the kept key lands in out with both audits", async () => {
    const out = tmp("tbv-keys-");
    const f = fakeRun(writerOrAudit(() => keyReply()));
    const r = await writeKeys({ histories: [HISTORY], extracts: [EXTRACT], out, keyBrief: "KEY BRIEF", auditBrief: AUDIT_BRIEF, run: f.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1000 });
    expect(r.dropped).toEqual([]);
    expect(f.slots.length).toBe(1);
    expect(f.slots[0]!.allowance).toBe(18000);
    expect(f.slots[0]!.models.sort()).toEqual(["anthropic:fake-opus", "anthropic:fake-sol", "openrouter:fake-writer"]);
    expect(f.slots[0]!.label).not.toContain("task-alpha");
    expect(f.sends.map((s) => s.req.body.model)).toEqual(["fake-writer", "fake-opus", "fake-sol"]);
    const k = JSON.parse(readFileSync(join(out, "task-alpha.json"), "utf8")) as Key;
    expect(k.audits.map((a) => a.auditor)).toEqual(["opus", "sol"]);
    expect(k.audits.every((a) => a.responseIds.length === 1)).toBe(true);
    expect(promptOf(f.sends[0]!.req).startsWith("KEY BRIEF")).toBe(true);
    expect(f.sends[0]!.req.body.max_tokens).toBeGreaterThan(0);
  });
  test("a malformed key gets one fresh retry; a second failure drops the task with the reason and no audit", async () => {
    const out = tmp("tbv-keys-");
    const ok = fakeRun(writerOrAudit((n) => (n === 1 ? "not json" : keyReply())));
    expect((await writeKeys({ histories: [HISTORY], extracts: [EXTRACT], out, keyBrief: "B", auditBrief: AUDIT_BRIEF, run: ok.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1 })).dropped).toEqual([]);
    expect(ok.sends.filter((s) => s.req.body.model === "fake-writer").length).toBe(2);
    const out2 = tmp("tbv-keys-");
    const bad = fakeRun(writerOrAudit(() => keyReply({ facts: [fact(1)] })));
    const r = await writeKeys({ histories: [HISTORY], extracts: [EXTRACT], out: out2, keyBrief: "B", auditBrief: AUDIT_BRIEF, run: bad.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1 });
    expect(r.dropped.length).toBe(1);
    expect(r.dropped[0]!.task).toBe("task-alpha");
    expect(bad.sends.length).toBe(2);
    expect(existsSync(join(out2, "task-alpha.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(out2, "drops.json"), "utf8"))[0].task).toBe("task-alpha");
  });
  test("a transport failure retries the same request up to twice", async () => {
    const out = tmp("tbv-keys-");
    const f = fakeRun((label, req, n) => (req.body.model === "fake-writer" ? (n < 3 ? sent(null, "5xx", null) : sent(keyReply())) : sent(audit())));
    const r = await writeKeys({ histories: [HISTORY], extracts: [EXTRACT], out, keyBrief: "B", auditBrief: AUDIT_BRIEF, run: f.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1 });
    expect(r.dropped).toEqual([]);
    expect(f.sends.filter((s) => s.req.body.model === "fake-writer").length).toBe(3);
  });
  test("an auditor that rejects two facts drops the task", async () => {
    const out = tmp("tbv-keys-");
    const f = fakeRun((label, req) => (req.body.model === "fake-writer" ? sent(keyReply()) : sent(audit({ F1: "reject", F2: "reject" }))));
    const r = await writeKeys({ histories: [HISTORY], extracts: [EXTRACT], out, keyBrief: "B", auditBrief: AUDIT_BRIEF, run: f.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1 });
    expect(r.dropped[0]!.reason).toContain("fewer than 3");
  });
  test("a budget refusal stops the run (E_TBV_RUN) and closes nothing twice", async () => {
    const out = tmp("tbv-keys-");
    const f = fakeRun(() => sent(null, "budget", null));
    await expect(writeKeys({ histories: [HISTORY], extracts: [EXTRACT], out, keyBrief: "B", auditBrief: AUDIT_BRIEF, run: f.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1 })).rejects.toMatchObject({ code: "E_TBV_RUN" });
    expect(f.sends.length).toBe(1);
  });
});

describe("keys run", () => {
  const inputs = () => {
    const dir = tmp("tbv-keys-run-");
    mkdirSync(join(dir, "h"));
    mkdirSync(join(dir, "x"));
    writeFileSync(join(dir, "h", "one.json"), JSON.stringify(HISTORY));
    writeFileSync(join(dir, "x", "one.json"), JSON.stringify(EXTRACT));
    return dir;
  };
  const argv = (dir: string) => ["keys", "--histories", join(dir, "h"), "--extracts", join(dir, "x"), "--out", join(dir, "out"), "--item", "tbv-author", "--run-id", "run-k1", "--record", join(dir, "record"), "--ledger", join(dir, "ledger.sqlite")];
  test("the bundle's key brief is read at its frozen sha256, and a changed copy is refused", () => {
    expect(readBundle(BUNDLE.keyBrief).length).toBeGreaterThan(100);
    const root = tmp("tbv-bundle-");
    mkdirSync(join(root, BUNDLE.keyBrief.path, ".."), { recursive: true });
    writeFileSync(join(root, BUNDLE.keyBrief.path), "changed");
    expect(() => readBundle(BUNDLE.keyBrief, root)).toThrow(expect.objectContaining({ code: "E_TBV_JUDGE" }));
  });
  test("runs over a fake item run and prints counts only", async () => {
    const dir = inputs();
    const f = fakeRun((label, req) => (req.body.model === "fake-writer" ? sent(keyReply()) : sent(audit())));
    const c = capture();
    const code = await run(argv(dir), c.io, { open: async () => f.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1 });
    expect(code).toBe(0);
    expect(f.state.closed).toBe(true);
    expect(c.out.join("\n")).toContain("1 kept, 0 dropped");
    expect(c.out.join("\n")).not.toContain("test_widget");
  });
  test("refuses an extract whose history sha256 differs", async () => {
    const dir = inputs();
    writeFileSync(join(dir, "x", "one.json"), JSON.stringify({ ...EXTRACT, history_sha256: "cd".repeat(32) }));
    const f = fakeRun(() => sent(keyReply()));
    await expect(run(argv(dir), capture().io, { open: async () => f.run, keyWriterSend: fakeKeyWriterSend, judgeSend: fakeJudgeSend, worst: () => 1 })).rejects.toMatchObject({ code: "E_TBV_INPUT" });
    expect(f.sends.length).toBe(0);
  });
  test("integration: the real openItemRun, routes, proxy and ledger with a stub upstream (needs drive.ts and routes.ts)", async () => {
    const dir = inputs();
    recordApproval(join(dir, "record"), { action: "init", item: "tbv-author", cap_micros: 100_000_000, quotes: [QUOTE], admission: "warn" });
    const seen: string[] = [];
    const fetch = upstream((p) => (p.includes("Key brief") ? keyReply() : audit()), seen);
    const c = capture();
    const code = await run(argv(dir), c.io, { env: FAKE_KEYS, fetch });
    expect(code).toBe(0);
    expect(seen.length).toBe(3);
    const k = JSON.parse(readFileSync(join(dir, "out", "task-alpha.json"), "utf8")) as Key;
    expect(k.audits.length).toBe(2);
    expect(k.audits.every((a) => a.responseIds.length > 0)).toBe(true);
  });
});
