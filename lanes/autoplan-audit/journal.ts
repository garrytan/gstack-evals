// Copyright (c) 2026 Garry Tan. MIT License.
// Section 13.4: the request journal. Every panel request is a row keyed by its request digest, written (and synced)
// before it is sent, then moved to one terminal state: label (received and valid), invalid (judged but unusable),
// unknown (outcome lost to a crash, or a send the proxy settled as unknown) or retried (failed again after its one J1
// retry). A failed call with no settled reply gets one retry; the retry count is in the rows, so it survives
// relaunches. A relaunch reconciles before any call: a pending row whose reply reached the cache becomes label, any
// other pending row becomes unknown and is never resent (its reservation stays on the ledger until the proxy journal is
// reconciled). The reply cache serves only requests whose row is terminal with a label.
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CallRequest, CallResult, ModelKey } from "./meter.ts";
import { MeterError, MODELS, requestBody, requestDigest } from "./meter.ts";

export type JState = "pending" | "label" | "invalid" | "unknown" | "failed" | "retried" | "leak";
export const TERMINAL: ReadonlySet<JState> = new Set(["label", "invalid", "unknown", "retried", "leak"]);

export interface JRow {
  digest: string;
  state: JState;
  retries: number;
  model: ModelKey;
  cell: string;
  at: string;
}

export interface Reply {
  digest: string;
  text: string;
  label: string;
}

export type Crash = "after-send" | "after-settle" | "before-cache" | "after-cache";

export class Journal {
  readonly file: string;
  readonly cache: string;
  private rows = new Map<string, JRow>();
  constructor(dir: string, private crash?: { at: Crash; cell: string; exit: () => never }) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, "requests.ndjson");
    this.cache = join(dir, "replies");
    mkdirSync(this.cache, { recursive: true, mode: 0o700 });
    if (existsSync(this.file))
      for (const line of readFileSync(this.file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as JRow;
          this.rows.set(r.digest, r);
        } catch {}
      }
  }
  get(digest: string): JRow | undefined {
    return this.rows.get(digest);
  }
  all(): JRow[] {
    return [...this.rows.values()];
  }
  private write(r: JRow): void {
    const fd = openSync(this.file, "a", 0o600);
    try {
      appendFileSync(fd, JSON.stringify(r) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.rows.set(r.digest, r);
  }
  set(digest: string, state: JState, o: { retries: number; model: ModelKey; cell: string }): void {
    this.write({ digest, state, retries: o.retries, model: o.model, cell: o.cell, at: new Date().toISOString() });
  }
  cached(digest: string): Reply | null {
    const f = join(this.cache, digest + ".json");
    if (!existsSync(f)) return null;
    try {
      const r = JSON.parse(readFileSync(f, "utf8")) as Reply;
      return r.digest === digest && typeof r.text === "string" ? r : null;
    } catch {
      return null;
    }
  }
  /** Serves a reply only for a terminal label row. */
  serve(digest: string): Reply | null {
    return this.rows.get(digest)?.state === "label" ? this.cached(digest) : null;
  }
  writeCache(r: Reply): void {
    const f = join(this.cache, r.digest + ".json");
    writeFileSync(f + ".tmp", JSON.stringify(r), { mode: 0o600 });
    renameSync(f + ".tmp", f);
  }
  /** Before any call on a relaunch: pending rows become label (reply in the cache) or unknown. */
  reconcile(): { recovered: number; unknown: number } {
    let recovered = 0, unknown = 0;
    for (const r of this.all())
      if (r.state === "pending") {
        if (this.cached(r.digest)) {
          this.set(r.digest, "label", r);
          recovered++;
        } else {
          this.set(r.digest, "unknown", r);
          unknown++;
        }
      }
    return { recovered, unknown };
  }
  hit(at: Crash, cell: string): void {
    if (this.crash && this.crash.at === at && this.crash.cell === cell) this.crash.exit();
  }
}

export interface Asked {
  digest: string;
  text: string | null;
  /** The label the parse gave, or null with missing set. */
  label: string | null;
  missing: string | null;
  cached: boolean;
  result: CallResult | null;
}

/**
 * Asks once through the journal. parse turns reply text into a label or a reason it is missing. A judged reply is
 * never re-asked; a call that failed with no settled reply is retried once (J1); an unknown outcome is never resent.
 */
export async function ask(j: Journal, call: (req: CallRequest) => Promise<CallResult>, req: CallRequest, parse: (text: string) => { label: string | null; missing: string | null }): Promise<Asked> {
  const digest = requestDigest(req.model, requestBody(MODELS[req.model], req.prompt, req.maxTokens, req.effort));
  const meta = { model: req.model, cell: req.label };
  for (;;) {
    const row = j.get(digest);
    if (row?.state === "leak") throw new MeterError("E_AR_PACKET_LEAK", "the metering proxy refused a packet (digest " + digest.slice(0, 12) + ") on this sink earlier; start a new run with a new sink");
    if (row?.state === "label") {
      const hit = j.serve(digest);
      if (hit) return { digest, text: hit.text, label: hit.label, missing: null, cached: true, result: null };
      return { digest, text: null, label: null, missing: "cache lost", cached: true, result: null };
    }
    if (row && (row.state === "invalid" || row.state === "unknown" || row.state === "retried" || row.state === "pending")) return { digest, text: null, label: null, missing: row.state === "pending" ? "unknown" : row.state, cached: true, result: null };
    if (row?.state === "failed" && row.retries >= 1) {
      j.set(digest, "retried", { ...meta, retries: row.retries });
      continue;
    }
    const retries = row?.state === "failed" ? row.retries + 1 : 0;
    j.set(digest, "pending", { ...meta, retries });
    let res: CallResult;
    try {
      res = await call(req);
    } catch (e) {
      j.set(digest, (e as { code?: string }).code === "E_AR_PROVIDER_DRIFT" ? "invalid" : "unknown", { ...meta, retries });
      throw e;
    }
    j.hit("after-settle", req.label);
    if (res.text === null && res.problem?.startsWith("E_TRIPWIRE")) {
      j.set(digest, "leak", { ...meta, retries });
      throw new MeterError("E_AR_PACKET_LEAK", "the metering proxy refused a packet (digest " + digest.slice(0, 12) + ") for a forbidden marker; no packet is sent again");
    }
    if (res.text === null && res.status !== 200 && res.unknown) {
      j.set(digest, "unknown", { ...meta, retries });
      return { digest, text: null, label: null, missing: "unknown", cached: false, result: res };
    }
    if (res.text === null && res.status !== 200) {
      j.set(digest, "failed", { ...meta, retries });
      continue;
    }
    if (res.text === null) {
      j.set(digest, "invalid", { ...meta, retries });
      return { digest, text: null, label: null, missing: "unreadable reply", cached: false, result: res };
    }
    const v = parse(res.text);
    if (v.label === null) {
      j.set(digest, "invalid", { ...meta, retries });
      return { digest, text: res.text, label: null, missing: v.missing, cached: false, result: res };
    }
    j.hit("before-cache", req.label);
    j.writeCache({ digest, text: res.text, label: v.label });
    j.hit("after-cache", req.label);
    j.set(digest, "label", { ...meta, retries });
    return { digest, text: res.text, label: v.label, missing: null, cached: false, result: res };
  }
}
