// Copyright (c) 2026 Garry Tan. MIT License.
// The weekly read commands in a fresh Bun process with no preload (GST-4122). Bun 1.4.4's runtime transpiler cache is keyed
// without macro mode, so a copy of a file transpiled while a macro runs (macro import removed, call left in) is served to
// every later normal process. When match.ts read its quote transform through a Bun macro, such a copy made attach, table,
// look and report fail with "quoteSource is not defined" until the cache was cleared. Each case gets its own cache folder,
// plants that copy through a macro whose module imports match.ts, then runs the real CLI.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "../..");
const MATCH = join(REPO, "lanes/harness-mechanics/match.ts");

function freshEnv(cache: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("BUN_")) env[k] = v;
  env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = cache;
  return env;
}

function weekly(env: Record<string, string>, args: string[]) {
  const r = Bun.spawnSync([process.execPath, join(REPO, "bin/gstack-evals"), "weekly", ...args], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, err: r.stderr.toString() };
}

function plantMacroModeCopy(dir: string, env: Record<string, string>): void {
  writeFileSync(join(dir, "m.ts"), "import " + JSON.stringify(MATCH) + ";\nexport function touch() { return 1; }\n");
  writeFileSync(join(dir, "p.ts"), 'import { touch } from "./m.ts" with { type: "macro" };\nconsole.log(touch());\n');
  Bun.spawnSync([process.execPath, join(dir, "p.ts")], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
}

describe("weekly read commands in a fresh process, no preload", () => {
  for (const planted of [false, true]) {
    test(planted ? "after a macro-mode transpile of match.ts is in the cache" : "with an empty transpiler cache", () => {
      const dir = mkdtempSync(join(tmpdir(), "weekly-clean-"));
      const env = freshEnv(join(dir, "cache"));
      if (planted) plantMacroModeCopy(dir, env);
      const missing = join(dir, "missing");
      for (const args of [["table", missing + ".json", join(dir, "t.jsonl")], ["look", missing + ".jsonl", missing], ["report", missing + ".jsonl", missing, "--out", join(dir, "out")], ["attach", missing]]) {
        const r = weekly(env, args);
        expect(r.err).not.toContain("is not defined");
        expect(r.err).toContain(missing);
        expect(r.code).not.toBe(0);
      }
    });
  }
});
