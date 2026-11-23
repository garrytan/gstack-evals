// Copyright (c) 2026 Garry Tan. MIT License.
// The replay's item builders (README "Stage 2 replay"): they write the items file HM_REPLAY_ITEMS names, out of the
// repository because it quotes repository code. The route point draws from three public pools (SWE-rebench issue texts, the
// Terminal-Bench 2 instructions at Lane B's registry pin, and gstack's own routing fixtures at the arm pin). The done point
// is every Stage 1 session's final stop, with the inputs the live done hook sees (judge.ts doneFacts) and the grounded
// label (the final diff's hidden-test result). The risky point is 400 Bash commands sampled from Stage 1 sessions,
// stratified by model, plus the frozen written set (pins.ts riskyWritten). Each item carries ids, labels and digests, never
// item text, into the results.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doneFacts } from "./judge.ts";
import { REPLAY, riskyWritten, sha256 } from "./pins.ts";
import { drawStratified, type ReplayItem } from "./replay.ts";

// A Stage 1 session the done and sampled-risky builders read: its grading (pass is the final diff's hidden-test result)
// and its transcript (the claude-projects JSONL), with the repository root its commands ran in.
export type Session = { model: string; task: string; trial: string; pass: boolean; root: string; transcript: string };
export type Source = { id: string; text: string };
export type RoutePools = Record<(typeof REPLAY.routeSources)[number], Source[]>;

const fail = (m: string): never => { throw new Error("E_HM_REPLAY " + m); };
const digest16 = (...parts: string[]) => sha256(parts.join("\u0000")).slice(0, 16);

// Every Bash tool_use command in a transcript, in order, as the agent issued them.
export function bashCommands(transcript: string): string[] {
  const out: string[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let e: { message?: { content?: unknown } };
    try { e = JSON.parse(line); } catch { continue; }
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) if (b && typeof b === "object" && (b as { type?: string }).type === "tool_use" && String((b as { name?: string }).name).toLowerCase() === "bash") {
      const command = (b as { input?: { command?: unknown } }).input?.command;
      if (typeof command === "string" && command) out.push(command);
    }
  }
  return out;
}

// The live done hook's inputs for a session: judge.ts doneFacts from its transcript.
export const sessionFacts = (s: Session) => doneFacts(s.transcript);

// Done items: one per session, text the live hook's inputs, tests_pass the final diff's hidden-test result.
export function doneItems(sessions: Session[]): ReplayItem[] {
  return sessions.map((s) => ({ point: "done" as const, id: "done-" + s.trial, task: s.task, text: JSON.stringify(sessionFacts(s)), tests_pass: s.pass }));
}

const riskyText = (command: string, root: string) => JSON.stringify({ command, cwd: root, root });

// Sampled risky: n Bash commands drawn with the seed from Stage 1 sessions, stratified by model. Each command of each
// session is a candidate with a stable id, and the draw keeps its model, its task and the directory it ran in.
export function sampledRisky(sessions: Session[], n: number, seed: number): ReplayItem[] {
  const candidates = sessions.flatMap((s) => bashCommands(s.transcript).map((command, k) => ({ id: "rs-" + digest16(s.trial, String(k), command), model: s.model, task: s.task, root: s.root, command })));
  return drawStratified(candidates, (c) => c.model, [...new Set(sessions.map((s) => s.model))].sort(), n, seed)
    .map((c) => ({ point: "risky" as const, id: c.id, task: c.task, text: riskyText(c.command, c.root), origin: "sampled" as const, model: c.model }));
}

// Written risky: the frozen set, each command set in a task's working directory, the task picked with the seed.
export function writtenRisky(commands: string[], tasks: string[], workdir: string, seed: number): ReplayItem[] {
  if (!tasks.length) fail("the written risky set needs at least one task to set its commands in");
  const draw = drawStratified(commands.map((command, i) => ({ id: "rw-" + digest16(command), command, order: i })), () => "written", ["written"], commands.length, seed);
  return draw.map((c, i) => ({ point: "risky" as const, id: c.id, task: tasks[(i * 2654435761) % tasks.length]!, text: riskyText(c.command, workdir), origin: "written" as const }));
}

// Route items: n prompts drawn with the seed, stratified by source. Each keeps its source and prompt; a route item's task
// is its own id (replay.ts splits route by prompt).
export function routeItems(pools: RoutePools, n: number, seed: number): ReplayItem[] {
  const candidates = REPLAY.routeSources.flatMap((source) => (pools[source] ?? fail("the route pools lack " + source)).map((p) => ({ id: "route-" + source + "-" + p.id, source, text: p.text })));
  return drawStratified(candidates, (c) => c.source, REPLAY.routeSources, n, seed).map((c) => ({ point: "route" as const, id: c.id, task: c.id, text: c.text, source: c.source }));
}

export type BuildInput = { sessions: Session[]; pools: RoutePools; writtenTasks: string[]; workdir: string; seed?: number };

// The whole items file at the prereg counts (REPLAY.counts): route, done, sampled risky and written risky.
export function buildItems(o: BuildInput): ReplayItem[] {
  const seed = o.seed ?? 20261148, c = REPLAY.counts;
  if (o.sessions.length !== c.done) fail("the done point is every Stage 1 session's final stop (" + c.done + "), but " + o.sessions.length + " sessions were given");
  return [
    ...routeItems(o.pools, c.route, seed),
    ...doneItems(o.sessions),
    ...sampledRisky(o.sessions, c.risky_sampled, seed),
    ...writtenRisky(riskyWritten(), o.writtenTasks, o.workdir, seed),
  ];
}

// The SWE-rebench route pool: each pool task's instruction.md in the pinned Harbor export, as the pool's issue text.
export function sweRebenchPrompts(exportDir: string, taskIds: string[]): Source[] {
  return taskIds.map((id) => ({ id, text: readFileSync(join(exportDir, id, "instruction.md"), "utf8") }));
}
// The item builders read these source files and write the items file. Each route pool is a JSONL of {id, text}; the
// sessions manifest is a JSONL of {model, task, trial, pass, transcript_path, root}. The real population of the pools (the
// Terminal-Bench 2 clone and gstack's routing fixtures) and the sessions manifest is a Stage-2-build step.
export type BuildConfig = { sessions: string; pools: Record<string, string>; writtenTasks: string[]; workdir: string; seed?: number };
function readJsonl<T>(path: string): T[] { return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T); }

export function buildItemsFromConfig(cfg: BuildConfig): ReplayItem[] {
  const manifest = readJsonl<{ model: string; task: string; trial: string; pass: boolean; transcript_path: string; root: string }>(cfg.sessions);
  const sessions = manifest.map((m) => ({ model: m.model, task: m.task, trial: m.trial, pass: m.pass, root: m.root, transcript: readFileSync(m.transcript_path, "utf8") }));
  const pools = Object.fromEntries(REPLAY.routeSources.map((s) => [s, readJsonl<Source>(cfg.pools[s] ?? fail("the config lacks the " + s + " route pool"))])) as RoutePools;
  return buildItems({ sessions, pools, writtenTasks: cfg.writtenTasks, workdir: cfg.workdir, seed: cfg.seed });
}
