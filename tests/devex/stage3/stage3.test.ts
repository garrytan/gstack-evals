// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's dry-run lines (lanes/devex/stage3/checks.ts, prereg 2026-11-09-geva-417 section 12) and the pieces behind
// them, keyless: the fake VM backend, a fake Ubicloud API, a fake judge caller and one metered judge call through the
// shared metered client on a temporary ledger with a fake upstream.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { openJudge } from "../../../lanes/devex/score/judge.ts";
import { drawBuildUnits } from "../../../lanes/devex/stage3/build.ts";
import { checks, goalRecord, meta } from "../../../lanes/devex/stage3/checks.ts";
import { FakeBackend, fakeSpec, res } from "../../../lanes/devex/stage3/fake.ts";
import { astraProbeJudge, docsFiles, readmeShare, scoreProbe } from "../../../lanes/devex/stage3/firstsuccess.ts";
import { probeRun } from "../../../lanes/devex/stage3/run.ts";
import { breaches, parseNetLog, sandboxed, UbicloudBackend } from "../../../lanes/devex/stage3/sandbox.ts";
import { run } from "../../../lanes/devex/stage3/cli.ts";

test("every stage 3 line passes on both sides of its edge", async () => {
  const lines = await checks();
  expect(lines.filter((l) => !l.pass).map((l) => l.rule + ": " + l.detail)).toEqual([]);
  expect(lines.length).toBe(10);
});

test("dx stage3 checks prints one PASS line per rule and exits 0", async () => {
  const out: string[] = [];
  expect(await run(["checks"], { out: (t) => out.push(t), err: () => {} })).toBe(0);
  expect(out.length).toBe(10);
  expect(out.every((l) => l.startsWith("PASS "))).toBe(true);
});

test("the sandbox destroys its VM when the job throws, and still reads the log", async () => {
  const b = new FakeBackend();
  const r = await sandboxed(b, fakeSpec(), "/work", async (vm) => {
    (vm as any).net.push({ host: "10.0.0.3", port: 443 });
    throw new Error("agent crashed");
  });
  expect(r.error).toBe("agent crashed");
  expect(r.breach).toEqual([]);
  expect(b.destroyed.has(b.vms[0]!.id)).toBe(true);
});

test("a preamble step that fails stops the job before it runs", async () => {
  let ran = false;
  const b = new FakeBackend((_, c) => (c.startsWith("loginctl") ? res(1) : undefined));
  const r = await sandboxed(b, fakeSpec(), "/work", async () => (ran = true));
  expect(ran).toBe(false);
  expect(r.error).toContain("loginctl enable-linger run");
  expect(b.destroyed.size).toBe(1);
});

test("a breach is any host or port other than the proxy's and the mirror's", () => {
  const s = fakeSpec();
  expect(breaches([{ host: "10.0.0.2", port: 8080 }, { host: "10.0.0.3", port: 443 }], s)).toEqual([]);
  expect(breaches([{ host: "10.0.0.3", port: 80 }, { host: "10.0.0.2", port: 443 }], s).length).toBe(2);
  expect(parseNetLog("x DXNET IN= OUT=eth0 SRC=10.0.0.5 DST=203.0.113.9 LEN=60 PROTO=TCP SPT=4000 DPT=443\nother line")).toEqual([{ host: "203.0.113.9", port: 443 }]);
});

test("the Ubicloud backend needs a token and deletes the VM it made (fake API)", async () => {
  expect(() => new UbicloudBackend({ project: "p", location: "l", token: "", size: "s", image: "i", publicKey: "k", ssh: async () => ({ ...res() }) })).toThrow(/token/);
  const calls: string[] = [];
  const f = (async (url: any, init?: any) => {
    calls.push(init.method + " " + String(url).split("/vm/")[1]);
    return init.method === "GET" ? Response.json({ state: "running", ip4: "192.0.2.1" }) : new Response(null, { status: 204 });
  }) as typeof fetch;
  const u = new UbicloudBackend({ project: "p", location: "l", token: "fake", size: "s", image: "i", publicKey: "k", fetch: f, ssh: async () => res() });
  const vm = await u.create(fakeSpec({ owner: "GEVA-0" }));
  expect(vm.id.startsWith("dx-geva-0-")).toBe(true);
  await u.destroy(vm);
  expect(calls.map((c) => c.split(" ")[0])).toEqual(["POST", "GET", "DELETE"]);
});

test("an API probe reads its media type and body from curl -si", () => {
  const p = { ...goalRecord("u").probes[0], kind: "api" as const };
  const r = probeRun(p, res(0, "HTTP/1.1 400 Bad Request\r\ncontent-type: application/problem+json\r\n\r\n{\"title\":\"bad\"}"));
  expect(r.content_type).toBe("application/problem+json");
  expect(r.stdout).toBe("{\"title\":\"bad\"}");
});

test("a probe meets every field only when the judge says yes to both judged fields", async () => {
  const p = goalRecord("u").probes[0];
  const run1 = { kind: "cli" as const, exit: 2, stdout: "", stderr: "error: missing --name", elapsed_ms: 50, stdin_closed: true, content_type: null };
  expect((await scoreProbe(p, run1, { goal: "g", secrets: [], judge: async () => ({ names_failure: true, names_fix: true }) })).meets).toBe(true);
  expect((await scoreProbe(p, run1, { goal: "g", secrets: [], judge: async () => ({ names_failure: true, names_fix: false }) })).meets).toBe(false);
  expect((await scoreProbe(p, run1, { goal: "g", secrets: [], judge: async () => null })).meets).toBe(null);
});

test("the Astra probe judge reads the reply's JSON through the caller", async () => {
  const seen: string[] = [];
  const j = astraProbeJudge(async (c) => (seen.push(c.judge + ":" + c.subject), { text: "{\"names_failure\": true, \"names_fix\": false}", model_id: "openai:gpt-6-astra", version: null, problem: null }));
  expect(await j({ goal: "g", probe: goalRecord("u").probes[0], output: "error" })).toEqual({ names_failure: true, names_fix: false });
  expect(seen).toEqual(["astra:opus"]);
});

test("the Astra probe judge runs through the shared metered client on a temporary ledger (fake upstream)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dx-stage3-"));
  try {
    const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
    recordApproval(record, { action: "init", item: "dx-stage3-dry", cap_micros: 10_000_000, quotes: [{ words: "dry run", by: "dry run", source: "dry run" }], admission: "warn" });
    const up = (async (_url: any, _init?: any) => Response.json({ id: "r", object: "response", model: "gpt-6-astra-2026-09-01", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{\"names_failure\": true, \"names_fix\": true}" }] }], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 20 } })) as typeof fetch;
    const j = await openJudge({ item: "dx-stage3-dry", runId: "dx-stage3-dry", out: join(dir, "out"), cacheDir: join(dir, "cache"), record, ledger, env: { ANTHROPIC_API_KEY: "dry-run", OPENAI_API_KEY: "dry-run", OPENROUTER_API_KEY: "dry-run" }, fetch: up });
    expect(await astraProbeJudge(j.call)({ goal: "g", probe: goalRecord("u").probes[1], output: "error: unknown mode" })).toEqual({ names_failure: true, names_fix: true });
    await j.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("docs-only inputs carry README, docs/ and help only, and refuse a path that leaves docs/", () => {
  expect(Object.keys(docsFiles({ readme: "r", docs: { "a.md": "x" }, help: "h", goal: "g" })).sort()).toEqual(["/work/docs/README.md", "/work/docs/docs/a.md", "/work/docs/help.txt"]);
  expect(() => docsFiles({ readme: "r", docs: { "../src/x.ts": "x" }, help: "h", goal: "g" })).toThrow(/leaves docs/);
});

test("the README share counts exit-0 commands a README code line states", () => {
  const readme = "intro fixturetool init\n\u0060\u0060\u0060sh\n$ fixturetool init --name demo\nfixturetool run\n\u0060\u0060\u0060\n";
  expect(readmeShare([{ command: "fixturetool  init --name demo", exit: 0, turn: 1 }, { command: "fixturetool init", exit: 0, turn: 2 }, { command: "bad", exit: 1, turn: 2 }], readme)).toBe(0.5);
  expect(readmeShare([{ command: "bad", exit: 1, turn: 1 }], readme)).toBe(null);
});

test("the build draw fills a short class's slots from other classes in seeded order, up to 16", async () => {
  const units = [...Array.from({ length: 10 }, (_, i) => meta("c" + i, i + 1)), ...Array.from({ length: 5 }, (_, i) => meta("a" + i, 20 + i, "API")), meta("s0", 30, "SDK"), meta("g0", 31, "CONFIG"), meta("g1", 32, "CONFIG")];
  const d = await drawBuildUnits(units, { buildable: async () => true, audit: async () => ({ pass: true, goal: true, probes: [], problems: [] }) });
  expect(d.units.length).toBe(16);
  expect(d.by_class).toEqual({ CLI: 9, API: 4, SDK: 1, CONFIG: 2 });
  expect(d.short).toEqual(["SDK", "CONFIG"]);
  expect(d.units.slice(11)).toEqual(["c4", "c5", "c6", "c7", "c8"]);
});
