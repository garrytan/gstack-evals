// Copyright (c) 2026 Garry Tan. MIT License.
// The scripted sessions' captures (lanes/delivery-route/sessions.ts run --cut), checked by the same assertions a live run
// makes: what each arm's first request delivers, the gstack-shaped setup, the gstack file count, and the detector on real
// Claude Code output. The delivered sizes and the stand-in digests are the preregistration's section 4 numbers.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CASES, caseProblems, compareStandIns, delivered, filled, loadCaptured, setupOutputs } from "../../lanes/delivery-route/sessions.ts";
import { sha256 } from "../../lanes/delivery-route/pins.ts";

const FIX = join(import.meta.dir, "fixtures/sessions");
const cap = (name: string) => loadCaptured(join(FIX, name));

describe("scripted sessions", () => {
  for (const c of CASES) test(c.name + " holds every assertion", () => expect(caseProblems(c, cap(c.name))).toEqual([]));

  test("the delivered sizes are the preregistered ones", () => {
    const at = (name: string) => delivered(CASES.find((c) => c.name === name)!, cap(name));
    expect(at("described-skill")).toMatchObject({ where: "skill load", block_bytes: 280, before_steps: 77, after_steps: 0 });
    expect(Buffer.byteLength(at("described-skill")!.listing_entry!)).toBe(590);
    expect(at("gstack-setup")).toMatchObject({ where: "typed expansion", block_bytes: 9096, before_steps: 8893, after_steps: 0 });
    expect(Buffer.byteLength(at("gstack-setup")!.listing_entry!)).toBe(93);
    expect(at("command-stop")).toMatchObject({ where: "typed expansion", block_bytes: 203, before_steps: 0, after_steps: 0, listing_entry: null });
    expect(at("none-stop")).toBeNull();
    expect(at("described-stop")).toBeNull();
  });

  test("the assertions fail when an arm delivers the wrong thing", () => {
    const c = CASES.find((x) => x.name === "command-stop")!, k = cap("command-stop");
    expect(caseProblems({ ...c, arm: "none" }, k).some((p) => p.includes("the prompt is typed"))).toBe(true);
    expect(caseProblems(c, { ...k, gstack_files: 4 }).some((p) => p.includes("4 gstack files"))).toBe(true);
    const n = CASES.find((x) => x.name === "none-prove")!;
    expect(caseProblems({ ...n, expect: { followed: false } }, cap("none-prove"))).toEqual(["none-prove: detect followed is true, expected false"]);
  });
});

describe("the gstack-shaped stand-ins against real gstack 1.99.5.0", () => {
  const c = compareStandIns(cap("gstack-setup"), cap("gstack-real"));
  test("each script prints what real gstack prints, apart from the session id and start time", () => {
    expect(c.map((x) => [x.script, x.same_after_run_time_values])).toEqual([["gstack-skill-start", true], ["gstack-learnings-log", true], ["gstack-skill-end", true]]);
    expect(c[0]!.differences.map((d) => d.replace(/: [\w-]+$/, ""))).toEqual(["stand-in: SESSION_ID", "stand-in: TEL_START", "real: SESSION_ID", "real: TEL_START"]);
    expect([c[1]!.differences, c[2]!.differences]).toEqual([[], []]);
  });
  test("the digests are the preregistered ones", () => {
    expect(c.map((x) => [x.stand_in_sha256, x.real_sha256])).toEqual([
      ["69267a755ee42201940f30571f0eee252beed7ce3604bce038939cc2a2cd6d52", "798ccdd74b958f6aa951a194e3f4d955771bd34287cfadd4522ddbb5f4530afe"],
      ["cac1685585590361647e7a27b58a25a590f335bfcd0ab70fcdc0424e40c20843", "cac1685585590361647e7a27b58a25a590f335bfcd0ab70fcdc0424e40c20843"],
      ["3021d9f4962a6a6739a06083cf1e2d0912019790fb2d2c9b02a2e385e4cc209c", "3021d9f4962a6a6739a06083cf1e2d0912019790fb2d2c9b02a2e385e4cc209c"],
    ]);
    expect(setupOutputs(cap("gstack-real")).map((o) => sha256(filled(o)))[0]).toBe("2db80721c6fa97fbdd6e5124f4f40b3db1302705ef86f6e110f3cd9d78a04238");
  });
  test("the comparison fails when a stand-in prints something real gstack does not", () => {
    const k = cap("gstack-setup");
    expect(compareStandIns({ ...k, sdk: k.sdk.replace("ROUTING_DECLINED: true", "ROUTING_DECLINED: false") }, cap("gstack-real"))[0]!.same_after_run_time_values).toBe(false);
  });
});
