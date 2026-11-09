// Copyright (c) 2026 Garry Tan. MIT License.
// The paid sender's order for the labelled items (keyless): one seed minted from random bytes when a judge's queue file is
// first built, recorded in it and reused on every rebuild, and the plants, stock and real items shuffled together by it.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { labelledQueue, mintSeed, seededShuffle } from "../../lanes/outcome-skills/statemachines/packets.ts";

const ids = [...Array.from({ length: 24 }, (_, i) => "plant-" + i), ...Array.from({ length: 24 }, (_, i) => "stock-" + i), ...Array.from({ length: 60 }, (_, i) => "real-" + i)];
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the labelled queue order", () => {
  test("a seed is 32 hex characters from random bytes, never from the ids", () => {
    expect(mintSeed((b) => b.fill(171))).toBe("ab".repeat(16));
    const a = mintSeed(), b = mintSeed();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
  test("the shuffle is a permutation and the same for the same seed", () => {
    const s = "0f".repeat(16);
    const q = seededShuffle(ids, s);
    expect([...q].sort()).toEqual([...ids].sort());
    expect(seededShuffle(ids, s)).toEqual(q);
    expect(seededShuffle(ids, "1e".repeat(16))).not.toEqual(q);
  });
  test("the plants do not lead the queue: plants, stock and real items are mixed", () => {
    const q = seededShuffle(ids, "0f".repeat(16));
    expect(q.slice(0, 24).every((x) => x.startsWith("plant-"))).toBe(false);
    expect(q.slice(0, 24).some((x) => x.startsWith("real-"))).toBe(true);
  });
  test("the queue file records the seed, and a rebuild from that file reuses it", () => {
    const d = mkdtempSync(join(tmpdir(), "sm-queue-"));
    dirs.push(d);
    const f = join(d, "queue.json");
    const first = labelledQueue(f, ids);
    const rec = JSON.parse(readFileSync(f, "utf8"));
    expect(rec.seed).toBe(first.seed);
    expect(rec.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(rec.order).toEqual(first.order);
    const again = labelledQueue(f, [...ids].reverse());
    expect(again.seed).toBe(first.seed);
    expect(again.order).toEqual(first.order);
  });
});
