// Copyright (c) 2026 Garry Tan. MIT License.
// What a gstack arm session actually ran (prereg section 8, R48's procedure gate), read from autoplan's own run record
// in the session's copied state root (host/gstack-state), never from what the model said.
// - The run is the run.json under the state root whose plan_input or plan_source names plan.md, latest updated_at first.
// - Exposed: the run's status is complete (the gate was answered and applied); CEO and Eng closed; Design closed or
//   skipped by autoplan's own scope rule; every closed phase's native voice completed; and every closed phase's outside
//   voice ended (completed, or recorded unavailable or failed). An outside voice that is disabled (the config turned it
//   off) or skipped never ran, so its session is not exposed, with that reason. Anything less is not exposed: reported,
//   never a loss.
// - Voice: astra when the voice slot sent at least one request and every closed phase's outside voice completed;
//   otherwise fallback (E_DAYONE_VOICE), logged per session.
// - The arm's plan: plan.md at the session's end when it differs from the base plan; otherwise the run's active plan
//   (run.json active_plan, or the exported plan.md artifact) when that differs from the base; otherwise plan.md as is.
// - loadedSkills: every Skill tool call and every Read of a SKILL.md or skill reference file in the transcript,
//   subagents included, with its path, for the loaded-skill log. On an arm with no gstack any entry marks the session.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readTranscript } from "../../src/trial/review/readers.ts";

export interface PhaseRead {
  state: "closed" | "skipped" | "open" | "absent";
  native: string | null;
  outside: string | null;
}
export interface Exposure {
  run: string | null;
  status: string | null;
  phases: Record<"ceo" | "design" | "eng", PhaseRead>;
  outside_model: string | null;
  exposed: boolean;
  voice: "astra" | "fallback";
  why: string;
}

/** Every run.json under dir, with its parsed body. */
function runs(dir: string): { path: string; body: any }[] {
  const out: { path: string; body: any }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 8 || !existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name === "run.json") {
        try {
          out.push({ path: p, body: JSON.parse(readFileSync(p, "utf8")) });
        } catch {
          // an unreadable run is no run
        }
      }
    }
  };
  walk(dir, 0);
  return out;
}

const phaseRead = (p: any): PhaseRead => {
  if (!p) return { state: "absent", native: null, outside: null };
  if (p.skipped) return { state: "skipped", native: null, outside: null };
  return { state: p.closed_at ? "closed" : "open", native: p.native?.status ?? null, outside: p.outside?.status ?? null };
};

/** The session's autoplan run, read from its copied state root. */
export function readExposure(stateRoot: string, voiceRequests: number): Exposure {
  const found = runs(stateRoot).filter((r) => /(^|\/)plan\.md$/.test(String(r.body?.plan_input ?? r.body?.plan_source ?? "")) || r.body?.plan_input === undefined);
  found.sort((a, b) => String(b.body?.updated_at ?? "").localeCompare(String(a.body?.updated_at ?? "")));
  const r = found[0];
  const empty: PhaseRead = { state: "absent", native: null, outside: null };
  if (!r) return { run: null, status: null, phases: { ceo: empty, design: empty, eng: empty }, outside_model: null, exposed: false, voice: "fallback", why: "no autoplan run.json in the state root" };
  const b = r.body;
  const phases = { ceo: phaseRead(b.phases?.ceo), design: phaseRead(b.phases?.design), eng: phaseRead(b.phases?.eng) };
  const closed = Object.entries(phases).filter(([, p]) => p.state === "closed");
  const gaps: string[] = [];
  if (b.status !== "complete") gaps.push("run status " + JSON.stringify(b.status ?? null) + ", not complete");
  for (const k of ["ceo", "eng"] as const) if (phases[k].state !== "closed") gaps.push(k + " " + phases[k].state);
  if (phases.design.state !== "closed" && phases.design.state !== "skipped") gaps.push("design " + phases.design.state);
  for (const [k, p] of closed) {
    if (p.native !== "completed") gaps.push(k + " native voice " + p.native);
    if (p.outside === "disabled" || p.outside === "skipped") gaps.push(k + " outside voice " + p.outside + ", so it never ran");
    else if (!["completed", "unavailable", "failed"].includes(String(p.outside))) gaps.push(k + " outside voice " + p.outside);
  }
  const astra = voiceRequests > 0 && closed.length > 0 && closed.every(([, p]) => p.outside === "completed");
  return { run: relative(stateRoot, r.path), status: b.status ?? null, phases, outside_model: b.outside_model ?? null, exposed: gaps.length === 0, voice: astra ? "astra" : "fallback", why: gaps.length ? gaps.join("; ") : "every phase closed and the gate answered" };
}

/** The arm's plan text under the rule above. */
export function armPlan(out: string, base: string | null, stateRoot: string | null): { text: string; from: "plan.md" | "autoplan" | "none" } {
  const read = (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : "");
  const plan = read(join(out, "plan.md"));
  if (plan.trim() && (base === null || plan !== base)) return { text: plan, from: "plan.md" };
  if (stateRoot && base !== null) {
    const r = runs(stateRoot).sort((a, b) => String(b.body?.updated_at ?? "").localeCompare(String(a.body?.updated_at ?? "")))[0];
    const candidates = r ? [r.body?.active_plan, r.body?.artifacts?.["plan.md"]?.path].filter((p): p is string => typeof p === "string") : [];
    for (const c of candidates) {
      const p = c.startsWith("/") ? join(stateRoot, relative(String(r!.body?.out ?? "/"), c)) : join(stateRoot, c);
      const t = read(p) || read(join(r!.path, "..", c.split("/").pop()!));
      if (t.trim() && t !== base) return { text: t, from: "autoplan" };
    }
  }
  return plan.trim() ? { text: plan, from: "plan.md" } : { text: "", from: "none" };
}

export interface SkillLoad {
  tool: string;
  target: string;
}

/** Skill loads in a transcript, subagents included. */
export function loadedSkills(transcript: string): SkillLoad[] {
  const out: SkillLoad[] = [];
  for (const m of readTranscript(transcript)) {
    if (m.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content as Record<string, any>[]) {
      if (b?.type !== "tool_use") continue;
      if (b.name === "Skill") out.push({ tool: "Skill", target: String(b.input?.skill ?? b.input?.name ?? b.input?.command ?? "") });
      else if (b.name === "Read" && typeof b.input?.file_path === "string" && /(^|\/)(SKILL\.md|skills\/)/.test(b.input.file_path)) out.push({ tool: "Read", target: b.input.file_path });
    }
  }
  return out;
}
