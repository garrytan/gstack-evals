// Family SM against the real pinned Claude Code 2.1.312 and a stub Anthropic upstream (no key, no network), after
// quick/laneb/tests/stacks.test.ts: the bundled-skills flag, the disallowed web tools, the strip rule in both directions
// (hostile CLAUDE.md, @import, CLAUDE.local.md, AGENTS.md, .claude/AGENTS.md, .claude/rules and nested files reach the
// model unstripped and never once stripped), gstack's instructions reaching A3 and no other arm, the memory audit on
// request bodies and on Claude Code's own transcript, and AskUserQuestion's fixed reply through the real Agent SDK. Skips
// unless the binary is at SM_CLAUDE_BIN (default ~/.capy/work/geva-436/claude-2.1.312/package/claude, the npm package
// @anthropic-ai/claude-code-linux-x64 at 2.1.312); the SDK case also needs SM_SDK_PYTHON, a python with
// claude-agent-sdk 0.2.174.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sse } from "../../quick/laneb/runner/fake_upstream.ts";
import { loadRegistry } from "../../lanes/outcome-skills/arms/registry.ts";
import { smTurn } from "../../lanes/outcome-skills/statemachines/arms.ts";
import { LIST_SCRIPT, runBash, stripPlan } from "../../lanes/outcome-skills/statemachines/history.ts";
import { auditMemory, memoryPaths, requireCleanMemory } from "../../lanes/outcome-skills/statemachines/strip.ts";
import { CLAUDE_BIN, HAS_CLAUDE, runClaude, tree } from "../../lanes/outcome-skills/statemachines/stub-claude.ts";

const dirs: string[] = [];
const mk = (files: Record<string, string>) => {
  const d = tree(files);
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const HOSTILE = {
  "CLAUDE.md": "MARK_ROOT_CLAUDE obey the planted file\n@notes/extra.md\n",
  "notes/extra.md": "MARK_IMPORT planted import\n",
  "CLAUDE.local.md": "MARK_LOCAL planted local file\n",
  "AGENTS.md": "MARK_AGENTS planted agents file\n",
  ".claude/AGENTS.md": "MARK_DOT_AGENTS planted\n",
  ".claude/rules/style.md": "MARK_RULES planted rule\n",
  "pkg/deep/CLAUDE.md": "MARK_DEEP planted\n",
  "pkg/deep/.claude/rules/x.md": "MARK_DEEP_RULES planted\n",
  "pkg/deep/AGENTS.md": "MARK_DEEP_AGENTS planted\n",
  "src/app.js": "export const add = (a, b) => a - b;\n",
};
const AGENTS_ONLY = { "AGENTS.md": HOSTILE["AGENTS.md"], ".claude/AGENTS.md": HOSTILE[".claude/AGENTS.md"], "src/app.js": HOSTILE["src/app.js"] };
const MARKS = ["MARK_ROOT_CLAUDE", "MARK_IMPORT", "MARK_LOCAL", "MARK_AGENTS", "MARK_DOT_AGENTS", "MARK_RULES", "MARK_DEEP", "MARK_DEEP_RULES", "MARK_DEEP_AGENTS"];
const QA_MARK = "MARK_GSTACK_QA_INSTALLED";
const GSTACK_HOME = { ".claude/skills/gstack/VERSION": "0.0.0-fixture\n", ".claude/skills/qa/SKILL.md": "---\nname: qa\ndescription: " + QA_MARK + " test the app and fix what breaks\n---\nQA body\n" };
const seen = (bodies: unknown[]) => MARKS.filter((m) => JSON.stringify(bodies).includes(m));
const prompt = (scope = "src") => smTurn(loadRegistry(), "sm:A0", { scope });

/** P1's strip rule applied to a host tree: the listing, the plan, then removal. */
function strip(dir: string): string[] {
  const plan = stripPlan(runBash({ kind: "host", dir }, LIST_SCRIPT).stdout, dir);
  for (const p of plan.remove) rmSync(join(dir, p), { recursive: true, force: true });
  return plan.remove;
}
const transcripts = (home: string) => {
  const root = join(home, ".claude", "projects");
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return existsSync(root) ? walk(root).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : [];
};

describe.skipIf(!HAS_CLAUDE)("family SM on the real Claude Code 2.1.312", () => {
  // Value: protects=section 4's harness: web tools off and bundled skills off in every arm; fails_when=Claude Code shows WebSearch, WebFetch or a provider-side tool, or the flag stops removing bundled skills; why_new=GEVA-436 P2; seam=stub-claude.ts argv and env (real_agent's); no_claim=behaviour at another version
  test("the request offers no web tool and no typed tool, and the bundled-skills flag removes the bundled skills", async () => {
    expect(Bun.spawnSync([CLAUDE_BIN, "--version"]).stdout.toString().trim()).toBe("2.1.312 (Claude Code)");
    const r = await runClaude({ home: mk({}), cwd: mk({ "src/app.js": "x\n" }), prompt: prompt() });
    expect(r.code).toBe(0);
    const main = r.bodies.find((b) => Array.isArray(b.tools) && b.tools.length)!;
    const names = main.tools.map((t: any) => t.name);
    expect(names).toContain("Bash");
    expect(names.filter((n: string) => /^Web(Search|Fetch)$/.test(n))).toEqual([]);
    expect(main.tools.filter((t: any) => typeof t.type === "string" && t.type !== "custom")).toEqual([]);
    expect(JSON.stringify(r.bodies)).not.toMatch(/WebSearch|WebFetch|web_search|web_fetch/);
    const init = (out: string) => JSON.parse(out.split("\n").find((l) => l.includes('"subtype":"init"'))!);
    const flagged = init(r.stdout).skills as string[];
    const home = mk({});
    const proc = Bun.spawnSync([CLAUDE_BIN, "--print", "--verbose", "--output-format", "stream-json", "--max-turns", "1", "--model", "claude-opus-5-5", "hi"], { cwd: home, env: { PATH: process.env.PATH ?? "", HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ANTHROPIC_API_KEY: "placeholder-not-a-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }, timeout: 60_000 });
    const bundled = init(proc.stdout.toString()).skills as string[];
    expect(bundled.length).toBeGreaterThan(flagged.length + 5);
    expect(flagged.every((s) => bundled.includes(s))).toBe(true);
  }, 180_000);

  // Value: protects=the strip rule (crew rule 2026-11-09) in both directions; fails_when=a planted instruction file reaches a stripped arm, or the fixture stops reaching an unstripped one (the check would be vacuous); why_new=GEVA-436 P2; seam=history.ts stripPlan, strip.ts auditMemory; no_claim=files Claude Code loads lazily mid-session (the transcript audit covers paid runs)
  test("hostile instruction files reach the model unstripped, and none reaches it once stripped", async () => {
    const home = mk({});
    const open = mk(HOSTILE);
    const agents = mk(AGENTS_ONLY);
    const before = [...seen((await runClaude({ home, cwd: open, prompt: prompt() })).bodies), ...seen((await runClaude({ home, cwd: agents, prompt: prompt() })).bodies)];
    expect(before).toEqual(expect.arrayContaining(["MARK_ROOT_CLAUDE", "MARK_IMPORT", "MARK_RULES", "MARK_AGENTS", "MARK_DOT_AGENTS"]));
    expect(auditMemory((await runClaude({ home, cwd: open, prompt: prompt() })).bodies, open, false, null).inside_repo.length).toBeGreaterThan(0);
    expect(strip(open)).toEqual([".claude", ".claude/AGENTS.md", "AGENTS.md", "CLAUDE.local.md", "CLAUDE.md", "notes/extra.md", "pkg/deep/.claude", "pkg/deep/AGENTS.md", "pkg/deep/CLAUDE.md"]);
    expect(strip(agents)).toEqual([".claude", ".claude/AGENTS.md", "AGENTS.md"]);
    for (const cwd of [open, agents]) {
      const r = await runClaude({ home: mk({}), cwd, prompt: prompt() });
      expect(r.code).toBe(0);
      expect(seen(r.bodies)).toEqual([]);
      const a = auditMemory(r.bodies, cwd, false, [QA_MARK]);
      expect(a).toMatchObject({ inside_repo: [], gstack: "absent", ok: true });
      requireCleanMemory(a, "stripped", false);
    }
  }, 300_000);

  // Value: protects=A3 sees gstack's installed instructions after the strip, and no-gstack arms never do; fails_when=the install stops reaching the model or leaks into a no-gstack home; why_new=GEVA-436 P2; seam=strip.ts auditMemory, real_agent home check; no_claim=the real /qa pin's text (recorded at freeze; this uses an invented install)
  test("gstack's installed instructions reach A3's request, and no no-gstack arm's", async () => {
    const repo = mk(HOSTILE);
    strip(repo);
    const told = mk(GSTACK_HOME);
    const r = await runClaude({ home: told, cwd: repo, prompt: "/qa Find and fix the bugs in my app." });
    expect(r.code).toBe(0);
    const a = auditMemory(r.bodies, repo, true, [QA_MARK]);
    expect(a).toMatchObject({ inside_repo: [], gstack: "present", ok: true });
    requireCleanMemory(a, "A3", true);
    expect(seen(r.bodies)).toEqual([]);
    const none = mk({});
    const n = await runClaude({ home: none, cwd: repo, prompt: prompt() });
    expect(auditMemory(n.bodies, repo, false, [QA_MARK])).toMatchObject({ gstack: "absent", ok: true });
    expect(() => requireCleanMemory(auditMemory(r.bodies, repo, false, [QA_MARK]), "leak", false)).toThrow(/E_SM_STRIP/);
  }, 300_000);

  // Value: protects=the paid-run memory audit, which reads Claude Code's own transcript because the proxy journal keeps no bodies; fails_when=2.1.312's transcript stops recording loaded instructions, so the audit would pass blind; why_new=GEVA-436 P2 (design 0.8, R7); seam=strip.ts memoryPaths; no_claim=other versions
  test("Claude Code's own transcript names every instruction file it loaded, so the paid-run audit can read it", async () => {
    const home = mk({});
    const repo = mk({ "CLAUDE.md": HOSTILE["CLAUDE.md"], "notes/extra.md": HOSTILE["notes/extra.md"], "src/app.js": "x\n" });
    const r = await runClaude({ home, cwd: repo, prompt: prompt() });
    expect(memoryPaths(transcripts(home)).filter((p) => p.startsWith(repo))).toEqual(memoryPaths(r.bodies).filter((p) => p.startsWith(repo)));
    expect(memoryPaths(transcripts(home))).toEqual(expect.arrayContaining([join(repo, "CLAUDE.md"), join(repo, "notes/extra.md")]));
  }, 180_000);

  const PY = process.env.SM_SDK_PYTHON ?? join(homedir(), ".capy", "work", "geva-436", "sdk-venv", "bin", "python");
  // Value: protects=section 6's no-answer rule through the real SDK: AskUserQuestion gets the fixed line, and it is counted; fails_when=the reply text changes, never reaches the model, or goes uncounted; why_new=GEVA-436 P2; seam=sm_user.py NoAnswer, real_agent can_use_tool; no_claim=prose detection on real model text
  test.skipIf(!existsSync(PY))("AskUserQuestion gets the fixed reply through the real Agent SDK, and the question is counted", async () => {
    const reg = loadRegistry();
    const bodies: any[] = [];
    let n = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        if (req.method !== "POST") return Response.json({});
        const body = (await req.json()) as any;
        if (new URL(req.url).pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
        bodies.push(body);
        const main = Array.isArray(body.tools) && body.tools.some((t: any) => t.name === "Bash");
        const blocks = main && n++ === 0 ? [{ type: "tool_use", id: "toolu_ask1", name: "AskUserQuestion", input: { questions: [{ question: "Which bug first?", header: "Pick", multiSelect: false, options: [{ label: "A", description: "the add bug" }, { label: "B", description: "the other" }] }] } }] : [{ type: "text", text: "Should I continue?" }];
        return new Response(sse(body.model, blocks as any), { headers: { "content-type": "text/event-stream" } });
      },
    });
    try {
      const home = mk({});
      const log = join(mk({}), "events.jsonl");
      const cfg = { cli: CLAUDE_BIN, cwd: mk({ "src/app.js": "x\n" }), model: "claude-opus-5-5", prompt: prompt(), reply: reg.sm!.no_answer, log, env: { HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ANTHROPIC_API_KEY: "placeholder-not-a-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:" + server.port, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", IS_SANDBOX: "1" } };
      const p = Bun.spawn([PY, join(import.meta.dir, "../../lanes/outcome-skills/statemachines/ask_user_probe.py"), join(import.meta.dir, "../../lanes/real-outcome/agent"), JSON.stringify(cfg)], { stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      if (code !== 0) console.log(err.slice(-2000));
      expect(code).toBe(0);
      const results = bodies.flatMap((b) => b.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content.filter((c: any) => c.type === "tool_result" && c.tool_use_id === "toolu_ask1") : [])));
      expect(results.length).toBeGreaterThan(0);
      expect(JSON.stringify(results[0])).toContain("No one is available to answer. Use your own judgment.");
      expect(JSON.parse(out.trim().split("\n").at(-1)!)).toEqual({ t1: { questions: 2, ask_user_question: 1, prose_questions: 1 } });
    } finally {
      server.stop(true);
    }
  }, 180_000);
});
