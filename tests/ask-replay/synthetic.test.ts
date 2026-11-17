import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { s1Match } from "../../lanes/ask-replay/chains.ts";
import { FROZEN } from "../../lanes/ask-replay/frozen.ts";
import { emptyCount, itemTexts, redact, scanPublic } from "../../lanes/ask-replay/privacy.ts";
import { generate, OWNER } from "../../lanes/ask-replay/synthetic/generator.ts";
import { LABELS, type AskItem } from "../../lanes/ask-replay/types.ts";

const dir = join(import.meta.dir, "../../lanes/ask-replay/synthetic");
const g = generate();

describe("the public synthetic set (section 12)", () => {
  test("the generator reproduces the committed set, its sha256 file and frozen.json's digest", () => {
    expect(readFileSync(join(dir, "items.jsonl"), "utf8")).toBe(g.jsonl);
    expect(readFileSync(join(dir, "items.sha256"), "utf8")).toBe(g.sha256 + "  items.jsonl\n");
    expect(FROZEN.synthetic.sha256).toBe(g.sha256);
  });
  test("60 items in 3 threads with the frozen class mix, duplicates split between open and answered rows", () => {
    expect(g.items).toHaveLength(60);
    expect([...new Set(g.items.map((i) => i.thread))].sort()).toEqual(["S1", "S2", "S3"]);
    expect(g.counts.per_class).toEqual({ DECISION: 35, DUPLICATE: 20, PERMISSION_FOR_DEFAULT: 3, OBSERVABLE: 2 });
    const dups = g.items.filter((i) => i.label === "DUPLICATE");
    expect(dups.filter((i) => s1Match(i)?.next_owner === null).length).toBe(10);
    expect(dups.filter((i) => s1Match(i)?.next_owner).length).toBe(10);
  });
  test("every item has the AskItem shape", () => {
    const keys = ["item", "thread", "at", "order", "label", "conversation", "cut", "rules", "draft", "earlier_asks", "after_reply"];
    for (const it of g.items as AskItem[]) {
      expect(Object.keys(it)).toEqual(keys);
      expect(LABELS).toContain(it.label);
      expect(it.conversation.every((m) => m.from === "agent" || m.from === "owner")).toBe(true);
      expect(it.rules.every((r) => r.date <= it.at.slice(0, 10))).toBe(true);
    }
  });
  test("no secret or contact shapes, issue keys, thread codes or dollar figures; the only person named is the made-up owner", () => {
    const c = emptyCount();
    for (const t of g.items.flatMap(itemTexts)) redact(t, c);
    expect(c.hits).toBe(0);
    const s = scanPublic(g.jsonl);
    expect([s.codes, s.dollars]).toEqual([0, 0]);
    expect(OWNER).toBe("Rowan Tesh");
  });
});
