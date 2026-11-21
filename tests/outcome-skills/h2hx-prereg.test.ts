// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planExtStage } from "../../lanes/outcome-skills/h2h/ext/plan.ts";
import { EXT_ARMS, extArmsFor, extItemOf, extScriptedTurns, hostOf, modelOf, readExtPrereg, EXT_PREREG_PATH } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { readFileSync } from "node:fs";

const x = readExtPrereg();
const base = readPrereg();
const tmp = (j: unknown) => {
  const f = join(mkdtempSync(join(tmpdir(), "h2hx-")), "prereg.json");
  writeFileSync(f, JSON.stringify(j));
  return f;
};

describe("the extension's prereg.json", () => {
  test("reads, and its frozen values match the plan", () => {
    expect(x.sentence).toBe(base.texts.oneline);
    expect(x.parts.S.model).toBe("gpt-6.2-sol");
    expect(x.parts.P.model).toBe("particle-ai/particle-1");
    expect(x.parts.L.model).toBe(base.model);
    expect(x.gstack.S.sha).toBe("29bff55dd8a14b32ff282d5a37097e3a53e3250a");
    expect(x.gstack.P.sha).toBe(base.pins.gstack!.sha);
    expect(createHash("sha256").update(x.parts.S.agents_md["s-gstack-line"]!).digest("hex")).toBe(x.parts.S.agents_md_sha256);
    expect(x.parts.L.claude_md["l-gstack"]).toBe(base.gstack_claude_md);
    expect(x.parts.L.claude_md["l-gstack-md"]).toBe(base.gstack_claude_md + x.sentence + "\n");
    const paid = x.items.filter((i) => !["h2hx-vms", "h2hx-crew"].includes(i.id));
    expect(paid.reduce((a, i) => a + i.central_usd, 0)).toBe(1316);
    expect(paid.reduce((a, i) => a + i.cap_usd, 0)).toBe(2317);
    expect(x.items.reduce((a, i) => a + i.cap_usd, 0)).toBeLessThanOrEqual(x.approved_all_in_cap_usd);
  });

  test("refuses another schema, a bad seed or a changed arm list", () => {
    const j = JSON.parse(readFileSync(EXT_PREREG_PATH, "utf8"));
    expect(() => readExtPrereg(tmp({ ...j, schema: "x" }))).toThrow(/^E_H2HX_PREREG/);
    expect(() => readExtPrereg(tmp({ ...j, order_seed: -1 }))).toThrow(/^E_H2HX_PREREG.*order_seed/);
    expect(() => readExtPrereg(tmp({ ...j, parts: { ...j.parts, S: { ...j.parts.S, arms: j.parts.S.arms.slice(1) } } }))).toThrow(/^E_H2HX_PREREG.*part S arms/);
  });
});

describe("arms, hosts and turns", () => {
  test("arms per part and unit kind", () => {
    expect(extArmsFor("S", "O", x)).toHaveLength(7);
    expect(extArmsFor("S", "B2", x)).not.toContain("s-gstack-line");
    expect(extArmsFor("P", "O", x)).toHaveLength(9);
    expect(extArmsFor("P", "B2", x)).toHaveLength(7);
    expect(extArmsFor("L", "O", x)).toHaveLength(4);
    expect(() => extArmsFor("L", "B2", x)).toThrow(/^E_H2HX_INPUT/);
    expect(() => extArmsFor("S", "B1", x)).toThrow(/^E_H2HX_INPUT/);
    expect(hostOf("s-gsd", x)).toBe("codex");
    expect(hostOf("p-gsd", x)).toBe("claude-code");
    expect(modelOf("l-none", x)).toBe("claude-opus-5-5");
  });

  test("scripted turns follow each part's entries", () => {
    const T = base.texts.task.replace("{problem statement}", "Broken thing.");
    expect(extScriptedTurns("s-gstack", "feature", "Broken thing.\n", x, base)).toEqual(["$autoplan " + T]);
    expect(extScriptedTurns("s-agent-skills", "feature", "Broken thing.", x, base)).toEqual(["$agent-skills:spec-driven-development " + T, "$agent-skills:incremental-implementation Implement every task."]);
    expect(extScriptedTurns("s-gsd", "bug", "Broken thing.", x, base)).toEqual(["$gsd-debug " + T]);
    expect(extScriptedTurns("p-agent-skills", "bug", "Broken thing.", x, base)).toEqual(["/agent-skills:test " + T]);
    expect(extScriptedTurns("p-gstack-oneline", "bug", "Broken thing.", x, base)).toEqual([T + "\n\n" + x.sentence]);
    expect(extScriptedTurns("l-gstack-task", "feature", "Broken thing.", x, base)).toEqual(["/autoplan " + T + "\n\n" + x.sentence]);
    expect(extScriptedTurns("l-gstack-md", "bug", "Broken thing.", x, base)).toEqual([T]);
    expect(() => extScriptedTurns("s-none", "bug", "  ", x, base)).toThrow(/^E_H2HX_INPUT/);
  });
});

describe("the session plan", () => {
  const units = [
    { id: "a", kind: "O" as const, entry: "bug" as const },
    { id: "b", kind: "O" as const, entry: "feature" as const },
    { id: "c", kind: "B2" as const, entry: "bug" as const },
  ];
  test("every arm of every unit once, in a seeded order that repeats", () => {
    const p = planExtStage("S", units, "stage2", x);
    expect(p.sessions).toHaveLength(7 + 7 + 6);
    expect(new Set(p.sessions.map((s) => s.unit + s.arm)).size).toBe(20);
    expect(p.sessions.every((s, i) => s.index === i && s.item === "h2hx-s-main")).toBe(true);
    expect(planExtStage("S", units, "stage2", x)).toEqual(p);
    expect(planExtStage("P", units, "stage1", x).sessions.every((s) => s.item === "h2hx-p-pilot")).toBe(true);
    expect(extItemOf("stage0", "l-none", x)).toBe("h2hx-l-pilot");
    expect(EXT_ARMS).toHaveLength(20);
  });
  test("refuses a unit listed twice", () => {
    expect(() => planExtStage("S", [units[0]!, units[0]!], "stage2", x)).toThrow(/^E_H2HX_INPUT/);
  });
});
