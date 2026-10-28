import { afterAll, describe, expect, mock, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeteringProxy } from "../src/proxy.ts";

const dir = mkdtempSync(join(tmpdir(), "session-"));
const bin = join(dir, "bin");
const cpFails = join(dir, "cp-fails");
mkdirSync(join(dir, "tree", "work"), { recursive: true });
mkdirSync(bin);
writeFileSync(
  join(bin, "docker"),
  `#!/bin/sh\nif [ "$1" = cp ] && [ "$3" = - ]; then\n  [ -e "${cpFails}" ] && exit 1\n  tar -c -C "${join(dir, "tree")}" work\nfi\nexit 0\n`,
);
chmodSync(join(bin, "docker"), 0o755);
const path = process.env.PATH;
process.env.PATH = `${bin}:${path}`;

const upstream = Bun.serve({
  port: 0,
  async fetch() {
    await Bun.sleep(300);
    return Response.json({ type: "message", content: [], usage: { input_tokens: 1000, output_tokens: 1000 } });
  },
});
const proxy = new MeteringProxy({ hostname: "127.0.0.1", port: 0, upstream: `http://127.0.0.1:${upstream.port}`, upstreamKey: () => "k" });
afterAll(() => {
  proxy.stop();
  upstream.stop(true);
  process.env.PATH = path;
});

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: async function* ({ options }: any) {
    void fetch(`${options.env.ANTHROPIC_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": options.env.ANTHROPIC_API_KEY },
      body: JSON.stringify({ model: options.model, max_tokens: 1000, messages: [] }),
    }).catch(() => {});
    await Bun.sleep(50);
    yield { type: "system", subtype: "init", model: options.model };
    yield { type: "assistant", parent_tool_use_id: "toolu_task", message: { content: [{ type: "text", text: "What's the strongest evidence that someone actually wants this?" }] } };
    yield { type: "result", subtype: "success", num_turns: 2, total_cost_usd: 0.1, duration_ms: 10 };
    yield { type: "result", subtype: "success", num_turns: 1, total_cost_usd: 0.3, duration_ms: 10 };
  },
}));
const { runSession } = await import("../src/session.ts");

const spec = (id: string) => ({
  id,
  suite: "s",
  skill: "office-hours",
  task: { id: "t", prompt: "p" } as { id: string; prompt: string; check?: string },
  arm: "before" as const,
  model: "claude-haiku-5-5",
  trial: 1,
  image: "img",
  seedDir: dir,
  fixturesDir: dir,
  outDir: join(dir, id),
  sizes: {},
  ceilingUsd: 1,
  hardLimitUsd: 1,
  fakeExecutable: "/bin/false",
  agentUid: "1000:1000",
});

describe("runSession", () => {
  test("reads spend only after the request in flight settles, and takes the SDK's cumulative cost once", async () => {
    rmSync(cpFails, { force: true });
    const r = await runSession(spec("drain"), proxy);
    expect(r.status).toBe("complete");
    expect(r.requests).toBe(1);
    expect(r.cost_usd).toBeCloseTo((1000 * 0.1 + 1000 * 0.5) / 1e6, 9);
    expect(r.sdk.total_cost_usd).toBe(0.3);
  });
  test("the scripted user answers the main agent's turn, not a subagent's text", async () => {
    rmSync(cpFails, { force: true });
    const r = await runSession({ ...spec("usersim"), script: { replies: { demand: "Dana pays a VA $40 a month." } } }, proxy);
    expect(r.usersim.sequence).toEqual([]);
    expect(r.usersim.prose_replies).toBe(0);
  });
  test("a failed work-dir copy is an infra error, so no check runs on an empty dir", async () => {
    writeFileSync(cpFails, "");
    const r = await runSession({ ...spec("copy"), task: { id: "t", prompt: "p", check: "true" } }, proxy);
    expect(r.status).toBe("infra_error");
    expect(r.check).toBeNull();
    expect(r.errors.join(" ")).toContain("E_COPY");
    expect(existsSync(join(dir, "copy", "result.json"))).toBe(true);
  });
});
