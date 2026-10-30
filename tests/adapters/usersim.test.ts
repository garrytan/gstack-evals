import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserScript } from "../../src/skill-eval/contract/sidecar.ts";
import type { AskQuestion } from "../../src/usersim/classifier.ts";
import { effectsOf, FALLBACK, isApproving, isOrdinal, NON_APPROVING, UserSim, USERSIM_SHA256 } from "../../src/usersim/sim.ts";

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
    expect("answers" in ungated && ungated.answers["Where are you with paying customers?"]).toBe("Yes, go ahead and write it.");
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
