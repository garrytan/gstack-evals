// Copyright (c) 2026 Garry Tan. MIT License.
// Splice capture (prereg section 3 and plan 6.5): every block comes from the CLI's own next request; the skill start
// runs clean; capy's three files; applySplice's order; the closer check on de-rendered text.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLACEHOLDERS, type Message, type SpliceSet } from "../../lanes/tbv/types.ts";
import { history, makeGstack, PRE_CLOSER, STUB_CLAUDE, useLocalRenderIfNotBuilt, WORK } from "./fixtures/s2.ts";

await useLocalRenderIfNotBuilt();
const { applySplice, captureSplice, closerHolds, deRender, run } = await import("../../lanes/tbv/splice.ts");

let root = "";
let g: ReturnType<typeof makeGstack>;
const caps: Partial<Record<string, SpliceSet>> = {};
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "tbv-splice-test-"));
  g = makeGstack(root);
  for (const family of ["investigate", "ship", "capy"] as const) caps[family] = await captureSplice({ family, pin: g.pin, claude: STUB_CLAUDE, gstack: g.dir, out: mkdtempSync(join(root, "out-")) });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const code = async (p: Promise<unknown>) => p.then(() => "resolved", (e) => (e as { code?: string }).code ?? String(e));
const texts = (m: Message[]) => JSON.stringify(m);
const uses = (m: Message[]) => m.flatMap((x) => x.content.filter((b) => b.type === "tool_use")) as Array<{ name: string; input: Record<string, string> }>;

describe("captureSplice", () => {
  test("investigate: the opening is the CLI's skill invocation with the first-user placeholder, without the CLI's attribution reminder", () => {
    const s = caps.investigate!;
    const o = JSON.stringify(s.opening);
    expect(o).toContain("<command-name>/investigate</command-name>");
    expect(o).toContain("<command-args>" + PLACEHOLDERS.firstUser + "</command-args>");
    expect(o).toContain("Base directory for this skill:");
    expect(o).not.toContain("Co-Authored-By");
    expect(o).not.toContain(root);
  });

  test("investigate: head is the skill-start Bash call from SKILL.md, then Read preamble.md, then every other file SKILL.md reads before its first step", () => {
    const s = caps.investigate!;
    expect(s.head.map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user", "assistant", "user"]);
    const u = uses(s.head);
    expect(u[0]!.name).toBe("Bash");
    expect(u[0]!.input.command).toBe('~/.claude/skills/gstack/bin/gstack-skill-start --skill "investigate" --model "claude"');
    expect(u.slice(1).map((x) => x.input.file_path)).toEqual(["~/.claude/skills/gstack/investigate/sections/preamble.md", "~/.claude/skills/gstack/investigate/sections/scope.md"]);
    expect(texts(s.head)).not.toContain("flake.md");
    expect(texts(s.head)).toContain("1\\t# Shared preamble");
    expect(s.tail).toEqual([]);
    expect(s.skillStart!.command).toBe(u[0]!.input.command);
    expect(s.files.map((f) => f.path)).toEqual(["investigate/sections/preamble.md", "investigate/sections/scope.md"]);
    expect(s.files[0]!.sha256).toBe(sha(readFileSync(join(g.dir, "investigate/sections/preamble.md"), "utf8")));
    expect(s.closer).toEqual({ kind: "preamble", paragraph: PRE_CLOSER });
    expect(texts(s.head)).not.toContain('"role":"system"');
  });

  test("the skill start runs with SKILL_START_PROTO=1, GSTACK_SESSION_KIND=unattended and a clean state root", () => {
    const result = JSON.stringify(caps.investigate!.head[1]);
    expect(result).toContain("SKILL_START_PROTO: 1");
    expect(result).toContain("SESSION_KIND: unattended");
    expect(result).toContain("STATE: clean");
    expect(caps.investigate!.skillStart!.stdout_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("ship uses /ship and its own preamble", () => {
    const s = caps.ship!;
    expect(JSON.stringify(s.opening)).toContain("<command-name>/ship</command-name>");
    expect(uses(s.head).map((x) => x.input.file_path ?? x.input.command)).toEqual(['~/.claude/skills/gstack/bin/gstack-skill-start --skill "ship" --model "claude"', "~/.claude/skills/gstack/ship/sections/preamble.md"]);
  });

  test("capy: Read factory.md first, report.md and READY.md last, closer by sha256, no skill start", () => {
    const s = caps.capy!;
    expect(JSON.stringify(s.opening)).toContain(PLACEHOLDERS.firstUser);
    expect(uses(s.head).map((x) => x.input.file_path)).toEqual(["~/.local/share/gstack/capy/skill/gstack/factory.md"]);
    expect(uses(s.tail).map((x) => x.input.file_path)).toEqual(["~/.local/share/gstack/captain/templates/report.md", "~/.local/share/gstack/captain/templates/READY.md"]);
    expect(s.skillStart).toBeNull();
    const files = ["capy/skill/gstack/factory.md", "captain/templates/report.md", "captain/templates/READY.md"];
    expect(s.closer).toEqual({ kind: "capy", files: files.map((f) => ({ name: f.split("/").pop()!, sha256: sha(readFileSync(join(g.dir, f), "utf8")) })) });
  });

  test("refuses a skill start that takes a degraded path (./setup or /gstack-upgrade advice)", async () => {
    spawnSync("git", ["checkout", "-q", g.degradedPin], { cwd: g.dir });
    try {
      expect(await code(captureSplice({ family: "investigate", pin: g.degradedPin, claude: STUB_CLAUDE, gstack: g.dir, out: mkdtempSync(join(root, "out-")) }))).toBe("E_TBV_SHAPE");
    } finally {
      spawnSync("git", ["checkout", "-q", g.pin], { cwd: g.dir });
    }
  });

  test("refuses the review family, which has no splice set", async () => {
    expect(await code(captureSplice({ family: "review", pin: g.pin, claude: STUB_CLAUDE, gstack: g.dir, out: mkdtempSync(join(root, "out-")) }))).toBe("E_TBV_INPUT");
  });

  test("tbv splice prints the set's sha256 and the skill start's state", async () => {
    const lines: string[] = [];
    const rc = await run(["splice", "--family", "ship", "--pin", g.pin, "--gstack", g.dir, "--claude", STUB_CLAUDE, "--out", mkdtempSync(join(root, "out-"))], { out: (t) => lines.push(t), err: (t) => lines.push(t) });
    expect(rc).toBe(0);
    expect(lines.join("\n")).toMatch(/splice ship [0-9a-f]{40} [0-9a-f]{64}/);
    expect(lines.join("\n")).toContain("skill start clean");
  });
});

describe("applySplice", () => {
  test("opening with the task's first message, then head, then the work; roles alternate", () => {
    const m = applySplice(history(WORK), caps.investigate!);
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    const first = JSON.stringify(m[0]);
    expect(first).toContain("<command-args>The parser drops the last row of a quoted file. Fix it.</command-args>");
    expect(first).not.toContain(PLACEHOLDERS.firstUser);
    expect(JSON.stringify(m[1])).toContain("gstack-skill-start");
    expect(JSON.stringify(m[7])).toContain("toolu_w1");
    expect(JSON.stringify(m[9])).toContain("Fixed the off-by-one");
  });

  test("capy: the tail's Reads follow the work, joined onto the work's last assistant message, and end on a user message", () => {
    const m = applySplice(history(WORK, "capy"), caps.capy!);
    const last = m[m.length - 1]!;
    expect(last.role).toBe("user");
    expect(JSON.stringify(last)).toContain("# READY");
    const joined = m[m.length - 4]!;
    expect(joined.role).toBe("assistant");
    expect(joined.content.map((b) => b.type)).toEqual(["text", "tool_use"]);
    for (let i = 1; i < m.length; i++) expect(m[i]!.role).not.toBe(m[i - 1]!.role);
  });
});

describe("closerHolds and deRender", () => {
  test("deRender strips Read line-number prefixes (tab or arrow form) and leaves other text alone", () => {
    expect(deRender("1\t# A\n2\tb\n3\t")).toBe("# A\nb\n");
    expect(deRender("     1\u2192# A\n     2\u2192b")).toBe("# A\nb");
    expect(deRender("plain\ntext")).toBe("plain\ntext");
  });
  test("holds on a request carrying the preamble Read, fails when the paragraph differs", () => {
    const s = caps.investigate!;
    const body = { messages: applySplice(history(WORK), s) };
    expect(closerHolds(body, s)).toBe(true);
    const altered = JSON.parse(JSON.stringify(body).replace("report in a few short lines", "report in many lines"));
    expect(closerHolds(altered, s)).toBe(false);
    expect(closerHolds({ messages: [] }, s)).toBe(false);
  });
  test("capy: holds only when all three files are present at their sha256", () => {
    const s = caps.capy!;
    const body = { messages: applySplice(history(WORK, "capy"), s) };
    expect(closerHolds(body, s)).toBe(true);
    expect(closerHolds(JSON.parse(JSON.stringify(body).replace("Head, checks, review.", "Head, checks.")), s)).toBe(false);
  });
});
