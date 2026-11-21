import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyRollouts } from "../../src/adapters/codex/driver.ts";
import type { AgentSession } from "../../src/trial/sandbox.ts";

// Value: protects=a rollout copy that cannot be written is a failed line, not an error that escapes the driver after the session
//   has spent, so the cell still reaches the journal and a resume never runs a paid session again; fails_when=a write error
//   throws out of copyRollouts; why_new=#400's adversarial review (driver.ts:280), which the Captain asked to close before any
//   paid run.
test("a rollout that cannot be written out is a failed line, and copyRollouts returns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-rollouts-"));
  try {
    const home = join(dir, "codex-home");
    const path = "sessions/2026/11/21/rollout-2026-11-21T00-00-00-abc.jsonl";
    mkdirSync(join(home, "sessions/2026/11/21"), { recursive: true });
    writeFileSync(join(home, path), '{"type":"session_meta"}\n');
    const session = { spawn: (argv: string[]) => spawn(argv[0]!, argv.slice(1), { env: { ...process.env, CODEX_HOME: home } }), exec: () => { throw new Error("unused"); }, stop: () => {} } as unknown as AgentSession;
    const out = join(dir, "out");
    expect(await copyRollouts(session, out)).toEqual({ copied: [path], failed: [] });
    expect(readFileSync(join(out, path), "utf8")).toBe('{"type":"session_meta"}\n');
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "a file where the copy's folder should go\n");
    const r = await copyRollouts(session, blocked);
    expect(r.copied).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toStartWith(path + ": could not be written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
