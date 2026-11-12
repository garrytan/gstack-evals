// Value: protects=the founder wiring (prereg section 4): the frozen prompt byte for byte, the sheet loader, the visible transcript, and the Argon call's settings, cache, allowance and strict Vertex check through the real metered client.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openMeter } from "../../../lanes/product-value/meter.ts";
import { PREREG, SEED } from "../../../lanes/office-hours-founder/frozen.ts";
import { FOUNDER_RULES, founderCall, founderTurn, loadFounder, visibleTranscript, worstCase } from "../../../lanes/office-hours-founder/sim/founder.ts";
import { answer, FIXTURE_SHEET, FIXTURE_TRANSCRIPT } from "../../../lanes/office-hours-founder/sim/seams.ts";
import { ENV, ledgerWith, tmp } from "../../pv/fixtures.ts";

describe("the frozen founder prompt", () => {
  test("FOUNDER_RULES is section 4's blockquote, byte for byte", () => {
    const quoted = FOUNDER_RULES.split("\n").map((l) => (l ? "> " + l : ">")).join("\n");
    expect(readFileSync(PREREG, "utf8")).toContain("\n" + quoted + "\n");
    expect(FOUNDER_RULES.startsWith("You are playing a startup founder")).toBe(true);
    expect(FOUNDER_RULES.endsWith("and no other.")).toBe(true);
  });
});

describe("loader and transcript", () => {
  test("loadFounder keeps each fact's id, text and reveal_when, and trims the opening", () => {
    const dir = tmp();
    writeFileSync(join(dir, "sheet.json"), JSON.stringify({ persona: "p", facts: [{ id: "f1", text: "t", reveal_when: "w", kind: "payment" }] }));
    writeFileSync(join(dir, "opening.md"), "\nHello.\n");
    expect(loadFounder(dir)).toEqual({ rules: FOUNDER_RULES, persona: "p", opening: "Hello.", items: [{ id: "f1", text: "t", reveal_when: "w" }] });
    expect(loadFounder(dir, "repaired").rules).toBe("repaired");
  });
  test("each reply's texts join with blank lines, and founder replies follow the message they answered", () => {
    const turn = { turn: 1, reply: "r1", revealed: [], rules: [], attempts: 1 };
    expect(visibleTranscript([["a", "b"], ["c"]], [turn])).toEqual([{ role: "assistant", text: "a\n\nb" }, { role: "person", text: "r1" }, { role: "assistant", text: "c" }]);
    expect(() => visibleTranscript([["a"]], [turn])).toThrow("E_USAGE");
  });
});

describe("founderCall through the metered client", () => {
  const upstream = (provider: string, bodies: any[], status = 200) =>
    (async (_url: any, init?: any) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (status !== 200) return Response.json({ error: { message: "down" } }, { status });
      return Response.json({ id: "gen-1", model: "google/gemini-4-argon-20261013", provider, choices: [{ message: { role: "assistant", content: answer("Two services pay me.") } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } });
    }) as typeof fetch;
  const meterWith = async (fetch: typeof fetch) => {
    const dir = tmp();
    mkdirSync(join(dir, "out"));
    const { record, ledger } = ledgerWith(dir, ["of-sim"]);
    return openMeter({ item: "of-sim", runId: "r1", out: join(dir, "out"), cacheDir: join(dir, "cache"), maxOutputTokens: 1200, record, ledger, env: ENV, fetch });
  };

  test("sends section 4's settings, caches by request digest and counts the session's spend", async () => {
    const bodies: any[] = [];
    const meter = await meterWith(upstream("Google", bodies));
    const session = { allowance_micros: 2_000_000, spent_micros: 0 };
    const call = founderCall({ meter, session, label: "u1-none-1" });
    const t = await founderTurn({ sheet: FIXTURE_SHEET, transcript: FIXTURE_TRANSCRIPT, call });
    expect(t).toMatchObject({ kind: "reply", reply: "Two services pay me.", revealed: ["f1"], attempts: 1 });
    const b = bodies[0];
    expect(b).toMatchObject({ model: "google/gemini-4-argon", max_tokens: 1200, reasoning: { effort: "medium" }, temperature: 0, seed: SEED });
    expect(b.seed).toBe(20261109);
    expect(b.messages[0]).toEqual({ role: "system", content: expect.stringContaining(FOUNDER_RULES + "\n\nThe sheet:\n") });
    expect(b.messages.slice(1)).toEqual([{ role: "user", content: FIXTURE_TRANSCRIPT[0]!.text }]);
    expect(session.spent_micros).toBeGreaterThan(0);
    const spent = session.spent_micros;
    expect(await founderTurn({ sheet: FIXTURE_SHEET, transcript: FIXTURE_TRANSCRIPT, call })).toMatchObject({ kind: "reply" });
    expect(bodies).toHaveLength(1);
    expect(session.spent_micros).toBe(spent);
    await meter.close();
  });

  test("a reply served by Google AI Studio, or by a name the meter's pin refuses, is a drift", async () => {
    for (const provider of ["Google AI Studio", "Mistral"]) {
      const meter = await meterWith(upstream(provider, []));
      const t = await founderTurn({ sheet: FIXTURE_SHEET, transcript: FIXTURE_TRANSCRIPT, call: founderCall({ meter, session: { allowance_micros: 2_000_000, spent_micros: 0 }, label: "u1" }) });
      expect(t).toMatchObject({ kind: "call-failed", reason: "drift", detail: expect.stringMatching(/^E_OF_PROVIDER_DRIFT /) });
      await meter.close();
    }
  });

  test("an upstream failure is a provider failure, and the allowance refuses before any request", async () => {
    const bodies: any[] = [];
    const meter = await meterWith(upstream("Google", bodies, 400));
    expect(await founderTurn({ sheet: FIXTURE_SHEET, transcript: FIXTURE_TRANSCRIPT, call: founderCall({ meter, session: { allowance_micros: 2_000_000, spent_micros: 0 }, label: "u1" }) })).toMatchObject({ kind: "call-failed", reason: "provider" });
    const sent = bodies.length;
    const req = { system: "x", messages: [{ role: "user" as const, content: "q" }] };
    expect(await founderCall({ meter, session: { allowance_micros: worstCase(req) - 1, spent_micros: 0 }, label: "u1" })(req)).toMatchObject({ kind: "call-failed", reason: "allowance" });
    expect(bodies).toHaveLength(sent);
    await meter.close();
  });
});
