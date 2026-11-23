// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's Harbor inputs (ext/run.ts): the h2h config that sends an s-* arm to the Codex loop, the overlay that mounts part
// S's runtime volume and no Claude Code, and the run copy's argv with part S's model and no provider key.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import type { SessionImage } from "../../lanes/outcome-skills/statemachines/image.ts";
import type { ExtPlanned } from "../../lanes/outcome-skills/h2h/ext/plan.ts";
import { readExtPrereg, S_ARMS } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { CODEX_HOME, extConfig, extHomeRule, extRunCopy, type ExtRunInput } from "../../lanes/outcome-skills/h2h/ext/run.ts";
import type { H2hUnitInput } from "../../lanes/outcome-skills/h2h/sessions/run.ts";

const X = readExtPrereg();
const P = readPrereg();
const image: SessionImage = { image_id: "sha256:" + "e".repeat(64), tag: "h2hx-session:test", runtime_id: "sha256:" + "c".repeat(64), volume: "v", commits: 1, head: "a".repeat(40), home: "none", tree_patch_sha256: null, qa_home: null, removed: [] } as SessionImage;
const unit = { unit: { id: "u1", kind: "O" }, statement: "Fix the parser.", image, repo_dir: "/w", work_dir: "/w" } as unknown as H2hUnitInput;
const planned = (arm: ExtPlanned["arm"]): ExtPlanned => ({ part: "S", unit: "u1", kind: "O", entry: "bug", stage: "stage1", index: 0, arm, item: "h2hx-s-pilot" } as ExtPlanned);
const input = (arm: ExtPlanned["arm"], home: string | null): ExtRunInput => ({ session: planned(arm), unit, home, control: "http://127.0.0.1:9", proxy: "127.0.0.1:8", runtime: { volume: "h2hx-runtimes-" + "0".repeat(16) } });

test("every s-* arm's config names the Codex host block, part S's limits and the base post's texts", () => {
  for (const arm of S_ARMS) {
    const c = extConfig(input(arm, arm === "s-none" ? null : "/h"), "Fix the parser.", "O");
    expect(c.host).toBe("codex");
    expect(c.codex).toEqual({ bin: "/opt/h2h-runtimes/bin/sol-agent", home: CODEX_HOME, model: X.parts.S.model, effort: X.parts.S.reasoning_effort, version: X.parts.S.codex.version });
    expect(c.limits).toMatchObject({ allowance_usd: X.parts.S.limits.allowance_usd, wall_sec: X.parts.S.limits.wall_sec, max_turns: X.parts.S.limits.max_turns });
    expect([c.continuation, c.done_rule, c.continuation_cap, c.no_answer]).toEqual([P.texts.continuation, P.done_rule, P.continuation_cap, P.texts.question_reply]);
    expect(c.turns.some((t) => t.includes("Fix the parser."))).toBe(true);
    expect(c.home_rule).toBe(extHomeRule(arm));
    expect(c.env).toEqual({ HOME: "/root", GSTACK_TELEMETRY_SOURCE: "eval" });
  }
  expect(S_ARMS.map(extHomeRule)).toEqual(["none", "gstack", "gstack", "pack", "pack", "pack", "pack"]);
});

test("refuses a home on s-none, no home on a pack arm, and an arm from another part", () => {
  expect(() => extConfig(input("s-none", "/h"), "x", "O")).toThrow(/^E_H2HX_CODEX_CONFIG /);
  expect(() => extConfig(input("s-gsd", null), "x", "O")).toThrow(/^E_H2HX_CODEX_CONFIG /);
  expect(() => extConfig({ ...input("s-none", null), session: { ...planned("s-none"), arm: "p-none" } as ExtPlanned }, "x", "O")).toThrow(/^E_H2HX_CODEX_CONFIG /);
});

test("the run copy mounts part S's runtime volume and no Claude Code, runs part S's model and carries no provider key", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2hx-run-"));
  const { argv, env } = extRunCopy(input("s-gstack", "/h"), 1, dir);
  const ak = Object.fromEntries(argv.flatMap((a, n) => (argv[n - 1] === "--ak" ? [a.split("=", 2) as [string, string]] : [])));
  expect(ak).toMatchObject({ arm: "h2h:s-gstack", upstream_model: X.parts.S.model, ledger: "u4" });
  expect(argv[argv.indexOf("-m") + 1]).toBe("anthropic/" + X.parts.S.model);
  expect(argv).toContain("h2h_agent:H2hAgent");
  const compose = JSON.parse(readFileSync(join(dir, "h2h.compose.yaml"), "utf8"));
  expect(compose.services.main.volumes).toEqual([{ type: "volume", source: "h2hx-runtimes-" + "0".repeat(16), target: "/opt/h2h-runtimes", read_only: true }]);
  expect(JSON.parse(readFileSync(join(dir, "h2h-config.json"), "utf8")).host).toBe("codex");
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.ANTHROPIC_API_KEY).toBe("placeholder-not-a-key");
  expect(env.PYTHONPATH!.split(":").slice(0, 2).map((p) => p.split("/").pop())).toEqual(["ext", "sessions"]);
  expect(() => extRunCopy({ ...input("s-gstack", "/h"), runtime: { volume: "h2h-runtimes-" + "0".repeat(16) } }, 1, dir)).toThrow(/^E_H2HX_CODEX_RUNTIME /);
  expect(extRunCopy(input("s-gstack", "/h"), 2, mkdtempSync(join(tmpdir(), "h2hx-run-"))).argv.some((a) => a.startsWith("rerun="))).toBe(true);
});
