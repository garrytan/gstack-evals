// Copyright (c) 2026 Garry Tan. MIT License.
// Step 1 of a week (lanes/weekly-stable/README.md): name the candidate and stable from gstack's own release gate. A full
// clone of gstack, used only here, runs resolve-shim.ts with gstack's release-cut code; decide() turns its output into what
// the week does. Nothing here touches an arm: the arms are fetched again at depth 1 by sha (build.sh).
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GSTACK } from "./pins.ts";

export type ShimOut = {
  schema: number;
  error?: string;
  repo?: string;
  now?: string;
  gstack_main?: string | null;
  gstack_main_version?: string | null;
  stable?: string | null;
  stable_tags?: string[];
  stable_version?: string | null;
  window?: { days: number; commits: number; since: string };
  notes_error?: string | null;
  hold?: string | null;
  walked?: { sha: string; green: boolean; via?: string; why?: string; pending?: boolean }[];
  candidate?: { sha: string; date: string; version: string | null; contains_stable: boolean | null; first_parent_commits_since_stable: number | null } | null;
};
export type Held = { sha: string; week: string; repair?: string | null };
export type Decision =
  | { kind: "run"; candidate: { sha: string; version: string | null; date: string; via: string }; stable: { sha: string; tag: string }; commits: number; hold: string | null }
  | { kind: "no-candidate" | "held" | "incomplete"; reason: string; candidate: { sha: string } | null; stable: { sha: string; tag: string } | null; hold: string | null };

const SHA = /^[0-9a-f]{40}$/;
const verKey = (t: string) => t.slice(1).split(".").map((x) => Number(x));
/** The newest v-tag among those at stable, by version. */
export function stableTag(tags: string[]): string | null {
  const ok = tags.filter((t) => /^v\d+(\.\d+)+$/.test(t)).sort((a, b) => { const x = verKey(a), y = verKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return a.length - b.length || a.localeCompare(b); });
  return ok.at(-1) ?? null;
}

/** What the week does, from the shim's output and the latest published HOLD (pre-run change 2, section 1). */
export function decide(o: ShimOut, held: Held | null = null): Decision {
  const hold = o.hold ?? null;
  const stop = (kind: "no-candidate" | "held" | "incomplete", reason: string, stable: { sha: string; tag: string } | null = null, candidate: string | null = null): Decision => ({ kind, reason, candidate: candidate ? { sha: candidate } : null, stable, hold });
  if (o.schema !== 1) return stop("incomplete", "resolver: the shim printed schema " + o.schema + ", not 1");
  if (o.error) return stop("incomplete", "resolver: " + o.error);
  if (o.notes_error) return stop("incomplete", "resolver: gstack's release-gate notes could not be read (" + o.notes_error + ")");
  if (!o.stable || !SHA.test(o.stable)) return stop("incomplete", "resolver: refs/heads/stable does not resolve");
  const tag = stableTag(o.stable_tags ?? []);
  if (!tag) return stop("incomplete", "no v-tag points at stable " + o.stable.slice(0, 12));
  const stable = { sha: o.stable, tag }, c = o.candidate ?? null;
  if (!c) return stop("no-candidate", "no candidate: no commit on gstack main in the last " + (o.window?.days ?? 7) + " days newer than stable is gated green", stable);
  if (!SHA.test(c.sha)) return stop("incomplete", "resolver: the candidate is not a sha", stable);
  if (c.sha === o.stable) return stop("no-candidate", "no candidate: the newest gated green commit is stable itself (" + tag + ")", stable, c.sha);
  if (c.contains_stable !== true) return stop("incomplete", "the candidate " + c.sha.slice(0, 12) + " does not contain stable " + o.stable.slice(0, 12), stable, c.sha);
  if (held && held.sha === c.sha && !held.repair) return stop("held", "the candidate " + c.sha.slice(0, 12) + " is the commit " + held.week + " held, and no repair is named: the week runs nothing and the HOLD stands", stable, c.sha);
  const via = o.walked?.find((w) => w.sha === c.sha)?.via ?? "unknown";
  return { kind: "run", candidate: { sha: c.sha, version: c.version, date: c.date, via }, stable, commits: c.first_parent_commits_since_stable ?? 0, hold };
}

const run = (cmd: string, args: string[], cwd?: string) => spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, timeout: 3_600_000 });
/** A fresh full clone (gstack's release cut needs origin's whole first-parent history and its notes ref), then the shim. */
export function resolveWeek(dir: string, now: number, url = process.env.GSTACK_CLONE_URL ?? GSTACK.repo): ShimOut {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const clone = run("git", ["clone", "-q", "--no-checkout", url, dir]);
  if (clone.status !== 0) return { schema: 1, error: "git clone failed: " + (clone.stderr ?? "").trim().slice(0, 300) };
  const co = run("git", ["-C", dir, "checkout", "-q", "--detach", "refs/remotes/origin/main"]);
  if (co.status !== 0) return { schema: 1, error: "checkout of origin/main failed: " + (co.stderr ?? "").trim().slice(0, 300) };
  const shim = run(process.execPath, [join(import.meta.dir, "resolve-shim.ts"), GSTACK.slug, String(now)], dir);
  if (shim.status !== 0) return { schema: 1, error: "the shim exited " + shim.status + ": " + (shim.stderr ?? "").trim().slice(-300) };
  try { return JSON.parse(shim.stdout.trim().split("\n").at(-1) ?? ""); } catch { return { schema: 1, error: "the shim printed no JSON: " + shim.stdout.slice(0, 200) }; }
}
