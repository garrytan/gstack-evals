// Copyright (c) 2026 Garry Tan. MIT License.
// The dry run's own logic, keyless: the stub's reply script, the fixture files and manifest, and how entry outcomes and
// record misses are read. The full dry run (Docker, the Claude Agent SDK's bundled CLI, about 25 minutes) runs only with
// PF_DRYRUN_DOCKER=1 and PF_PYTHON pointing at a Python with claude_agent_sdk 0.2.174.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BASE_FLAG, MANIFEST_A, agentFiles, misses, outcomes, stubReply } from "../../lanes/outcome-skills/pfchecks/dryrun.ts";
import { readManifest } from "../../lanes/outcome-skills/pfchecks/manifest.ts";

test("the stub's script: the task turn plants files once; the wrap-up writes the manifest, loops to its limit, or ends upstream once", () => {
  const s = { task: "echo plant", wrapup: "manifest" as const, checks: "[]" };
  expect(stubReply(s, "task", 0, true).blocks[0]).toMatchObject({ type: "tool_use", name: "Bash", input: { command: "echo plant" } });
  expect(stubReply(s, "task", 1, true).blocks[0]).toMatchObject({ type: "text" });
  expect(String((stubReply(s, "wrapup", 0, true).blocks[0] as any).input.command)).toContain("> CHECKS.json && printf 'exit 0\\n' > checks/late_test.sh");
  expect(stubReply({ ...s, wrapup: "limit" }, "wrapup", 7, true).blocks[0]).toMatchObject({ input: { command: "true" } });
  expect(stubReply({ ...s, wrapup: "upstream" }, "wrapup", 0, true).status).toBe(400);
  expect(stubReply({ ...s, wrapup: "upstream" }, "wrapup", 0, false).blocks[0]).toMatchObject({ type: "tool_use" });
});

test("the fixture manifest covers section 15's entry fixtures and reads as the scorer reads it", () => {
  const files = agentFiles("h".repeat(64));
  expect(Object.keys(files).filter((p) => p.startsWith("gen/")).sort()).toEqual(["gen/verify-flag/Flag.cfg", "gen/verify-flag/Flag.tla", "gen/verify-flag/SKILL.md"]);
  expect(files["flag/flag.go"]!.startsWith(BASE_FLAG)).toBe(true);
  const changed = Object.keys(files);
  const tests = changed.filter((p) => p.endsWith("_test.go"));
  const words = new Set(tests.flatMap((p) => files[p]!.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? []));
  const m = readManifest(JSON.stringify(MANIFEST_A.map((e) => ({ command: e.command }))), { changed, test_files: tests, test_words: words }, { wrapupLimit: false });
  expect(m.inline).toEqual(MANIFEST_A.flatMap((e, i) => (e.want === "inline" ? [i] : [])));
  expect(m.names_nothing).toEqual(MANIFEST_A.flatMap((e, i) => (e.want === "names_nothing" ? [i] : [])));
  expect(m.run.at(-1)!.command).toContain("Flag.tla");
});

test("outcomes and misses read a catch record", () => {
  const c: any = { manifest: { listed: 4, inline: [1], names_nothing: [2], beyond_cap: [] }, entries: [{ index: 0, outcome: "catch" }, { index: 3, outcome: "unreached" }] };
  expect(outcomes(c)).toEqual(["catch", "inline", "names_nothing", "unreached"]);
  expect(misses({ a: { b: 1 } }, { "a.b": 1, "a.c": 2 })).toEqual(["a.c: got undefined, want 2"]);
});

const PY = process.env.PF_PYTHON ?? "";
test.skipIf(process.env.PF_DRYRUN_DOCKER !== "1" || !existsSync(PY))("the full dry run passes every fixture", () => {
  const r = spawnSync("bun", [join(import.meta.dir, "../../lanes/outcome-skills/pfchecks/dryrun.ts")], { encoding: "utf8", env: process.env, timeout: 3_600_000 });
  expect(r.stdout.split("\n").filter((l) => l.startsWith("FAIL"))).toEqual([]);
  expect(r.status).toBe(0);
}, 3_600_000);
