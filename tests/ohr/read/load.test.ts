// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=A8, the full-load check (the second attempt's pre-run change 3): the reader of Claude Code's own session file (host/claude-session.jsonl) and of Codex's <skill> item (host/transcript.ndjson), each on both sides; fails_when=a whole body fails, or a cut, missing, unreadable, empty or other-pin body passes.
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CLAUDE_BODY, PINS } from "../../../lanes/office-hours-rewrite/frozen.ts";
import { CLAUDE_SESSION, skillLoad, startOutput } from "../../../lanes/office-hours-rewrite/read/load.ts";
import { PLANTED_START, plantLoad, type LoadPlant } from "../../../lanes/office-hours-rewrite/read/seams.ts";
import { sessionKindOf } from "../../../lanes/office-hours-rewrite/run/session.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const read = (o: LoadPlant) => {
  const p = plantLoad(o);
  cleanups.push(p.done);
  return { ...skillLoad(p.row, p.bodies), want: p.want };
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

describe("A8's Claude Code body: the frozen head and tail around the start step's output (pre-run change 5)", () => {
  test("the body with no ARGUMENTS line after it passes", () => {
    expect(read({ host: "claude", arm: "current", tail: "" }).pass).toBe(true);
  });
  test("other text right after the body fails", () => {
    expect(read({ host: "claude", arm: "current", tail: "\n\nmore lines" }).pass).toBe(false);
  });
  test("the body in an assistant record does not count", () => {
    expect(read({ host: "claude", arm: "current", role: "assistant" }).pass).toBe(false);
  });
  test("another start-step output passes, with the hash of the body that arrived", () => {
    const r = read({ host: "claude", arm: "new", start: "SESSION_KIND: headless\nA longer start output over two lines." });
    expect([r.pass, r.sha256]).toEqual([true, r.want]);
    expect(r.why).toContain("start-step output");
  });
  test("an empty start-step output fails", () => {
    const r = read({ host: "claude", arm: "current", start: "" });
    expect(r.pass).toBe(false);
    expect(r.why).toContain("start step printed nothing");
  });
  test("a changed head fails", () => {
    const r = read({ host: "claude", arm: "current", head: "# Another head\n" });
    expect(r.pass).toBe(false);
    expect(r.why).toContain("head");
  });
  test("the start step's output is what lies between the head and the tail, and the session kind reads it before any tool result", () => {
    const p = plantLoad({ host: "claude", arm: "current" });
    cleanups.push(p.done);
    const text = readFileSync(join(dirname(p.row.transcript!), CLAUDE_SESSION), "utf8");
    expect(startOutput(text, "current", p.bodies.claude)).toBe(PLANTED_START);
    expect(startOutput(text, "new", p.bodies.claude)).toBeNull();
    const tool = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "SESSION_KIND: headless" }] } });
    expect(PLANTED_START).toContain("SESSION_KIND: interactive");
    expect(sessionKindOf(tool, startOutput(text, "current", p.bodies.claude))).toBe("interactive");
    expect(sessionKindOf(tool, null)).toBe("headless");
  });
});

const CLONE = process.env.GSTACK_OHR_CLONE || join(homedir(), ".capy", "work", "gstack");
const has = (sha: string) => existsSync(CLONE) && spawnSync("git", ["-C", CLONE, "cat-file", "-e", sha + "^{commit}"]).status === 0;
const ready = has(PINS.current!.sha) && has(PINS.new!.sha);
if (!ready) console.log("SKIP tests/ohr/read/load.test.ts pin check: no gstack clone holding both pins at " + CLONE);
test.skipIf(!ready)("from a clone holding both pins, each frozen head and tail is its pin's office-hours/SKILL.md split at its two load-time lines, the preamble line read as preamble.md", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  for (const arm of ["current", "new"] as const) {
    const show = (f: string) => spawnSync("git", ["-C", CLONE, "show", PINS[arm]!.sha + ":" + f], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout;
    const body = show("office-hours/SKILL.md").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
    const lines = body.split("\n");
    const bang = lines.flatMap((l, i) => (l.startsWith("!" + String.fromCharCode(96)) ? [i] : []));
    expect(bang).toHaveLength(2);
    const at = (i: number) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    const [pre, start] = bang as [number, number];
    const head = body.slice(0, at(pre)) + show("office-hours/sections/preamble.md").replace(/\n$/, "") + body.slice(at(pre) + lines[pre]!.length, at(start));
    const tail = body.slice(at(start) + lines[start]!.length);
    expect({ head: { sha256: sha(head), chars: head.length }, tail: { sha256: sha(tail), chars: tail.length } }).toEqual(CLAUDE_BODY[arm]);
  }
});
