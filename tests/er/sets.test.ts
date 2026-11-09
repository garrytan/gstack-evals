// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decide, PROMPT, RULE, run as classify } from "../../lanes/eng-review/author/classify.ts";
import { draw, matches, readPairs, run as sets, type PoolUnit } from "../../lanes/eng-review/author/sets.ts";
import type { Key, ProjectType, UnitMeta } from "../../lanes/eng-review/types.ts";
import { buildRepo, tempDir } from "../real/fixture.ts";
import { capture, ENV, ledgerWith } from "../pv/fixtures.ts";

const PREREG = join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md");
const t = tempDir("er-sets-");
afterAll(() => t.cleanup());

describe("er classify (section 4)", () => {
  test.skipIf(!existsSync(PREREG))("the rule is section 4's text", () => {
    expect(readFileSync(PREREG, "utf8")).toContain(RULE);
  });
  test("agreement stands and a split takes the third label", () => {
    expect(PROMPT).toContain(RULE);
    expect(decide("mobile", "mobile", null)).toBe("mobile");
    expect(decide("mobile", "consumer", "consumer")).toBe("consumer");
    expect(decide(null, "server", "devtools")).toBe("devtools");
    expect(decide("server", "devtools", null)).toBeNull();
  });
  test("Opus and Sol label blind to the key; Gemini settles a split; unit.json takes the type", async () => {
    const root = join(t.dir, "shm");
    for (const [id, readme] of [["er-a", "A phone app for notes. MARK-MOBILE"], ["er-b", "A library and a desktop app."]]) {
      const u = join(root, "work", "units", id);
      mkdirSync(join(u, "repo"), { recursive: true });
      writeFileSync(join(u, "repo", "README.md"), readme);
      writeFileSync(join(u, "unit.json"), JSON.stringify({ id, type: "devtools" }));
      writeFileSync(join(u, "key.json"), JSON.stringify({ items: [{ statement: "SECRET-KEY-TEXT" }] }));
    }
    const prompts: string[] = [];
    const fetch_ = (async (url: any, init?: any) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
      prompts.push(prompt);
      const model = String(url).includes("anthropic") ? "opus" : String(body.model).includes("sol") ? "sol" : "gemini";
      const type = prompt.includes("MARK-MOBILE") ? "mobile" : model === "opus" ? "devtools" : "consumer";
      const text = JSON.stringify({ type, why: "x" });
      if (model === "opus") return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
      return Response.json({ id: "g", model: body.model, provider: model === "sol" ? "OpenAI" : "Google", choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }) as typeof fetch;
    const { record, ledger } = ledgerWith(t.dir, ["er-auth-classify"]);
    const c = capture();
    expect(await classify(["--work", join(root, "work"), "--item", "er-auth-classify", "--record", record, "--ledger", ledger], c.io, { fetch: fetch_, env: ENV, custodyRoot: root, journals: join(t.dir, "j"), head: "test" })).toBe(0);
    expect(c.out).toContain("er-a mobile");
    expect(c.out).toContain("er-b consumer (settled by the third classifier)");
    expect(JSON.parse(readFileSync(join(root, "work", "units", "er-b", "unit.json"), "utf8")).type).toBe("consumer");
    expect(prompts).toHaveLength(5);
    expect(prompts.every((p) => !p.includes("SECRET-KEY-TEXT"))).toBe(true);
  });
});

let n = 0;
const units = (type: ProjectType, count: number, o: Partial<PoolUnit> = {}): PoolUnit[] => Array.from({ length: count }, () => ({ id: "er-" + type + ++n, type, repo: "r/" + type + n, set: "pilot", merge_sha: "m" + n, aftermath: [], ...o }));
const pool = (k: Record<ProjectType, number>) => (Object.entries(k) as [ProjectType, number][]).flatMap(([ty, c]) => units(ty, c));

describe("er sets (section 4)", () => {
  test("calibration: 4 a type, quotas first; a type short of 4 is a supply stop", () => {
    const c = draw("calibration", pool({ mobile: 4, consumer: 6, server: 9, devtools: 9 }));
    expect(c).toHaveLength(16);
    for (const ty of ["mobile", "consumer", "server", "devtools"]) expect(c.filter((u) => u.type === ty)).toHaveLength(4);
    expect(() => draw("calibration", pool({ mobile: 3, consumer: 9, server: 9, devtools: 9 }))).toThrow(/E_ER_SUPPLY_SHORT/);
  });
  test("comparison: aims at 14 a type, needs 10 of each and 48 in all; free places go in seeded order", () => {
    const full = draw("comparison", pool({ mobile: 10, consumer: 20, server: 20, devtools: 20 }));
    expect(full).toHaveLength(56);
    expect(full.filter((u) => u.type === "mobile")).toHaveLength(10);
    expect(() => draw("comparison", pool({ mobile: 9, consumer: 20, server: 20, devtools: 20 }))).toThrow(/E_ER_SUPPLY_SHORT/);
    expect(draw("comparison", pool({ mobile: 12, consumer: 12, server: 12, devtools: 12 }))).toHaveLength(48);
    expect(() => draw("comparison", pool({ mobile: 11, consumer: 12, server: 12, devtools: 12 }))).toThrow(/under 48/);
  });
  test("reserve: the next 6; units already in a set never return but count toward caps", () => {
    const p = pool({ mobile: 3, consumer: 3, server: 3, devtools: 3 });
    p[0]!.set = "comparison";
    const r = draw("reserve", p);
    expect(r).toHaveLength(6);
    expect(r).not.toContain(p[0]);
  });
  test("per-repository caps (4 for mobile and consumer, 3 for the others) and the aftermath rule", () => {
    const p = [...units("mobile", 5, { repo: "one/app" }), ...units("server", 4, { repo: "one/db" }), ...units("consumer", 4), ...units("devtools", 4), ...units("server", 1)];
    const c = draw("calibration", p);
    expect(c.filter((u) => u.repo === "one/app")).toHaveLength(4);
    expect(c.filter((u) => u.repo === "one/db")).toHaveLength(3);
    const a = units("devtools", 1, { merge_sha: "AAA" })[0]!;
    const b = units("devtools", 1, { aftermath: ["AAA"] })[0]!;
    const r = draw("reserve", [a, b, ...units("mobile", 5)]);
    expect(r.includes(a) && r.includes(b)).toBe(false);
  });
  test("drop pairs: repository and commit prefix of at least 7 hex", () => {
    const pairs = readPairs("# sealed\nOwner/App 1234567\nother/x,abcdef0123\n");
    expect(matches(pairs, "owner/app", ["1234567890abcdef"])).toBe(true);
    expect(matches(pairs, "owner/app", ["123456"])).toBe(false);
    expect(matches(pairs, "owner/app2", ["1234567890"])).toBe(false);
    expect(() => readPairs("owner/app 12345")).toThrow(/7 hex/);
  });
  test("draws audited units, writes set and rank, prints the units digest, and the drop step removes matches", () => {
    const root = join(t.dir, "shm-sets");
    const work = join(root, "work");
    const types: ProjectType[] = ["mobile", "consumer", "server", "devtools"];
    let k = 0;
    for (const ty of types)
      for (let i = 0; i < 5; i++) {
        const id = "er-" + ty + "-" + i;
        const u = join(work, "units", id);
        mkdirSync(u, { recursive: true });
        buildRepo(join(u, "repo"), [{ name: "a", message: "base", date: "2026-07-01T00:00:00Z", files: { "f.txt": id } }]);
        const meta = { id, set: "pilot", type: ty, repo: "o/" + id, merge_sha: (++k).toString(16).padStart(8, "0") + "aa", base_sha: "b", aftermath: [] } as unknown as UnitMeta;
        writeFileSync(join(u, "unit.json"), JSON.stringify(meta));
        writeFileSync(join(u, "plan.md"), "plan");
        writeFileSync(join(u, "classify.json"), JSON.stringify({ type: ty }));
        const key = { unit: id, items: [{ id: "k1", generic: false, mentioned: i === 4 }], primary: ["k1"] } as unknown as Key;
        writeFileSync(join(u, "key.json"), JSON.stringify(key));
      }
    const c = capture();
    expect(sets(["calibration", "--work", work, "--out", join(t.dir, "cal.json"), "--write"], c.io, { custodyRoot: root, head: "test" })).toBe(0);
    const out = JSON.parse(readFileSync(join(t.dir, "cal.json"), "utf8"));
    expect(out).toMatchObject({ pool: 16, counts: { mobile: 4, consumer: 4, server: 4, devtools: 4 } });
    expect(out.units_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(readFileSync(join(work, "units", out.drawn[0].id, "unit.json"), "utf8"))).toMatchObject({ set: "calibration", rank: 1 });
    expect(() => sets(["calibration", "--work", work, "--out", join(t.dir, "cal.json")], capture().io, { custodyRoot: root, head: "test" })).toThrow(/drawn once/);
    writeFileSync(join(t.dir, "pairs.txt"), "o/er-mobile-0 00000001\n");
    const d = capture();
    expect(sets(["drop", "--work", work, "--pairs", join(t.dir, "pairs.txt")], d.io, { custodyRoot: root })).toBe(0);
    expect(d.out[0]).toBe("er sets drop: 1 pairs read, 1 units removed, 0 candidates made ineligible");
    expect(existsSync(join(work, "units", "er-mobile-0"))).toBe(false);
  });
});
