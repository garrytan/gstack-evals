// Value: protects=gate 3's two requests carry the advisory, fix and BIC diff to Opus 5.5 and GPT-6.2 Astra, replies are read
// to yes, no, refused, truncated or malformed, a malformed reply gets one retry, a non-200 reply settles nothing, a resumed
// send pays for nothing twice, and a unit passes only when both say yes; fails_when=a refusal or a cut-off reply reads as
// yes, or a settled request is resent; why_new=GEVA-590 section 2 gate 3; seam=visRequests, verdictOf, sendVisibility,
// readVisibility with stub replies; no_claim=the paid send through the metering proxy, which needs keys
import { describe, expect, test } from "bun:test";
import { parseAnswer, readVisibility, sendVisibility, verdictOf, visRequests, type VisReply } from "../../../../src/trial/review/supply/visibility.ts";

const material = { ghsa: "GHSA-aaaa-bbbb-cccc", summary: "Path traversal in upload", details: "Details here.", fix_diff: "diff --git a/x b/x\n-bad\n+good\n", bic_diff: "diff --git a/x b/x\n+bad\n" };
const anth = (text: string, stop = "end_turn") => ({ content: [{ type: "text", text }], stop_reason: stop });
const oai = (text: string, extra: Record<string, unknown> = {}) => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }], ...extra });

describe("requests", () => {
  test("one per model with the same prompt", () => {
    const [opus, astra] = visRequests("o/r#0@abc", material);
    expect(opus).toMatchObject({ ghsa: material.ghsa, unit: "o/r#0@abc", model: "opus", provider: "anthropic", route: "/v1/messages", body: { model: "claude-opus-5-5", max_tokens: 16000 } });
    expect(astra).toMatchObject({ model: "astra", provider: "openai", route: "/v1/responses", body: { model: "gpt-6.2-astra", store: false, max_output_tokens: 16000 } });
    expect(opus!.prompt_sha256).toBe(astra!.prompt_sha256);
    const prompt = (opus!.body.messages as any)[0].content as string;
    for (const s of ["read-only correctness review", material.ghsa, "Path traversal in upload", "-bad", "+bad", "ANSWER: YES or ANSWER: NO"]) expect(prompt).toContain(s);
  });
});

describe("replies", () => {
  test("the last answer line decides, refusals and cut-offs are their own verdicts", () => {
    expect(parseAnswer("I think so.\nANSWER: NO\nwait\n**ANSWER: YES**")).toBe("yes");
    expect(parseAnswer("the answer: yes")).toBeNull();
    expect(verdictOf("anthropic", 200, anth("Because.\nANSWER: YES"))).toBe("yes");
    expect(verdictOf("anthropic", 200, anth("", "refusal"))).toBe("refused");
    expect(verdictOf("anthropic", 200, anth("Because", "max_tokens"))).toBe("truncated");
    expect(verdictOf("openai", 200, oai("ANSWER: NO"))).toBe("no");
    expect(verdictOf("openai", 200, oai("partial", { incomplete_details: { reason: "max_output_tokens" } }))).toBe("truncated");
    expect(verdictOf("openai", 200, { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })).toBe("refused");
    expect(verdictOf("openai", 200, oai("maybe"))).toBe("malformed");
    expect(verdictOf("openai", 500, null)).toBe("error");
  });

  test("send retries a malformed reply once, asks again after an error, and resumes without resending", async () => {
    const reqs = visRequests("u", material);
    const queue: Record<string, Array<{ status: number; body: unknown }>> = {
      anthropic: [{ status: 200, body: anth("hmm") }, { status: 200, body: anth("ANSWER: YES") }],
      openai: [{ status: 503, body: null }, { status: 200, body: oai("ANSWER: YES") }],
    };
    const seen: string[] = [];
    const record: VisReply[] = [];
    const sent = await sendVisibility(reqs, [], async (q) => (seen.push(q.provider + " " + q.attempt), queue[q.provider]!.shift()!), (r) => record.push(r));
    expect(sent).toBe(4);
    expect(seen).toEqual(["anthropic 1", "anthropic 2", "openai 1", "openai 1"]);
    expect(await sendVisibility(reqs, record, async () => {
      throw new Error("must not send");
    }, () => {})).toBe(0);
    expect(readVisibility(reqs, record)).toEqual({ [material.ghsa]: { unit: "u", verdicts: { opus: "yes", astra: "yes" }, g3: "ok" } });
  });

  test("gate 3 fails unless both say yes and is pending while a model has no settled reply", () => {
    const reqs = visRequests("u", material);
    const r = (model: "opus" | "astra", body: unknown, attempt = 1, status = 200): VisReply => ({ ghsa: material.ghsa, model, attempt, status, body });
    expect(readVisibility(reqs, [r("opus", anth("ANSWER: YES")), r("astra", oai("ANSWER: NO"))])[material.ghsa]!.g3).toEqual({ fail: "astra no" });
    expect(readVisibility(reqs, [r("opus", anth("ANSWER: YES")), r("astra", oai("x")), r("astra", oai("y"), 2)])[material.ghsa]!.g3).toEqual({ fail: "astra malformed" });
    expect(readVisibility(reqs, [r("opus", anth("ANSWER: YES")), r("astra", oai("x"))])[material.ghsa]!.g3).toBeUndefined();
    expect(readVisibility(reqs, [r("opus", anth("ANSWER: YES")), r("astra", null, 1, 500)])[material.ghsa]!.g3).toBeUndefined();
    expect(readVisibility(reqs, [r("opus", anth("", "refusal")), r("astra", oai("ANSWER: YES"))])[material.ghsa]!.g3).toEqual({ fail: "opus refused" });
  });
});
