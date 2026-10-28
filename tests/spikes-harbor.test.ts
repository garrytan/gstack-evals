import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keyless checks on the U8 Harbor spike in spikes/harbor/. They need python3, not Harbor, Docker or a key.
const SPIKE = join(import.meta.dir, "..", "spikes", "harbor");
const read = (path: string) => readFileSync(join(SPIKE, path), "utf8");
const persona = JSON.parse(read("persona.json"));

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "harbor-spike-"));
  dirs.push(dir);
  return dir;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

async function startUpstream(log: string): Promise<{ base: string; stop: () => void }> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = Bun.spawn(["python3", join(SPIKE, "fake_upstream.py"), "127.0.0.1"], {
    env: { ...process.env, FAKE_UPSTREAM_PORT: String(port), FAKE_UPSTREAM_LOG: log },
    stdout: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`${base}/healthz`).then((r) => r.ok, () => false);
    if (ok) return { base, stop: () => proc.kill() };
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error("fake upstream did not start");
}

type Reply = { stop_reason: string; content: { type: string; id?: string; name?: string; input?: any; text?: string }[] };

const TOOLS = ["AskUserQuestion", "Bash", "Write"].map((name) => ({ name, input_schema: { type: "object" } }));
const QUESTION = "Which greeting should answer.txt contain?";

describe("fake upstream (spikes/harbor/fake_upstream.py)", () => {
  test("plays AskUserQuestion, Bash, Write, then text, and logs no key value", async () => {
    const log = join(scratch(), "upstream.jsonl");
    const { base, stop } = await startUpstream(log);
    try {
      const messages: unknown[] = [{ role: "user", content: "go" }];
      const turn = async (toolResult?: { id: string; content: string }): Promise<Reply> => {
        if (toolResult) messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolResult.id, content: toolResult.content }] });
        const res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": "value-that-must-not-be-logged" },
          body: JSON.stringify({ model: "claude-opus-5-5", stream: false, tools: TOOLS, messages }),
        });
        const body = (await res.json()) as Reply;
        messages.push({ role: "assistant", content: body.content });
        return body;
      };

      const ask = await turn();
      expect(ask.content[0]).toMatchObject({ type: "tool_use", id: "toolu_spike_1", name: "AskUserQuestion" });
      expect(ask.content[0].input.questions[0].question).toBe(QUESTION);

      const bash = await turn({ id: "toolu_spike_1", content: `Your questions have been answered: "${QUESTION}"="goodbye".` });
      expect(bash.content[0]).toMatchObject({ type: "tool_use", id: "toolu_spike_2", name: "Bash" });

      const write = await turn({ id: "toolu_spike_2", content: "tests_visible=no\n" });
      expect(write.content[0]).toMatchObject({ name: "Write", input: { file_path: "/app/answer.txt", content: "answer=goodbye\ntests_visible=no\n" } });

      const done = await turn({ id: "toolu_spike_3", content: "ok" });
      expect(done).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text" }] });

      const logged = readFileSync(log, "utf8");
      expect(logged.toLowerCase()).toContain("x-api-key");
      expect(logged).not.toContain("value-that-must-not-be-logged");
    } finally {
      stop();
    }
  });

  test("streams a tool call as Anthropic server-sent events", async () => {
    const { base, stop } = await startUpstream(join(scratch(), "upstream.jsonl"));
    try {
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, tools: TOOLS, messages: [{ role: "user", content: "go" }] }),
      });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const events = (await res.text()).split("\n").filter((l) => l.startsWith("event: ")).map((l) => l.slice(7));
      expect(events).toEqual(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
    } finally {
      stop();
    }
  });

  // Value: protects=the closing text turn, which Claude Code requests with stream=true, arrives as a text_delta; fails_when=the text branch of the SSE builder breaks; why_new=the stream test covers only a tool_use block; seam=none; no_claim=Claude Code's own SSE parser (a fixture client reads the stream)
  test("streams the closing text turn as a text delta that ends the turn", async () => {
    const { base, stop } = await startUpstream(join(scratch(), "upstream.jsonl"));
    try {
      const results = ["toolu_spike_1", "toolu_spike_2", "toolu_spike_3"].map((id) => ({ type: "tool_result", tool_use_id: id, content: `${QUESTION}="goodbye"` }));
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, tools: TOOLS, messages: [{ role: "user", content: "go" }, { role: "user", content: results }] }),
      });
      const data = (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
      expect(data.find((e) => e.type === "content_block_delta").delta).toEqual({ type: "text_delta", text: "Done: wrote /app/answer.txt." });
      expect(data.find((e) => e.type === "message_delta").delta.stop_reason).toBe("end_turn");
    } finally {
      stop();
    }
  });

  // Value: protects=HEAD probes get 200 and unknown GET paths get an Anthropic-style 404 error body, both logged; fails_when=do_HEAD is dropped or the GET router answers every path as healthy; why_new=startUpstream only polls /healthz; seam=none; no_claim=which probes Claude Code sends at startup (a fetch client stands in)
  test("answers HEAD probes with 200 and unknown GET paths with a 404 error body", async () => {
    const log = join(scratch(), "upstream.jsonl");
    const { base, stop } = await startUpstream(log);
    try {
      const head = await fetch(base, { method: "HEAD" });
      expect(head.status).toBe(200);
      const missing = await fetch(`${base}/v1/models`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ type: "error", error: { type: "not_found_error", message: "/v1/models" } });
      const entries = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(entries.map((e) => [e.method, e.path])).toContainEqual(["HEAD", "/"]);
      expect(entries.map((e) => [e.method, e.path])).toContainEqual(["GET", "/v1/models"]);
    } finally {
      stop();
    }
  });

  // Value: protects=the probe reports a canary search that errored (grep exit 2) or timed out as failed, so hidden cannot score 1 on a partial search; fails_when=the case statement accepts rc 2 again; why_new=the verifier test only feeds a prewritten scan_failed line; seam=none; no_claim=what grep returns inside the real task image (a stub timeout stands in)
  test("reports a canary search that errors as failed, not clean", () => {
    const probe = Bun.spawnSync(["python3", "-c", "import fake_upstream; print(fake_upstream.PROBE)"], { cwd: SPIKE }).stdout.toString();
    const segment = probe.slice(probe.indexOf("c=PERSONA-CANARY-"), probe.indexOf("echo agent_only"));
    const run = (rc: number) => {
      const bin = scratch();
      writeFileSync(join(bin, "timeout"), `#!/bin/sh\nexit ${rc}\n`, { mode: 0o755 });
      return Bun.spawnSync(["bash", "-c", segment], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }).stdout.toString().trim();
    };
    expect(run(1)).toBe("persona_canary_hits=none");
    expect(run(2)).toBe("persona_canary_hits=scan_failed_rc2");
    expect(run(124)).toBe("persona_canary_hits=scan_failed_rc124");
  });

  // Value: protects=an AskUserQuestion result sent as a list of text blocks is joined and parsed, and an unparseable one is marked, not guessed; fails_when=the list join in tool_results or the UNPARSED fallback in next_turn breaks; why_new=the script test sends string content with a parseable answer only; seam=none; no_claim=the exact result wording of other Claude Code versions
  test("parses an answer sent as text blocks and marks one it cannot parse", async () => {
    const { base, stop } = await startUpstream(join(scratch(), "upstream.jsonl"));
    try {
      const writeFor = async (answer: string) => {
        const res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "m",
            stream: false,
            tools: TOOLS,
            messages: [
              { role: "user", content: "go" },
              {
                role: "user",
                content: [
                  { type: "tool_result", tool_use_id: "toolu_spike_1", content: [{ type: "text", text: "Your questions have been answered: " }, { type: "text", text: answer }] },
                  { type: "tool_result", tool_use_id: "toolu_spike_2", content: [{ type: "text", text: "tests_visible=no\n" }] },
                ],
              },
            ],
          }),
        });
        return ((await res.json()) as Reply).content[0].input.content;
      };
      expect(await writeFor(`"${QUESTION}"="hello".`)).toBe("answer=hello\ntests_visible=no\n");
      expect(await writeFor("the user closed the dialog")).toBe("answer=UNPARSED:Your questions have been answered: the user closed the dialog\ntests_visible=no\n");
    } finally {
      stop();
    }
  });
});

describe("user simulator (spikes/harbor/usersim.py)", () => {
  test("answers a matched category from the persona and falls back without approving", () => {
    const events = join(scratch(), "events.jsonl");
    const script = [
      "import json, sys",
      "from pathlib import Path",
      "from usersim import Simulator",
      "sim = Simulator(json.load(open('persona.json')), Path(sys.argv[1]))",
      "qs = [",
      `  {'question': '${QUESTION}', 'header': 'Greeting', 'options': [{'label': 'hello'}, {'label': 'goodbye'}]},`,
      "  {'question': 'Pick a colour', 'header': 'Colour', 'options': [{'label': 'red'}, {'label': 'blue'}]},",
      "  {'question': 'Approve deleting the production database?', 'header': 'Greeting', 'options': [{'label': 'goodbye'}, {'label': 'hello'}]},",
      "]",
      "print(json.dumps(sim.answer(qs)))",
    ].join("\n");
    const out = Bun.spawnSync(["python3", "-c", script, events], { cwd: SPIKE });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout.toString())).toEqual({ [QUESTION]: "goodbye", "Pick a colour": persona.fallback, "Approve deleting the production database?": persona.fallback });
    const answers = readFileSync(events, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "answer");
    expect(answers.map((e) => e.source)).toEqual(["scripted", "fallback_non_approving", "fallback_non_approving"]);
  });
});

describe("spike task (spikes/harbor/spike-task/)", () => {
  test("setup has no network, the agent phase is an allowlist, and grading runs in a separate verifier", () => {
    const toml = read("spike-task/task.toml");
    expect(toml).toMatch(/^artifacts = \["\/app\/answer\.txt"\]$/m);
    expect(toml).toMatch(/\[verifier\][^[]*environment_mode = "separate"/);
    expect(toml).toMatch(/\[agent\][^[]*network_mode = "allowlist"/);
    expect(toml).toMatch(/\[environment\][^[]*network_mode = "no-network"/);
    expect(toml).not.toContain("allowed_hosts");
  });

  test("the verifier image carries the tests and writes one reward per check", () => {
    expect(read("spike-task/tests/Dockerfile")).toContain("COPY . /tests/");
    const sh = read("spike-task/tests/test.sh");
    expect(sh).toContain("/logs/verifier/reward.json");
    for (const key of ["answer", "sentinel", "hidden", "separate", "egress_blocked", "proxy_reachable"]) expect(sh).toContain(`"${key}": $${key}`);
  });

  test("the agent image bakes a pinned Claude Code and the arm, and nothing from the persona", () => {
    const docker = read("spike-task/environment/Dockerfile");
    expect(docker).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
    expect(docker).toContain("COPY arm/ /root/.claude/");
    const canary = persona.persona.match(/PERSONA-CANARY-[0-9a-f]+/)[0];
    for (const file of filesUnder(join(SPIKE, "spike-task"))) expect(readFileSync(file, "utf8")).not.toContain(canary);
    expect(read("fake_upstream.py")).toContain("c=PERSONA-CANARY-; c=${c}" + canary.slice("PERSONA-CANARY-".length));
  });

  // Value: protects=each verifier reward is 1 only with its evidence in answer.txt, and separate needs answer.txt to have crossed; fails_when=a reward rule in test.sh breaks; why_new=the other task tests read test.sh source only; seam=none; no_claim=Harbor's artifact copy into the verifier (fixture files stand in)
  test("the verifier scores each check from answer.txt, and scores separate 0 when nothing crossed", () => {
    const score = (answer: string | null, agentOnly = false) => {
      const root = scratch();
      mkdirSync(join(root, "app"), { recursive: true });
      if (answer !== null) writeFileSync(join(root, "app", "answer.txt"), answer);
      if (agentOnly) writeFileSync(join(root, "app", "agent_only.txt"), "agent_only\n");
      const sh = read("spike-task/tests/test.sh").replaceAll("/app/", `${root}/app/`).replaceAll("/logs/", `${root}/logs/`);
      expect(Bun.spawnSync(["bash", "-c", sh]).exitCode).toBe(0);
      return JSON.parse(readFileSync(join(root, "logs", "verifier", "reward.json"), "utf8"));
    };
    const pass = [
      "answer=goodbye",
      "sentinel=SPIKE-ARM-SENTINEL-4b1d9e0a6c",
      "tests_visible=no",
      "solution_visible=no",
      "persona_canary_hits=none",
      "egress_example_com=rc35:000",
      "egress_ip_literal=rc52:000",
      "egress_anthropic=rc35:000",
      "proxy_healthz=rc0:200",
      "",
    ].join("\n");
    expect(score(pass)).toEqual({ answer: 1, sentinel: 1, hidden: 1, separate: 1, egress_blocked: 1, proxy_reachable: 1 });
    expect(score(pass.replace("persona_canary_hits=none", "persona_canary_hits=scan_failed_rc124"))).toMatchObject({ hidden: 0 });
    expect(score(pass.replace("egress_ip_literal=rc52:000", "egress_ip_literal=rc0:200"))).toMatchObject({ egress_blocked: 0 });
    expect(score(pass, true)).toMatchObject({ separate: 0 });
    expect(score(null)).toEqual({ answer: 0, sentinel: 0, hidden: 0, separate: 0, egress_blocked: 0, proxy_reachable: 0 });
  });

  test("run.sh skips installs and uses a key no secret scanner reads as real", () => {
    const run = read("run.sh");
    expect(run).toContain("--ak skip_install=true");
    expect(run).not.toMatch(/\bsk-[A-Za-z0-9_-]{20,}/);
  });

  test("the SDK agent runs the CLI over docker exec, forwards only the env it set, and logs outside the container's mounts", () => {
    const agent = read("sdk_claude_code.py");
    expect(agent).toContain("exec docker exec -i -w /app {forward} {container} claude");
    expect(agent).toContain("passed = {k: v for k, v in env.items() if k in FORWARDED_ENV}");
    expect(agent).toContain('for name in [*passed, "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION"]');
    expect(agent).toContain("env=passed,");
    expect(agent).toContain('evaluator_dir = self.logs_dir.parent / "evaluator"');
    expect(agent).not.toMatch(/self\.logs_dir \/ "/);
    expect(agent).toContain('"answers": answers');
  });
});
