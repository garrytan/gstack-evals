import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFiles, buildFrom, parseAudit, parseCsv, parseRules, readPages, type TranscriptItem } from "../../lanes/ask-replay/build.ts";
import { main } from "../../lanes/ask-replay/cli.ts";
import { buildFixture } from "../../lanes/ask-replay/fixtures.ts";

describe("the custody builder (section 2)", () => {
  const b = buildFrom(buildFixture());
  test("items are the audit's ask rows with a readable event; NOT_ASK rows and unreadable events are counted", () => {
    expect(b.items.map((i) => i.label)).toEqual(["DECISION", "DUPLICATE", "DECISION"]);
    expect(b.counts.dropped.unreadable).toBe(1);
    expect(b.counts.not_ask_rows).toBe(1);
    expect(b.items.every((i) => i.thread === "T1")).toBe(true);
    expect(b.map).toEqual({ "fixture-thread": "T1" });
  });
  test("conversations hold agent and owner messages before the ask, never tool noise or crew traffic", () => {
    const last = b.items[2]!;
    expect(last.conversation.map((m) => m.from)).toEqual(["agent", "agent", "owner", "agent"]);
    expect(last.conversation.some((m) => m.text === "ls")).toBe(false);
    expect(last.cut).toBe(false);
  });
  test("earlier asks carry the first owner message after them and before the item; after_reply is the next owner message", () => {
    const last = b.items[2]!;
    expect(last.earlier_asks.map((e) => e.next_owner === null)).toEqual([false, true]);
    expect(b.items[0]!.after_reply?.text).toContain("10 MB");
    expect(last.after_reply).toBeNull();
  });
  test("every text field passes the scan; each distinct hit counts once", () => {
    expect(b.counts.scan.hits).toBe(3);
    expect(b.counts.scan.by_kind).toEqual({ anthropic_key: 1, email: 1, phone: 1 });
    expect(JSON.stringify(b.items)).not.toContain("example.com");
    expect(b.items[1]!.draft).toContain("[redacted]");
  });
  test("note and reply_kind never reach an item, and item ids are random", () => {
    expect(JSON.stringify(b.items)).not.toContain("never read");
    const x = buildFrom({ ...buildFixture(), newId: undefined });
    const y = buildFrom({ ...buildFixture(), newId: undefined });
    expect(x.items[0]!.item).toMatch(/^i-[0-9a-f]{24}$/);
    expect(x.items[0]!.item).not.toBe(y.items[0]!.item);
  });
  test("rules: earliest date in the date text, undated rows placed by the next dated row, the rest dropped", () => {
    const r = parseRules(buildFixture().rules);
    expect(r.rows.map((x) => [x.id, x.date, x.placed])).toEqual([["R1", "2026-10-10", false], ["R2", "2026-10-11", true], ["R3", "2026-10-11", false]]);
    expect(r.dropped).toBe(1);
    expect(r.multi_dated).toBe(1);
    expect(b.items[0]!.rules.map((x) => x.id)).toEqual(["R1", "R2", "R3"]);
    expect(parseRules("| R2 | a \\| b | w | 2026-10-01 | s | r | live |").rows[0]!.text).toBe("a | b");
  });
  test("the variant bundle adds crew messages; an owner list keeps other people out", () => {
    expect(buildFrom({ ...buildFixture(), variant: true }).items[2]!.conversation.some((m) => m.from === "crew")).toBe(true);
    expect(buildFrom({ ...buildFixture(), owner: ["Someone Else"] }).items[2]!.conversation.some((m) => m.from === "owner")).toBe(false);
  });
  test("the window keeps the newest whole messages up to 120,000 characters and marks the cut", () => {
    const f = buildFixture();
    const items = [...(f.threads.get("fixture-thread") as TranscriptItem[])];
    items.unshift({ id: "big", source: "assistant", text: "x".repeat(119_990), createdAt: "2026-10-11T00:00:00.000Z" });
    const r = buildFrom({ ...f, threads: new Map([["fixture-thread", items]]) });
    expect(r.items[2]!.cut).toBe(true);
    expect(r.items[2]!.conversation.some((m) => m.text.length > 100_000)).toBe(false);
  });
  test("the audit CSV is RFC 4180 with the frozen header", () => {
    expect(parseCsv('a,"b ""q"", c",d\r\n1,2,3\n')).toEqual([["a", 'b "q", c', "d"], ["1", "2", "3"]]);
    expect(() => parseAudit("thread,event\nx,y\n")).toThrow(/E_ASK_INPUT/);
    expect(() => parseAudit("thread,event,at,latency_min,class,reply_kind,note\nt,e,a,1,MAYBE,r,n\n")).toThrow(/E_ASK_INPUT/);
  });
  test("files: pages in number order under DIR/<thread>, and the CLI refuses an output off /dev/shm", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-build-"));
    try {
      const f = buildFixture();
      const all = f.threads.get("fixture-thread")!;
      mkdirSync(join(dir, "pages", "fixture-thread"), { recursive: true });
      writeFileSync(join(dir, "pages", "fixture-thread", "page-10.json"), JSON.stringify(all.slice(4)));
      writeFileSync(join(dir, "pages", "fixture-thread", "page-2.json"), JSON.stringify(all.slice(0, 4)));
      expect(readPages(join(dir, "pages")).get("fixture-thread")!.map((t) => t.id)).toEqual(all.map((t) => t.id));
      const csv = ["thread,event,at,latency_min,class,reply_kind,note", ...f.audit.map((r) => [r.thread, r.event, r.at, r.latency_min, r.class, r.reply_kind, r.note].join(","))].join("\n");
      writeFileSync(join(dir, "audit.csv"), csv);
      writeFileSync(join(dir, "rules.md"), f.rules);
      expect(buildFiles({ pages: join(dir, "pages"), audit: join(dir, "audit.csv"), rules: join(dir, "rules.md"), owner: ["Pat Owner"] }).counts.items).toBe(3);
      const err: string[] = [];
      const code = await main(["build", "--pages", join(dir, "pages"), "--audit", join(dir, "audit.csv"), "--rules", join(dir, "rules.md"), "--out", join(dir, "items.jsonl")], { out: () => {}, err: (t) => err.push(t) });
      expect(code).toBe(2);
      expect(err.join("\n")).toContain("E_USAGE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
