// Copyright (c) 2026 Garry Tan. MIT License.
// The no-gstack arm's exposure check (clean-room rule: FOUN-32 from another crew's run, and the P0 notes on GST-881). A bare arm's
// trial whose records show gstack's skills listed or loaded, or a read of a gstack install or a Capy drive path, is
// contaminated: excluded from the comparison and counted, never scored as "no effect". Read from the evaluator's own
// record of the session (sdk-messages.jsonl), every tool call and result included. Conservative on purpose: an attempt
// that found nothing still counts, because a clean arm has no reason to look.

export interface Exposure {
  contaminated: boolean;
  evidence: { kind: "skill_listed" | "skill_load" | "path_read" | "path_seen" | "torn_tail"; detail: string; phase: string | null }[];
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

/** Whether a skill name cut off by a torn line could be gstack's: it starts one of the pinned tree's skill names (with
 * or without a plugin prefix). The conservative reading for contamination. */
const isGstackPrefix = (cut: string, gstackSkills: ReadonlySet<string>): boolean => {
  const bare = cut.replace(/^\//, "");
  return [bare, bare.slice(bare.indexOf(":") + 1)].some((p) => [...gstackSkills].some((s) => s.startsWith(p)));
};

const text = (x: unknown): string => (typeof x === "string" ? x : JSON.stringify(x ?? ""));

/** JSON text with its string escapes decoded, and control characters read as a space, so a path after an escaped
 * newline or tab reads as it does after the character itself. */
const unescaped = (json: string): string =>
  json.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (_, u: string | undefined, c: string) => (u ? String.fromCharCode(parseInt(u, 16)) : "bfnrt".includes(c) ? " " : c)).replace(/[\u0000-\u001f]/g, " ");

/** The first gstack install or Capy drive path that JSON text names, read as written and with its escapes decoded. The
 * record scan and the torn-tail scan both read through it, so the same text reads the same whole or torn. */
function pathIn(json: string): string | null {
  for (const s of [json, unescaped(json)]) {
    const m = s.match(DRIVE_PATH) ?? s.match(GSTACK_PATH);
    if (m) return m[0].trim();
  }
  return null;
}

/** tornTail is the raw text of a torn last transcript line the records leave out: it is still scanned for a gstack or
 * drive path and a Skill call naming a gstack skill. */
export function exposureCheck(records: readonly unknown[], gstackSkills: readonly string[], tornTail: string | null = null): Exposure {
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
        if (pathIn(JSON.stringify(b.input ?? "")) !== null) add("path_read", (b.name ?? "?") + ": " + input, phase);
        else if (/gstack/i.test(input)) flag("gstack_mention", (b.name ?? "?") + ": " + input, phase);
      } else if (b?.type === "tool_result") {
        const path = pathIn(JSON.stringify(b.content ?? ""));
        if (path !== null) add("path_seen", "a tool result names " + path, phase);
      }
    }
  }
  if (tornTail !== null) {
    const path = pathIn(tornTail);
    if (path !== null) add("torn_tail", "the dropped torn line names " + path, null);
    const loads = [...tornTail.matchAll(/"name"\s*:\s*"Skill"[\s\S]*?"(?:skill|command|name)"\s*:\s*"([^"]*)/g)].map((m) => ({ n: m[1], cut: m.index + m[0].length === tornTail.length }));
    const gstack = loads.filter(({ n, cut }) => isGstackSkill(n, skills) || (cut && isGstackPrefix(n, skills)));
    for (const { n } of gstack) add("torn_tail", isGstackSkill(n, skills) ? "the dropped torn line loads " + n : "the dropped torn line loads a skill cut short at " + n + ", the start of a gstack skill name", null);
    if (path === null && !gstack.length && /gstack/i.test(tornTail)) flag("gstack_mention", "the dropped torn line: " + tornTail, null);
  }
  out.contaminated = out.evidence.length > 0;
  return out;
}
