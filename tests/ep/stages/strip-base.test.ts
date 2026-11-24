// Copyright (c) 2026 Garry Tan. MIT License.
// The strip rule reaches the base commit (dated pre-run fix, 2026-11-17). 70 of the run's 135 units track AGENTS.md,
// CLAUDE.md or .claude in B, so prepareTree refused their review and build trees. stripBase writes the one commit again
// without them and prunes the old objects; the planted review seed and the planted build launcher run it before
// prepareTree, and the unit's own B is left as it is. It refuses a repository with alternates, a kept pack or a nested
// .git, and resets the index first (second dated pre-run change, 2026-11-17). The hinted step's log line counts passing runs per planted case and
// never names a case.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTree, stripBase } from "../../../lanes/eng-build/build-stage.ts";
import { codeOf } from "../../../lanes/eng-planted/stages/cases.ts";
import { stagesCommands } from "../../../lanes/eng-planted/stages/commands.ts";
import { itemOf, ItemGate, ITEMS, stubLauncher } from "../../../lanes/eng-planted/stages/ledger.ts";
import { runPlantedReviews } from "../../../lanes/eng-planted/stages/pipeline.ts";
import type { PlantedUnit } from "../../../lanes/eng-planted/types.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { authorStub, buildStub, graderStub, plantedUnits, type SeenBuild } from "./fixture.ts";

const root = mkdtempSync(join(tmpdir(), "ep-strip-base-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (repo: string, ...args: string[]) => spawnSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
const tracked = (repo: string) => git(repo, "ls-tree", "-r", "--name-only", "HEAD").stdout.trim().split("\n");

/** Adds agent files to a fixture B and amends its one commit to track them; returns the AGENTS.md blob. */
function plantAgentFiles(repo: string): string {
  mkdirSync(join(repo, ".claude"), { recursive: true });
  mkdirSync(join(repo, "sub"), { recursive: true });
  writeFileSync(join(repo, "AGENTS.md"), "agent notes\n");
  writeFileSync(join(repo, "sub", "CLAUDE.md"), "claude notes\n");
  writeFileSync(join(repo, ".claude", "settings.json"), "{}\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--amend", "-m", "base\n\nbody line");
  return git(repo, "rev-parse", "HEAD:AGENTS.md").stdout.trim();
}

describe("stripBase", () => {
  test("writes B again without the stripped names, keeps its message, author and dates, and prunes the old objects", () => {
    const { repos, ids } = plantedUnits(join(root, "a"), 1);
    const repo = join(repos, ids[0]!);
    const blob = plantAgentFiles(repo);
    const meta = () => git(repo, "log", "-1", "--format=%an %ae %aI %cn %ce %cI%n%B").stdout;
    const before = meta();
    expect(stripBase(repo)).toEqual([".claude/settings.json", "AGENTS.md", "sub/CLAUDE.md"]);
    expect(tracked(repo)).toEqual(["range.go"]);
    expect(meta()).toBe(before);
    expect(git(repo, "rev-list", "--all", "--count").stdout.trim()).toBe("1");
    expect(git(repo, "cat-file", "-e", blob).status).not.toBe(0);
    expect(prepareTree(repo)).toEqual([".claude", "AGENTS.md", "sub/CLAUDE.md"]);
    expect(git(repo, "status", "--porcelain").stdout).toBe("");
  });
  test("leaves a base that tracks no stripped name as it is", () => {
    const { repos, ids } = plantedUnits(join(root, "b"), 1);
    const repo = join(repos, ids[0]!);
    const head = git(repo, "rev-parse", "HEAD").stdout;
    expect(stripBase(repo)).toEqual([]);
    expect(git(repo, "rev-parse", "HEAD").stdout).toBe(head);
  });
  // Value: protects=the new base commit holds B's tree less the stripped names and nothing else; fails_when=a file staged
  // in the copied index reaches the commit stripBase writes.
  test("resets the index to B first, so a staged file never reaches the new commit", () => {
    const { repos, ids } = plantedUnits(join(root, "e"), 1);
    const repo = join(repos, ids[0]!);
    plantAgentFiles(repo);
    writeFileSync(join(repo, "staged.txt"), "staged\n");
    git(repo, "add", "staged.txt");
    expect(stripBase(repo)).toEqual([".claude/settings.json", "AGENTS.md", "sub/CLAUDE.md"]);
    expect(tracked(repo)).toEqual(["range.go"]);
    expect(git(repo, "diff", "--cached", "--name-only").stdout).toBe("");
  });
  // Value: protects=the old objects of a stripped file are gone after the prune; fails_when=a repository whose objects
  // the prune can't reach, or whose history sits in another .git, is rewritten instead of refused.
  const refused = async (name: string, setup: (repo: string) => void) => {
    const { repos, ids } = plantedUnits(join(root, "f-" + name), 1);
    const repo = join(repos, ids[0]!);
    plantAgentFiles(repo);
    setup(repo);
    const head = git(repo, "rev-parse", "HEAD").stdout;
    expect(await codeOf(() => stripBase(repo))).toBe("E_USAGE");
    expect(git(repo, "rev-parse", "HEAD").stdout).toBe(head);
  };
  test("refuses a repository that borrows objects from another store, and writes nothing", async () => {
    await refused("alternates", (repo) => {
      const other = join(root, "f-store");
      spawnSync("git", ["init", "-q", other]);
      writeFileSync(join(repo, ".git/objects/info/alternates"), join(other, ".git/objects") + "\n");
    });
  });
  test("refuses a repository that keeps a pack, and writes nothing", async () => {
    await refused("keep", (repo) => {
      git(repo, "repack", "-a", "-d", "-q");
      const packs = join(repo, ".git/objects/pack");
      for (const f of readdirSync(packs).filter((f) => f.endsWith(".pack"))) writeFileSync(join(packs, f.replace(/\.pack$/, ".keep")), "");
    });
  });
  test("refuses a repository that holds another .git below its root, and writes nothing", async () => {
    await refused("nested", (repo) => {
      mkdirSync(join(repo, "vendor/lib"), { recursive: true });
      spawnSync("git", ["init", "-q", join(repo, "vendor/lib")]);
    });
  });
});

describe("the planted review seed", () => {
  test("holds B with the stripped names out of its one commit and its object store, and the unit's B keeps them", async () => {
    const dir = join(root, "c");
    const fx = plantedUnits(dir, 1);
    const id = fx.ids[0]!;
    const blob = plantAgentFiles(join(fx.repos, id));
    const plan = join(dir, "plan.md");
    writeFileSync(plan, "# Plan\n");
    const unit = JSON.parse(readFileSync(join(fx.units, id, "ep-unit.json"), "utf8")) as PlantedUnit;
    const units = new Map([[id, { unit, base: join(fx.repos, id), plan, opening: null }]]);
    const seen: { files: string[]; blob: boolean }[] = [];
    const session = async (s: { seed: string }) => {
      seen.push({ files: tracked(join(s.seed, "repo")), blob: git(join(s.seed, "repo"), "cat-file", "-e", blob).status === 0 });
      throw new Error("seen");
    };
    const g = new ItemGate(itemOf("ep-comparison"), { capUsd: 40, planned: { "review:plain": 1, "review:standalone": 0, "review:engphase": 0, build: 0 } });
    expect(await codeOf(() => runPlantedReviews({ cells: [{ unit: id, arm: "plain", rep: 1 }], units, reviewer: "opus", out: join(dir, "out"), session: session as never, gate: g, interim: false }))).toBe("error: seen");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.files.join() === "range.go" && !s.blob)).toBe(true);
    expect(tracked(join(fx.repos, id))).toContain("AGENTS.md");
  });
});

describe("the hinted step's log", () => {
  test("counts passing runs per planted case and names no case", async () => {
    const W = join(root, "d");
    const fx = plantedUnits(W, 6);
    const record = join(W, "record");
    const quotes = [{ words: "keyless test on a temporary ledger", by: "ep strip-base test", source: "tests/ep/stages/strip-base.test.ts" }];
    for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * 1_000_000, quotes, admission: "warn" });
    const builds: SeenBuild[] = [];
    const unavailable = () => {
      throw new Error("not used by the authoring steps");
    };
    const t = stagesCommands({ author: () => stubLauncher(authorStub()), build: () => stubLauncher(buildStub(W, builds)), grader: async () => graderStub(), judge: unavailable, review: unavailable } as never);
    const item = ITEMS.find((i) => i.item === "ep-authoring")!;
    const lines: string[] = [];
    const io = { out: (l: string) => void lines.push(l), err: (l: string) => void lines.push(l) };
    const run = (step: string) => t.author!.run({ flags: new Map(Object.entries({ "--run": join(W, "run"), "--units": fx.units, "--repos": fx.repos, "--item": item.item, "--cap-usd": String(item.capUsd), "--ledger-record": record, "--ledger": join(W, "ledger.sqlite"), "--crew-usd": "450", "--hosts-usd": "90", "--cache": join(W, "cache"), "--work": join(W, "work"), "--batch": "1", "--step": step, "--chunk": "3" })), bools: new Set<string>(), rest: [] }, io);
    expect(await run("calls")).toBe(0);
    expect(await run("hinted")).toBe(0);
    const hinted = lines.filter((l) => l.startsWith("hinted "));
    expect(hinted.length).toBe(3);
    expect(hinted.every((l) => / passing runs per planted case 3$/.test(l) && !l.includes("p1"))).toBe(true);
  });
});
