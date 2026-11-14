// Copyright (c) 2026 Garry Tan. MIT License.
// The two Stop hooks (plan section 10; R2-6, R2-11, R2-14) and the one Stop handler that runs them. Both are
// gstack-evals code that runs evaluator-side through the Claude Code driver's stopHook option.
//
// The autoplan gate hook (new code: neither source answers a gate). On each Stop event it finds the run directories
// written during this session (run.json files under the container's /work and HOME whose mtime is at or after the
// session's start) that sit at gate_pending, and answers each (R2-11 prints the count) with the frozen answer and the
// flags the pin needs: --out, --gate-rev from gate.json, --owner-reply rec and --words-by agent:harness, so "rec" is
// recorded as the harness's own words, and --rec-hash whenever gate.json carries rec_rev (BT: the hash is required
// once rec_rev is above 0 and harmless at 0). The rec hash comes from the pinned binary's gate render ("Reply binds to
// gate_rev=N rec_hash=H"), or else from the last recommended row for that gate_rev in the run's journal, never from a
// gate.json field. After every gate revision it answers, it returns the frozen GATE_MESSAGE; a run's answers are
// bounded by its max_rounds. A gate-hook block takes the Stop turn before the D1 hook.
//
// The D1 repair hook (2026-11-09-geva-420 smoke rule 4). Off by default; on only for a gstack arm on a model after
// that arm failed smoke rule 1 or 2 there, for the re-smoke and that arm-model's stage 2 cells; never in none, lens or
// reference. When on, at a stop it runs the arm's detector and the block parser and, while the procedure hasn't shown
// or no block parses, blocks the stop with one fixed message naming the missing outputs, at most twice. D's devex-only
// behaviours (lanes/devex/run/stophook.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94: the autoplan stop-gate repair,
// double limits, the every-model repair scope, the interim pause, lease holds and install-verdict pauses) are gone.
import { AUTOPLAN_ANSWER, GATE_MESSAGE, HARNESS } from "../frozen.ts";
import type { GstackArm, SessionKind } from "../types.ts";
import { isGstackArm } from "./arms.ts";
import type { ParseBlock, RunBox } from "./types.ts";

/** The pin's gate render line that binds a reply (lib/gate-list.ts at b6155921). */
const BINDS = /Reply binds to gate_rev=(\d+) rec_hash=([0-9a-f]+)\./;

/** The answer's argv after the binary name: the frozen command's tokens with the pin's required flags added. */
export function answerArgs(dir: string, gateRev: number, recHash: string | null): string[] {
  const [bin, sub, ...rest] = AUTOPLAN_ANSWER.split(" ");
  if (bin !== "gstack-autoplan" || sub !== "answer") throw new Error("E_INTERNAL: AUTOPLAN_ANSWER is not a gstack-autoplan answer command");
  const by = rest[rest.indexOf("--by") + 1]!;
  return [sub, "--out", dir, "--gate-rev", String(gateRev), ...rest, "--owner-reply", rest[rest.indexOf("--reply") + 1]!, "--words-by", by, ...(recHash ? ["--rec-hash", recHash] : [])];
}

/** The rec hash for a gate revision: the pinned render's, else the last recommended journal row's; null when neither. */
export function recHashOf(box: RunBox, dir: string, gateRev: number): { hash: string; from: "render" | "journal" } | null {
  const render = box.gstack("gstack-gate", ["render", dir + "/gate.json", "--all"]);
  const m = render.code === 0 ? BINDS.exec(render.stdout) : null;
  if (m && Number(m[1]) === gateRev) return { hash: m[2]!, from: "render" };
  const rows = (box.read(dir + "/attempts.jsonl") ?? "").split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });
  const last = rows.filter((r) => r?.event === "recommended" && r.gate_rev === gateRev && typeof r.rec_hash === "string").at(-1);
  return last ? { hash: last.rec_hash, from: "journal" } : null;
}

export interface GateHook {
  onStop(): string | null;
  /** Every (run directory, gate revision) the hook answered, in order. */
  answered(): Array<{ dir: string; gateRev: number }>;
  messages(): number;
}

export function gateHook(o: { box: RunBox; sinceMs: number; log?: (line: string) => void }): GateHook {
  const log = o.log ?? (() => {});
  const answered: Array<{ dir: string; gateRev: number }> = [];
  let messages = 0;
  return {
    onStop() {
      const runs = o.box.runs(o.sinceMs);
      const pending = runs.filter((r) => r.state.status === "gate_pending");
      if (!pending.length) {
        log("gate hook: " + (runs.length ? "no run directory of this session is at gate_pending" : "no run directory written this session"));
        return null;
      }
      if (pending.length > 1) log("gate hook: " + pending.length + " run directories of this session are at gate_pending; answering each");
      let now = 0;
      for (const { dir, state } of pending) {
        let gate: Record<string, unknown>;
        try {
          gate = JSON.parse(o.box.read(dir + "/gate.json") ?? "");
        } catch {
          log("gate hook: " + dir + ": gate.json does not read; not answered");
          continue;
        }
        const rev = gate.gate_rev;
        if (typeof rev !== "number") {
          log("gate hook: " + dir + ": gate.json has no gate_rev; not answered");
          continue;
        }
        if (answered.some((a) => a.dir === dir && a.gateRev === rev)) continue;
        const bound = typeof state.max_rounds === "number" && state.max_rounds > 0 ? state.max_rounds : 1;
        if (answered.filter((a) => a.dir === dir).length >= bound) {
          log("gate hook: " + dir + ": gate_rev " + rev + " not answered; the run's max_rounds of " + bound + " is used");
          continue;
        }
        let hash: string | null = null;
        if (typeof gate.rec_rev === "number") {
          const h = recHashOf(o.box, dir, rev);
          if (!h) {
            log("gate hook: " + dir + ": no rec hash for gate_rev " + rev + " from the render or the journal; not answered");
            continue;
          }
          hash = h.hash;
        }
        const r = o.box.gstack("gstack-autoplan", answerArgs(dir, rev, hash));
        if (r.code !== 0) {
          log("gate hook: " + dir + ": answer at gate_rev " + rev + " exited " + r.code + ": " + (r.stderr || r.stdout).trim().split("\n")[0]);
          continue;
        }
        answered.push({ dir, gateRev: rev });
        now++;
        log("gate hook: answered " + dir + " gate_rev " + rev + " rec" + (hash ? " rec_hash " + hash : ""));
      }
      if (!now) return null;
      messages++;
      return GATE_MESSAGE;
    },
    answered: () => [...answered],
    messages: () => messages,
  };
}

/** The D1 hook's one fixed message (BT text), with the missing outputs filled in. */
export const D1_MESSAGE = "Do not stop yet. The procedure has not shown these required outputs: {missing}. Produce them, then end your reply with the plan-changes block.";
export const D1_BLOCK_MISSING = "a plan-changes block that parses";

/** Whether the D1 hook is on for a session: only a gstack arm that failed smoke rule 1 or 2 on this model. */
export function repairOn(kind: SessionKind, failedSmokeRule: 1 | 2 | null): boolean {
  return isGstackArm(kind) && failedSmokeRule !== null;
}

export interface RepairHook {
  onStop(transcript: string): string | null;
  blocks(): number;
}

/** A D1 hook for one session of a gstack arm. Refuses a none, lens or reference session. */
export function repairHook(o: { kind: SessionKind; detect: (transcript: string) => { exposed: boolean; missing: string[] }; parse: ParseBlock; reply: (transcript: string) => string; log?: (line: string) => void }): RepairHook {
  if (!isGstackArm(o.kind)) throw new Error("E_USAGE: the D1 repair hook never runs in a " + o.kind + " session");
  let blocks = 0;
  return {
    onStop(transcript) {
      if (blocks >= HARNESS.maxRepairBlocks) return null;
      const read = o.detect(transcript);
      const parsed = o.parse(o.reply(transcript)) !== null;
      if (read.exposed && parsed) return null;
      blocks++;
      const missing = [...read.missing, ...(parsed ? [] : [D1_BLOCK_MISSING])];
      o.log?.("D1 hook: block " + blocks + " of " + HARNESS.maxRepairBlocks + ": " + missing.join("; "));
      return D1_MESSAGE.replace("{missing}", missing.join("; "));
    },
    blocks: () => blocks,
  };
}

/**
 * The one Stop handler a session gets: the gate hook first (autoplan only), then the D1 hook when it is on. Returns
 * null for a session with neither, so the driver registers no Stop hook at all.
 */
export function stopHandler(o: { kind: GstackArm | SessionKind; gate: GateHook | null; repair: RepairHook | null }): ((transcript: string) => string | null) | null {
  if (o.gate && o.kind !== "autoplan") throw new Error("E_USAGE: the gate hook runs only in the autoplan arm");
  if (o.repair && !isGstackArm(o.kind)) throw new Error("E_USAGE: the D1 repair hook never runs in a " + o.kind + " session");
  if (!o.gate && !o.repair) return null;
  return (transcript) => o.gate?.onStop() ?? o.repair?.onStop(transcript) ?? null;
}
