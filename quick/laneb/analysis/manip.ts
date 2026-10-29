// Manipulation check for the explicit-invocation run. Reads a run's proxy session and request logs
// and reports, per (model, arm), the body-load rate (the share of invoked sessions whose first request
// carried an injected skill body, proved by cmd_expanded) and the median first-request prompt-token
// bound (a sanity column: the invoked arms should exceed none by about the skill body's token size).
// It reads the proxy's own records only and never touches the cost or ledger logic.
//
// The pilot gate is the frozen prereg rule, computed per model over its invoked (gstack and placebo)
// trials pooled: a model passes when its pooled body-load rate is at least 90%. The grid runs unless
// every pilot model is under the threshold; a model under it still has the grid run, with that model's
// cells reported as not measuring skill bodies. A model with no invoked session cannot pass, and a run
// with no invoked session at all is an error, never a silent pass.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const INVOKED_ARMS = ["gstack", "placebo"];
// Pilot gate: body loads in at least 90% of a model's invoked trials.
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
// Per-model rollup over invoked (gstack and placebo) sessions. This is what the frozen gate rule reads.
export type ManipModel = {
  model: string;
  invokedSessions: number;
  bodyLoads: number;
  bodyLoadRate: number | null; // null when the model has no invoked session
  passes: boolean; // true only with at least one invoked session and a pooled rate at or above the threshold
};
export type ManipReport = {
  cells: ManipCell[];
  models: ManipModel[];
  // The frozen decision: the grid runs unless every pilot model is under the threshold.
  gridRuns: boolean;
  // Alias of gridRuns, kept so callers and the gate line read one boolean.
  gatePass: boolean;
  // Models that are under the threshold (or have no invoked session); their grid cells do not measure bodies.
  underModels: string[];
  // Set when no model has any invoked session, so the gate cannot pass on empty evidence.
  error: string | null;
};

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
  const byModel = new Map<string, SessionRow[]>();
  for (const s of input.sessions) {
    const model = s.model ?? "?";
    const arm = s.meta?.arm ?? "?";
    (groups.get(`${model}|${arm}`) ?? groups.set(`${model}|${arm}`, []).get(`${model}|${arm}`)!).push(s);
    (byModel.get(model) ?? byModel.set(model, []).get(model)!).push(s);
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

  // Pool each model's invoked (gstack and placebo) sessions for the gate.
  const models: ManipModel[] = [...byModel.entries()]
    .map(([model, rows]) => {
      const invokedRows = rows.filter((r) => INVOKED_ARMS.includes(r.meta?.arm ?? "?"));
      const bodyLoads = invokedRows.filter((r) => r.cmd_expanded === true).length;
      const rate = invokedRows.length ? bodyLoads / invokedRows.length : null;
      return {
        model,
        invokedSessions: invokedRows.length,
        bodyLoads,
        bodyLoadRate: rate,
        passes: rate !== null && rate >= BODY_LOAD_THRESHOLD,
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model));

  const evaluated = models.filter((m) => m.invokedSessions > 0);
  const error = evaluated.length === 0 ? "no invoked session in the run, so the body-load gate has no evidence" : null;
  // Grid runs unless every evaluated model is under the threshold. With no evaluated model it cannot run.
  const gridRuns = error === null && evaluated.some((m) => m.passes);
  const underModels = models.filter((m) => !m.passes).map((m) => m.model);
  return { cells, models, gridRuns, gatePass: gridRuns, underModels, error };
}

const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "n/a" : (100 * x).toFixed(0) + "%");

export function markdown(rep: ManipReport): string {
  const lines = [
    "| Model | Arm | Sessions | Body loads | Body-load rate | Median first-req prompt tokens | Passes 90% |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const c of rep.cells) {
    lines.push(`| ${c.model} | ${c.arm} | ${c.sessions} | ${c.bodyLoads} | ${pct(c.bodyLoadRate)} | ${c.medianFirstReqPromptTokens ?? "n/a"} | ${c.passes === null ? "n/a" : c.passes ? "yes" : "no"} |`);
  }
  lines.push("", `Per model, pooled over invoked (${INVOKED_ARMS.join(" and ")}) trials, gate at ${pct(BODY_LOAD_THRESHOLD)}:`);
  lines.push("| Model | Invoked sessions | Body loads | Body-load rate | Passes |", "|---|---|---|---|---|");
  for (const m of rep.models) {
    lines.push(`| ${m.model} | ${m.invokedSessions} | ${m.bodyLoads} | ${pct(m.bodyLoadRate)} | ${m.passes ? "yes" : "no"} |`);
  }
  lines.push("");
  if (rep.error) {
    lines.push(`Gate: error (${rep.error}); the grid does not run.`);
  } else {
    const labeled = rep.underModels.length ? ` Models not measuring skill bodies (grid cells labeled): ${rep.underModels.join(", ")}.` : "";
    lines.push(`Gate (grid runs unless every pilot model is under ${pct(BODY_LOAD_THRESHOLD)}): ${rep.gridRuns ? "pass, grid runs" : "fail, grid does not run"}.${labeled}`);
  }
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
