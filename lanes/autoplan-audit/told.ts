// Copyright (c) 2026 Garry Tan. MIT License.
// Section 14: the told sessions under custody, and their mechanical readings (sections 5.1 and 5.5). custody() checks
// each sealed record's sha256 against its SHA256SUMS line, writes the identity (streamed in on stdin) to a fresh
// directory on /dev/shm, decrypts every record there with age, removes the identity and checks it is gone (test ! -e),
// runs the reader, removes the decrypted directory and checks it is gone, then sweeps /tmp, /var/tmp and
// ~/.capy/tool-outputs: files with a told record's name written since the opening are counted and deleted without
// being opened. Every step is a CUSTODY.md line; any failure stops the run with E_AR_CUSTODY. No model sees told
// content, and the reader returns counts only.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readTranscript } from "../outcome-skills/arms/exposure.ts";
import { diffScore } from "./diff.ts";
import { ArError, fail } from "./errors.ts";
import { sha256 } from "./frame.ts";
import type { Decision, Finding, RunRecord } from "./records.ts";
import { accepted, unitsOf } from "./units.ts";

export const TOLD_NAMES = /^(sdk-messages\.jsonl|real-summary\.json|usersim-events\.jsonl|record\.json|autoplan-gate\.log)$|\.told\b/;

export interface CustodyOptions {
  /** The sealed records (.age), each listed in sums. */
  files: string[];
  sums: string;
  log: string;
  identity: Buffer;
  shm?: string;
  sweep?: string[];
  now?: () => Date;
}

const line = (log: string, text: string, now: () => Date) => appendFileSync(log, "- " + now().toISOString() + " " + text + "\n");

export function custody<T>(o: CustodyOptions, read: (dir: string) => T): T {
  const now = o.now ?? (() => new Date());
  const shm = o.shm ?? "/dev/shm";
  const sweepDirs = o.sweep ?? ["/tmp", "/var/tmp", join(homedir(), ".capy/tool-outputs")];
  if (!existsSync(o.log)) writeFileSync(o.log, "# CUSTODY\n\n");
  const opened = now();
  const incident = (why: string): never => {
    line(o.log, "incident: " + why, now);
    return fail("E_AR_CUSTODY", why);
  };
  if (!existsSync(shm) || !realpathSync(shm).startsWith("/dev/shm")) incident("the decrypt directory is not on /dev/shm");
  for (const name of readdirSync(shm).filter((n) => n.startsWith("ar-custody-"))) {
    const left = join(shm, name);
    rmSync(left, { recursive: true, force: true });
    if (existsSync(left)) incident("a custody directory an earlier run left behind is still on disk after its removal");
    line(o.log, "incident: removed a leftover custody directory from an earlier run (test ! -e passed)", now);
  }
  const sums = new Map(readFileSync(o.sums, "utf8").split("\n").filter((l) => l.trim()).map((l) => [l.slice(66).trim(), l.slice(0, 64)] as const));
  for (const f of o.files) if (sums.get(basename(f)) !== sha256(readFileSync(f))) incident("a told record's sha256 differs from its SHA256SUMS line (" + basename(f).length + "-character name)");
  const dir = mkdtempSync(join(shm, "ar-custody-"));
  const dec = join(dir, "told");
  mkdirSync(dec, { mode: 0o700 });
  const identity = join(dir, "identity");
  line(o.log, "open: " + o.files.length + " told records, digests checked, decrypting into " + dir, now);
  let result: T | undefined;
  let error: unknown = null;
  try {
    writeFileSync(identity, o.identity, { mode: 0o600 });
    for (const f of o.files) {
      const out = join(dec, basename(f).replace(/\.age$/, ""));
      const r = spawnSync("age", ["-d", "-i", identity, "-o", out, f], { encoding: "utf8" });
      if (r.status !== 0) incident("age could not decrypt a told record (exit " + r.status + ")");
      if (out.endsWith(".tar")) {
        const x = spawnSync("tar", ["-xf", out, "-C", dec], { encoding: "utf8" });
        rmSync(out, { force: true });
        if (x.status !== 0) incident("a decrypted told archive did not extract");
      }
    }
    rmSync(identity, { force: true });
    if (existsSync(identity)) incident("the identity is still on disk after its removal");
    line(o.log, "identity removed (test ! -e passed)", now);
    result = read(dec);
  } catch (e) {
    error = e;
  } finally {
    rmSync(identity, { force: true });
    rmSync(dir, { recursive: true, force: true });
    const gone = !existsSync(dir) && !existsSync(identity);
    const swept = sweep(sweepDirs, opened);
    line(o.log, "close: decrypted directory removed (test ! -e " + (gone ? "passed" : "FAILED") + "), sweep deleted " + swept + " told-named files unopened", now);
    if (!gone) error ??= new ArError("E_AR_CUSTODY", "a decrypted told file is still on disk");
  }
  if (error) throw error;
  return result as T;
}

/** Counts and deletes, without opening, files with a told record's name written at or after since. */
export function sweep(dirs: readonly string[], since: Date): number {
  let n = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 6 || !existsSync(d)) return;
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(d, name);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(p, depth + 1);
      else if (TOLD_NAMES.test(name) && s.mtimeMs >= since.getTime() - 1000) {
        unlinkSync(p);
        n++;
      }
    }
  };
  for (const d of dirs) walk(d, 0);
  return n;
}

export interface ToldRow {
  job: string;
  /** The first question to the stand-in came before the gate question: true fails X-1's silence part; null when no gate question is seen. */
  questionBeforeGate: boolean | null;
  phases: string[];
  accepted: number;
  hits: number;
  /** No decisions or final plan could be rebuilt from the session's own writes. */
  missing: boolean;
}

/**
 * Reads one told session the way the E2 and E3 readers do (the evaluator dir's sdk-messages.jsonl): the session's own
 * t2 records, its AskUserQuestion calls (questions to the stand-in), and the files it wrote with Write and Edit. The gate
 * is the first question whose input names a gate. Accepted changes come from the decisions.jsonl it wrote, the final
 * plan from the last plan file it wrote, both read with the runner records' rules.
 */
export function readToldSession(job: string, evaluatorDir: string): ToldRow {
  const { records } = readTranscript(join(evaluatorDir, "sdk-messages.jsonl"));
  const own = records.filter((x: any) => x.phase === "t2" && x.parent_tool_use_id === null && x.type === "AssistantMessage" && Array.isArray(x.content));
  const uses = own.flatMap((x: any) => x.content.filter((b: any) => b?.type === "tool_use"));
  const asks = uses.map((b: any, i: number) => ({ i, b })).filter(({ b }: any) => b.name === "AskUserQuestion");
  const gate = asks.find(({ b }: any) => /\bgate\b/i.test(JSON.stringify(b.input ?? {})));
  const questionBeforeGate = gate ? asks.some(({ i }: any) => i < gate.i) : null;
  const files = new Map<string, string>();
  let lastPlan: string | null = null;
  for (const b of uses as any[]) {
    const p = String(b.input?.file_path ?? "");
    if (!p) continue;
    if (b.name === "Write" && typeof b.input.content === "string") files.set(p, b.input.content);
    else if (b.name === "Edit" && files.has(p) && typeof b.input.old_string === "string" && typeof b.input.new_string === "string") files.set(p, b.input.replace_all ? files.get(p)!.split(b.input.old_string).join(b.input.new_string) : files.get(p)!.replace(b.input.old_string, b.input.new_string));
    else continue;
    if (/plan[^/]*\.md$/i.test(p) && !/restore/i.test(p)) lastPlan = p;
  }
  const pick = (name: RegExp) => [...files.entries()].reverse().find(([p]) => name.test(basename(p)))?.[1] ?? null;
  const parseRows = <T>(t: string | null): T[] | null => {
    if (t === null) return null;
    try {
      return t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) as T[];
    } catch {
      return null;
    }
  };
  const decisions = parseRows<Decision>(pick(/^decisions\.jsonl$/));
  const findings = parseRows<Finding>(pick(/^findings\.jsonl$/));
  const plan = lastPlan ? files.get(lastPlan)! : null;
  const phases = (records.find((x: any) => x.type === "ResultMessage")?.phases as string[] | undefined) ?? [];
  if (!decisions || plan === null) return { job, questionBeforeGate, phases, accepted: 0, hits: 0, missing: true };
  const rec = { id: job, dir: evaluatorDir, kind: "full", run: { amendments: [] }, decisions, findings, gate: null, gates: new Map(), bound: new Map(), boundFindings: new Map(), reviewRecord: null, restore: pick(/^restore\.md$/), gatePlan: plan, prompts: new Map(), consensus: new Map(), files: [], unreadable: [] } as unknown as RunRecord;
  const acc = (unitsOf(rec) ?? []).filter(accepted);
  return { job, questionBeforeGate, phases, accepted: acc.length, hits: acc.filter((u) => diffScore(u.changeText ?? "", rec.restore ?? "", plan).hit).length, missing: false };
}

/** trials: job=<evaluator dir>:<gate state root>, relative to the decrypted directory. */
export function readTold(dir: string, trials: readonly string[]): ToldRow[] {
  return trials.map((t) => {
    const m = /^([^=]+)=([^:]+):(.+)$/.exec(t);
    if (!m) fail("E_USAGE", "a told trial is not job=<evaluator dir>:<gate state root>");
    const ev = join(dir, m![2]!);
    if (!existsSync(join(ev, "sdk-messages.jsonl"))) return { job: m![1]!, questionBeforeGate: null, phases: [], accepted: 0, hits: 0, missing: true };
    return readToldSession(m![1]!, ev);
  });
}
