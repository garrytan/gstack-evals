// The read audit for family SM (prereg section 4; descriptive, reported per arm): every Read, Grep, Glob and Bash tool
// input in a session, matched against gstack paths and drive paths. The arms are clean by construction; this checks it.
type Rec = { type: string; content?: unknown };

export const GSTACK_PATH = /\.local\/share\/gstack|\.claude\/skills|gstack/i;
export const DRIVE_PATH = /\.capy\/drive/i;
const TOOLS = new Set(["Read", "Grep", "Glob", "Bash"]);

export interface ReadAudit { inputs: number; gstack: number; drive: number; hits: Array<{ tool: string; input: string; kind: "gstack" | "drive" }> }

export function readAudit(records: Rec[]): ReadAudit {
  const out: ReadAudit = { inputs: 0, gstack: 0, drive: 0, hits: [] };
  for (const r of records) {
    if (r.type !== "AssistantMessage" || !Array.isArray(r.content)) continue;
    for (const b of r.content as Array<Record<string, any>>) {
      if (b.type !== "tool_use" || !TOOLS.has(b.name)) continue;
      out.inputs++;
      const input = JSON.stringify(b.input ?? {});
      for (const [kind, re] of [["drive", DRIVE_PATH], ["gstack", GSTACK_PATH]] as const) {
        if (!re.test(input)) continue;
        out[kind]++;
        out.hits.push({ tool: b.name, input: input.slice(0, 300), kind });
      }
    }
  }
  return out;
}

/** Counts per arm: sessions, sessions with any gstack read, sessions with any drive read. */
export function auditByArm(sessions: Array<{ cell: string; audit: ReadAudit }>): Record<string, { sessions: number; gstack: number; drive: number }> {
  const by: Record<string, { sessions: number; gstack: number; drive: number }> = {};
  for (const s of sessions) {
    const a = (by[s.cell] ??= { sessions: 0, gstack: 0, drive: 0 });
    a.sessions++;
    if (s.audit.gstack) a.gstack++;
    if (s.audit.drive) a.drive++;
  }
  return by;
}
