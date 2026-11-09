// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mineClone, withPlans, type MineResult } from "../../lanes/eng-review/author/mine.ts";
import { PROMPT_SHA256, PROMPTS, REWRITE, sha256 } from "../../lanes/eng-review/author/prompts.ts";
import { buildUnitRepo, cloneDir, custody, mechanical, rankPrimary, readAudit, run, touchedOf, unitId, type Material } from "../../lanes/eng-review/author/run.ts";
import type { Key, KeyItem, UnitMeta } from "../../lanes/eng-review/types.ts";
import { git } from "../../lanes/real-outcome/mine/git.ts";
import { tempDir } from "../real/fixture.ts";
import { capture, ENV, ledgerWith } from "../pv/fixtures.ts";
import { buildShop } from "./shop-fixture.ts";

const PREREG = join(import.meta.dir, "../../wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md");

describe("authoring prompts (section 4)", () => {
  test.skipIf(!existsSync(PREREG))("the plan rewrite is section 4's frozen prompt byte for byte", () => {
    expect(readFileSync(PREREG, "utf8").split("\n").filter((l) => l.startsWith("> ")).map((l) => l.slice(2))).toContain(REWRITE);
  });
  test("every prompt matches its pinned sha256, and a changed prompt would not", () => {
    for (const [k, v] of Object.entries(PROMPTS)) expect(sha256(v)).toBe(PROMPT_SHA256[k as keyof typeof PROMPTS]);
    expect(sha256(REWRITE + " ")).not.toBe(PROMPT_SHA256.REWRITE);
  });
  test("the key prompts carry section 3's rules and examples and ask for no advice", () => {
    for (const p of [PROMPTS.KEY, PROMPTS.KEY_AUDIT]) {
      expect(p).toContain("at most 30 words");
      expect(p).toContain("The export endpoint returned a 500 when the tag list was empty (api/export.go)");
      expect(p).toContain("Never advice");
      expect(p).toContain("a test for a later feature".replace("a test", "A test"));
    }
    expect(PROMPTS.KEY).toContain("up to 4 behaviors the change's own tests checked");
  });
});

const item = (id: string, kind: KeyItem["kind"], o: Partial<KeyItem> = {}): KeyItem => ({ id, kind, statement: id, file: "a", evidence: [], dated: "", mentioned: false, generic: false, foreseeable: { opus: null, sol: null }, ...o });

describe("the primary list (section 3)", () => {
  test("B by source, then C, then T; mentioned and generic out; at most 6; seeded ties", () => {
    const items = [item("t1", "T"), item("c1", "C"), item("bf", "B", { b_source: "fix" }), item("bu", "B", { b_source: "user-issue" }), item("br", "B", { b_source: "revert" }), item("m", "B", { b_source: "revert", mentioned: true }), item("g", "C", { generic: true }), item("t2", "T"), item("t3", "T"), item("t4", "T")];
    const p = rankPrimary("er-x", items);
    expect(p.slice(0, 4)).toEqual(["br", "bu", "bf", "c1"]);
    expect(p).toHaveLength(6);
    expect(p).not.toContain("m");
    expect(p).not.toContain("g");
    expect(rankPrimary("er-x", [...items].reverse())).toEqual(p);
  });
});

const mat = (over: Partial<Material> = {}): Material => ({ repo: "o/n", candidate: "o/n@x", merged_at: "2026-07-10T00:00:00.000Z", window_closes: "2026-09-08T00:00:00.000Z", plan_source: { pr: 1, title: "", description: "", issues: [], words: 200 }, unit_diff: "", window: [], about: { description: "", topics: [] }, base_files: [], candidates: [{ id: "B1", kind: "B", change: "f", pr: 2, merged_at: "2026-08-01T00:00:00.000Z", subject: "", message: "", pr_text: "", issues: [], diff: "", sites: [] }, { id: "T1", kind: "T", change: "t", pr: null, merged_at: "2026-09-08T00:00:00.000Z", subject: "", message: "", pr_text: "", issues: [], diff: "", sites: [] }, { id: "C1", kind: "C", change: "c", pr: null, merged_at: "2026-09-09T00:00:00.000Z", subject: "", message: "", pr_text: "", issues: [], diff: "", sites: [] }], ...over });
const w = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");

describe("audit rules", () => {
  test("mechanical problems on both sides of each edge", () => {
    const ok = { candidate: "B1", kind: "B", statement: w(30), file: "a", mentioned: false };
    expect(mechanical(mat(), { items: [ok], own: [] })).toEqual([]);
    expect(mechanical(mat(), { items: [{ ...ok, statement: w(31) }], own: [] })).toEqual(["item 0: statement over 30 words"]);
    expect(mechanical(mat(), { items: [{ ...ok, candidate: "B9" }], own: [] })).toEqual(["item 0: unknown candidate"]);
    expect(mechanical(mat(), { items: [{ ...ok, kind: "T" }], own: [] })).toEqual(["item 0: kind T on a B candidate"]);
    expect(mechanical(mat(), { items: [{ ...ok, candidate: "T1", kind: "T" }], own: [] })).toEqual([]);
    expect(mechanical(mat(), { items: [{ ...ok, candidate: "C1", kind: "C" }], own: [] })).toEqual(["item 0: outside the window"]);
  });
  test("a pass, a drop, a fix, a missing candidate, an unreviewed item and an input problem", () => {
    const d = { items: [{ candidate: "B1", kind: "B", statement: "s", file: "a", mentioned: false }, { candidate: "T1", kind: "T", statement: "s", file: "a", mentioned: false }], own: [] };
    const pass = { input: { verdict: "pass", problems: [] }, key: { verdict: "pass", items: [{ index: 0, verdict: "keep" }, { index: 1, verdict: "keep" }], missing: [] } };
    expect(readAudit(d, [pass, pass], []).failed).toBe(false);
    const dropped = readAudit(d, [pass, { ...pass, key: { verdict: "fail", items: [{ index: 0, verdict: "keep" }, { index: 1, verdict: "drop" }], missing: [] } }], []);
    expect([dropped.failed, [...dropped.drops]]).toEqual([false, [1]]);
    expect(readAudit(d, [pass, { ...pass, key: { items: [{ index: 0, verdict: "fix", note: "n" }, { index: 1, verdict: "keep" }] } }], []).failed).toBe(true);
    expect(readAudit(d, [pass, { ...pass, key: { ...pass.key, missing: ["C1"] } }], []).failed).toBe(true);
    expect(readAudit(d, [pass, { ...pass, key: { items: [{ index: 0, verdict: "keep" }] } }], []).key).toEqual(["item 1: unreviewed"]);
    expect(readAudit(d, [pass, { ...pass, input: { verdict: "fail", problems: [{ quote: "q", fix: "f" }] } }], []).input).toEqual(["q: f"]);
    expect(readAudit(d, [pass, pass], ["item 0: statement over 30 words"]).failed).toBe(true);
  });
});

describe("custody (section 17)", () => {
  const t = tempDir("er-custody-");
  afterAll(() => t.cleanup());
  test("work dirs sit under the custody root, mode 0700; anything else is refused", () => {
    const root = join(t.dir, "shm-er");
    const dir = custody(join(root, "work"), root);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(() => custody(join(t.dir, "elsewhere"), root)).toThrow(/outside/);
  });
});

let shop: ReturnType<typeof buildShop>;
const t = tempDir("er-author-");
beforeAll(() => {
  shop = buildShop();
});
afterAll(() => {
  shop.cleanup();
  t.cleanup();
});

describe("repo/ and the real diff's facts", () => {
  test("repo/ is the base tree, one commit, no remote", () => {
    const dest = join(t.dir, "repo1");
    buildUnitRepo(shop.dir, shop.sha.c0!.length ? git(shop.dir, ["rev-parse", shop.sha.u1 + "^"]).trim() : "", dest);
    expect(git(dest, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
    expect(git(dest, ["remote"]).trim()).toBe("");
    expect(git(dest, ["rev-parse", "HEAD^{tree}"]).trim()).toBe(git(shop.dir, ["rev-parse", shop.sha.u1 + "^^{tree}"]).trim());
    expect(git(dest, ["status", "--porcelain"]).trim()).toBe("");
    expect(existsSync(join(dest, "app/src/main/kotlin/shop/Discount.kt"))).toBe(false);
    expect(git(dest, ["log", "-1", "--format=%an %ae"]).trim()).toBe("unit unit@example.invalid");
  });
  test("touched files and functions and the diffstat come from the real diff", () => {
    const base = git(shop.dir, ["rev-parse", shop.sha.u1 + "^"]).trim();
    const x = touchedOf(shop.dir, base, shop.sha.u1!);
    expect(x.touched.files.sort()).toEqual(["app/src/main/kotlin/shop/Cart.kt", "app/src/main/kotlin/shop/Discount.kt"]);
    expect(x.touched.functions).toContainEqual({ file: "app/src/main/kotlin/shop/Cart.kt", name: "total" });
    expect(x.touched.functions.map((f) => f.name)).toContain("off");
    expect(x.diffstat.map((d) => d.file)).toContain("app/src/test/kotlin/shop/CartTest.kt");
  });
});

const sol = (body: any) => String(body.model).includes("sol");
function upstream(answer: (model: string, prompt: string) => string, calls: string[]): typeof fetch {
  return (async (url: any, init?: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    const model = String(url).includes("anthropic") ? "opus" : sol(body) ? "sol" : "other";
    calls.push(model + ":" + prompt.slice(0, 40));
    const text = answer(model, prompt);
    if (model === "opus") return Response.json({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return Response.json({ id: "g", model: "openai/gpt-6.1-sol", provider: "OpenAI", choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }) as typeof fetch;
}

const PLAN = "The team will let shops offer discount codes at checkout. A code is six letters and takes ten percent off the cart total.";
const json = (x: unknown) => "\u0060\u0060\u0060json\n" + JSON.stringify(x) + "\n\u0060\u0060\u0060";
function answers(o: { failAudit?: boolean } = {}) {
  return (model: string, p: string) => {
    if (p.startsWith("Below is the description")) return PLAN;
    if (p.startsWith("You write the answer key")) return json({ items: [{ candidate: "B1", kind: "B", statement: "The cart total rounded discounts down when the sum was not a multiple of ten (Discount.kt)", file: "app/src/main/kotlin/shop/Discount.kt", mentioned: false }, { candidate: "T1", kind: "T", statement: "Later the project added a test that a discount code has six letters", file: "app/src/test/kotlin/shop/DiscountTest.kt", mentioned: true }, { candidate: "C1", kind: "C", statement: "Later the project ran the shop tests on two Android API levels in CI", file: ".github/workflows/ci.yml", mentioned: false }], own: ["The cart test checks a discounted total"] });
    if (p.startsWith("You audit the plan")) return json(o.failAudit ? { verdict: "fail", problems: [{ check: 1, quote: "ten percent", fix: "drop it" }] } : { verdict: "pass", problems: [] });
    if (p.startsWith("You audit one research unit's answer key")) return json({ verdict: "pass", items: [0, 1, 2].map((index) => ({ index, verdict: "keep", note: "" })), missing: [] });
    if (p.startsWith("Below are a software team's plan")) return json({ ratings: [{ index: 0, foreseeable: model === "opus" ? "maybe" : "yes" }, { index: 1, foreseeable: "yes" }, { index: 2, foreseeable: "no" }] });
    if (p.startsWith("Edit the plan")) return PLAN;
    return "unexpected";
  };
}
const planQuery = (q: string) => {
  const repo: Record<string, unknown> = { description: "A phone app for small shops", repositoryTopics: { nodes: [{ topic: { name: "android-app" } }] } };
  for (const m of q.matchAll(/(p\d+): pullRequest/g)) repo[m[1]!] = { title: "Add discount codes", body: "Shops want discount codes. " + w(130), createdAt: "2026-07-06T00:00:00Z", userContentEdits: { totalCount: 0, nodes: [] }, closingIssuesReferences: { nodes: [{ number: 20, title: "Total off by one", body: "b", createdAt: "2026-07-07T00:00:00Z", authorAssociation: "NONE", userContentEdits: { totalCount: 0, nodes: [] } }] } };
  return { repository: repo };
};

describe("er author end to end on the fixture, keyless", () => {
  test("waits for the window, then writes the unit in the types.ts layout, resumes from its cache and seals", async () => {
    const root = join(t.dir, "shm");
    const mined: MineResult = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "MIT", branch: "main", meta: shop.meta, minedAt: "2026-11-08" });
    withPlans(mined, planQuery);
    const cands = join(root, "mine.json");
    mkdirSync(root, { recursive: true });
    writeFileSync(cands, JSON.stringify(mined));
    const frame = join(t.dir, "frame.jsonl");
    writeFileSync(frame, JSON.stringify({ repo: "fixture/shop", stars: 900, licence: "MIT", copyleft: false, type_prov: "mobile", topics: [], default_branch: "main", order: "x" }) + "\n");
    const clones = join(t.dir, "clones");
    git(t.dir, ["clone", "--quiet", "--no-checkout", shop.dir, cloneDir(clones, "fixture/shop")]);
    const { record, ledger } = ledgerWith(t.dir, ["er-auth-pilot"]);
    const id = mined.candidates.find((c) => c.change === shop.sha.u1)!.id;
    const uid = unitId(id);
    const sealed: string[] = [];
    const args = ["--candidates", cands, "--frame", frame, "--clones", clones, "--work", join(root, "work"), "--item", "er-auth-pilot", "--ids", id, "--record", record, "--ledger", ledger, "--seal-to", join(t.dir, "sealed"), "--recipient", "r.txt"];
    const calls: string[] = [];
    const opts = (now: string) => ({ fetch: upstream(answers(), calls), env: ENV, custodyRoot: root, journals: join(t.dir, "journals"), clock: { now: () => Date.parse(now) }, query: planQuery, sealer: (_w: string, u: string) => sealed.push(u), head: "test" });
    const c1 = capture();
    expect(await run(args, c1.io, opts("2026-09-01"))).toBe(0);
    expect(c1.out.join("\n")).toContain(uid + " waiting for its window to close on 2026-09-08");
    expect(calls.map((c) => c.split(":")[0])).toEqual(["opus"]);
    const unit = join(root, "work", "units", uid);
    expect(readFileSync(join(unit, "plan.md"), "utf8").trim()).toBe(PLAN);
    expect(existsSync(join(unit, "key.json"))).toBe(false);
    const c2 = capture();
    expect(await run(args, c2.io, opts("2026-11-08"))).toBe(0);
    expect(c2.out.join("\n")).toContain(uid + " passed");
    expect(calls.filter((c) => c.startsWith("opus:Below is the description"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("sol:"))).toHaveLength(3);
    const key = JSON.parse(readFileSync(join(unit, "key.json"), "utf8")) as Key;
    expect(key.items.map((i) => [i.kind, i.b_source ?? null, i.mentioned])).toEqual([["B", "user-issue", false], ["T", null, true], ["C", null, false]]);
    expect(key.primary).toEqual(["k1", "k3"]);
    expect(key.items[0]!.sites).toEqual([{ file: "app/src/main/kotlin/shop/Discount.kt", function: "off" }]);
    expect(key.items[0]!.foreseeable).toEqual({ opus: "maybe", sol: "yes" });
    expect(key.items[0]!.evidence).toEqual([shop.sha.fix, "#12"]);
    expect(key.own).toEqual([{ id: "o1", statement: "The cart test checks a discounted total" }]);
    expect(key.touched.files).toHaveLength(2);
    const meta = JSON.parse(readFileSync(join(unit, "unit.json"), "utf8")) as UnitMeta;
    expect(meta).toMatchObject({ id: uid, set: "pilot", type: "mobile", repo: "fixture/shop", copyleft: false, language: "Kotlin", merge_sha: shop.sha.u1, pr: 10, wave: 1 });
    expect(git(join(unit, "repo"), ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
    expect(sealed).toEqual([uid]);
    const printed = c1.out.concat(c2.out).join("\n") + readFileSync(join(root, "work", "author-log.jsonl"), "utf8");
    expect(printed).not.toContain("discount");
    expect(printed).not.toContain("Discount.kt");
  });
  test("a unit that fails an audit twice drops", async () => {
    const root = join(t.dir, "shm2");
    const mined = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "MIT", branch: "main", meta: shop.meta, minedAt: "2026-11-08" });
    withPlans(mined, planQuery);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "mine.json"), JSON.stringify(mined));
    const frame = join(t.dir, "frame2.jsonl");
    writeFileSync(frame, JSON.stringify({ repo: "fixture/shop", stars: 900, licence: "MIT", copyleft: false, type_prov: "mobile", topics: [], default_branch: "main", order: "x" }) + "\n");
    const { record, ledger } = ledgerWith(join(t.dir, "l2"), ["er-auth-pilot"]);
    const id = mined.candidates.find((c) => c.change === shop.sha.u1)!.id;
    const c = capture();
    const calls: string[] = [];
    expect(await run(["--candidates", join(root, "mine.json"), "--frame", frame, "--clones", join(t.dir, "clones"), "--work", join(root, "work"), "--item", "er-auth-pilot", "--ids", id, "--record", record, "--ledger", ledger], c.io, { fetch: upstream(answers({ failAudit: true }), calls), env: ENV, custodyRoot: root, journals: join(t.dir, "j2"), clock: { now: () => Date.parse("2026-11-08") }, query: planQuery, head: "test" })).toBe(0);
    expect(c.out.join("\n")).toContain(unitId(id) + " dropped (failed an audit twice)");
    expect(calls.filter((x) => x.startsWith("opus:Edit the plan"))).toHaveLength(1);
    expect(existsSync(join(root, "work", "units", unitId(id), "unit.json"))).toBe(false);
  });
  test("work outside the custody root and an ineligible candidate are refused", async () => {
    const root = join(t.dir, "shm3");
    await expect(run(["--candidates", "x", "--frame", "y", "--clones", "z", "--work", join(t.dir, "nope"), "--item", "i", "--ids", "a"], capture().io, { custodyRoot: root, head: "test" })).rejects.toThrow(/outside/);
  });
});
