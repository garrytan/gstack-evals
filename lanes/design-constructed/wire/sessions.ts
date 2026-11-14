// Copyright (c) 2026 Garry Tan. MIT License.
// dc sessions: one launch of review sessions for one stage and one model under test, on that stage's runs item. The
// cells come planned in cells.json; they run in the run area's seeded order, at most 8 at once, each through the run
// area's one-retry loop. Each round (a stage 2 unit-pass of 4, or 2 sessions of a stage 1 unit-pass) is admitted on
// the item's lease before its first session, in run order, and settles at its sessions' metered spend once its last
// cell is final. A session gets the frozen setup, a fresh box, the autoplan gate hook and, when the launch names a
// failed smoke rule for its arm, the D1 repair hook. The launch writes every transcript, each attempt's exposure read
// and rows.json for the label passes, and prints the counts. Each unit's folder under --exports holds repo/ (the export,
// its evidence files included), plan.md, context/ and c2.json (the export's C2 record), the three mounts and C2's input.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mainAgentTexts } from "../../../src/trial/review/capped.ts";
import { fail } from "../errors.ts";
import { HARNESS, LEDGER_ITEMS } from "../frozen.ts";
import { $ } from "../money/book.ts";
import type { Admission } from "../money/types.ts";
import { startRule8, type CaptainChoice, type CaptainGo } from "../read/start.ts";
import { isGstackArm, sessionSetup } from "../run/arms.ts";
import { runFilesOf } from "../run/box.ts";
import { autoplanExposure, pdrExposure, type AutoplanReading, type PdrReading } from "../run/detect.ts";
import { gateHook, repairHook, repairOn, stopHandler } from "../run/hooks.ts";
import { cellId, cellOrder, endOf, printArmStopsWithBlock, printMalformedToolCalls, runCell } from "../run/session.ts";
import { gstackRead, replyOf, webResult } from "../run/transcript.ts";
import type { AttemptRecord, Cell, CellOutcome, LoopSeams } from "../run/types.ts";
import { evidenceOpened, normalizeChanges } from "../score/parse.ts";
import type { ReviewRow, ScoreUnit } from "../score/types.ts";
import type { GstackArm, LedgerItemId, Model, SessionKind } from "../types.ts";
import { build, parseBlockFor, termsGuard } from "../wire.ts";
import { readJson, writeJson } from "./json.ts";
import { closeAll, need, oneOf, start, termsFrom, type Row } from "./start.ts";

const MODELS: readonly Model[] = ["opus", "sol", "particle"];
const KINDS: readonly SessionKind[] = ["none", "lens", "plan-design-review", "autoplan", "reference"];

/** One planned cell; smoke marks the stage 1 smoke sessions (gstack arms on the first 6 calibration units). */
export type PlannedCell = Cell & { smoke?: boolean };

/** Start rule 8's record, as the Captain wrote it: the go naming office-hours' twin reading, or the choice after 14 days. */
export interface Rule8Record {
  go: CaptainGo | null;
  choice: CaptainChoice | null;
  pilotPassedAt: string | null;
}

interface Round {
  run: string;
  cells: Cell[];
  admission: Promise<Admission> | null;
  live: Cell[];
  done: number;
  spentUsd: number;
  unknown: boolean;
}

/** An attempt that never started: its round was refused or a stop covers its arm. It reads incomplete. */
const notRun = (kind: SessionKind): AttemptRecord => ({ end: { kind: "cap-stop" }, reply: "", heldBlock: false, webResult: false, gstackRead: false, judged: false, autoplan: kind === "autoplan" ? { gateAnswered: false, approved: false } : null });

export const sessionsRow: Row = async (a, io, env) => {
  const usage = "sessions --stage 1|2 --model opus|sol|particle --cells <cells.json> --units <units.json> --exports <folder of exported units> --terms <terms.json> [--rule8 <rule8.json>] [--repair <repair.json>] --out <new sink folder>";
  const stage = Number(oneOf(a, "--stage", ["1", "2"] as const, usage)) as 1 | 2;
  const model = oneOf(a, "--model", MODELS, usage);
  const planned = readJson<PlannedCell[]>(resolve(need(a, "--cells", usage)), "--cells");
  const units = new Map(readJson<ScoreUnit[]>(resolve(need(a, "--units", usage)), "--units").map((u) => [u.unit.id, u]));
  const exports = resolve(need(a, "--exports", usage));
  const sink = need(a, "--out", usage);
  const terms = termsFrom(a);
  const rule8 = stage === 1 ? readJson<Rule8Record>(resolve(need(a, "--rule8", usage)), "--rule8") : null;
  const repair = a.flags.has("--repair") ? readJson<Partial<Record<GstackArm, 1 | 2>>>(resolve(a.flags.get("--repair")!), "--repair") : {};
  if (!planned.length) fail("E_USAGE", "--cells plans no cell");
  for (const c of planned) {
    if (c.model !== model) fail("E_USAGE", "cell " + cellId(c) + " is on " + c.model + ", not --model " + model);
    if (!KINDS.includes(c.kind)) fail("E_USAGE", "cell " + cellId(c) + " has an unknown kind");
    if (!units.has(c.unit)) fail("E_USAGE", "cell " + cellId(c) + " names a unit outside --units");
  }
  const item = ("dc-stage" + stage + "-" + model) as LedgerItemId;
  const admission = LEDGER_ITEMS[item].admission;
  if (admission.kind !== "sessions") return fail("E_USAGE", item + " does not admit sessions");
  let rule8Line: string | null = null;
  const rules = rule8 ? [(): [string, string] | null => {
    const d = startRule8({ ...rule8, now: env.now().toISOString() });
    rule8Line = d.line + (d.deviation ? " (deviation: " + d.deviation + ")" : "");
    return d.start ? null : ["8", d.line];
  }] : [];
  const launch = await start({ row: "sessions", sink, items: [item], models: [model], terms, scope: { model, subject: model }, rules, record: { stage, model, cells: planned.length, repair } }, env);
  for (const l of launch.lines) io.out(l);
  if (rule8Line) {
    io.out(rule8Line);
    writeJson(join(launch.sink, "rule8.json"), { ...rule8, line: rule8Line });
  }
  mkdirSync(join(launch.sink, "transcripts"));
  const sessions = await build(env.providers, "session", "sessions");
  const c = launch.ledger.controller;
  const guard = termsGuard(c, terms, io.out);
  const parse = parseBlockFor("none");

  const order = cellOrder(planned.map(({ unit, kind, pass }) => ({ unit, kind, model, pass })));
  const groups = new Map<string, Cell[]>();
  for (const cell of order) groups.set(cell.unit + ":p" + cell.pass, [...(groups.get(cell.unit + ":p" + cell.pass) ?? []), cell]);
  const roundOf = new Map<string, Round>();
  for (const [k, cs] of groups)
    for (let i = 0; i < cs.length; i += admission.perRound) {
      const r: Round = { run: "stage" + stage + ":" + model + ":" + k + ":r" + (i / admission.perRound + 1), cells: cs.slice(i, i + admission.perRound), admission: null, live: [], done: 0, spentUsd: 0, unknown: false };
      for (const cell of r.cells) roundOf.set(cellId(cell), r);
    }
  let chain: Promise<unknown> = Promise.resolve();
  const admit = (r: Round): Promise<Admission> => {
    if (r.admission) return r.admission;
    const p = chain.then(async (): Promise<Admission> => {
      r.live = r.cells.filter((cell) => !c.stopFor(item, { model, subject: model, arm: cell.kind, stage: null }));
      if (!r.live.length) return { kind: "stopped", code: "", why: "a stop covers every arm of the round" };
      return c.admitWhenReady(item, () => c.admitRound(item, { run: r.run, model, arms: r.live.map((x) => x.kind) }));
    });
    chain = p.catch(() => {});
    return (r.admission = p);
  };

  const attempts: Array<Record<string, unknown>> = [];
  const lastTranscript = new Map<string, string>();
  const seams: LoopSeams = {
    parse,
    log: io.out,
    reconcile: (cell, attempt) => sessions.reconcile(cell, attempt),
    async session(cell, attempt) {
      const id = cellId(cell);
      const r = roundOf.get(id)!;
      const adm = await admit(r);
      const slot = r.live.indexOf(cell);
      if (adm.kind !== "admitted" || slot < 0) {
        io.out("not run " + id + ": " + (adm.kind === "admitted" ? "a stop covers its arm" : adm.kind + ": " + adm.why));
        return notRun(cell.kind);
      }
      const subId = adm.sub.id;
      const sessionId = r.run + "/" + (slot + 1);
      if (attempt === 1) {
        if (c.sub(subId)?.sessions.find((x) => x.id === sessionId)?.state !== "pending") {
          io.out("not run " + id + ": its session was released by a stop");
          return notRun(cell.kind);
        }
        c.startSession(subId, sessionId);
      }
      const unitDir = join(exports, cell.unit);
      const evidence = cell.kind === "reference" ? units.get(cell.unit)!.evidence.map((p) => ({ path: p, text: readFileSync(join(unitDir, "repo", p), "utf8") })) : [];
      const setup = sessionSetup(cell.kind, model, evidence);
      const planBefore = readFileSync(join(unitDir, "plan.md"), "utf8");
      const planPath = setup.container.cwd + "/plan.md";
      const sb = await sessions.open({ cell, attempt, setup, unitDir, subId });
      try {
        const gate = cell.kind === "autoplan" ? gateHook({ box: sb.box, sinceMs: env.now().getTime(), log: io.out }) : null;
        const rule = isGstackArm(cell.kind) ? (repair[cell.kind] ?? null) : null;
        const detect = (t: string) => (cell.kind === "autoplan" ? autoplanExposure(runFilesOf(sb.box)) : pdrExposure({ transcript: t, planBefore, planAfter: sb.box.read(planPath) }));
        const d1 = repairOn(cell.kind, rule) ? repairHook({ kind: cell.kind, detect, parse, reply: replyOf, log: io.out }) : null;
        const d = await sb.drive(stopHandler({ kind: cell.kind, gate, repair: d1 }));
        await guard(model, d.served);
        if (d.spentUsd === null) r.unknown = true;
        else r.spentUsd += d.spentUsd;
        writeFileSync(join(launch.sink, "transcripts", id + ".a" + attempt + ".ndjson"), d.transcript);
        lastTranscript.set(id, d.transcript);
        const exposure: PdrReading | AutoplanReading | null = cell.kind === "autoplan" ? autoplanExposure(runFilesOf(sb.box)) : cell.kind === "plan-design-review" ? pdrExposure({ transcript: d.transcript, planBefore, planAfter: d.planAfter }) : null;
        const rec: AttemptRecord = {
          end: endOf(d.termination, d.errorSeen),
          reply: replyOf(d.transcript),
          heldBlock: mainAgentTexts(d.transcript).some((t) => parse(t) !== null),
          webResult: webResult(d.transcript),
          gstackRead: gstackRead(d.transcript),
          judged: false,
          autoplan: cell.kind === "autoplan" ? { gateAnswered: (exposure as AutoplanReading).gateRec, approved: (exposure as AutoplanReading).approved } : null,
        };
        attempts.push({ cell: id, attempt, end: rec.end, exposure, repairBlocks: d1?.blocks() ?? 0, gateAnswers: gate?.answered().length ?? 0, spentUsd: d.spentUsd, imageDigest: d.imageDigest });
        return rec;
      } finally {
        await sb.close();
      }
    },
  };

  const settleRound = async (r: Round) => {
    if (++r.done < r.cells.length) return;
    const adm = await r.admission;
    if (adm?.kind !== "admitted" || c.sub(adm.sub.id)?.state !== "in-flight") return;
    const sub = c.sub(adm.sub.id)!;
    const spent = $(r.spentUsd);
    await c.settle(sub.id, r.unknown ? { spentMicros: spent, unknownMicros: Math.max(0, sub.reserveMicros - spent) } : { spentMicros: spent });
    if (!r.unknown) return;
    const figure = await launch.ledger.reconcile(sub.id);
    if (figure !== null) await c.reconcile(sub.id, figure);
    else io.out("held " + r.run + ": an unknown charge stays in flight until the owner's reconcile (PD-18)");
  };

  try {
    const out: CellOutcome[] = new Array(order.length);
    let next = 0;
    const worker = async () => {
      while (next < order.length) {
        const i = next++;
        out[i] = await runCell(order[i]!, seams);
        await settleRound(roundOf.get(cellId(order[i]!))!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(HARNESS.maxSessionsAtOnce, order.length) }, worker));
    const smoke = new Map(planned.map((p) => [cellId({ ...p, model }), p.smoke ?? false]));
    const rows: ReviewRow[] = out.map((o) => {
      const id = cellId(o.cell);
      const list = o.list?.changes ?? null;
      const t = lastTranscript.get(id);
      let opened: string[] | null = null;
      try {
        opened = t === undefined ? [] : evidenceOpened(t, units.get(o.cell.unit)!.evidence);
      } catch {
        opened = null;
      }
      return { session: id, unit: o.cell.unit, model, kind: o.cell.kind, stage, pass: o.cell.pass, smoke: smoke.get(id) ?? false, state: o.state, list, words: list ? normalizeChanges(list).words : 0, evidenceOpened: opened };
    });
    writeJson(join(launch.sink, "outcomes.json"), out);
    writeJson(join(launch.sink, "attempts.json"), attempts);
    writeJson(join(launch.sink, "rows.json"), rows);
    const states = new Map<string, number>();
    for (const o of out) states.set(o.state, (states.get(o.state) ?? 0) + 1);
    io.out("sessions " + model + " stage " + stage + ": " + out.length + " cells, " + [...states].sort().map(([s, n]) => s + " " + n).join(", ") + "; " + out.filter((o) => o.attempts.length === 2).length + " retried");
    for (const l of printArmStopsWithBlock(out)) io.out(l);
    for (const l of printMalformedToolCalls(out)) io.out(l);
    return 0;
  } finally {
    await closeAll(sessions, launch.ledger);
  }
};
