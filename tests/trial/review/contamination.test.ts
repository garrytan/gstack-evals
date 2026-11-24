// Copyright (c) 2026 Garry Tan. MIT License.
// Search extraction and the contamination rule (review-models prereg 2026-11-24-geva-590, section 5) on planted session
// records and proxy journals. The units and their markers are planted here; contamination.ts names none.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySecondRead, readContamination, secondReadCases, SECOND_READERS, shellAttempts, unitMatcher, writeContamination, type ReviewInput, type UnitMarkers } from "../../../src/trial/review/contamination.ts";

const FIX = "1a2b3c4d5e6f708192a3b4c5d6e7f80912345678";
const UNIT: UnitMarkers = { unit: "acme-widget-42", prs: ["acme/widget#42", "https://github.com/acme/widget/pull/57"], commits: [FIX], ids: ["GHSA-abcd-efgh-ijkl", "CVE-2026-1234"] };
const OTHER: UnitMarkers = { unit: "zeta-lib-7", prs: ["zeta/lib#7"], commits: ["ffeeddccbbaa99887766554433221100ffeeddcc"], ids: [] };

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "rm-contam-"));
  dirs.push(d);
  return d;
};

let n = 0;
/** A transcript.ndjson: each call an assistant tool_use and, unless result is undefined, its tool_result. */
function transcript(dir: string, name: string, calls: Array<{ tool: string; input: Record<string, unknown>; result?: string; error?: boolean; sub?: boolean }>): string {
  const lines: object[] = [{ type: "system", subtype: "init" }];
  for (const c of calls) {
    const id = "toolu_" + n++;
    lines.push({ type: "assistant", parent_tool_use_id: c.sub ? "toolu_parent" : null, message: { content: [{ type: "text", text: "checking" }, { type: "tool_use", id, name: c.tool, input: c.input }] } });
    if (c.result !== undefined) lines.push({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: c.result }], is_error: c.error ?? false }] } });
  }
  const path = join(dir, name + ".ndjson");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

/** A voice's codex-sessions folder: one rollout with exec_command calls and their outputs, and any extra lines. */
function voiceSessions(dir: string, name: string, commands: Array<{ cmd: string; output: string; code?: number }>, extra: object[] = []): string {
  const root = join(dir, name, "codex-sessions", "2026", "11", "30");
  mkdirSync(root, { recursive: true });
  let t = 0;
  const ts = () => new Date(Date.UTC(2026, 10, 30, 0, 0, t++)).toISOString();
  const lines: object[] = [{ timestamp: ts(), type: "session_meta", payload: { id: "s1", cwd: "/work/unit", cli_version: "0.170.0" } }];
  commands.forEach((c, i) => {
    lines.push({ timestamp: ts(), type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: c.cmd }), call_id: "call_" + i } });
    lines.push({ timestamp: ts(), type: "response_item", payload: { type: "function_call_output", call_id: "call_" + i, output: "Chunk ID: x\nWall time: 0.1 seconds\nProcess exited with code " + (c.code ?? 0) + "\nOutput:\n" + c.output } });
  });
  for (const e of extra) lines.push({ timestamp: ts(), ...e });
  writeFileSync(join(root, "rollout-2026-11-30T00-00-00-s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return join(dir, name);
}

describe("unit markers", () => {
  // Value: protects=a review is flagged only on its own unit's names and the suite's, in the forms content names them; fails_when=a PR, commit prefix, id or suite name is missed, or a near miss counts; why_new=GEVA-590 section 5; seam=unitMatcher; no_claim=every way a page can name a fix
  test("PRs, fix PRs, commit prefixes, advisory and CVE ids and the suite are matched, near misses are not", () => {
    const m = unitMatcher(UNIT);
    expect(m("see https://github.com/acme/widget/pull/42 and acme/widget#57")).toEqual(["pr acme/widget#42", "pr acme/widget#57"]);
    expect(m("acme/widget#420 acme/widget/issues/4")).toEqual([]);
    expect(m("fixed in 1a2b3c4 and 1a2b3c4d5e6f7081")).toEqual(["commit 1a2b3c4d5e6f"]);
    expect(m("1a2b3c4ff is another commit; 1a2b3c is too short")).toEqual([]);
    expect(m("advisory ghsa-abcd-efgh-ijkl, CVE-2026-12345")).toEqual(["id GHSA-abcd-efgh-ijkl"]);
    expect(m("CVE-2026-1234.")).toEqual(["id CVE-2026-1234"]);
    expect(m("garrytan/g-harness-evals docs/benchmarks/2026-11-review-real-bugs")).toEqual(["suite review-real-bugs", "suite harness-evals"]);
    expect(unitMatcher(OTHER)("acme/widget#42 1a2b3c4d")).toEqual([]);
    expect(() => unitMatcher({ ...UNIT, prs: ["PR 42"] })).toThrow("E_USAGE");
    expect(() => unitMatcher({ ...UNIT, commits: ["xyz"] })).toThrow("E_USAGE");
  });
});

describe("shell searches and fetches", () => {
  // Value: protects=every search or fetch through a shell is found with its URL or query, and plain local commands are not; fails_when=curl, wget, gh, a remote git call or a URL in an interpreter is missed, or a local git, gh --version or an echoed URL counts; why_new=GEVA-590 section 5; seam=shellAttempts; no_claim=every network client
  test("curl, wget, gh, remote git and interpreter URLs are attempts with their targets", () => {
    expect(shellAttempts("cd /work/unit && HTTPS_PROXY= curl -sL -H 'Accept: x' https://github.com/acme/widget/pull/42 | head")).toEqual([{ tool: "curl", target: "https://github.com/acme/widget/pull/42" }]);
    expect(shellAttempts("timeout 20 wget -qO- example.com/a; sudo curl -X GET")).toEqual([{ tool: "wget", target: "example.com/a" }, { tool: "curl", target: "-X GET" }]);
    expect(shellAttempts("gh pr view 42 --repo acme/widget && gh --version")).toEqual([{ tool: "gh", target: "pr view 42 --repo acme/widget" }]);
    expect(shellAttempts("git -C /work/unit fetch origin main; git clone https://github.com/garrytan/g-harness-evals; git fetch; git ls-remote git@github.com:acme/widget.git")).toEqual([
      { tool: "git", target: "fetch origin main" },
      { tool: "git", target: "clone https://github.com/garrytan/g-harness-evals" },
      { tool: "git", target: "fetch (default remote)" },
      { tool: "git", target: "ls-remote git@github.com:acme/widget.git" },
    ]);
    expect(shellAttempts("python3 -c \"import urllib.request as u; print(u.urlopen('https://api.github.com/repos/acme/widget').read())\"")).toEqual([{ tool: "shell_url", target: "https://api.github.com/repos/acme/widget" }]);
    expect(shellAttempts("git diff origin/main...HEAD; git fetch ./other; git log --oneline; echo https://example.com; rg TODO")).toEqual([]);
  });
});

function plantedRun(dir: string) {
  const reviews: ReviewInput[] = [
    {
      review: "acme-widget-42|OS|1", arm: "OS", unit: UNIT.unit, voice: true, meter_ids: ["m_os1"],
      transcript: transcript(dir, "os1", [
        { tool: "Bash", input: { command: "git diff origin/main...HEAD" }, result: "diff --git a/x b/x" },
        { tool: "WebSearch", input: { query: "acme widget overflow fix" }, result: "Error: No such tool available: WebSearch", error: true },
      ]),
      voice_sessions: voiceSessions(dir, "os1-voice", [{ cmd: "curl -s https://github.com/acme/widget/pull/42", output: "curl: (6) Could not resolve host: github.com", code: 6 }]),
    },
    {
      review: "acme-widget-42|OA|1", arm: "OA", unit: UNIT.unit, voice: true, meter_ids: ["m_oa1"],
      transcript: transcript(dir, "oa1", [{ tool: "WebFetch", input: { url: "https://github.com/acme/widget/pull/42" }, result: "A page about something else." }]),
      voice_sessions: voiceSessions(dir, "oa1-voice", [{ cmd: "gh api repos/acme/widget/pulls/57", output: "{\"title\": \"Fix overflow\", \"body\": \"Fixes GHSA-abcd-efgh-ijkl\"}" }], [{ type: "response_item", payload: { type: "web_search_call", status: "completed", action: { type: "search", query: "acme widget GHSA" } } }]),
    },
    {
      review: "zeta-lib-7|OA|1", arm: "OA", unit: OTHER.unit, voice: true, meter_ids: ["m_oa2", "m_oa2b"],
      transcript: transcript(dir, "oa2", [{ tool: "Bash", input: { command: "git clone https://github.com/garrytan/g-harness-evals /tmp/x" }, result: "Cloning into '/tmp/x'...\nchecked out review-real-bugs answers" , sub: true }]),
      voice_sessions: null,
    },
    {
      review: "zeta-lib-7|N|1", arm: "N", unit: OTHER.unit, voice: false, meter_ids: ["m_n"],
      transcript: transcript(dir, "n", [{ tool: "Bash", input: { command: "wget -qO- https://github.com/zeta/lib/pull/7" } }]),
      voice_sessions: null,
    },
  ];
  const journal = [
    { kind: "tool_removed", request_id: "rq_a", meter_id: "m_os1", removed: [{ path: "tools[0]", type: "web_search" }] },
    { kind: "request", meter_id: "m_os1", request_id: "rq_a" },
    { kind: "tool_removed", request_id: "rq_b", meter_id: "m_oa1", removed: [{ path: "tools[0]", type: "web_search" }, { path: "input[0].tools[3]", type: "web_search" }] },
    { kind: "tool_removed", request_id: "rq_c", meter_id: "m_other", removed: [{ path: "tools[0]", type: "web_search" }] },
  ].map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n";
  return { reviews, journals: [journal] };
}

describe("the contamination rule", () => {
  // Value: protects=each review's attempts are read from its session, its voice's rollouts and its slots' removal lines, and only content that came back naming the unit's markers contaminates; fails_when=a refused or failed fetch contaminates, content naming a marker is missed, a removal is miscounted or another review's slot is counted; why_new=GEVA-590 section 5; seam=readContamination; no_claim=real sessions
  test("per review: failures are clean, marker hits contaminate, unknown or marker-seeking reaches are doubtful", () => {
    const { reviews, journals } = plantedRun(tmp());
    const report = readContamination(reviews, [UNIT, OTHER], journals);
    const [os1, oa1, oa2, n1] = report.reviews;
    expect(os1!.attempts.map((a) => [a.source, a.tool, a.reached, a.verdict])).toEqual([["claude", "WebSearch", false, "clean"], ["voice", "curl", false, "clean"]]);
    expect(os1!.removed).toEqual([{ request_id: "rq_a", meter_id: "m_os1", path: "tools[0]", type: "web_search" }]);
    expect([os1!.contaminated, os1!.doubtful]).toEqual([false, false]);
    expect(oa1!.attempts.map((a) => [a.source, a.tool, a.target, a.verdict, a.hits])).toEqual([
      ["claude", "WebFetch", "https://github.com/acme/widget/pull/42", "doubtful", []],
      ["voice", "gh", "api repos/acme/widget/pulls/57", "contaminated", ["id GHSA-abcd-efgh-ijkl"]],
      ["voice", "web_search_call", "acme widget GHSA", "doubtful", []],
    ]);
    expect(oa1!.contaminated).toBe(true);
    expect(oa2!.attempts.map((a) => [a.tool, a.verdict, a.hits])).toEqual([["git", "contaminated", ["suite review-real-bugs"]]]);
    expect(oa2!.voice_sessions_missing).toBe(true);
    expect(n1!.attempts.map((a) => [a.tool, a.result, a.verdict])).toEqual([["wget", null, "doubtful"]]);
    expect([n1!.voice_sessions_missing, n1!.doubtful]).toEqual([false, true]);
    expect(report.contaminated).toEqual(["acme-widget-42|OA|1", "zeta-lib-7|OA|1"]);
    expect(report.arms).toEqual([
      { arm: "OS", reviews: 1, attempted_searches: 2, by_tool: { WebSearch: 1, curl: 1 }, removed_web_search_tools: 1, contaminated_reviews: 0, doubtful_reviews: 0, voice_sessions_missing: 0, contaminated_share: 0, untested: false },
      { arm: "OA", reviews: 2, attempted_searches: 4, by_tool: { WebFetch: 1, gh: 1, web_search_call: 1, git: 1 }, removed_web_search_tools: 2, contaminated_reviews: 2, doubtful_reviews: 0, voice_sessions_missing: 1, contaminated_share: 1, untested: true },
      { arm: "N", reviews: 1, attempted_searches: 1, by_tool: { wget: 1 }, removed_web_search_tools: 0, contaminated_reviews: 0, doubtful_reviews: 1, voice_sessions_missing: 0, contaminated_share: 0, untested: false },
    ]);
    expect(() => readContamination(reviews, [UNIT], journals)).toThrow("E_USAGE: no markers for unit(s) zeta-lib-7");
  });

  // Value: protects=the blind second read gets every doubtful case with its unit's markers and the logged text only, read by the other family, and its verdicts fold back; fails_when=a case names its arm, model or review, goes to the wrong reader, or a verdict is lost; why_new=GEVA-590 section 5; seam=secondReadCases, writeContamination, applySecondRead; no_claim=the second read itself (a paid call, not run)
  test("doubtful cases go blind to the other family's reader, and the second read's verdicts fold back", () => {
    const dir = tmp();
    const { reviews, journals } = plantedRun(dir);
    const report = readContamination(reviews, [UNIT, OTHER], journals);
    const out = join(dir, "out");
    expect(writeContamination(out, report, [UNIT, OTHER])).toEqual({ cases: 3 });
    const cases = readFileSync(join(out, "second-read.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const key = readFileSync(join(out, "second-read-key.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
    expect(cases.map((c) => c.case_id)).toEqual(key.map((k) => k[0]));
    for (const c of cases) {
      expect(Object.keys(c).sort()).toEqual(["attempt", "case_id", "markers", "question", "reader"]);
      expect(JSON.stringify(c)).not.toMatch(/"OA"|"OS"|"N"|\|OA\||\|N\||claude-fable|gpt-6\.2-sol/);
    }
    const byTarget = Object.fromEntries(cases.map((c) => [c.attempt.target, c]));
    expect(byTarget["https://github.com/acme/widget/pull/42"]!.reader).toBe(SECOND_READERS.claude);
    expect(byTarget["acme widget GHSA"]!.reader).toBe(SECOND_READERS.voice);
    expect(byTarget["https://github.com/zeta/lib/pull/7"]!.markers).toEqual({ prs: ["zeta/lib#7"], commits: OTHER.commits, ids: [], suite: ["review-real-bugs", "harness-evals"] });
    expect(JSON.parse(readFileSync(join(out, "contamination.json"), "utf8")).contaminated).toEqual(report.contaminated);

    const { key: k } = secondReadCases(report, [UNIT, OTHER]);
    const wget = k.find((x) => x.review === "zeta-lib-7|N|1")!;
    const after = applySecondRead(report, k, [{ case_id: wget.case_id, verdict: "contaminated" }, ...k.filter((x) => x !== wget).map((x) => ({ case_id: x.case_id, verdict: "clean" as const }))]);
    expect(after.contaminated).toEqual(["acme-widget-42|OA|1", "zeta-lib-7|OA|1", "zeta-lib-7|N|1"]);
    expect(after.arms.find((a) => a.arm === "N")).toMatchObject({ contaminated_reviews: 1, doubtful_reviews: 0, untested: true });
    expect(after.reviews.every((r) => r.attempts.every((a) => a.verdict !== "doubtful"))).toBe(true);
  });
});
