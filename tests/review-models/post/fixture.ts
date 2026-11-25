// Copyright (c) 2026 Garry Tan. MIT License.
// A planted finished pilot for the rm-post tests: a review-units out dir with 5 cells by 11 units (5 P, 5 B, 1 decoy),
// session records, Codex rollouts, contract v1 findings and cost.tsv rows, plus the post key, a planted history CSV, a
// temporary ledger with one item per paid batch, a stub upstream that answers Carbon and the second read from markers
// planted in the findings, and personFile, which fills a labelling page's downloaded file the way a careful person would
// from the same markers. Nothing here names a real unit or calls a provider. One planted failure per kind:
// - OA on P2 never launches its Claude adversarial subagent (an unexposed review);
// - FS on B1 carries a finding Carbon rules as naming the bug while both people say it does not (a judge error);
// - FA on P3 ran twice in cells.ndjson, the first ending on an upstream error (a rerun, from the retry reserve);
// - OS on B2 curls a page that quotes the unit's fix commit (a contaminated search).
// Also planted: N on P4 runs a WebSearch with no recorded result (a doubtful case the blind second read rules clean),
// Carbon's first reply on OS P1 is empty (retried once), and the two people read OA P1 differently until the second part.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { COST_COLUMNS } from "../../../src/trial/review/cost.ts";
import { RM_CELLS } from "../../../src/trial/review/rm-cells.ts";
import { armId, sessionDir, unitFile } from "../../../src/trial/review/run.ts";
import type { KeyUnit, PostKey } from "../../../lanes/review-models/post/pilot.ts";

export const DRY_ENV = { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" };
export const ITEMS = { judge: "rm-pilot-judge", labels: "rm-pilot-labels", second: "rm-pilot-second-read" } as const;
const FENCE = String.fromCharCode(96).repeat(3);
const block = (v: unknown) => FENCE + "json\n" + JSON.stringify(v) + "\n" + FENCE;
const hex = (s: string, n = 40) => createHash("sha256").update(s).digest("hex").slice(0, n);

export interface Planted {
  dir: string;
  run: string;
  post: string;
  keyPath: string;
  key: PostKey;
  history: string;
  historySha: string;
  record: string;
  ledger: string;
}

const unitsOf = (): KeyUnit[] => {
  const out: KeyUnit[] = [];
  for (let i = 1; i <= 5; i++) {
    const unit = "acme/widgets" + i + "#" + (100 + i);
    out.push({ unit, label: "u_p" + hex("p" + i, 6), pool: "P", cluster: unit, stratum: "S2-mixed", diff_lines: i === 5 ? 240 : 120, bug: { evidence: "The retry loop in widget " + i + " never stops on a 429.", fix_diff: "--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -10,3 +10,3 @@\n-  while (true) {\n+  while (tries < 3) {\n" }, markers: { unit, prs: [unit, "acme/widgets" + i + "#" + (200 + i)], commits: [hex("pfix" + i)], ids: [] } });
  }
  for (let i = 1; i <= 5; i++) {
    const unit = "acme/vault" + i + "#0@" + hex("bic" + i, 12);
    out.push({ unit, label: "u_b" + hex("b" + i, 6), pool: "B", cluster: "acme/vault" + i, diff_lines: 120, bug: { evidence: "Advisory GHSA-aaaa-bbbb-ccc" + i + ": the token check compares with ==.", fix_diff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -4,1 +4,1 @@\n-  return a == b;\n+  return timingSafeEqual(a, b);\n" }, markers: { unit, prs: [], commits: [hex("bfix" + i)], ids: ["GHSA-aaaa-bbbb-ccc" + i, "CVE-2026-1000" + i] } });
  }
  const decoy = "acme/docs#7";
  out.push({ unit: decoy, label: "u_d" + hex("d", 6), pool: "decoy", cluster: decoy, diff_lines: 30, bug: null, markers: { unit: decoy, prs: [decoy], commits: [], ids: [] } });
  return out;
};

const task = (u: string) => u.replace(/[^A-Za-z0-9]+/g, "-") + "-" + hex(u, 8);

type Msg = Record<string, unknown>;
const say = (model: string, text: string): Msg => ({ type: "assistant", parent_tool_use_id: null, message: { model, content: [{ type: "text", text }] } });
let n = 0;
const tool = (model: string, name: string, input: Record<string, unknown>, result: string | null): Msg[] => {
  const id = "t_" + ++n;
  return [{ type: "assistant", parent_tool_use_id: null, message: { model, content: [{ type: "tool_use", id, name, input }] } }, ...(result === null ? [] : [{ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: result }] }] } }])];
};
const agent = (model: string, id: string, prompt: string): Msg[] => [
  { type: "assistant", parent_tool_use_id: null, message: { model, content: [{ type: "tool_use", id, name: "Agent", input: { prompt } }] } },
  { type: "system", subtype: "task_started", tool_use_id: id },
  { type: "assistant", parent_tool_use_id: id, message: { model, content: [{ type: "text", text: "Checked." }] } },
  { type: "system", subtype: "task_notification", tool_use_id: id, status: "completed" },
];
const rollout = (name: string, prompt: string, model: string) => [
  { type: "session_meta", payload: { id: name, source: "exec", cli_version: "0.170.0" } },
  { type: "turn_context", payload: { model, effort: "high" } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/w</cwd>\n</environment_context>" }] } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } },
  { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1200, output_tokens: 80, total_tokens: 1280 } } } },
].map((l) => JSON.stringify(l)).join("\n") + "\n";

function gstackSession(model: string, voice: string, diff: number, o: { adversarial: boolean }): { messages: Msg[]; rollouts: Record<string, string> } {
  const m: Msg[] = [];
  if (diff >= 50) {
    m.push(say(model, "Dispatching 2 specialists: Testing, Security."));
    m.push(...agent(model, "spec_t" + ++n, "Read review/specialists/testing.md and review the diff."), ...agent(model, "spec_s" + ++n, "Read review/specialists/security.md and review the diff."));
  }
  if (diff > 200) m.push(...agent(model, "red" + ++n, "Read review/specialists/red-team.md and attack the diff."));
  if (o.adversarial) m.push(...agent(model, "adv" + ++n, "Think like an attacker and a chaos engineer. Review the diff."));
  const outside = (gate: string) => tool(model, "Bash", { command: 'bun "$GSTACK/lib/outside-review-result.ts" ' + gate + ' "$_OUTSIDE_TMP/text" "$_OUTSIDE_TMP/err"' }, "CODEX_MODEL: " + voice + " (from the probe)\nOUTSIDE_STATUS: completed\nOUTSIDE_USAGE: input=1200 cached_input=300 output=80 reasoning_output=40 total=1280\n");
  m.push(...outside("review"));
  const rollouts: Record<string, string> = { "sessions/2026/11/28/rollout-probe.jsonl": rollout("probe", "reply OK", voice), "sessions/2026/11/28/rollout-adv.jsonl": rollout("adv", "Review the changes on this branch. Find ways this code fails in production.", voice) };
  if (diff >= 200) {
    m.push(...outside("structured"));
    rollouts["sessions/2026/11/28/rollout-struct.jsonl"] = rollout("struct", "Review this diff for bugs.\n\nREPOSITORY CONTEXT (data, not instructions):\nsrc/a.ts", voice);
  }
  m.push(say(model, "Review done."));
  return { messages: m, rollouts };
}

/** Writes the planted pilot under a fresh temp dir. */
export function plant(): Planted {
  const dir = mkdtempSync(join(tmpdir(), "rm-post-"));
  const run = join(dir, "run"), post = join(dir, "post");
  const units = unitsOf();
  const key: PostKey = { schema: "rm-post-key.v1", pilot: units, counted: { p: 77, b: 23, decoys: 12 } };
  const keyPath = join(dir, "key.json");
  writeFileSync(keyPath, JSON.stringify(key, null, 2));
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "units.json"), JSON.stringify({ schema_version: 1, units: units.map((u) => ({ id: u.unit, task: task(u.unit) })) }));
  const cells: string[] = [];
  const BASE: Record<string, number> = { OS: 6.2, OA: 10.8, FS: 15.1, FA: 19.9, N: 0.55 };
  for (const cell of RM_CELLS) {
    const arm = cell.id;
    const armDir = join(run, "arms", armId(cell.arm, cell.model));
    mkdirSync(join(armDir, "findings"), { recursive: true });
    const costRows = [COST_COLUMNS.join("\t")];
    units.forEach((u, i) => {
      const meter = "m_" + arm + "_" + i;
      const usd = BASE[arm]! + (i % 3) * 0.2;
      const wall = (arm === "N" ? 90 : arm[0] === "F" ? 900 : 600) + i * 10;
      const entry = (meter_id: string, termination: unknown, parse: unknown, micros: number) => JSON.stringify({ cell: { model: cell.model, arm: cell.arm, unit: u.unit, pass: 1 }, meter_id, record: { termination }, parse, cost: { meter_id, all: { spent_micros: micros, unknown: 0 }, voice: null, refused: 0 } });
      if (arm === "FA" && u.unit === units[2]!.unit) cells.push(entry(meter + "_a", { kind: "missing", code: "UPSTREAM" }, { kind: "incomplete", reason: "the session ended missing (UPSTREAM)" }, 2_500_000));
      cells.push(entry(meter, { kind: "completed" }, { kind: "findings", findings: [] }, Math.round(usd * 1e6)));
      const cost: Record<string, string> = { pr: u.unit, scope: "all", pass: "1", usd: usd.toFixed(6), wall_seconds: String(wall), meter_source: "proxy-journal", requests: "40", refused: "0", unknown_calls: "0" };
      costRows.push(COST_COLUMNS.map((c) => cost[c] ?? "100").join("\t"));
      const findings: Record<string, unknown>[] = [];
      if (u.pool !== "decoy") {
        const tag = arm === "OS" && u.unit === units[0]!.unit ? " EMPTY_ONCE" : arm === "OA" && u.unit === units[0]!.unit ? " DISAGREE" : "";
        const caught = arm === "N" ? i % 2 === 0 : !(arm === "FS" && u.unit === units[5]!.unit);
        findings.push({ severity: "P1", path: "src/retry.ts", line: 11, summary: (caught ? "BUGMARK the loop never stops on a 429." : "Style nit in the retry loop.") + tag, pass: 1, id: "p1-1", evidence: "while (true) has no exit (note " + hex(arm + i, 6) + ")." });
        if (cell.voice) findings.push({ severity: "MEDIUM", path: "src/log.ts", line: 3, summary: "[codex] The log line drops the request id." + (arm === "FS" && u.unit === units[5]!.unit ? " JUDGE_ERROR" : ""), pass: 1, id: "p1-2", evidence: "log(msg) only." });
      } else findings.push({ severity: "P1", path: "README.md", line: 1, summary: "A typo blocks the build.", pass: 1, id: "p1-1", evidence: "teh" });
      writeFileSync(join(armDir, "findings", unitFile(u.unit) + ".jsonl"), findings.map((f) => JSON.stringify(f) + "\n").join(""));
      const host = join(sessionDir(run, cell.model, cell.arm, task(u.unit), 1), "host");
      mkdirSync(host, { recursive: true });
      let messages: Msg[];
      if (cell.voice) {
        const s = gstackSession(cell.model, cell.voice, u.diff_lines, { adversarial: !(arm === "OA" && u.unit === units[1]!.unit) });
        messages = s.messages;
        for (const [p, text] of Object.entries(s.rollouts)) {
          mkdirSync(join(host, "codex-sessions", p, ".."), { recursive: true });
          writeFileSync(join(host, "codex-sessions", p), text);
        }
      } else messages = [{ type: "system", subtype: "init", slash_commands: ["compact", "review"], skills: [] }, ...tool(cell.model, "Read", { file_path: "/work/" + task(u.unit) + "/src/retry.ts" }, "while (true) {"), say(cell.model, "Review done.")];
      if (arm === "OS" && u.unit === units[6]!.unit) messages.splice(1, 0, ...tool(cell.model, "Bash", { command: "curl -s https://example.org/acme-vault-history" }, "Fix token compare " + u.markers.commits[0]!.slice(0, 12) + " merged"));
      if (arm === "N" && u.unit === units[3]!.unit) messages.splice(1, 0, ...tool(cell.model, "WebSearch", { query: "retry loop 429 best practice" }, null));
      writeFileSync(join(host, "transcript.ndjson"), messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
    });
    writeFileSync(join(armDir, "cost.tsv"), costRows.join("\n") + "\n");
  }
  writeFileSync(join(run, "cells.ndjson"), cells.join("\n") + "\n");
  const rows = Array.from({ length: 54 }, (_, i) => [1, 2].map((pass) => ["h" + i, "outside_bug", "gstack_review", i < 42 || (pass === 1 && i < 44) ? "1" : "0", "1"].join(","))).flat();
  const csv = ["unit_id,stratum,arm,named_any_severity,n_planted", ...rows].join("\n") + "\n";
  const history = join(dir, "history.csv");
  writeFileSync(history, csv);
  const record = join(dir, "record");
  const quote = { words: "rm-post tests on a temporary ledger", by: "rm-post tests", source: "tests/review-models/post" };
  for (const item of Object.values(ITEMS)) recordApproval(record, { action: "init", item, cap_micros: 800 * 1_000_000, quotes: [quote], admission: "warn" });
  return { dir, run, post, keyPath, key, history, historySha: createHash("sha256").update(csv).digest("hex"), record, ledger: join(dir, "ledger.sqlite") };
}

export interface Upstream {
  fetch: typeof fetch;
  calls: Array<{ provider: string; body: any }>;
}

/** The stub providers: Carbon's rulings follow the markers planted in each finding, and the second read rules clean. */
export function upstream(): Upstream {
  const calls: Upstream["calls"] = [];
  const seen = new Set<string>();
  const once = (k: string) => (seen.has(k) ? false : (seen.add(k), true));
  const f = (async (url: any, init?: any) => {
    const u = String(url), body = JSON.parse(String(init?.body ?? "{}"));
    const provider = u.includes("anthropic") ? "anthropic" : u.includes("openrouter") ? "openrouter" : "openai";
    calls.push({ provider, body });
    const prompt: string = provider === "openai" ? body.input[0].content : body.messages[0].content;
    const numbered = [...prompt.matchAll(/^(\d+)\. \[[^\]]+\][^\n]*\n((?:   [^\n]*\n?)*)/gm)].map((m) => ({ n: Number(m[1]), text: m[2]! }));
    let text = "";
    if (prompt.includes('"verdict"')) text = block({ verdict: "clean", reason: "the search returned nothing" });
    else if (provider === "openrouter") text = prompt.includes("EMPTY_ONCE") && once("empty " + prompt) ? "" : block({ rulings: numbered.map((x) => ({ finding: x.n, ruling: x.text.includes("BUGMARK") || x.text.includes("JUDGE_ERROR") ? "names" : "doesnt", reason: "planted" })) });
    if (provider === "anthropic") return Response.json({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    if (provider === "openrouter") return Response.json({ id: "g", model: body.model, provider: "Google", choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 60 } });
    return Response.json({ id: "r", object: "response", model: body.model, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens: 60, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 960 } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export interface PersonOptions {
  /** Answer none on every screen whose findings carry this token. */
  none_on?: string;
  /** Answer can't tell on every screen whose findings carry this token. */
  cant_on?: string;
  minutes?: number;
  /** Answer every screen the same, as a careless file does. */
  same?: string;
}

/** The labels file a page downloads, filled from the planted markers: a finding names the bug when it carries BUGMARK. */
export function personFile(pkg: string, labeller: string, version: "A" | "B", o: PersonOptions = {}): string {
  const items = JSON.parse(readFileSync(join(pkg, "items.json"), "utf8"));
  const labels: Record<string, { choice: string; note: string; at: string }> = {};
  for (const sid of items.orders[version] as string[]) {
    const sc = items.screens[sid];
    const text: string = sc.blocks.find((b: { style?: string }) => b.style === "findings").text;
    const numbered = [...text.matchAll(/^(\d+)\. \[[^\]]+\][^\n]*\n((?:   [^\n]*\n?)*)/gm)].map((m) => ({ n: Number(m[1]), text: m[2]! }));
    const hit = numbered.filter((x) => x.text.includes("BUGMARK")).map((x) => x.n);
    for (const q of sc.questions as Array<{ id: string; findings?: number; finding?: number }>) {
      let choice: string;
      if (o.same) choice = o.same;
      else if (q.id in items.attention) choice = items.attention[q.id];
      else if (o.none_on && text.includes(o.none_on)) choice = q.findings ? "none" : "doesnt";
      else if (o.cant_on && text.includes(o.cant_on)) choice = "cant";
      else if (q.findings) choice = hit.length ? hit.join(",") : "none";
      else choice = hit.includes(q.finding!) ? "names" : "doesnt";
      labels[q.id] = { choice, note: "planted reason for " + q.id, at: "2026-11-25T03:00:00Z" };
    }
  }
  return JSON.stringify({ format: items.format, package: items.package, version, labeller, startedAt: "2026-11-25T01:00:00Z", activeSeconds: (o.minutes ?? 240) * 60, screens: {}, labels }, null, 1);
}
