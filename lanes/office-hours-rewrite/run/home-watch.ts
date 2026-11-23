// Copyright (c) 2026 Garry Tan. MIT License.
// F1 and G1 of the office-hours rewrite eval's pre-run change 5, on every Sol session.
// - F1, the harness's watch on Codex's home: the Sol driver (run/codex.ts) runs SNAPSHOT through session.exec before
//   every exec, after every exec and after the rollouts are copied out, never through the agent. A snapshot lists every
//   entry under $HOME/.codex (type, inode, size, ctime, mtime, path), the sha256 of every rollout, and the sha256 of each
//   rollout's first N bytes, N being its size at the previous snapshot. ctime cannot be set back by a user and a
//   delete and recreate changes the inode, so a touched file shows even when its bytes and mtime are put back.
//   Consecutive snapshots are diffed into creates, modifies, truncations, deletes and moves (the same inode under a new
//   path) and judged: between execs, when Codex is not running, any event is a flag; across an exec, an event is a flag
//   unless it is a live rollout's own create or append, or frozen.CODEX_HOME_ALLOW lists its kind and path (what a clean
//   keyless Codex 0.170 session writes); and a live rollout that does not start with the bytes hashed at the previous
//   snapshot is a flag. A snapshot that fails or prints no END record is a flag. Every snapshot and diff goes to
//   host/codex/home-watch.ndjson.
// - F1, the event stream: a tool item whose command, arguments or file_change path names Codex's home, its sessions or a
//   rollout (streamFlags), in the exec --json events the adapter holds and in the rollouts' own tool calls. Running or
//   reading the skill install by its path (.codex/skills/... with no "..") is no flag; a write there shows in the
//   snapshots.
// - G1: every turn's turn_context records collaboration mode default (nonDefaultTurns).
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import { CODEX_HOME_ALLOW } from "../frozen.ts";

export interface Entry {
  /** find's %y: f, d, l, p, s, b or c. */
  type: string;
  ino: string;
  size: number;
  ctime: string;
  mtime: string;
  /** Relative to $HOME/.codex; "" is the directory itself. */
  path: string;
}

export interface Snapshot {
  entries: Map<string, Entry>;
  /** Every regular rollout file: its sha256 and size. */
  rollouts: Map<string, { sha256: string; size: number }>;
  /** sha256 of each previous rollout's first N bytes, N its size at the previous snapshot. */
  prefixes: Map<string, string>;
}

export type HomeEvent =
  | { kind: "create" | "delete" | "truncate"; path: string; type: string }
  | { kind: "modify"; path: string; type: string; what: string[] }
  | { kind: "move"; path: string; from: string; type: string };

/** The rollouts Codex writes: sessions/YYYY/MM/DD/rollout-*.jsonl. */
export const ROLLOUT = /^sessions\/[^/]+\/[^/]+\/[^/]+\/rollout-[^/]*\.jsonl$/;

/**
 * The harness's snapshot of Codex's home, run as a shell step. stdin holds "<size>\t<path>" for every rollout of the
 * previous snapshot. Records end in NUL: find's entries, then P (a prefix hash) and R (a rollout hash) records, then END.
 * Absolute tool paths and a fixed PATH keep the agent's own files out of the step.
 */
export const SNAPSHOT = [
  "PATH=/usr/bin:/bin; export PATH; H=\"$HOME/.codex\"; T=\"$(printf '\\t')\"",
  "if [ -e \"$H\" ] || [ -h \"$H\" ]; then /usr/bin/find \"$H\" -xdev -printf '%y\\t%i\\t%s\\t%C@\\t%T@\\t%P\\0' || exit 1; fi",
  "while IFS=\"$T\" read -r n p; do [ -n \"$p\" ] || continue; if [ -f \"$H/$p\" ] && [ ! -h \"$H/$p\" ]; then s=\"$(/usr/bin/head -c \"$n\" -- \"$H/$p\" | /usr/bin/sha256sum)\" || exit 1; printf 'P\\t%s\\t%s\\000' \"${s%% *}\" \"$p\"; fi; done",
  "for f in \"$H\"/sessions/*/*/*/rollout-*.jsonl; do if [ -f \"$f\" ] && [ ! -h \"$f\" ]; then s=\"$(/usr/bin/sha256sum < \"$f\")\" || exit 1; printf 'R\\t%s\\t%s\\000' \"${s%% *}\" \"${f#\"$H\"/}\"; fi; done",
  "printf 'END\\000'",
].join("\n");

/** A snapshot's records, or null when it holds no END record or a record it cannot read. */
export function parseSnapshot(stdout: string): Snapshot | null {
  const records = stdout.split("\0");
  if (records.at(-1)?.trim() !== "" || records.at(-2)?.replace(/^\n+/, "") !== "END") return null;
  const s: Snapshot = { entries: new Map(), rollouts: new Map(), prefixes: new Map() };
  for (const raw of records.slice(0, -2)) {
    const rec = raw.replace(/^\n+/, "");
    const f = rec.split("\t");
    if (f[0] === "P" || f[0] === "R") {
      const path = f.slice(2).join("\t");
      if (!/^[0-9a-f]{64}$/.test(f[1] ?? "")) return null;
      if (f[0] === "P") s.prefixes.set(path, f[1]!);
      else s.rollouts.set(path, { sha256: f[1]!, size: -1 });
      continue;
    }
    if (f.length < 6 || !/^[a-zA-Z]$/.test(f[0]!) || !/^\d+$/.test(f[1]!) || !/^\d+$/.test(f[2]!)) return null;
    const path = f.slice(5).join("\t");
    s.entries.set(path, { type: f[0]!, ino: f[1]!, size: Number(f[2]), ctime: f[3]!, mtime: f[4]!, path });
  }
  for (const [p, r] of s.rollouts) {
    const e = s.entries.get(p);
    if (!e) return null;
    r.size = e.size;
  }
  return s;
}

/** What changed from a to b: an inode at a new path is a move, a smaller file under the same inode a truncation. */
export function diffSnapshots(a: Snapshot, b: Snapshot): HomeEvent[] {
  const events: HomeEvent[] = [];
  const inA = new Map<string, Entry>();
  for (const e of a.entries.values()) inA.set(e.ino, e);
  const moved = new Set<string>();
  for (const eb of b.entries.values()) {
    const ea = a.entries.get(eb.path);
    if (ea && ea.ino === eb.ino && ea.type === eb.type) {
      if (eb.type === "f" && eb.size < ea.size) events.push({ kind: "truncate", path: eb.path, type: eb.type });
      else {
        const what = (["size", "ctime", "mtime"] as const).filter((k) => ea[k] !== eb[k]);
        if (what.length) events.push({ kind: "modify", path: eb.path, type: eb.type, what });
      }
      continue;
    }
    const from = inA.get(eb.ino);
    if (from && from.path !== eb.path && from.type === eb.type && b.entries.get(from.path)?.ino !== eb.ino) {
      events.push({ kind: "move", path: eb.path, from: from.path, type: eb.type });
      moved.add(from.path);
    } else events.push({ kind: "create", path: eb.path, type: eb.type });
  }
  for (const ea of a.entries.values()) {
    if (moved.has(ea.path)) continue;
    const eb = b.entries.get(ea.path);
    if (!eb || eb.ino !== ea.ino || eb.type !== ea.type) events.push({ kind: "delete", path: ea.path, type: ea.type });
  }
  return events;
}

const glob = (g: string): RegExp => new RegExp("^" + g.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join("[^/]*") + "$");
const show = (e: HomeEvent): string => e.kind + " " + (e.kind === "move" ? e.from + " to " : "") + (e.path || ".") + (e.kind === "modify" ? " (" + e.what.join(", ") + ")" : "") + (e.type === "f" ? "" : " [" + e.type + "]");

/** Whether a clean Codex session makes this event across an exec: a live rollout's create or append, or a frozen allow-list row. */
export function codexOwn(e: HomeEvent): boolean {
  if (ROLLOUT.test(e.path) && e.type === "f" && (e.kind === "create" || e.kind === "modify")) return true;
  return CODEX_HOME_ALLOW.some((r) => r.kind === e.kind && r.type === e.type && glob(r.path).test(e.path) && (e.kind !== "move" || glob(r.from ?? "").test(e.from)));
}

const parent = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * The flags one diff raises: any event while Codex was not running; across an exec, any event Codex does not make itself;
 * and any rollout that fails the prefix check. A directory's own modify (its entries changed) counts as Codex's only when
 * an event of Codex's own in the same exec created, deleted or moved an entry directly inside it, so a rollout deleted
 * and written back under a reused inode number still shows in its directory.
 */
export function judge(a: Snapshot, b: Snapshot, events: readonly HomeEvent[], o: { label: string; since: string; turn: boolean }): string[] {
  const own = new Set(o.turn ? events.filter((e) => !(e.kind === "modify" && e.type === "d") && codexOwn(e)) : []);
  const touched = new Set([...own].filter((e) => e.kind !== "modify" && e.kind !== "truncate").flatMap((e) => [parent(e.path), ...(e.kind === "move" ? [parent(e.from)] : [])]));
  const isOwn = (e: HomeEvent) => own.has(e) || (o.turn && e.kind === "modify" && e.type === "d" && (touched.has(e.path) || codexOwn(e)));
  const flags = events.filter((e) => !isOwn(e)).map((e) => o.label + ": " + show(e) + (o.turn ? "" : ", between execs"));
  for (const [p, r] of a.rollouts) if (b.prefixes.get(p) !== r.sha256) flags.push(o.label + ": rollout " + p + " fails the prefix check: it does not start with the " + r.size + " bytes hashed " + o.since + (b.rollouts.has(p) ? "" : " (gone)"));
  return flags;
}

/** The watch over one Sol session: snap runs one snapshot, logs it with its diff against the last good one, and keeps the flags. */
export function homeWatch(session: Pick<AgentSession, "exec">, log: string) {
  const flags: string[] = [];
  let last: { label: string; snap: Snapshot } | null = null;
  let snapshots = 0;
  const write = (x: object) => appendFileSync(log, JSON.stringify(x) + "\n");
  return {
    flags,
    get snapshots() {
      return snapshots;
    },
    last: (): Snapshot | null => last?.snap ?? null,
    /** turn: an exec ran since the previous snapshot. */
    snap(label: string, turn: boolean): void {
      snapshots++;
      const input = last ? [...last.snap.rollouts].map(([p, r]) => r.size + "\t" + p + "\n").join("") : "";
      let r: { exitCode: number | null; stdout: string; timedOut: boolean } | null = null;
      try {
        r = session.exec(SNAPSHOT, 60_000, input);
      } catch {
        r = null;
      }
      const s = r && r.exitCode === 0 && !r.timedOut ? parseSnapshot(r.stdout) : null;
      write({ snapshot: label, ok: s !== null, exit: r?.exitCode ?? null, entries: s ? [...s.entries.values()] : [], rollouts: s ? [...s.rollouts].map(([path, x]) => ({ path, ...x })) : [] });
      if (!s) {
        flags.push(label + ": the snapshot of Codex's home failed or printed no END record");
        return;
      }
      if (last) {
        const events = diffSnapshots(last.snap, s);
        const raised = judge(last.snap, s, events, { label, since: last.label, turn });
        flags.push(...raised);
        write({ diff: last.label + " to " + label, turn, events, flags: raised });
      } else if (s.rollouts.size) flags.push(label + ": " + s.rollouts.size + " rollouts before the first exec");
      last = { label, snap: s };
    },
  };
}

/** The flags the copied rollouts raise against the last snapshot: each must be the bytes it hashed, and the session's own rollout must be there once. */
export function copyFlags(last: Snapshot | null, thread: string | null, copied: readonly { name: string; bytes: Buffer }[]): string[] {
  if (!thread) return [];
  if (!last) return ["no snapshot to check the copied rollouts against"];
  const flags: string[] = [];
  const byName = new Map([...last.rollouts].map(([p, r]) => [p.slice(p.lastIndexOf("/") + 1), r] as const));
  for (const c of copied) {
    const r = byName.get(c.name);
    if (!r || r.sha256 !== createHash("sha256").update(c.bytes).digest("hex")) flags.push("the copied " + c.name + " is not the bytes the last snapshot hashed");
  }
  const own = [...last.rollouts.keys()].filter((p) => p.endsWith("-" + thread + ".jsonl"));
  if (own.length !== 1) flags.push(own.length + " rollouts of the session's thread " + thread + " in the last snapshot");
  if (!copied.some((c) => c.name.endsWith("-" + thread + ".jsonl"))) flags.push("the session's rollout was not copied out");
  return flags;
}

const DELIM = "[^\\s\"'\x60;|&<>()]";
const SKILL_PATH = new RegExp("^/skills(?:/" + DELIM + "*)?(?!" + DELIM + ")");
const SKILL_ROOT = new RegExp("\\$\\{CODEX_HOME:-~/\\.codex\\}/skills/gstack(?=/|\\\\|(?!" + DELIM + "))(" + DELIM + "*)", "g");

/** Whether text names Codex's home, its sessions or a rollout; skillPath lets the skill install's own paths (.codex/skills/..., and pre-run change 7's exact root gstack renders for Codex, ${CODEX_HOME:-~/.codex}/skills/gstack, each with no "..") through. */
export function namesCodexHome(text: string, skillPath: boolean): boolean {
  if (skillPath) text = text.replace(SKILL_ROOT, (m, rest: string) => (rest.includes("..") ? m : ""));
  if (/CODEX_HOME|rollout|sessions\/\d{4}\//i.test(text)) return true;
  for (const m of text.matchAll(/\.codex/g)) {
    const rest = text.slice(m.index! + m[0].length);
    if (/^[A-Za-z0-9_-]/.test(rest)) continue;
    const skill = SKILL_PATH.exec(rest);
    if (!skillPath || !skill || skill[0].includes("..")) return true;
  }
  return false;
}

type Rec = Record<string, any>;
const clip = (s: string) => (s.length > 200 ? s.slice(0, 200) + "..." : s);
const lines = (text: string, f: (d: Rec) => void) => {
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let d: Rec;
    try {
      d = JSON.parse(raw);
    } catch {
      continue;
    }
    f(d);
  }
};

/** Event-stream flags: in the exec --json events (the adapter's host/codex/transcript.ndjson), a command, MCP arguments or file_change path naming Codex's home; in the rollouts, a tool call's input naming it. */
export function streamFlags(events: string, rollouts: readonly string[]): string[] {
  const flags = new Set<string>();
  lines(events, (ev) => {
    const item: Rec | undefined = ev?.item;
    if (!item || typeof item !== "object") return;
    if (item.type === "command_execution" && typeof item.command === "string" && namesCodexHome(item.command, true)) flags.add("stream: command " + clip(item.command));
    if (item.type === "file_change") for (const c of Array.isArray(item.changes) ? item.changes : []) if (typeof c?.path === "string" && namesCodexHome(c.path, false)) flags.add("stream: file_change " + clip(c.path));
    if (item.type === "mcp_tool_call" && namesCodexHome(JSON.stringify(item.arguments ?? null), true)) flags.add("stream: mcp_tool_call " + clip(JSON.stringify(item.arguments)));
  });
  for (const r of rollouts)
    lines(r, (d) => {
      if (d?.type !== "response_item") return;
      const p: Rec = d.payload ?? {};
      const input = p.type === "function_call" ? String(p.arguments ?? "") : p.type === "custom_tool_call" ? String(p.input ?? "") : p.type === "local_shell_call" ? JSON.stringify(p.action ?? null) : null;
      if (input !== null && namesCodexHome(input, true)) flags.add("stream: rollout " + p.type + " " + String(p.name ?? "") + " " + clip(input));
    });
  return [...flags];
}

/** G1: every started turn has a turn_context, and every turn_context records collaboration mode default; one line per other turn. */
export function nonDefaultTurns(rollouts: readonly { name: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const r of rollouts) {
    const started: string[] = [];
    const contexts: { id: string; mode: unknown }[] = [];
    lines(r.text, (d) => {
      const p: Rec = d?.payload ?? {};
      if (d?.type === "event_msg" && p.type === "task_started") started.push(String(p.turn_id ?? ""));
      if (d?.type === "turn_context") contexts.push({ id: String(p.turn_id ?? ""), mode: p.collaboration_mode?.mode });
    });
    for (const c of contexts) if (c.mode !== "default") out.push(r.name + " turn " + c.id + ": " + (c.mode === undefined ? "no collaboration mode" : "mode " + JSON.stringify(c.mode)));
    for (const id of started) if (!contexts.some((c) => c.id === id)) out.push(r.name + " turn " + id + ": no turn_context");
    if (!started.length && !contexts.length) out.push(r.name + ": no turn_context");
  }
  return out;
}

/** What the Sol driver reports on one attempt. */
export interface RolloutGuard {
  /** F1: every flag from the snapshots, the copy-out check and the event stream. */
  flags: string[];
  /** G1: every turn that did not record collaboration mode default. */
  non_default_turns: string[];
  /** The adapter could not read the rollout after a turn, or the session's rollout was not copied out. */
  rollout_unreadable: boolean;
  snapshots: number;
}
