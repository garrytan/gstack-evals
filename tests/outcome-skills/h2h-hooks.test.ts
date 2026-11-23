// Copyright (c) 2026 Garry Tan. MIT License.
// The backward-compatible hooks part B added to the state machines test container (testrun.ts RunExtra): without extra
// the arguments are unchanged; with the browser conditions they add the /dev/shm size, the wrapper mount and its env. The
// scorer's known-id cache is kept per extra, and a run with no extra reads oracle-ids.json as before.
import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as oracle from "../../lanes/outcome-skills/statemachines/oracle.ts";
import { knownIds } from "../../lanes/outcome-skills/statemachines/score.ts";
import { extraArgs, runArgs, type RunExtra } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { addUnitFile, type SmUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { BROWSER } from "../../lanes/outcome-skills/h2h/types.ts";
import { browserExtra } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";

describe("state machines run hooks", () => {
  const o = { image: "img", volume: "vol", repoDir: "/testbed", mode: "hardened" as const, name: "n" };
  test("no extra leaves the arguments as they were", () => {
    expect(extraArgs()).toEqual([]);
    const a = runArgs(o);
    expect(a).not.toContain("--shm-size");
    expect(a.slice(-4)).toEqual(["--entrypoint", "bash", "img", "-s"]);
    expect(runArgs({ ...o, extra: undefined })).toEqual(a);
  });
  test("the browser conditions", () => {
    const a = runArgs({ ...o, extra: browserExtra() });
    const at = a.indexOf("--entrypoint");
    expect(a.slice(at - 1 - 2 * Object.keys(BROWSER.env).length - 4, at)).toContain("--shm-size");
    expect(a[a.indexOf("--shm-size") + 1]).toBe("2g");
    expect(a.find((x) => x.startsWith("type=bind,"))).toMatch(new RegExp(",dst=" + BROWSER.wrapper_container_path + ",readonly$"));
    expect(a).toContain("CHROME_BIN=" + BROWSER.env.CHROME_BIN);
    expect(a.indexOf("--shm-size")).toBeLessThan(at);
    expect(a).toContain("--cap-drop");
  });
});

/** knownIds over invented unit dirs, with the oracle's runs faked: a run with extra finds the browser test too. Each
 *  fake run is logged as its tree, plus its extra's shm size. */
describe("knownIds per run extra", () => {
  const ids = (x: { dir: string; u: SmUnit }, extra?: RunExtra) => [...knownIds(x.dir, x.u, "vol", "root", undefined, extra)].sort();
  const BROWSER_IDS = ["ui::opens", "unit::adds"];
  function rig(cached?: string[]) {
    const runs: string[] = [];
    const spy = spyOn(oracle, "oneRun").mockImplementation((...a) => {
      const [tree, extra] = [a[4], a[9]];
      runs.push(tree + (extra ? "+" + extra.shmSize : ""));
      const parsed: Record<string, string> = extra ? { "unit::adds": "pass", "ui::opens": "pass" } : { "unit::adds": "pass" };
      return { run: { tree, n: 0, wall_ms: 0, exit: 0, parsed_sha256: null, stopped: false, exits: [] }, parsed, log: "" };
    });
    const dir = mkdtempSync(join(tmpdir(), "h2h-known-ids-"));
    const u = { id: "fixture", image: { runtime_id: "img" }, files: {} } as unknown as SmUnit;
    if (cached) addUnitFile(dir, u, "oracle-ids.json", JSON.stringify([...cached].sort()) + "\n");
    return { unit: { dir, u }, runs, done: () => (spy.mockRestore(), rmSync(dir, { recursive: true, force: true })) };
  }

  test("ids cached with no extra are not reused for a run with extra, and a no-extra run still reads oracle-ids.json as before", () => {
    const { unit, runs, done } = rig(["old::kept"]);
    try {
      expect(ids(unit)).toEqual(["old::kept"]);
      expect(runs).toEqual([]);
      expect(ids(unit, browserExtra())).toEqual(BROWSER_IDS);
      expect(runs).toEqual(["base+2g", "fixed+2g"]);
      expect(readFileSync(join(unit.dir, "oracle-ids.json"), "utf8")).toBe('["old::kept"]\n');
      expect(ids(unit)).toEqual(["old::kept"]);
    } finally {
      done();
    }
  });

  test("ids cached with extra are not reused for a run with no extra", () => {
    const { unit, runs, done } = rig();
    try {
      expect(ids(unit, browserExtra())).toEqual(BROWSER_IDS);
      expect(ids(unit)).toEqual(["unit::adds"]);
      expect(runs).toEqual(["base+2g", "fixed+2g", "base", "fixed"]);
      expect(Object.keys(unit.u.files).sort()).toEqual([expect.stringMatching(/^oracle-ids\.[0-9a-f]{64}\.json$/), "oracle-ids.json"]);
      expect(readFileSync(join(unit.dir, "oracle-ids.json"), "utf8")).toBe('["unit::adds"]\n');
    } finally {
      done();
    }
  });

  test("the same extra reuses its own cache, in any key order, and another extra gets its own", () => {
    const { unit, runs, done } = rig();
    try {
      expect(ids(unit, browserExtra())).toEqual(BROWSER_IDS);
      const { env, mounts, shmSize } = browserExtra();
      expect(ids(unit, { env, shmSize, mounts })).toEqual(BROWSER_IDS);
      expect(runs).toEqual(["base+2g", "fixed+2g"]);
      expect(ids(unit, { ...browserExtra(), shmSize: "1g" })).toEqual(BROWSER_IDS);
      expect(runs).toEqual(["base+2g", "fixed+2g", "base+1g", "fixed+1g"]);
    } finally {
      done();
    }
  });
});
