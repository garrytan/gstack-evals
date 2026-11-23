// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's keyless driven launch (sessions/dryrun.ts) on the real Claude Agent SDK and Claude Code binary against
// a stub upstream: two arm homes, the continuation cap, AskUserQuestion and the reservation-bound 429s. It needs the
// python venv with the SDK, the pinned Claude Code binary and the pinned pack clones, and skips without them.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/outcome-skills/h2h/sessions/dryrun.ts";

const PY = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const CLAUDE = process.env.H2H_CLAUDE_BIN ?? join(homedir(), ".capy/work/h2h-s/claude/claude-2.1.325/package/claude");
const PACKS = join(homedir(), ".capy/work/h2h-s/packs");

test.skipIf(!existsSync(PY) || !existsSync(CLAUDE) || !existsSync(join(PACKS, "agent-skills")))("the driven launch passes its home, cap, ask and concurrency rules", async () => {
  const out = mkdtempSync(join(homedir(), ".capy/work/h2h-dryrun-test-"));
  try {
    expect(await main(["--out", out, "--claude", CLAUDE, "--python", PY, "--packs", PACKS, "--only", "home none,home agent-skills,cap,ask,concurrency"])).toBe(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 900_000);
