// Copyright (c) 2026 Garry Tan. MIT License.
// The mechanical extractor (prereg section 4): fact candidates with cited events, lists in record order, and the
// stratum. B0's screen rules (b0a.py for source A, b0b.py's strict flags for source B), ported; this module is the one the run uses.
import { readFileSync, writeFileSync } from "node:fs";
import { fail } from "./errors.ts";
import { historySha256 } from "./history/events.ts";
import { B_CALLS } from "./history/source-b.ts";
import type { Candidate, Extract, History, HistoryEvent, Io, ListItem, Stratum } from "./types.ts";

const TEST_LINE = [
  /^\s*(\S+::\S+?)\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\b/,
  /^\s*(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S+::\S+)/,
  /^\s*(test\w*) \(([\w.]+)\)\s*\.\.\.\s*(ok|FAIL|ERROR|skipped|expected failure)/,
];
const STATE_MAP: Record<string, string> = { ok: "PASSED", FAIL: "FAILED", ERROR: "ERROR", skipped: "SKIPPED", "expected failure": "XFAIL" };
const FLAG_STATES = new Set(["FAILED", "ERROR", "SKIPPED"]);
const ROUTINE = new Set(["grep", "rg", "find", "ls", "cat", "head", "tail", "test", "[", "which", "diff", "cmp", "sed", "awk", "wc", "file", "stat", "type", "command", "echo", "true", "false", "cd", "pwd", "less", "more", "sort", "uniq", "tree"]);
const TEST_RUNNERS = /\b(pytest|py\.test|tox|nox|unittest|manage\.py test|go test|cargo test|npm test|yarn test|make test|runtests)\b/;
const MISSING = [/No module named '?([\w.]+)'?/g, /([\w./-]+): command not found/g, /ModuleNotFoundError: No module named '?([\w.]+)/g];
const CONFIG_A = /(^|\/)(setup\.cfg|setup\.py|pyproject\.toml|tox\.ini|pytest\.ini|noxfile\.py|conftest\.py|requirements[^/]*\.txt|Pipfile(\.lock)?|poetry\.lock|MANIFEST\.in|Makefile|Dockerfile|package\.json|[^/]*\.(cfg|ini|toml|ya?ml))$|(^|\/)\.github\//;
const CONFIG_B = /(^|\/)\.github\/|^\.gstack\/|(^|\/)(package\.json|bun\.lockb?|bunfig\.toml|tsconfig[^/]*\.json|biome\.json|\.gitignore)$|\.(ya?ml)$/;
const CHECK_OK = new Set(["SUCCESS", "NEUTRAL"]);
const CHECK_HARD = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Python's str.splitlines(). */
const splitLines = (s: string) => s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const uniq = (xs: string[]) => [...new Set(xs)];

function stripCmd(cmd: string): string {
  const c = cmd.trim();
  return c.split(/\s*(?:&&|;|\|\|)\s*/).filter((p) => p && !/^(cd|export|source|set|\.)\b/.test(p))[0] ?? c;
}
function cmdKey(cmd: string): [string | null, string | null] {
  let toks = stripCmd(cmd).split(/\s+/).filter(Boolean);
  while (toks.length && /^(\w+=\S*|timeout|env|sudo|time|nice)$/.test(toks[0])) toks = toks.slice(1);
  if (!toks.length) return [null, null];
  const prog = toks[0].split("/").pop()!;
  const key = toks.slice(1).find((t) => t.includes("/") || /\.(py|sh|js|ts|cfg|toml|ini|txt)$/.test(t))?.replace(/^['"]+|['"]+$/g, "");
  return [prog, key || prog];
}
function parseTests(out: string): { items: Array<[string, string]>; counts: Record<string, number>; summary: boolean } {
  const items = new Map<string, string>();
  const lines = splitLines(out);
  for (const line of lines) {
    for (const [i, rx] of TEST_LINE.entries()) {
      const m = rx.exec(line);
      if (!m) continue;
      let [name, st] = i === 0 ? [m[1], m[2]] : i === 1 ? [m[2], m[1]] : [m[2] + "." + m[1], STATE_MAP[m[3]]];
      name = name.replace(/[:,]+$/, "");
      const prev = items.get(name);
      if (prev === undefined || (FLAG_STATES.has(st) && !FLAG_STATES.has(prev))) items.set(name, st);
      break;
    }
  }
  const counts: Record<string, number> = {};
  let summary = false;
  for (const line of lines) {
    if (!/^=+ .* in [\d.]+s/.test(line) && !/^=+ .*(passed|failed|error)/.test(line)) continue;
    for (const [, n, k] of line.matchAll(/(\d+) (failed|passed|skipped|errors?|xfailed|xpassed)/g)) {
      const key = k.startsWith("error") ? k.replace(/s+$/, "") : k;
      counts[key] = (counts[key] ?? 0) + Number(n);
      summary = true;
    }
  }
  return { items: [...items], counts, summary };
}
function testNames(nodeid: string): string[] {
  const base = nodeid.split("[")[0];
  return uniq([nodeid.toLowerCase(), base.toLowerCase(), base.split(/::|\./).pop()!.toLowerCase()]);
}
type ToolUse = HistoryEvent & { kind: "tool-use" };
type ToolResult = HistoryEvent & { kind: "tool-result" };
const historyChars = (events: HistoryEvent[]) => events.reduce((n, e) => n + (e.kind === "tool-use" ? JSON.stringify(e.input).length : e.kind === "tool-result" ? e.content.length : e.text.length), 0);

export function extract(history: History): Extract {
  if (historySha256(history.events) !== history.sha256) fail("E_TBV_HISTORY", "history " + history.task + " does not match its sha256");
  const candidates: Candidate[] = [];
  const seen = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    const key = c.kind + "\0" + (c.names[0] ?? "");
    const prev = seen.get(key);
    if (prev) prev.events = [...new Set([...prev.events, ...c.events])].sort((a, b) => a - b);
    else {
      seen.set(key, c);
      candidates.push(c);
    }
  };
  const lists: ListItem[][] = [];
  const uses = new Map<string, ToolUse>();
  const results: Array<{ use: ToolUse; result: ToolResult }> = [];
  for (const e of history.events) {
    if (e.kind === "tool-use") uses.set(e.id, e);
    const use = e.kind === "tool-result" ? uses.get(e.tool_use_id) : undefined;
    if (use && e.kind === "tool-result") results.push({ use, result: e });
  }
  let clean: boolean;
  if (history.source === "A") {
    let summaryFail = false;
    for (const { use, result } of results) {
      if (use.name !== "Bash") continue;
      const cmd = String(use.input.command ?? "");
      const out = result.content;
      const { items, counts, summary } = parseTests(out);
      if (items.length) lists.push(items.map(([name, state]) => ({ name, state, flagged: FLAG_STATES.has(state), events: [result.n] })));
      for (const [name, state] of items) if (FLAG_STATES.has(state)) add({ kind: "test", state, name, names: testNames(name), events: [result.n], material: true });
      const bad = (counts.failed ?? 0) + (counts.error ?? 0) + (counts.skipped ?? 0);
      if (bad) summaryFail = true;
      if (bad && !items.some(([, s]) => FLAG_STATES.has(s))) {
        const key = cmdKey(cmd)[1];
        add({ kind: "test-summary", state: "summary", name: key ?? "", names: key ? [key.toLowerCase()] : [], events: [result.n], material: true });
      }
      for (const rx of MISSING) for (const m of out.matchAll(rx)) add({ kind: "env", state: "missing", name: m[1], names: [m[1].toLowerCase()], events: [result.n], material: true });
      if (result.is_error && !items.length && !summary) {
        const [prog, key] = cmdKey(cmd);
        if (prog && key && !ROUTINE.has(prog) && !(prog === "git" && /git\s+(diff|grep|log|show|status)/.test(cmd)))
          add({ kind: "exit", state: "nonzero", name: key, names: [key.toLowerCase()], events: [use.n, result.n], material: TEST_RUNNERS.test(cmd) });
      }
    }
    for (const f of uniq(history.side.files).sort(byBytes)) {
      if (!CONFIG_A.test(f)) continue;
      const touches = (e: ToolUse) => {
        const p = String(e.input.file_path ?? e.input.notebook_path ?? "");
        return WRITE_TOOLS.has(e.name) && (p === f || p.endsWith("/" + f));
      };
      const all = [...uses.values()];
      const at = all.filter(touches).length ? all.filter(touches) : all.filter((e) => JSON.stringify(e.input).includes(f));
      add({ kind: "config", state: "changed", name: f, names: uniq([f.toLowerCase(), f.split("/").pop()!.toLowerCase()]), events: at.map((e) => e.n), material: true });
    }
    clean = history.side.resolved === true && !summaryFail;
  } else {
    const runs: Array<{ name: string; state: string; round: number; n: number }> = [];
    const findings: ListItem[] = [];
    let round = -1;
    let numstat: number | null = null;
    for (const { use, result } of results) {
      const cmd = String(use.input.command ?? "");
      if (B_CALLS.isChecks.test(cmd)) {
        round++;
        for (const line of result.content.split("\n")) {
          const m = /^== check (.+): (\S+)$/.exec(line);
          if (m) runs.push({ name: m[1], state: m[2], round, n: result.n });
        }
      } else if (B_CALLS.isNumstat.test(cmd)) numstat = result.n;
      else if (B_CALLS.isFindings.test(cmd)) {
        for (const block of result.content.split(/^(?=== finding \d+: (?:resolved|unresolved)$)/m)) {
          const m = /^== finding \d+: (resolved|unresolved)\n?([\s\S]*)$/.exec(block);
          if (!m) continue;
          const name = m[2].split("\n").map((l) => l.trim()).find(Boolean) ?? "";
          findings.push({ name, state: m[1], flagged: m[1] === "unresolved", events: [result.n] });
        }
      }
    }
    const checks: ListItem[] = runs.map((r) => ({ name: r.name, state: r.state, flagged: CHECK_HARD.has(r.state) || (r.round === round && !CHECK_OK.has(r.state) && r.state !== "SKIPPED"), events: [r.n] }));
    for (const c of checks) if (c.flagged) add({ kind: "check", state: c.state, name: c.name, names: [c.name.toLowerCase()], events: c.events, material: true });
    for (const f of findings) if (f.flagged) add({ kind: "finding", state: f.state, name: f.name, names: [f.name.toLowerCase()], events: f.events, material: true });
    for (const f of uniq(history.side.files)) {
      if (CONFIG_B.test(f)) add({ kind: "config", state: "changed", name: f, names: uniq([f.toLowerCase(), f.split("/").pop()!.toLowerCase()]), events: numstat === null ? [] : [numstat], material: true });
    }
    lists.push(...[checks, findings].filter((l) => l.length));
    clean = runs.some((r) => r.round === round) && runs.every((r) => CHECK_OK.has(r.state));
  }
  const longest = lists.reduce<ListItem[]>((a, l) => (l.length > a.length ? l : a), []);
  let stratum: Stratum | "none";
  if (lists.some((l) => l.length >= 15 && l.length <= 40 && l.slice(10).some((i) => i.flagged))) stratum = "long";
  else if (longest.length >= 2 && longest.length <= 8 && longest.some((i) => i.flagged)) stratum = "short";
  else if (candidates.length) stratum = "other";
  else stratum = clean ? "clean" : "none";
  return { schema: "tbv-extract.v1", task: history.task, history_sha256: history.sha256, candidates, lists, longest, stratum, tokens: Math.ceil(historyChars(history.events) / 3) };
}

/** Amendment item 12: history plus the family's overhead (the larger of 40,000 and the captured overhead, characters / 3) is at most 130,000 tokens. */
export function admitsSize(historyTokens: number, overheadTokens: number): boolean {
  return historyTokens + Math.max(40_000, overheadTokens) <= 130_000;
}

/** extract --history FILE [--out FILE] */
export async function run(argv: string[], io: Io): Promise<number> {
  const f: Record<string, string> = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (!["--history", "--out"].includes(argv[i]) || argv[i + 1] === undefined) fail("E_USAGE", "unknown flag or missing value: " + argv[i] + "; flags are --history --out");
    f[argv[i]] = argv[i + 1];
  }
  if (!f["--history"]) fail("E_USAGE", "extract needs --history");
  const history = JSON.parse(readFileSync(f["--history"], "utf8")) as History;
  if (history?.schema !== "tbv-history.v1") fail("E_TBV_INPUT", f["--history"] + " is not a tbv-history.v1 file");
  const text = JSON.stringify(extract(history), null, 1);
  if (f["--out"]) writeFileSync(f["--out"], text + "\n");
  io.out(text);
  return 0;
}
