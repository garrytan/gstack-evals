// Copyright (c) 2026 Garry Tan. MIT License.
// Scoring tree volumes (plan section 6.5, the Captain's A1 ruling): each tree starts as a copy of the prepared tree volume,
// the image's repo dir as the oracle and the neutral gate run it, with the tree commit checked out over it. The keyless
// part reads the container script's order and its output; the Docker part (GSTACK_EVALS_DOCKER=1 and PF_DOCKER_IMAGE, an
// image with sh, bash, coreutils and git) shows ignored build state kept, a tracked file the checkout corrects, and an
// untracked file that isn't ignored stopping the run.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerExecutor, readTree, scoreEntries, TREE_SCRIPT } from "../../lanes/outcome-skills/pfchecks/runner.ts";
import { buildTrees } from "../../lanes/outcome-skills/pfchecks/trees.ts";

test("the tree script stops on untracked files before any checkout, and checks the tree after it", () => {
  const at = (s: string) => TREE_SCRIPT.indexOf(s);
  expect(at("cp -a /b/. /d/")).toBeGreaterThan(-1);
  expect(at("PF_UNTRACKED before")).toBeGreaterThan(at("cp -a /b/. /d/"));
  expect(at("checkout")).toBeGreaterThan(at("PF_UNTRACKED before"));
  expect(at("diff --quiet")).toBeGreaterThan(at("checkout"));
  expect(at("diff --cached --quiet")).toBeGreaterThan(at("checkout"));
  expect(at("PF_UNTRACKED after")).toBeGreaterThan(at("checkout"));
  expect(TREE_SCRIPT).not.toContain("clean");
});

test("readTree passes PF_TREE_OK and names each refusal", () => {
  expect(() => readTree(0, "PF_TREE_OK\n", "", "v")).not.toThrow();
  expect(() => readTree(3, "PF_UNTRACKED before stray.txt\nPF_UNTRACKED before a/b.c\n", "", "v")).toThrow(/E_PF_TREE_STATE.*2 untracked.*stray\.txt, a\/b\.c/);
  expect(() => readTree(4, "PF_TREE_DIFF tracked state.go\n", "", "v")).toThrow(/E_PF_TREE_STATE.*state\.go/);
  expect(() => readTree(1, "", "cp: no space left on device", "v")).toThrow(/E_PF_INFRA_GAP.*no space/);
  expect(() => readTree(0, "", "", "v")).toThrow(/E_PF_INFRA_GAP/);
});

const IMAGE = process.env.PF_DOCKER_IMAGE ?? "";
const on = process.env.GSTACK_EVALS_DOCKER === "1" && !!IMAGE;
const g = (d: string, ...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8" }).stdout;
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8" });
const cleanups: Array<() => void> = [];
afterAll(() => cleanups.forEach((c) => c()));

/** A base repo (one commit, out/ ignored, a built file in out/), the session repo cloned from it with a check and a session
 *  end commit, its trees, and a volume seeded from the base dir after edit() runs on it, as the oracle's prepare seeds one. */
function fixture(edit: (base: string) => void) {
  const d = mkdtempSync(join(tmpdir(), "pf-tv-"));
  const base = join(d, "base"), s = join(d, "s");
  mkdirSync(base);
  g(base, "init", "-q", "-b", "main");
  writeFileSync(join(base, ".gitignore"), "out/\n");
  writeFileSync(join(base, "state.go"), "bug\n");
  g(base, "add", "-A");
  g(base, "commit", "-q", "-m", "base");
  const fixPatch = "diff --git a/state.go b/state.go\n--- a/state.go\n+++ b/state.go\n@@ -1 +1 @@\n-bug\n+fixed\n";
  cpSync(base, s, { recursive: true });
  mkdirSync(join(base, "out"));
  writeFileSync(join(base, "out", "built.txt"), "warm\n");
  writeFileSync(join(s, "check_test.sh"), "test -f out/built.txt\n");
  g(s, "add", "-A");
  g(s, "commit", "-q", "-m", "session end");
  edit(base);
  const vol = "pf-tv-base-" + process.pid + "-" + cleanups.length;
  docker("volume", "create", vol);
  cleanups.push(() => docker("volume", "rm", "-f", vol));
  const c = docker("run", "--rm", "--network", "none", "--user", "0:0", "-v", base + ":/s:ro", "-v", vol + ":/d", "--entrypoint", "sh", IMAGE, "-c", "cp -a /s/. /d/");
  if (c.status !== 0) throw new Error("seeding " + vol + " failed: " + c.stderr);
  const t = buildTrees({ repo: s, ref: "HEAD", lang: "go", testFiles: new Set(), fixPatch, neutral: { mode: "end", files: ["state.go"] } });
  const ex = dockerExecutor({ repo: s, image: IMAGE, repoDir: "/repo", mode: "root", rebuild: ["true"], base: vol });
  cleanups.push(ex.cleanup);
  return { trees: { parent: t.parent, fix: t.fix!, neutral: t.neutral }, ex };
}

describe.skipIf(!on)("pf tree volumes in Docker", () => {
  test("ignored build state in the image's repo dir reaches every tree", async () => {
    const f = fixture(() => {});
    const entries = [{ index: 0, command: "test -f out/built.txt && test \"$(cat state.go)\" = fixed" }, { index: 1, command: "test -f out/built.txt" }];
    const r = await scoreEntries(entries, f.ex, { trees: f.trees, timeout_s: 30, exempt: false });
    expect(r.results.map((x) => x.outcome)).toEqual(["catch", "no_catch"]);
    expect(r.results[1]!.why).toBe("passed on parent run 1");
  }, 600_000);

  test("a tracked file that differs in the image's repo dir is set back to the tree commit", async () => {
    const f = fixture((base) => writeFileSync(join(base, "state.go"), "dirty\n"));
    const r = await scoreEntries([{ index: 0, command: "test \"$(cat state.go)\" = bug && test -f out/built.txt" }], f.ex, { trees: f.trees, timeout_s: 30, exempt: false });
    expect(r.results[0]!.why).toBe("passed on parent run 1");
  }, 600_000);

  test("an untracked file that isn't ignored stops the run", async () => {
    const f = fixture((base) => writeFileSync(join(base, "stray.txt"), "left over\n"));
    await expect(scoreEntries([{ index: 0, command: "true" }], f.ex, { trees: f.trees, timeout_s: 30, exempt: false })).rejects.toThrow(/E_PF_TREE_STATE.*stray\.txt/);
  }, 600_000);
});
