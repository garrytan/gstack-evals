// Copyright (c) 2026 Garry Tan. MIT License.
// Agent commands that running as the unprivileged agent user can make fail, read from each session's trajectory.json
// (each action's command, its observation's raw_output and returncode), the way score/cli.ts reads the base-env hits:
// - pip_install: a pip install that exited non-zero;
// - cache_write: an output line naming a .cache path with a permission or read-only error (a write under ~/.cache failed);
// - git_global: a git config --global that exited non-zero;
// - sudo: any sudo, whatever its outcome.
// Counted per model and cell as sessions with at least one hit, with two flags: a cell where more than 10% of sessions hit
// one kind, and per model and kind the gap between the cell with the highest rate and the one with the lowest. A reading
// for the Captain, printed by admit and score; it is no verdict and carries no stop code.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const KINDS = ["pip_install", "cache_write", "git_global", "sudo"] as const;
export type Kind = (typeof KINDS)[number];
const WORDS: Record<Kind, string> = { pip_install: "pip install failed", cache_write: "~/.cache write failed", git_global: "git config --global failed", sudo: "sudo" };
export interface Run { command: string; output: string; returncode: number | null }
export type Row = { model: string; cell: string; sessions: number } & Record<Kind, number>;
export interface Reading { rows: Row[]; over_10pct: Array<{ model: string; cell: string; kind: Kind; rate: number }>; gaps: Array<{ model: string; kind: Kind; gap: number; high: string; low: string }> }

/** Each action in the trajectory with the output and exit code of the observation that answers it. */
export function commandRuns(traj: any): Run[] {
  const msgs: any[] = traj?.messages ?? [];
  const runs: Run[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i]?.role !== "assistant") continue;
    let j = i + 1;
    for (const a of msgs[i].extra?.actions ?? []) {
      while (j < msgs.length && msgs[j]?.role !== "assistant" && !(msgs[j]?.extra && "returncode" in msgs[j].extra)) j++;
      const o = j < msgs.length && msgs[j]?.role !== "assistant" ? msgs[j].extra : undefined;
      runs.push({ command: String(a?.command ?? ""), output: String(o?.raw_output ?? ""), returncode: typeof o?.returncode === "number" ? o.returncode : null });
      if (o) j++;
    }
  }
  return runs;
}

export function hitKinds(r: Run): Set<Kind> {
  const out = new Set<Kind>();
  const failed = r.returncode !== 0;
  if (failed && /\bpip3?(?:\.\d+)?\s+install\b/.test(r.command)) out.add("pip_install");
  if (r.output.split("\n").some((l) => /\.cache\b/.test(l) && /Permission denied|Errno 13|EACCES|not writable|Read-only file system/.test(l))) out.add("cache_write");
  if (failed && /\bgit\s+config\b[^;&|\n]*\s--global\b/.test(r.command)) out.add("git_global");
  if (/(?:^|[\s;&|(`$])sudo(?:\s|$)/.test(r.command)) out.add("sudo");
  return out;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function nonrootReading(dirs: readonly string[]): Reading {
  const read = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const rows = new Map<string, Row>();
  for (const d of dirs) {
    const s = read(join(d, "agent", "dr", "dr-summary.json"));
    const t = read(join(d, "agent", "dr", "trajectory.json"));
    if (!s || !t) continue;
    const k = s.model + " " + s.cell;
    const row = rows.get(k) ?? { model: String(s.model), cell: String(s.cell), sessions: 0, pip_install: 0, cache_write: 0, git_global: 0, sudo: 0 };
    row.sessions++;
    const hit = new Set(commandRuns(t).flatMap((r) => [...hitKinds(r)]));
    for (const kind of hit) row[kind]++;
    rows.set(k, row);
  }
  const sorted = [...rows.values()].sort((a, b) => a.model.localeCompare(b.model) || a.cell.localeCompare(b.cell));
  const over_10pct = sorted.flatMap((r) => KINDS.filter((k) => r[k] / r.sessions > 0.1).map((kind) => ({ model: r.model, cell: r.cell, kind, rate: round(r[kind] / r.sessions) })));
  const gaps = [...new Set(sorted.map((r) => r.model))].flatMap((model) => {
    const cells = sorted.filter((r) => r.model === model);
    if (cells.length < 2) return [];
    return KINDS.map((kind) => {
      const rate = (r: Row) => r[kind] / r.sessions;
      const high = cells.reduce((a, b) => (rate(b) > rate(a) ? b : a));
      const low = cells.reduce((a, b) => (rate(b) < rate(a) ? b : a));
      return { model, kind, gap: round(rate(high) - rate(low)), high: high.cell, low: low.cell };
    });
  });
  return { rows: sorted, over_10pct, gaps };
}

export function printNonroot(r: Reading): string[] {
  const pct = (x: number) => (100 * x).toFixed(1) + "%";
  return [
    "commands the non-root agent user can make fail, sessions with at least one per model and cell (a reading for the Captain):",
    ...(r.rows.length ? r.rows.map((x) => "  " + x.model + " " + x.cell + ": " + x.sessions + " sessions, " + KINDS.map((k) => WORDS[k] + " " + x[k]).join(", ")) : ["  none"]),
    "  cells where more than 10% of sessions hit one kind: " + (r.over_10pct.length ? r.over_10pct.map((o) => o.model + " " + o.cell + " " + o.kind + " " + pct(o.rate)).join("; ") : "none"),
    "  gap between cells (highest rate minus lowest, per model and kind): " + (r.gaps.length ? r.gaps.map((g) => g.model + " " + g.kind + " " + pct(g.gap) + (g.gap > 0 ? " (" + g.high + " over " + g.low + ")" : "")).join("; ") : "fewer than two cells"),
  ];
}
