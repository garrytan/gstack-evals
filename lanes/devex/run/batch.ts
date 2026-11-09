// Copyright (c) 2026 Garry Tan. MIT License.
// Lease effects on devex run batches (prereg 2026-11-09-geva-417, section 11's interim exposure check, section 15 rule
// 3; GST-2016). A batch is the planned sessions that share one ledger lease: the model-pass lease at stage 2, or the
// stage 1 smoke batch's lease. Sessions run in plan order, parallel at most o.parallel at a time.
// - A per-model stop (E_DX_PROVIDER_DRIFT, or a judge or stock stop for one model: E_DX_JUDGE_KAPPA, E_DX_STOCK_FAIL)
//   starts no more sessions on that model and calls stopScope({field: "model"}), so the proxy's later reserves for it
//   are refused; once that model's sessions in flight have ended (its sends are over), settleScope settles its
//   reservations. The other models go on and the lease stays open.
// - An arm stop (E_DX_EXPOSURE_STOP, E_DX_ARM_DROPPED) calls stopScope({field: "arm"}) and settles nothing: the lease
//   stays open for the other arms, and the stopped arm's unrun sessions are released when the lease settles.
// - The interim pause (section 11) starts no new sessions in that arm on that model and leaves the lease open; with
//   o.interim on, it fires by itself once the arm's first 24 Opus (16 Sol or particle-1) stage 2 sessions read under
//   0.80 (score/rules.ts interimCheck). The reading goes to the Captain: resume runs the arm on the same lease, and
//   stopArm is E_DX_EXPOSURE_STOP. settle refuses while a pause awaits that word.
// - halt starts no more sessions at all; nothing is retried to change a verdict. An error a worker raises, in a launch or
//   outside it (poll, interim, settleModelIfIdle), halts the batch too; run waits for every session in flight to end,
//   then throws the first error, and the session loop holds the lease open for it.
// - poll, when given, runs before each session starts, so a stop the Captain records mid-run (the run's control file)
//   applies to the next session.
// - settle stages and marks the lease's close (with a cap stop when an ending code stopped the run), and writes it to the approval record when the batch has one
//   (settleLease); sessions never started under a stop, a pause or a halt are released then.
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { settleLease } from "../../../src/runner/ledger/ledger.ts";
import type { CloseFile } from "../../../src/runner/ledger/record.ts";
import type { LocalLedger, ScopeFigures } from "../../../src/runner/ledger/local.ts";
import { GSTACK_ARMS, MODEL_STRINGS, type ArmId, type ModelId, type Stage } from "../types.ts";
import { interimCheck } from "../score/rules.ts";

export interface BatchSession {
  id: string;
  unit: string;
  arm: ArmId;
  model: ModelId;
  pass: number;
  stage: Stage;
  smoke: boolean;
}
export type SessionState = "pending" | "running" | "done" | "released";
export type ModelStop = "E_DX_PROVIDER_DRIFT" | "E_DX_JUDGE_KAPPA" | "E_DX_STOCK_FAIL";
export type ArmStop = "E_DX_EXPOSURE_STOP" | "E_DX_ARM_DROPPED";
export interface Launched {
  exposed: boolean | null;
}
export interface BatchLog {
  at: string;
  event: "start" | "end" | "model-stop" | "model-settled" | "arm-stop" | "pause" | "resume" | "unpause" | "halt" | "settled";
  detail: string;
}

export class DxBatch<R extends Launched = Launched> {
  readonly state = new Map<string, { session: BatchSession; state: SessionState; result?: R }>();
  readonly log: BatchLog[] = [];
  readonly modelSettled = new Map<ModelId, ScopeFigures>();
  private stoppedModels = new Set<ModelId>();
  private stoppedArms = new Set<ArmId>();
  private paused = new Map<string, { why: string; since: number }>();
  private checked = new Set<string>();
  private done: Array<{ arm: ArmId; model: ModelId; exposed: boolean | null }> = [];
  private settledClose: CloseFile | null = null;
  private halted: string | null = null;

  constructor(private o: { ledger: LocalLedger; lease: string; sessions: readonly BatchSession[]; launch: (s: BatchSession) => Promise<R>; parallel?: number; interim?: boolean; record?: string; poll?: (b: DxBatch<R>) => void }) {
    for (const s of o.sessions) {
      if (this.state.has(s.id)) throw new Error("E_USAGE: session " + s.id + " is planned twice in one batch");
      this.state.set(s.id, { session: s, state: "pending" });
    }
  }

  private note(event: BatchLog["event"], detail: string) {
    this.log.push({ at: new Date().toISOString(), event, detail });
  }
  private key = (arm: ArmId, model: ModelId) => arm + " on " + model;
  private startable = (s: BatchSession) => this.halted === null && !this.stoppedModels.has(s.model) && !this.stoppedArms.has(s.arm) && !this.paused.has(this.key(s.arm, s.model));
  private inFlight = (model: ModelId) => [...this.state.values()].some((e) => e.state === "running" && e.session.model === model);

  /** A per-model stop: the model's sessions end here, its pauses clear, its scope is stopped now and settled once its sends are over. */
  stopModel(model: ModelId, code: ModelStop, why: string): void {
    if (this.stoppedModels.has(model)) return;
    this.stoppedModels.add(model);
    for (const k of [...this.paused.keys()]) if (k.endsWith(" on " + model)) this.unpause(k, code);
    const r = this.o.ledger.stopScope(this.o.lease, { field: "model", value: MODEL_STRINGS[model] }, code as ReasonCode, why);
    this.note("model-stop", model + " " + code + ": " + why + " (" + r.in_flight + " calls in flight)");
    this.settleModelIfIdle(model);
  }
  private settleModelIfIdle(model: ModelId) {
    if (!this.stoppedModels.has(model) || this.modelSettled.has(model) || this.inFlight(model)) return;
    const f = this.o.ledger.settleScope(this.o.lease, { field: "model", value: MODEL_STRINGS[model] });
    this.modelSettled.set(model, f);
    this.note("model-settled", model + ": " + f.settled_calls + " settled calls, " + f.unknown_calls + " unknown");
  }

  /** An arm stop: no more sessions in that arm on this lease; nothing settles, and its unrun sessions release at settle. */
  stopArm(arm: ArmId, code: ArmStop, why: string): void {
    if (this.stoppedArms.has(arm)) return;
    this.stoppedArms.add(arm);
    for (const k of [...this.paused.keys()]) if (k.startsWith(arm + " on ")) this.unpause(k, code);
    this.o.ledger.stopScope(this.o.lease, { field: "arm", value: arm }, code as ReasonCode, why);
    this.note("arm-stop", arm + " " + code + ": " + why);
  }

  /** A cap stop on the lease's item: no session starts after it, and the unrun ones release at settle. */
  halt(why: string): void {
    if (this.halted !== null) return;
    this.halted = why;
    this.note("halt", why);
  }
  /** Why the batch halted, or null. */
  haltedBy(): string | null {
    return this.halted;
  }

  /** The interim pause: no new sessions in that arm on that model; the lease stays open. False when the arm or model is already stopped. */
  pause(arm: ArmId, model: ModelId, why: string): boolean {
    if (this.stoppedArms.has(arm) || this.stoppedModels.has(model)) return false;
    if (!this.paused.has(this.key(arm, model))) this.paused.set(this.key(arm, model), { why, since: Date.now() });
    this.note("pause", this.key(arm, model) + ": " + why);
    return true;
  }
  private unpause(key: string, why: string) {
    this.paused.delete(key);
    this.note("unpause", key + ": " + why);
  }
  /** An ending stop settles the lease over every pause (section 15 rule 3). */
  endPauses(why: string): void {
    for (const k of [...this.paused.keys()]) this.unpause(k, why);
  }
  /** The Captain's word to go on: the arm resumes on the same lease. */
  resume(arm: ArmId, model: ModelId): void {
    if (!this.paused.delete(this.key(arm, model))) throw new Error("E_USAGE: " + this.key(arm, model) + " is not paused");
    this.note("resume", this.key(arm, model) + " on lease " + this.o.lease);
  }
  pauses(): Array<{ arm_model: string; why: string; since: number }> {
    return [...this.paused].map(([arm_model, p]) => ({ arm_model, ...p }));
  }

  private interim(s: BatchSession, r: R) {
    if (!this.o.interim || s.smoke || s.stage !== 2 || !GSTACK_ARMS.includes(s.arm)) return;
    this.done.push({ arm: s.arm, model: s.model, exposed: r.exposed });
    const k = this.key(s.arm, s.model);
    if (this.checked.has(k)) return;
    const read = interimCheck(s.model, this.done.filter((d) => d.arm === s.arm && d.model === s.model));
    if (!read.ready) return;
    this.checked.add(k);
    if (read.pause) this.pause(s.arm, s.model, "interim exposure " + read.rate!.toFixed(4) + " after " + read.sessions + " sessions, under 0.80; the reading goes to the Captain");
  }

  /** Runs every startable session; returns when none is left to start. */
  async run(): Promise<void> {
    if (this.settledClose) throw new Error("E_LEASE_CLOSED: lease " + this.o.lease + " has settled");
    const width = Math.max(1, this.o.parallel ?? 1);
    const next = () => {
      this.o.poll?.(this);
      return [...this.state.values()].find((e) => e.state === "pending" && this.startable(e.session));
    };
    const failures: unknown[] = [];
    const fail = (where: string, err: unknown) => {
      failures.push(err);
      this.halt(where + " threw: " + ((err as Error)?.message ?? String(err)).split("\n")[0]);
    };
    const worker = async () => {
      try {
        for (let e = next(); e; e = next()) {
          e.state = "running";
          this.note("start", e.session.id);
          try {
            e.result = await this.o.launch(e.session);
          } catch (err) {
            fail("a launch", err);
          } finally {
            e.state = "done";
            this.note("end", e.session.id);
          }
          if (e.result) this.interim(e.session, e.result);
          this.settleModelIfIdle(e.session.model);
        }
      } catch (err) {
        fail("a worker", err);
      }
    };
    await Promise.all(Array.from({ length: width }, worker));
    try {
      for (const m of this.stoppedModels) this.settleModelIfIdle(m);
    } catch (err) {
      fail("a model settle", err);
    }
    if (failures.length) throw failures[0];
  }

  /** Settles the lease: stages and marks its close, and releases every session never started under a stop or a pause. */
  settle(capStop?: string): { close: CloseFile; released: string[] } {
    if (this.paused.size) throw new Error("E_USAGE: " + [...this.paused.keys()].join(", ") + " is paused for the Captain's word; resume it or stop it (E_DX_EXPOSURE_STOP) before the lease settles");
    if ([...this.state.values()].some((e) => e.state === "running")) throw new Error("E_USAGE: a session is still running on lease " + this.o.lease);
    let close: CloseFile;
    if (this.o.record) close = settleLease(this.o.record, this.o.ledger, this.o.lease, undefined, capStop);
    else {
      close = this.o.ledger.stageClose(this.o.lease, capStop);
      this.o.ledger.markClosed(this.o.lease, "settled");
    }
    this.settledClose = close;
    const released: string[] = [];
    for (const e of this.state.values()) {
      if (e.state !== "pending") continue;
      e.state = "released";
      released.push(e.session.id);
    }
    this.note("settled", this.o.lease + ": " + released.length + " unrun sessions released");
    return { close, released };
  }
}
