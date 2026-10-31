import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { removeTree } from "../../../src/trial/cleanup.ts";
import type { Runner } from "../../../src/trial/image.ts";
import { buildTrialImage, stateRoot } from "../../../src/trial/image.ts";
import { createTrialNetwork, removeTrialNetwork } from "../../../src/trial/proxy.ts";
import { dockerSandbox } from "../../../src/trial/sandbox.ts";
import { buildUnitRepo, buildUnitTree, historyProblems, unitTaskId } from "../../../src/trial/review/unit.ts";
import { git } from "../../cli/helpers.ts";
import { sourceRepo } from "./helpers.ts";

const roots: string[] = [];
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-unit-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => roots.forEach((r) => removeTree(r)));

const unitOf = (s: { head: string; base: string }) => ({ id: "garrytan/gstack#7@" + s.head.slice(0, 12), repo: "garrytan/gstack", pr: 7, head: s.head, base: s.base });

describe("unit repositories from head-only fetches (T5)", () => {
  // Value: protects=a unit repo holds the head's ancestry only, with no tags, remotes, reflog or unreachable objects, origin/main, main and origin/HEAD at the merge-base so a review finds the PR's diff, and instruction digests recorded; fails_when=a later fix, a tag or a remote reaches the agent, or gstack /review cannot find its base; why_new=GEVA-70 build step 2 (plan section 6, T5); seam=buildUnitRepo, historyProblems; no_claim=the Docker view, which the Docker tier checks
  test("build, history check and tamper detection", () => {
    const s = sourceRepo();
    const dest = join(scratch("repo"), "unit");
    const repo = buildUnitRepo({ unit: unitOf(s), source: s.root, dest });
    expect(repo).toMatchObject({ head: s.head, base: s.base, merge_base: s.mergeBase, head_branch: "pr-7", base_branch: "main", ancestry: { count: 3 } });
    expect(Object.keys(repo.instructions)).toEqual([".gstack/config.json", "AGENTS.md", "CLAUDE.md"]);
    expect(historyProblems(dest, repo)).toEqual([]);
    expect(git(dest, "merge-base", "HEAD", "origin/HEAD")).toBe(s.mergeBase);
    expect(git(dest, "diff", "--name-only", "main...HEAD").split("\n").sort()).toEqual([".gstack/config.json", "AGENTS.md", "src/a.ts", "src/b.ts"]);
    expect(spawnSync("git", ["-C", dest, "cat-file", "-e", s.base]).status).not.toBe(0);
  });

  test("the history check names every problem", () => {
    const s = sourceRepo();
    const dest = join(scratch("tamper"), "unit");
    const repo = buildUnitRepo({ unit: unitOf(s), source: s.root, dest });
    git(dest, "tag", "leak");
    git(dest, "remote", "add", "origin", s.root);
    writeFileSync(join(dest, "src/a.ts"), "edited\n");
    const problems = historyProblems(dest, repo);
    expect(problems.some((p) => p.startsWith("tags present"))).toBe(true);
    expect(problems.some((p) => p.startsWith("remotes configured"))).toBe(true);
    expect(problems.some((p) => p.startsWith("refs are"))).toBe(true);
    expect(problems.some((p) => p.startsWith("the working tree is not clean"))).toBe(true);
    expect(() => buildUnitRepo({ unit: { ...unitOf(s), repo: "someone/else" }, source: s.root, dest: join(scratch("x"), "u") })).toThrow(/^E_UNIT_REPO: .*no default branch/);
    expect(unitTaskId(unitOf(s))).toBe("gstack-7-" + s.head.slice(0, 8));
  });

  // Value: protects=a source clone named by a relative path is fetched from where the caller named it, not from inside the new unit repository; fails_when=git fetch resolves the path against the unit's directory and cannot find the clone; why_new=Capy review of #93 (a relative --source failed at the fetch); seam=buildUnitRepo; no_claim=none
  test("a relative source path", () => {
    const s = sourceRepo();
    const dest = join(scratch("relative"), "unit");
    const repo = buildUnitRepo({ unit: unitOf(s), source: relative(process.cwd(), s.root), dest });
    expect(historyProblems(dest, repo)).toEqual([]);
  });
});

describe("unit trees", () => {
  // Value: protects=the install runs with egress and the unit's own test runs with --network none on a throwaway copy, at the agent's path, and a failing test is a problem; fails_when=the test runs online, writes into the kept tree, or a failure passes; why_new=GEVA-70 build step 2 (unit-image check); seam=buildUnitTree; no_claim=bun install itself, which the step-5 build runs
  test("install, offline test and digest, with a fake docker runner", () => {
    const s = sourceRepo();
    const dir = scratch("tree");
    const repo = buildUnitRepo({ unit: unitOf(s), source: s.root, dest: join(dir, "repo") });
    const calls: string[][] = [];
    const run: Runner = (_cmd, args) => {
      calls.push(args);
      const mount = args[args.indexOf("-v") + 1]!.split(":")[0]!;
      const r = spawnSync("sh", ["-c", args.at(-1)!.replace('mkdir -p "$HOME" && ', "")], { cwd: mount, encoding: "utf8" });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const task = unitTaskId(unitOf(s));
    const ok = buildUnitTree({ repo, task, dest: join(dir, "tree"), image: "trial:test", install: "mkdir -p node_modules/x && echo 1 > node_modules/x/i.js", test: "test -f node_modules/x/i.js && touch made-by-test", scratch: join(dir, "scratch"), retain: join(dir, "retain"), run });
    expect(ok.problems).toEqual([]);
    expect(ok.test.passed).toBe(true);
    expect(calls[0]).not.toContain("none");
    expect(calls[1]!.slice(calls[1]!.indexOf("--network"), calls[1]!.indexOf("--network") + 2)).toEqual(["--network", "none"]);
    expect(calls[0]).toContain(join(dir, "tree") + ":/work/" + task);
    expect(existsSync(join(dir, "tree", "made-by-test"))).toBe(false);
    expect(existsSync(join(dir, "retain", "trees", ok.tree_sha256 + ".tar"))).toBe(true);
    const bad = buildUnitTree({ repo, task, dest: join(dir, "tree2"), image: "trial:test", install: "true", test: "exit 3", scratch: join(dir, "scratch"), run });
    expect(bad.problems.some((p) => p.includes("exited 3 offline"))).toBe(true);
  });
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("unit repositories in the agent container (Docker tier, GSTACK_EVALS_DOCKER=1)", () => {
  // Value: protects=inside an agent container on the trial network the seeded unit's git history is the head's ancestry and DNS fails; fails_when=the container sees other commits or can resolve names; why_new=GEVA-70 build step 2 (plan section 6 history and DNS test); seam=buildUnitRepo with dockerSandbox and createTrialNetwork; no_claim=a model call
  test("rev-list --all is the head's ancestry and DNS fails", () => {
    const built = buildTrialImage({ state: stateRoot() });
    if (!built.ok) throw new Error(built.message);
    const s = sourceRepo();
    const work = join(scratch("docker"), "unit");
    buildUnitRepo({ unit: unitOf(s), source: s.root, dest: work });
    const net = createTrialNetwork();
    const agent = dockerSandbox({ trialImage: built.tag }).agent(unitTaskId(unitOf(s)), { work, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/agent" }, network: net.name });
    try {
      const inside = agent.exec("git rev-list --all | sort", 60_000);
      expect(inside.exitCode).toBe(0);
      expect(inside.stdout.trim()).toBe(git(s.root, "rev-list", s.head).split("\n").sort().join("\n"));
      expect(agent.exec("getent hosts example.com", 30_000).exitCode).not.toBe(0);
    } finally {
      agent.stop();
      removeTrialNetwork(net);
    }
  }, 1_800_000);
});
