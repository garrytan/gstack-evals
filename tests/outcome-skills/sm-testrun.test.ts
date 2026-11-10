// Copyright (c) 2026 Garry Tan. MIT License.
// The state machines test run's container arguments (keyless) and, with GSTACK_EVALS_DOCKER=1, a hardened run that reads
// the image's own root-owned home, finds that home through its passwd entry and writes under HOME, while the privilege
// flags stay as they were; the stale report rule and the rebuild rule on a small built fixture; and the report directory a
// run creates before its test command, empty and owned by the run user.
import { describe, expect, test } from "bun:test";
import { buildFailed } from "../../lanes/outcome-skills/statemachines/score.ts";
import { copyVolume, parseRun, PY_IMAGE, runArgs, runTests } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { docker } from "../../lanes/real-outcome/task/docker.ts";

const on = process.env.GSTACK_EVALS_DOCKER === "1";
const pair = (a: string[], k: string, v: string) => a.some((x, i) => x === k && a[i + 1] === v);

describe("test run container arguments (keyless)", () => {
  const base = { image: "img", volume: "tree", repoDir: "/r", name: "n" };
  test("hardened keeps uid 10001, the read-only root, no network, no capabilities, no new privileges and the caps", () => {
    const a = runArgs({ ...base, mode: "hardened", home: { volume: "n-home", path: "/root" } });
    for (const [k, v] of [["--user", "10001:10001"], ["--network", "none"], ["--cap-drop", "ALL"], ["--security-opt", "no-new-privileges"], ["--tmpfs", "/tmp:rw,exec,size=4g"], ["--cpus", "4"], ["--memory", "12g"], ["--pids-limit", "8192"], ["-v", "tree:/r"], ["-w", "/r"]]) expect(pair(a, k!, v!)).toBe(true);
    expect(a).toContain("--read-only");
    expect(a.some((x) => /^--privileged|^--cap-add|^--network=|^host$/.test(x))).toBe(false);
  });
  test("hardened mounts the per-run home copy at the image's home, its passwd read-only, and points HOME at it", () => {
    const a = runArgs({ ...base, mode: "hardened", home: { volume: "n-home", path: "/root" } });
    expect(pair(a, "--mount", "type=volume,src=n-home,dst=/root,volume-subpath=home")).toBe(true);
    expect(pair(a, "--mount", "type=volume,src=n-home,dst=/etc/passwd,volume-subpath=passwd,readonly")).toBe(true);
    expect(pair(a, "-e", "HOME=/root")).toBe(true);
    expect(a).not.toContain("HOME=/tmp");
  });
  test("root mode is unchanged and gets no home copy", () => {
    const a = runArgs({ ...base, mode: "root" });
    expect(pair(a, "--user", "0:0")).toBe(true);
    expect(a.some((x) => x.startsWith("HOME=") || x.includes("volume-subpath"))).toBe(false);
    expect(a).not.toContain("--read-only");
  });
});

describe.skipIf(!on)("hardened home (docker)", () => {
  test("a hardened run reads the image's root-owned home, writes under HOME, and its home copy is removed after", () => {
    const vol = "sm-test-home-" + process.pid;
    docker(["volume", "create", vol]);
    try {
      const t = runTests({ image: PY_IMAGE, volume: vol, repoDir: "/w", mode: "hardened", label: "homeprobe", commands: { rebuild: [], test: ['[ "$(id -u)" = 10001 ] && ! touch /etc/sm-probe 2>/dev/null && ! sh -c "echo x >> /etc/passwd" 2>/dev/null && [ "$(python3 -c "import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)")" = "$HOME" ] && cat "$HOME/.profile" > /dev/null && mkdir -p "$HOME/.cache/t" && echo "t1 PASSED" > "$HOME/.cache/t/out.log"'], print: ['cat "$HOME/.cache/t/out.log"'] } });
      expect(t.exits).toEqual([0]);
      expect(t.log).toBe("t1 PASSED\n");
      const left = docker(["volume", "ls", "-q", "--filter", "name=sm-homeprobe-" + process.pid]).stdout.trim();
      expect(left).toBe("");
    } finally {
      docker(["volume", "rm", "-f", vol]);
    }
  }, 180_000);
});

describe.skipIf(!on)("stale reports and the rebuild rule (docker)", () => {
  const commands = { rebuild: ["sh build.sh"], test: ["mkdir -p out && sh bin/t > out/report.txt"], print: ["cat out/report.txt"] };
  const parse = (_s: string, log: string) => Object.fromEntries(log.trim().split(/\n/).filter(Boolean).map((l) => l.split(" ") as [string, string]));
  const BUILD = "mkdir -p bin && cp t.sh bin/t";
  function fixture(build: string): string {
    const vol = "sm-test-rule-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
    docker(["volume", "create", vol]);
    const src = 'set -e; cd /w; echo "$1" > build.sh; echo "echo t1 pass" > t.sh; mkdir -p out; echo "t1 pass" > out/report.txt; touch -d 2020-01-01 out/report.txt';
    const r = docker(["run", "--rm", "--network", "none", "-v", vol + ":/w", "--entrypoint", "sh", PY_IMAGE, "-c", src, "sh", build]);
    if (r.status !== 0) throw new Error("fixture: " + r.stderr);
    return vol;
  }
  test("a stale report with a failed rebuild parses nothing; a fresh run parses as before", () => {
    const stale = fixture("exit 1"), fresh = fixture(BUILD);
    try {
      const a = runTests({ image: PY_IMAGE, volume: stale, repoDir: "/w", mode: "root", label: "stale", commands: { ...commands, test: ["test -x bin/t"] } });
      expect(a.reports).toMatchObject({ refused: 1, fresh: 0 });
      expect(a.built_nothing).toBe("rebuild_failed");
      expect(parseRun(a, "", "stale", parse)).toEqual({});
      const b = runTests({ image: PY_IMAGE, volume: fresh, repoDir: "/w", mode: "root", label: "fresh", commands });
      expect(b.exits).toEqual([0, 0]);
      expect(b.built_nothing).toBeNull();
      expect(parseRun(b, "", "fresh", parse)).toEqual({ t1: "pass" });
    } finally {
      docker(["volume", "rm", "-f", stale, fresh]);
    }
  }, 180_000);
  test("where the rule applies, a change that breaks the rebuild of a unit built from source is a build failure", () => {
    const vol = fixture(BUILD + " && exit 2");
    try {
      const t = runTests({ image: PY_IMAGE, volume: vol, repoDir: "/w", mode: "root", label: "broke", commands, rule: "applies" });
      expect(t.exits).toEqual([2, 0]);
      expect(t.built_nothing).toBe("rebuild_failed");
      expect(buildFailed(t, 1, true, parseRun(t, "", "broke", parse))).toBe(true);
      const e = runTests({ image: PY_IMAGE, volume: vol, repoDir: "/w", mode: "root", label: "exempt", commands, rule: "exempt" });
      expect(buildFailed(e, 1, false, parseRun(e, "", "exempt", parse))).toBe(false);
    } finally {
      docker(["volume", "rm", "-f", vol]);
    }
  }, 180_000);
});

describe.skipIf(!on)("report directories the test command writes into (docker)", () => {
  function tree(src: string): { src: string; copy: string } {
    const id = process.pid + "-" + Math.random().toString(36).slice(2, 8);
    const vol = "sm-test-dirs-" + id, copy = "sm-test-dirs-copy-" + id;
    docker(["volume", "create", vol]);
    const r = docker(["run", "--rm", "--network", "none", "-v", vol + ":/w", "--entrypoint", "sh", PY_IMAGE, "-c", "set -e; cd /w; echo source > A.txt; " + src]);
    if (r.status !== 0) throw new Error("fixture: " + r.stderr);
    copyVolume(PY_IMAGE, vol, copy, "hardened");
    return { src: vol, copy };
  }
  const drop = (t: { src: string; copy: string }) => docker(["volume", "rm", "-f", t.src, t.copy]);
  test("a hardened run writes its report into a directory created at its start, empty and owned by uid 10001, and reads fresh", () => {
    const v = tree("true");
    try {
      const t = runTests({ image: PY_IMAGE, volume: v.copy, repoDir: "/w", mode: "hardened", label: "dirs-fresh", commands: { rebuild: ["true"], test: ['echo "SM_DIR_PROBE $(stat -c %u reports) $(ls -A reports | wc -l)"; echo "t1 pass" 2>&1 | tee reports/test-output.log'], print: ["cat reports/test-output.log"] } });
      expect(t.created_dirs).toEqual(["reports"]);
      expect(t.stderr).toContain("SM_DIR_PROBE 10001 0");
      expect(t.reports).toMatchObject({ fresh: 1 });
      expect(t.built_nothing).toBeNull();
      expect(t.log).toBe("t1 pass\n");
    } finally {
      drop(v);
    }
  }, 180_000);
  test("a hardened run that writes nothing still reads no_fresh_report", () => {
    const v = tree("true");
    try {
      const t = runTests({ image: PY_IMAGE, volume: v.copy, repoDir: "/w", mode: "hardened", label: "dirs-none", commands: { rebuild: [], test: ["true || tee reports/test-output.log"], print: ["cat reports/test-output.log"] } });
      expect(t.created_dirs).toEqual(["reports"]);
      expect(t.built_nothing).toBe("no_fresh_report");
    } finally {
      drop(v);
    }
  }, 180_000);
  test("a stale report from before the run start is not read, and its existing directory is not created", () => {
    const v = tree('mkdir reports; echo "t1 pass" > reports/test-output.log; touch -d 2020-01-01 reports/test-output.log');
    try {
      const t = runTests({ image: PY_IMAGE, volume: v.copy, repoDir: "/w", mode: "hardened", label: "dirs-stale", commands: { rebuild: [], test: ["true || tee reports/test-output.log"], print: ["cat reports/test-output.log"] } });
      expect(t.created_dirs).toEqual([]);
      expect(t.reports).toMatchObject({ fresh: 0 });
      expect(t.reports!.deleted + t.reports!.refused).toBe(1);
      expect(t.built_nothing).toBe("no_fresh_report");
      expect(t.log).not.toContain("t1 pass");
    } finally {
      drop(v);
    }
  }, 180_000);
});
