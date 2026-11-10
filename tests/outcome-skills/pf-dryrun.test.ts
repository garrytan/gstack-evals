// Copyright (c) 2026 Garry Tan. MIT License.
// The dry run's own logic, keyless: the stub's reply script, the fixture files and manifest, and how entry outcomes and
// record misses are read. The full dry run (Docker, the Claude Agent SDK's bundled CLI, about 25 minutes) runs only with
// PF_DRYRUN_DOCKER=1 and PF_PYTHON pointing at a Python with claude_agent_sdk 0.2.174.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { priceRequest, reservationMicros, usageCost } from "../../src/runner/pricing/prices.ts";
import { WRAPUP_ALLOWANCE } from "../../lanes/outcome-skills/pfchecks/arms.ts";
import { BASE_FLAG, MANIFEST_A, WRAP_BYTES, WRAP_CONTEXT_TOKENS, agentFiles, concurrencyCheck, misses, outcomes, stubReply } from "../../lanes/outcome-skills/pfchecks/dryrun.ts";
import { OPUS, P1, SOL } from "../../lanes/outcome-skills/pfchecks/items.ts";
import { CLAUDE_ENV } from "../../lanes/outcome-skills/pfchecks/run.ts";
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

test("the stub's wrap-up allowance fixtures: the task turn's last answer fills the context, and the wrap-up's first answer reports a full cache write or 95% of its worst case", () => {
  const s = { task: "mkdir -p checks", wrapup: "manifest" as const, filler: WRAP_BYTES, usage: "cache_write" as const };
  expect((stubReply(s, "task", 1, true, 70_000).blocks[0] as any).text).toBe("x".repeat(WRAP_BYTES - 70_000));
  expect((stubReply({ ...s, filler: undefined }, "task", 1, true, 70_000).blocks[0] as any).text).toBe("Done.");
  expect(stubReply(s, "wrapup", 0, true, 561_000).usage).toEqual({ input_tokens: 3, cache_creation_input_tokens: WRAP_CONTEXT_TOKENS, cache_read_input_tokens: 0, output_tokens: 150 });
  expect(stubReply({ ...s, usage: "worst" }, "wrapup", 0, true, 561_000).usage).toEqual({ input_tokens: 0, cache_creation_input_tokens: 532_950, cache_read_input_tokens: 0, output_tokens: 30_400 });
  expect(stubReply({ ...s, wrapup: "limit", usage: "worst" }, "wrapup", 3, false, 561_000)).toEqual({ blocks: [{ type: "tool_use", id: "toolu_pf_wrapup_3", name: "Bash", input: { command: "true", description: "Fixture step" } }], usage: { input_tokens: 0, cache_creation_input_tokens: 532_950, cache_read_input_tokens: 0, output_tokens: 30_400 } });
  expect(stubReply({ ...s, wrapup: "limit" }, "wrapup", 3, false, 561_000).usage).toBeUndefined();
  expect(stubReply(s, "wrapup", 1, true, 561_000).usage).toBeUndefined();
  expect(stubReply({ ...s, usage: undefined }, "wrapup", 0, true, 561_000).usage).toBeUndefined();
});

const wrapBody = (model: string, bytes: number, ttl?: string) => {
  const b = { model, max_tokens: 32_000, system: [{ type: "text", text: "s", cache_control: { type: "ephemeral", ...(ttl ? { ttl } : {}) } }], tools: [{ name: "Bash", input_schema: { type: "object" } }], messages: [{ role: "user", content: "" }] };
  b.messages[0]!.content = "x".repeat(bytes - Buffer.byteLength(JSON.stringify(b)));
  return b;
};
const wrapCosts = (provider: "anthropic" | "openrouter", model: string, ttl?: string) => {
  const price = priceRequest(provider, wrapBody(model, WRAP_BYTES, ttl), 32_000, "/v1/messages");
  const cost = (usage: "cache_write" | "worst") => usageCost(price, stubReply({ task: "", wrapup: "manifest", usage }, "wrapup", 0, true, WRAP_BYTES).usage)!.micros;
  return { cache: price.cacheWrite, worst: reservationMicros(price), write: cost("cache_write"), near: cost("worst"), allowance: WRAPUP_ALLOWANCE[model]! * 1_000_000 };
};

test("at the stub context, a full cache write leaves room for the next wrap-up request on Opus and Sol, and on Opus three reports of 95% of the worst case leave none for a fourth request", () => {
  const opus = wrapCosts("anthropic", OPUS);
  expect(opus.cache).toBe("5m");
  expect(opus.worst).toBeLessThan(opus.allowance);
  expect(opus.write + opus.worst).toBeLessThan(opus.allowance);
  expect(opus.near).toBeLessThan(opus.worst);
  expect(2 * opus.near + opus.worst).toBeLessThan(opus.allowance);
  expect(3 * opus.near + opus.worst).toBeGreaterThan(opus.allowance);
  const sol = wrapCosts("openrouter", SOL);
  expect(sol.cache).toBe("5m");
  expect(sol.write + sol.worst).toBeLessThan(sol.allowance);
});

test("at the one-hour cache-write rate Sol's wrap-up allowance would not hold three calls in flight at the stub context, which is why the dry run fails a 1h request", () => {
  const sol = wrapCosts("openrouter", SOL, "1h");
  expect(sol.cache).toBe("1h");
  expect(sol.worst).toBeLessThan(sol.allowance);
  expect(3 * sol.worst).toBeGreaterThan(sol.allowance);
  expect(3 * wrapCosts("openrouter", SOL).worst).toBeLessThan(sol.allowance);
});

test("the concurrency line: each allowance holds the worst case of one call at a 200k-token context once for each call a session can hold in flight", () => {
  expect(CLAUDE_ENV.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe("2");
  const now = concurrencyCheck(CLAUDE_ENV);
  expect(now.inflight).toBe(3);
  expect(now.ok).toBe(true);
  const holds = (model: string) => Object.fromEntries(now.models.find((m) => m.model === model)!.allowances.map((a) => [a.slot, a.holds]));
  expect(now.models.filter((m) => m.model !== P1).map((m) => m.worst_micros)).toEqual([4_145_320, 3_985_320]);
  expect(holds(OPUS)).toEqual({ "P task": 3, "C task": 3, "N task": 3, "blind task": 3, "wrap-up": 3 });
  expect(holds(SOL)).toEqual({ "P task": 3, "C task": 3, "N task": 3, "wrap-up": 3 });
  expect(holds(P1)).toEqual({ "P task": 48, "C task": 48, "N task": 29, "wrap-up": 4 });
  expect(now.detail).toContain("3 calls in flight");
  const { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: _, ...unset } = CLAUDE_ENV;
  expect(concurrencyCheck(unset)).toMatchObject({ inflight: 21, ok: false });
  expect(concurrencyCheck({ ...CLAUDE_ENV, CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "3" })).toMatchObject({ inflight: 4, ok: false });
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
