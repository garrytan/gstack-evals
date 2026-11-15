// Copyright (c) 2026 Garry Tan. MIT License.
// The backward-compatible hooks part B added to the state machines test container (testrun.ts RunExtra): without extra
// the arguments are unchanged; with the browser conditions they add the /dev/shm size, the wrapper mount and its env.
import { describe, expect, test } from "bun:test";
import { extraArgs, runArgs } from "../../lanes/outcome-skills/statemachines/testrun.ts";
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
