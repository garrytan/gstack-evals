import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mddFor } from "../../lanes/day-one/analysis.ts";
import { main } from "../../lanes/day-one/cli.ts";
import * as F from "../../lanes/day-one/frozen.ts";
import { ALL_IN_USD, ITEMS, ledgerCapUsd, projectionUsd } from "../../lanes/day-one/ledger.ts";
import { UNIT_ID } from "../../lanes/day-one/units.ts";

const prereg = readFileSync(join(import.meta.dir, "../..", F.PREREG), "utf8");
const TEXTS = { COMMON_ASK: F.COMMON_ASK, REVIEW_ASK: F.REVIEW_ASK, DAY_ONE_PASS: F.DAY_ONE_PASS, AUTOPLAN_LINE: F.AUTOPLAN_LINE, OWNER_NOTICE: F.OWNER_NOTICE, PLATFORM: F.PLATFORM, BUILD_PROMPT: F.BUILD_PROMPT, CHECK_HEADER: F.CHECK_HEADER, CHECK_FOOTER: F.CHECK_FOOTER, OWNER_HEAD: F.OWNER_HEAD, OWNER_RULES: F.OWNER_RULES, OWNER_CLOSING: F.OWNER_CLOSING };

describe("the day-one prereg holds the frozen values", () => {
  test("every frozen text appears byte for byte, with the prompts digest", () => {
    expect(Object.entries(TEXTS).filter(([, v]) => !prereg.includes(v)).map(([k]) => k)).toEqual([]);
    expect(prereg).toContain(F.PROMPTS_SHA256);
  });
  test("each arm's first message is built from the frozen texts", () => {
    expect(F.armPrompt("n")).toBe(F.COMMON_ASK + "\n\n" + F.OWNER_NOTICE);
    expect(F.armPrompt("d")).toBe(F.REVIEW_ASK + "\n\n" + F.DAY_ONE_PASS + "\n\n" + F.OWNER_NOTICE);
    expect(F.armPrompt("a")).toBe(F.AUTOPLAN_LINE + "\n\n" + F.REVIEW_ASK + "\n\n" + F.OWNER_NOTICE);
  });
  test("the unit sets: random labels, no label in two splits, every digest in the prereg", () => {
    const all = Object.values(F.UNIT_SETS).flatMap((s) => [...s.labels]);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((l) => UNIT_ID.test(l))).toBe(true);
    expect([F.UNIT_SETS.set.labels.length, F.UNIT_SETS.spares.labels.length, F.UNIT_SETS.practice.labels.length, F.UNIT_SETS.cat1.labels.length]).toEqual([15, 3, 3, 2]);
    for (const s of Object.values(F.UNIT_SETS)) expect(prereg).toContain(s.digest);
  });
  test("A's gstack pin is in the prereg; the strengthened arms wait for theirs", () => {
    expect(F.GSTACK_PINS.a).toEqual({ repo: "garrytan/gstack", sha: "5b4fa9ea335e3ba743a36e3269da95980b77b32d", version: "1.99.5.0" });
    expect(prereg).toContain(F.GSTACK_PINS.a.sha!);
    expect(F.GSTACK_PINS["s-full"].sha).toBeNull();
    expect(prereg).toContain(F.BROWSER_IMAGE.split("@")[1]!);
  });
  test("the caps total the all-in stop and day1-plans' ledger cap carries the voice", () => {
    expect(ITEMS.reduce((a, i) => a + i.capUsd, 0)).toBe(ALL_IN_USD);
    expect(projectionUsd()).toBe(3708);
    expect(ledgerCapUsd("day1-plans")).toBe(1060);
    for (const i of ITEMS) expect(prereg).toContain("| " + i.item + " |");
  });
  test("the MDD is 0.18 at 15 briefs and 0.20 at 12", () => {
    expect(mddFor(15)).toBe(0.18);
    expect(mddFor(12)).toBe(0.2);
  });
});

describe("gstack-evals day-one", () => {
  test("--help lists every subcommand", async () => {
    const out: string[] = [];
    expect(await main(["--help"], { out: (t) => out.push(t), err: () => {} })).toBe(0);
    for (const c of ["units", "stage", "judge", "gold", "read", "dryrun", "fixtures", "voice-check"]) expect(out.join("\n")).toContain("day-one " + c);
  });
  test("a unit outside every frozen split is refused before anything runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "day-one-units-"));
    const err: string[] = [];
    try {
      expect(await main(["units", "--units-dir", dir, "--units", "aaaaaa"], { out: () => {}, err: (t) => err.push(t) })).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(err.join("\n")).toContain("not in a frozen split: aaaaaa");
  });
});
