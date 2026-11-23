// Copyright (c) 2026 Garry Tan. MIT License.
// Decision-routing D7 (lanes/decision-routing/host/history.ts and history.sh): the history strip every session image
// runs at build, against a real git repository shaped like a SWE-rebench /testbed (tags, a branch, ORIG_HEAD,
// FETCH_HEAD, notes and a stash past the base, and the upstream fix with its hidden test); the host's object-level check
// on parts (a) to (d); the Dockerfile step tasks.ts adds; and the host gate against a stub docker.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HISTORY_SH, PARTS, STRIP_FILE, STRIP_STEP, addHistoryStrip, main, parseResult } from "../../lanes/decision-routing/host/history.ts";
import { pristineImage } from "../../lanes/decision-routing/labels/container.ts";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

const HIDDEN = "test_hidden_feature_works";
const HIDDEN_PATH = "tests/test_hidden_feature.py";

function sh(cwd: string, cmd: string) {
  const r = spawnSync("sh", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(cmd + ": " + r.stderr);
  return r.stdout.trim();
}

/** A /testbed under a fake root: base commit, then the upstream fix with its hidden test, reachable from every kind of ref. */
function fixture() {
  const root = temp("dr-history-root-");
  const repo = join(root, "testbed");
  mkdirSync(join(repo, "tests"), { recursive: true });
  mkdirSync(join(root, "tmp"));
  sh(repo, "git init -q && git config user.email t@example.com && git config user.name t && git config commit.gpgsign false");
  writeFileSync(join(repo, "tests", "test_old.py"), "def test_old_case():\n    pass\n");
  writeFileSync(join(repo, "lib.py"), "X = 1\n");
  sh(repo, "git add -A && git commit -q -m base && git tag v1");
  const base = sh(repo, "git rev-parse HEAD");
  writeFileSync(join(repo, "lib.py"), "X = 2\n");
  writeFileSync(join(repo, HIDDEN_PATH), "def " + HIDDEN + "():\n    pass\n");
  sh(repo, "git add -A && git commit -q -m fix && git tag v2 && git branch later && git notes add -m note HEAD");
  const fix = sh(repo, "git rev-parse HEAD");
  sh(repo, "git checkout -q --detach " + base);
  writeFileSync(join(repo, "lib.py"), "X = 3\n");
  sh(repo, "git stash -q");
  writeFileSync(join(repo, ".git", "ORIG_HEAD"), fix + "\n");
  writeFileSync(join(repo, ".git", "FETCH_HEAD"), fix + "\t\tbranch 'main' of https://example.com/repo\n");
  const work = temp("dr-history-work-");
  const markers = join(work, "markers");
  writeFileSync(markers, HIDDEN + "\n" + HIDDEN_PATH + "\n");
  const env = { ...process.env, DR_REPO: repo, DR_ROOT: root, DR_WORK: join(work, "scratch") };
  const run = (...args: string[]) => spawnSync("sh", [HISTORY_SH, ...args], { env, encoding: "utf8" });
  return { root, repo, base, fix, markers, run };
}

describe("history.sh against a SWE-rebench-shaped /testbed", () => {
  test("check fails (a), (b) and (d) on the image as shipped, and names no marker on stdout", () => {
    const f = fixture();
    writeFileSync(join(f.root, "tmp", "upstream.patch"), "+def " + HIDDEN + "():\n");
    const r = f.run("check", f.markers);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(HIDDEN);
    const row = parseResult("t", r.stdout);
    expect(row.failed).toEqual(["a", "b", "d"]);
    expect(Number(row.counts.a_tags)).toBe(1);
    expect(Number(row.counts.a_bad)).toBeGreaterThanOrEqual(4);
    expect(row.counts.pseudo_bad).toBe("2");
    expect(Number(row.counts.b_later)).toBeGreaterThanOrEqual(3);
    expect(row.counts.later_with_markers).toBe("2");
    expect(row.counts.d_outside).toBe("1");
    expect(r.stderr).toContain(join(f.root, "tmp", "upstream.patch"));
  });

  test("strip keeps the base, its history, its ancestor tags and the worktree, and leaves nothing past the base", () => {
    const f = fixture();
    const before = sh(f.repo, "git log --format=%H");
    const r = f.run("strip");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dr-history: base " + f.base.slice(0, 12));
    expect(sh(f.repo, "git rev-parse HEAD")).toBe(f.base);
    expect(sh(f.repo, "git log --format=%H")).toBe(before);
    expect(sh(f.repo, "git tag -l")).toBe("v1");
    expect(sh(f.repo, "git for-each-ref --format='%(refname)'")).toBe("refs/tags/v1");
    expect(sh(f.repo, "git status --porcelain")).toBe("");
    expect(existsSync(join(f.repo, ".git", "ORIG_HEAD")) || existsSync(join(f.repo, ".git", "FETCH_HEAD"))).toBe(false);
    expect(spawnSync("git", ["cat-file", "-e", f.fix + "^{commit}"], { cwd: f.repo }).status).not.toBe(0);
    const row = parseResult("t", f.run("check", f.markers).stdout);
    expect(row).toMatchObject({ pass: true, failed: [] });
    expect(row.counts).toMatchObject({ a_bad: "0", pseudo: "0", b_later: "0", later_with_markers: "0", d_outside: "0", d_untracked: "0" });
  });

  test("check fails (d) on a marker in an untracked file of /testbed after the strip", () => {
    const f = fixture();
    expect(f.run("strip").status).toBe(0);
    writeFileSync(join(f.repo, "leftover.diff"), HIDDEN_PATH + "\n");
    const row = parseResult("t", f.run("check", f.markers).stdout);
    expect(row.failed).toEqual(["d"]);
    expect(row.counts).toMatchObject({ d_outside: "0", d_untracked: "1" });
  });

  test("check reads base content from the base commit's tree: a staged hidden test, a staged-then-deleted one and a modified tracked file all fail (d)", () => {
    const staged = fixture();
    expect(staged.run("strip").status).toBe(0);
    writeFileSync(join(staged.repo, HIDDEN_PATH), "def " + HIDDEN + "():\n    pass\n");
    sh(staged.repo, "git add " + HIDDEN_PATH);
    const a = parseResult("t", staged.run("check", staged.markers).stdout);
    expect(a.failed).toEqual(["d"]);
    expect(a.counts).toMatchObject({ d_outside: "0", d_untracked: "0", d_worktree: "1" });

    const gone = fixture();
    expect(gone.run("strip").status).toBe(0);
    writeFileSync(join(gone.repo, HIDDEN_PATH), "def " + HIDDEN + "():\n    pass\n");
    sh(gone.repo, "git add " + HIDDEN_PATH + " && rm " + HIDDEN_PATH);
    const b = parseResult("t", gone.run("check", gone.markers).stdout);
    expect(b.failed).toEqual(["d"]);
    expect(b.counts).toMatchObject({ d_worktree: "0", d_objects: "1", d_gitmeta: "1" });

    const edited = fixture();
    expect(edited.run("strip").status).toBe(0);
    writeFileSync(join(edited.repo, "tests", "test_old.py"), "def test_old_case():\n    pass\n\n\ndef " + HIDDEN + "():\n    pass\n");
    const c = parseResult("t", edited.run("check", edited.markers).stdout);
    expect(c.failed).toEqual(["d"]);
    expect(c.counts).toMatchObject({ d_worktree: "1" });
  });

  test("a marker the base commit itself holds is base content, not a leak", () => {
    const f = fixture();
    expect(f.run("strip").status).toBe(0);
    const base = parseResult("t", f.run("check", f.markers).stdout);
    expect(base.pass).toBe(true);
    sh(f.repo, "git checkout -q -b scratch && printf '%s\\n' '# mentions " + HIDDEN + "' > notes.txt && git add notes.txt && git commit -q -m notes && git tag -d v1 >/dev/null && git checkout -q --detach HEAD && git branch -D -q scratch");
    expect(f.run("strip").status).toBe(0);
    const row = parseResult("t", f.run("check", f.markers).stdout);
    expect(row).toMatchObject({ pass: true, failed: [] });
    expect(row.counts).toMatchObject({ d_worktree: "0", d_objects: "0", d_gitmeta: "0" });
  });

  test("strip trims each submodule store to the commit the base tree pins and deletes a store the base pins nothing for; check fails a store past its pin (c)", () => {
    const src = temp("dr-history-sub-");
    sh(src, "git init -q -b main && git config user.email t@example.com && git config user.name t && git config commit.gpgsign false && echo a > data.txt && git add -A && git commit -q -m s1");
    const s1 = sh(src, "git rev-parse HEAD");
    sh(src, "echo b > data.txt && git commit -q -am s2 && git branch -q extra");
    const s2 = sh(src, "git rev-parse HEAD");
    const root = temp("dr-history-root-");
    const repo = join(root, "testbed");
    mkdirSync(repo);
    sh(repo, "git init -q && git config user.email t@example.com && git config user.name t && git config commit.gpgsign false && echo x > lib.py && git -c protocol.file.allow=always submodule add -q " + src + " data/sub && git -C data/sub checkout -q --detach " + s1 + " && git add -A && git commit -q -m base");
    sh(repo, "git clone -q --bare " + src + " .git/modules/stray");
    const work = temp("dr-history-work-");
    const markers = join(work, "markers");
    writeFileSync(markers, HIDDEN + "\n");
    const env = { ...process.env, DR_REPO: repo, DR_ROOT: root, DR_WORK: join(work, "scratch") };
    const run = (...args: string[]) => spawnSync("sh", [HISTORY_SH, ...args], { env, encoding: "utf8" });
    const before = parseResult("t", run("check", markers).stdout);
    expect(before.failed).toEqual(["c"]);
    expect(before.counts).toMatchObject({ c_modstore: "2", modstores: "2" });
    expect(run("strip").status).toBe(0);
    const store = join(repo, ".git", "modules", "data", "sub");
    expect(sh(join(repo, "data", "sub"), "git rev-parse HEAD")).toBe(s1);
    expect(spawnSync("git", ["--git-dir=" + store, "cat-file", "-e", s2 + "^{commit}"]).status).not.toBe(0);
    expect(existsSync(join(repo, ".git", "modules", "stray"))).toBe(false);
    expect(sh(repo, "git status --porcelain")).toBe("");
    const after = parseResult("t", run("check", markers).stdout);
    expect(after).toMatchObject({ pass: true, failed: [] });
    expect(after.counts).toMatchObject({ c_modstore: "0", modstores: "1", c_gitlinks: "1" });
  });

  test("a marker in a file another project's package installed (listed in a dist-info RECORD under site-packages) is counted apart; one no RECORD lists fails (d)", () => {
    const f = fixture();
    expect(f.run("strip").status).toBe(0);
    const sp = join(f.root, "opt", "env", "lib", "python3.12", "site-packages");
    mkdirSync(join(sp, "otherpkg", "tests"), { recursive: true });
    mkdirSync(join(sp, "otherpkg-1.0.dist-info"));
    writeFileSync(join(sp, "otherpkg", "tests", "test_other.py"), "def " + HIDDEN + "():\n    pass\n");
    writeFileSync(join(sp, "otherpkg-1.0.dist-info", "RECORD"), "otherpkg/__init__.py,,\notherpkg/tests/test_other.py,sha256=x,30\notherpkg-1.0.dist-info/RECORD,,\n");
    const a = f.run("check", f.markers);
    const ra = parseResult("t", a.stdout);
    expect(ra).toMatchObject({ pass: true, failed: [] });
    expect(ra.counts).toMatchObject({ d_outside: "0", d_thirdparty: "1" });
    expect(a.stderr).toContain("third-party: " + join(sp, "otherpkg", "tests", "test_other.py"));
    writeFileSync(join(sp, "otherpkg", "tests", "conftest.py"), "# " + HIDDEN + "\n");
    const rb = parseResult("t", f.run("check", f.markers).stdout);
    expect(rb.failed).toEqual(["d"]);
    expect(rb.counts).toMatchObject({ d_outside: "1", d_thirdparty: "1" });
  });

  test("a RECORD does not clear a file under a top-level name the repository itself holds at its base (d)", () => {
    const f = fixture();
    expect(f.run("strip").status).toBe(0);
    const sp = join(f.root, "opt", "env", "lib", "python3.12", "site-packages");
    mkdirSync(join(sp, "lib-2.0.dist-info"), { recursive: true });
    writeFileSync(join(sp, "lib.py"), "def " + HIDDEN + "():\n    pass\n");
    writeFileSync(join(sp, "lib-2.0.dist-info", "RECORD"), "lib.py,sha256=x,30\nlib-2.0.dist-info/RECORD,,\n");
    const r = parseResult("t", f.run("check", f.markers).stdout);
    expect(r.failed).toEqual(["d"]);
    expect(r.counts).toMatchObject({ d_outside: "1", d_thirdparty: "0" });
  });

  test("strip fails the build when another object store of the same repository still holds the fix", () => {
    const f = fixture();
    sh(f.root, "git clone -q --mirror " + f.repo + " " + join(f.root, "opt", "mirror.git"));
    const r = f.run("strip");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^DR_HISTORY_LEAK: /);
    expect(r.stderr).toMatch(/stores_this_repo=1 stores_later=[1-9]/);
    const row = parseResult("t", f.run("check", f.markers).stdout);
    expect(row.failed).toEqual(["c"]);
  });

  test("strip fails the build on an alternates file", () => {
    const f = fixture();
    writeFileSync(join(f.repo, ".git", "objects", "info", "alternates"), join(f.root, "elsewhere", "objects") + "\n");
    const r = f.run("strip");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("c_alt=1");
  });
});

describe("the strip step tasks.ts adds to every environment/Dockerfile", () => {
  test("appends one COPY and RUN after the task's own steps, keeps the FROM line, and refuses a second strip", () => {
    const task = temp("dr-history-task-");
    mkdirSync(join(task, "environment"));
    const image = "swerebench/sweb.eval.x86_64.demo@sha256:" + "a".repeat(64);
    writeFileSync(join(task, "environment", "Dockerfile"), "FROM " + image + "\n\nRUN mkdir -p /logs\n");
    addHistoryStrip(task);
    const text = readFileSync(join(task, "environment", "Dockerfile"), "utf8");
    expect(text).toBe("FROM " + image + "\n\nRUN mkdir -p /logs\n\n" + STRIP_STEP + "\n");
    expect(text).toContain("COPY " + STRIP_FILE + " /tmp/" + STRIP_FILE + "\nRUN sh /tmp/" + STRIP_FILE + " strip && rm -f /tmp/" + STRIP_FILE);
    expect(pristineImage(task)).toBe(image);
    expect(readFileSync(join(task, "environment", STRIP_FILE), "utf8")).toBe(readFileSync(HISTORY_SH, "utf8"));
    expect(() => addHistoryStrip(task)).toThrow(/already carries the D7 strip/);
  });
});

describe("decision-routing history (the host gate) against a stub docker", () => {
  const ZERO = Object.fromEntries(Object.values(PARTS).flat().map((k) => [k, "0"]));
  const line = (o: Record<string, string> = {}) => "RESULT markers=1 " + Object.entries({ ...ZERO, ...o }).map(([k, v]) => k + "=" + v).join(" ") + "\n";

  function tasks(ids: string[], strip = true) {
    const dir = temp("dr-history-tasks-");
    const pristine = temp("dr-history-pristine-");
    for (const id of ids) {
      mkdirSync(join(dir, id, "environment"), { recursive: true });
      mkdirSync(join(dir, id, "tests"));
      writeFileSync(join(dir, id, "environment", "Dockerfile"), "FROM img/" + id + "@sha256:" + "b".repeat(64) + "\n");
      if (strip) addHistoryStrip(join(dir, id));
      writeFileSync(join(dir, id, "tests", "test.patch"), "diff --git a/" + HIDDEN_PATH + " b/" + HIDDEN_PATH + "\nnew file mode 100644\n--- /dev/null\n+++ b/" + HIDDEN_PATH + "\n+def " + HIDDEN + "():\n+    pass\n");
      writeFileSync(join(pristine, id + ".json"), JSON.stringify({ files: ["lib.py"], testNames: [] }));
    }
    return { dir, pristine };
  }

  function stub(results: Record<string, string>) {
    const calls: string[][] = [];
    const seen: { markers: string; mode: number }[] = [];
    return {
      calls,
      seen,
      run: async (args: string[]) => {
        calls.push(args);
        if (args[0] !== "run") return { code: 0, stdout: "sha256:x\n", stderr: "" };
        const mount = args[args.indexOf("-v") + 1]!.split(":")[0]!;
        seen.push({ markers: readFileSync(join(mount, "markers"), "utf8"), mode: statSync(join(mount, "markers")).mode & 0o777 });
        const tag = args[args.indexOf("sh") + 3]!;
        return { code: 0, stdout: results[tag] ?? line(), stderr: "" };
      },
    };
  }

  test("builds each session image, checks it with no network and the markers mounted read-only, then removes it", async () => {
    const t = tasks(["demo__one-1"]);
    const docker = stub({});
    const work = join(temp("dr-history-gate-"), "work");
    expect(await main(["--tasks-dir", t.dir, "--tasks", "demo__one-1", "--pristine-dir", t.pristine, "--work", work], docker)).toBe(0);
    expect(docker.calls.map((c) => c[0])).toEqual(["build", "run", "rmi"]);
    expect(docker.calls[0]).toEqual(["build", "-q", "-t", "dr-history/demo--one-1", join(t.dir, "demo__one-1", "environment")]);
    expect(docker.calls[1]).toEqual(["run", "--rm", "--network", "none", "--entrypoint", "sh", "-v", join(work, "demo__one-1") + ":/dr-history:ro", "dr-history/demo--one-1", "/dr-history/history.sh", "check", "/dr-history/markers"]);
    expect(docker.seen).toEqual([{ markers: HIDDEN + "\n" + HIDDEN_PATH + "\n", mode: 0o600 }]);
    expect(statSync(work).mode & 0o777).toBe(0o700);
  });

  test("fails a task on any part, or on a Dockerfile with no strip, with DR_HISTORY_LEAK and exit 1", async () => {
    const t = tasks(["demo__ok-1", "demo__leak-2"]);
    const bare = tasks(["demo__bare-3"], false);
    const docker = stub({ "dr-history/demo--leak-2": line({ b_later: "4", d_outside: "1" }) });
    const logs: string[] = [];
    const errs: string[] = [];
    const [log, err] = [console.log, console.error];
    console.log = (m: string) => logs.push(m);
    console.error = (m: string) => errs.push(m);
    try {
      const work = join(temp("dr-history-gate-"), "work");
      expect(await main(["--tasks-dir", t.dir, "--tasks", "demo__ok-1,demo__leak-2", "--pristine-dir", t.pristine, "--work", work], docker)).toBe(1);
      expect(await main(["--tasks-dir", bare.dir, "--tasks", "demo__bare-3", "--pristine-dir", bare.pristine, "--work", work], docker)).toBe(1);
    } finally {
      console.log = log;
      console.error = err;
    }
    expect(logs.filter((l) => l.startsWith("HISTORY ")).map((l) => l.split(" ").slice(0, 4).join(" "))).toEqual(["HISTORY demo__ok-1 PASS markers=1", "HISTORY demo__leak-2 FAIL b,d", "HISTORY demo__bare-3 FAIL environment/Dockerfile"]);
    expect(errs[0]).toMatch(/^DR_HISTORY_LEAK: 1 of 2 task images .*: demo__leak-2$/);
    expect(errs[1]).toMatch(/^DR_HISTORY_LEAK: 1 of 1 .*: demo__bare-3$/);
    expect(docker.calls.filter((c) => c[0] === "build")).toHaveLength(2);
    expect(logs.join("\n")).not.toContain(HIDDEN);
  });

  test("a RESULT line missing a part's count fails that part", () => {
    expect(parseResult("t", "RESULT a_bad=0 pseudo_bad=0 grafts=0 b_later=0 c_alt=0 c_modstore=0 c_worktrees=0 stores_later=0 d_outside=0\n").failed).toEqual(["d"]);
    expect(parseResult("t", "nothing\n")).toMatchObject({ pass: false, error: "no RESULT line" });
  });
});
