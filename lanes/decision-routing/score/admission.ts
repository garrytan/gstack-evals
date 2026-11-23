// Copyright (c) 2026 Garry Tan. MIT License.
// Admission (prereg section 7) from calibration and pilot sessions: room in the control (N's calibration pass rate 15% to
// 90% per creative model), transfer (N on Opus at 40% or more), the cut's ceiling (S3: the share of N's dollars in turns
// that edit no file; under 80% HOLDS can't occur), and per-contrast discordance from the pilot, pooled over both models,
// with the upper end of its 80% interval from a bootstrap that resamples whole tasks (10,000 draws, seed 20261112). A
// contrast whose bound is at most 0.20 has its non-inferiority test admitted.
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { bare, parse } from "../labels/shell.ts";

export const ROOM = { low: 0.15, high: 0.9 };
export const TRANSFER_OPUS = 0.4;
export const CEILING = 0.8;
export const DISCORDANCE = { seed: 20261112, draws: 10000, line: 0.2 };

export const roomCheck = (rate: number) => ({ rate, ok: rate >= ROOM.low && rate <= ROOM.high });
export const transferCheck = (rate: number) => ({ rate, ok: rate >= TRANSFER_OPUS });

const WRITE_TOOLS = new Set(["tee", "cp", "mv", "touch", "rm", "truncate", "install", "ln", "patch", "unlink", "dd"]);
const CODE_WRITE = /open\([^)]*,\s*['"][wax]b?\+?['"]|\.write_(text|bytes)\(|shutil\.(copy|move)|os\.(remove|rename|replace)\(/;
const TEST_RUN = /(^|[\s/])(pytest|py\.test|tox|nox|runtests\.py|nosetests|unittest)\b|manage\.py test|\b(make|npm|go|cargo) test\b/;
const SEARCHERS = new Set(["grep", "egrep", "rg", "ag", "find", "ls", "tree", "locate", "fd"]);
const READERS = new Set(["cat", "head", "tail", "nl", "less", "more", "wc", "sed", "awk", "diff", "stat"]);

/** Whether a command changes a file in the tree: a redirection to a file, an in-place edit, a file tool, a patch, or interpreter code that writes. */
export function editsFile(command: string): boolean {
  return parse(command).flat().some((cmd) => {
    if (cmd.redirects.some((r) => (r.op === ">" || r.op === ">>") && r.target && !/^\d+$/.test(r.target) && !r.target.startsWith("/dev/"))) return true;
    const words = bare(cmd.words);
    const name = words[0] ?? "";
    if (WRITE_TOOLS.has(name)) return true;
    if ((name === "sed" || name === "perl") && words.some((w) => /^-[a-zA-Z]*i/.test(w) || w.startsWith("--in-place"))) return true;
    if (name === "git" && ["apply", "am", "checkout", "restore", "mv", "rm"].includes(words[1] ?? "")) return true;
    if (name === "git" && words[1] === "stash" && ["pop", "apply"].includes(words[2] ?? "")) return true;
    return /^(python[0-9.]*|perl|ruby|node)$/.test(name) && CODE_WRITE.test([cmd.heredoc ?? "", ...words].join("\n"));
  });
}

export type TurnKind = "edit" | "submit" | "test" | "search" | "read" | "other";

export function turnKind(commands: readonly string[]): TurnKind {
  if (commands.some(editsFile)) return "edit";
  if (commands.some((c) => c.includes("COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"))) return "submit";
  if (commands.some((c) => TEST_RUN.test(c))) return "test";
  const first = (c: string) => { const w = bare(parse(c)[0]?.[0]?.words ?? []); return w[0] === "git" ? "git " + (w[1] ?? "") : w[0] ?? ""; };
  if (commands.some((c) => SEARCHERS.has(first(c)) || first(c) === "git grep" || first(c) === "git log")) return "search";
  if (commands.length && commands.every((c) => READERS.has(first(c)) || first(c) === "git show" || first(c) === "git diff")) return "read";
  return "other";
}

export interface Turn { usd: number; edits: boolean; kind: TurnKind }

/** One turn per assistant message of mini's trajectory, priced by the session's completed main-model calls in order. */
export function turnsOf(trajectory: { messages: Array<{ role: string; extra?: { actions?: Array<{ command?: string }> } }> }, callUsd: readonly number[]): { turns: Turn[]; aligned: boolean } {
  const assistant = trajectory.messages.filter((m) => m.role === "assistant");
  if (assistant.length !== callUsd.length) return { turns: [], aligned: false };
  return {
    aligned: true,
    turns: assistant.map((m, i) => {
      const commands = (m.extra?.actions ?? []).map((a) => a.command ?? "");
      const kind = turnKind(commands);
      return { usd: callUsd[i]!, edits: kind === "edit", kind };
    }),
  };
}

export function s3Share(turns: readonly Turn[]): { share: number; by_kind: Record<string, number>; total_usd: number; holds_possible: boolean } {
  const total = turns.reduce((s, t) => s + t.usd, 0);
  const by_kind: Record<string, number> = {};
  for (const t of turns) if (!t.edits) by_kind[t.kind] = (by_kind[t.kind] ?? 0) + t.usd / total;
  const share = total > 0 ? turns.filter((t) => !t.edits).reduce((s, t) => s + t.usd, 0) / total : 0;
  return { share, by_kind, total_usd: total, holds_possible: share >= CEILING };
}

export interface Discordance { d: number; n_pairs: number; n_tasks: number; upper80: number; admitted: boolean }

/** d = share of pairs (task and model) where the two cells differ; upper end of the 80% interval resampling whole tasks. */
export function discordance(pairs: ReadonlyArray<{ task: string; model: string; a: number; b: number }>, opts: { seed: number; draws: number } = DISCORDANCE): Discordance {
  if (!pairs.length) throw new Error("discordance needs at least one pilot pair");
  const by = new Map<string, { n: number; k: number }>();
  for (const p of pairs) { const t = by.get(p.task) ?? { n: 0, k: 0 }; t.n++; if (p.a !== p.b) t.k++; by.set(p.task, t); }
  const tasks = [...by.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, t]) => t);
  const g = tasks.length;
  const rng = seededRandom(opts.seed);
  const boot = new Array<number>(opts.draws);
  for (let i = 0; i < opts.draws; i++) {
    let n = 0, k = 0;
    for (let j = 0; j < g; j++) { const t = tasks[Math.floor(rng() * g)]!; n += t.n; k += t.k; }
    boot[i] = k / n;
  }
  boot.sort((x, y) => x - y);
  const upper80 = boot[Math.ceil(opts.draws * 0.9) - 1]!;
  return { d: tasks.reduce((s, t) => s + t.k, 0) / pairs.length, n_pairs: pairs.length, n_tasks: g, upper80, admitted: upper80 <= DISCORDANCE.line };
}
