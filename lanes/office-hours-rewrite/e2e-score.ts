// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ohr e2e: the run area's keyless Docker end to end (run/e2e.ts), then one planted scoring pass over its
// rows, so every handoff between the areas runs once on real shapes:
// - the e2e's nine rows (two invented briefs and three arms on Opus, and fx-build's three arms on Sol in Codex CLI) get
//   planted keys: fx-build's call and action are the
//   block the stub adviser wrote, fx-t8's are not, and each key's decisive fact is the one the first delivered reply
//   reveals;
// - score: stage 1 label packets, labelled through the wire's metered judge client on a temporary ledger item, with a
//   stub model server answering in each provider's shape (Astra's calls must reach gpt-6.2-astra); the scorer's rows;
// - the judge check: check packets over the same rows plus planted authoring answers, a gold pass at max and the check
//   labels at medium through the same client, and section 12's judge check per judge;
// - read: admission refuses stage 1 without its 8 calibration briefs, and the decision table reads the scored rows.
// Every key variable is removed first; the only key-shaped values are placeholders. Nothing is spent.
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { SEED } from "./frozen.ts";
import { admission } from "./read/admission.ts";
import { decide } from "./read/decision.ts";
import { runE2e, type Check } from "./run/e2e.ts";
import { loadBriefs } from "./run/manifest.ts";
import { readRows } from "./run/rows.ts";
import { judgeCheck } from "./score/check.ts";
import { stubCaller } from "./score/fixtures.ts";
import { judgePackets } from "./score/judge.ts";
import { buildCheckPackets, buildLabelPackets, type Brief, type CheckAnswer } from "./score/packets.ts";
import { scoreSessions, stockCredits } from "./score/score.ts";
import type { Key } from "./types.ts";
import { openWire } from "./wire.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const D = 1_000_000;
const STUB_DECISION = "Demo one live seat sensor on the map before anything else.";
const STUB_ACTION = "You wire the desk sensor to the map by Saturday noon.";

/** Planted keys for the e2e's two invented briefs: fx-build's call is the stub's block, fx-t8's is not. */
export const PLANTED_KEYS: Readonly<Record<string, Key>> = {
  "fx-build": { call: STUB_DECISION, actions: [STUB_ACTION, "Show one judge the live map by Sunday."], decisive: ["g1"], twin: null, traction: false, wrong_call: "Build the full campus map before any demo." },
  "fx-t8": { call: "Stop Plotline and pick a new direction this week.", actions: ["Call the one paying garden by Friday to ask why."], decisive: ["f1"], twin: null, traction: false, wrong_call: "Keep waiting for the spring gardens." },
};

/** A stub model server in each judge provider's shape, answering with the score area's stub judge. Records the model each call named. */
function stubJudges(seen: string[]): typeof fetch {
  const judge = stubCaller();
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push(String(body.model));
    const prompt = String((body.input ?? body.messages)?.[0]?.content ?? "");
    const anthropic = u.includes("anthropic");
    const text = (await judge({ judge: anthropic ? "opus" : "astra", prompt, effort: "medium", maxTokens: 0, label: "e2e" })).text ?? "";
    if (anthropic) return Response.json({ id: "msg_1", type: "message", role: "assistant", model: body.model + "-20261101", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return Response.json({ id: "resp_1", object: "response", model: body.model + "-2026-11-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } });
  }) as typeof fetch;
}

/** Twenty authoring answers per brief, alternating the key's call and action with a wrong call and a stock action, so the check passes its 40-block floor. */
function plantedAnswers(briefs: ReadonlyMap<string, Brief>): CheckAnswer[] {
  return [...briefs.entries()].flatMap(([brief, b]) => Array.from({ length: 20 }, (_, i): CheckAnswer => ({
    brief,
    author: "v" + String(i).padStart(2, "0"),
    source: i % 3 === 0 ? "opening" : "full",
    block: i % 2 === 0 ? { decision: b.key.call, next_action: b.key.actions[0]!, why: "It fits the facts." } : { decision: b.key.wrong_call!, next_action: "Talk to more customers this month.", why: "It might work." },
  })));
}

/** The scoring pass over an e2e launch folder. */
export async function scorePass(o: { out: string; briefsDir: string }): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ check: name, ok, detail });
    console.log((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  const briefs = new Map<string, Brief>(loadBriefs(o.briefsDir).map((meta) => [meta.id, { meta, key: PLANTED_KEYS[meta.id]! }]));
  const all = [...readRows(o.out).values()].map((l) => l.row);
  const rows = all.filter((r) => r.model === "opus");
  check("the e2e's rows reach the scorer: six Opus rows and three Sol rows, every one ended with a block", rows.length === 6 && all.length === 9 && all.filter((r) => r.model === "sol").length === 3 && all.every((r) => r.end === "block" && r.block?.kind === "block"), all.map((r) => r.model + "/" + r.arm + "/" + r.brief + " " + r.end).join(", "));
  const label = buildLabelPackets({ stage: 1, seed: SEED, briefs, rows: all });
  const solBlocks = new Set(Object.values(label.map.packets).filter((p) => p.model === "sol").flatMap((p) => Object.keys(p.blocks)));
  check("stage 1 label packets: one per brief and model, each with its three arms' blocks, three stock rows and a near-miss; Opus's routed to Astra, Sol's to Opus", label.packets.length === 3 && label.packets.every((p) => p.blocks.length === 7) && Object.values(label.map.packets).every((p) => p.judges.join() === (p.model === "sol" ? "opus" : "astra")), Object.values(label.map.packets).map((p) => p.model + " " + p.brief + " to " + p.judges.join()).join(", "));
  const answers = plantedAnswers(briefs);
  const checkBuilt = buildCheckPackets({ seed: SEED, briefs, rows, answers, taken: [label.map] });

  const W = mkdtempSync(join(homedir(), ".capy", "work", "ohr-e2e-score-"));
  const seen: string[] = [];
  try {
    const record = join(W, "record");
    const ledger = join(W, "ledger.sqlite");
    const item = "ohr-e2e-labels";
    recordApproval(record, { action: "init", item, cap_micros: 20 * D, quotes: [{ words: "keyless end-to-end labels on a temporary ledger, not an approval", by: "ohr e2e", source: "lanes/office-hours-rewrite/e2e-score.ts" }], admission: "warn" });
    const io = { out: (t: string) => console.log(t), err: (t: string) => console.error(t) };
    const w = await openWire({ dir: join(W, "wire"), item, capMicros: 20 * D, label: "ohr-e2e-labels", record, ledger, env: { OPENAI_API_KEY: "stub-not-a-key", ANTHROPIC_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" }, io, upstream: stubJudges(seen) });
    let labels, gold, checkLabels;
    try {
      labels = await judgePackets({ map: label.map, packets: new Map(label.packets.map((p) => [p.id, p])), call: w.judge, effort: "medium" });
      const packets = new Map(checkBuilt.packets.map((p) => [p.id, p]));
      gold = await judgePackets({ map: checkBuilt.map, packets, call: w.judge, effort: "max" });
      checkLabels = await judgePackets({ map: checkBuilt.map, packets, call: w.judge, effort: "medium" });
    } finally {
      await w.close("ohr e2e");
    }
    const it = readItem(record, item);
    check("one lease opened and settled on the labels item through the wire's metered judge client", it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null, it.leases.length + " opened, spent " + (it.leases[0]?.close?.spent_micros ?? "?") + " micros");
    const models = [...new Set(seen)].sort();
    check("Astra's calls reached openai's gpt-6.2-astra and Opus's claude-opus-5-5; no call named gpt-6-astra", models.join() === "claude-opus-5-5,gpt-6.2-astra", models.join(", "));
    const solLabels = labels.labels.filter((l) => solBlocks.has(l.block));
    check("Sol's packet was labelled by Opus 5.5 alone", solBlocks.size === 7 && solLabels.length === 7 && solLabels.every((l) => l.judge === "opus"), solLabels.length + " labels by " + [...new Set(solLabels.map((l) => l.judge))].join());
    check("every label cell came back labelled", labels.unlabelled === 0 && gold.unlabelled === 0 && checkLabels.unlabelled === 0, labels.unlabelled + " production, " + gold.unlabelled + " gold, " + checkLabels.unlabelled + " check cells unlabelled");

    const scoredAll = scoreSessions({ rows: all, briefs, maps: [label.map], labels: labels.labels });
    const scored = scoredAll.filter((s) => s.model === "opus");
    const solScored = scoredAll.filter((s) => s.model === "sol");
    const R = (brief: string) => scored.filter((s) => s.brief === brief).map((s) => s.arm + " R1" + s.R1 + " R2" + s.R2 + " R3" + s.R3 + " R" + s.R).join("; ");
    check("scored rows: fx-build's block is the key's call and action (R 1 on all three arms); fx-t8's is not (R2 0, R 0); R1 reads the delivered reveal", scored.length === 6 && scored.filter((s) => s.brief === "fx-build").every((s) => s.R1 === 1 && s.R2 === 1 && s.R3 === 1 && s.R === 1) && scored.filter((s) => s.brief === "fx-t8").every((s) => s.R1 === 1 && s.R2 === 0 && s.R3 === 0 && s.R === 0), R("fx-build") + " | " + R("fx-t8"));
    check("skill-arm rows carry exposure and compliance reads; none-arm rows carry no exposure", scored.every((s) => (s.arm === "none") === (s.exposure === null) && s.compliance !== null), scored.map((s) => s.arm + ":" + (s.exposure ? "exposure" : "none")).join(", "));
    check("Sol's scored rows: fx-build's block is the key's call and action on all three arms (R 1); skill arms carry exposure with the skill read, none carries none", solScored.length === 3 && solScored.every((s) => s.brief === "fx-build" && s.R1 === 1 && s.R2 === 1 && s.R3 === 1 && s.R === 1 && (s.arm === "none") === (s.exposure === null) && (s.arm === "none" || s.exposure?.read_skill === true) && s.compliance !== null), solScored.map((s) => s.arm + " R1" + s.R1 + " R2" + s.R2 + " R3" + s.R3 + " R" + s.R + " " + (s.exposure ? "exposure, read " + s.exposure.read_skill : "no exposure")).join("; "));
    const stock = stockCredits([label.map], labels.labels);
    check("no stock row credited in the production packets", stock.rows === 9 && stock.credited === 0 && stock.unlabelled === 0, stock.rows + " stock rows, " + stock.credited + " credited");

    for (const judge of ["astra", "opus"] as const) {
      const r = judgeCheck({ map: checkBuilt.map, gold: gold.labels, labels: checkLabels.labels.filter((l) => l.judge === judge), judge });
      const realOnly = r.reasons.length > 0 && r.reasons.every((x) => /real/.test(x));
      check(judge + "'s judge check on planted gold: kappa 1 overall, near-miss 1, no stock credited, and NO READ only because six real blocks cannot reach 10 gold cells of each class", r.verdict === "NO READ" && r.code === "E_OHR_JUDGE_CHECK_NO_READ" && r.kappa === 1 && r.near_miss === 1 && r.stock_credited === 0 && r.outputs >= 40 && r.blocks >= 40 && realOnly, r.verdict + ", " + r.outputs + " outputs from " + r.blocks + " blocks, kappa " + r.kappa + ", real " + r.kappa_real + ", near-miss " + r.near_miss + "; " + r.reasons.join("; "));
    }

    let refused = "";
    try {
      admission({ rows: scoredAll, sessions: all, audit: { pass: true }, judges: { astra: true, opus: true }, label_usd: 0.06 });
    } catch (e) {
      refused = (e as Error).message;
    }
    check("admission takes the scored rows and the run rows, and refuses stage 1 without its 8 calibration briefs", /^E_OHR_READ_INPUT/.test(refused), refused.split("\n")[0] || "no refusal");
    const stage2 = scoredAll.map((s) => ({ ...s, stage: 2 as const, set: "comparison" as const }));
    const d = decide({ rows: stage2, admission: "admitted", stops: [], judge_checks: { astra: false, opus: false }, hand_reads: stage2.filter((s) => s.arm === "new" && (s.kept_whole?.startup_only.length ?? 0) > 0).map((s) => ({ brief: s.brief, model: s.model, confirmed: false })) });
    check("the decision table reads the scored rows: row 1, INCOMPLETE, since the judge checks did not pass", d.row === 1 && d.outcome === "INCOMPLETE" && d.conditions.row1.judge_check_failed, "row " + d.row + " " + d.outcome + ", new minus current " + d.contrasts.new_current.estimate);
  } finally {
    rmSync(W, { recursive: true, force: true });
  }
  return checks;
}

export async function run(argv: string[], io: Io): Promise<number> {
  for (const a of argv) if (a !== "--keep") throw Object.assign(new Error("unknown argument " + JSON.stringify(a) + "; usage: gstack-evals ohr e2e [--keep]"), { code: "E_USAGE" });
  const e = await runE2e({ keep: true, log: (l) => io.err(l) });
  if (e.skipped) {
    io.err("E_OHR_E2E_FAIL ohr e2e: SKIP, Docker does not answer here; a skipped end to end is not a pass");
    return 2;
  }
  let checks = e.checks;
  try {
    if (e.dir && e.checks.some((c) => c.check === "the launch ran" && c.ok)) checks = [...checks, ...(await scorePass({ out: join(e.dir, "out"), briefsDir: join(e.dir, "briefs") }))];
  } finally {
    if (e.dir && !argv.includes("--keep")) rmSync(e.dir, { recursive: true, force: true });
  }
  const failed = checks.filter((c) => !c.ok);
  io.out("ohr e2e: " + (checks.length - failed.length) + " PASS, " + failed.length + " FAIL");
  if (failed.length) io.err("E_OHR_E2E_FAIL ohr e2e: " + failed.map((c) => c.check).join("; "));
  return failed.length ? 2 : 0;
}
