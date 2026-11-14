// Copyright (c) 2026 Garry Tan. MIT License.
// The in-VM agents' session (stage3/agent.ts) end to end, keyless: the real Agent SDK and adapter drive the stand-in
// CLI under the env file the controller wrote, through a fake VM backend, to a local stand-in for the item's proxy.
// The VM proxy endpoint forwards by slot to a local upstream. Nothing leaves the loopback.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_PROMPT, RECIPES, STAGE3 } from "../../../lanes/design-constructed/frozen.ts";
import { AGENT_ENV_DIR, envFileText, runVmAgent } from "../../../lanes/design-constructed/stage3/agent.ts";
import { agentRig, type AgentRig } from "../../../lanes/design-constructed/stage3/agent-fake.ts";
import { serveVmFront } from "../../../lanes/design-constructed/stage3/front.ts";
import { AGENT_ROOT } from "../../../lanes/design-constructed/stage3/install.ts";

let rigs: AgentRig[] = [];
afterEach(() => {
  for (const r of rigs) r.close();
  rigs = [];
});
const rig = (o: Omit<Parameters<typeof agentRig>[0], "out">) => {
  const r = agentRig({ ...o, out: mkdtempSync(join(tmpdir(), "dc-agent-")) });
  rigs.push(r);
  return r;
};
const SUB = { item: "dc-base-apps" as const, id: "sub-1" };

describe("the in-VM agent session", () => {
  test("a recipe session runs the CLI under the controller's env file, reaches only its slot and ends completed at the proxy's spend", async () => {
    const r = rig({ reply: () => "recipe written", spentMicros: 2_500_000 });
    const run = await runVmAgent(r.deps, r.vm, { prompt: "write the recipe", limits: RECIPES.session, sub: SUB });
    expect(run).toEqual({ end: "completed", spentUsd: 2.5 });
    expect(r.upstream).toHaveLength(1);
    expect(r.upstream[0]).toEqual({ path: "/slot1/anthropic/v1/messages", auth: "Bearer run-token-1", model: "claude-opus-5-5" });
    const envFile = AGENT_ENV_DIR + "/env";
    expect(r.files.get(envFile)).toContain("export PATH='" + AGENT_ROOT + "/package'" + ':"$PATH"');
    expect(r.spawned[0]!.ANTHROPIC_AUTH_TOKEN).toBe("run-token-1");
    expect(Object.keys(r.spawned[0]!).filter((k) => /API_KEY$/.test(k))).toEqual([]);
    expect(r.execs.map((e) => e.user)).toEqual(["root", "root", "root"]);
    expect(r.execs.at(-1)!.command).toContain("rm -f '" + envFile + "'");
    expect(r.ended).toEqual(["recipe session c001"]);
  }, 60_000);

  test("a build session carries its env and reads the turn cap as its own limit; unknown spend is null", async () => {
    const r = rig({ reply: () => "LIMIT", unknownMicros: 10 });
    const run = await runVmAgent(r.deps, r.vm, { prompt: BUILD_PROMPT, limits: STAGE3.build, sub: { item: "dc-stage3-builds", id: "sub-2" }, env: { DC_UNIT_ROUTE: "/reports" } });
    expect(run).toEqual({ end: "own-limit", spentUsd: null });
    expect(r.spawned[0]!.DC_UNIT_ROUTE).toBe("/reports");
  }, 60_000);

  test("the env file refuses a key name and a name that is not plain", () => {
    expect(() => envFileText({ ANTHROPIC_API_KEY: "x" })).toThrow("carries the key name ANTHROPIC_API_KEY");
    expect(() => envFileText({ "A-B": "x" })).toThrow("is not a plain name");
    expect(envFileText({ A: "it's" })).toBe("export A='it'\\''s'\nexport PATH='" + AGENT_ROOT + "/package'" + ':"$PATH"\n');
  });

  test("the VM proxy endpoint forwards a bound slot to its proxy unchanged and answers 404 for any other", async () => {
    const seen: string[] = [];
    const up = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => (seen.push(new URL(req.url).pathname + " " + req.headers.get("authorization") + " " + (await req.text())), new Response("ok")) });
    const front = serveVmFront({ host: "127.0.0.1", port: 0 });
    try {
      front.route("slot1", "http://127.0.0.1:" + up.port + "/");
      const hit = await fetch(front.url + "/slot1/anthropic/v1/messages", { method: "POST", headers: { authorization: "Bearer t1" }, body: "{}" });
      expect([hit.status, await hit.text()]).toEqual([200, "ok"]);
      expect(seen).toEqual(["/slot1/anthropic/v1/messages Bearer t1 {}"]);
      expect((await fetch(front.url + "/slot2/anthropic/v1/messages")).status).toBe(404);
      front.unroute("slot1");
      expect((await fetch(front.url + "/slot1/x")).status).toBe(404);
      expect(() => front.route("a/b", "http://127.0.0.1:1")).toThrow("is not a path segment");
    } finally {
      front.close();
      up.stop(true);
    }
  });
});
