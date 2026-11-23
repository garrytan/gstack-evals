// Copyright (c) 2026 Garry Tan. MIT License.
// Docker tests for the state machines oracle (GSTACK_EVALS_DOCKER=1): the parser sandbox fails closed on network, the
// 15-minute rule stops a slow run (a test-only limit), and the keep rule keeps a stable unit and drops a flaky one.
import { describe, expect, test } from "bun:test";
import type { Draw } from "../../lanes/outcome-skills/statemachines/draw.ts";
import { goAmbiguous, goDefsIn, goTestDefs } from "../../lanes/outcome-skills/statemachines/goids.ts";
import { cargoTargets, judge, oracleWalk, rebuildFlag, runStop, staleBinaryGuard, targetReading } from "../../lanes/outcome-skills/statemachines/oracle.ts";
import { oracleF2p, type OracleRun, type SmUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { PY_IMAGE, runParser, runTests } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { docker } from "../../lanes/real-outcome/task/docker.ts";

const on = process.env.GSTACK_EVALS_DOCKER === "1";

describe("oracle keep rule (keyless)", () => {
  const P = "pass", F = "fail";
  test("keeps a stable unit: fail-to-pass fails on every base run and passes on every fixed run", () => {
    const base: Record<string, string>[] = [{ a: F, s: P, x: P }, { a: F, s: P, x: F }, { s: P, x: P }];
    const fixed = [{ a: P, s: P, x: P }, { a: P, s: P, x: P }, { a: P, s: P, x: P }];
    expect(judge(["a"], base, fixed)).toMatchObject({ kept: true, stable: ["s"], f2p: ["a"], removed: [] });
  });
  test("drops from fail-to-pass a dataset id that passes on base and keeps the unit on its real failing id", () => {
    const base = [{ a: F, n: P, s: P }, { a: F, n: P, s: P }, { a: F, n: P, s: P }];
    const fixed = [{ a: P, n: P, s: P }, { a: P, n: P, s: P }, { a: P, n: P, s: P }];
    expect(judge(["a", "n"], base, fixed)).toMatchObject({ kept: true, f2p: ["a"], removed: ["n"], stable: ["n", "s"], reason: "kept" });
  });
  test("drops a unit whose every dataset fail-to-pass id passes on base, with its own reason", () => {
    const base = [{ n: P, m: P, s: P }, { n: P, m: P, s: P }, { n: P, m: P, s: P }];
    expect(judge(["n", "m"], base, base)).toMatchObject({ kept: false, f2p: [], removed: ["n", "m"], failing: [], reason: "no fail-to-pass test" });
  });
  test("an id that passes on some base runs is flaky on base: it leaves the set, not unstable", () => {
    expect(judge(["a"], [{ a: F, s: P }, { a: P, s: P }, { a: F, s: P }], [{ a: P, s: P }, { a: P, s: P }, { a: P, s: P }])).toMatchObject({ kept: false, failing: [], removed: [], flaky: ["a"], reason: "no fail-to-pass test" });
  });
  test("flaky ids on base are counted beside the ids that pass on every base run, and the unit stays", () => {
    const fixed = [0, 1, 2].map(() => ({ a: P, n: P, f: P, g: P, s: P }));
    const base = [{ a: F, n: P, f: P, g: F, s: P }, { a: F, n: P, f: F, g: F, s: P }, { a: F, n: P, f: P, g: P, s: P }];
    expect(judge(["a", "n", "f", "g"], base, fixed)).toMatchObject({ kept: true, f2p: ["a"], removed: ["n"], flaky: ["f", "g"], failing: [], reason: "kept" });
  });
  test("a flaky id that also fails a fixed run is flaky, not a reason for instability", () => {
    const base = [{ a: F, f: P, s: P }, { a: F, f: F, s: P }, { a: F, f: F, s: P }];
    const fixed = [{ a: P, f: P, s: P }, { a: P, f: F, s: P }, { a: P, f: P, s: P }];
    expect(judge(["a", "f"], base, fixed)).toMatchObject({ kept: true, f2p: ["a"], flaky: ["f"], failing: [], reason: "kept" });
  });
  test("the oracle's corrected set is the one place consumers read fail-to-pass from", () => {
    const u = { id: "x", tests: { f2p: ["a", "n"], p2p: ["s"] }, oracle: { f2p: ["a"] } } as unknown as SmUnit;
    expect(oracleF2p(u)).toEqual(["a"]);
    expect(() => oracleF2p({ ...u, oracle: { stable: [] } } as unknown as SmUnit)).toThrow(/^E_SM_UNIT/);
  });
  test("counts only the dataset's own pass word as a pass", () => {
    expect(judge(["a"], [{ a: F, s: P }, { a: F, s: P }, { a: F, s: P }], [{ a: "PASSED", s: P }, { a: "PASSED", s: P }, { a: "PASSED", s: P }])).toMatchObject({ kept: false, failing: ["a"] });
    expect(judge(["a"], [{ a: F, s: "ok" }, { a: F, s: "ok" }, { a: F, s: "ok" }], [{ a: P, s: "ok" }, { a: P, s: "ok" }, { a: P, s: "ok" }])).toMatchObject({ kept: false, reason: "no stable test" });
  });
  test("drops a flaky unit, one with no stable test, and one with a run that did not parse", () => {
    expect(judge(["a"], [{ a: F, s: P }, { a: F, s: P }, { a: F, s: P }], [{ a: P, s: P }, { a: F, s: P }, { a: P, s: P }])).toMatchObject({ kept: false, failing: ["a"] });
    expect(judge(["a"], [{ a: F }, { a: F }, { a: F }], [{ a: P }, { a: P }, { a: "skip" }])).toMatchObject({ kept: false });
    expect(judge(["a"], [{ a: F, s: F }, { a: F, s: P }, { a: F, s: P }], [{ a: P, s: P }, { a: P, s: P }, { a: P, s: P }])).toMatchObject({ kept: false, reason: "no stable test" });
    expect(judge(["a"], [null, { a: F }, { a: F }], [{ a: P }, { a: P }, { a: P }])).toMatchObject({ kept: false });
  });
});

describe("infra errors in the oracle (keyless)", () => {
  const run = (o: Partial<OracleRun>): OracleRun => ({ tree: "base", n: 1, wall_ms: 10, exit: 0, parsed_sha256: null, stopped: false, ...o });
  test("a run that could not make its mark dir ends the unit as E_SM_INFRA_GAP, a run past the limit as E_SM_SLOW_TEST, any other run goes on", () => {
    expect(runStop(run({ tree: "fixed", n: 2, exit: 97, infra: "no_mark_dir" }), 900_000)).toEqual({ code: "E_SM_INFRA_GAP", detail: "fixed run 2 could not make its mark dir (no_mark_dir): an infra error, neither kept nor dropped" });
    expect(runStop(run({ stopped: true, wall_ms: 900_001 }), 900_000)).toEqual({ code: "E_SM_SLOW_TEST", detail: "base run 1 passed 900000 ms (wall 900001 ms)" });
    expect(runStop(run({ built_nothing: "no_fresh_report", infra: null }), 900_000)).toBeNull();
  });
  const d: Draw = { schema: "sm-draw.v1", draw_seed: 1, admission: [], state: ["a", "b", "c"], other: [], repo: { a: "ra", b: "rb", c: "rc" } };
  test("an infra unit is neither kept nor dropped: it has its own count per language and takes no slot", async () => {
    const v: Record<string, { verdict: string; lang: string; reason?: string }> = { a: { verdict: "E_SM_INFRA_GAP", lang: "rust" }, b: { verdict: "kept", lang: "go" }, c: { verdict: "E_SM_ORACLE_UNSTABLE", lang: "go", reason: "no stable test" } };
    const w = await oracleWalk(d, async (id) => v[id]!);
    expect(w.infra).toEqual({ rust: 1 });
    expect(w.drops).toEqual({ "E_SM_ORACLE_UNSTABLE: no stable test": 1 });
    expect(w.fill.state).toEqual(["b"]);
    expect(w.fill.infra).toEqual(["a"]);
  });
  test("a pass with an infra unit is not the final fill, and once a rerun settles it the fill is final", async () => {
    const first = await oracleWalk(d, async (id) => ({ verdict: id === "a" ? "E_SM_INFRA_GAP" : "kept", lang: "rust" }));
    expect(first.final).toBe(false);
    expect(first.fill.state).toEqual(["b", "c"]);
    const rerun = await oracleWalk(d, async () => ({ verdict: "kept", lang: "rust" }));
    expect(rerun).toMatchObject({ final: true, infra: {}, drops: {} });
    expect(rerun.fill.state).toEqual(["a", "b", "c"]);
  });
});

describe("ambiguous Go test ids (B3, keyless)", () => {
  const P = "pass", F = "fail";
  // Cut down from caddyserver__caddy-7567 and github__gh-aw-26074 at their base commits: grep lines from their *_test.go files.
  const caddy = [
    "./caddytest/integration/caddyfile_adapt_test.go:func TestCaddyfileAdaptToJSON(t *testing.T) {",
    "./modules/caddyhttp/headers/headers_test.go:func TestHandler(t *testing.T) {",
    "./modules/caddyhttp/map/map_test.go:func TestHandler(t *testing.T) {",
  ].join("\n");
  const ghaw = [
    "./pkg/cli/update_actions_test.go:func TestExtractBaseRepo(t *testing.T) {",
    "./pkg/gitutil/gitutil_test.go:func TestExtractBaseRepo(t *testing.T) {",
    "./pkg/workflow/action_resolver_test.go:func TestExtractBaseRepo(t *testing.T) {",
    "./pkg/workflow/action_cache_test.go:func TestActionCacheDeduplication(t *testing.T) {",
  ].join("\n");
  const added = ["a/new_test.go", "b/new_test.go", "c/lib.go"].map((f) => "diff --git a/" + f + " b/" + f + "\n--- /dev/null\n+++ b/" + f + "\n@@ -0,0 +1,2 @@\n+package x\n+func TestNew(t *testing.T) {}\n").join("");
  test("each top-level test func maps to the package dirs that define it; the go tool's skipped dirs, methods and non-test files don't count; a base patch's new funcs do", () => {
    const skipped = ["./vendor/x/a_test.go", "./modules/testdata/b_test.go", "./_old/c_test.go", "./.cache/d_test.go"].map((p) => p + ":func TestCaddyfileAdaptToJSON(t *testing.T) {");
    const defs = goTestDefs([caddy, ...skipped, "./x/s_test.go:func (s *Suite) TestMethod(t *testing.T) {", "./root_test.go:func TestRoot(t *testing.T) {"].join("\n"), [added]);
    expect(defs.get("TestHandler")).toEqual(new Set(["modules/caddyhttp/headers", "modules/caddyhttp/map"]));
    expect(defs.get("TestCaddyfileAdaptToJSON")).toEqual(new Set(["caddytest/integration"]));
    expect(defs.has("TestMethod")).toBe(false);
    expect(defs.get("TestRoot")).toEqual(new Set(["."]));
    expect(defs.get("TestNew")).toEqual(new Set(["a", "b"]));
  });
  test("on a bare-id row an id defined in two packages leaves both sets, one defined in one package stays, and a subtest counts as its top-level test", () => {
    const drop = goAmbiguous(goTestDefs(caddy, []));
    const f2p = ["TestCaddyfileAdaptToJSON", "TestCaddyfileAdaptToJSON/tls_automation_policies_11.caddyfiletest"];
    const rec = (x: string) => ({ [f2p[0]!]: x, [f2p[1]!]: x, TestHandler: P, "TestHandler/sets_a_header": P, TestOther: P });
    const base = [0, 1, 2].map(() => rec(F)), fixed = [0, 1, 2].map(() => rec(P));
    expect(judge([...f2p, "TestHandler/sets_a_header"], base, fixed, drop)).toMatchObject({ kept: true, code: "kept", f2p, stable: ["TestOther"], ambiguous: { f2p: ["TestHandler/sets_a_header"], stable: ["TestHandler", "TestHandler/sets_a_header"] } });
    expect(judge([...f2p, "TestHandler/sets_a_header"], base, fixed)).toMatchObject({ kept: true, stable: ["TestHandler", "TestHandler/sets_a_header", "TestOther"], ambiguous: { f2p: [], stable: [] } });
  });
  test("a package-qualified id is never touched, even where its name is defined in two packages", () => {
    const drop = goAmbiguous(goTestDefs(caddy, []));
    const q = ["github.com/caddyserver/caddy/v2/modules/caddyhttp/headers/TestHandler", "github.com/caddyserver/caddy/v2/modules/caddyhttp/map/TestHandler/maps_a_value"];
    expect(q.map(drop)).toEqual([false, false]);
    expect(drop("TestHandler")).toBe(true);
    const base = [0, 1, 2].map(() => ({ [q[0]!]: P, [q[1]!]: P, f: F })), fixed = [0, 1, 2].map(() => ({ [q[0]!]: P, [q[1]!]: P, f: P }));
    expect(judge(["f"], base, fixed, drop)).toMatchObject({ kept: true, stable: [...q].sort(), ambiguous: { f2p: [], stable: [] } });
  });
  test("a unit whose only fail-to-pass id is ambiguous drops with its own code; one with another fail-to-pass id keeps on that one", () => {
    const drop = goAmbiguous(goTestDefs(ghaw, []));
    const base = [0, 1, 2].map(() => ({ TestExtractBaseRepo: P, TestActionCacheDeduplication: F, TestStable: P }));
    const fixed = [0, 1, 2].map(() => ({ TestExtractBaseRepo: P, TestActionCacheDeduplication: P, TestStable: P }));
    const only = judge(["TestExtractBaseRepo"], base, fixed, drop);
    expect(only).toMatchObject({ kept: false, code: "E_SM_AMBIGUOUS_TEST", f2p: [], ambiguous: { f2p: ["TestExtractBaseRepo"], stable: ["TestExtractBaseRepo"] } });
    expect(only.reason).toBe("every fail-to-pass id is a bare Go test name defined in more than one package");
    expect(judge(["TestExtractBaseRepo"], base, fixed)).toMatchObject({ kept: false, code: "E_SM_ORACLE_UNSTABLE", reason: "no fail-to-pass test" });
    expect(judge(["TestExtractBaseRepo", "TestActionCacheDeduplication"], base, fixed, drop)).toMatchObject({ kept: true, code: "kept", f2p: ["TestActionCacheDeduplication"], stable: ["TestStable"], ambiguous: { f2p: ["TestExtractBaseRepo"] } });
  });
});

describe.skipIf(!on)("oracle in Docker", () => {
  test("the Go test func scan reads the tree's *_test.go files; a scan that runs and fails drops as E_SM_TEST_SCAN, one that never finishes is an infra error", () => {
    const vol = "sm-test-godefs-" + process.pid, nogrep = "sm-test-nogrep:" + process.pid;
    docker(["volume", "create", vol]);
    try {
      const files = "mkdir -p /w/a /w/b /w/vendor/v && printf 'package a\\nfunc TestDup(t *testing.T) {}\\nfunc TestOne(t *testing.T) {}\\n' > /w/a/x_test.go && printf 'package b\\nfunc TestDup(t *testing.T) {}\\n' > /w/b/y_test.go && printf 'package v\\nfunc TestOne(t *testing.T) {}\\n' > /w/vendor/v/z_test.go";
      expect(docker(["run", "--rm", "--network", "none", "-v", vol + ":/w", "--entrypoint", "sh", PY_IMAGE, "-c", files]).status).toBe(0);
      const defs = goDefsIn({ kind: "docker", image: PY_IMAGE, volume: vol, repoDir: "/w", name: "sm-test-godefs-" + process.pid }, []);
      expect(defs.get("TestDup")).toEqual(new Set(["a", "b"]));
      expect(defs.get("TestOne")).toEqual(new Set(["a"]));
      expect(docker(["build", "-q", "-t", nogrep, "-"], { input: "FROM " + PY_IMAGE + "\nRUN rm -f /usr/bin/grep /bin/grep\n" }).status).toBe(0);
      expect(() => goDefsIn({ kind: "docker", image: nogrep, volume: vol, repoDir: "/w", name: "sm-test-godefs-nogrep-" + process.pid }, [])).toThrow(/^E_SM_TEST_SCAN .*grep exit 127/);
      expect(() => goDefsIn({ kind: "docker", image: PY_IMAGE, volume: vol, repoDir: "/w", name: "sm-test-godefs-slow-" + process.pid, timeoutMs: 1 }, [])).toThrow(/^E_SM_INFRA_GAP /);
    } finally {
      docker(["volume", "rm", "-f", vol]);
      docker(["rmi", "-f", nogrep]);
    }
  }, 120_000);
  test("the parser sandbox runs a parser and fails closed when one reaches for the network", () => {
    expect(runParser("def parser(log: str) -> dict[str, str]:\n    return {l.split()[0]: l.split()[1] for l in log.splitlines() if l}\n", "t1 PASSED\nt2 FAILED\n", "ok")).toEqual({ t1: "PASSED", t2: "FAILED" });
    const net = "def parser(log: str) -> dict[str, str]:\n    import urllib.request\n    urllib.request.urlopen('http://1.1.1.1', timeout=3)\n    return {}\n";
    expect(() => runParser(net, "", "net")).toThrow(/^E_SM_PARSER /);
    expect(() => runParser("def parser(log):\n    return 3\n", "", "nodict")).toThrow(/^E_SM_PARSER /);
  }, 120_000);
  test("a run past the limit is stopped, and the print commands' output is the parser's log", () => {
    const vol = "sm-test-vol-" + process.pid;
    docker(["volume", "create", vol]);
    try {
      const ok = runTests({ image: PY_IMAGE, volume: vol, repoDir: "/w", mode: "root", label: "ok", commands: { rebuild: ["echo build"], test: ["cd /w && echo 't1 PASSED' > out.log"], print: ["cat /w/out.log"] } });
      expect(ok).toMatchObject({ stopped: false, log: "t1 PASSED\n" });
      const slow = runTests({ image: PY_IMAGE, volume: vol, repoDir: "/w", mode: "hardened", label: "slow", limitMs: 3000, commands: { rebuild: [], test: ["sleep 30"], print: [] } });
      expect(slow.stopped).toBe(true);
    } finally {
      docker(["volume", "rm", "-f", vol]);
    }
  }, 120_000);
});

describe("rebuild rule flag and the stale binary guard (keyless)", () => {
  const P = "pass", F = "fail";
  const fx = (n: number, exits: number[], fresh: number | null = 1): OracleRun => ({ tree: "fixed", n, wall_ms: 1, exit: 0, parsed_sha256: null, stopped: false, exits, stale_fresh: fresh });
  test("the rule applies when the rebuild exits 0 on every fixed run, and each fixed run's rebuild exits are recorded", () => {
    expect(rebuildFlag([fx(1, [0, 1]), fx(2, [0, 0]), fx(3, [0, 1])], 1)).toEqual({ applies: true, fixed_rebuild_exits: [[0], [0], [0]] });
  });
  test("a unit whose rebuild fails on any fixed run, or leaves no rebuild exit, is exempt", () => {
    expect(rebuildFlag([fx(1, [0, 0]), fx(2, [1, 0]), fx(3, [0, 0])], 1)).toEqual({ applies: false, fixed_rebuild_exits: [[0], [1], [0]] });
    expect(rebuildFlag([fx(1, [])], 1).applies).toBe(false);
  });
  test("an exempt unit passes the guard when its fixed runs pass the fail-to-pass set while the rebuild fails and wrote fresh reports", () => {
    const fixed = [1, 2, 3].map((n) => ({ run: fx(n, [1, 0]), parsed: { a: P, s: P } }));
    expect(staleBinaryGuard(fixed, [{ a: F, s: P }, { a: F, s: P }, { a: F, s: P }], ["a"], 1)).toBeNull();
  });
  test("an exempt unit fails the guard when a fixed run with a failed rebuild wrote no fresh test output", () => {
    const fixed = [{ run: fx(1, [1, 0], 0), parsed: { a: P } }, { run: fx(2, [1, 0], null), parsed: { a: P } }];
    expect(staleBinaryGuard(fixed.slice(0, 1), [{ a: F }], ["a"], 1)).toMatch(/^stale binary guard/);
    expect(staleBinaryGuard(fixed.slice(1), [{ a: F }], ["a"], 1)).toMatch(/^stale binary guard/);
  });
  test("an exempt unit fails the guard when a fail-to-pass id passes on a base run or fails on a fixed run whose rebuild failed", () => {
    const ok = { run: fx(1, [1, 0]), parsed: { a: P } };
    expect(staleBinaryGuard([ok], [{ a: P }], ["a"], 1)).toMatch(/^stale binary guard/);
    expect(staleBinaryGuard([{ run: fx(1, [1, 0]), parsed: { a: F } }], [{ a: F }], ["a"], 1)).toMatch(/^stale binary guard/);
  });
});

describe("cargo target reading (keyless)", () => {
  const lib = "     Running unittests src/lib.rs (target/debug/deps/zorp-0a1b2c3d4e5f6789)";
  const wib = "     Running tests/wibble.rs (target/debug/deps/wibble-1111222233334444)";
  const doc = "   Doc-tests zorp";
  const stop = "error: test failed, to rerun pass `-p zorp --lib`";
  const log = (...lines: string[]) => ["   Compiling zorp v0.1.0 (/testbed/zorp)", "     Running `rustc --crate-name build_script_build`", ...lines.flatMap((l) => [l, "", "running 1 test", "test tests::t ... ok"])].join("\n");
  test("reads Running and Doc-tests lines, with target hashes and colours left out", () => {
    expect(cargoTargets(log(lib, "\x1b[1m\x1b[32m     Running\x1b[0m tests/wibble.rs (target/debug/deps/wibble-ffffeeeeddddcccc)", doc))).toEqual({ targets: ["Doc-tests zorp", "Running tests/wibble.rs (target/debug/deps/wibble-*)", "Running unittests src/lib.rs (target/debug/deps/zorp-*)"], stop: false });
    expect(cargoTargets(log(lib) + "\n" + stop).stop).toBe(true);
  });
  test("reads cargo's verbose test binary lines, never its rustc, rustdoc or build script lines", () => {
    const v = [
      "     Running `/rt/bin/rustc --crate-name zorp --edition=2021 zorp/src/lib.rs --test`",
      "     Running `/testbed/target/debug/build/zorp-0123456789abcdef/build-script-build`",
      "     Running `/testbed/target/debug/deps/zorp-0a1b2c3d4e5f6789`",
      "     Running `CARGO=/rt/bin/cargo CARGO_PKG_NAME=wibble /testbed/target/debug/deps/wibble-1111222233334444 --nocapture`",
      "     Running `rustdoc --edition=2021 --crate-type lib --test zorp/src/lib.rs`",
      "   Doc-tests zorp",
    ].join("\n");
    expect(cargoTargets(v).targets).toEqual(["Doc-tests zorp", "Running /testbed/target/debug/deps/wibble-*", "Running /testbed/target/debug/deps/zorp-*"]);
  });
  test("cargo stopped early when a target the fixed runs reached appears in no base run", () => {
    const base = [0, 1, 2].map(() => log(lib) + "\n" + stop), fixed = [0, 1, 2].map(() => log(lib, wib, doc));
    expect(targetReading(base, fixed)).toEqual({ base: base.map(() => ["Running unittests src/lib.rs (target/debug/deps/zorp-*)"]), fixed: fixed.map(() => ["Doc-tests zorp", "Running tests/wibble.rs (target/debug/deps/wibble-*)", "Running unittests src/lib.rs (target/debug/deps/zorp-*)"]), not_on_base: ["Doc-tests zorp", "Running tests/wibble.rs (target/debug/deps/wibble-*)"], fail_fast_stop: true, cargo_stopped_early: true });
  });
  test("a target reached on one base run counts as reached; the same targets everywhere is no early stop", () => {
    const fixed = [log(lib, doc)];
    expect(targetReading([log(lib) + "\n" + stop, log(lib, doc)], fixed)).toMatchObject({ not_on_base: [], fail_fast_stop: true, cargo_stopped_early: false });
    expect(targetReading([log(lib, doc)], fixed)).toMatchObject({ not_on_base: [], fail_fast_stop: false, cargo_stopped_early: false });
    expect(targetReading(["no cargo here"], ["nor here"])).toEqual({ base: [[]], fixed: [[]], not_on_base: [], fail_fast_stop: false, cargo_stopped_early: false });
  });
});
