// The keyless canary per stack (plan 2026-10-30-geva-59-stacks-round-1-plan, section 3), on the trees the plan pins.
// Each stack is installed by the rig's own path from <state>/sources/ (the rig never fetches: clone cursor/plugins and
// t3dotgg/tstack there to run it) and driven in real Claude Code sessions by the Claude Code adapter against the fake
// upstream, with a scripted model and no key. It checks what a paid canary would have: each told command resolves and
// its skill body is in the first model request, the stack's nested agents start, tstack's Sol subagent reaches
// gpt-6.1-sol through the Codex CLI on the session's own proxy slot, and poteto-mode's scripts find their dependencies
// with no registry. GSTACK_EVALS_CANARY_DOCKER=1 runs the same sessions from the trial image: the builder container
// installs each stack, the arm and cell images are built and their layers retained, each session runs in its image, and
// <state>/canary/arms.json records the arms. Without the sources, the CLIs or the variable, the tiers skip.
import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, posix } from "node:path";
import { claudeCodeDriver } from "../../src/adapters/claude-code/driver.ts";
import { cellSettings, PSTACK_RULE, type Cell, type CellSettings } from "../../src/arms/cells.ts";
import { copyLayers, dockerInstaller, installArms, localInstaller, stackSources, type ArmInstall, type InstallRunner } from "../../src/arms/install.ts";
import { STACKS } from "../../src/arms/stacks.ts";
import { armImages } from "../../src/skill-eval/cli/run-host.ts";
import type { ContractTask } from "../../src/skill-eval/contract/tasks.ts";
import { trialEnv } from "../../src/trial/env.ts";
import { buildTrialImage, checkImagePin, stateRoot } from "../../src/trial/image.ts";
import { dockerSandbox, type AgentSession } from "../../src/trial/sandbox.ts";
import { CLAUDE_CLI, CODEX_CLI, HAS_CLAUDE_CLI, HAS_CODEX_CLI, harness, KEYS, type Script, type Upstream } from "../adapters/harness.ts";

const MODEL = "claude-opus-5-5";
const VOICE = "gpt-6.1-sol";
const OPUS: Cell = { model: MODEL, voice: VOICE };
const CHEAP: Cell = { model: "claude-haiku-5-5", voice: null };
const state = stateRoot();
const sources = stackSources({ root: null, home: homedir(), state });
const READY = HAS_CLAUDE_CLI && HAS_CODEX_CLI && STACKS.every((k) => sources.some((s) => spawnSync("git", ["-C", s, "cat-file", "-e", k.pin.sha + "^{commit}"]).status === 0));
const DOCKER = READY && process.env.GSTACK_EVALS_CANARY_DOCKER === "1";

const roots: string[] = [];
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gse-canary-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** Each listed stack at its pin, installed for Claude Code with its told skill as the target. */
function installAll(runner: InstallRunner): Record<string, ArmInstall> {
  const skills: Record<string, string> = { pstack: "interrogate", tstack: "sol-loop" };
  return Object.fromEntries(STACKS.map((k) => [k.name, installArms({ host: "claude", arms: [{ name: k.name, kind: "stack", stack: { repo: k.repo, sha: k.pin.sha, ...(k.path ? { path: k.path } : {}) }, install: { ...k.install } }], skill: skills[k.name]!, base: null, sources, runner, state })[0]!]));
}

/** A line of a skill or agent body long enough to name it, and found in none of the other files. */
const marker = (file: string, ...others: string[]): string => {
  const rest = others.map((f) => readFileSync(f, "utf8"));
  return readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").split("\n").map((l) => l.trim()).find((l) => l.length > 40 && !l.startsWith("#") && !l.startsWith("`") && !rest.some((t) => t.includes(l)))!;
};
const holds = (value: unknown, text: string) => JSON.stringify(value ?? "").includes(JSON.stringify(text).slice(1, -1));
const isMain = (u: Upstream) => new URL(u.url).pathname.endsWith("/v1/messages") && (u.body.tools ?? []).some((t: { name: string }) => t.name === "Bash");
const agentTool = (body: Record<string, any>) => ((body.tools ?? []).some((t: { name: string }) => t.name === "Agent") ? "Agent" : "Task");

function localSession(work: string, env: Record<string, string>): AgentSession {
  return {
    exec: (command, timeoutMs) => {
      const r = spawnSync("sh", ["-c", command], { cwd: work, env, timeout: timeoutMs, encoding: "utf8" });
      return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    spawn: (argv, extra = {}) => spawn(argv[0] === "claude" ? CLAUDE_CLI : argv[0]!, argv.slice(1), { cwd: work, env: { ...env, ...extra }, stdio: ["pipe", "pipe", "pipe"] }),
    stop() {},
  };
}

interface Tier {
  /** The agent's HOME for an arm in a cell, and the session factory. */
  session(arm: ArmInstall, cell: CellSettings, work: string, env: (home: string, path: string) => Record<string, string>): { home: string; open: () => AgentSession };
  homeOf(arm: ArmInstall, cell: CellSettings): string;
}

async function run(tier: Tier, arm: ArmInstall, cell: CellSettings, prompt: string, script: Script): Promise<{ upstream: Upstream[]; termination: string }> {
  const h = harness(script, { responses: () => [{ type: "message", text: "VERDICT: APPROVE" }] });
  try {
    const b = h.proxy.bind({ cell: { run_id: "canary", arm: arm.name, task: "canary", model: MODEL, trial: 0, attempt: 1 }, models: ["anthropic:" + MODEL, "openai:" + VOICE], allowance_micros: 50_000_000 });
    const home = tier.homeOf(arm, cell);
    const driver = claudeCodeDriver({ model: MODEL, provider: "anthropic", proxy: { baseUrl: h.baseUrl, slot: b.slot, token: b.token }, skill: null, out: temp("out"), plugins: arm.plugins.map((p) => posix.join(home, p)), ...(cell.codex ? { codex: { provider: "openai" as const, model: cell.codex.model } } : {}) });
    const s = tier.session(arm, cell, temp("work"), (homeDir, path) => trialEnv("agent", { PATH: path, HOME: homeDir, LANG: "C.UTF-8", TERM: "dumb", ...driver.env }, [], {}));
    const session = s.open();
    try {
      const outcome = await driver.run(session, { id: "canary", prompt } as ContractTask, 300_000);
      return { upstream: [...h.upstream], termination: outcome.termination.kind };
    } finally {
      session.stop();
    }
  } finally {
    h.close();
  }
}

const BOOT = 'BUN_CONFIG_REGISTRY=http://127.0.0.1:9 bun "$HOME/.local/share/pstack/skills/poteto-mode/scripts/watch-pr/watch-pr" --help >/dev/null 2>&1; echo "exit=$?"';
const SOL = 'S=$(mktemp -d); printf "Review only. CANARY brief.\\n" > "$S/brief.md"; git clone --quiet . "$S/repo" 2>/dev/null || git init -q "$S/repo"; nohup sh -c \'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --ephemeral --cd "$1/repo" --output-last-message "$1/reply.md" - < "$1/brief.md" > "$1/codex.log" 2>&1; echo "$?" > "$1/exit"\' sh "$S" > /dev/null 2>&1 & until [ -s "$S/exit" ]; do sleep 1; done; echo "exit=$(cat "$S/exit")"; cat "$S/reply.md"; tail -3 "$S/codex.log"';

async function pstackCanary(tier: Tier, arm: ArmInstall, cell: CellSettings): Promise<void> {
  const root = join(arm.layers[0]!.src, arm.plugins[0]!);
  const agent = marker(join(root, "agents", "poteto-agent.md"));
  let boot = "";
  const script: Script = ({ results, body }) => {
    if (holds(body.system, agent)) return [{ type: "text", text: "SUBAGENT-OK" }];
    if (!results.has("toolu_boot")) return [{ type: "tool_use", id: "toolu_boot", name: "Bash", input: { command: BOOT, description: "Run poteto-mode's scripts" } }];
    boot = results.get("toolu_boot")!.text;
    if (!results.has("toolu_agent")) return [{ type: "tool_use", id: "toolu_agent", name: agentTool(body), input: { subagent_type: "pstack:poteto-agent", description: "Canary subagent", prompt: "Reply with the word OK." } }];
    return [{ type: "text", text: "CANARY-DONE" }];
  };
  const r = await run(tier, arm, cell, "/pstack:interrogate review the change on this branch", script);
  expect(r.termination).toBe("completed");
  const first = r.upstream.find((u) => isMain(u) && !holds(u.body.system, agent));
  const told = (name: string, other: string) => marker(join(root, "skills", name, "SKILL.md"), join(root, "skills", other, "SKILL.md"));
  expect(holds(first?.body.messages, told("interrogate", "poteto-mode"))).toBe(true);
  expect(r.upstream.some((u) => holds(u.body.system, agent))).toBe(true);
  expect(boot).toContain("exit=0");
  const mode = await run(tier, arm, cell, "/pstack:poteto-mode say hello", () => [{ type: "text", text: "HELLO" }]);
  expect(mode.termination).toBe("completed");
  expect(holds(mode.upstream.find(isMain)?.body.messages, told("poteto-mode", "interrogate"))).toBe(true);
  expect(readFileSync(join(cell.layer!.src, PSTACK_RULE), "utf8")).toMatch(/^interrogate reviewers: opus xhigh, inherit-parent$/m);
}

async function tstackCanary(tier: Tier, arm: ArmInstall, cell: CellSettings): Promise<void> {
  const sol = marker(join(arm.layers[1]!.src, ".claude", "agents", "sol.md"));
  let reply = "";
  const script: Script = ({ results, body }) => {
    if (holds(body.system, sol)) {
      if (!results.has("toolu_codex")) return [{ type: "tool_use", id: "toolu_codex", name: "Bash", input: { command: SOL, description: "Ask Sol" } }];
      reply = results.get("toolu_codex")!.text;
      return [{ type: "text", text: reply }];
    }
    if (!results.has("toolu_sol")) return [{ type: "tool_use", id: "toolu_sol", name: agentTool(body), input: { subagent_type: "sol", description: "Sol review", prompt: "Review only. CANARY brief." } }];
    return [{ type: "text", text: "CANARY-DONE" }];
  };
  const r = await run(tier, arm, cell, "/sol-loop review the change on this branch, run one review round and stop before any fix", script);
  expect(r.termination).toBe("completed");
  const first = r.upstream.find((u) => isMain(u) && !holds(u.body.system, sol));
  expect(holds(first?.body.messages, marker(join(arm.layers[0]!.src, ".claude", "skills", "sol-loop", "SKILL.md")))).toBe(true);
  const responses = r.upstream.filter((u) => new URL(u.url).pathname.endsWith("/v1/responses"));
  expect(responses.map((u) => u.body.model)).toContain(VOICE);
  expect(responses.every((u) => u.headers.get("authorization") === "Bearer " + KEYS.OPENAI_API_KEY)).toBe(true);
  expect(reply).toContain("exit=0");
  expect(reply).toContain("VERDICT: APPROVE");
}

describe.skipIf(!READY)("stack canary on this machine (real Claude Code and Codex, fake upstream)", () => {
  // Value: protects=pstack and tstack at their pins run through the rig's install and the Claude Code adapter: told commands resolve with the skill body in the first request, nested agents start, the Sol subagent reaches gpt-6.1-sol through Codex on the slot with no provider key in the session, poteto-mode's scripts need no registry, and the cell's pstack rule maps the pinned shape; fails_when=a plugin skill or agent does not load, the Codex config or bearer is wrong, the bootstrap reinstalls at run time, or the rule shape moved; why_new=GST-370 step 1 (the keyless canary per stack, replacing a paid canary); seam=installArms, cellSettings, claudeCodeDriver plugins and codex options; no_claim=container isolation and the trial image, which the Docker tier below covers
  test("pstack and tstack", async () => {
    const installs = installAll(localInstaller(temp("runner")));
    const homes = new Map<string, string>();
    const tier: Tier = {
      homeOf: (arm, cell) => homes.get(arm.name + cell.cell.model) ?? (homes.set(arm.name + cell.cell.model, temp("home")), homes.get(arm.name + cell.cell.model)!),
      session(arm, cell, work, env) {
        const home = tier.homeOf(arm, cell);
        const bin = temp("bin");
        symlinkSync(CODEX_CLI, join(bin, "codex"));
        copyLayers([...arm.layers, ...(cell.layer ? [cell.layer] : [])], home);
        return { home, open: () => localSession(work, env(home, bin + ":" + process.env.PATH)) };
      },
    };
    await pstackCanary(tier, installs.pstack!, cellSettings(installs.pstack!, OPUS, join(temp("cell"), "c")));
    await tstackCanary(tier, installs.tstack!, cellSettings(installs.tstack!, OPUS, join(temp("cell"), "c")));
  }, 900_000);
});

describe.skipIf(!DOCKER)("stack canary from the trial image", () => {
  // Value: protects=the same canary from the final trial image: each stack installs in the builder container, its arm and cell images build, each session runs in its image on the host network to the fake upstream, and arms.json records repo, sha, subtree path, git tree, tree sha256 and image digest per arm and cell; fails_when=the builder cannot run an installer, the image misses the plugin, rule or Sol file, Codex or bun is missing in the image, or arms.json lacks a field; why_new=GST-370 step 1 (the canary runs from the final trial image; arms.json per arm); seam=dockerInstaller, armImages cells, dockerSandbox; no_claim=the proxy container and egress lock, which tests/adapters/run-host.test.ts covers
  test("pstack and tstack", async () => {
    expect(buildTrialImage({ state }).ok).toBe(true);
    const pin = checkImagePin({ state });
    if (!pin.ok) throw new Error(pin.message);
    const home = "/home/agent";
    const installs = installAll(dockerInstaller({ image: pin.pin.tag, digest: pin.pin.digest, docker: "docker", home }));
    const cells: Record<string, CellSettings[]> = {
      pstack: [cellSettings(installs.pstack!, OPUS, join(temp("cell"), "c")), cellSettings(installs.pstack!, CHEAP, join(temp("cell"), "c"))],
      tstack: [cellSettings(installs.tstack!, OPUS, join(temp("cell"), "c"))],
    };
    const out = join(state, "canary");
    mkdirSync(out, { recursive: true });
    const tasks = temp("tasks");
    const retain = temp("retain");
    const images = armImages({ trialImage: pin.pin.tag, home, installs: Object.values(installs), marks: { pstack: "gstack-evals-sentinel: canary-pstack", tstack: "gstack-evals-sentinel: canary-tstack" }, tasksDir: tasks, state, docker: "docker", out, retain, cells });
    const tier: Tier = {
      homeOf: () => home,
      session: (arm, cell, work, env) => ({ home, open: () => dockerSandbox({ trialImage: pin.pin.tag, armImage: images.get(arm.name + "@" + cell.cell.model)! }).agent("canary", { work, env: env(home, "/usr/local/bin:/usr/bin:/bin"), network: "host" }) }),
    };
    await pstackCanary(tier, installs.pstack!, cells.pstack![0]!);
    await tstackCanary(tier, installs.tstack!, cells.tstack![0]!);
    const record = JSON.parse(readFileSync(join(out, "arms.json"), "utf8")) as { arms: { name: string; provenance: { stack: Record<string, string> }; tree_sha256: string; image: { digest: string }; cells: { model: string; tree_sha256: string; layer: { dest: string; retained: { ref: string; file: string } } | null; image: { digest: string } }[] }[] };
    for (const k of STACKS) {
      const arm = record.arms.find((a) => a.name === k.name)!;
      expect(arm.provenance.stack).toMatchObject({ repo: k.repo, sha: k.pin.sha, git_tree: k.pin.git_tree, ...(k.path ? { path: k.path } : {}) });
      expect(arm.provenance.stack.tree_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(arm.image.digest).toMatch(/^sha256:/);
      expect(arm.cells.every((c) => c.image.digest.startsWith("sha256:") && /^[0-9a-f]{64}$/.test(c.tree_sha256))).toBe(true);
      expect(arm.cells.every((c) => (k.plugin ? c.layer?.dest === "" && /^[0-9a-f]{64}$/.test(c.layer.retained.ref) && existsSync(join(retain, c.layer.retained.file)) : c.layer === null))).toBe(true);
    }
  }, 3_600_000);
});
