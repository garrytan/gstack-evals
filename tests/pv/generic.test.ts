// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primaryOf, run } from "../../lanes/product-value/author/generic.ts";
import { fakeUpstream } from "../../lanes/product-value/dryrun.ts";
import type { Key } from "../../lanes/product-value/types.ts";
import { capture, ENV, identity, item, ledgerWith, meta, tmp, writeUnits } from "./fixtures.ts";

describe("pv generic (section 3)", () => {
  test("primary: U and E items neither mentioned nor generic, ranked by outside users, seeded ties, at most 6", () => {
    const key: Key = { unit: "u", items: [item("a", { outside_users: 1 }), item("b", { kind: "E", outside_users: 4 }), item("c", { mentioned: true, outside_users: 9 }), item("d", { generic: true, outside_users: 9 }), item("r", { kind: "R", outside_users: 9 }), ...["e", "f", "g", "h", "i"].map((id) => item(id, { outside_users: 2 }))], primary: [], commitments: [] };
    const p = primaryOf(key);
    expect(p).toHaveLength(6);
    expect(p[0]).toBe("b");
    expect(p).not.toContain("a");
    expect(p).not.toContain("c");
    expect(p).not.toContain("d");
    expect(primaryOf(key)).toEqual(p);
  });

  test("screens through the metered judge client against stock rows 1 and 2 only, writes generic flags and prints counts, never key text", async () => {
    const dir = tmp();
    const units = join(dir, "units");
    const k1: Key = { unit: "g1", items: [item("a", { statement: "People needed better error messages to tell what went wrong." }), item("b")], primary: ["a", "b"], commitments: [] };
    const k2: Key = { unit: "g2", items: [item("z", { statement: "Users needed a dry-run preview before applying changes." })], primary: ["z"], commitments: [] };
    writeUnits(units, [{ meta: meta("g1"), key: k1 }, { meta: meta("g2"), key: k2 }]);
    const { record, ledger } = ledgerWith(dir, ["pv-auth-generic"]);
    const prompts: string[] = [];
    const upstream = fakeUpstream((judge, prompt) => {
      prompts.push(prompt);
      const items = [...prompt.matchAll(/^\[(\w+)\] (.*)$/gm)].map((m) => ({ id: m[1]!, text: m[2]! }));
      const lists = [...prompt.matchAll(/^List (\w+)\n((?:\d\. .*\n?)+)/gm)].map((m) => ({ id: m[1]!, text: m[2]! }));
      const hit = (l: string, t: string) => (judge === "astra" && t.includes("error messages") && l.includes("error messages")) || (judge === "opus" && t.includes("dry-run") && l.includes("dry-run"));
      return JSON.stringify({ labels: lists.flatMap((l) => items.map((i) => ({ list: l.id, item: i.id, anticipated: hit(l.text, i.text), changes: hit(l.text, i.text) ? [1] : [] }))) });
    });
    const c = capture();
    expect(await run(["--units", units, "--item", "pv-auth-generic", "--record", record, "--ledger", ledger], c.io, { fetch: upstream, env: ENV, normalize: identity })).toBe(0);
    expect(prompts.every((p) => !p.includes("12-month ideal") && p.includes("opt-in flag") && p.includes("quick-start guide"))).toBe(true);
    const g1 = JSON.parse(readFileSync(join(units, "g1", "key.json"), "utf8")) as Key;
    expect(g1.items.find((i) => i.id === "a")!.generic).toBe(true);
    expect(g1.primary).toEqual(["b"]);
    const g2 = JSON.parse(readFileSync(join(units, "g2", "key.json"), "utf8")) as Key;
    expect(g2.primary).toEqual([]);
    expect(c.out).toContain("unit g1: generic 1, primary 1");
    expect(c.out).toContain("unit g2: generic 1, primary 0, dropped (no primary item left)");
    expect(c.out.join("\n")).not.toMatch(/error messages|dry-run|tag-/);
    await expect(run(["--units", units, "--item", "pv-s1-plan-labels"], c.io, { fetch: upstream, env: ENV, normalize: identity })).rejects.toThrow(/only on line item pv-auth-generic/);
  });
});
