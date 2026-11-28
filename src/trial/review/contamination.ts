// Copyright (c) 2026 Garry Tan. MIT License.
// Search extraction and the contamination rule for the review-models eval (prereg 2026-11-24-geva-590, section 5).
// Search is off in every arm, so this is a guard that should find nothing; it reads every review anyway.
//
// - Every attempted search or fetch is extracted per review from the records the run keeps: the Claude Code session's
//   transcript.ndjson (WebSearch and WebFetch calls, which the rig refuses, and Bash commands, subagents' included), the
//   voice's Codex rollouts when the run copied them out (its shell commands, read through codexTranscript, and any hosted
//   web_search_call item), and the metering proxy's tool_removed lines for the review's slots.
// - A shell command is a search or fetch when it runs curl or wget, any gh command but its version or help, git fetch,
//   clone, pull or ls-remote, or a network-capable interpreter (python, node, bun, deno, ruby, perl, nc and the like)
//   with a URL among its words. Its target is the query or URL: a command's URLs and hosts, else its arguments.
// - An attempt reached content when a result came back that is not an error, not empty and not a network failure. It
//   is contaminated when that result names one of the unit's markers: its PR or fix PR (owner/repo#N, /pull/N or
//   /issues/N), its fix commit (any hex run of 7 or more that starts the commit's sha), its advisory or CVE id, or the
//   review-real-bugs suite or its answer files (review-real-bugs, harness-evals, which g-harness-evals includes). The
//   per-unit markers come in as input; no unit is written here.
// - An attempt is doubtful when it is not contaminated and either no result was recorded for it (so whether it reached
//   anything is unknown, as for a hosted web_search_call) or it reached content and its query or URL names a marker. Each
//   doubtful attempt becomes one case for the blind second read (section 5): Opus 5.5 reads the voice's, GPT-6.2 Astra
//   reads Claude Code's, from the logged text only. second-read.jsonl holds the cases with no arm, model or review id;
//   second-read-key.tsv maps each case back. The second read itself is a paid call and is not run here; applySecondRead
//   folds its verdicts in.
// - A review is contaminated when any attempt is, after the second read when one was given. Per arm the report counts
//   reviews, attempted searches (by tool), removed web_search tools, contaminated and doubtful reviews, and voice
//   rollouts missing; an arm with more than 10% contaminated reviews reads untested for every contrast it is in.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { shellCommands } from "../../grade/transcript.ts";
import { codexTranscript } from "../../scoring/codex-transcript.ts";
import { readTranscript } from "./readers.ts";

/** The suite's names, which no review may reach (section 5); g-harness-evals includes harness-evals. */
export const SUITE_MARKERS = ["review-real-bugs", "harness-evals"] as const;
/** An arm whose contaminated share passes this reads untested for every contrast it is in. */
export const UNTESTED_SHARE = 0.1;
/** The most result text one blind case carries. */
export const CASE_RESULT_CHARS = 20_000;
export const SECOND_READERS = { claude: "openai/gpt-6.2-astra", voice: "anthropic/claude-opus-5-5" } as const;

/** One unit's markers: its PR and fix PR, its fix commit, its advisory and CVE ids. */
export interface UnitMarkers {
  unit: string;
  /** owner/repo#N, or a github.com pull or issue URL. */
  prs: string[];
  /** Full commit shas (at least 7 hex characters). */
  commits: string[];
  /** Advisory and CVE ids, such as GHSA-xxxx-xxxx-xxxx and CVE-2026-12345. */
  ids: string[];
}

export interface ReviewInput {
  review: string;
  arm: string;
  unit: string;
  /** The Claude Code session's transcript.ndjson. */
  transcript: string;
  /** True for an arm whose cell keeps a voice. */
  voice: boolean;
  /** The voice's copied-out Codex rollouts (a codex-sessions folder or a folder holding one), or null when the run kept none. */
  voice_sessions: string | null;
  /** The proxy slots this review's calls ran on. */
  meter_ids: string[];
}

export type Source = "claude" | "voice";
export type AttemptTool = "WebSearch" | "WebFetch" | "web_search_call" | "curl" | "wget" | "gh" | "git" | "shell_url";

export interface Attempt {
  source: Source;
  tool: AttemptTool;
  /** The query or URL, or the command's arguments when it names neither. */
  target: string;
  /** The shell command it came from, for a shell attempt. */
  command: string | null;
  /** The result text, or null when none was recorded. */
  result: string | null;
  error: boolean;
  reached: boolean;
  /** The markers the result names. */
  hits: string[];
  /** The markers the query or URL names. */
  target_hits: string[];
  verdict: "contaminated" | "doubtful" | "clean";
}

export interface ReviewReading {
  review: string;
  arm: string;
  unit: string;
  attempts: Attempt[];
  /** The proxy's tool_removed lines for this review's slots: each removed tool's request id, path and type. */
  removed: Array<{ request_id: string; meter_id: string; path: string; type: string }>;
  voice_sessions_missing: boolean;
  /** Unreadable items in the voice's rollouts, as codexTranscript counts them. */
  voice_unreadable: number;
  contaminated: boolean;
  doubtful: boolean;
}

export interface ArmReading {
  arm: string;
  reviews: number;
  attempted_searches: number;
  by_tool: Partial<Record<AttemptTool, number>>;
  removed_web_search_tools: number;
  contaminated_reviews: number;
  doubtful_reviews: number;
  voice_sessions_missing: number;
  contaminated_share: number;
  untested: boolean;
}

export interface ContaminationReport {
  arms: ArmReading[];
  reviews: ReviewReading[];
  /** Contaminated review ids, for the scorer's two readings (dropped, and scored as a miss). */
  contaminated: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marker tests for one unit: each returns the marker names a text holds. */
export function unitMatcher(m: UnitMarkers): (text: string) => string[] {
  const prs = m.prs.map((pr) => {
    const hit = /^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:#|\/pull\/|\/issues\/)(\d+)\/?$/i.exec(pr.trim());
    if (!hit) throw new Error("E_USAGE: unit " + m.unit + ": PR " + JSON.stringify(pr) + " is not owner/repo#N or a github.com pull or issue URL");
    return { name: "pr " + hit[1] + "#" + hit[2], re: new RegExp(escape(hit[1]!) + "(?:#|/pull/|/issues/)" + hit[2] + "(?!\\d)", "i") };
  });
  const commits = m.commits.map((c) => {
    const sha = c.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("E_USAGE: unit " + m.unit + ": commit " + JSON.stringify(c) + " is not a hex sha of 7 to 40 characters");
    return sha;
  });
  const ids = m.ids.map((id) => ({ name: "id " + id, re: new RegExp("(?<![A-Za-z0-9])" + escape(id.trim()) + "(?![A-Za-z0-9])", "i") }));
  const suite = SUITE_MARKERS.map((s) => ({ name: "suite " + s, re: new RegExp(escape(s), "i") }));
  return (text) => {
    const out = [...prs, ...ids, ...suite].filter((p) => p.re.test(text)).map((p) => p.name);
    for (const run of text.match(/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/gi) ?? []) {
      const sha = commits.find((c) => c.startsWith(run.toLowerCase()));
      if (sha && !out.includes("commit " + sha.slice(0, 12))) out.push("commit " + sha.slice(0, 12));
    }
    return out;
  };
}

const URL_WORD = /^(?:https?|ftp|ssh|git):\/\/\S+/i;
const HOST_WORD = /^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/i;
const SCP_WORD = /^[\w.-]+@[\w.-]+:\S+$/;
const WRAPPERS = new Set(["sudo", "env", "command", "nice", "nohup", "time", "exec"]);
const INTERPRETERS = /^(?:python[\d.]*|node|bun|deno|ruby|perl|php|nc|ncat|netcat|socat|http|https|aria2c|lynx|w3m|links|telnet)$/;
const GIT_REMOTE = new Set(["fetch", "clone", "pull", "ls-remote"]);
const NETWORK_FAILURE = /could not resolve|failed to connect|connection refused|network is unreachable|temporary failure in name resolution|name or service not known|unable to access|no route to host|operation timed out|connection timed out|getaddrinfo|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|error connecting to/i;

/** The searches and fetches one shell line runs, each with its tool and target. */
export function shellAttempts(line: string): Array<{ tool: AttemptTool; target: string }> {
  const out: Array<{ tool: AttemptTool; target: string }> = [];
  for (const raw of shellCommands(line)) {
    let words = raw.filter((w) => w !== "<" && w !== ">");
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!) || WRAPPERS.has(words[0]!) || (words[0] === "timeout" && words.length > 1))) words = words[0] === "timeout" ? words.slice(/^\d/.test(words[1] ?? "") ? 2 : 1) : words.slice(1);
    if (!words.length) continue;
    const cmd = posix.basename(words[0]!);
    const args = words.slice(1);
    const urls = args.filter((w) => URL_WORD.test(w) || SCP_WORD.test(w) || (!w.startsWith("-") && HOST_WORD.test(w)));
    const target = urls.length ? urls.join(" ") : args.join(" ");
    if (cmd === "curl" || cmd === "wget") out.push({ tool: cmd, target });
    else if (cmd === "gh" && args.length && !["--version", "version", "help", "--help", "-h"].includes(args[0]!)) out.push({ tool: "gh", target: args.join(" ") });
    else if (cmd === "git") {
      let i = 0;
      while (i < args.length && args[i]!.startsWith("-")) i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
      const sub = args[i];
      if (sub && GIT_REMOTE.has(sub)) {
        const rest = args.slice(i + 1).filter((w) => !w.startsWith("-"));
        const remote = rest.filter((w) => URL_WORD.test(w) || SCP_WORD.test(w) || HOST_WORD.test(w));
        if (remote.length || !rest.length || !rest.every((w) => w.startsWith("/") || w.startsWith("."))) out.push({ tool: "git", target: sub + " " + (remote.length ? remote.join(" ") : rest.join(" ") || "(default remote)") });
      }
    } else if (INTERPRETERS.test(cmd)) {
      const found = words.join(" ").match(/(?:https?|ftp):\/\/[^\s'"\)]+/gi);
      if (found) out.push({ tool: "shell_url", target: found.join(" ") });
    }
  }
  return out;
}

const resultText = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => (typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "")).join("\n") : content == null ? "" : JSON.stringify(content));

type RawCall = { name: string; input: Record<string, unknown>; result: string | null; error: boolean };

/** Tool calls and their results from SDK-shaped records: Claude Code's transcript.ndjson lines or codexTranscript's records. */
function rawCalls(messages: readonly any[]): RawCall[] {
  const results = new Map<string, { text: string; error: boolean }>();
  const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  for (const m of messages) {
    const content = m?.message?.content ?? m?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (typeof b?.tool_use_id === "string") results.set(b.tool_use_id, { text: resultText(b.content), error: b.is_error === true });
      else if (typeof b?.id === "string" && typeof b?.name === "string" && (b.type === "tool_use" || b.type === undefined)) calls.push({ id: b.id, name: b.name, input: b.input && typeof b.input === "object" ? b.input : {} });
    }
  }
  return calls.map((c) => {
    const r = results.get(c.id);
    return { name: c.name, input: c.input, result: r ? r.text : null, error: r?.error ?? false };
  });
}

type RawAttempt = Omit<Attempt, "reached" | "hits" | "target_hits" | "verdict">;

function attemptsOf(calls: readonly RawCall[], source: Source): RawAttempt[] {
  return calls.flatMap((c): RawAttempt[] => {
    const base = { source, result: c.result, error: c.error };
    if (c.name === "WebSearch") return [{ ...base, tool: "WebSearch" as const, target: String(c.input.query ?? ""), command: null }];
    if (c.name === "WebFetch") return [{ ...base, tool: "WebFetch" as const, target: String(c.input.url ?? ""), command: null }];
    if (c.name !== "Bash" || typeof c.input.command !== "string") return [];
    const command = c.input.command;
    return shellAttempts(command).map((a) => ({ ...base, ...a, command }));
  });
}

const walkFiles = (d: string): string[] => (existsSync(d) ? readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walkFiles(join(d, f)) : [join(d, f)])) : []);

/** The hosted web_search_call items in Codex rollouts, each with its query or URL. */
function webSearchCalls(rollouts: readonly string[]): string[] {
  const out: string[] = [];
  for (const text of rollouts)
    for (const line of text.split("\n")) {
      if (!line.includes("web_search_call")) continue;
      try {
        const p = JSON.parse(line)?.payload;
        if (p?.type !== "web_search_call") continue;
        const a = p.action ?? {};
        out.push(String(a.query ?? a.url ?? (Array.isArray(a.queries) ? a.queries.join(" | ") : "") ?? ""));
      } catch {
        continue;
      }
    }
  return out;
}

/** The proxy journals' tool_removed lines, by meter id. */
export function removalsByMeter(journals: readonly string[]): Map<string, ReviewReading["removed"]> {
  const out = new Map<string, ReviewReading["removed"]>();
  for (const text of journals)
    for (const line of text.split("\n")) {
      if (!line.includes('"tool_removed"')) continue;
      let l: any;
      try {
        l = JSON.parse(line);
      } catch {
        continue;
      }
      if (l?.kind !== "tool_removed" || typeof l.meter_id !== "string" || !Array.isArray(l.removed)) continue;
      const list = out.get(l.meter_id) ?? [];
      for (const r of l.removed) list.push({ request_id: String(l.request_id), meter_id: l.meter_id, path: String(r?.path), type: String(r?.type) });
      out.set(l.meter_id, list);
    }
  return out;
}

/** One review's attempts, removals and reading. */
export function readReview(review: ReviewInput, markers: UnitMarkers, removals: ReadonlyMap<string, ReviewReading["removed"]>): ReviewReading {
  const names = unitMatcher(markers);
  const claude = attemptsOf(rawCalls(readTranscript(readFileSync(review.transcript, "utf8"))), "claude");
  let voice: RawAttempt[] = [];
  let unreadable = 0;
  const missing = review.voice && (review.voice_sessions === null || !existsSync(review.voice_sessions));
  if (review.voice && !missing) {
    const root = existsSync(join(review.voice_sessions!, "codex-sessions")) ? join(review.voice_sessions!, "codex-sessions") : review.voice_sessions!;
    const rollouts = walkFiles(root).filter((f) => /rollout-.*\.jsonl$/.test(f)).map((f) => readFileSync(f, "utf8"));
    const t = codexTranscript(rollouts);
    unreadable = t.unreadable_items;
    voice = [...attemptsOf(rawCalls(t.recs), "voice"), ...webSearchCalls(rollouts).map((target) => ({ source: "voice" as const, tool: "web_search_call" as const, target, command: null, result: null, error: false }))];
  }
  const attempts: Attempt[] = [...claude, ...voice].map((a) => {
    const reached = a.result !== null && !a.error && a.result.trim() !== "" && !NETWORK_FAILURE.test(a.result);
    const hits = reached ? names(a.result!) : [];
    const target_hits = names(a.target + "\n" + (a.command ?? ""));
    const verdict = hits.length ? "contaminated" : a.result === null || (reached && target_hits.length) ? "doubtful" : "clean";
    return { ...a, reached, hits, target_hits, verdict };
  });
  const contaminated = attempts.some((a) => a.verdict === "contaminated");
  return {
    review: review.review,
    arm: review.arm,
    unit: review.unit,
    attempts,
    removed: review.meter_ids.flatMap((id) => removals.get(id) ?? []),
    voice_sessions_missing: missing,
    voice_unreadable: unreadable,
    contaminated,
    doubtful: !contaminated && attempts.some((a) => a.verdict === "doubtful"),
  };
}

/** Per-arm counts from readings, in the order arms first appear. */
export function armReadings(reviews: readonly ReviewReading[]): ArmReading[] {
  const arms = [...new Set(reviews.map((r) => r.arm))];
  return arms.map((arm) => {
    const rs = reviews.filter((r) => r.arm === arm);
    const by_tool: ArmReading["by_tool"] = {};
    for (const a of rs.flatMap((r) => r.attempts)) by_tool[a.tool] = (by_tool[a.tool] ?? 0) + 1;
    const contaminated = rs.filter((r) => r.contaminated).length;
    const share = rs.length ? contaminated / rs.length : 0;
    return {
      arm,
      reviews: rs.length,
      attempted_searches: rs.reduce((n, r) => n + r.attempts.length, 0),
      by_tool,
      removed_web_search_tools: rs.reduce((n, r) => n + r.removed.length, 0),
      contaminated_reviews: contaminated,
      doubtful_reviews: rs.filter((r) => r.doubtful).length,
      voice_sessions_missing: rs.filter((r) => r.voice_sessions_missing).length,
      contaminated_share: share,
      untested: share > UNTESTED_SHARE,
    };
  });
}

/** Reads every review. units must hold each review's unit; journals are the proxy journals' texts. */
export function readContamination(reviews: readonly ReviewInput[], units: readonly UnitMarkers[], journals: readonly string[]): ContaminationReport {
  const byUnit = new Map(units.map((u) => [u.unit, u]));
  const missing = [...new Set(reviews.filter((r) => !byUnit.has(r.unit)).map((r) => r.unit))];
  if (missing.length) throw new Error("E_USAGE: no markers for unit(s) " + missing.join(", "));
  const removals = removalsByMeter(journals);
  const read = reviews.map((r) => readReview(r, byUnit.get(r.unit)!, removals));
  return { arms: armReadings(read), reviews: read, contaminated: read.filter((r) => r.contaminated).map((r) => r.review) };
}

export interface SecondReadCase {
  case_id: string;
  reader: (typeof SECOND_READERS)[Source];
  question: string;
  markers: { prs: string[]; commits: string[]; ids: string[]; suite: readonly string[] };
  attempt: { tool: AttemptTool; target: string; command: string | null; result: string | null; result_cut: boolean };
}

/** The blind second read's cases (no arm, model or review id) and the key that maps each back. */
export function secondReadCases(report: ContaminationReport, units: readonly UnitMarkers[]): { cases: SecondReadCase[]; key: Array<{ case_id: string; review: string; arm: string; source: Source; attempt: number }> } {
  const byUnit = new Map(units.map((u) => [u.unit, u]));
  const cases: SecondReadCase[] = [];
  const key: Array<{ case_id: string; review: string; arm: string; source: Source; attempt: number }> = [];
  for (const r of report.reviews)
    r.attempts.forEach((a, i) => {
      if (a.verdict !== "doubtful") return;
      const u = byUnit.get(r.unit)!;
      const case_id = "c_" + randomBytes(8).toString("hex");
      cases.push({
        case_id,
        reader: SECOND_READERS[a.source],
        question: "From the logged text below only: did this search or fetch reach content that names any of the markers (the unit's PR or fix PR, its fix commit, its advisory or CVE id, or the review-real-bugs suite or its answer files)? Answer contaminated or clean, then one line of reason.",
        markers: { prs: u.prs, commits: u.commits, ids: u.ids, suite: SUITE_MARKERS },
        attempt: { tool: a.tool, target: a.target, command: a.command, result: a.result === null ? null : a.result.slice(0, CASE_RESULT_CHARS), result_cut: (a.result?.length ?? 0) > CASE_RESULT_CHARS },
      });
      key.push({ case_id, review: r.review, arm: r.arm, source: a.source, attempt: i });
    });
  const order = cases.map((_, i) => i).sort((x, y) => (cases[x]!.case_id < cases[y]!.case_id ? -1 : 1));
  return { cases: order.map((i) => cases[i]!), key: order.map((i) => key[i]!) };
}

/** Folds the second read's verdicts in: a doubtful attempt it rules contaminated contaminates its review, and one it rules clean is clean. */
export function applySecondRead(report: ContaminationReport, key: ReturnType<typeof secondReadCases>["key"], verdicts: ReadonlyArray<{ case_id: string; verdict: "contaminated" | "clean" }>): ContaminationReport {
  const byCase = new Map(verdicts.map((v) => [v.case_id, v.verdict]));
  const reviews = report.reviews.map((r) => {
    const attempts = r.attempts.map((a, i) => {
      const k = key.find((x) => x.review === r.review && x.attempt === i);
      const v = k ? byCase.get(k.case_id) : undefined;
      return a.verdict === "doubtful" && v ? { ...a, verdict: v } : a;
    });
    const contaminated = attempts.some((a) => a.verdict === "contaminated");
    return { ...r, attempts, contaminated, doubtful: !contaminated && attempts.some((a) => a.verdict === "doubtful") };
  });
  return { arms: armReadings(reviews), reviews, contaminated: reviews.filter((r) => r.contaminated).map((r) => r.review) };
}

/** Writes contamination.json, second-read.jsonl (the blind cases) and second-read-key.tsv to dir. */
export function writeContamination(dir: string, report: ContaminationReport, units: readonly UnitMarkers[]): { cases: number } {
  mkdirSync(dir, { recursive: true });
  const { cases, key } = secondReadCases(report, units);
  writeFileSync(join(dir, "contamination.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(dir, "second-read.jsonl"), cases.map((c) => JSON.stringify(c) + "\n").join(""));
  writeFileSync(join(dir, "second-read-key.tsv"), ["case_id\treview\tarm\tsource\tattempt", ...key.map((k) => [k.case_id, k.review, k.arm, k.source, k.attempt].join("\t"))].join("\n") + "\n");
  return { cases: cases.length };
}

if (import.meta.main) {
  const [input, out] = process.argv.slice(2);
  if (!input || !out) {
    console.error("E_USAGE: bun src/trial/review/contamination.ts <input.json with reviews, units and journals (paths)> <out dir>");
    process.exit(2);
  }
  const spec = JSON.parse(readFileSync(input, "utf8")) as { reviews: ReviewInput[]; units: UnitMarkers[]; journals: string[] };
  const report = readContamination(spec.reviews, spec.units, spec.journals.map((j) => readFileSync(j, "utf8")));
  const { cases } = writeContamination(out, report, spec.units);
  console.log(JSON.stringify({ arms: report.arms, contaminated: report.contaminated, second_read_cases: cases }, null, 2));
}
