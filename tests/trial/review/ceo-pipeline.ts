// Keyless fixtures for gstack-evals ceo and noloss judge-run --ceo: a sealed units dir, review-units run dirs (the
// journal, stops.json, units.json and each session's transcript.ndjson) and a stub judge that answers through the metering
// proxy. Every review word here is synthetic and carries CANARY, so a test can show no command prints review text.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeRunCmd } from "../../../lanes/review-noloss/judge-run.ts";
import { ScoreError } from "../../../lanes/review-noloss/score.ts";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { main } from "../../../src/trial/review/ceo-cli.ts";
import { CEO_PARSER_SHA256 } from "../../../src/trial/review/ceo-outcome.ts";

export const ROOT = join(import.meta.dir, "../../..");
export const CANARY = "CANARYq7Zp";
export const FENCE = "\x60\x60\x60";
export const BRIEF = join(ROOT, "wiki/plans/2026-11-05-geva-295-ceo-ladder-amendment/judge-brief.md");
export const SCORER = join(ROOT, "wiki/plans/2026-11-05-geva-300-ceo-stop-label-amendment/ceo-rule.ts.txt");
export const MODEL: Record<string, string> = { opus: "anthropic/claude-opus-5-5", sol: "openai/gpt-6.1-sol", particle: "openrouter/particle-ai/particle-1" };
export const JUDGES = { sol: "openai/gpt-6.1-sol", opus: "anthropic/claude-opus-5-5", sonnet: "anthropic/claude-sonnet-5-5" };
export const U1 = "acme/widget#11";
export const U2 = "acme/widget#12";
export const U3 = "acme/tools#13";
const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value-for-ceo-tests", OPENAI_API_KEY: "fake-openai-value-for-ceo-tests", OPENROUTER_API_KEY: "fake-openrouter-value-for-ceo-tests" };

export const tmp = (tag: string) => mkdtempSync(join(tmpdir(), "ceo-" + tag + "-"));
const writeJson = (path: string, v: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2) + "\n");
};

const changedKey = (remedy: boolean) => ({ kind: "changed", outcome: "rejected", outcome_date: "2026-09-20", strict: "2026-07-14", category: "scope", role: "maintainer", D: "The plan widens the cache to every request path.", D2: null, match_notes: "Must name the request-path cache.", R1: "No eviction bound.", R2: null, R3: null, remedy: remedy ? "Cache only the profile reads." : null, remedy_notes: remedy ? "Must name the profile reads." : null, remedy_kind: remedy ? "scope" : null, decoy: remedy ? "R1" : null, second_order: false, pointers: ["https://github.com/acme/widget/issues/1"] });
const heldKey = { kind: "held", outcome: "held", outcome_date: "2026-09-21", strict: "2026-07-20", category: "held", role: "outside", D: null, D2: null, match_notes: null, R1: null, R2: null, R3: null, remedy: null, remedy_notes: null, remedy_kind: null, decoy: null, second_order: false, pointers: ["https://github.com/acme/tools/issues/2"] };

/** The sealed units dir: U1 changed with a keyed remedy, U2 changed without one, U3 held. */
export function unitsDir(root: string): string {
  const dir = join(root, "units");
  for (const [id, key] of [[U1, changedKey(true)], [U2, changedKey(false)], [U3, heldKey]] as const) {
    writeJson(join(dir, id.replaceAll("/", "__"), "key.json"), key);
    writeFileSync(join(dir, id.replaceAll("/", "__"), "plan.md"), "# Plan for " + id + "\n\nCache every request path.\n");
  }
  return dir;
}

const pad = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
/** A closing block's items: rank 1 runs past 40 words with a tab and a no-break space, rank 2 has no fix, a 4th item sometimes. */
export const items = (tag: string, four = false) => [
  { issue: CANARY + " DECISIVE " + tag + " the cache\tgrows\u00a0without a bound " + pad(40), evidence: "plan.md line 3", fix: CANARY + " REMEDY cache only the profile reads " + pad(45) },
  { issue: CANARY + " second\n issue " + tag, evidence: null, fix: "" },
  { issue: CANARY + " third issue " + tag, evidence: { line: 4 }, fix: CANARY + " a fix for the third" },
  ...(four ? [{ issue: CANARY + " fourth issue " + tag, evidence: "x", fix: "y" }] : []),
];

type Msg = Record<string, unknown>;
let toolN = 0;
const say = (text: string): Msg => ({ type: "assistant", message: { content: [{ type: "text", text }] }, parent_tool_use_id: null });
const call = (name: string, input: Msg, result: string): Msg[] => {
  const id = "toolu_" + ++toolN;
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] }, parent_tool_use_id: null },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: false }] }, parent_tool_use_id: null },
  ];
};
/** A transcript whose own closing block differs from the journal's stored parse, so a reparse would show. */
const TRANSCRIPT_BLOCK = FENCE + "ceo-outcome\n" + JSON.stringify({ top: [{ issue: "TRANSCRIPTONLY issue", evidence: "x", fix: "TRANSCRIPTONLY fix" }], forecast: 5 }) + "\n" + FENCE;
export function transcript(arm: string, exposed = true): string {
  const parts: Msg[] = [];
  if (arm === "gstack-forced") {
    parts.push(...call("Read", { file_path: "/work/agent/.claude/skills/gstack/plan-ceo-review/sections/review-sections.md" }, "     1\t# Review Sections\n"));
    if (exposed) parts.push(say("Step 0E: I pick HOLD SCOPE."));
  }
  if (arm === "gstack-auto") {
    parts.push(...call("Bash", { command: '~/.claude/skills/gstack/bin/gstack-ceo-mode-handoff "HOLD SCOPE" --ceo-only --decisions "none"' }, "Auto-selected review mode \u2192 HOLD SCOPE (CEO-only run: Step 0E's rule). Approved decisions: none."));
    if (exposed) parts.push(...call("Write", { file_path: "/work/agent/.gstack/projects/demo/autoplan-run-1/ceo-review.md", content: "# CEO-only review\n## Findings\n- High: no bound.\n" }, "File created successfully"));
  }
  parts.push(say("Review done.\n\n" + TRANSCRIPT_BLOCK));
  return parts.map((m) => JSON.stringify(m)).join("\n") + "\n";
}

export interface Session {
  model: "opus" | "sol" | "particle";
  arm: "none" | "lens" | "gstack-auto" | "gstack-forced";
  unit: string;
  pass: number;
  how?: "scored" | "no-block" | "gap" | "stopped" | "unexposed";
  four?: boolean;
}
export const TASK: Record<string, string> = { [U1]: "u-11", [U2]: "u-12", [U3]: "u-13" };
export const sessionDir = (run: string, s: Session) => join(run, "runs", MODEL[s.model]!.replaceAll("/", "_"), s.arm, TASK[s.unit]!, "p" + s.pass, "host");

/** One journal line as run.ts writes it, with only the fields rows reads filled in. */
export function entry(s: Session): Record<string, any> {
  const how = s.how ?? "scored";
  const scored = how === "scored" || how === "unexposed";
  const termination = how === "gap" ? { kind: "infra" } : { kind: "completed" };
  const parse = scored ? { kind: "block", top: items(s.arm + " " + s.model + " " + s.unit + " p" + s.pass, s.four), forecast: 40, body_sha256: "0".repeat(64) } : { kind: "missing" };
  return { cell: { model: MODEL[s.model], arm: s.arm, unit: s.unit, pass: s.pass }, key: { sha256: "0".repeat(64), parts: {} }, meter_id: "m", record: { termination, model_output: how !== "no-block", cost_micros: 2_500_000 }, parse, cost: null, ceo_mode: null, ceo_outcome: { parser_sha256: CEO_PARSER_SHA256, end_state: scored ? "scored" : how, follow_up: how === "no-block", wall_s: 900, usd: 2.5 } };
}

/** A review-units out dir: cells.ndjson, stops.json (stopped sessions), units.json and every journaled session's transcript. */
export function runDir(root: string, name: string, sessions: Session[], edit: (e: Record<string, any>) => void = () => {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const lines = sessions.filter((s) => s.how !== "stopped").map((s) => {
    const e = entry(s);
    edit(e);
    mkdirSync(sessionDir(dir, s), { recursive: true });
    writeFileSync(join(sessionDir(dir, s), "transcript.ndjson"), transcript(s.arm, s.how !== "unexposed"));
    return JSON.stringify(e);
  });
  writeFileSync(join(dir, "cells.ndjson"), lines.join("\n") + (lines.length ? "\n" : ""));
  const stopped = sessions.filter((s) => s.how === "stopped");
  writeJson(join(dir, "stops.json"), { schema_version: 1, stops: stopped.length ? [{ code: "CAP_STOP", message: "cap", cells: stopped.map((s) => ({ model: MODEL[s.model], arm: s.arm, unit: s.unit, pass: s.pass, how: "stopped", usd: 1.75, wall_s: 600 })) }] : [] });
  writeJson(join(dir, "units.json"), { schema_version: 1, units: Object.entries(TASK).map(([id, task]) => ({ id, task })) });
  return dir;
}

/** Stage 1's smoke: both gstack arms on every model, on U1 and U2, pass 1. */
export const SMOKE: Session[] = (["opus", "sol", "particle"] as const).flatMap((model) => (["gstack-auto", "gstack-forced"] as const).flatMap((arm) => [U1, U2].map((unit) => ({ model, arm, unit, pass: 1 }))));
/** Stage 1's none cells: Opus 3 passes, Sol and particle-1 2, on every unit; one no-block, one gap, one cap-stopped session. */
export const STAGE1_NONE: Session[] = (["opus", "sol", "particle"] as const).flatMap((model) => [U1, U2, U3].flatMap((unit) => Array.from({ length: model === "opus" ? 3 : 2 }, (_, i) => {
  const s: Session = { model, arm: "none", unit, pass: i + 1, four: unit === U1 && i === 0 };
  if (model === "sol" && unit === U2 && i === 1) s.how = "no-block";
  if (model === "opus" && unit === U3 && i === 2) s.how = "gap";
  if (model === "particle" && unit === U3 && i === 1) s.how = "stopped";
  return s;
})));
/** Stage 2 under PROJECTION: none, gstack-auto, gstack-forced and lens on Opus, none on Sol and particle-1; 2 passes, 1 on the held unit. */
export const STAGE2: Session[] = [
  ...(["none", "gstack-auto", "gstack-forced", "lens"] as const).map((arm) => ["opus", arm] as const),
  ["sol", "none"] as const,
  ["particle", "none"] as const,
].flatMap(([model, arm]) => [U1, U2, U3].flatMap((unit) => Array.from({ length: unit === U3 ? 1 : 2 }, (_, i) => ({ model, arm, unit, pass: i + 1 }) as Session)));
export const PROJECTION = "Projection: PASS at 'every cell'; record these caps; cells: none:opus, autoplan-ceo:opus, standalone:opus, lens:opus, none:sol, none:particle; held passes 1\nPrimary: hit@3 (stage 1 HEADROOM); G_R form rem\n";

export interface Ran {
  code: number;
  out: string;
  err: string;
}
/** gstack-evals ceo in process. */
export async function ceo(argv: string[]): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** The stub judge's answers: D on an issue that says DECISIVE, R1 on rank 2, none elsewhere; rem yes on a fix that says REMEDY. */
export type Reply = (model: string, file: string, packet: any, attempt: number) => string;
export const dBlock = (lines: unknown[]) => FENCE + "ceo-judge\n" + lines.map((l) => JSON.stringify(l)).join("\n") + "\n" + FENCE + "\n";
export const remBlock = (lines: unknown[]) => FENCE + "ceo-judge-rem\n" + lines.map((l) => JSON.stringify(l)).join("\n") + "\n" + FENCE + "\n";
export const honest: Reply = (_m, _f, packet) =>
  packet.read === "D"
    ? dBlock(packet.reviews.map((r: any) => ({ review: r.review, labels: r.issues.map((t: string, i: number) => (t.includes("DECISIVE") ? "D" : i === 1 ? "R1" : "none")), leak: "no" })))
    : remBlock(packet.reviews.map((r: any) => ({ review: r.review, rem: r.issues.map((x: any) => (x.fix.includes("REMEDY") ? "yes" : "no")) })));

export type Sent = { model: string; file: string; body: any };
/** A fake provider behind the metering proxy, in each route's response shape; status gives an HTTP error instead. */
export const upstream = (sent: Sent[], reply: Reply, status: (model: string, file: string) => number = () => 200) => async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const prompt: string = (body.input ?? body.messages)[0].content;
  const file = /=== Packet: (\S+) ===/.exec(prompt)![1]!;
  const packet = JSON.parse(prompt.split("=== Packet: " + file + " ===\n")[1]!);
  sent.push({ model: body.model, file, body });
  const code = status(body.model, file);
  if (code !== 200) return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: code, headers: { "content-type": "application/json" } });
  const text = reply(body.model, file, packet, sent.filter((s) => s.model === body.model && s.file === file).length);
  return body.input
    ? Response.json({ id: "r", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 0 } } })
    : Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } });
};

/** A ledger record with one approved item per name, for judge-run's lease. */
export function ledger(root: string, names: string[]): { record: string; db: string } {
  const record = join(root, "approvals.jsonl");
  for (const item of names) recordApproval(record, { action: "init", item, cap_micros: 100_000_000, quotes: [{ words: "Approve the keyless test cap", by: "test", source: "tests/trial/review/ceo-pipeline.ts" }], admission: "warn" });
  return { record, db: join(root, "ledger.sqlite") };
}

/** noloss judge-run --ceo in process; a refusal comes back as code 2 with its code and message on err. */
export async function judgeRun(argv: string[], fetch?: (url: string, init: RequestInit) => Promise<Response>): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  try {
    const code = await judgeRunCmd(["--ceo", ...argv], { out: (t) => out.push(t), err: (t) => err.push(t) }, { env: KEYS, fetch, sleep: async () => {} });
    return { code, out: out.join("\n"), err: err.join("\n") };
  } catch (e) {
    if (e instanceof ScoreError) return { code: 2, out: out.join("\n"), err: [...err, e.code + " " + e.message].join("\n") };
    throw e;
  }
}

/** The whole keyless pipeline for one stage: rows, packets, the three judges through judge-run --ceo, readings. */
export async function pipeline(root: string, stage: 1 | 2, runs: string[], o: { reply?: Reply; projection?: string } = {}) {
  const units = join(root, "units");
  const log: Ran[] = [];
  const step = (r: Ran) => (log.push(r), r);
  const proj = o.projection ? ["--projection", o.projection] : [];
  const rows = join(root, "rows-" + stage + ".json");
  step(await ceo(["rows", "--stage", String(stage), "--units", units, ...runs.flatMap((r) => ["--run", r]), ...proj, "--out", rows]));
  step(await ceo(["rows", "--stage", String(stage), "--units", units, ...runs.flatMap((r) => ["--run", r]), ...proj, "--checks"]));
  const packets = join(root, "packets-" + stage);
  const key = join(root, "key-" + stage + ".json");
  step(await ceo(["packets", "--rows", rows, "--units", units, "--seed", "7", "--out", packets, "--key", key]));
  const names = (["sol", "opus", "sonnet"] as const).map((j) => j + "-" + stage);
  const { record, db } = ledger(root, names);
  const sent: Sent[] = [];
  const dirs: Record<string, string> = {};
  for (const j of ["sol", "opus", "sonnet"] as const) {
    dirs[j] = join(root, "judge-" + j + "-" + stage);
    const args = ["--packets", packets, "--key", key, "--brief", BRIEF, "--judge", JUDGES[j], "--item", j + "-" + stage, "--out", dirs[j]!, "--ledger", db, "--record", record];
    step(await judgeRun([...args.slice(0, -6), "--out", join(root, "dry-" + j + "-" + stage), "--ledger", db, "--record", record, "--dry-run"]));
    step(await judgeRun(args, upstream(sent, o.reply ?? honest)));
  }
  const readings = join(root, "readings-" + stage + ".json");
  step(await ceo(["readings", "--rows", rows, "--key", key, "--sol", dirs.sol!, "--opus", dirs.opus!, "--sonnet", dirs.sonnet!, "--units", units, ...proj, "--out", readings]));
  return { rows, packets, key, dirs, readings, log, sent };
}
