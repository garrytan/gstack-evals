// Copyright (c) 2026 Garry Tan. MIT License.
// Shape capture (prereg section 3): a stand-in Claude Code against the scripted stub provider, in an empty home with a
// dummy key; per-run fields become placeholders; forbidden content is refused. The real-CLI run is gated on TBV_REAL_CLI=1.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARM_MODELS, PLACEHOLDERS } from "../../lanes/tbv/types.ts";
import { makeGstack, STUB_CLAUDE } from "./fixtures/s2.ts";

const { captureShape, fillShape, refuseForbidden, run, startStubProvider, FROZEN_FIELDS, MODEL_NAMES } = await import("../../lanes/tbv/shape.ts");

let root = "";
let g: ReturnType<typeof makeGstack>;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "tbv-shape-test-"));
  g = makeGstack(root);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const out = () => mkdtempSync(join(root, "out-"));
const code = async (p: Promise<unknown>) => p.then(() => "resolved", (e) => (e as { code?: string }).code ?? String(e));
const text = (s: { system: Array<{ text: string }>; tools: unknown[] }) => JSON.stringify([s.system, s.tools]);

describe("stub provider", () => {
  test("answers streaming and plain requests, records every body, and spends the script only on tool-bearing requests", async () => {
    const stub = startStubProvider([{ tool: { name: "Read", input: { file_path: "a.md" } } }, { text: "Done here." }]);
    try {
      const post = (body: object) => fetch(stub.url + "/v1/messages?beta=true", { method: "POST", body: JSON.stringify(body) });
      const side: any = await (await post({ model: "m", messages: [], max_tokens: 1 })).json();
      expect(side.content[0].text).toBeString();
      const sse = await (await post({ model: "m", messages: [], tools: [{ name: "Read" }], stream: true })).text();
      expect(sse).toContain("event: message_start");
      expect(sse).toContain('"partial_json":"{\\"file_path\\":\\"a.md\\"}"');
      expect(sse).toContain('"stop_reason":"tool_use"');
      const plain: any = await (await post({ model: "m", messages: [], tools: [{ name: "Read" }] })).json();
      expect(plain.content).toEqual([{ type: "text", text: "Done here." }]);
      expect(stub.requests.length).toBe(3);
      expect(stub.main().length).toBe(2);
      expect((await fetch(stub.url + "/v1/messages/count_tokens", { method: "POST", body: "{}" })).status).toBe(200);
    } finally {
      stub.stop();
    }
  });
});

describe("captureShape", () => {
  test("none: records system, tools and max_tokens of the first request, with per-run fields as placeholders", async () => {
    const s = await captureShape({ arm: "none", pin: null, claude: STUB_CLAUDE, gstack: null, out: out() });
    expect(s.schema).toBe("tbv-shape.v1");
    expect(s.claude_code).toBe("2.1.312");
    expect(s.max_tokens).toBe(64000);
    expect(s.tools.map((t) => t.name)).toEqual(["Bash", "Read"]);
    const all = text(s);
    expect(all).not.toContain("x-anthropic-billing-header");
    expect(all).toContain("Primary working directory: " + PLACEHOLDERS.cwd);
    expect(all).toContain("model named " + PLACEHOLDERS.modelName + ". The exact model ID is " + PLACEHOLDERS.modelId + ".");
    expect(all).toContain("Today's date is " + PLACEHOLDERS.date + ".");
    expect(all).not.toContain(root);
    expect(all).not.toContain("tbv-cap");
    expect(all).not.toContain("cache_control");
    expect(all).not.toContain("skills are available");
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("two captures give the same sha256 (run-specific text is templated or dropped)", async () => {
    const a = await captureShape({ arm: "none", pin: null, claude: STUB_CLAUDE, gstack: null, out: out() });
    const b = await captureShape({ arm: "none", pin: null, claude: STUB_CLAUDE, gstack: null, out: out() });
    expect(a.sha256).toBe(b.sha256);
  });

  test("the CLI runs with a dummy key, no real key names, an empty home and working directory, bundled skills off and a loopback base URL", async () => {
    let bodies: Array<Record<string, any>> = [];
    await captureShape({ arm: "none", pin: null, claude: STUB_CLAUDE, gstack: null, out: out(), onRequests: (r) => (bodies = r.map((x) => x.body)) });
    const meta = bodies[0]!.metadata.tbv_stub;
    expect(meta.key).toBe("placeholder-not-a-key");
    expect(meta.names).not.toContain("OPENAI_API_KEY");
    expect(meta.names).not.toContain("OPENROUTER_API_KEY");
    expect(meta.names).not.toContain("UBICLOUD_API_KEY");
    expect(meta.start).toEqual({ home: [], cwd: [] });
    expect(meta.bundled).toBe("1");
  });

  test("current: gstack installed at the pin gives the skill listing, and the home keeps only the install", async () => {
    let bodies: Array<Record<string, any>> = [];
    const s = await captureShape({ arm: "current", pin: g.pin, claude: STUB_CLAUDE, gstack: g.dir, out: out(), onRequests: (r) => (bodies = r.map((x) => x.body)) });
    expect(s.pin).toBe(g.pin);
    expect(text(s)).toContain("- investigate: Find the root cause of a bug before fixing it.");
    expect(bodies[0]!.metadata.tbv_stub.start.home).toEqual([".claude", ".local"]);
  });

  test("refuses a checkout that is not at the pin, a gstack arm with no pin and a none arm with one", async () => {
    expect(await code(captureShape({ arm: "current", pin: g.degradedPin, claude: STUB_CLAUDE, gstack: g.dir, out: out() }))).toBe("E_TBV_SHAPE");
    expect(await code(captureShape({ arm: "current", pin: null, claude: STUB_CLAUDE, gstack: g.dir, out: out() }))).toBe("E_TBV_INPUT");
    expect(await code(captureShape({ arm: "none", pin: g.pin, claude: STUB_CLAUDE, gstack: g.dir, out: out() }))).toBe("E_TBV_INPUT");
  });

  test("refuses captured text with the org rules' trust-but-verify wording (E_TBV_SHAPE)", async () => {
    const r = await import("node:child_process");
    r.spawnSync("git", ["checkout", "-q", g.forbiddenPin], { cwd: g.dir });
    try {
      expect(await code(captureShape({ arm: "current", pin: g.forbiddenPin, claude: STUB_CLAUDE, gstack: g.dir, out: out() }))).toBe("E_TBV_SHAPE");
    } finally {
      r.spawnSync("git", ["checkout", "-q", g.pin], { cwd: g.dir });
    }
  });

  test("refuses a claude binary that is not Claude Code 2.1.312", async () => {
    const fake = join(root, "old-claude");
    writeFileSync(fake, '#!/bin/sh\necho "2.1.300 (Claude Code)"\n');
    chmodSync(fake, 0o755);
    expect(await code(captureShape({ arm: "none", pin: null, claude: fake, gstack: null, out: out() }))).toBe("E_TBV_SHAPE");
  });

  test("refuses an out directory inside the repo, so captured text never lands there", async () => {
    expect(await code(captureShape({ arm: "none", pin: null, claude: STUB_CLAUDE, gstack: null, out: join(import.meta.dir, "captured") }))).toBe("E_TBV_INPUT");
  });
});

describe("refuseForbidden", () => {
  const cases = ["see ~/.capy/drive/x", "read captain-gstack-evals/NOTES.md", "the CREW.md rules", "TRUST BUT VERIFY, IN EVERY REPORT", "open each report with a TL;DR that"];
  const codeOf = (t: string) => {
    try {
      refuseForbidden(t, "test");
      return "passed";
    } catch (e) {
      return (e as { code?: string }).code ?? String(e);
    }
  };
  for (const c of cases) test("refuses " + JSON.stringify(c), () => expect(codeOf(c)).toBe("E_TBV_SHAPE"));
  test("passes plain gstack text", () => expect(codeOf("Read captain/templates/report.md and verify the claim.")).toBe("passed"));
});

describe("fillShape", () => {
  test("fills every placeholder per model and leaves no placeholder", async () => {
    const s = await captureShape({ arm: "none", pin: null, claude: STUB_CLAUDE, gstack: null, out: out() });
    const sol = fillShape(s, "sol", FROZEN_FIELDS);
    const t = text(sol);
    expect(t).toContain("model named " + MODEL_NAMES.sol + ". The exact model ID is " + ARM_MODELS.sol.id + ".");
    expect(t).toContain("Primary working directory: " + FROZEN_FIELDS.cwd);
    expect(t).toContain("Today's date is " + FROZEN_FIELDS.date + ".");
    expect(t).not.toContain("{{TBV_");
    expect(text(s)).toContain("{{TBV_MODEL_ID}}");
  });
});

describe("tbv shape", () => {
  test("prints the sha256 per arm, pin and model", async () => {
    const lines: string[] = [];
    const rc = await run(["shape", "--arm", "none", "--claude", STUB_CLAUDE, "--out", out()], { out: (t) => lines.push(t), err: (t) => lines.push(t) });
    expect(rc).toBe(0);
    const all = lines.join("\n");
    for (const m of ["opus", "sol", "particle"]) expect(all).toMatch(new RegExp("shape none none " + m + " [0-9a-f]{64}"));
  });
  test("refuses an unknown flag", async () => {
    expect(await code(run(["shape", "--arm", "none", "--bogus"], { out: () => {}, err: () => {} }))).toBe("E_TBV_INPUT");
  });
});

const REAL = process.env.TBV_REAL_CLI === "1";
describe.skipIf(!REAL)("real Claude Code 2.1.312 and gstack at 641d622 (TBV_REAL_CLI=1)", () => {
  test("captures shapes for none and current and splices for investigate, ship and capy", async () => {
    const { realCapture } = await import("./real-capture.ts");
    const report = await realCapture();
    console.log(report);
    expect(report).toContain("skill start clean");
  }, 900_000);
});
