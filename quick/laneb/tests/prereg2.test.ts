import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobConfig } from "../runner/grid.ts";

const here = import.meta.dir;

describe("prereg 2 wrapper", () => {
  test("the nudge wrapper is the prereg 1 wrapper plus one paragraph", () => {
    const base = readFileSync(join(here, "../runner/prompt-wrapper.md"), "utf8");
    const nudge = readFileSync(join(here, "../runner/prompt-wrapper-nudge.md"), "utf8");
    expect(nudge.replace("You have skills installed; use them where they help.\n\n", "")).toBe(base);
    expect(nudge).toContain("{instruction}");
  });

  test("jobConfig points every agent at the chosen wrapper, prompt-wrapper.md by default", () => {
    const spec = {
      job_name: "p", tasks_dir: "/run/tasks", tasks: ["a"], attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://g:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
      models: [{ id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 }],
      arms: [{ name: "gstack", tar: "/run/arms/gstack.tar", sha256: "b" }],
    };
    expect(jobConfig(spec).agents[0].kwargs.wrapper_path).toBe("/r/prompt-wrapper.md");
    expect(jobConfig({ ...spec, wrapper: "prompt-wrapper-nudge.md" }).agents[0].kwargs.wrapper_path).toBe("/r/prompt-wrapper-nudge.md");
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
    writeFileSync(join(root, "out/proxy-requests.jsonl"), JSON.stringify({ event: "request", status: 200, usage: { output_tokens: 1 }, max_tokens: 32000 }) + "\n");
    trial(root, "t1", [
      ...bash("a", "python3 -c \"import urllib.request; urllib.request.urlopen('https://grep.app/api/search?q=x')\"", "URLError(SSLEOFError(8))"),
      ...bash("b", "pip install --index-url https://pypi.org/simple numpy", "Successfully installed numpy"),
    ], 1);
    trial(root, "t2", [
      ...bash("c", "iptables -L", "Chain INPUT"),
      ...bash("d", "curl -s https://pypi.org/pypi/terminal-bench/json", "{}"),
      ...bash("e", "pip install terminal-bench", "Successfully installed"),
    ], 0);
    trial(root, "t3", bash("f", "ls /app", "a.out"), null);
    const run = Bun.spawnSync(["python3", join(here, "../analysis/audit.py"), root, "--json", join(root, "audit.json")]);
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(readFileSync(join(root, "audit.json"), "utf8"));
    expect(out.trials.t1.flags).toEqual(["offlist_attempt", "solution_seeking"]);
    expect(out.trials.t1.installs).toEqual(["numpy"]);
    expect(out.trials.t2.flags).toEqual(["bench_package", "network_bypass", "pypi_direct", "solution_seeking"]);
    expect(out.trials.t3.flags).toEqual([]);
    expect(out.no_reward).toEqual([["t3", null]]);
    expect(out.rerun_duplicate_sessions).toEqual([]);
    expect(out.bad_max_tokens).toBe(0);
  });
});
