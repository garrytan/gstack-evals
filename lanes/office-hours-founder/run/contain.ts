// Copyright (c) 2026 Garry Tan. MIT License.
// Containment for each office-hours founder session (prereg sections 5 and 14, I1):
// - workRepo: the working directory, a fresh git repository with one empty commit and no remote. .gstack-home is in
//   .git/info/exclude, so the state root the trial seeds on the office-hours arm never shows as a change.
// - probed: wraps the arm's sandbox so each agent container, just before it stops, is probed from inside and from the
//   host: the names (never the values) of its env variables, its mounts by docker inspect, and an egress probe to a
//   non-model host. A departure is a key-like name other than the slot's bearer (ANTHROPIC_AUTH_TOKEN), a mount at any
//   path but the work dir and HOME, or an egress probe that connects. A probe that cannot run records null.
// - gstackReads: every tool call in a transcript, subagents included, whose path, pattern or command names gstack. The
//   run scores it on none and lens sessions only, where any hit is a gstack-read session.
import { spawnSync } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { readTranscript } from "../../../src/trial/review/readers.ts";
import type { AgentSession, Sandbox } from "../../../src/trial/sandbox.ts";

/** The task id every session runs under, so the path the agent sees (/work/idea) names no unit, arm or model. */
export const TASK = "idea";

/** Creates the fresh work repository at dir and returns dir. */
export function workRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const git = (args: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=founder", "-c", "user.email=founder@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  for (const args of [["init", "-q", "-b", "main"], ["commit", "-q", "--allow-empty", "-m", "Start"]]) {
    const r = git(args);
    if (r.status !== 0) throw new Error("E_INTERNAL: git " + args[0] + " in the work repository failed: " + r.stderr.trim());
  }
  appendFileSync(join(dir, ".git", "info", "exclude"), ".gstack-home/\n");
  const commits = git(["rev-list", "--all", "--count"]).stdout.trim();
  const remotes = git(["remote"]).stdout.trim();
  if (commits !== "1" || remotes !== "") throw new Error("E_INTERNAL: the work repository holds " + commits + " commits and remotes " + JSON.stringify(remotes));
  return dir;
}

export interface Probe {
  /** The container's id as its hostname gives it. */
  container: string;
  /** Key-like env names other than the slot's bearer. */
  keys: string[];
  /** Mount destinations other than the work dir and HOME. */
  mounts: string[];
  egress: { open: boolean; detail: string };
}

const SEP = "---gse-probe---";
const KEY_NAME = /KEY$|KEY_|SECRET|PASSWORD|_TOKEN$/;
const BEARER = "ANTHROPIC_AUTH_TOKEN";

/** The probe's departures as plain lines. */
export const departures = (p: Probe): string[] => [...p.keys.map((k) => "env name " + k), ...p.mounts.map((m) => "mount " + m), ...(p.egress.open ? ["open egress (" + p.egress.detail + ")"] : [])];

/** Probes one agent container from inside and from the host; null when it cannot run. */
export function probe(session: AgentSession, docker: string, allowed: readonly string[]): Probe | null {
  const r = session.exec("hostname; echo " + SEP + "; awk 'BEGIN { for (k in ENVIRON) print k }'; echo " + SEP + "; curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com 2>&1; echo \" exit=$?\"", 30_000);
  const parts = r.stdout.split(SEP + "\n");
  if (r.exitCode !== 0 || parts.length !== 3) return null;
  const container = parts[0]!.trim();
  const inspect = spawnSync(docker, ["inspect", container, "--format", "{{json .Mounts}}"], { encoding: "utf8", timeout: 30_000 });
  if (inspect.status !== 0) return null;
  const mounts = (JSON.parse(inspect.stdout) as { Destination: string }[]).map((m) => m.Destination).filter((d) => !allowed.includes(d));
  const keys = parts[1]!.split("\n").map((k) => k.trim()).filter((k) => k && k !== BEARER && KEY_NAME.test(k));
  const egress = parts[2]!.trim();
  const exit = Number(/exit=(\d+)$/.exec(egress)?.[1] ?? "127");
  if (exit === 127) return null;
  return { container, keys, mounts, egress: { open: exit === 0, detail: "curl https://example.com: " + egress.slice(-120) } };
}

/** The sandbox with each agent session probed once, just before it stops. */
export function probed(sandbox: Sandbox, o: { docker: string; home: string; onProbe: (p: Probe | null) => void }): Sandbox {
  return {
    ...sandbox,
    agent(task, opts) {
      const session = sandbox.agent(task, opts);
      let done = false;
      return {
        ...session,
        stop() {
          if (!done) {
            done = true;
            o.onProbe(probe(session, o.docker, [sandbox.workPath(opts.work, task, opts.root), o.home]));
          }
          session.stop();
        },
      };
    },
  };
}

const READ_FIELDS: Readonly<Record<string, readonly string[]>> = { Read: ["file_path"], NotebookRead: ["notebook_path"], Glob: ["path", "pattern"], Grep: ["path", "glob"], LS: ["path"], Bash: ["command"] };

/** Every tool call in the transcript, subagents included, whose path, pattern or command names gstack. */
export function gstackReads(transcript: string): string[] {
  const hits: string[] = [];
  for (const m of readTranscript(transcript)) {
    if (m.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content as Record<string, any>[]) {
      if (b?.type !== "tool_use") continue;
      for (const f of READ_FIELDS[b.name] ?? []) {
        const v = b.input?.[f];
        if (typeof v === "string" && /gstack/i.test(v)) hits.push(b.name + " " + v.slice(0, 200));
      }
    }
  }
  return hits;
}
