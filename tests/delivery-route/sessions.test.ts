// Copyright (c) 2026 Garry Tan. MIT License.
// The scripted sessions' captures (lanes/delivery-route/sessions.ts run --cut), checked by the same assertions a live run
// makes: what each arm's first request delivers, the gstack-shaped setup, the gstack file count, and the detector on real
// Claude Code output. The delivered sizes are the preregistration's section 4 numbers.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CASES, caseProblems, delivered, loadCaptured } from "../../lanes/delivery-route/sessions.ts";

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
