// Copyright (c) 2026 Garry Tan. MIT License.
// hm fit, keyless: a fake docker and a stand-in gstack tree drive d1-checks' per-task routine both ways.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseResult, fit, fitClass, fitTasks, workerScript, type FitRow } from "../../lanes/harness-mechanics/fit.ts";
import { bundleLists, sha256, taskSetup, unscreenedText } from "../../lanes/harness-mechanics/pins.ts";
import { pool } from "../../lanes/harness-mechanics/screen.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "hm-fit-test-"));
const lists = bundleLists(), p = pool();
const tasks = [...lists.scored.slice(0, 3).map((task) => ({ task, split: "scored" as const })), ...lists.calibration.slice(0, 2).map((task) => ({ task, split: "calibration" as const }))];
const saved = { HM_DOCKER: process.env.HM_DOCKER, ARMS: process.env.ARMS, HM_SCREENED: process.env.HM_SCREENED, HM_SCREENED_SHA256: process.env.HM_SCREENED_SHA256 };
afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });

// A stand-in gstack tree (the loop and selectLanes import d1Rig reads), empty arm tars and a docker whose exec answers by
// script: per container, mode-<n> is "base" (tests FAIL and FAIL at base) or "broad" (TOO_BROAD, lint and typecheck
// ENV); anything else reads FAIL that passes at base. nopull-<digest> refuses a pull and nobuild-<tag> fails a build.
function rig(dir: string) {
  const g = join(dir, "gstack"), arms = join(dir, "arms"), f = join(dir, "docker");
  mkdirSync(join(g, "verify"), { recursive: true }); mkdirSync(join(g, "lib")); mkdirSync(arms);
  writeFileSync(join(g, "verify/SKILL.md"), "## 2. Loop\n\n```bash\nC=gstack-checks; \"$C\" run\n```\n");
  writeFileSync(join(g, "lib/checks.ts"), "import { selectLanes } from './lanes';\n");
  for (const t of ["prose", "none"]) writeFileSync(join(arms, t + ".tar"), "");
  writeFileSync(f, ["#!/usr/bin/env bash", 'echo "$*" >> ' + dir + "/calls", 's="${@: -1}"', 'n=${6#hm-fit-}; n=${n%-prose}; mode=$(cat ' + dir + '/mode-$n 2>/dev/null)',
    'case "$1" in',
    '  pull) for a in "$@"; do [ -e "' + dir + '/nopull-${a##*@sha256:}" ] && { echo "manifest unknown" >&2; exit 1; }; done; exit 0;;',
    '  build) [ -e ' + dir + '/nobuild-$4 ] && { echo "build broke" >&2; exit 1; }; exit 0;;',
    "  exec) ;;", "  *) exit 0;;", "esac",
    'case "$s" in',
    '  *"rev-parse origin/main HEAD"*) echo abc; echo abc;;',
    '  *"command -v pytest"*) case "$mode" in conda) echo /opt/conda/envs/testbed/bin/pytest;; nopy) echo /usr/bin/pytest;; *) echo ' + taskSetup().envDirs[0] + "/pytest;; esac;;",
    '  *HM_CANDIDATE*) echo "HM_CANDIDATE pkg/a.py 900"; if [ "$mode" = broad ]; then echo "HM_CANDIDATE pkg/b.py 400"; else echo "HM_CANDIDATE pkg/b.py 12"; fi;;',
    '  *HM_TEST*) echo "HM_TEST tests/test_b.py"; echo "HM_TEST tests/test_c.py";;',
    "  *'\"$C\" run'*) if [ \"$mode\" = broad ]; then echo 'CHECK lint ENV (ruff missing)'; echo 'CHECK typecheck ENV (mypy missing)'; echo 'CHECK tests TOO_BROAD (900 test files)'; else echo 'CHECK lint PASS'; echo 'CHECK tests FAIL (exit 1)'; fi;;",
    '  *"git checkout -q --"*) if [ "$mode" = base ]; then echo "FAILED tests/test_b.py::t"; echo "==== 2 failed, 73 passed in 1.00s ===="; exit 1; fi; echo "==== 75 passed in 1.00s ===="; exit 0;;',
    "esac"].join("\n") + "\n");
  chmodSync(f, 0o755);
  process.env.HM_DOCKER = f;
  process.env.ARMS = arms;
  return g;
}

describe("hm fit", () => {
  test("rows both ways: a FAIL confirmed at base, one that passes at base, TOO_BROAD with lint and typecheck ENV, a refused pull and a failed build", () => {
    const dir = tmp(), out = join(dir, "out"), g = rig(dir);
    writeFileSync(join(dir, "mode-1"), "base"); writeFileSync(join(dir, "mode-3"), "broad");
    writeFileSync(join(dir, "nopull-" + p.get(tasks[3]!.task)!.image_digest.slice(7)), ""); writeFileSync(join(dir, "nobuild-hm-fit-5"), "");
    const rows = fit(out, tasks, g);
    expect(rows.map((r) => [r.task, r.repo, r.split])).toEqual(tasks.map((t) => [t.task, p.get(t.task)!.repo, t.split]));
    expect(rows[0]).toMatchObject({ tests_selection: { first: 900, picked: 12, file: "pkg/b.py" }, edited: "pkg/b.py", checks: [{ name: "lint", verdict: "PASS" }, { name: "tests", verdict: "FAIL" }], base_fail: { result: "fail", failed: 2, errors: 0, summary: "==== 2 failed, 73 passed in 1.00s ====" } });
    expect(rows[1]!.base_fail).toEqual({ result: "pass" });
    expect(rows[2]).toMatchObject({ tests_selection: "too_broad", edited: "pkg/a.py", checks: [{ name: "lint", verdict: "ENV" }, { name: "typecheck", verdict: "ENV" }, { name: "tests", verdict: "TOO_BROAD" }] });
    expect(rows[2]!.base_fail).toBeUndefined();
    expect(rows[3]!.error).toMatch(/pull failed: manifest unknown/);
    expect(rows[4]!.error).toMatch(/docker build hm-fit-5 failed: build broke/);
    const calls = readFileSync(join(dir, "calls"), "utf8");
    expect(calls).toContain("run -d --name hm-fit-1-prose --network none");
    expect(calls).toContain("git checkout -q -- 'pkg/b.py' && " + taskSetup().envDirs[0] + "/pytest -q --color=no -p no:cacheprovider 'tests/test_b.py' 'tests/test_c.py'");
    expect(calls).toContain("echo '# hm d1 probe edit' >> 'pkg/a.py'");
    for (const n of [1, 2, 3]) expect(calls).toContain("rm -f hm-fit-" + n + "-prose\n");
    for (const n of [1, 2, 3]) expect(calls).toContain("rmi -f hm-fit-" + n + "\n");
    const md = readFileSync(join(out, "fit.md"), "utf8");
    expect(md).toContain("| scored | 3 | 1 | 1 | 1 | 2 | 1 | 0 |");
    expect(md).toContain("| calibration | 2 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(md).toContain("| S2 | 1 | 0 | 0 | 0 | 1 | 1 | 0 |");
    expect(md).toContain("| no class | 2 | 0 | 0 | 0 | 0 | 0 | 2 |");
  });
  test("D2: a pytest under either testbed env is the task env's; one outside both stops the row", () => {
    const dir = tmp(), out = join(dir, "out"), g = rig(dir);
    writeFileSync(join(dir, "mode-1"), "conda"); writeFileSync(join(dir, "mode-2"), "nopy");
    const rows = fit(out, tasks.slice(0, 2), g);
    expect(rows[0]!.error).toBeUndefined();
    expect(rows[0]!.checks?.length).toBeGreaterThan(0);
    expect(rows[1]!.error).toBe("pytest /usr/bin/pytest, not under " + taskSetup().envDirs.join(" or "));
  });
  test("HM_FIT_TAG names the images and containers, so parallel workers don't collide", () => {
    const dir = tmp(), out = join(dir, "out"), g = rig(dir);
    process.env.HM_FIT_TAG = "hm-fit-w2";
    try { fit(out, tasks.slice(0, 1), g); } finally { delete process.env.HM_FIT_TAG; }
    expect(readFileSync(join(dir, "calls"), "utf8")).toContain("run -d --name hm-fit-w2-1-prose --network none");
  });
  test("the VM worker re-runs itself under the docker group when it has no Docker access, and records a task that left no row", () => {
    const dir = tmp(), bin = join(dir, "bin"), root = join(dir, "root"), script = join(dir, "worker.sh");
    mkdirSync(bin); mkdirSync(join(root, "gstack-evals"), { recursive: true }); mkdirSync(join(root, "lists"));
    writeFileSync(join(root, "lists/sha256"), "x"); writeFileSync(script, workerScript());
    const stub = (name: string, body: string) => { writeFileSync(join(bin, name), "#!/usr/bin/env bash\n" + body + "\n"); chmodSync(join(bin, name), 0o755); };
    const run = () => Bun.spawnSync(["bash", script, "3"], { env: { PATH: bin + ":/usr/bin:/bin", HOME: dir, HM_FIT_ROOT: root }, stdout: "pipe", stderr: "pipe" });
    stub("docker", "exit 1"); stub("sg", 'echo "$*" > ' + join(dir, "sg"));
    writeFileSync(join(root, "queue.txt"), "a__b-1\n");
    expect(run().exitCode).toBe(0);
    expect(readFileSync(join(dir, "sg"), "utf8")).toBe("docker -c HM_FIT_SG=1 bash '" + script + "' 3\n");
    expect(readFileSync(join(root, "queue.txt"), "utf8")).toBe("a__b-1\n");
    stub("docker", "exit 0");
    stub("bun", 'o=$4; mkdir -p "$o"; [ "$6" = a__b-1 ] && echo "{\\"task\\":\\"$6\\"}" > "$o/fit.jsonl"; exit 0');
    writeFileSync(join(root, "queue.txt"), "a__b-1\nc__d-2\n");
    expect(run().exitCode).toBe(0);
    expect(readFileSync(join(root, "out/a__b-1/fit.jsonl"), "utf8")).toBe('{"task":"a__b-1"}\n');
    expect(readFileSync(join(root, "norow.txt"), "utf8")).toBe("c__d-2\n");
    expect(readFileSync(join(root, "queue.txt"), "utf8")).toBe("");
  });
  test("fit classes: GEVA-504's seven, both ways", () => {
    const row = (x: Partial<FitRow>): FitRow => ({ task: "a__b-1", split: "calibration", repo: "a/b", ...x });
    const ck = (...v: string[]) => v.map((s) => ({ name: s.split(" ")[0]!, verdict: s.split(" ")[1]! }));
    expect(fitClass(row({ checks: ck("lint ENV", "tests PASS") }))).toBe("S1");
    expect(fitClass(row({ checks: ck("tests FAIL"), base_fail: { result: "fail", failed: 1, errors: 0, summary: "" } }))).toBe("S2");
    expect(fitClass(row({ checks: ck("tests FAIL"), base_fail: { result: "pass" } }))).toBe("S3");
    expect(fitClass(row({ checks: ck("tests FAIL"), base_fail: { result: "timeout" } }))).toBeNull();
    expect(fitClass(row({ checks: ck("lint PASS", "tests ENV") }))).toBe("S4");
    expect(fitClass(row({ checks: ck("typecheck FAIL", "tests TIMEOUT") }))).toBe("S4");
    expect(fitClass(row({ checks: ck("lint ENV", "typecheck ENV", "tests TOO_BROAD") }))).toBe("S5");
    expect(fitClass(row({ checks: ck("tests UNMAPPED") }))).toBe("S5");
    expect(fitClass(row({ error: "no tracked module that a test_<name>.py names" }))).toBe("U1");
    expect(fitClass(row({ error: "pytest missing, not under /opt/conda/envs/testbed/bin" }))).toBe("U2");
    expect(fitClass(row({ error: "a__b-1: pull failed: manifest unknown" }))).toBeNull();
    expect(fitClass(row({}))).toBeNull();
  });
  test("a rerun resumes from fit.jsonl: done rows call no docker, a missing row runs alone", () => {
    const dir = tmp(), out = join(dir, "out"), g = rig(dir);
    const rows = fit(out, tasks, g), md = readFileSync(join(out, "fit.md"), "utf8"), calls = readFileSync(join(dir, "calls"), "utf8");
    expect(fit(out, tasks, g)).toEqual(rows);
    expect(readFileSync(join(dir, "calls"), "utf8")).toBe(calls);
    expect(readFileSync(join(out, "fit.md"), "utf8")).toBe(md);
    const f = join(out, "fit.jsonl"), kept = readFileSync(f, "utf8").split("\n").filter(Boolean);
    writeFileSync(f, kept.slice(0, 4).join("\n") + "\n");
    writeFileSync(join(dir, "calls"), "");
    expect(fit(out, tasks, g)).toEqual(rows);
    expect(readFileSync(join(dir, "calls"), "utf8")).not.toContain("hm-fit-1");
    expect(readFileSync(join(dir, "calls"), "utf8")).toContain("build -q -t hm-fit-5");
  });
  test("pytest at base reads pass, fail with its failed and error counts (errors alone fail too), or timeout", () => {
    expect(baseResult(0, "x\n==== 75 passed in 1.00s ====")).toEqual({ result: "pass" });
    expect(baseResult(1, "x\n== 3 failed, 1 error in 2s ==")).toEqual({ result: "fail", failed: 3, errors: 1, summary: "== 3 failed, 1 error in 2s ==" });
    expect(baseResult(2, "x\n==== 73 warnings, 75 errors in 0.81s ====")).toEqual({ result: "fail", failed: 0, errors: 75, summary: "==== 73 warnings, 75 errors in 0.81s ====" });
    expect(baseResult(null, "")).toEqual({ result: "timeout" });
  });
  test("the task list is the screened lists, scored then calibration; --only keeps one task and refuses one outside them", () => {
    const dir = tmp(), f = join(dir, "screened.txt"), text = unscreenedText(lists);
    writeFileSync(f, text);
    process.env.HM_SCREENED = f; process.env.HM_SCREENED_SHA256 = sha256(text);
    expect(fitTasks().map((t) => t.task)).toEqual([...lists.scored, ...lists.calibration]);
    expect(fitTasks(lists.calibration[0])).toEqual([{ task: lists.calibration[0]!, split: "calibration" }]);
    expect(() => fitTasks("nobody__nothing-1")).toThrow(/^E_USAGE/);
  });
});
