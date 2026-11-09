// Copyright (c) 2026 Garry Tan. MIT License.
// Decision-routing host answering step (preregistration sections 2 and 6): deciders answer logged states off the
// session clock, on the runner host as root and outside any task container. Given a ledger item, a run id, a list of
// sessions ({session, log_dir, markers_file}) and a mode, it:
// - refuses while the stop file exists or any of the item's answer journals holds a DR_CUSTODY_HIT refusal;
// - reconciles a journal left by an earlier launch, settles this run's open lease, then runs the controller's pre-lease
//   reserve check (checkReserve, DR_RESERVE_STOP) before any lease;
// - opens one lease on the item under the run id and starts one MeteringProxy on it with allowanceCode DR_ALLOWANCE_STOP;
// - per session, binds a slot whose models and deciders are the mode's deciders only, at cells.json's allowance, with the
//   session's runner-only markers and canary as forbidden_markers, so the leak scan covers every decider request; runs
//   <python> -I -m <mode module> with DR_PROXY_URL and DR_PROXY_TOKEN set only in that child's env; then unbinds and
//   finalizes the meter;
// - stops on the stop file, a CAP_STOP or a DR_CUSTODY_HIT (which writes the stop file with its code), lets nothing new
//   start and never retries: a session with <out>/answers/<session>.json was started once and is never started again;
// - settles the lease and writes <out>/answer.json.
// Modes: shadow (calibration: Jev 1.13.0 and particle-1 with and without the guess, dr_agent/shadow.py), safety_calibration
// (calibration: the safety set's calibration half as one pseudo-session, dr_agent/safety_set.py), and the replay item's
// three: jev_newer (S7, Jev 1.14.0 on every logged state, dr_agent/jev_newer.py), safety_held (S4, the held half as one
// pseudo-session, dr_agent/safety_set.py) and guess_ablation (S11, particle-1 with and without Jev's logged guess on R
// states, dr_agent/guess_ablation.py). A safety mode's pseudo-session (pseudoSession, named by the mode's pseudo field)
// gets its own planted canary as its only marker; without --sessions the command line builds it under <out>/<name>.
// --temp runs on a temporary ledger initialised from config/items.json and is refused without --fake-upstreams.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { openLease, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import { MeteringProxy, ProxyControl, reconcileJournal } from "../../../src/runner/proxy/metering-proxy.ts";
import { plantCanary } from "../labels/markers.ts";
import { SAFETY_SET_PATH } from "../labels/safety-set.ts";
import { checkReserve, ControllerError, fakeFetch, MAX_OUTPUT_TOKENS, RETRY, tempRecord } from "./controller.ts";

const LANE = resolve(import.meta.dir, "..");
const CELLS = JSON.parse(readFileSync(join(LANE, "config", "cells.json"), "utf8")) as { deciders: Record<string, string>; limits: { allowance_micros: number } };

export const MODES = {
  shadow: { module: "dr_agent.shadow", deciders: [CELLS.deciders.jev!, CELLS.deciders.particle!], args: [], pseudo: null },
  safety_calibration: { module: "dr_agent.safety_set", deciders: [CELLS.deciders.jev!, CELLS.deciders.particle!], args: ["--safety-set", SAFETY_SET_PATH, "--half", "calibration"], pseudo: "constructed-calibration" },
  jev_newer: { module: "dr_agent.jev_newer", deciders: ["typesafe:jev-1.14.0"], args: [], pseudo: null },
  safety_held: { module: "dr_agent.safety_set", deciders: [CELLS.deciders.jev!, CELLS.deciders.particle!], args: ["--safety-set", SAFETY_SET_PATH, "--half", "held"], pseudo: "constructed-held" },
  guess_ablation: { module: "dr_agent.guess_ablation", deciders: [CELLS.deciders.particle!], args: [], pseudo: null },
} as const;
export const RUNTIME_PYTHON = "/opt/dr/venv/bin/python";

export interface AnswerSession {
  session: string;
  log_dir: string;
  markers_file: string;
}

export interface AnswerOptions {
  item: string;
  runId: string;
  mode: keyof typeof MODES;
  sessions: AnswerSession[];
  out: string;
  questions: string;
  pinFile?: string;
  python?: string[];
  record?: string;
  ledger?: string;
  temp?: boolean;
  items?: string;
  stopFile?: string;
  env?: Record<string, string | undefined>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}

export interface AnswerResult {
  stop: { code: ReasonCode; message: string } | null;
  answered: string[];
  skipped: string[];
  not_run: string[];
  lease: { lease_id: string; spent_micros: number; unknown_micros: number; cap_stop: string | null } | null;
  warnings: string[];
}

/** A safety mode's pseudo-session in dir: a canary planted in dir/canary.txt as its only marker, its log in dir/log. */
export function pseudoSession(dir: string, session: string): AnswerSession {
  const markers_file = join(dir, "markers.json");
  writeFileSync(markers_file, JSON.stringify([plantCanary(dir)]) + "\n", { mode: 0o600 });
  return { session, log_dir: join(dir, "log"), markers_file };
}

type Line = Record<string, any>;
const readLines = (path: string): Line[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }) : []);

export async function runAnswer(o: AnswerOptions): Promise<AnswerResult> {
  const log = o.log ?? ((l: string) => console.error(l));
  const out = resolve(o.out);
  const stopFile = o.stopFile ?? join(out, "STOP");
  const env = o.env ?? process.env;
  const mode = MODES[o.mode];
  if (!mode) throw new ControllerError("E_USAGE", "unknown answering mode " + JSON.stringify(o.mode) + "; modes are " + Object.keys(MODES).join(", "));
  if (existsSync(stopFile)) throw new ControllerError("E_DR_STOPPED", "the stop file " + stopFile + " exists (" + (readFileSync(stopFile, "utf8").trim().split("\n")[0]!.slice(0, 500) || "empty") + "), so nothing was leased or answered; remove it to start");
  const journals = join(out, "journals");
  const journal = join(journals, o.item + ".ndjson");
  for (const name of existsSync(journals) ? readdirSync(journals).filter((n) => n.startsWith(o.item + ".") && n.endsWith(".ndjson")) : []) {
    const hit = readLines(join(journals, name)).find((l) => l.kind === "refusal" && l.code === "DR_CUSTODY_HIT");
    if (hit) throw new ControllerError("DR_CUSTODY_HIT", "the journal " + join(journals, name) + " holds a custody hit (meter " + hit.meter_id + "), so nothing was leased or answered; start again only on the Captain's word");
  }
  if (o.temp && !o.fetch) throw new ControllerError("E_USAGE", "--temp needs --fake-upstreams; nothing was leased or answered");
  for (const s of o.sessions) {
    const markers = JSON.parse(readFileSync(s.markers_file, "utf8")) as string[];
    if (!Array.isArray(markers) || markers.filter((m) => /^DRCANARY-[0-9a-f]{32}$/.test(m)).length !== 1) throw new ControllerError("E_USAGE", "the markers file " + s.markers_file + " must be a JSON list holding exactly one DRCANARY- canary; nothing was leased or answered");
  }

  const warnings: string[] = [];
  const warn = (code: ReasonCode, message: string) => warnings.push(code + ": " + message);
  const { record, local } = o.temp ? tempRecord(join(out, "temp-ledger"), o.items ?? join(LANE, "config", "items.json"), new Set([o.item])) : { record: recordPath(o.record, env).path, local: openLocalLedger(ledgerPath(o.ledger, env)) };
  const result: AnswerResult = { stop: null, answered: [], skipped: [], not_run: [], lease: null, warnings };
  const sessions: Line[] = [];
  let proxy: MeteringProxy | null = null;
  let leaseId: string | null = null;
  let capStopped = false;
  const scratch = mkdtempSync(join(tmpdir(), "dr-answer-"));
  try {
    if (existsSync(journal)) {
      const rec = await reconcileJournal(journal, local);
      for (const r of rec.refused) warn(r.code as ReasonCode, "reconciling reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
      renameSync(journal, join(journals, o.item + ".dead-" + readdirSync(journals).filter((n) => n.startsWith(o.item + ".dead-")).length + ".ndjson"));
    }
    const open = readItem(record, o.item).open;
    if (open && open.run_id === o.runId && local.getLease(open.lease_id)) settleLease(record, local, open.lease_id, warn);
    checkReserve(record, [o.item]);

    mkdirSync(join(out, "answers"), { recursive: true });
    mkdirSync(journals, { recursive: true });
    const lease = openLease(record, local, { item: o.item, run_id: o.runId, warn, ...(o.temp ? { requireAdmission: () => null } : {}) });
    leaseId = lease.lease_id;
    const socket = join(scratch, "mgmt.sock");
    const token = randomBytes(24).toString("hex");
    proxy = new MeteringProxy({ ledger: local, leaseId, host: "127.0.0.1", managementSocket: socket, managementToken: token, journal, retry: RETRY, env, fetch: o.fetch, maxOutputTokens: MAX_OUTPUT_TOKENS, allowanceCode: "DR_ALLOWANCE_STOP" });
    proxy.start();
    const base = "http://127.0.0.1:" + proxy.port;
    const control = new ProxyControl(socket, token);
    log("lease " + leaseId + " on " + o.item + ", proxy " + base);

    const checkStops = (): AnswerResult["stop"] => {
      if (existsSync(stopFile)) return { code: "E_DR_STOPPED", message: "the stop file " + stopFile + " appeared" };
      const lines = readLines(journal);
      const hit = lines.find((l) => l.kind === "refusal" && l.code === "DR_CUSTODY_HIT");
      if (hit) {
        const marks = ((hit.markers ?? []) as Line[]).map((m) => "marker " + m.index + " (sha256 " + m.sha256 + ")").join(", ");
        const message = "answering session " + hit.cell?.task + " (meter " + hit.meter_id + ") on " + o.item + " sent runner-only content: " + marks + "; nothing new starts";
        writeFileSync(stopFile, "DR_CUSTODY_HIT: " + message + "\n");
        return { code: "DR_CUSTODY_HIT", message };
      }
      const cap = lines.find((l) => l.kind === "refusal" && l.code === "CAP_STOP");
      if (cap) {
        capStopped = true;
        return { code: "CAP_STOP", message: "line item " + o.item + " (lease " + leaseId + ") refused a reservation: " + cap.reason };
      }
      return null;
    };

    for (const s of o.sessions) {
      const meta = join(out, "answers", s.session + ".json");
      if (existsSync(meta)) {
        result.skipped.push(s.session);
        continue;
      }
      result.stop ??= checkStops();
      if (result.stop) {
        result.not_run.push(s.session);
        continue;
      }
      const markers = JSON.parse(readFileSync(s.markers_file, "utf8")) as string[];
      const answers = join(out, "answers", s.session + "." + o.mode + ".jsonl");
      const started = new Date().toISOString();
      writeFileSync(meta, JSON.stringify({ session: s.session, mode: o.mode, started }) + "\n");
      const binding = await control.bind({ cell: { run_id: o.item, arm: o.mode, task: s.session, model: "deciders", trial: 1, attempt: 1 }, models: [...mode.deciders], deciders: [...mode.deciders], allowance_micros: CELLS.limits.allowance_micros, forbidden_markers: markers, canary: markers.find((m) => m.startsWith("DRCANARY-"))! });
      let exitCode: number | null = null;
      try {
        const proc = Bun.spawn([...(o.python ?? [RUNTIME_PYTHON]), "-I", "-m", mode.module, "--log-dir", s.log_dir, "--questions", o.questions, ...(o.pinFile ? ["--pin", o.pinFile] : []), "--out", answers, ...mode.args], {
          env: { PATH: env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", DR_PROXY_URL: base + "/" + binding.slot, DR_PROXY_TOKEN: binding.token },
          stdout: Bun.file(answers + ".log"),
          stderr: Bun.file(answers + ".err"),
          stdin: "ignore",
        });
        exitCode = await proc.exited;
      } finally {
        await control.unbind(binding.slot);
        const meter = await control.finalize(binding.meter_id);
        const row = { session: s.session, mode: o.mode, meter_id: binding.meter_id, exit_code: exitCode, answers, started, ended: new Date().toISOString(), meter };
        writeFileSync(meta, JSON.stringify(row) + "\n");
        sessions.push(row);
      }
      result.answered.push(s.session);
      log("answered " + s.session + " (exit " + exitCode + ")");
    }
    result.stop ??= checkStops();
  } finally {
    proxy?.stop();
    if (leaseId) {
      try {
        const rec = await reconcileJournal(journal, local);
        for (const x of rec.refused) warn(x.code as ReasonCode, "settling reservation " + (x.reservation_id ?? "(a lost reserve)") + " was refused: " + x.message);
        const close = settleLease(record, local, leaseId, warn, capStopped ? "answer " + o.runId : undefined);
        result.lease = { lease_id: leaseId, spent_micros: close.spent_micros, unknown_micros: close.unknown_micros, cap_stop: close.cap_stop ?? null };
      } catch (e) {
        warn("E_LEASE_UNSETTLED", "lease " + leaseId + " on " + o.item + " was not settled: " + (e as Error).message + "; settle it with gstack-evals ledger settle --lease " + leaseId);
      }
    }
    local.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  if (leaseId) writeFileSync(join(out, "answer.json"), JSON.stringify({ run_id: o.runId, item: o.item, mode: o.mode, temp: !!o.temp, record, ...result, sessions }, null, 2) + "\n");
  return result;
}

const FLAGS = new Set(["--item", "--run-id", "--mode", "--sessions", "--out", "--questions", "--pin-file", "--python", "--record", "--ledger", "--items", "--stop-file", "--fake-upstreams"]);
const USAGE = "usage: answer --item <item> --run-id <id> --mode <" + Object.keys(MODES).join("|") + "> --sessions <sessions.json: [{session, log_dir, markers_file}]; the safety modes build their own when left out> --out <dir> --questions <questions.json> [--pin-file <pin.json>] [--python <command>] [--record <dir> --ledger <sqlite> | --temp --fake-upstreams <urls.json> [--items <items.json>]] [--stop-file <path>]";

export async function main(argv: string[]): Promise<number> {
  const f: Record<string, string> = {};
  let temp = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--temp") temp = true;
    else if (FLAGS.has(a) && argv[i + 1] !== undefined) f[a] = argv[++i]!;
    else {
      console.error("E_USAGE: unknown or incomplete argument " + a + "\n" + USAGE);
      return 2;
    }
  }
  const pseudo = MODES[f["--mode"] as keyof typeof MODES]?.pseudo ?? null;
  const missing = ["--item", "--run-id", "--mode", ...(pseudo ? [] : ["--sessions"]), "--out", "--questions"].filter((k) => !f[k]);
  if (missing.length) {
    console.error("E_USAGE: missing " + missing.join(", ") + "\n" + USAGE);
    return 2;
  }
  try {
    const r = await runAnswer({
      item: f["--item"]!,
      runId: f["--run-id"]!,
      mode: f["--mode"] as keyof typeof MODES,
      sessions: f["--sessions"] ? (JSON.parse(readFileSync(f["--sessions"], "utf8")) as AnswerSession[]) : [pseudoSession(join(resolve(f["--out"]!), pseudo!), pseudo!)],
      out: f["--out"]!,
      questions: resolve(f["--questions"]!),
      pinFile: f["--pin-file"] ? resolve(f["--pin-file"]) : undefined,
      python: f["--python"]?.split(/\s+/).filter(Boolean),
      record: f["--record"],
      ledger: f["--ledger"],
      temp,
      items: f["--items"],
      stopFile: f["--stop-file"],
      fetch: f["--fake-upstreams"] ? fakeFetch(JSON.parse(readFileSync(f["--fake-upstreams"], "utf8"))) : undefined,
    });
    for (const w of r.warnings) console.error(w);
    if (r.stop) console.error(r.stop.code + ": " + r.stop.message + "; " + r.answered.length + " answered, " + r.not_run.length + " not run; the lease is settled (" + join(resolve(f["--out"]!), "answer.json") + ")");
    else console.log("answering done: " + r.answered.length + " answered, " + r.skipped.length + " skipped as started before; " + join(resolve(f["--out"]!), "answer.json"));
    return r.stop ? 2 : 0;
  } catch (e) {
    if (e instanceof LedgerError) console.error(e.code + ": " + e.message);
    else if (e instanceof ControllerError) console.error(e.message);
    else console.error("E_INTERNAL: decision-routing answer: " + (e as Error).message);
    return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
