import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserScript } from "../../src/skill-eval/contract/sidecar.ts";
import type { AskQuestion } from "../../src/usersim/classifier.ts";
import { effectsOf, FALLBACK, isApproving, isOrdinal, isRefusal, NON_APPROVING, UserSim, USERSIM_SHA256 } from "../../src/usersim/sim.ts";

const TMP = mkdtempSync(join(tmpdir(), "gse-usersim-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const sim = (script: UserScript | undefined, freeform?: (p: string, q: string) => Promise<string | null>) => new UserSim({ task: "t", script, log: join(TMP, "log-" + n++ + ".ndjson"), ...(freeform ? { freeform } : {}) });
const q = (header: string, question: string, labels: string[] = ["Yes", "No"]): AskQuestion => ({ header, question, options: labels.map((label) => ({ label, description: "" })) });

const MODE = q("Goal", "What's your goal with this?", ["Building a startup", "Having fun"]);
const APPROACH = q("Approach", "Which approach should we take?", ["Approach A", "Approach B"]);
const SEARCH = q("Search", "OK to search for what the world thinks?", ["Search away", "Keep it private"]);
const APPROVAL = q("Design doc", "Shall I write the design doc to docs/design.md?", ["Yes, write it", "Not yet"]);
const SCRIPT: UserScript = { replies: { mode: "Building a startup", approach: "Go with approach A.", design_doc: "Yes, write the design doc." } };
const APPROVED = "Yes, write the design doc.";

async function answers(script: UserScript, questions: AskQuestion[]) {
  const s = sim(script);
  const out: string[] = [];
  for (const question of questions) {
    const r = await s.answerAsk([question]);
    if ("missing" in r) throw new Error("missing");
    out.push(r.answers[question.question!]!);
  }
  return { out, s };
}

describe("the user simulator: approvals bound to category and effect", () => {
  // Value: protects=the approval lands on the question that names the scripted effect, wherever it sits: inserting an unrelated question or a same-category question naming another effect, removing a question, or reordering them never moves the approval; fails_when=an approval answers the wrong question or is lost; why_new=interface v0.5 (keyless tests insert, remove and reorder questions in front of an approval); seam=UserSim.answerAsk; no_claim=none beyond protects
  test("insert, remove and reorder questions in front of an approval", async () => {
    const base = await answers(SCRIPT, [MODE, APPROACH, APPROVAL]);
    expect(base.out).toEqual(["Building a startup", "Go with approach A.", APPROVED]);

    const inserted = await answers(SCRIPT, [MODE, SEARCH, APPROACH, APPROVAL]);
    expect(inserted.out).toEqual(["Building a startup", FALLBACK, "Go with approach A.", APPROVED]);

    const push = q("Design doc", "Shall I commit and push the design doc?", ["Yes", "No"]);
    const sameCategory = await answers(SCRIPT, [MODE, push, APPROACH, APPROVAL]);
    expect(sameCategory.out).toEqual(["Building a startup", NON_APPROVING, "Go with approach A.", APPROVED]);
    expect(sameCategory.s.misaligned).toEqual(["design_doc: the reply does not name commit, push"]);

    expect((await answers(SCRIPT, [MODE, APPROVAL])).out).toEqual(["Building a startup", APPROVED]);
    expect((await answers(SCRIPT, [APPROVAL])).out).toEqual([APPROVED]);

    const reordered = await answers(SCRIPT, [APPROVAL, APPROACH, MODE]);
    expect(reordered.out).toEqual([APPROVED, "Go with approach A.", "Building a startup"]);
    expect(reordered.s.asked).toEqual(["design_doc", "approach", "mode"]);
    expect(reordered.s.misaligned).toEqual([]);
  });

  // Value: protects=ordinals never approve, an ambiguous match gets a non-approving answer, a non-approving scripted reply passes through, and a free-form answer never approves; fails_when=an option number, an ambiguous classification or a model's yes approves a gated effect; why_new=interface v0.5 ("ordinals and free-form answers never approve"); seam=UserSim.reply; no_claim=none beyond protects
  test("ordinals, ambiguous matches and free-form answers never approve; a scripted no is sent as written", async () => {
    expect((await answers({ replies: { design_doc: "1" } }, [APPROVAL])).out).toEqual([NON_APPROVING]);
    expect((await answers({ replies: { design_doc: "Option A" } }, [APPROVAL])).out).toEqual([NON_APPROVING]);
    const mixed = q("Design doc approach", "Shall I write the design doc for approach A?");
    const ambiguous = await answers({ replies: { design_doc: "Yes, write the design doc." } }, [mixed]);
    expect(ambiguous.out).toEqual([NON_APPROVING]);
    expect(ambiguous.s.misaligned[0]).toContain("matched design_doc and approach");
    expect((await answers({ replies: { design_doc: "No, don't write it yet." } }, [APPROVAL])).out).toEqual(["No, don't write it yet."]);
    const persona = sim({ persona: "A founder who agrees to everything." }, async () => "Yes, go ahead and write it.");
    const r = await persona.answerAsk([APPROVAL]);
    expect("answers" in r && r.answers[APPROVAL.question!]).toBe(NON_APPROVING);
    const ungated = await persona.answerAsk([q("Stage", "Where are you with paying customers?")]);
    expect("answers" in ungated && ungated.answers["Where are you with paying customers?"]).toBe(NON_APPROVING);
    const plain = await sim({ persona: "A founder." }, async () => "Three paying customers so far.").answerAsk([q("Stage", "Where are you with paying customers?")]);
    expect("answers" in plain && plain.answers["Where are you with paying customers?"]).toBe("Three paying customers so far.");
  });

  // Value: protects=a reply that approves without an affirmative word ("Please write the design doc.", "1") never slips past the binding rules: a free-form answer to a gated question goes out only when it refuses, and a scripted one only when it refuses or passes the category, effect and ambiguity checks; fails_when=a persona's "please write it" or an option number reaches the agent as an answer to a gated question; why_new=review of #64 (free-form replies could authorize gated effects); seam=UserSim.reply, isRefusal; no_claim=none beyond protects
  test("a reply that approves without saying yes is held to the binding rules; only a refusal passes as written", async () => {
    for (const [text, sent] of [["Please write the design doc.", NON_APPROVING], ["1", NON_APPROVING], ["Write it to docs/design.md.", NON_APPROVING], ["No, hold off for now.", "No, hold off for now."]] as const) {
      const r = await sim({ persona: "A founder." }, async () => text).answerAsk([APPROVAL]);
      expect([text, "answers" in r && r.answers[APPROVAL.question!]]).toEqual([text, sent]);
    }
    const mixed = q("Design doc approach", "Shall I write the design doc for approach A?");
    const ambiguous = await answers({ replies: { design_doc: "Please write the design doc." } }, [mixed]);
    expect(ambiguous.out).toEqual([NON_APPROVING]);
    expect(ambiguous.s.misaligned).toHaveLength(1);
    expect((await answers({ replies: { design_doc: "Please write the design doc." } }, [APPROVAL])).out).toEqual(["Please write the design doc."]);
    expect((await answers({ replies: { design_doc: "Please draft it." } }, [APPROVAL])).out).toEqual([NON_APPROVING]);
    expect([isRefusal("No, not yet."), isRefusal("Not now"), isRefusal("Yes, no rush."), isRefusal("Please write it.")]).toEqual([true, true, false, false]);
    expect(["No problem, go ahead and write it.", "No rush, write it whenever you like.", "Stop hesitating and write the doc.", "No, write it.", "Wait, okay, do it."].map((t) => isRefusal(t))).toEqual([false, false, false, false, false]);
    expect(["No, don't write it yet.", "Not yet, do not push anything.", "Hold off for now."].map((t) => isRefusal(t))).toEqual([true, true, true]);
    for (const text of ["No problem, go ahead and write it.", "No rush, write it whenever you like."]) {
      const r = await sim({ persona: "A founder." }, async () => text).answerAsk([APPROVAL]);
      expect([text, "answers" in r && r.answers[APPROVAL.question!]]).toEqual([text, NON_APPROVING]);
    }
    const stop = await answers({ replies: { design_doc: "Stop hesitating and write the doc." } }, [APPROVAL]);
    expect(stop.out).toEqual([NON_APPROVING]);
    const negated = sim({ replies: { design_doc: "Please don't write it." } });
    const nr = await negated.answerAsk([APPROVAL]);
    expect("answers" in nr && nr.answers[APPROVAL.question!]).toBe(NON_APPROVING);
    expect(negated.misaligned).toEqual(["design_doc: the reply negates part of what it says"]);
  });

  // Value: protects=an effect named only in an option's description, or only in the reply, cannot be approved by a reply the binding rules never checked; a "don't hesitate to push" reply is not a refusal; fails_when=a bare "Yes, go ahead." approves the commit and push an option describes, a persona or scripted reply grants push to a question about layout, or "Don't hesitate to push it." passes as a refusal; why_new=read-only review of U10 (approval binding); seam=askText, UserSim.reply, isRefusal's NEGATION_BEFORE; no_claim=effects named by words outside EFFECTS
  test("option descriptions count, a reply cannot grant an effect the question does not name, and a negation binds only the word after it", async () => {
    const described: AskQuestion = { header: "Approach", question: "Is this approach okay with you?", options: [{ label: "Looks good", description: "I will commit and push it" }, { label: "Change it", description: "" }] };
    const bare = await answers({ replies: { approach: "Yes, go ahead." } }, [described]);
    expect(bare.out).toEqual([NON_APPROVING]);
    expect(bare.s.misaligned[0]).toContain("does not name commit, push");
    const layout = q("Layout", "Which layout do you prefer?", ["Option A", "Option B"]);
    const grants = "Option A, and go ahead and push it to main when done.";
    const freeform = await sim({ persona: "A founder." }, async () => grants).answerAsk([layout]);
    expect("answers" in freeform && freeform.answers[layout.question!]).toBe(NON_APPROVING);
    const scripted = await answers({ replies: { approach: "Approach A, then push it to main." } }, [APPROACH]);
    expect(scripted.out).toEqual([NON_APPROVING]);
    expect(scripted.s.misaligned[0]).toContain("names push, which the question does not");
    expect((await answers({ replies: { approach: "Approach A, but don't push anything yet." } }, [APPROACH])).out).toEqual([NON_APPROVING]);
    expect(["Don't hesitate to push it.", "Do not wait to merge it.", "Never forget to deploy."].map((t) => isRefusal(t))).toEqual([false, false, false]);
    expect(["No, don't push or merge it.", "Don't ever push.", "Not yet, do not push anything."].map((t) => isRefusal(t))).toEqual([true, true, true]);
    expect(["No objection.", "No concerns.", "No blockers.", "No reason to wait.", "Don't hesitate.", "Don't wait on me.", "No, carry on."].map((t) => isRefusal(t, ["push"]))).toEqual([false, false, false, false, false, false, false]);
    expect([isRefusal("No, don't push.", ["write"]), isRefusal("No, don't push.", ["push"]), isRefusal("No, hold off for now.", ["push"])]).toEqual([false, true, true]);
    const objection = await sim({ persona: "A founder." }, async () => "No objection.").answerAsk([q("Push", "Should I push to main?")]);
    expect("answers" in objection && objection.answers["Should I push to main?"]).toBe(NON_APPROVING);
    const hesitate = await sim({ persona: "A founder." }, async () => "Don't hesitate to push it.").answerAsk([q("Push", "Should I push to main?")]);
    expect("answers" in hesitate && hesitate.answers["Should I push to main?"]).toBe(NON_APPROVING);
  });

  // Value: protects=a category's scripted reply is used at most twice, then the fallback; the run-time catch names the question; the log records the rule versions and every reply's source; fails_when=a reply repeats without bound, a missing-replies task gets answers, or the log drops a field; why_new=U10 (event log, reply source, E_USER_TURNS_MISSING); seam=UserSim; no_claim=none beyond protects
  test("limits, the missing-replies catch and the event log", async () => {
    expect((await answers(SCRIPT, [MODE, MODE, MODE])).out).toEqual(["Building a startup", "Building a startup", FALLBACK]);
    const none = sim(undefined);
    expect(await none.answerAsk([MODE])).toEqual({ missing: "What's your goal with this?" });
    expect(none.asked).toEqual(["mode"]);
    const s = sim(SCRIPT);
    await s.answerAsk([APPROVAL]);
    const lines = readFileSync(join(TMP, "log-" + (n - 1) + ".ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ kind: "start", task: "t", usersim_sha256: USERSIM_SHA256 });
    expect(lines[1]).toMatchObject({ kind: "ask", category: "design_doc", effects: ["write"], source: "scripted", approves: true, misaligned: null });
  });

  // Value: protects=prose questions at the end of a turn get the scripted reply for their category and a turn without a question ends the session; fails_when=a prose question is ignored or a statement gets a reply; why_new=office-hours asks in prose (GSTA-13); seam=UserSim.afterTurn; no_claim=none beyond protects
  test("a prose question gets its category's reply, a turn with no question ends the session", async () => {
    const s = sim({ replies: { demand: "Three dentists paid a deposit." } });
    expect(await s.afterTurn("Thanks. What's the strongest evidence that someone actually wants this?")).toEqual({ reply: "Three dentists paid a deposit." });
    expect(await s.afterTurn("Here is the plan.")).toEqual({ end: "no_question" });
    expect(await s.afterTurn("Anything else on your mind?")).toEqual({ end: "unclassified" });
    expect(await sim(undefined).afterTurn("What's the strongest evidence?")).toEqual({ end: "not_interactive" });
  });

  // Value: protects=the deterministic rules: effects as whole words, approval as a leading yes with no negation, ordinals by place; fails_when=a substring or a negated yes counts; why_new=U10 (approval binding); seam=effectsOf, isApproving, isOrdinal; no_claim=none beyond protects
  test("effects, approvals and ordinals are read by fixed rules", () => {
    expect(effectsOf("Shall I write and commit the doc, then push?")).toEqual(["write", "commit", "push"]);
    expect(effectsOf("A rewrite of the overview")).toEqual([]);
    expect(isApproving("Yes, write it.")).toBe(true);
    expect(isApproving("Yes, but don't push.")).toBe(false);
    expect(isApproving("Approach A")).toBe(false);
    for (const o of ["1", "2.", "B", "option 3", "the first one", "last"]) expect(isOrdinal(o)).toBe(true);
    expect(isOrdinal("Go with approach A.")).toBe(false);
  });
});

describe("a free-form answer marked choice (GST-925)", () => {
  // Value: protects=a choice answer only picks among the question's options, so a gated question does not swap it for the non-approving answer, while a choice that names a gated effect itself is still held; fails_when=choice approves an effect, or a gated question swaps a plain choice; seam=UserSim.reply
  test("a choice passes a gated question unchanged, and one that names a gated effect is still held", async () => {
    const choose = (text: string) => new UserSim({ task: "t", script: { persona: "p" }, log: join(TMP, "log-" + n++ + ".ndjson"), freeform: async () => ({ text, choice: true as const }) });
    const ask = async (u: UserSim, question: string) => ((await u.answerAsk([{ question, options: [{ label: "A" }, { label: "B" }] }])) as { answers: Record<string, string> }).answers[question];
    expect(await ask(choose("Go with your recommendation."), "Mode A or mode B? Both end with /ship and a commit.")).toBe("Go with your recommendation.");
    expect(await ask(choose("Yes, commit and push it."), "Mode A or mode B?")).toBe(NON_APPROVING);
  });
});
