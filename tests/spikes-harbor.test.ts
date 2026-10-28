import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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
      "]",
      "print(json.dumps(sim.answer(qs)))",
    ].join("\n");
    const out = Bun.spawnSync(["python3", "-c", script, events], { cwd: SPIKE });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout.toString())).toEqual({ [QUESTION]: "goodbye", "Pick a colour": persona.fallback });
    const answers = readFileSync(events, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "answer");
    expect(answers.map((e) => e.source)).toEqual(["scripted", "fallback_non_approving"]);
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
  });

  test("run.sh skips installs and uses a key no secret scanner reads as real", () => {
    const run = read("run.sh");
    expect(run).toContain("--ak skip_install=true");
    expect(run).not.toMatch(/\bsk-[A-Za-z0-9_-]{20,}/);
  });

  test("the SDK agent runs the CLI over docker exec with an explicit env list", () => {
    const agent = read("sdk_claude_code.py");
    expect(agent).toContain("exec docker exec -i -w /app {forward} {container} claude");
    expect(agent).toContain("env={k: v for k, v in env.items() if k in FORWARDED_ENV}");
    expect(agent).toContain('"answers": answers');
  });
});
