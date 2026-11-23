// Value: protects=a session limited to named tools (the day-one checker's browser tools) can call them on the real pinned CLI: Claude Code would otherwise defer the MCP tools behind ToolSearch, which onlyTools denies, so the session sees no browser at all; fails_when=the driver lets the CLI defer MCP tools for an onlyTools session; why_new=the day-one smoke's fixtures with the real checker, where Sol's ToolSearch calls were refused and it marked all five reference tasks not done; seam=the pinned CLI's request shape and canUseTool; no_claim=a real provider or the real browser server
import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeCodeDriver } from "../../src/adapters/claude-code/driver.ts";
import { HAS_CLAUDE_CLI, harness, type Harness } from "./harness.ts";

const NAMES = ["browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_evaluate", "browser_console_messages"];
const ONLY = NAMES.slice(0, 4).map((n) => "mcp__browser__" + n);

/** A minimal streamable-HTTP MCP server: initialize, tools/list with NAMES, tools/call answering "page ok". */
function mcpServer(calls: string[]): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    if (req.method !== "POST") return void res.writeHead(405).end();
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const msg = JSON.parse(raw || "{}");
      if (msg.id === undefined) return void res.writeHead(202).end();
      const result =
        msg.method === "initialize" ? { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stub-browser", version: "1.0.0" } }
        : msg.method === "tools/list" ? { tools: NAMES.map((name) => ({ name, description: "Stub " + name, inputSchema: { type: "object", properties: { url: { type: "string" } } } })) }
        : msg.method === "tools/call" ? (calls.push(String(msg.params?.name)), { content: [{ type: "text", text: "page ok" }] })
        : {};
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ url: "http://127.0.0.1:" + (server.address() as { port: number }).port + "/mcp", server })));
}

let open: Harness[] = [];
let servers: Server[] = [];
afterEach(() => {
  for (const h of open) h.close();
  for (const s of servers) s.close();
  open = [];
  servers = [];
});

describe.skipIf(!HAS_CLAUDE_CLI)("a session limited to named tools, on the real pinned CLI (keyless)", () => {
  test("declares its MCP tools up front, with no ToolSearch, and its first browser call reaches the server", async () => {
    const calls: string[] = [];
    const mcp = await mcpServer(calls);
    servers.push(mcp.server);
    const h = harness(({ results }) => (results.has("toolu_nav") ? [{ type: "text", text: "Done." }] : [{ type: "tool_use", id: "toolu_nav", name: "mcp__browser__browser_navigate", input: { url: "http://app" } }]));
    open.push(h);
    const model = "openai/gpt-6.1-sol";
    const binding = h.bind(model, "openrouter");
    const driver = claudeCodeDriver({ model, provider: "openrouter", proxy: { baseUrl: h.baseUrl, slot: binding.slot, token: binding.token }, skill: null, out: join(h.dir, "host"), query: query as never, mcpServers: { browser: { type: "http", url: mcp.url } }, onlyTools: ONLY });
    const outcome = await driver.run(h.session(join(h.dir, "work", "t"), join(h.dir, "home"), driver.env!), { id: "t", prompt: "Check the app." }, 120_000);
    const main = h.upstream.find((u) => (u.body.tools ?? []).some((t: { name?: string }) => t.name === "Bash"));
    const tools = (main?.body.tools ?? []) as { name?: string; type?: string; defer_loading?: boolean }[];
    expect(tools.filter((t) => t.name?.startsWith("mcp__browser__") && !t.defer_loading).map((t) => t.name).sort()).toEqual(NAMES.map((n) => "mcp__browser__" + n).sort());
    expect(tools.some((t) => /tool_search/i.test(String(t.type ?? "")) || t.name === "ToolSearch")).toBe(false);
    expect(calls).toEqual(["browser_navigate"]);
    expect(outcome.termination).toEqual({ kind: "completed" });
  }, 180_000);
});
