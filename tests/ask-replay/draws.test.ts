import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toJsonl } from "../../lanes/ask-replay/build.ts";
import { main } from "../../lanes/ask-replay/cli.ts";
import { auditDraw, drawCounts, pilotDraw } from "../../lanes/ask-replay/draws.ts";
import { FROZEN } from "../../lanes/ask-replay/frozen.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";
import type { AskItem } from "../../lanes/ask-replay/types.ts";

// The synthetic set seven times over, with fresh ids, stands in for the real items.
const pool: AskItem[] = Array.from({ length: 7 }, (_, n) => generate().items.map((it) => ({ ...it, item: it.item + "-" + n }))).flat();
const NEEDLESS = ["DUPLICATE", "PERMISSION_FOR_DEFAULT", "OBSERVABLE"];

describe("the pilot and label-audit draws (sections 7 and 10)", () => {
  test("the pilot takes 16 must-ask and 24 needless, each (class, thread) stratum within one of its share", () => {
    const d = pilotDraw(pool, 11);
    const c = drawCounts(d);
    expect(c.items).toBe(40);
    expect(c.per_class.DECISION).toBe(FROZEN.pilot.must_ask);
    expect(NEEDLESS.reduce((s, l) => s + c.per_class[l]!, 0)).toBe(FROZEN.pilot.needless);
    const groups: Array<[string[], number]> = [[["DECISION"], 16], [NEEDLESS, 24]];
    for (const [labels, n] of groups) {
      const group = pool.filter((i) => labels.includes(i.label));
      for (const key of new Set(group.map((i) => i.label + "|" + i.thread))) {
        const share = (group.filter((i) => i.label + "|" + i.thread === key).length * n) / group.length;
        const got = d.filter((i) => i.label + "|" + i.thread === key).length;
        expect(got).toBeGreaterThanOrEqual(Math.floor(share));
        expect(got).toBeLessThanOrEqual(Math.ceil(share));
      }
    }
  });
  test("the label audit takes 40 must-ask, 40 duplicates and every permission and observable item", () => {
    expect(drawCounts(auditDraw(pool, 5)).per_class).toEqual({ DECISION: 40, DUPLICATE: 40, PERMISSION_FOR_DEFAULT: 21, OBSERVABLE: 14 });
  });
  test("the same seed draws the same set whatever the input order; another seed draws another", () => {
    expect(pilotDraw([...pool].reverse(), 11)).toEqual(pilotDraw(pool, 11));
    expect(auditDraw([...pool].reverse(), 5)).toEqual(auditDraw(pool, 5));
    expect(pilotDraw(pool, 12)).not.toEqual(pilotDraw(pool, 11));
    expect(auditDraw(pool, 6)).not.toEqual(auditDraw(pool, 5));
  });
  test("draw: counts out, drawn items on /dev/shm, the minted seed appended to the log, and the logged seed redraws the same set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-draw-"));
    const shm = mkdtempSync(join("/dev/shm", "ask-test-draw-"));
    try {
      const items = join(dir, "items.jsonl");
      writeFileSync(items, toJsonl(pool));
      const log = join(dir, "CUSTODY.md");
      const out: string[] = [];
      const io = { out: (t: string) => out.push(t), err: () => {} };
      expect(await main(["draw", "--kind", "pilot", "--items", items, "--out", join(shm, "pilot.jsonl"), "--seed-log", log], io)).toBe(0);
      const printed = out.join("\n");
      expect(printed).not.toMatch(/i-[0-9a-f]{24}/);
      const first = JSON.parse(out.pop()!);
      expect(first).toMatchObject({ kind: "pilot", items: 40 });
      expect(readFileSync(join(shm, "pilot.jsonl"), "utf8").trim().split("\n")).toHaveLength(40);
      const line = readFileSync(log, "utf8");
      const m = /ask-replay draw pilot: seed (\d+) \(minted from random bytes\), 40 of 420 items/.exec(line);
      expect(m).not.toBeNull();
      expect(await main(["draw", "--kind", "pilot", "--items", items, "--out", join(shm, "again.jsonl"), "--seed-log", log, "--seed", m![1]!], io)).toBe(0);
      expect(JSON.parse(out.pop()!).drawn_sha256).toBe(first.drawn_sha256);
      expect(await main(["draw", "--kind", "audit", "--items", items, "--out", join(dir, "audit.jsonl"), "--seed-log", log], io)).toBe(2);
      expect(existsSync(join(dir, "audit.jsonl"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(shm, { recursive: true, force: true });
    }
  });
});
