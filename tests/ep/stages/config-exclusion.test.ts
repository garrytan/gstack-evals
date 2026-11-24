// Copyright (c) 2026 Garry Tan. MIT License.
// A unit whose B the sandbox would still refuse after the frozen strip leaves the planted pool before any outcome
// (dated deviation, 2026-11-17: lease 8 stopped on a B that tracks .mcp.json, which the strip leaves in place). The
// verdict here is the sidecar's own: each fixture B goes through stripBase on a copy, then a Sidecar opens a trial on its
// bundle, and a unit must leave the calls and hinted steps exactly when that trial is refused.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripBase } from "../../../lanes/eng-build/build-stage.ts";
import { stagesCommands } from "../../../lanes/eng-planted/stages/commands.ts";
import { ITEMS, stubLauncher } from "../../../lanes/eng-planted/stages/ledger.ts";
import { drawFile, unitFolders } from "../../../lanes/eng-planted/stages/pipeline.ts";
import { SandboxError, Sidecar } from "../../../lanes/real-outcome/sandbox/sidecar.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { authorStub, buildStub, graderStub, plantedUnits, type SeenBuild } from "./fixture.ts";

setDefaultTimeout(60_000);

const root = mkdtempSync(join(tmpdir(), "ep-config-exclusion-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (repo: string, ...args: string[]) => spawnSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });

/** Adds files to a fixture B and amends its one commit to track them. */
function plant(repo: string, paths: string[]): void {
  for (const p of paths) {
    mkdirSync(join(repo, p, ".."), { recursive: true });
    writeFileSync(join(repo, p), "{}\n");
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--amend", "-m", "base");
}

let trials = 0;
/** The sidecar's verdict on B as a planted build hands it over (stripBase on a copy, then a trial opened on its bundle), or on B unstripped. */
function sidecarRefuses(repo: string, strip = true): boolean {
  const dir = join(root, "sidecar-" + ++trials);
  const copy = join(dir, "repo");
  cpSync(repo, copy, { recursive: true });
  if (strip) stripBase(copy);
  const bundle = join(dir, "base.bundle");
  expect(git(copy, "bundle", "create", "-q", bundle, "refs/heads/main").status).toBe(0);
  const base = git(copy, "rev-parse", "HEAD").stdout.trim();
  try {
    new Sidecar(join(dir, "sidecar"), "http://127.0.0.1:9").open({ trial: "t" + trials, repo: "sandbox/repo", kind: "K2", base_branch: "main", base_commit: base, start_ref: "main", bundle });
    return false;
  } catch (e) {
    if (e instanceof SandboxError && e.message.includes("project-local Claude Code configuration")) return true;
    throw e;
  }
}

const W = join(root, "w");
const SEED = "5eed0000000000000000000000000002";
let fx: { units: string; repos: string; ids: string[] };
let order: string[] = [];
const repo = (i: number) => join(fx.repos, order[i]!);
const NESTED = 0;
const STRIPPED = 1;
const NEAR = 2;
const LATE = 3;
const seen: string[] = [];
const builds: SeenBuild[] = [];
const lines: string[] = [];
const authored = (i: number) => seen.some((s) => s.endsWith(":" + order[i]));
const built = (i: number) => builds.some((b) => b.unit === order[i]);
const excludedLine = (i: number) => lines.some((l) => l.startsWith("excluded " + order[i] + " "));

beforeAll(async () => {
  fx = plantedUnits(W, 9);
  order = drawFile(join(W, "run"), unitFolders(fx.units, fx.repos), SEED).order.map((c) => c.id);
  plant(repo(NESTED), ["pkg/.mcp.json"]);
  plant(repo(STRIPPED), [".claude/settings.json", ".claude/.mcp.json", "CLAUDE.md", "AGENTS.md", "docs/CLAUDE.md", "sub/.claude/skills/x/SKILL.md"]);
  plant(repo(NEAR), [".mcp.json.example"]);
  const record = join(W, "record");
  const quotes = [{ words: "keyless test on a temporary ledger", by: "ep config-exclusion test", source: "tests/ep/stages/config-exclusion.test.ts" }];
  for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * 1_000_000, quotes, admission: "warn" });
  const unavailable = () => {
    throw new Error("not used by the authoring steps");
  };
  const t = stagesCommands({ author: () => stubLauncher(authorStub({ seen })), build: () => stubLauncher(buildStub(W, builds)), grader: async () => graderStub(), judge: unavailable, review: unavailable } as never);
  const item = ITEMS.find((i) => i.item === "ep-authoring")!;
  const io = { out: (l: string) => void lines.push(l), err: (l: string) => void lines.push(l) };
  const run = (step: string) => t.author!.run({ flags: new Map(Object.entries({ "--run": join(W, "run"), "--units": fx.units, "--repos": fx.repos, "--item": item.item, "--cap-usd": String(item.capUsd), "--ledger-record": record, "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--cache": join(W, "cache"), "--work": join(W, "work"), "--batch": "1", "--step": step, "--chunk": "6" })), bools: new Set<string>(), rest: [] }, io);
  expect(await run("calls")).toBe(0);
  expect(authored(LATE)).toBe(true);
  plant(repo(LATE), [".mcp.json"]);
  expect(await run("hinted")).toBe(0);
});

describe("units whose stripped B the sandbox refuses", () => {
  // Value: protects=no session or model call is spent on a unit the sandbox would refuse; fails_when=a B that tracks a
  // nested .mcp.json, which the strip leaves, is authored or built.
  test("a nested .mcp.json: the unit leaves before authoring and is never built", () => {
    expect(sidecarRefuses(repo(NESTED))).toBe(true);
    expect(authored(NESTED)).toBe(false);
    expect(built(NESTED)).toBe(false);
    expect(excludedLine(NESTED)).toBe(true);
  });
  // Value: protects=a unit authored before the rule (lease 8's stop) is not built; fails_when=the hinted step builds a
  // unit whose calls passed but whose stripped B the sandbox refuses.
  test("a unit authored before its B was found to track .mcp.json is never built", () => {
    expect(sidecarRefuses(repo(LATE))).toBe(true);
    expect(built(LATE)).toBe(false);
    expect(excludedLine(LATE)).toBe(true);
  });
  // Value: protects=the rule removes only what the strip leaves; fails_when=the check reads B before the strip, so a unit
  // whose only hits are .claude/, CLAUDE.md or AGENTS.md leaves the pool.
  test("a tree whose only hits are .claude/, CLAUDE.md or AGENTS.md stays in", () => {
    expect(sidecarRefuses(repo(STRIPPED), false)).toBe(true);
    expect(sidecarRefuses(repo(STRIPPED))).toBe(false);
    expect(authored(STRIPPED)).toBe(true);
    expect(built(STRIPPED)).toBe(true);
    expect(excludedLine(STRIPPED)).toBe(false);
  });
  // Value: protects=the rule and the sidecar cannot drift on a near-miss name; fails_when=.mcp.json.example leaves the
  // pool while the sidecar would open its trial, or stays while the sidecar would refuse it.
  test(".mcp.json.example gets the sidecar's own verdict", () => {
    const refused = sidecarRefuses(repo(NEAR));
    expect(authored(NEAR)).toBe(!refused);
    expect(built(NEAR)).toBe(!refused);
    expect(excludedLine(NEAR)).toBe(refused);
  });
  test("every other unit is authored and built as before", () => {
    for (const i of [4, 5]) {
      expect(sidecarRefuses(repo(i))).toBe(false);
      expect(authored(i) && built(i) && !excludedLine(i)).toBe(true);
    }
  });
});
