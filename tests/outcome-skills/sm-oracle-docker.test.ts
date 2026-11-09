// Copyright (c) 2026 Garry Tan. MIT License.
// Docker tests for the state machines oracle (GSTACK_EVALS_DOCKER=1): the parser sandbox fails closed on network, the
// 15-minute rule stops a slow run (a test-only limit), and the keep rule keeps a stable unit and drops a flaky one.
import { describe, expect, test } from "bun:test";
import { judge } from "../../lanes/outcome-skills/statemachines/oracle.ts";
import { PY_IMAGE, runParser, runTests } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { docker } from "../../lanes/real-outcome/task/docker.ts";

const on = process.env.GSTACK_EVALS_DOCKER === "1";

describe("oracle keep rule (keyless)", () => {
  const P = "PASSED", F = "FAILED";
  test("keeps a stable unit: fail-to-pass fails on every base run and passes on every fixed run", () => {
    const base: Record<string, string>[] = [{ a: F, s: P, x: P }, { a: F, s: P, x: F }, { s: P, x: P }];
    const fixed = [{ a: P, s: P, x: P }, { a: P, s: P, x: P }, { a: P, s: P, x: P }];
    expect(judge(["a"], base, fixed)).toMatchObject({ kept: true, stable: ["s"] });
  });
  test("drops a flaky unit, one with no stable test, and one with a run that did not parse", () => {
    expect(judge(["a"], [{ a: F, s: P }, { a: P, s: P }, { a: F, s: P }], [{ a: P, s: P }, { a: P, s: P }, { a: P, s: P }])).toMatchObject({ kept: false, failing: ["a"] });
    expect(judge(["a"], [{ a: F }, { a: F }, { a: F }], [{ a: P }, { a: P }, { a: "SKIPPED" }])).toMatchObject({ kept: false });
    expect(judge(["a"], [{ a: F, s: F }, { a: F, s: P }, { a: F, s: P }], [{ a: P, s: P }, { a: P, s: P }, { a: P, s: P }])).toMatchObject({ kept: false, reason: "no stable test" });
    expect(judge(["a"], [null, { a: F }, { a: F }], [{ a: P }, { a: P }, { a: P }])).toMatchObject({ kept: false });
  });
});

describe.skipIf(!on)("oracle in Docker", () => {
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
