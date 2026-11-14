// Copyright (c) 2026 Garry Tan. MIT License.
// The lane's keyless dry run in CI: every area's cases pass, and the runner fails a case that fails, throws or repeats.
import { describe, expect, test } from "bun:test";
import { AREAS, dryRun, REGISTRY } from "../../lanes/design-constructed/dryrun.ts";
import { main } from "../../lanes/design-constructed/cli.ts";

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }, out, err };
};

describe("dc dry run", () => {
  test("every case of every area passes", async () => {
    const r = await dryRun();
    expect(r.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines.some((l) => l.startsWith("PASS PD-1 "))).toBe(true);
    expect(r.lines.at(-1)).toMatch(/^dry run: \d+ pass, 0 fail$/);
  }, 60_000);

  test("a failing, throwing, repeated or badly named case prints FAIL with its reason", async () => {
    const registry = {
      ...REGISTRY,
      frame: () => [
        { rule: "T1", name: "fails", check: () => "wrong\nanswer" },
        { rule: "T1", name: "throws", check: () => { throw new Error("boom"); } },
        { rule: "T1", name: "passes", check: async () => null },
        { rule: "T1", name: "passes", check: () => null },
        { rule: "T 1", name: "spaced", check: () => null },
      ],
      money: () => { throw new Error("no cases"); },
    };
    const r = await dryRun(AREAS, registry);
    expect(r.ok).toBe(false);
    expect(r.lines).toContain("FAIL T1 fails: wrong answer");
    expect(r.lines).toContain("FAIL T1 throws: threw: boom");
    expect(r.lines).toContain("PASS T1 passes");
    expect(r.lines).toContain("FAIL T1 passes: another case has this rule and name");
    expect(r.lines).toContain("FAIL T 1 spaced: a rule is one word with no spaces");
    expect(r.lines).toContain("FAIL load money: cases() threw: no cases");
  });
});

describe("gstack-evals dc", () => {
  test("dryrun prints one line per case and exits 0; --area runs one area", async () => {
    const a = capture();
    expect(await main(["dryrun"], a.io)).toBe(0);
    expect(a.out.at(-1)).toMatch(/0 fail$/);
    const b = capture();
    expect(await main(["dryrun", "--area", "score"], b.io)).toBe(0);
    expect(b.out.every((l) => l.startsWith("PASS ") || l.startsWith("dry run: "))).toBe(true);
    const c = capture();
    expect(await main(["dryrun", "--area", "nope"], c.io)).toBe(2);
    expect(c.err[0]).toStartWith("E_USAGE gstack-evals dc dryrun: --area is one of");
  }, 60_000);

  test("an area's command exits 2 with E_USAGE not built yet until it lands; unknown commands exit 2", async () => {
    const a = capture();
    expect(await main(["recipes"], a.io)).toBe(2);
    expect(a.err.join("\n").split("\n")[0]).toBe("E_USAGE gstack-evals dc recipes: not built yet (the frame area owns it)");
    expect(a.err.join("\n").split("\n").every((l) => l.startsWith("E_USAGE "))).toBe(true);
    const b = capture();
    expect(await main(["nope"], b.io)).toBe(2);
    expect(b.err[0]).toStartWith("E_USAGE gstack-evals dc: unknown command");
    const c = capture();
    expect(await main([], c.io)).toBe(2);
    expect(c.out[0]).toStartWith("gstack-evals dc <command>\n");
  });
});
