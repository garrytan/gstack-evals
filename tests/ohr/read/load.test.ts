// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=A8, the full-load check (the second attempt's pre-run change 3): the reader of Claude Code's own session file (host/claude-session.jsonl) and of Codex's <skill> item (host/transcript.ndjson), each on both sides; fails_when=a whole body fails, or a cut, missing, unreadable, empty or other-pin body passes.
import { afterEach, describe, expect, test } from "bun:test";
import { skillLoad } from "../../../lanes/office-hours-rewrite/read/load.ts";
import { plantLoad, type LoadPlant } from "../../../lanes/office-hours-rewrite/read/seams.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const read = (o: LoadPlant) => {
  const p = plantLoad(o);
  cleanups.push(p.done);
  return { ...skillLoad(p.row, p.bodies), want: p.bodies[o.host][o.arm].sha256 };
};

for (const host of ["claude", "codex"] as const) {
  describe("A8 on " + (host === "claude" ? "Claude Code, from host/claude-session.jsonl" : "Codex CLI, from the <skill> item in host/transcript.ndjson"), () => {
    for (const arm of ["current", "new"] as const) {
      test(arm + ": the whole body passes, with the hash of what arrived", () => {
        const r = read({ host, arm });
        expect([r.pass, r.sha256]).toEqual([true, r.want]);
      });
    }
    test("a body one character short fails", () => {
      const r = read({ host, arm: "current", cut: 1 });
      expect(r.pass).toBe(false);
      expect(r.sha256).not.toBe(r.want);
    });
    test("the other pin's body fails", () => {
      const r = read({ host, arm: "current", body: "new" });
      expect(r.pass).toBe(false);
      expect(r.why).toContain("frozen");
    });
    test("a missing copy fails", () => {
      const r = read({ host, arm: "new", copy: "missing" });
      expect([r.pass, r.sha256]).toEqual([false, null]);
      expect(r.why).toContain("unreadable");
    });
    test("an unreadable copy fails", () => {
      const r = read({ host, arm: "new", copy: "dir" });
      expect([r.pass, r.sha256]).toEqual([false, null]);
      expect(r.why).toContain("unreadable");
    });
    test("a copy with no skill block in its user-side text fails", () => {
      const r = read({ host, arm: "new", copy: "junk" });
      expect([r.pass, r.sha256]).toEqual([false, null]);
      expect(r.why).toContain("no ");
    });
    test("a row that names no transcript fails", () => {
      const p = plantLoad({ host, arm: "current" });
      cleanups.push(p.done);
      const r = skillLoad({ ...p.row, transcript: null }, p.bodies);
      expect([r.pass, r.file]).toEqual([false, null]);
    });
  });
}

describe("A8's Claude Code body boundary", () => {
  test("the body with no ARGUMENTS line after it passes", () => {
    expect(read({ host: "claude", arm: "current", tail: "" }).pass).toBe(true);
  });
  test("other text right after the body fails", () => {
    expect(read({ host: "claude", arm: "current", tail: "\n\nmore lines" }).pass).toBe(false);
  });
  test("the body in an assistant record does not count", () => {
    expect(read({ host: "claude", arm: "current", role: "assistant" }).pass).toBe(false);
  });
});

describe("A8's Codex item boundary", () => {
  test("an item with its closing tag cut off fails", () => {
    expect(read({ host: "codex", arm: "new", tail: "" }).pass).toBe(false);
  });
  test("the item in an assistant record does not count", () => {
    expect(read({ host: "codex", arm: "new", role: "assistant" }).pass).toBe(false);
  });
});
