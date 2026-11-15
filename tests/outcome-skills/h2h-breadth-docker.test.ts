// Copyright (c) 2026 Garry Tan. MIT License.
// Part B with Docker (GSTACK_EVALS_DOCKER=1): a local registry:2 store by digest (push, has, pull, assertStored), the
// browser conditions in a real container (the 2 GB /dev/shm, the read-only wrapper mount, the launcher env), and one Go
// B2 candidate served from a local git daemon through the recipe build, the store, discovery, the derived tests and the
// unit dir. No outside repository is fetched and no install script runs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extraArgs } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { readUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { docker, dockerAvailable } from "../../lanes/real-outcome/task/docker.ts";
import { BROWSER } from "../../lanes/outcome-skills/h2h/types.ts";
import { buildImage } from "../../lanes/outcome-skills/h2h/breadth/build.ts";
import { browserExtra, fetchFix, prepareB, repoFacts, type BCandidate, type BuildRecord } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import { chooseRecipe, isDrop, type Recipe } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";
import { assertStored, DIGEST_REF, registryStore, type ImageStore } from "../../lanes/outcome-skills/h2h/breadth/store.ts";

const REGISTRY = "registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
const on = process.env.GSTACK_EVALS_DOCKER === "1" && dockerAvailable();
const name = "h2h-reg-" + process.pid;
let store: ImageStore;
const pulled: string[] = [];

describe.skipIf(!on)("part B with Docker", () => {
  beforeAll(() => {
    expect(docker(["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::5000", REGISTRY], { timeoutMs: 300_000 }).status).toBe(0);
    store = registryStore("127.0.0.1:" + docker(["port", name, "5000"], { timeoutMs: 30_000 }).stdout.trim().split(":").pop() + "/h2h-test");
  });
  afterAll(() => {
    docker(["rm", "-f", name], { timeoutMs: 60_000 });
    for (const r of pulled) docker(["rmi", "-f", r], { timeoutMs: 60_000 });
  });

  test("registry store by digest, then the browser conditions in a container", () => {
    const ctx = mkdtempSync(join(tmpdir(), "h2h-store-"));
    const tag = "h2h-store-test:" + process.pid;
    try {
      writeFileSync(join(ctx, "Dockerfile"), "FROM " + REGISTRY + "\nRUN echo h2h > /h2h.txt\n");
      expect(docker(["build", "-q", "-t", tag, ctx], { timeoutMs: 300_000 }).status).toBe(0);
      const s = store.push(tag);
      expect(s.ref).toMatch(DIGEST_REF);
      expect(store.has(s.ref)).toBe(true);
      expect(store.has(s.ref.replace(/[0-9a-f]{64}$/, "0".repeat(64)))).toBe(false);
      assertStored(store, s.ref, s.ref);
      const local = store.pull(s.ref);
      pulled.push(local);
      const r = docker(["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", ...extraArgs(browserExtra()), "--entrypoint", "sh", local, "-c", "cat /h2h.txt; df -k /dev/shm | tail -1; test -x " + BROWSER.wrapper_container_path + " && echo wrapper-ok; echo CHROME_BIN=$CHROME_BIN"], { timeoutMs: 120_000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("h2h\n");
      expect(Number(r.stdout.split("\n")[1]!.trim().split(/\s+/)[1])).toBe(2 * 1024 * 1024);
      expect(r.stdout).toContain("wrapper-ok");
      expect(r.stdout).toContain("CHROME_BIN=" + BROWSER.env.CHROME_BIN);
    } finally {
      docker(["rmi", "-f", tag], { timeoutMs: 60_000 });
      rmSync(ctx, { recursive: true, force: true });
    }
  }, 900_000);

  test("a Go B2 candidate: build at the parent, store, discovery, derived tests, unit dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "h2h-go-"));
    const src = join(root, "srv", "acme", "calc");
    const work = join(root, "work"), db = join(root, "db");
    const git = (args: string[], cwd = src) => {
      const r = spawnSync("git", ["-c", "user.name=h2h", "-c", "user.email=h2h@example.invalid", ...args], { cwd, encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr);
      return r.stdout.trim();
    };
    const port = 20000 + (process.pid % 20000);
    const daemon = Bun.spawn(["git", "daemon", "--base-path=" + join(root, "srv"), "--export-all", "--reuseaddr", "--listen=0.0.0.0", "--port=" + port, join(root, "srv")], { stdout: "ignore", stderr: "ignore" });
    try {
      mkdirSync(src, { recursive: true });
      git(["init", "-q"]);
      git(["config", "uploadpack.allowAnySHA1InWant", "true"]);
      writeFileSync(join(src, "go.mod"), "module example.com/calc\n\ngo 1.21\n");
      writeFileSync(join(src, "calc.go"), "package calc\n\nfunc Add(a, b int) int { return a - b }\n\nfunc Sub(a, b int) int { return a - b }\n");
      writeFileSync(join(src, "calc_test.go"), 'package calc\n\nimport "testing"\n\nfunc TestSub(t *testing.T) {\n\tif Sub(3, 1) != 2 {\n\t\tt.Fatal("sub")\n\t}\n}\n');
      git(["add", "-A"]);
      git(["commit", "-q", "-m", "base"]);
      const parent = git(["rev-parse", "HEAD"]);
      writeFileSync(join(src, "calc.go"), "package calc\n\nfunc Add(a, b int) int { return a + b }\n\nfunc Sub(a, b int) int { return a - b }\n");
      writeFileSync(join(src, "calc_test.go"), readFileSync(join(src, "calc_test.go"), "utf8") + '\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 2) != 4 {\n\t\tt.Fatal("add")\n\t}\n}\n');
      git(["commit", "-q", "-am", "fix Add"]);
      const commit = git(["rev-parse", "HEAD"]);
      mkdirSync(join(work, "git"), { recursive: true });
      git(["clone", "-q", "--bare", src, join(work, "git", "acme__calc.git")], root);
      mkdirSync(db, { recursive: true });
      writeFileSync(join(db, "adv.json"), JSON.stringify({ id: "GHSA-test-0000-0000", summary: "Add returns the difference of its arguments", details: "Every caller that sums two quantities with calc.Add gets a minus b instead of a plus b, so totals computed from user input come out wrong and checks that compare totals can be passed with crafted values. The fix is at https://github.com/acme/calc/commit/" + commit + "." }));
      const c: BCandidate = { kind: "B2", id: "acme__calc-ghsa-test-0000-0000", repo: "acme/calc", ecosystems: ["Go"], month: "2026-05", created_at: "2026-05-01", pull: "", fix: { commit, parent }, licence: "MIT", second_read_pending: false, runners: [], ghsa: "GHSA-test-0000-0000", advisory_path: "adv.json" };
      const dir = fetchFix(work, c);
      if (isDrop(dir)) throw new Error(dir.rule);
      const recipe = chooseRecipe("B2", "Go", repoFacts(dir, parent));
      expect(isDrop(recipe)).toBe(false);
      const b = buildImage({ recipe: recipe as Recipe, repoUrl: "git://172.17.0.1:" + port + "/acme/calc", parent, tag: "h2h-b/" + c.id });
      if (isDrop(b)) throw new Error(b.rule + "\n" + b.log_tail);
      const s = store.push(b.tag);
      pulled.push(b.tag);
      const build: BuildRecord = { schema: "h2h-b-build.v1", id: c.id, kind: "B2", verdict: "built", rule: null, ecosystem: "Go", recipe: recipe as Recipe, tag: b.tag, image_id: b.image_id, wall_ms: b.wall_ms, dockerfile_sha256: "0".repeat(64) };
      const prep = await prepareB({ c, work, ref: s.ref, store, build, db });
      pulled.push(store.pull(s.ref));
      expect([prep.verdict, prep.rule, prep.runner]).toEqual(["ready", null, "go"]);
      const u = readUnit(prep.unit_dir!);
      expect(u.tests.f2p.some((id) => id.endsWith("TestAdd"))).toBe(true);
      expect(u.tests.p2p.some((id) => id.endsWith("TestSub"))).toBe(true);
      expect(u.image.ref).toBe(s.ref);
      expect(u.lang).toBe("go");
      const issue = readFileSync(join(prep.unit_dir!, "issue.md"), "utf8");
      expect(issue).not.toContain(commit.slice(0, 7));
      expect(issue).toContain("(CC-BY-4.0).");
      expect(readFileSync(join(prep.unit_dir!, "test.patch"), "utf8")).toContain("TestAdd");
      expect(readFileSync(join(prep.unit_dir!, "fix.patch"), "utf8")).toContain("return a + b");
    } finally {
      daemon.kill();
      rmSync(root, { recursive: true, force: true });
    }
  }, 1_800_000);
});
