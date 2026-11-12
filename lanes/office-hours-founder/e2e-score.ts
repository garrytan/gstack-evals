// Copyright (c) 2026 Garry Tan. MIT License.
// The scoring half of the keyless end to end (the Captain's phase 1 requirement): after the run area's e2e has run its
// fixture founders through the real rig, proxy, ledger and session loop with the real simulator, this step completes
// each row with the scoring area's reads, builds stage 1's blind label packets, labels them through the metered judge
// client on a ledger item of its own (a stub model server answers in each provider's shape), and scores every session.
// The keys are invented for the two fixture founders and are never eval units.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { openJudge } from "../product-value/judge.ts";
import { SEED } from "./frozen.ts";
import type { Check } from "./run/e2e.ts";
import { readRows } from "./run/rows.ts";
import type { RunResult } from "./run/run.ts";
import { stubCaller } from "./score/fixtures.ts";
import { judgePackets } from "./score/judge.ts";
import { buildLabelPackets } from "./score/packets.ts";
import { scoreSessions, stockCredits, type ScoreUnit } from "./score/score.ts";
import type { Key, Sheet, UnitMeta } from "./types.ts";
import { completeRow } from "./wire.ts";

const D = 1_000_000;

export const FIXTURE_KEYS: Readonly<Record<string, Key>> = {
  "fx-answer": { customer: "garden leads", wedge: "shift reminders", first_move: "Ask both garden leads to pay", pivot: "none", key_facts: ["f1", "f3"], mentioned: [], alternative: { customer: "city parks offices", wedge: "a volunteer social network" } },
  "fx-never": { customer: "library staff", wedge: "a seat count for the library front page", first_move: "Offer the library staff a seat count", pivot: "none", key_facts: ["g1", "g2"], mentioned: [] },
};

/** A stub model server in each judge provider's response shape, answering with the scoring area's stub judge. */
function stubJudges(): typeof fetch {
  const judge = stubCaller();
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    const who = u.includes("anthropic") ? "opus" : u.includes("openrouter") ? "gemini" : "astra";
    const text = (await judge({ judge: who, prompt, effort: "medium", maxTokens: 0, label: "e2e:1" })).text ?? "";
    if (who === "opus") return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5-stub", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    if (who === "gemini") return Response.json({ id: "gen-1", model: "google/gemini-4-argon-stub", provider: "Google", choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });
    return Response.json({ id: "resp_1", object: "response", model: "gpt-6-astra-stub", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } });
  }) as typeof fetch;
}

export async function scoreE2e(o: { run: RunResult; out: string; unitsDir: string }): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ check: name, ok, detail });
    console.log((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  const units = new Map<string, ScoreUnit>();
  for (const [id, key] of Object.entries(FIXTURE_KEYS)) {
    const meta = JSON.parse(readFileSync(join(o.unitsDir, id, "unit.json"), "utf8")) as UnitMeta;
    units.set(id, { key, meta: { ...meta, primary: ["customer", "wedge"] }, sheet: JSON.parse(readFileSync(join(o.unitsDir, id, "sheet.json"), "utf8")) as Sheet });
  }
  const rows = [...readRows(o.out).values()].map((l) => completeRow(l, units.get(l.row.unit)!.meta));
  const oh = rows.find((r) => r.arm === "office-hours");
  check("the scoring reads fill every row: exposure on the office-hours session only, counters on all", rows.length === 4 && rows.every((r) => Number.isInteger(r.questions) && Number.isInteger(r.pushes) && (r.exposure !== null) === (r.arm === "office-hours")), rows.map((r) => r.arm + " q" + r.questions + " p" + r.pushes).join(", "));
  check("the exposure detector saw the office-hours session read phase-2a and ask two questions", oh?.exposure?.load === true && oh.questions === 2, oh ? JSON.stringify(oh.exposure) : "no row");
  const built = buildLabelPackets({ stage: 1, seed: SEED, units, rows });
  const roles = Object.values(built.map.packets).map((p) => p.role);
  check("stage 1 packets: one label packet with both blocks, a shuffled-key packet and the anchor packets, each with the stock rows", roles.filter((r) => r === "label").length === 1 && roles.includes("shuffled") && roles.includes("anchor") && built.packets.every((p) => p.blocks.length >= 3), roles.join(", "));
  const W = mkdtempSync(join(homedir(), ".capy", "work", "of-e2e-labels-"));
  try {
    const record = join(W, "record");
    const ledger = join(W, "ledger.sqlite");
    const item = "of-e2e-labels";
    recordApproval(record, { action: "init", item, cap_micros: 5 * D, quotes: [{ words: "keyless end-to-end labels on a temporary ledger, not an approval", by: "of e2e", source: "lanes/office-hours-founder/e2e-score.ts" }], admission: "warn" });
    const j = await openJudge({ item, runId: "of-e2e-labels", out: join(W, "out"), cacheDir: join(W, "cache"), record, ledger, env: { OPENAI_API_KEY: "stub-not-a-key", ANTHROPIC_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" }, fetch: stubJudges(), io: { out: () => {}, err: (t) => console.error(t) } });
    let labels;
    try {
      labels = (await judgePackets({ map: built.map, packets: new Map(built.packets.map((p) => [p.id, p])), call: j.call, concurrency: 1 })).labels;
    } finally {
      await j.close();
    }
    const it = readItem(record, item);
    check("one lease opened and settled on the labels item, through the metered judge client", it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null, it.leases.length + " opened, spent " + (it.leases[0]?.close?.spent_micros ?? "?") + " micros");
    const scored = scoreSessions({ rows, units, maps: [built.map], labels });
    const w = (unit: string, arm: string, kind = "arm") => scored.find((s) => s.unit === unit && s.arm === arm && s.kind === kind)?.W;
    check("W: both fx-answer blocks credited, fx-never's no-block and the pitch session's no-block score 0", w("fx-answer", "none") === 1 && w("fx-answer", "office-hours") === 1 && w("fx-never", "none") === 0 && w("fx-never", "lens", "pitch") === 0, scored.map((s) => s.kind + "/" + s.arm + "/" + s.unit + " W=" + s.W).join(", "));
    const stock = stockCredits({ units, maps: [built.map], labels });
    check("no stock row is credited on the fixture keys", stock.length > 0 && stock.every((s) => s.W === 0), stock.length + " stock readings");
  } finally {
    rmSync(W, { recursive: true, force: true });
  }
  return checks;
}
