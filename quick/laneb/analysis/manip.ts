// Manipulation check for the explicit-invocation run. Reads a run's proxy session and request logs
// and reports, per (model, arm), the body-load rate (the share of invoked sessions whose first request
// carried an injected skill body, proved by cmd_expanded) and the median first-request prompt-token
// bound (a sanity column: the invoked arms should exceed none by about the skill body's token size).
// It reads the proxy's own records only and never touches the cost or ledger logic.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const INVOKED_ARMS = ["gstack", "placebo"];
// Pilot gate: body loads in at least 90% of invoked trials.
export const BODY_LOAD_THRESHOLD = 0.9;

export type SessionRow = {
  id?: string;
  model?: string;
  meta?: { arm?: string } & Record<string, unknown>;
  cmd_expanded?: boolean | null;
  first_req_prompt_tokens?: number | null;
};
export type RequestRow = { event?: string; session?: string; request?: number; input_tokens_bound?: number };

export type ManipCell = {
  model: string;
  arm: string;
  invoked: boolean;
  sessions: number;
  bodyLoads: number;
  bodyLoadRate: number | null;
  medianFirstReqPromptTokens: number | null;
  passes: boolean | null;
};
export type ManipReport = { cells: ManipCell[]; gatePass: boolean };

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// The lowest-numbered request of each session gives that session's first forwarded prompt-token bound,
// a fallback when a session row has no first_req_prompt_tokens of its own.
export function firstRequestTokens(requests: RequestRow[]): Map<string, number> {
  const lowRid = new Map<string, number>();
  const tokens = new Map<string, number>();
  for (const r of requests) {
    if (r.event !== "request" || !r.session || typeof r.request !== "number" || typeof r.input_tokens_bound !== "number") continue;
    const seen = lowRid.get(r.session);
    if (seen === undefined || r.request < seen) {
      lowRid.set(r.session, r.request);
      tokens.set(r.session, r.input_tokens_bound);
    }
  }
  return tokens;
}

export function computeManip(input: { sessions: SessionRow[]; requests?: RequestRow[] }): ManipReport {
  const firstReq = firstRequestTokens(input.requests ?? []);
  const groups = new Map<string, SessionRow[]>();
  for (const s of input.sessions) {
    const model = s.model ?? "?";
    const arm = s.meta?.arm ?? "?";
    const key = `${model}|${arm}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }
  const cells: ManipCell[] = [...groups.entries()]
    .map(([key, rows]) => {
      const [model, arm] = key.split("|");
      const invoked = INVOKED_ARMS.includes(arm);
      const bodyLoads = rows.filter((r) => r.cmd_expanded === true).length;
      const toks = rows
        .map((r) => (typeof r.first_req_prompt_tokens === "number" ? r.first_req_prompt_tokens : r.id ? firstReq.get(r.id) : undefined))
        .filter((v): v is number => typeof v === "number");
      const rate = invoked && rows.length ? bodyLoads / rows.length : null;
      return {
        model, arm, invoked, sessions: rows.length, bodyLoads,
        bodyLoadRate: rate,
        medianFirstReqPromptTokens: median(toks),
        passes: rate === null ? null : rate >= BODY_LOAD_THRESHOLD,
      };
    })
    .sort((a, b) => (a.model === b.model ? a.arm.localeCompare(b.arm) : a.model.localeCompare(b.model)));
  const gatePass = cells.filter((c) => c.invoked).every((c) => c.passes === true);
  return { cells, gatePass };
}

const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "n/a" : (100 * x).toFixed(0) + "%");

export function markdown(rep: ManipReport): string {
  const lines = ["| Model | Arm | Sessions | Body loads | Body-load rate | Median first-req prompt tokens | Passes 90% |", "|---|---|---|---|---|---|---|"];
  for (const c of rep.cells) {
    lines.push(`| ${c.model} | ${c.arm} | ${c.sessions} | ${c.bodyLoads} | ${pct(c.bodyLoadRate)} | ${c.medianFirstReqPromptTokens ?? "n/a"} | ${c.passes === null ? "n/a" : c.passes ? "yes" : "no"} |`);
  }
  lines.push("", `Gate (every invoked cell at or above ${pct(BODY_LOAD_THRESHOLD)}): ${rep.gatePass ? "pass" : "fail"}`);
  return lines.join("\n");
}

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

if (import.meta.main) {
  const run = Bun.argv[2];
  if (!run) throw new Error("E_USAGE usage: manip.ts <run dir holding out/proxy-sessions.jsonl and out/proxy-requests.jsonl>");
  const sessions = loadJsonl<SessionRow>(join(run, "out", "proxy-sessions.jsonl"));
  const requests = loadJsonl<RequestRow>(join(run, "out", "proxy-requests.jsonl"));
  console.log(markdown(computeManip({ sessions, requests })));
}
