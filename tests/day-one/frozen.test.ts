import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mddFor } from "../../lanes/day-one/analysis.ts";
import { main } from "../../lanes/day-one/cli.ts";
import * as F from "../../lanes/day-one/frozen.ts";
import { ALL_IN_USD, ITEMS, ledgerCapUsd, projectionUsd } from "../../lanes/day-one/ledger.ts";
import { UNIT_ID } from "../../lanes/day-one/units.ts";
import { checkPrompt } from "../../lanes/day-one/verdict.ts";

const prereg = readFileSync(join(import.meta.dir, "../..", F.PREREG), "utf8");
const TEXTS = { COMMON_ASK: F.COMMON_ASK, REVIEW_ASK: F.REVIEW_ASK, DAY_ONE_PASS: F.DAY_ONE_PASS, AUTOPLAN_LINE: F.AUTOPLAN_LINE, OWNER_NOTICE: F.OWNER_NOTICE, PLATFORM: F.PLATFORM, BUILD_PROMPT: F.BUILD_PROMPT, CHECK_HEADER: F.CHECK_HEADER, CHECK_FOOTER: F.CHECK_FOOTER, OWNER_HEAD: F.OWNER_HEAD, OWNER_RULES: F.OWNER_RULES, OWNER_CLOSING: F.OWNER_CLOSING, GATE_REPLY: F.GATE_REPLY, LIMITS: F.limitsTable(), ...Object.fromEntries(F.PROBE_QUESTIONS.map((q, i) => ["PROBE_" + (i + 1), q])) };

describe("the day-one prereg holds the frozen values", () => {
  test("every frozen text appears byte for byte, with the prompts digest", () => {
    expect(Object.entries(TEXTS).filter(([, v]) => !prereg.includes(v)).map(([k]) => k)).toEqual([]);
    expect(prereg).toContain(F.PROMPTS_SHA256);
  });
  test("each arm's first message is built from the frozen texts", () => {
    expect(F.armPrompt("n")).toBe(F.COMMON_ASK + "\n\n" + F.OWNER_NOTICE);
    expect(F.armPrompt("d")).toBe(F.REVIEW_ASK + "\n\n" + F.DAY_ONE_PASS + "\n\n" + F.OWNER_NOTICE);
    expect(F.armPrompt("a")).toBe(F.AUTOPLAN_LINE + "\n\n" + F.REVIEW_ASK + "\n\n" + F.OWNER_NOTICE);
    expect(F.armPrompt("r")).toBe(F.REVIEW_ASK + "\n\n" + F.OWNER_NOTICE);
    expect(F.armPrompt("d", false)).toBe(F.REVIEW_ASK + "\n\n" + F.DAY_ONE_PASS);
    expect(F.LIMITS.r).toEqual(F.LIMITS.d);
    expect(F.LIMITS.d).toEqual(F.LIMITS.n);
  });
  test("each arm's first message prints with its bytes and sha256", () => {
    expect(F.ARM_PROMPTS.map((p) => p.arm)).toEqual(["n", "d", "r", "a"]);
    for (const p of F.ARM_PROMPTS) expect(prereg).toContain(p.sha256);
  });
  test("the unit sets: random labels, no label in two splits, every digest in the prereg", () => {
    const all = Object.values(F.UNIT_SETS).flatMap((s) => [...s.labels]);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((l) => UNIT_ID.test(l))).toBe(true);
    expect([F.UNIT_SETS.set.labels.length, F.UNIT_SETS.spares.labels.length, F.UNIT_SETS.practice.labels.length, F.UNIT_SETS.cat1.labels.length]).toEqual([15, 3, 3, 2]);
    for (const s of Object.values(F.UNIT_SETS)) expect(prereg).toContain(s.digest);
  });
  test("every gstack arm's pin is in the dated pin change, and the browser image in the prereg", () => {
    expect(F.GSTACK_PINS).toEqual({
      a: { repo: "garrytan/gstack", sha: "e671a531f4ede3d63b3143c96903466c960aca58", version: "1.100.0.0" },
      "s-full": { repo: "garrytan/gstack", sha: "798782aeea7548d979878b7b559f5fc47bea2400", version: "1.100.0.0" },
      "s-dayone": { repo: "garrytan/gstack", sha: "a2a421ba6734a861fee93234aa9fb4373dc858d0", version: "1.100.0.0" },
    });
    const change = readFileSync(join(import.meta.dir, "../..", F.PIN_CHANGE), "utf8");
    for (const pin of Object.values(F.GSTACK_PINS)) expect(change).toContain(pin.sha!);
    expect(change).toContain("2026-11-17-geva-546-day-one-usefulness-prereg");
    expect(prereg).toContain(F.BROWSER_IMAGE.split("@")[1]!);
  });
  test("the checker repair is in its dated change and sits between the frozen header and the tasks", () => {
    const change = readFileSync(join(import.meta.dir, "../..", F.REPAIR_CHANGE), "utf8");
    expect(change).toContain(F.CHECK_REPAIR);
    expect(prereg).not.toContain(F.CHECK_REPAIR);
    const list = { tasks: [{ id: "t1", rank: 1, task: "Add a plant", success: "It shows after a reload", data: null }] } as unknown as Parameters<typeof checkPrompt>[0];
    expect(checkPrompt(list).startsWith(F.CHECK_HEADER + "\n\n" + F.CHECK_REPAIR + "\n\nTask t1: ")).toBe(true);
    expect(checkPrompt(list).endsWith(F.CHECK_FOOTER)).toBe(true);
  });
  test("the caps total the all-in stop and day1-plans' ledger cap carries the voice", () => {
    expect(ITEMS.reduce((a, i) => a + i.capUsd, 0)).toBe(ALL_IN_USD);
    expect(ALL_IN_USD).toBe(4680);
    expect(projectionUsd()).toBe(3974);
    expect(ledgerCapUsd("day1-plans")).toBe(1020);
    expect(prereg).toContain("$4,680");
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
    for (const c of ["units", "stage", "judge", "controls", "gold", "read", "validate draw", "validate score", "probe", "dryrun", "fixtures", "fixtures-real", "voice-check"]) expect(out.join("\n")).toContain("day-one " + c);
  });
  test.skipIf(!existsSync("/dev/shm"))("a unit outside every frozen split is refused before anything runs", async () => {
    const dir = mkdtempSync("/dev/shm/day-one-units-");
    const err: string[] = [];
    try {
      expect(await main(["units", "--units-dir", dir, "--units", "aaaaaa"], { out: () => {}, err: (t) => err.push(t) })).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(err.join("\n")).toContain("not in a frozen split: aaaaaa");
  });
});
