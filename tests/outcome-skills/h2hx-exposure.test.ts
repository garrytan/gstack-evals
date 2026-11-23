// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's exposure detectors (ext/exposure.ts) on real Codex 0.170.0 rollouts, each captured from sol-agent in docker exec
// mode against the stub Responses API with the arm's installed home (ext/stage0.ts captureCodexSession). The fixtures are
// gzip JSON lines under fixtures/h2hx-codex; the two request files are the first request bodies the stub received.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { codexEvents, codexExposure, readCodexEvents } from "../../lanes/outcome-skills/h2h/ext/exposure.ts";
import { readExtPrereg } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { codexStage0, diffPaths, masked, requestTools } from "../../lanes/outcome-skills/h2h/ext/stage0.ts";

const FX = join(import.meta.dir, "fixtures", "h2hx-codex");
const X = readExtPrereg();
const LINE = X.parts.S.agents_md["s-gstack-line"]!;
const evs = (name: string) => readCodexEvents([join(FX, name + ".rollout.jsonl.gz")]);
const request = (name: string) => gunzipSync(readFileSync(join(FX, name + ".request.json.gz"))).toString("utf8");

describe("Codex rollouts as base events", () => {
  test("a code-mode cell's command reads as a Bash call with its output and exit, and a patch as a Write", () => {
    const e = evs("s-agent-skills-bug");
    const bash = e.filter((x) => x.kind === "tool_use" && x.name === "Bash");
    expect(bash.map((x) => x.input!.command)).toEqual(["echo FAILED: 1 failing; exit 1"]);
    expect(e.find((x) => x.kind === "tool_result" && x.id === bash[0]!.id)).toMatchObject({ text: "FAILED: 1 failing\n", error: true });
    expect(e.filter((x) => x.name === "Write").map((x) => x.input!.file_path)).toEqual(["/w/tests/test_parser.py", "/w/src/parser.py"]);
    expect(e.filter((x) => x.kind === "text").map((x) => x.text)).toEqual(["Fixed it.\n\nDONE"]);
  });

  test("a sub-agent's rollout reads as side events, and a torn line other than the last refuses", () => {
    const recs = [{ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] } }];
    expect(codexEvents(recs, false)[0]).toMatchObject({ kind: "text", main: false });
    const bad = join(mkdtempSync(join(tmpdir(), "h2hx-torn-")), "rollout.jsonl");
    writeFileSync(bad, "{nope\n" + JSON.stringify(recs[0]) + "\n");
    expect(() => readCodexEvents([bad])).toThrow(/^E_H2HX_CODEX_EXPOSURE /);
  });
});

describe("part S exposure on real rollouts", () => {
  const cases: Array<[string, Parameters<typeof codexExposure>[0], "bug" | "feature", { loaded: boolean; procedure: boolean; markers: string[] }]> = [
    ["s-none-done", "s-none", "bug", { loaded: false, procedure: false, markers: [] }],
    ["s-gstack-bug", "s-gstack", "bug", { loaded: true, procedure: true, markers: ["installed-pack", "listing"] }],
    ["s-gstack-feature", "s-gstack", "feature", { loaded: true, procedure: true, markers: ["skill:autoplan", "skill-start:autoplan"] }],
    ["s-superpowers-feature", "s-superpowers", "feature", { loaded: false, procedure: true, markers: ["announce:writing-plans", "plan:/w/docs/superpowers/plans/2026-11-21-parser.md"] }],
    ["s-superpowers-mention", "s-superpowers", "bug", { loaded: true, procedure: false, markers: ["skill:superpowers:brainstorming"] }],
    ["s-agent-skills-bug", "s-agent-skills", "bug", { loaded: false, procedure: true, markers: ["test-first:/w/tests/test_parser.py", "failing-run"] }],
    ["s-agent-skills-mention", "s-agent-skills", "bug", { loaded: true, procedure: false, markers: ["skill:agent-skills:test-driven-development"] }],
    ["s-agent-skills-bare", "s-agent-skills", "bug", { loaded: false, procedure: false, markers: [] }],
    ["s-gsd-bug", "s-gsd", "bug", { loaded: true, procedure: true, markers: ["skill:gsd-debug", "gsd-tools"] }],
    ["s-tstack-bug", "s-tstack", "bug", { loaded: true, procedure: false, markers: ["read:full-send"] }],
    ["s-tstack-feature", "s-tstack", "feature", { loaded: true, procedure: true, markers: ["skill:sol-loop", "step:sol-loop"] }],
  ];
  for (const [name, arm, entry, want] of cases) {
    test(name, () => {
      const got = codexExposure(arm, entry, evs(name));
      expect({ loaded: got.loaded, procedure: got.procedure }).toEqual({ loaded: want.loaded, procedure: want.procedure });
      for (const m of want.markers) expect(got.markers).toContain(m);
      if (!want.markers.length) expect(got.markers).toEqual([]);
    });
  }

  test("the line arm's exposure is AGENTS.md's text in the first request, which s-gstack's first request lacks", () => {
    const line = codexExposure("s-gstack-line", "bug", evs("s-gstack-line-bug"), { firstRequest: request("s-gstack-line-bug"), agentsMd: LINE });
    expect(line).toMatchObject({ loaded: true, procedure: true });
    expect(line.markers[0]).toBe("agents-md");
    expect(codexExposure("s-gstack-line", "bug", evs("s-gstack-bug"), { firstRequest: request("s-gstack-bug"), agentsMd: LINE })).toMatchObject({ loaded: false, procedure: false });
    expect(() => codexExposure("s-gstack-line", "bug", evs("s-gstack-bug"))).toThrow(/^E_H2HX_CODEX_EXPOSURE /);
  });
});

describe("stage 0 helpers", () => {
  test("the first request offers the code-mode tools and both question tools, and masked ids compare equal", () => {
    const body = JSON.parse(request("s-gstack-bug"));
    const tools = requestTools(body);
    expect(tools).toContain("functions.exec");
    expect(tools.filter((t) => t.includes("request_user_input"))).toEqual(["functions.request_user_input", "functions.request_user_input_async"]);
    expect(body.tools ?? []).toEqual([]);
    const a = { id: "msg_01a1fd45-244c-77d0-8a6e-defada43e443", meta: '{"turn_started_at_unix_ms":1795250452073}', at: "2026-11-21T08:42:09.277Z" };
    const b = { id: "msg_01a1fd46-0000-7000-8000-000000000000", meta: '{"turn_started_at_unix_ms":1795250469268}', at: "2026-11-21T08:43:00.000Z" };
    expect(diffPaths(masked(a), masked(b))).toEqual([]);
    expect(diffPaths(masked(a), masked({ ...b, extra: 1 }))).toEqual(["/extra"]);
  });
});

const SOURCES = process.env.H2H_SOURCES ?? "";
describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1" || !SOURCES)("stage 0 in Docker", () => {
  test("gstack-session-kind reads interactive through sol-agent and headless through codex; CI is unset; request and session metadata match", async () => {
    const home = mkdtempSync(join(tmpdir(), "h2hx-s0-home-"));
    mkdirSync(join(home, "gstack", "bin"), { recursive: true });
    const kind = spawnSync("git", ["-C", join(SOURCES, "garrytan_gstack"), "show", X.gstack.S.sha + ":bin/gstack-session-kind"], { encoding: "utf8" });
    expect(kind.status).toBe(0);
    writeFileSync(join(home, "gstack", "bin", "gstack-session-kind"), kind.stdout, { mode: 0o755 });
    const r = await codexStage0({ arm: "s-gstack", home, out: join(mkdtempSync(join(tmpdir(), "h2hx-s0-")), "out") });
    expect(r.runs.map((x) => [x.name, x.exit, x.session_kind, x.ci, x.github_actions, x.summary_end])).toEqual([["link", 0, "interactive", "unset", "unset", "completed"], ["plain", 0, "headless", "unset", "unset", "completed"]]);
    expect(r.runs.map((x) => x.session_meta)).toEqual([{ originator: "codex_exec", cli_version: "0.170.0" }, { originator: "codex_exec", cli_version: "0.170.0" }]);
    expect(r.runs.map((x) => [x.path_kept, x.bun?.startsWith("/opt/h2h-runtimes/")])).toEqual([[true, true], [true, true]]);
    expect({ same_request: r.same_request, request_diff: r.request_diff, same_session_meta: r.same_session_meta }).toEqual({ same_request: true, request_diff: [], same_session_meta: true });
    expect(r.question_tools).toEqual(["functions.request_user_input", "functions.request_user_input_async"]);
  }, 600_000);
});
