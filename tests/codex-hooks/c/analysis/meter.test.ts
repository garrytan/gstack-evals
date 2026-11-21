// Copyright (c) 2026 Garry Tan. MIT License.
// The paid path of part C's judging, driven keyless: a fake provider behind the real metering proxy, on a temporary
// ledger with a test approval, as tests/noloss/judge-run.test.ts drives R2's judge-run.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GOLD, JUDGE_ITEM, ROUTES } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { judgeItemDryRun, judgeModel, JudgeStop, withMeteredJudges, worstCaseMicros } from "../../../../lanes/codex-hooks/c/analysis/meter.ts";
import { JUDGE_RETRY } from "../../../../lanes/review-noloss/judge-run.ts";
import { recordApproval } from "../../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../../src/runner/ledger/record.ts";
import { cleanup, KEYS, tmp, upstream } from "./helpers.ts";

afterAll(cleanup);
const QUOTE = { words: "Approve the keyless test cap", by: "test", source: "tests/codex-hooks/c/analysis/meter.test.ts" };
const FILE = "packets/P1.json";
const prompt = "=== Judge brief ===\nbrief\n=== Instructions: batch.json ===\n{}\n=== Packet: " + FILE + " ===\n" + JSON.stringify({ blockers: [{ id: "B1", file: "a.ts", line: 3 }], findings: [{ id: "F1", path: "a.ts", line: 3, text: "x" }] }, null, 2) + "\n";

describe("judge models", () => {
  test("every judge the routes and the gold labels name passes the policy", () => {
    for (const r of Object.values(ROUTES)) {
      for (const id of [r.primary, r.second, r.third]) expect(judgeModel(id, "judge").id).toBe(id);
      for (const id of [r.primary, r.second, r.third]) expect(judgeModel(id, "adjudicator").id).toBe(id);
    }
    for (const id of GOLD) expect(judgeModel(id, "judge").id).toBe(id);
    expect(judgeModel(ROUTES.A.second, "judge")).toEqual({ id: ROUTES.A.second, provider: "openrouter", model: "google/gemini-4-carbon" });
  });
  const refused: Array<[string, "judge" | "adjudicator", string]> = [
    ["openai/gpt-6.1-sol", "judge", "E_MODEL_POLICY"],
    ["openai/claude-opus-5-5", "judge", "E_MODEL_POLICY"],
    ["openrouter/google/gemini-4-argon", "adjudicator", "E_MODEL_POLICY"],
    ["anthropic/claude-haiku-5-5", "judge", "E_MODEL_POLICY"],
    ["google/gemini-4-carbon", "judge", "E_USAGE"],
  ];
  for (const [id, role, code] of refused) test("refuses " + id + " as " + role, () => {
    try {
      judgeModel(id, role);
      throw new Error("accepted");
    } catch (e) {
      expect(e).toBeInstanceOf(JudgeStop);
      expect((e as JudgeStop).code).toBe(code);
    }
  });

  test("a request's worst case is its reservation at every send the retry budget allows", () => {
    const m = judgeModel(ROUTES.A.primary, "judge");
    const one = worstCaseMicros(m, prompt);
    expect(one).toBeGreaterThan(0);
    expect(one % JUDGE_RETRY.attempts).toBe(0);
    expect(worstCaseMicros(m, prompt + "x".repeat(40_000))).toBeGreaterThan(one);
  });
});

describe("metered judges", () => {
  const dir = tmp("chc-meter-");
  const record = join(dir, "record");
  const ledger = join(dir, "ledger.sqlite");
  recordApproval(record, { action: "init", item: JUDGE_ITEM.item, cap_micros: JUDGE_ITEM.cap_usd * 1_000_000, quotes: [QUOTE], admission: "warn" });
  const models = [judgeModel(ROUTES.A.primary, "judge"), judgeModel(ROUTES.A.second, "judge"), judgeModel(GOLD[0], "judge")];
  const base = (out: string, fetch: ReturnType<typeof upstream>) => ({ item: JUDGE_ITEM.item, runId: "geva-562-judge-test", record, ledger, out: join(dir, out), models, env: KEYS, fetch });

  test("each request goes through the proxy on a lease of the item, and the lease settles at what was spent", async () => {
    const sent: Array<{ model: string; file: string }> = [];
    const r = await withMeteredJudges(base("one", upstream({}, sent)), (send) => Promise.all(models.map((m) => send({ role: "primary", model: m.id, file: FILE, prompt, attempt: 1 }))));
    expect(r.requests).toBe(3);
    expect(sent.map((s) => s.model).sort()).toEqual(["claude-opus-5-5", "google/gemini-4-carbon", "gpt-6.2-astra"]);
    for (const text of r.value) expect(JSON.parse(text).packets[0].blockers).toEqual([{ id: "B1", matches: ["F1"] }]);
    const raw = join(dir, "one", "raw", "primary", "P1.anthropic_claude-opus-5-5.1.txt");
    expect(JSON.parse(readFileSync(raw, "utf8")).packets[0].file).toBe(FILE);
    const state = readItem(record, JUDGE_ITEM.item);
    expect(state.committed_micros).toBeGreaterThan(0);
    expect(state.committed_micros).toBeLessThan(1_000_000);
  });

  test("the same run id spends from the item again in the next judge step", async () => {
    const before = readItem(record, JUDGE_ITEM.item).committed_micros;
    const r = await withMeteredJudges(base("two", upstream()), (send) => send({ role: "second", model: models[1]!.id, file: FILE, prompt, attempt: 1 }));
    expect(r.requests).toBe(1);
    expect(readItem(record, JUDGE_ITEM.item).committed_micros).toBeGreaterThan(before);
  });

  test("a provider refusal stops the step with its code, and the lease still settles", async () => {
    const run = withMeteredJudges(base("three", upstream({}, [], () => 400)), (send) => send({ role: "primary", model: models[0]!.id, file: FILE, prompt, attempt: 1 }));
    await expect(run).rejects.toThrow(/^UPSTREAM the primary judge \(anthropic\/claude-opus-5-5\) on packets\/P1.json/);
    const again = await withMeteredJudges(base("four", upstream()), (send) => send({ role: "primary", model: models[0]!.id, file: FILE, prompt, attempt: 1 }));
    expect(JSON.parse(again.value).packets[0].file).toBe(FILE);
  });

  test("refuses a model the lease was not opened for", async () => {
    await expect(withMeteredJudges(base("five", upstream()), (send) => send({ role: "third", model: ROUTES.A.third, file: FILE, prompt, attempt: 1 }))).rejects.toThrow(/^E_USAGE judge anthropic\/claude-sonnet-5-5 is not one this run opened its lease for/);
  });

  test("refuses to start without the providers' keys, before any lease", async () => {
    await expect(withMeteredJudges({ ...base("six", upstream()), env: { ANTHROPIC_API_KEY: "x" } }, async () => 1)).rejects.toThrow(/^E_KEY_MISSING the judges need OPENROUTER_API_KEY and OPENAI_API_KEY/);
    expect(existsSync(join(dir, "six"))).toBe(false);
  });
});

describe("the judge item's dry run", () => {
  test("opens and settles one lease of geva-562-judge at its $80 cap on a temporary ledger", () => {
    const r = judgeItemDryRun("geva-562-judge-dry-run");
    expect(r).toMatchObject({ item: "geva-562-judge", cap: "$80.00", committed: "$0.00" });
    expect(r.settled).toMatch(/ at \$0\.00$/);
    expect(r.lease_id).toBeTruthy();
  });
});
