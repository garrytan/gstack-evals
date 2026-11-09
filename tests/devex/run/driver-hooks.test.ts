// Copyright (c) 2026 Garry Tan. MIT License.
// The driver's opt-in devex options against the real pinned Agent SDK and its CLI, behind the metering proxy with a fake
// upstream (prereg 2026-11-09-geva-417, section 10 smoke rule 5 and section 15 rule 4's strip line): stopHook blocks a
// stop with its reason and lets the next one through, memoryLog records each instruction file the CLI loads, and the
// repository-instruction strip holds both ways in what the CLI loaded and sent upstream. At SDK 0.3.314 the CLI fires
// InstructionsLoaded for its session-start files only when one of them holds an @import, so memory.ndjson is a partial
// record; the request bodies sent upstream are the complete one, and the strip is asserted on both.
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeCodeDriver, claudeCodeEnv, type ClaudeCodeOptions } from "../../../src/adapters/claude-code/driver.ts";
import { HOSTILE, hostileRepo } from "../../../lanes/devex/run/checks.ts";
import { loadedFiles, memoryReading } from "../../../lanes/devex/run/memory.ts";
import { makeStopHook, STOP_HOOK_PREFIX } from "../../../lanes/devex/run/stophook.ts";
import { stripInstructions } from "../../../lanes/devex/unit/snapshot.ts";
import { HAS_CLAUDE_CLI, harness, type Harness, type Script } from "../../adapters/harness.ts";

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});
const MODEL = "claude-opus-5-5";

async function run(script: Script, o: { options?: Partial<ClaudeCodeOptions>; work?: (work: string) => void; home?: (home: string) => void } = {}) {
  const h = harness(script);
  open.push(h);
  const binding = h.bind(MODEL, "anthropic");
  const home = join(h.dir, "home");
  mkdirSync(home, { recursive: true });
  o.home?.(home);
  const work = join(h.dir, "work", "t");
  mkdirSync(work, { recursive: true });
  o.work?.(work);
  const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, skill: null, out: join(h.dir, "host"), query: query as never, ...o.options });
  const session = h.session(work, home, driver.env!);
  const outcome = await driver.run(session, { id: "t", prompt: "Review the plan." }, 120_000);
  const memory = existsSync(join(h.dir, "host", "memory.ndjson")) ? readFileSync(join(h.dir, "host", "memory.ndjson"), "utf8") : null;
  return { h, outcome, memory, work, home, bodies: h.upstream.map((u) => JSON.stringify(u.body)) };
}

describe("claudeCodeEnv's session kind", () => {
  // Value: protects=autoplan's GSTACK_SESSION_KIND=interactive reaches the agent env beside the unattended kind; fails_when=the widened option drops interactive; why_new=the devex arms pass two kinds; seam=claudeCodeEnv; no_claim=what gstack does with it
  test("interactive and unattended both reach the env, and unset adds none", () => {
    const base = { model: MODEL, provider: "anthropic" as const, proxy: { baseUrl: "http://x", slot: "s", token: "t" } };
    expect(claudeCodeEnv({ ...base, sessionKind: "interactive" }).GSTACK_SESSION_KIND).toBe("interactive");
    expect(claudeCodeEnv({ ...base, sessionKind: "unattended" }).GSTACK_SESSION_KIND).toBe("unattended");
    expect(claudeCodeEnv(base).GSTACK_SESSION_KIND).toBeUndefined();
  });
});

describe.skipIf(!HAS_CLAUDE_CLI)("the driver's devex options on the real Agent SDK", () => {
  // Value: protects=smoke rule 5's Stop hook: a stop is blocked with the fixed message twice, the model gets the reason, and the third stop ends the session; with no stopHook nothing is blocked; fails_when=the hook never fires, its reason never reaches the model, or it blocks more than twice; why_new=the SDK's Stop hook is new to this driver; seam=claudeCodeDriver stopHook, makeStopHook; no_claim=how a real model answers the message
  test("stopHook blocks twice with its reason, then lets the session stop", async () => {
    let turns = 0;
    const hook = makeStopHook({ detect: () => ({ exposed: false, missing: ["the DX Review Scorecard"] }) });
    const r = await run(() => [{ type: "text", text: "turn " + ++turns }], { options: { stopHook: hook } });
    expect(r.outcome.termination).toEqual({ kind: "completed" });
    expect(hook.blocks()).toBe(2);
    expect(turns).toBe(3);
    expect(r.bodies.at(-1)).toContain(STOP_HOOK_PREFIX);
    expect(r.bodies.at(-1)).toContain("the DX Review Scorecard");
    let plain = 0;
    const none = await run(() => [{ type: "text", text: "turn " + ++plain }]);
    expect(none.outcome.termination).toEqual({ kind: "completed" });
    expect(plain).toBe(1);
  }, 180_000);

  // Value: protects=section 15 rule 4's strip line from loaded memory: hostile CLAUDE.md (root, subfolder, with an @import), CLAUDE.local.md, AGENTS.md and .claude/AGENTS.md reach the model when unstripped, and after the snapshot strip none of their text is loaded or sent while the home's own instructions still load; memoryLog off writes nothing; fails_when=the strip misses a file, the reading cannot see a loaded file, or the log records nothing; why_new=the devex arms must assert the strip from what the CLI loaded; seam=claudeCodeDriver memoryLog, stripInstructions, memoryReading; no_claim=gstack's own install, which the gstack arms add in the container
  test("the instruction strip both ways, from memory.ndjson and the bodies sent upstream", async () => {
    const fixtures = Object.values(HOSTILE);
    const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);
    const home = (h: string) => {
      mkdirSync(join(h, ".claude"), { recursive: true });
      writeFileSync(join(h, ".claude", "CLAUDE.md"), "HOME-INSTRUCTIONS-4d1e: installed after the strip.\n");
    };
    const reply: Script = () => [{ type: "text", text: "done" }];
    const raw = await run(reply, { options: { memoryLog: true }, work: hostileRepo, home });
    const before = memoryReading({ arm: "none", loaded: loadedFiles(raw.memory), read, bodies: raw.bodies, skills: [], repoRoot: raw.work, fixtures });
    expect(before.fixture_hits.some((x) => x.includes(HOSTILE.root))).toBe(true);
    expect(before.fixture_hits.some((x) => x.includes(HOSTILE.imported))).toBe(true);
    expect(before.repo_files.length).toBeGreaterThan(0);
    const stripped = await run(reply, { options: { memoryLog: true }, work: (w) => (hostileRepo(w), stripInstructions(w)), home });
    const after = memoryReading({ arm: "none", loaded: loadedFiles(stripped.memory), read, bodies: stripped.bodies, skills: [], repoRoot: stripped.work, fixtures });
    expect(after.problems).toEqual([]);
    expect(loadedFiles(raw.memory).some((f) => f.file_path === join(raw.home, ".claude", "CLAUDE.md") && f.memory_type === "User")).toBe(true);
    expect(stripped.bodies.some((b) => b.includes("HOME-INSTRUCTIONS-4d1e"))).toBe(true);
    const off = await run(reply, { work: (w) => cpSync(join(stripped.work), w, { recursive: true }) });
    expect(off.memory).toBeNull();
  }, 240_000);
});
