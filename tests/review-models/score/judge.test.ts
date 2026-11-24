import { describe, expect, test } from "bun:test";
import { carbonRequest, CARBON_ROUTE, fence, isBlocking, judgePrompt, judgeReview, normaliseText, numberedFindings, parseJudgeReply, type Bug, type ReviewFinding } from "../../../lanes/review-models/score/judge.ts";

const bug: Bug = { unit: "acme/app#12", pool: "P", evidence: "The retry loop never stops when the server answers 429.", fix_diff: "--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -10,3 +10,4 @@\n while (true) {\n-  await send();\n+  if (await send() === 429) break;\n }\n" };
const f = (id: string, over: Partial<ReviewFinding> = {}): ReviewFinding => ({ id, source: "native", severity: "MEDIUM", path: "src/retry.ts", line: 11, text: "The loop does not stop on 429.", ...over });
const reply = (content: string, finish = "stop") => ({ status: 200, body: { choices: [{ finish_reason: finish, message: { content } }] } });
const json = (rulings: unknown[]) => "```json\n" + JSON.stringify({ rulings }) + "\n```";

describe("gstack's blocking rule at the pin", () => {
  test("Critical, High, P0, P1 and Blocks: yes block; the rest do not", () => {
    for (const s of ["CRITICAL", "Critical (confidence 9/10)", "high", "[P0]", "P1", "p1: race"]) expect(isBlocking(f("a", { severity: s }))).toBe(true);
    for (const s of ["MEDIUM", "LOW", "P2", "informational", "nit"]) expect(isBlocking(f("a", { severity: s }))).toBe(false);
    expect(isBlocking(f("a", { severity: "MEDIUM", text: "Blocks: yes. The loop spins." }))).toBe(true);
    expect(isBlocking(f("a", { severity: "MEDIUM", blocks: true }))).toBe(true);
    expect(isBlocking(f("a", { severity: "LOW", text: "Blocks: no" }))).toBe(false);
  });
});

describe("normalised findings", () => {
  test("voice headers, model names and severity words are removed", () => {
    const t = normaliseText("[Codex] CODEX SAYS (adversarial challenge): P1 HIGH: gpt-6.2-astra and Claude Opus agree the loop spins. Blocks: yes");
    expect(t).toBe("[severity] [severity]: [model] and [model] [model] agree the loop spins.");
    expect(normaliseText("Outside voice: Sol thinks the retry never ends")).toBe("[model] thinks the retry never ends");
    expect(normaliseText("The high bit is masked")).toBe("The high bit is masked");
  });
  test("the list shows one severity set and no source", () => {
    const list = numberedFindings([f("a", { severity: "P1" }), f("b", { source: "voice", severity: "LOW", path: null, line: null, text: "[codex] vague" })]);
    expect(list).toBe("1. [blocking] src/retry.ts:11\n   The loop does not stop on 429.\n2. [non-blocking] (no file cited)\n   vague");
    expect(list).not.toMatch(/voice|native|codex/i);
    expect(() => numberedFindings([f("a"), f("a")])).toThrow(/^E_RM_JUDGE/);
  });
  test("the prompt carries the evidence, the fix in a fence longer than any in it, and the findings", () => {
    const p = judgePrompt({ ...bug, fix_diff: bug.fix_diff + "+// ````\n" }, [f("a")]);
    expect(p).toContain(bug.evidence);
    expect(p).toContain("`````diff\n--- a/src/retry.ts");
    expect(p).toContain("1. [non-blocking] src/retry.ts:11");
    expect(p).toContain('"cant_tell"');
    expect(fence("no ticks")).toBe("```");
  });
});

describe("Carbon's request", () => {
  test("OpenRouter, google-vertex only, no fallbacks, data collection denied, default effort and no output cap", () => {
    const body = carbonRequest("hello") as Record<string, any>;
    expect(CARBON_ROUTE).toBe("/v1/chat/completions");
    expect(body.model).toBe("google/gemini-4-carbon");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.provider).toMatchObject({ only: ["google-vertex"], allow_fallbacks: false, data_collection: "deny" });
    expect(body.provider.max_price.prompt).toBeGreaterThan(0);
    expect(body.reasoning).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });
});

describe("the reply parser", () => {
  test("one ruling per finding, each exactly once", () => {
    const ok = parseJudgeReply("thinking\n" + json([{ finding: 2, ruling: "doesnt" }, { finding: 1, ruling: "names", reason: "same loop" }]), 2);
    expect(ok).toEqual({ kind: "ok", value: [{ ruling: "names", reason: "same loop" }, { ruling: "doesnt", reason: "" }] });
    expect(parseJudgeReply("", 1)).toEqual({ kind: "empty" });
    expect(parseJudgeReply("   \n", 1).kind).toBe("empty");
    expect(parseJudgeReply("no json here", 1).kind).toBe("malformed");
    expect(parseJudgeReply(json([{ finding: 1, ruling: "names" }]), 2)).toEqual({ kind: "malformed", reason: "no ruling for finding 2" });
    expect(parseJudgeReply(json([{ finding: 1, ruling: "names" }, { finding: 1, ruling: "doesnt" }]), 1).kind).toBe("malformed");
    expect(parseJudgeReply(json([{ finding: 3, ruling: "names" }]), 2).kind).toBe("malformed");
    expect(parseJudgeReply(json([{ finding: 1, ruling: "maybe" }]), 1).kind).toBe("malformed");
    expect(parseJudgeReply(JSON.stringify({ rulings: [{ finding: 1, ruling: "cant_tell" }] }), 1).kind).toBe("ok");
  });
});

describe("one call per review, retried once", () => {
  const stub = (replies: Array<{ status: number; body: unknown }>) => {
    const sent: Array<{ body: unknown; attempt: number }> = [];
    return { sent, send: async (body: Record<string, unknown>, attempt: number) => (sent.push({ body, attempt }), replies[attempt - 1]!) };
  };
  test("a good first reply rules every finding", async () => {
    const s = stub([reply(json([{ finding: 1, ruling: "names" }, { finding: 2, ruling: "cant_tell" }]))]);
    const j = await judgeReview(bug, [f("a"), f("b")], s.send);
    expect(j).toMatchObject({ rulings: { a: "names", b: "cant_tell" }, attempts: 1, failures: [], failed: false });
    expect(s.sent.map((x) => x.attempt)).toEqual([1]);
  });
  test("an empty reply is sent again as attempt 2 with the same body", async () => {
    const s = stub([reply(""), reply(json([{ finding: 1, ruling: "doesnt" }]))]);
    const j = await judgeReview(bug, [f("a")], s.send);
    expect(j).toMatchObject({ rulings: { a: "doesnt" }, attempts: 2, failures: ["empty"], failed: false });
    expect(s.sent[1]!.body).toEqual(s.sent[0]!.body);
  });
  test("two failed replies rule every finding can't tell", async () => {
    const cut = await judgeReview(bug, [f("a"), f("b")], stub([reply(json([{ finding: 1, ruling: "names" }]), "length"), reply("", "length")]).send);
    expect(cut).toMatchObject({ rulings: { a: "cant_tell", b: "cant_tell" }, attempts: 2, failures: ["cut off", "cut off"], failed: true });
    const mixed = await judgeReview(bug, [f("a")], stub([reply("prose"), reply("", "content_filter")]).send);
    expect(mixed.failures).toEqual(["malformed: the reply holds no JSON block that parses", "refused"]);
    expect(mixed.failed).toBe(true);
  });
  test("no findings means no call; a transport failure refuses", async () => {
    const s = stub([]);
    expect(await judgeReview(bug, [], s.send)).toMatchObject({ rulings: {}, attempts: 0, failed: false });
    expect(s.sent).toHaveLength(0);
    await expect(judgeReview(bug, [f("a")], stub([{ status: 502, body: {} }]).send)).rejects.toThrow(/^E_RM_JUDGE .*HTTP 502/);
  });
});
