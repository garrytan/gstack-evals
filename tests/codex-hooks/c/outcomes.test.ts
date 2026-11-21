import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { outcome, type SessionInput } from "../../../lanes/codex-hooks/c/outcomes.ts";
import { readSessionRollouts, type SessionRollouts } from "../../../lanes/codex-hooks/c/rollout.ts";

const FIX = join(import.meta.dir, "fixtures");
const rollouts = (name: string) => readSessionRollouts(join(FIX, name, "host"));
const req = (model: string | null, effort: string | null, meter = "m1") => ({ kind: "request", reservation_id: "r-" + Math.random(), cell: { meter_id: meter }, ...(model === null ? {} : { model }), ...(effort === null ? { fields: { reasoning: null } } : { fields: { reasoning: { effort } } }) });
const input = (o: Partial<SessionInput> & { rollouts: SessionRollouts }): SessionInput => ({ cell: { model: "gpt-6.1-sol", arm: "c-on", unit: "u", pass: 1 }, attempt: 1, termination: { kind: "completed" }, allowance_stops: 0, meter_id: "m1", journal: [req("gpt-6.1-sol", "low"), req("gpt-6.1-sol", "low")], ...o });
const withTurns = (r: SessionRollouts, model: string, version = "0.170.0"): SessionRollouts => ({ ...r, root: { ...r.root!, cli_version: version, turns: [{ model, effort: "low" }] } });

describe("part C's session outcomes (preregistration section 5.8, section 2's effort check, pre-run change 1, section 10)", () => {
  // Value: protects=a completed session with a response, a copied rollout, gpt-6.1-sol on Codex 0.170.0 in its turns and its journal, and every request at the arm's effort is scored; fails_when=a clean session reads as anything else; why_new=GEVA-562 part C; seam=outcome; no_claim=what it found
  test("a clean session is scored", () => {
    const row = outcome(input({ rollouts: rollouts("met"), journal: [req("gpt-6.1-sol", "low"), req("gpt-6.1-sol", "low"), req("gpt-6.1-sol", "low")] }));
    expect([row.class, row.scored, row.code, row.rerun, row.gap]).toEqual(["scored", true, null, false, false]);
    expect([row.root_models, row.sub_models, row.journal_models, row.journal_efforts, row.cli_versions, row.requests]).toEqual([["gpt-6.1-sol"], [], ["gpt-6.1-sol"], ["low"], ["0.170.0"], 3]);
    expect(outcome(input({ rollouts: rollouts("block"), cell: { model: "gpt-6.1-sol", arm: "c-high", unit: "u", pass: 1 }, journal: [req("gpt-6.1-sol", "high")] })).class).toBe("scored");
    expect(outcome(input({ rollouts: rollouts("block"), cell: { model: "gpt-6.1-sol", arm: "c-high", unit: "u", pass: 1 } })).reasons).toEqual(["a request ran at effort low, not the arm's high"]);
  });

  // Value: protects=the model and version come from the session's own record: a root thread on another model, a rollout naming another Codex version, a request on a model no thread ran, a request at another effort than the arm's, a request with no effort, or no request in the journal for the meter is an infrastructure gap (E_CODEX_C_DRIFT) that reruns once and is a gap on attempt 2; fails_when=any of these reads as scored, or the check reads the plan instead of the record; why_new=GEVA-562 pre-run change 1, section 10 and section 2's effort rule; seam=outcome; no_claim=why the record drifted
  test("a session whose record breaks the pin is an infrastructure gap", () => {
    const met = rollouts("met");
    const cases: [SessionInput, RegExp][] = [
      [input({ rollouts: withTurns(met, "gpt-6.2-sol") }), /the root thread ran gpt-6.2-sol/],
      [input({ rollouts: withTurns(met, "gpt-6.1-sol", "0.171.0") }), /a rollout names Codex 0.171.0/],
      [input({ rollouts: met, journal: [req("gpt-6.1-sol", "low"), req("gpt-6.2-sol", "low")] }), /a request names gpt-6.2-sol, which no thread's turns ran/],
      [input({ rollouts: met, journal: [req("gpt-6.1-sol", "medium")] }), /a request ran at effort medium, not the arm's low/],
      [input({ rollouts: met, journal: [req("gpt-6.1-sol", null)] }), /a request carries no reasoning effort/],
      [input({ rollouts: met, journal: [req("gpt-6.1-sol", "low", "other")] }), /the journal holds no request for meter m1/],
    ];
    for (const [i, why] of cases) {
      const row = outcome(i);
      expect([row.class, row.code, row.scored, row.rerun]).toEqual(["infra", "E_CODEX_C_DRIFT", false, true]);
      expect(row.reasons.join("; ")).toMatch(why);
      expect(outcome({ ...i, attempt: 2 }).gap).toBe(true);
    }
  });

  // Value: protects=a sub-agent the model starts on another model is listed and its session stays scored when its effort matches, and under section 2's rule as written a sub-agent request at another effort makes the session an infrastructure gap; fails_when=the sub-agent's model gaps the session, or its effort override passes unseen; why_new=GEVA-562 pre-run change 1, section 10; seam=outcome; no_claim=whether section 2 meant sub-agent overrides (a question for the Captain)
  test("a sub-agent on another model", () => {
    const r = rollouts("override");
    const same = outcome(input({ rollouts: r, journal: [req("gpt-6.1-sol", "low"), req("gpt-6.1-sol", "low"), req("gpt-6.2-sol", "low")] }));
    expect([same.class, same.sub_models, same.journal_models]).toEqual(["scored", ["gpt-6.2-sol"], ["gpt-6.1-sol", "gpt-6.2-sol"]]);
    const high = outcome(input({ rollouts: r, journal: [req("gpt-6.1-sol", "low"), req("gpt-6.1-sol", "low"), req("gpt-6.2-sol", "high")] }));
    expect([high.class, high.code, high.reasons]).toEqual(["infra", "E_CODEX_C_DRIFT", ["a request ran at effort high, not the arm's low"]]);
  });

  // Value: protects=section 5.8's other classes: a cap stop never reruns, no rollout or no model response is infrastructure that reruns once, a provider safety stop keeps its class, a time or allowance limit is a limit stop scored on its last message, and a session with no assistant text is its own line; fails_when=a class is swapped, a cap stop reruns, or a safety stop reruns as infrastructure; why_new=GEVA-562 part C; seam=outcome; no_claim=a provider's safety wording beyond the patterns named
  test("cap stops, missing rollouts and responses, safety stops, limit stops and sessions with no text", () => {
    const met = rollouts("met");
    expect(outcome(input({ rollouts: met, termination: { kind: "cap_stop" } }))).toMatchObject({ class: "cap_stop", scored: false, rerun: false, code: "CAP_STOP" });
    expect(outcome(input({ rollouts: { thread_id: "t", root: null, subs: [], problems: ["no rollout was copied"] } }))).toMatchObject({ class: "infra", code: "E_CODEX_C_NO_ROLLOUT", rerun: true });
    const silent = { ...met, root: { ...met.root!, items: met.root!.items.filter((x) => x.kind === "message" && x.role !== "assistant") } };
    expect(outcome(input({ rollouts: silent, termination: { kind: "missing", code: "UPSTREAM" } }))).toMatchObject({ class: "infra", code: "E_CODEX_C_NO_RESPONSE", rerun: true });
    const safety = [...input({ rollouts: met }).journal, { kind: "outcome", meter_id: "m1", status: 400, upstream_body: { error: { code: "cyber_policy" } } }];
    expect(outcome(input({ rollouts: met, journal: safety, termination: { kind: "missing", code: "UPSTREAM" } }))).toMatchObject({ class: "safety", scored: true, rerun: false });
    expect(outcome(input({ rollouts: silent, journal: safety, termination: { kind: "missing", code: "UPSTREAM" } }))).toMatchObject({ class: "safety", scored: false, rerun: false });
    expect(outcome(input({ rollouts: met, termination: { kind: "timeout" } }))).toMatchObject({ class: "limit_stop", scored: true, reasons: ["the session hit its time limit"] });
    expect(outcome(input({ rollouts: met, termination: { kind: "missing", code: "E_ALLOWANCE" } }))).toMatchObject({ class: "limit_stop", scored: true, reasons: ["the session hit its allowance"] });
    expect(outcome(input({ rollouts: met, allowance_stops: 1 }))).toMatchObject({ class: "limit_stop" });
    const blank = { ...met, root: { ...met.root!, items: [...met.root!.items, { kind: "message" as const, line: 999, role: "assistant", text: "  ", refusal: false }] } };
    expect(outcome(input({ rollouts: blank }))).toMatchObject({ class: "no_text", scored: true });
  });
});
