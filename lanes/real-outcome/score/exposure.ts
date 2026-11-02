// Copyright (c) 2026 Garry Tan. MIT License.
// The no-gstack arm's exposure check (clean-room rule: FOUN-32 from GGST-6, and the P0 notes on GST-881). A bare arm's
// trial whose records show gstack's skills listed or loaded, or a read of a gstack install or a Capy drive path, is
// contaminated: excluded from the comparison and counted, never scored as "no effect". Read from the evaluator's own
// record of the session (sdk-messages.jsonl), every tool call and result included. Conservative on purpose: an attempt
// that found nothing still counts, because a clean arm has no reason to look.

export interface Exposure {
  contaminated: boolean;
  evidence: { kind: "skill_listed" | "skill_load" | "path_read" | "path_seen"; detail: string; phase: string | null }[];
  /** Descriptive only: a gstack mention outside those paths, or a skill that is not gstack's. */
  flags: { kind: "gstack_mention" | "other_skill"; detail: string; phase: string | null }[];
  messages: number;
}

export const DRIVE_PATH = /\.capy\/drive|\/capy\/drive\b|\/drive\/(?:user|org|captain|project|project-user)-[\w-]+/;
export const GSTACK_PATH = /\.local\/share\/gstack|\.claude\/skills|\.claude\/plugins|\.agents\/skills|\.codex\/skills|(?:^|[\s'"=:(])(?:~|\$HOME|\$\{HOME\}|\/root|\/home\/[^/\s'"]+)\/\.gstack\b/;

const nameOf = (x: unknown): string | null => {
  const n = typeof x === "string" ? x : typeof x === "object" && x !== null && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : null;
  return n === null ? null : n.replace(/^\//, "");
};

/** Whether a skill name is gstack's: one of the pinned tree's skill names (with or without a plugin prefix) or any name
 * holding "gstack". */
export function isGstackSkill(skill: string, gstackSkills: ReadonlySet<string>): boolean {
  const bare = skill.replace(/^\//, "");
  return /gstack/i.test(bare) || gstackSkills.has(bare) || gstackSkills.has(bare.slice(bare.indexOf(":") + 1));
}

const text = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x ?? ""));

export function exposureCheck(records: readonly unknown[], gstackSkills: readonly string[]): Exposure {
  const skills = new Set(gstackSkills);
  const out: Exposure = { contaminated: false, evidence: [], flags: [], messages: records.length };
  const seen = new Set<string>();
  const add = (kind: Exposure["evidence"][number]["kind"], detail: string, phase: string | null) => {
    const key = kind + " " + detail;
    if (seen.has(key)) return;
    seen.add(key);
    out.evidence.push({ kind, detail: detail.slice(0, 300), phase });
  };
  const flag = (kind: Exposure["flags"][number]["kind"], detail: string, phase: string | null) => {
    if (out.flags.length < 50) out.flags.push({ kind, detail: detail.slice(0, 300), phase });
  };
  for (const r of records) {
    const rec = r as { type?: string; subtype?: string; phase?: string; data?: { skills?: unknown; slash_commands?: unknown }; content?: unknown };
    const phase = typeof rec.phase === "string" ? rec.phase : null;
    if (rec.type === "SystemMessage" && rec.subtype === "init" && rec.data) {
      for (const s of Array.isArray(rec.data.skills) ? rec.data.skills : []) {
        const n = nameOf(s);
        if (n === null) continue;
        if (isGstackSkill(n, skills)) add("skill_listed", n, phase);
        else flag("other_skill", "listed: " + n, phase);
      }
      for (const s of Array.isArray(rec.data.slash_commands) ? rec.data.slash_commands : []) {
        const n = nameOf(s);
        if (n !== null && /gstack/i.test(n)) add("skill_listed", "/" + n, phase);
      }
    }
    if (!Array.isArray(rec.content)) continue;
    for (const b of rec.content as { type?: string; name?: string; input?: Record<string, unknown>; content?: unknown }[]) {
      if (b?.type === "tool_use") {
        const input = text(b.input);
        if (b.name === "Skill") {
          const n = nameOf(b.input?.skill ?? b.input?.command ?? b.input?.name) ?? input;
          if (isGstackSkill(n, skills)) add("skill_load", n, phase);
          else flag("other_skill", "loaded: " + n, phase);
        }
        if (DRIVE_PATH.test(input) || GSTACK_PATH.test(input)) add("path_read", (b.name ?? "?") + ": " + input, phase);
        else if (/gstack/i.test(input)) flag("gstack_mention", (b.name ?? "?") + ": " + input, phase);
      } else if (b?.type === "tool_result") {
        const m = text(b.content).match(DRIVE_PATH) ?? text(b.content).match(GSTACK_PATH);
        if (m) add("path_seen", "a tool result names " + m[0].trim(), phase);
      }
    }
  }
  out.contaminated = out.evidence.length > 0;
  return out;
}
