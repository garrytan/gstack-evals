// The strip rule in sessions and the memory audit (the implicit state machines family; crew rule of 2026-11-09). P1's
// history.ts strips the unit's base tree once, before any arm setup, so every arm's snapshot is the stripped tree. Here:
// sessionTreeCheck re-lists that tree as a session will see it and refuses with E_SM_STRIP if anything the rule removes is
// back; memoryPaths and auditMemory read what Claude Code loaded as memory, from request bodies (the stub upstream's log
// in the dry run) or a transcript's text (paid runs, where the proxy journal keeps no bodies), and report any memory file
// inside the repository (E_SM_STRIP) and, for A3, whether gstack's installed instructions arrived.
import { LIST_SCRIPT, runBash, stripPlan, type Where } from "./history.ts";
import { smFail } from "./unit.ts";

const MEMORY = /Contents of ([^\n]+?) \((?:project|user|local)[^)\n]*\)/g;

/** The strip rule's listing of a session tree: refuses when any CLAUDE.md, CLAUDE.local.md, AGENTS.md or .claude/ is present. */
export function sessionTreeCheck(where: Where, repoDir: string, label: string): { head: string } {
  const r = runBash(where, LIST_SCRIPT);
  if (r.status !== 0) smFail("E_SM_STRIP", label + ": the strip listing failed: " + r.stderr.slice(-300));
  const plan = stripPlan(r.stdout, repoDir);
  if (plan.remove.length) smFail("E_SM_STRIP", label + ": the session tree holds files the strip rule removes: " + plan.remove.slice(0, 10).join(", "));
  return { head: plan.head };
}

/** Every string inside a JSON value, depth first. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** Each instructions attachment's file paths in Claude Code's own session transcript (CLAUDE_CONFIG_DIR/projects/<cwd>/<session>.jsonl at 2.1.312). */
function attachmentPaths(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) attachmentPaths(x, out);
  else if (v && typeof v === "object") {
    const o = v as Record<string, any>;
    if (o.type === "instructions" && Array.isArray(o.files)) for (const f of o.files) if (typeof f?.path === "string") out.push(f.path);
    for (const x of Object.values(o)) attachmentPaths(x, out);
  }
  return out;
}

/** The memory files Claude Code loaded: each "Contents of <path> (...)" its requests or transcript carry, and each instructions attachment's path. */
export function memoryPaths(records: unknown[]): string[] {
  const seen = new Set<string>(attachmentPaths(records));
  for (const s of strings(records)) for (const m of s.matchAll(MEMORY)) seen.add(m[1]!);
  return [...seen].sort();
}

export interface MemoryAudit { loaded: string[]; inside_repo: string[]; gstack: "present" | "partial" | "absent" | "not_checked"; ok: boolean }

/** No arm loads a memory file from inside repo_dir. A3 (told) must carry every gstack marker (recorded at freeze); a no-gstack arm must carry none. */
export function auditMemory(records: unknown[], repoDir: string, told: boolean, gstackMarkers: string[] | null): MemoryAudit {
  const loaded = memoryPaths(records);
  const root = repoDir.replace(/\/+$/, "") + "/";
  const inside = loaded.filter((p) => p.startsWith(root) || p === repoDir);
  const text = strings(records).join("\n");
  const hits = (gstackMarkers ?? []).filter((m) => text.includes(m)).length;
  const gstack = !gstackMarkers?.length ? "not_checked" : hits === gstackMarkers.length ? "present" : hits ? "partial" : "absent";
  const ok = !inside.length && (gstack === "not_checked" || gstack === (told ? "present" : "absent"));
  return { loaded, inside_repo: inside, gstack, ok };
}

/** The audit as a refusal: E_SM_STRIP names what broke the rule. */
export function requireCleanMemory(a: MemoryAudit, label: string, told: boolean): void {
  if (a.inside_repo.length) smFail("E_SM_STRIP", label + ": memory loaded from inside the repository: " + a.inside_repo.join(", "));
  if (told && a.gstack !== "present") smFail("E_SM_STRIP", label + ": A3's request carries no gstack instructions (" + a.gstack + ")");
  if (!told && a.gstack === "present") smFail("E_SM_STRIP", label + ": a no-gstack arm's request carries gstack's instructions");
}
