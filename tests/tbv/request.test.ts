// Copyright (c) 2026 Garry Tan. MIT License.
// The request builder (prereg section 3: four inputs only) and the structural validator.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARM_MODELS, BUNDLE, PLACEHOLDERS, type BuildInput, type SpliceSet } from "../../lanes/tbv/types.ts";
import { history, shape, TURNS, useLocalRenderIfNotBuilt, WORK } from "./fixtures/s2.ts";

await useLocalRenderIfNotBuilt();
const { buildRequest, validateRequest, LENS_LINE, MAX_TOKENS, WINDOWS } = await import("../../lanes/tbv/request.ts");
const { FROZEN_FIELDS } = await import("../../lanes/tbv/shape.ts");
const REPO = join(import.meta.dir, "../..");

const splice: SpliceSet = {
  schema: "tbv-splice.v1",
  family: "investigate",
  pin: "a".repeat(40),
  opening: [{ type: "text", text: "<command-name>/investigate</command-name>\n<command-args>" + PLACEHOLDERS.firstUser + "</command-args>" }],
  head: [
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_s1", name: "Read", input: { file_path: "~/p.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_s1", content: "1\t**Bounded closer.** Short.\n2\tcwd " + PLACEHOLDERS.cwd }] },
  ],
  tail: [],
  closer: { kind: "preamble", paragraph: "**Bounded closer.** Short." },
  skillStart: null,
  files: [],
  sha256: "2".repeat(64),
};
const input = (o: Partial<BuildInput> = {}): BuildInput => ({ history: history(WORK), shape: shape(o.arm ?? "none"), splice: null, turns: TURNS, arm: "none", model: "opus", turn: "report", prior: [], ...o });
const reply = (text: string) => ({ text, content: text ? [{ type: "text" as const, text }] : [], stopReason: "end_turn" });
const ccCount = (b: unknown) => (JSON.stringify(b).match(/"cache_control"/g) ?? []).length;
type Body = { messages: Array<{ role: string; content: Array<Record<string, any>> }>; [k: string]: any };

describe("buildRequest", () => {
  test("takes one input, reads no file and no environment", () => {
    expect(buildRequest.length).toBe(1);
    const src = readFileSync(join(REPO, "lanes/tbv/request.ts"), "utf8");
    expect(src).not.toMatch(/process\.env|readFileSync|Bun\.file|node:fs/);
    const env = process.env;
    const touched: string[] = [];
    const patched = ["readFileSync", "existsSync", "statSync", "openSync", "readdirSync"] as const;
    const saved = patched.map((n) => (fs as any)[n]);
    process.env = new Proxy({ ...env }, { get: (t, k) => (touched.push(String(k)), (t as any)[k]), has: (t, k) => (touched.push(String(k)), k in t) });
    patched.forEach((n) => { try { (fs as any)[n] = () => { throw new Error("read during build: " + n); }; } catch {} });
    try {
      buildRequest(input({ arm: "current", shape: shape("current"), splice }));
    } finally {
      process.env = env;
      patched.forEach((n, i) => { try { (fs as any)[n] = saved[i]; } catch {} });
    }
    expect(touched).toEqual([]);
  });

  test("none: tool_choice none, no thinking, max_tokens 4000, stream, the arm's model and route, the shape filled and without cache_control", () => {
    const r = buildRequest(input());
    const b = r.body as Body;
    expect(r.provider).toBe("anthropic");
    expect(r.route).toBe("/v1/messages");
    expect(b.model).toBe(ARM_MODELS.opus.id);
    expect(b.tool_choice).toEqual({ type: "none" });
    expect("thinking" in b).toBe(false);
    expect(b.max_tokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBe(4000);
    expect(b.stream).toBe(true);
    expect(JSON.stringify(b.system)).toContain("model named Opus 5.5. The exact model ID is claude-opus-5-5.");
    expect(JSON.stringify(b.system)).toContain(FROZEN_FIELDS.cwd);
    expect(JSON.stringify([b.system, b.tools])).not.toContain("cache_control");
    expect(JSON.stringify(b)).not.toContain("{{TBV_");
    expect(r.estTokens).toBe(Math.ceil(JSON.stringify(b).length / 3));
    expect(r.sha256).toBe(createHash("sha256").update(JSON.stringify(b)).digest("hex"));
    expect(buildRequest(input({ model: "sol" })).provider).toBe("openrouter");
  });

  test("exactly one 5-minute breakpoint, on the history's last block, before the first turn's text; the prefix is the same for every turn", () => {
    const r1 = buildRequest(input()).body as Body;
    expect(ccCount(r1)).toBe(1);
    const last = r1.messages[r1.messages.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content.map((b) => b.type)).toEqual(["text"]);
    expect(last.content[0]!.text).toBe(TURNS.report);
    const hist = r1.messages[r1.messages.length - 2]!;
    expect(hist.content[hist.content.length - 1]!.cache_control).toEqual({ type: "ephemeral" });
    const r3 = buildRequest(input({ turn: "d1", prior: [{ turn: "report", reply: reply("All good.") }] })).body as Body;
    expect(ccCount(r3)).toBe(1);
    expect(JSON.stringify(r3.messages.slice(0, r1.messages.length - 1))).toBe(JSON.stringify(r1.messages.slice(0, -1)));
    expect(r3.messages.slice(-3).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(r3.messages[r3.messages.length - 1]!.content[0]!.text).toBe(TURNS.d1);
  });

  test("a history that ends on a tool result takes the turn's text in the same user message, after the breakpoint", () => {
    const b = buildRequest(input({ history: history(WORK.slice(0, 4)) })).body as Body;
    const last = b.messages[b.messages.length - 1]!;
    expect(last.content.map((x) => x.type)).toEqual(["tool_result", "text"]);
    expect(last.content[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(validateRequest(b, "opus")).toEqual({ ok: true });
  });

  test("turn order: followup after an empty report merges into one user turn; d2 after report, followup and d1; a wrong order is refused", () => {
    const f = buildRequest(input({ turn: "d1", prior: [{ turn: "report", reply: reply("") }, { turn: "followup", reply: reply("Here it is.") }] })).body as Body;
    expect(validateRequest(f, "opus")).toEqual({ ok: true });
    expect(JSON.stringify(f.messages.slice(-3))).toContain(TURNS.followup);
    const d2 = buildRequest(input({ turn: "d2", prior: [{ turn: "report", reply: reply("A.") }, { turn: "d1", reply: reply("1. x") }] })).body as Body;
    expect(d2.messages[d2.messages.length - 1]!.content[0]!.text).toBe(TURNS.d2);
    expect(() => buildRequest(input({ turn: "d2", prior: [{ turn: "report", reply: reply("A.") }] }))).toThrow();
    expect(() => buildRequest(input({ turn: "report", prior: [{ turn: "report", reply: reply("A.") }] }))).toThrow();
  });

  test("lens appends lens.txt's line to the task's first user message; the line matches the frozen file", () => {
    expect(createHash("sha256").update(LENS_LINE + "\n").digest("hex")).toBe(BUNDLE.lens.sha256);
    const b = buildRequest(input({ arm: "lens", shape: shape("lens") })).body as Body;
    expect(b.messages[0]!.content[0]!.text).toBe((WORK[0] as { text: string }).text + "\n\n" + LENS_LINE);
    expect(JSON.stringify(buildRequest(input()).body)).not.toContain(LENS_LINE);
  });

  test("gstack arms use the splice with the task's first message and frozen fields filled; none and lens refuse a splice; current refuses none", () => {
    const b = buildRequest(input({ arm: "current", shape: shape("current"), splice })).body as Body;
    const t = JSON.stringify(b.messages.slice(0, 3));
    expect(t).toContain("<command-args>The parser drops the last row");
    expect(t).toContain("cwd " + FROZEN_FIELDS.cwd);
    expect(ccCount(b)).toBe(1);
    expect(validateRequest(b, "opus")).toEqual({ ok: true });
    expect(() => buildRequest(input({ splice }))).toThrow();
    expect(() => buildRequest(input({ arm: "current", shape: shape("current") }))).toThrow();
  });
});

describe("validateRequest", () => {
  const good = () => JSON.parse(JSON.stringify(buildRequest(input()).body)) as Body;
  const problem = (b: Body) => {
    const v = validateRequest(b, "opus");
    return v.ok ? "ok" : v.size ? "size" : "problem";
  };
  test("accepts a built request", () => expect(validateRequest(good(), "opus")).toEqual({ ok: true }));
  test("refuses a tool_use with no result and a result with no use", () => {
    const a = good();
    a.messages[2]!.content = [{ type: "text", text: "lost" }];
    expect(problem(a)).toBe("problem");
    const b = good();
    b.messages[1]!.content = b.messages[1]!.content.filter((x) => x.type !== "tool_use");
    expect(problem(b)).toBe("problem");
  });
  test("refuses a thinking block and a thinking field", () => {
    const a = good();
    a.messages[1]!.content.unshift({ type: "thinking", thinking: "hm", signature: "s" });
    expect(problem(a)).toBe("problem");
    const b = good();
    b.thinking = { type: "enabled", budget_tokens: 1024 };
    expect(problem(b)).toBe("problem");
  });
  test("refuses roles that do not alternate, a first assistant message and a last assistant message", () => {
    const a = good();
    a.messages.splice(1, 0, { role: "user", content: [{ type: "text", text: "again" }] });
    expect(problem(a)).toBe("problem");
    const b = good();
    b.messages.shift();
    expect(problem(b)).toBe("problem");
    const c = good();
    c.messages.push({ role: "assistant", content: [{ type: "text", text: "late" }] });
    expect(problem(c)).toBe("problem");
  });
  test("refuses more than 4 breakpoints and a 1h ttl", () => {
    const a = good();
    for (const m of a.messages.slice(0, 5)) m.content[0]!.cache_control = { type: "ephemeral" };
    expect(problem(a)).toBe("problem");
    const b = good();
    b.messages[0]!.content[0]!.cache_control = { type: "ephemeral", ttl: "1h" };
    expect(problem(b)).toBe("problem");
  });
  test("size only when the window check alone fails", () => {
    const big = "x".repeat(3 * WINDOWS.opus + 30);
    const a = good();
    a.messages[0]!.content[0]!.text = big;
    expect(validateRequest(a, "opus")).toMatchObject({ ok: false, size: true, window: WINDOWS.opus });
    a.messages.push({ role: "assistant", content: [{ type: "text", text: "late" }] });
    expect(problem(a)).toBe("problem");
  });
  test("windows come from OpenRouter's models API for each model", () => {
    expect(WINDOWS).toEqual({ opus: 1_000_000, sol: 1_050_000, particle: 1_048_576 });
  });
});
