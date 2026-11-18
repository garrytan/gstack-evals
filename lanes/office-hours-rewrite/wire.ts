// Copyright (c) 2026 Garry Tan. MIT License.
// How the office-hours rewrite eval's areas connect to the paid world. One metered client per command, on one ledger
// item, through the product-value meter and its in-process metering proxy, as the founder lane's author wire does:
// - call: the product-value meter's CallRequest caller the author area codes against. Every "astra" request goes to
//   GPT-6.2 Astra (the meter's "astra-6.2" key), because the preregistration names GPT-6.2 Astra for the unanimous key,
//   the Opus judge, the gold pass and the simulator auditor, and the meter's "astra" key is GPT-6 Astra. A Gemini reply
//   Google Vertex did not serve stops the command (E_PV_PROVIDER_DRIFT), as the founder lane's wire does.
// - judge: the product-value judge Caller the score area codes against, on the same routing, with each reply's model
//   version read from the provider's reply.
// - sim: the founder lane's founderCall over the same meter (sim/founder.ts pinnedCall), for the fixed-script audit's
//   simulator turns.
// - auditor: one auditor's call at the audit's effort, with the founder lane's resend line when a prompt comes back.
// Pre-run change 4: a judge or auditor reply that names a model other than its pin (pinned.ts) stops the command
// (E_OHR_MODEL_DRIFT), and so does a simulator reply, as a drift. A ledger refusal on a judge or auditor call (the item's
// cap, CAP_STOP, or a closed lease, E_LEASE_CLOSED) stops the command as a cap stop (CAP_STOP), which reads INCOMPLETE:
// it never becomes a missing label, an empty auditor answer or a resend. call itself, which authoring uses, is unchanged.
// The run area's launches open their own meter for the simulator and lease the arms through the rig; nothing there
// calls Astra.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditCall } from "../../src/persona-sim/audit.ts";
import type { SimCall } from "../../src/persona-sim/sim.ts";
import { newRunId } from "../../src/skill-eval/cli/call.ts";
import { AUDIT_MAX_TOKENS, RESEND } from "../office-hours-founder/audit.ts";
import type { Caller } from "../office-hours-founder/author/files.ts";
import { VERTEX } from "../office-hours-founder/sim/founder.ts";
import { versionTap, type Caller as JudgeCaller } from "../product-value/judge.ts";
import { MeterError, MODELS, openMeter, sha256, type CallRequest, type CallResult, type ModelKey } from "../product-value/meter.ts";
import { insideRepo } from "../review-noloss/suite.ts";
import { AUDIT } from "./frozen.ts";
import { modelDrift } from "./pinned.ts";
import { pinnedCall } from "./sim/founder.ts";
import type { JudgeKey } from "./types.ts";

/** The meter key for openai/gpt-6.2-astra. The meter's "astra" key stays GPT-6 Astra for the lanes that use it. */
export const ASTRA: ModelKey = "astra-6.2";

/** This lane's route for a meter key: "astra" is GPT-6.2 Astra, everything else as the meter names it. */
export const routed = (m: ModelKey): ModelKey => (m === "astra" ? ASTRA : m);
const JUDGE_MODEL: Readonly<Record<JudgeKey, ModelKey>> = { astra: ASTRA, opus: "opus", gemini: "gemini" };

/**
 * A ledger refusal, as the metering proxy names it in the reply's problem: the item's cap (CAP_STOP), a closed lease
 * (E_LEASE_CLOSED), or a 402 E_ALLOWANCE, because the meter binds each call's slot at the whole lease, so that refusal
 * says the lease cannot hold the call's worst case.
 */
export const capRefused = (r: Pick<CallResult, "text" | "problem" | "status">): boolean => r.text === null && (/^(CAP_STOP|E_LEASE_CLOSED)\b/.test(r.problem ?? "") || (r.status === 402 && /^E_ALLOWANCE\b/.test(r.problem ?? "")));

/** Throws CAP_STOP on a ledger refusal and E_OHR_MODEL_DRIFT on a reply that names another model than the request's pin. */
export function counted(req: Pick<CallRequest, "model" | "label">, r: CallResult): CallResult {
  if (capRefused(r)) throw new MeterError("CAP_STOP", req.label + ": the ledger refused the call (" + r.problem + "); a cap stop ends this command INCOMPLETE and is never retried");
  if (r.text === null || r.model === undefined) return r;
  const drift = modelDrift(MODELS[req.model].id, r.model, req.label);
  if (drift) throw new MeterError("E_OHR_MODEL_DRIFT", drift.replace(/^E_OHR_MODEL_DRIFT /, ""));
  return r;
}

type Env = Record<string, string | undefined>;
interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface WireOptions {
  /** Holds run.json, the meter's journal and the reply cache; outside the repository, on tmpfs for sealed work. */
  dir: string;
  item: string;
  /** The most the lease reserves, in micro-dollars. */
  capMicros: number;
  /** A run id prefix for a new run; a dir with run.json resumes its run id. */
  label: string;
  record?: string;
  ledger?: string;
  env: Env;
  io: Io;
  /** Test-only: the fetch the meter's proxy sends upstream with. */
  upstream?: typeof fetch;
}

export interface Wire {
  call: Caller;
  judge: JudgeCaller;
  sim: (label: string) => SimCall;
  auditor: (who: (typeof AUDIT.auditors)[number]) => AuditCall;
  /** Settled spend on this run so far, in dollars, earlier launches of the same run included. */
  spent: () => number;
  close: (cmd: string) => Promise<number>;
}

export async function openWire(o: WireOptions): Promise<Wire> {
  if (insideRepo(o.dir)) throw new MeterError("E_USAGE", o.dir + " is inside the repo, and the meter's cache holds model output");
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  const runFile = join(o.dir, "run.json");
  const prior = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { run_id: string; spent_micros: number }) : null;
  const runId = prior?.run_id ?? newRunId(o.label);
  const before = prior?.spent_micros ?? 0;
  const cacheDir = join(o.dir, "cache");
  const vdir = join(cacheDir, "versions");
  mkdirSync(vdir, { recursive: true, mode: 0o700 });
  writeFileSync(runFile, JSON.stringify({ run_id: runId, spent_micros: before }) + "\n");
  const meter = await openMeter({ item: o.item, runId, out: join(o.dir, "meter"), cacheDir, maxOutputTokens: 32_000, amountMicros: o.capMicros, record: o.record, ledger: o.ledger, env: o.env, fetch: versionTap(o.upstream ?? fetch, vdir), warn: (code, m) => o.io.err(code + " " + m) });
  const call: Caller = async (req) => {
    const model = routed(req.model);
    const res = await meter.call({ ...req, model });
    if (model === "gemini" && res.text !== null && !VERTEX.test(res.served_by ?? "")) throw new MeterError("E_PV_PROVIDER_DRIFT", MODELS.gemini.id + " was served by " + (res.served_by ?? "an unnamed provider") + ", not Google Vertex; stop and ask the Captain");
    return res;
  };
  const judge: JudgeCaller = async (c) => {
    const key = JUDGE_MODEL[c.judge];
    const req = { model: key, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label };
    const r = counted(req, await call(req));
    const v = join(vdir, sha256(MODELS[key].id + "\n" + c.prompt) + ".version");
    return { text: r.text, model_id: MODELS[key].provider + ":" + MODELS[key].id, version: existsSync(v) ? readFileSync(v, "utf8") : null, problem: r.problem };
  };
  const sim = (label: string): SimCall => pinnedCall({ meter: { call: (req) => meter.call({ ...req, model: routed(req.model) }) }, session: { allowance_micros: Number.MAX_SAFE_INTEGER, spent_micros: 0 }, label });
  const auditor = (who: (typeof AUDIT.auditors)[number]): AuditCall => {
    const asked = new Set<string>();
    return async (prompt) => {
      const resend = asked.has(prompt);
      asked.add(prompt);
      const req = { model: routed(who), prompt: resend ? prompt + "\n\n" + RESEND : prompt, maxTokens: AUDIT_MAX_TOKENS, effort: AUDIT.effort, label: "audit:" + who };
      return counted(req, await call(req)).text ?? "";
    };
  };
  return {
    call,
    judge,
    sim,
    auditor,
    spent: () => (before + meter.spent()) / 1e6,
    async close(cmd) {
      const c = await meter.close();
      writeFileSync(runFile, JSON.stringify({ run_id: runId, spent_micros: before + c.spent_micros }) + "\n");
      o.io.out(cmd + ": settled " + (c.spent_micros / 1e6).toFixed(4) + " dollars on " + o.item + (c.unknown_micros ? ", " + (c.unknown_micros / 1e6).toFixed(4) + " unknown" : ""));
      return c.spent_micros;
    },
  };
}
