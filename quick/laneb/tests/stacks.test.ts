// Keyless tests of the stacks round's Lane B arms (arms/stacks.ts) and the told skill map (runner/skill-map.stacks.json).
// The map tests always run. The arm tests run on the built tars, from stacks.ts's out-dir: set LANEB_STACK_ARMS to it
// (default ~/.capy/work/laneb-arms). They skip unless pstack.tar, pstack-placebo.tar and claude-code/claude are there.
// Each session runs the Claude Code binary the trial runtime pins with the stream-json flags the Agent SDK passes, the
// Lane B agent's setting sources and its environment, against a fake upstream that records every request. No key, no
// network. It spawns the binary itself because quick/lanea-quick's tests mock the Agent SDK module for the whole run.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { walk, treeDigest } from "../arms/tree.ts";
import { CLAUDE_CODE_VERSION, PLUGIN_SKILLS, PSTACK, SETTINGS, settingsFor } from "../arms/stacks.ts";
import { countTokens, frontmatterFields, proceduralMarkers, splitSkill, stripHooks, topicTerms } from "../arms/placebo/placebo.ts";
import { sse } from "../runner/fake_upstream.ts";

const here = import.meta.dir;
const laneb = join(here, "..");
const REPO = join(laneb, "..", "..");
const MAP = JSON.parse(readFileSync(join(laneb, "runner", "skill-map.stacks.json"), "utf8")) as Record<string, Record<string, string>>;
const OUT = process.env.LANEB_STACK_ARMS ?? join(homedir(), ".capy", "work", "laneb-arms");
const CLAUDE = join(OUT, "claude-code", "claude");
const BUILT = ["pstack.tar", "pstack-placebo.tar"].every((f) => existsSync(join(OUT, f))) && existsSync(CLAUDE);
const TAG = "laneb-quick-3-runner";
const HAS_TAG = spawnSync("git", ["-C", REPO, "cat-file", "-e", TAG + "^{commit}"]).status === 0;
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const roots: string[] = [];
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "laneb-stacks-" + name + "-"));
  roots.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** quick look 3's prompt: the invocation line, then the arm-neutral wrapper with the instruction filled in (agent/prompt_builder.py at the runner tag). */
const toldPrompt = (skill: string, instruction: string) => "/" + skill + " " + readFileSync(join(laneb, "runner", "prompt-wrapper.md"), "utf8").replace("{instruction}", instruction);

describe("told skill map for the quick look 3 runner", () => {
  // Value: protects=each TB2 arm's invocation line (gstack and its placebo /investigate, pstack and its placebo /pstack:poteto-mode) on every task; fails_when=an arm or task is missing, an arm points at another stack's command, or pstack's told command in src/arms/stacks.ts moves without the map; why_new=GST-382 (stacks step 3, the skill map); seam=runner/skill-map.stacks.json, STACKS told.tb2; no_claim=that the runner reads the map per arm, which the stacks runner commit adds
  test("every arm tells its own command on the same tasks", () => {
    expect(Object.keys(MAP).sort()).toEqual(["gstack", "placebo", "pstack", "pstack-placebo"]);
    const tasks = Object.keys(MAP.gstack!).sort();
    expect(tasks.length).toBe(40);
    for (const arm of Object.keys(MAP)) expect(Object.keys(MAP[arm]!).sort()).toEqual(tasks);
    const final = JSON.parse(readFileSync(join(laneb, "tasks", "final.json"), "utf8")).tasks as string[];
    for (const t of final) expect(tasks).toContain(t);
    const told: Record<string, string> = { gstack: "/investigate", placebo: "/investigate", pstack: PSTACK.told.tb2!, "pstack-placebo": PSTACK.told.tb2! };
    for (const [arm, map] of Object.entries(MAP)) for (const skill of Object.values(map)) expect(toldPrompt(skill, "x").startsWith(told[arm] + " ")).toBe(true);
  });

  test.skipIf(!HAS_TAG)("its tasks are quick look 3's, and gstack keeps quick look 3's skills", () => {
    const show = (path: string) => JSON.parse(spawnSync("git", ["-C", REPO, "show", TAG + ":" + path], { encoding: "utf8" }).stdout);
    expect(Object.keys(MAP.gstack!).sort()).toEqual([...(show("quick/laneb/tasks/final.json").tasks as string[])].sort());
    const ql3 = show("quick/laneb/runner/skill-map.json") as Record<string, { skill: string }>;
    for (const arm of ["gstack", "placebo"]) expect(MAP[arm]).toEqual(Object.fromEntries(Object.entries(ql3).map(([t, v]) => [t, v.skill])));
  });
});

interface Arm {
  name: string;
  home: string;
  manifest: Record<string, any>;
}

/** Each built tar, checked against its manifest and extracted into a fresh HOME, as the agent extracts it into /root. */
function extract(name: string): Arm {
  const manifest = JSON.parse(readFileSync(join(laneb, "arms", "manifests", name + ".json"), "utf8"));
  const home = temp(name);
  const r = spawnSync("tar", ["-x", "-C", home, "-f", join(OUT, name + ".tar")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return { name, home, manifest };
}

/** The first body line of a SKILL.md long enough to identify it. */
const marker = (file: string): string => splitSkill(readFileSync(file, "utf8")).body.split("\n").map((l) => l.trim()).find((l) => l.length > 40 && !l.startsWith("#"))!;
const inJson = (value: unknown, text: string) => JSON.stringify(value ?? "").includes(JSON.stringify(text).slice(1, -1));

/** One Claude Code session in home, as the Lane B agent starts it, against a fake upstream; returns every Messages request body. */
async function session(home: string, prompt: string): Promise<Record<string, any>[]> {
  const bodies: Record<string, any>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return Response.json({});
      const body = (await req.json()) as Record<string, any>;
      if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      bodies.push(body);
      return new Response(sse(body.model, [{ type: "text", text: "DONE" }]), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const model = "claude-haiku-5-5";
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C.UTF-8",
    ANTHROPIC_API_KEY: "placeholder-not-a-key",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:" + server.port,
    ANTHROPIC_MODEL: model,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    HOME: home,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    IS_SANDBOX: "1",
  };
  try {
    const argv = [CLAUDE, "--print", "--verbose", "--output-format", "stream-json", "--input-format", "stream-json", "--model", model, "--permission-mode", "default", "--setting-sources", "user,project", "--max-turns", "4", "--disallowedTools", "WebSearch,WebFetch"];
    const proc = Bun.spawn(argv, { cwd: temp("work"), env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\n");
    proc.stdin.end();
    const timer = setTimeout(() => proc.kill(), 90_000);
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (code !== 0) throw new Error("claude exited " + code + ": " + (stderr || stdout).slice(-500));
  } finally {
    server.stop(true);
  }
  return bodies;
}

describe.skipIf(!BUILT)("pstack and pstack-placebo arms as built", () => {
  const arms = BUILT ? Object.fromEntries(["pstack", "pstack-placebo"].map((n) => [n, extract(n)])) : {};
  const pstack = () => arms.pstack!;
  const placebo = () => arms["pstack-placebo"]!;
  const skillMd = (a: Arm, folder: string) => join(a.home, PLUGIN_SKILLS, folder, "SKILL.md");

  // Value: protects=the bytes a TB2 trial extracts: each tar, its gzip and its extracted tree match the committed manifest, and pstack's tree is the plan's pin; fails_when=a tar is rebuilt or edited without its manifest, or the pin moves; why_new=GST-382 (sha256 and tree digest per arm); seam=arms/manifests/<arm>.json, arms/tree.ts; no_claim=that a rebuild gives the same bytes
  test("the tars match their manifests, and pstack is the plan's pin", () => {
    for (const a of [pstack(), placebo()]) {
      expect(sha256(readFileSync(join(OUT, a.name + ".tar")))).toBe(a.manifest.tar.sha256);
      expect(sha256(readFileSync(join(OUT, a.name + ".tar.gz")))).toBe(a.manifest.tar_gz_sha256);
      expect(treeDigest(walk(a.home))).toBe(a.manifest.tree.digest);
      expect(a.manifest).toMatchObject({ claude_code: CLAUDE_CODE_VERSION, stack_repo: PSTACK.repo, stack_sha: PSTACK.pin.sha, stack_path: PSTACK.path, stack_git_tree: PSTACK.pin.git_tree, told: PSTACK.told.tb2 });
      expect(readFileSync(join(a.home, SETTINGS), "utf8")).toBe(settingsFor([".local/share/" + PSTACK.name]));
    }
    expect(spawnSync(CLAUDE, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe(CLAUDE_CODE_VERSION + " (Claude Code)");
  });

  // Value: protects=the told line resolving in each pstack arm under the Lane B agent's settings: the arm's own settings file loads the plugin, and the first model request carries the expanded command and that arm's poteto-mode body, never pstack's body in the placebo; fails_when=Claude Code stops reading CLAUDE_CODE_PLUGIN_DIRS from user settings, the plugin does not load, the command does not expand, or the placebo leaks pstack's body; why_new=GST-382 (the told line resolves in each arm; the skill body is in the first request against the fake upstream); seam=.claude/settings.json in each tar, runner/skill-map.stacks.json, Claude Code 2.1.312 with the Agent SDK's stream-json flags; no_claim=the Python SDK's control protocol and the docker exec wrapper the real agent uses, and gstack's arm, which quick look 3 checked
  test("the told line resolves in each arm, with that arm's skill body in the first model request", async () => {
    const task = Object.keys(MAP.pstack!)[0]!;
    const real = marker(skillMd(pstack(), "poteto-mode"));
    for (const a of [pstack(), placebo()]) {
      const bodies = await session(extract(a.name).home, toldPrompt(MAP[a.name]![task]!, "Print hello."));
      const first = bodies.find((b) => (b.tools ?? []).some((t: { name: string }) => t.name === "Bash"));
      expect(inJson(first?.messages, "<command-name>" + PSTACK.told.tb2 + "</command-name>")).toBe(true);
      expect(inJson(first?.messages, marker(skillMd(a, "poteto-mode")))).toBe(true);
      if (a === placebo()) expect(bodies.some((b) => inJson(b, real))).toBe(false);
    }
  }, 180_000);

  // Value: protects=the claim that the arm's settings file is what loads pstack: without it the same tree and prompt never expand the command; fails_when=the plugin loads from somewhere else, so the settings file is not the mechanism the manifest records; why_new=GST-382 (negative control for the told-line test); seam=.claude/settings.json; no_claim=none
  test("without the arm's settings file, the told line does not resolve", async () => {
    const home = extract("pstack").home;
    rmSync(join(home, SETTINGS));
    const bodies = await session(home, toldPrompt(MAP.pstack![Object.keys(MAP.pstack!)[0]!]!, "Print hello."));
    expect(bodies.some((b) => inJson(b, marker(skillMd(pstack(), "poteto-mode"))))).toBe(false);
    expect(bodies.some((b) => inJson(b.messages, "<command-name>" + PSTACK.told.tb2 + "</command-name>"))).toBe(false);
  }, 120_000);

  // Value: protects=poteto-mode's scripts in a TB2 container with no registry: the bootstrap finds its dependencies from the build and returns without installing, and watch-pr runs; fails_when=the build skipped pstack's bootstrap, the install key no longer matches, or a dependency is missing from the tar; why_new=GST-382 (poteto-mode's bootstrap runs offline); seam=pstack.tar, pstack's bootstrap.ts; no_claim=the task images' own bun, which can shadow the runtime's at the end of PATH
  test("poteto-mode's bootstrap and scripts run offline", () => {
    const scripts = join(pstack().home, ".local/share/pstack/skills/poteto-mode/scripts");
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: pstack().home, LANG: "C.UTF-8", BUN_CONFIG_REGISTRY: "http://127.0.0.1:9", NPM_CONFIG_REGISTRY: "http://127.0.0.1:9" };
    const before = treeDigest(walk(join(scripts, "node_modules")));
    const boot = spawnSync("bun", ["-e", 'import("./bootstrap.ts").then((m) => m.ensureDependenciesInstalled())'], { cwd: scripts, env, encoding: "utf8", timeout: 60_000 });
    expect(boot.status).toBe(0);
    expect(boot.stdout + boot.stderr).toBe("");
    expect(treeDigest(walk(join(scripts, "node_modules")))).toBe(before);
    const watch = spawnSync("bun", [join(scripts, "watch-pr", "watch-pr"), "--help"], { cwd: temp("wd"), env, encoding: "utf8", timeout: 60_000 });
    expect(watch.status).toBe(0);
  });

  // Value: protects=the placebo as a placebo: only the plugin manifest, one SKILL.md per pstack skill and the settings file; front matter kept; bodies whose prose, less the topic terms the generator takes from each skill's own name and description, has no procedural marks; no line of any pstack file; each body's o200k token count within one token or 5% of pstack's; the committed token report matches; fails_when=a playbook, script, reference or agent survives, the generator copies pstack text, or a body drifts out of the length match; why_new=GST-382 (no pstack procedure text, token ratio in tolerance); seam=pstack-placebo.tar, arms/manifests/pstack-placebo-tokens.tsv; no_claim=Anthropic's own token counts, which arms/placebo/verify-tokens.ts checks with a key
  test("the placebo carries no pstack procedure text and keeps each body's token count", () => {
    const folders = readdirSync(join(pstack().home, PLUGIN_SKILLS)).filter((f) => statSync(join(pstack().home, PLUGIN_SKILLS, f)).isDirectory()).sort();
    const files = walk(placebo().home).filter((e) => e.type !== "dir").map((e) => e.path).sort();
    expect(files).toEqual([SETTINGS, ".local/share/pstack/.claude-plugin/plugin.json", ...folders.map((f) => PLUGIN_SKILLS + "/" + f + "/SKILL.md")].sort());
    const pstackLines = new Set(walk(join(pstack().home, ".local/share/pstack")).filter((e) => e.type === "file" && /\.(md|ts|mjs|sh|json)$/.test(e.path) && !e.path.includes("node_modules/")).flatMap((e) => readFileSync(join(pstack().home, ".local/share/pstack", e.path), "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length >= 30)));
    const report = new Map(readFileSync(join(laneb, "arms", "manifests", "pstack-placebo-tokens.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t")).map((c) => [c[0]!, c]));
    expect([...report.keys()].sort()).toEqual(folders);
    for (const f of folders) {
      const real = splitSkill(readFileSync(skillMd(pstack(), f), "utf8"));
      const fake = splitSkill(readFileSync(skillMd(placebo(), f), "utf8"));
      expect(fake.frontmatter).toBe(stripHooks(real.frontmatter));
      const { name, description } = frontmatterFields(fake.frontmatter);
      const prose = topicTerms(name, description).sort((a, b) => b.length - a.length).reduce((text, term) => text.split(term).join(" "), fake.body);
      expect(proceduralMarkers(prose)).toEqual([]);
      expect(fake.body.split("\n").map((l) => l.trim()).filter((l) => pstackLines.has(l))).toEqual([]);
      const [orig, made] = [countTokens(real.body), countTokens(fake.body)];
      expect(Math.abs(made - orig) <= Math.max(1, 0.05 * orig)).toBe(true);
      expect(report.get(f)!.slice(1, 3)).toEqual([String(orig), String(made)]);
    }
  });
});
