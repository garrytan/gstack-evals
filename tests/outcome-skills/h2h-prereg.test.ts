// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ITEMS } from "../../lanes/outcome-skills/h2h/items.ts";
import { PREREG_PATH, readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { ALL_ARMS } from "../../lanes/outcome-skills/h2h/types.ts";

const post = readFileSync(join(PREREG_PATH, "..", "README.md"), "utf8");

describe("h2h prereg.json", () => {
  test("reads, and its arms and items match the lane", () => {
    const p = readPrereg();
    expect([...p.arms.primary, ...p.arms.piece_g, ...p.arms.secondary]).toEqual([...ALL_ARMS]);
    expect(p.items).toEqual(Object.keys(ITEMS));
    expect(p.continuation_cap).toBe(6);
  });

  test("the frozen texts are word for word the post's", () => {
    const p = readPrereg();
    for (const k of ["question_reply", "continuation", "oneline"] as const) expect(post).toContain(p.texts[k]);
    for (const line of p.texts.task.split("\n").filter((l) => l && !l.startsWith("{"))) expect(post).toContain("> " + line);
    for (const line of p.gstack_claude_md.trim().split("\n").filter(Boolean)) expect(post).toContain("> " + line);
    for (const pattern of p.exclusion) expect(post).toContain(pattern);
    for (const licence of p.licences) expect(post).toContain(licence);
  });

  test("refuses a bad seed with its reason code", () => {
    const dir = mkdtempSync(join(tmpdir(), "h2h-prereg-"));
    const j = JSON.parse(readFileSync(PREREG_PATH, "utf8"));
    j.draw_seed = -1;
    writeFileSync(join(dir, "prereg.json"), JSON.stringify(j));
    expect(() => readPrereg(join(dir, "prereg.json"))).toThrow(/^E_H2H_PREREG /);
  });
});
