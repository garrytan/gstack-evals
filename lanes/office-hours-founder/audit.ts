// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals of audit and of arm-guess: the two judge runs over finished sessions that no other command holds.
// - audit (prereg section 4): the fidelity audit of one stage's simulated founder. It draws founder turns from the
//   stage's launches (sim/fidelity.ts drawAudit), sends each to Astra and Opus at maximum effort on one ledger item, and
//   writes the outcome stage1 and stage2 read. Each auditor sees the founder's sheet with the rules in force, the
//   advisor's message the turn answered (that reply's main-agent texts joined by blank lines, as the simulator saw it)
//   and the founder's reply. An unreadable answer is resent once with a fixed line added, so the meter's reply cache
//   can't answer the resend with the same unreadable text.
// - arm-guess (section 7, descriptive): Astra guesses which of the three setups wrote each of 30 stage 2 blocks drawn in
//   seeded order, at medium effort, and the command prints the count right over the count asked; stage2 reads it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { openMeter, type ModelKey } from "../product-value/meter.ts";
import { shuffle } from "../product-value/stats.ts";
import { insideRepo } from "../review-noloss/suite.ts";
import { SEED } from "./frozen.ts";
import { renderBlock, replies } from "./parse.ts";
import { readRows, type RowLine } from "./run/rows.ts";
import { entryId } from "./run/manifest.ts";
import { AUDIT_EFFORT, auditOutcome, drawAudit, repairRecord, runAudit, type AuditorKey } from "./sim/fidelity.ts";
import { FOUNDER_RULES } from "./sim/founder.ts";
import type { Sheet } from "./types.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Env = Record<string, string | undefined>;

const usage = (why: string): never => {
  throw Object.assign(new Error(why), { code: "E_USAGE" });
};
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** The output cap of one auditor or guesser call; the prereg leaves it open, and reasoning at maximum effort counts in it. */
export const AUDIT_MAX_TOKENS = 16_000;
export const GUESS_MAX_TOKENS = 4_000;
export const GUESSES = 30;
/** The fixed line a resend adds, so the reply cache can't answer it with the same text. */
export const RESEND = "Answer with the JSON object alone.";

function flags(argv: readonly string[], one: readonly string[], many: readonly string[], bool: readonly string[] = []): Map<string, string[]> {
  const f = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (bool.includes(a)) f.set(a, []);
    else if (one.includes(a) || many.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) usage(a + " needs a value");
      if (one.includes(a) && f.has(a)) usage(a + " is given once");
      f.set(a, [...(f.get(a) ?? []), v!]);
    } else usage("unknown argument " + JSON.stringify(a));
  }
  return f;
}

function outside(flag: string, p: string): string {
  const abs = resolve(p);
  if (insideRepo(abs)) usage(flag + " " + abs + " is inside the repo, and sealed material stays outside it");
  return abs;
}

/** Every launch's rows, refusing a session that appears in two launches. */
function launchRows(launches: readonly string[]): RowLine[] {
  const seen = new Map<string, string>();
  const out: RowLine[] = [];
  for (const l of launches) {
    for (const [id, line] of readRows(l)) {
      if (seen.has(id)) usage("session " + id + " is in both " + seen.get(id) + " and " + l);
      seen.set(id, l);
      out.push(line);
    }
  }
  return out;
}

async function meterFor(f: Map<string, string[]>, env: Env, out: string, maxOutputTokens: number) {
  const cap = Math.round(Number(f.get("--spend-cap")![0]) * 1_000_000);
  if (!(cap > 0)) usage("--spend-cap must be a positive number of dollars");
  const runFile = out + ".run.json";
  const runId = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string }).run_id : "of-" + sha256(out + Date.now()).slice(0, 12);
  writeFileSync(runFile, JSON.stringify({ run_id: runId }) + "\n");
  return openMeter({ item: f.get("--item")![0]!, runId, out: out + ".meter", cacheDir: out + ".cache", maxOutputTokens, amountMicros: cap, record: recordPath(f.get("--record")?.[0], env).path, ledger: ledgerPath(f.get("--ledger")?.[0], env).path, env });
}

const AUDIT_USAGE = "gstack-evals of audit --stage 1|2 --launch <out dir>... --units <dir> --item <item> --spend-cap <usd> --out <outcome.json> [--sim-rules <file>] [--record <dir>] [--ledger <path>]";

export async function audit(argv: string[], io: Io, env: Env): Promise<number> {
  const f = flags(argv, ["--stage", "--units", "--item", "--spend-cap", "--out", "--sim-rules", "--record", "--ledger"], ["--launch"]);
  for (const k of ["--stage", "--launch", "--units", "--item", "--spend-cap", "--out"]) if (!f.has(k)) usage("of audit needs " + k + "; usage: " + AUDIT_USAGE);
  const stage = Number(f.get("--stage")![0]);
  if (stage !== 1 && stage !== 2) usage("--stage takes 1 or 2");
  const units = outside("--units", f.get("--units")![0]!);
  const out = outside("--out", f.get("--out")![0]!);
  if (existsSync(out)) usage(out + " exists; an audit outcome is written once");
  const launches = f.get("--launch")!.map((l) => outside("--launch", l));
  const rules = f.has("--sim-rules") ? readFileSync(f.get("--sim-rules")![0]!, "utf8") : FOUNDER_RULES;
  const repair = f.has("--sim-rules") ? repairRecord(rules) : null;
  const lines = launchRows(launches).filter((l) => l.row.stage === stage);
  const byId = new Map(lines.map((l) => [entryId(l.row), l]));
  const draw = drawAudit(stage as 1 | 2, lines.map((l) => l.row));
  io.out("of audit: stage " + stage + ", " + draw.turns + " founder turns, " + draw.drawn.length + " drawn, read " + draw.read);
  mkdirSync(dirname(out), { recursive: true });
  if (draw.read === "no-read") {
    const outcome = auditOutcome({ draw, result: null, repair });
    writeFileSync(out, JSON.stringify(outcome, null, 2) + "\n");
    if (outcome.read !== "pass") io.err(outcome.code + " of audit: " + outcome.detail);
    return 0;
  }
  const sheets = new Map<string, Sheet & { opening: string }>();
  const sheetOf = (unit: string) => {
    if (!sheets.has(unit)) sheets.set(unit, { ...(JSON.parse(readFileSync(join(units, unit, "sheet.json"), "utf8")) as Sheet), opening: readFileSync(join(units, unit, "opening.md"), "utf8").trim() });
    return sheets.get(unit)!;
  };
  const transcripts = new Map<string, string[][]>();
  const meter = await meterFor(f, env, out, AUDIT_MAX_TOKENS);
  const call = (model: ModelKey) => {
    const asked = new Set<string>();
    return async (prompt: string): Promise<string> => {
      const resend = asked.has(prompt);
      asked.add(prompt);
      const r = await meter.call({ model, prompt: resend ? prompt + "\n\n" + RESEND : prompt, maxTokens: AUDIT_MAX_TOKENS, effort: AUDIT_EFFORT, label: "audit:" + model });
      return r.text ?? "";
    };
  };
  let result;
  try {
    result = await runAudit({
      draw,
      auditors: { astra: call("astra"), opus: call("opus") } satisfies Record<AuditorKey, (p: string) => Promise<string>>,
      input: (t) => {
        const id = entryId(t.session);
        const line = byId.get(id);
        if (!line?.transcript) usage("session " + id + " has no transcript to audit");
        if (!transcripts.has(id)) transcripts.set(id, replies(readFileSync(line!.transcript!, "utf8")));
        const s = sheetOf(t.session.unit);
        const turn = line!.row.founder_turns[t.turn - 1]!;
        return { sheet: { rules, persona: s.persona, opening: s.opening, items: s.facts.map((x) => ({ id: x.id, text: x.text, reveal_when: x.reveal_when })) }, last: transcripts.get(id)![t.turn - 1]!.join("\n\n"), reply: turn.reply };
      },
    });
  } finally {
    const closed = await meter.close();
    io.out("of audit: settled " + (closed.spent_micros / 1e6).toFixed(4) + " dollars on " + f.get("--item")![0]);
  }
  const outcome = auditOutcome({ draw, result, repair });
  const { turns: _turns, ...summary } = result;
  writeFileSync(out, JSON.stringify({ ...outcome, stage, repair, ...summary }, null, 2) + "\n");
  io.out("of audit: " + result.failing + " of " + result.audited + " turns failed, " + result.disputed.length + " disputed, agreement kappa " + result.agreement.kappa + ", outcome " + outcome.read + ", " + out + " sha256 " + sha256(readFileSync(out, "utf8")));
  if (outcome.read !== "pass") io.err(outcome.code + " of audit: " + outcome.detail);
  return 0;
}

/** The guesser's prompt: the three setups by letter, never by arm name, and one normalized block. */
export function guessPrompt(block: string): string {
  return [
    "A model advised a startup founder in a conversation and closed with the block below. One of three setups produced it:",
    "A. The model got the founder's pitch with a plain request for advice.",
    "B. The model got the same request plus one line naming an idea about how founders should find their first customers.",
    "C. The model ran a structured office-hours procedure that asks the founder a set of forcing questions before advising.",
    "Which setup produced this block? Answer with one JSON object, {\"setup\": \"A\"}, {\"setup\": \"B\"} or {\"setup\": \"C\"}, and nothing else.",
    "",
    block,
  ].join("\n");
}
const LETTER = { none: "A", lens: "B", "office-hours": "C" } as const;

const GUESS_USAGE = "gstack-evals of arm-guess --launch <stage2 out dir> --item <item> --spend-cap <usd> --out <guesses.json> [--record <dir>] [--ledger <path>]";

export async function armGuess(argv: string[], io: Io, env: Env): Promise<number> {
  const f = flags(argv, ["--launch", "--item", "--spend-cap", "--out", "--record", "--ledger"], []);
  for (const k of ["--launch", "--item", "--spend-cap", "--out"]) if (!f.has(k)) usage("of arm-guess needs " + k + "; usage: " + GUESS_USAGE);
  const out = outside("--out", f.get("--out")![0]!);
  if (existsSync(out)) usage(out + " exists; the guesses are written once");
  const pool = launchRows([outside("--launch", f.get("--launch")![0]!)]).filter((l) => l.row.stage === 2 && l.row.kind === "arm" && l.row.block !== null).sort((a, b) => (a.id < b.id ? -1 : 1));
  const drawn = shuffle(pool, seededRandom(SEED + 3)).slice(0, GUESSES);
  if (drawn.length < GUESSES) io.err("E_OF_NO_READ of arm-guess: " + drawn.length + " stage 2 blocks, under " + GUESSES + "; the probe reads what there is");
  mkdirSync(dirname(out), { recursive: true });
  const meter = await meterFor(f, env, out, GUESS_MAX_TOKENS);
  const guesses: { session: string; truth: string; guess: string | null }[] = [];
  try {
    for (const l of drawn) {
      const r = await meter.call({ model: "astra", prompt: guessPrompt(renderBlock(l.row.block!)), maxTokens: GUESS_MAX_TOKENS, effort: "medium", label: "arm-guess" });
      const m = /\{\s*"setup"\s*:\s*"([ABC])"\s*\}/.exec(r.text ?? "");
      guesses.push({ session: l.id, truth: LETTER[l.row.arm], guess: m ? m[1]! : null });
    }
  } finally {
    const closed = await meter.close();
    io.out("of arm-guess: settled " + (closed.spent_micros / 1e6).toFixed(4) + " dollars on " + f.get("--item")![0]);
  }
  const correct = guesses.filter((g) => g.guess === g.truth).length;
  writeFileSync(out, JSON.stringify({ asked: guesses.length, correct, unreadable: guesses.filter((g) => g.guess === null).length, guesses }, null, 2) + "\n");
  io.out("of arm-guess: " + correct + "/" + guesses.length + " correct (pass --arm-guess " + correct + "/" + guesses.length + " to of stage2)");
  return 0;
}

export const commands: Record<string, { summary: string; run: (argv: string[], io: Io, env: Env) => Promise<number> }> = {
  audit: { summary: "the fidelity audit of one stage's simulated founder: drawn turns to Astra and Opus at maximum effort, on one ledger item", run: audit },
  "arm-guess": { summary: "Astra guesses which setup wrote each of 30 seeded stage 2 blocks (descriptive), on one ledger item", run: armGuess },
};
