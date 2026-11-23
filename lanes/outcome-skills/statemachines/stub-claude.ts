// A keyless harness for Claude Code against a stub Anthropic upstream, after quick/laneb/tests/stacks.test.ts: the pinned
// binary runs with the stream-json flags the Agent SDK passes, real_agent's setting sources, disallowed tools and frozen
// environment, and the stub records every Messages request body. A reply script answers each request in turn; when it runs
// out the stub says DONE. No key, no network. Used by tests/outcome-skills/sm-claude.test.ts and the P5 dry run.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sse } from "../../../quick/laneb/runner/fake_upstream.ts";

export const CLAUDE_BIN = process.env.SM_CLAUDE_BIN ?? join(homedir(), ".capy", "work", "geva-436", "claude-2.1.312", "package", "claude");
export const HAS_CLAUDE = existsSync(CLAUDE_BIN);

export type Reply = Array<Record<string, unknown>>;
export interface StubRun { bodies: Record<string, any>[]; stdout: string; code: number }

/** Writes files (relative path to text) under a fresh directory and returns it. */
export function tree(files: Record<string, string>, prefix = "sm-tree-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}

export async function runClaude(o: { home: string; cwd: string; prompt: string; replies?: Reply[]; model?: string; maxTurns?: number }): Promise<StubRun> {
  const bodies: Record<string, any>[] = [];
  const replies = [...(o.replies ?? [])];
  const model = o.model ?? "claude-opus-5-5";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return Response.json({});
      const body = (await req.json()) as Record<string, any>;
      if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      bodies.push(body);
      const main = Array.isArray(body.tools) && body.tools.length > 0;
      const reply = main && replies.length ? replies.shift()! : [{ type: "text", text: "DONE" }];
      return new Response(sse(body.model, reply as any), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", ANTHROPIC_API_KEY: "placeholder-not-a-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:" + server.port, ANTHROPIC_MODEL: model,
    CLAUDE_CONFIG_DIR: join(o.home, ".claude"), HOME: o.home, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
    DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", IS_SANDBOX: "1",
  };
  try {
    const argv = [CLAUDE_BIN, "--print", "--verbose", "--output-format", "stream-json", "--input-format", "stream-json", "--model", model, "--permission-mode", "bypassPermissions", "--setting-sources", "user,project", "--max-turns", String(o.maxTurns ?? 4), "--disallowedTools", "WebSearch,WebFetch", "--strict-mcp-config"];
    const proc = Bun.spawn(argv, { cwd: o.cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: o.prompt } }) + "\n");
    proc.stdin.end();
    const timer = setTimeout(() => proc.kill(), 120_000);
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    return { bodies, stdout: stdout + (code ? "\n" + stderr : ""), code };
  } finally {
    server.stop(true);
  }
}
