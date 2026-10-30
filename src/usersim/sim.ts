// The scripted user (interface v0.5, "Interactive tasks"). It runs on the evaluator side, outside the agent's container,
// and reaches the agent only through the host's question channel: AskUserQuestion answers (Claude Code's canUseTool) and
// the next user message after a turn that ends in a prose question.
//
// Each question is classified by U5's deterministic classifier (src/usersim/classifier.ts) and answered from the task's
// sidecar replies, keyed by category. A question's effects come from its header, text, option labels and option
// descriptions. A question that names a gated effect (writing, committing, pushing, deleting, running, ...) gets its scripted reply as written only when the reply refuses and grants nothing (isRefusal). Any other
// reply may authorize the effect, so it is sent only when it holds no negation, names every effect the question names,
// is not an ordinal ("2", "option B"), and the classification is unambiguous. Otherwise a fixed non-approving answer goes instead and the reply
// is recorded as misaligned (REPLY_MISALIGNED). So a question inserted, removed or moved in front of an approval cannot
// take the approval meant for another effect, and a reply that approves without saying "yes" is held to the same rules.
// A reply that names a gated effect the question does not name is held back the same way, unless it refuses.
//
// A question with no scripted reply gets the persona's free-form answer when the run has a free-form source, else a
// fixed non-approving fallback. A free-form answer to a gated question, or one that names a gated effect itself, is sent only when it refuses; otherwise the
// non-approving answer goes instead, so a free-form answer never approves a gated effect. An AskUserQuestion in a task that
// declared no user replies is not answered at all: the trial ends as a missing cell (E_USER_TURNS_MISSING) naming the
// task and the question.
//
// Every question, its classification, its effects, the reply and the reply's source go to the event log, one JSON line
// each, and the first line records the classifier's and this file's rule versions.
import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { UserScript } from "../skill-eval/contract/sidecar.ts";
import { CLASSIFIER_SHA256, classifyAsk, classifyProse, proseQuestion, type AskQuestion, type Category, type Classification } from "./classifier.ts";

export const USERSIM_VERSION = 2;

export const LIMITS = { prose_replies: 8, ask_answers: 12, replies_per_category: 2 } as const;

/** Sent instead of an approval the rules do not allow, and as the reply to a question nothing else answers. */
export const NON_APPROVING = "Not yet. Please don't do that until I say so; carry on without it.";
export const FALLBACK = "No strong view on that. Please don't write any files or code yet.";

/** Gated effects and the words that name them, matched as whole words in lowercase text. */
export const EFFECTS: Record<string, readonly string[]> = {
  write: ["write", "writes", "writing", "wrote", "written", "save", "saves", "saving", "saved", "overwrite", "overwriting"],
  create: ["create", "creates", "creating", "created", "scaffold", "scaffolding"],
  edit: ["edit", "edits", "editing", "edited", "modify", "modifying", "apply", "applying"],
  delete: ["delete", "deletes", "deleting", "deleted", "remove", "removing", "rm"],
  commit: ["commit", "commits", "committing", "committed"],
  push: ["push", "pushes", "pushing", "pushed"],
  merge: ["merge", "merges", "merging", "merged"],
  deploy: ["deploy", "deploys", "deploying", "deployed", "release", "releasing", "publish", "publishing", "ship", "shipping"],
  run: ["run", "runs", "running", "execute", "executing", "install", "installing"],
  send: ["send", "sending", "post", "posting", "email", "emailing"],
};

const WORD_TO_EFFECT = new Map(Object.entries(EFFECTS).flatMap(([effect, words]) => words.map((w) => [w, effect] as const)));

/** The gated effects a text names, in EFFECTS order. */
export function effectsOf(text: string): string[] {
  const found = new Set((text.toLowerCase().match(/[a-z]+/g) ?? []).flatMap((w) => (WORD_TO_EFFECT.has(w) ? [WORD_TO_EFFECT.get(w)!] : [])));
  return Object.keys(EFFECTS).filter((e) => found.has(e));
}

const APPROVING = /^(yes|yep|yeah|sure|ok|okay|approve|approved|go ahead|do it|ship it|proceed|lgtm|please do|confirm|confirmed|sounds good)\b/;
const NEGATED = /\b(no|not|don't|do not|never|wait|hold off|stop)\b/;
const ORDINAL = /^(\(?[0-9]+[.)]?|[a-d][.)]?|option [0-9a-d]+|the (first|second|third|fourth|last) (one|option)|(first|second|third|fourth|last))[.!]?$/;
const REFUSING = /^(no|nope|not yet|not now|don't|do not|never|wait|hold off|stop|skip)\b/;
const GRANTING = /\b(yes|yep|yeah|sure|ok|okay|go ahead|go for it|do it|please|proceed|approve|approved|lgtm|sounds good|fine|problem|worries|rush)\b/;
const REFUSAL_ONLY = /^(no|nope|not yet|not now|hold off|wait|stop|skip it|skip|never)(,? (not yet|not now|hold off|no thanks|thanks))*( for now)?[.!]?$/;
const NEGATION_BEFORE = new RegExp("\\b(don't|do not|not|never|without)\\s+((ever|yet)\\s+)?((" + [...WORD_TO_EFFECT.keys()].join("|") + ")\\s+(or|and|nor)\\s+)*$");

/** sha256 over the rules a reply depends on, beside the classifier's: the verdict and the event log record both. */
export const USERSIM_SHA256 = createHash("sha256").update(JSON.stringify({ version: USERSIM_VERSION, limits: LIMITS, non_approving: NON_APPROVING, fallback: FALLBACK, effects: EFFECTS, approving: APPROVING.source, negated: NEGATED.source, ordinal: ORDINAL.source, refusing: REFUSING.source, granting: GRANTING.source, refusal_only: REFUSAL_ONLY.source, negation_before: NEGATION_BEFORE.source, classifier: CLASSIFIER_SHA256 })).digest("hex");

/** A reply that says yes: it starts with an affirmative and holds no negation. */
export const isApproving = (reply: string): boolean => {
  const t = reply.trim().toLowerCase();
  return APPROVING.test(t) && !NEGATED.test(t);
};

/**
 * A reply that refuses and grants nothing. It starts with a refusal and holds no granting word ("go ahead", "please",
 * "no problem"). Then either it is a bare refusal ("No, not yet.", "Hold off for now."), or every gated effect it names
 * comes right after a negation ("don't write", "don't ever push", "do not push or merge") and those negations cover
 * every effect in `effects`, the question's. "No objection.", "Don't hesitate to push it.", "No, write it." and
 * "No, don't push." to a question about writing are not refusals.
 */
export const isRefusal = (reply: string, effects: readonly string[] = []): boolean => {
  const t = reply.trim().toLowerCase();
  if (!REFUSING.test(t) || APPROVING.test(t) || GRANTING.test(t)) return false;
  if (REFUSAL_ONLY.test(t)) return true;
  const negated = new Set<string>();
  for (const m of t.matchAll(/[a-z]+/g)) {
    const effect = WORD_TO_EFFECT.get(m[0]);
    if (effect === undefined) continue;
    if (!NEGATION_BEFORE.test(t.slice(0, m.index))) return false;
    negated.add(effect);
  }
  return negated.size > 0 && effects.every((e) => negated.has(e));
};

/** A reply that picks an option by its place, not its content. */
export const isOrdinal = (reply: string): boolean => ORDINAL.test(reply.trim().toLowerCase());

export type ReplySource = "scripted" | "non_approving" | "freeform" | "fallback";

export interface Reply {
  text: string;
  source: ReplySource;
  /** The reply approves the gated effects the question names. */
  approves: boolean;
  /** Why the scripted reply was not sent, for REPLY_MISALIGNED; null when nothing was misaligned. */
  misaligned: string | null;
}

/** A free-form answer source: the persona and the question in, one answer or null out. */
export type FreeForm = (persona: string, question: string) => Promise<string | null>;

export interface UserSimOptions {
  task: string;
  /** The task's sidecar user script; undefined when the task declared none. */
  script: UserScript | undefined;
  /** Where the event log goes, on the evaluator side. */
  log: string;
  freeform?: FreeForm;
}

export type AskResult = { answers: Record<string, string> } | { missing: string };

export type TurnResult = { reply: string } | { end: string };

/** The text a question is matched on for its effects: header, question, option labels and option descriptions. */
const askText = (q: AskQuestion) => [q.header ?? "", q.question ?? "", ...(q.options ?? []).flatMap((o) => [o.label ?? "", o.description ?? ""])].join("\n");

export class UserSim {
  /** One entry per question asked, its category or null: TrialRecord.asked. */
  readonly asked: (Category | null)[] = [];
  /** Why each misaligned reply was not sent, in order. */
  readonly misaligned: string[] = [];
  private used = new Map<Category, number>();
  private askAnswers = 0;
  private proseReplies = 0;
  private started = false;

  constructor(private o: UserSimOptions) {}

  private event(line: Record<string, unknown>): void {
    mkdirSync(dirname(this.o.log), { recursive: true });
    if (!this.started) {
      this.started = true;
      appendFileSync(this.o.log, JSON.stringify({ kind: "start", task: this.o.task, usersim_sha256: USERSIM_SHA256, classifier_sha256: CLASSIFIER_SHA256, scripted: Object.keys(this.o.script?.replies ?? {}), persona: this.o.script?.persona !== undefined }) + "\n");
    }
    appendFileSync(this.o.log, JSON.stringify({ at: new Date().toISOString(), ...line }) + "\n");
  }

  /** The reply to one question, under the binding rules above. */
  async reply(c: Classification, question: string, matchText: string): Promise<Reply> {
    const effects = effectsOf(matchText);
    const scripted = c.category && (this.used.get(c.category) ?? 0) < LIMITS.replies_per_category ? this.o.script?.replies?.[c.category] : undefined;
    if (scripted !== undefined) {
      const approving = isApproving(scripted);
      const covered = effectsOf(scripted);
      if (!effects.length && !(approving && c.ambiguous) && (!covered.length || isRefusal(scripted))) return this.take(c.category!, { text: scripted, source: "scripted", approves: false, misaligned: null });
      if (effects.length && isRefusal(scripted, effects)) return this.take(c.category!, { text: scripted, source: "scripted", approves: false, misaligned: null });
      const why = NEGATED.test(scripted.toLowerCase()) ? "the reply negates part of what it says"
        : c.ambiguous ? "the question matched " + c.matched.join(" and ") : isOrdinal(scripted) ? "the reply picks an option by its place" : effects.filter((e) => !covered.includes(e)).length ? "the reply does not name " + effects.filter((e) => !covered.includes(e)).join(", ")
        : !effects.length ? "the reply names " + covered.join(", ") + ", which the question does not" : null;
      if (why === null) return this.take(c.category!, { text: scripted, source: "scripted", approves: true, misaligned: null });
      this.misaligned.push(c.category + ": " + why);
      return { text: NON_APPROVING, source: "non_approving", approves: false, misaligned: why };
    }
    const persona = this.o.script?.persona;
    if (persona !== undefined && this.o.freeform) {
      const text = await this.o.freeform(persona, question);
      if (text !== null && text.trim()) {
        if ((effects.length || effectsOf(text).length) && !isRefusal(text, effects)) return { text: NON_APPROVING, source: "non_approving", approves: false, misaligned: null };
        return { text: text.trim(), source: "freeform", approves: false, misaligned: null };
      }
    }
    return { text: FALLBACK, source: "fallback", approves: false, misaligned: null };
  }

  private take(category: Category, reply: Reply): Reply {
    this.used.set(category, (this.used.get(category) ?? 0) + 1);
    return reply;
  }

  /** Answers an AskUserQuestion call, or names the question when the task declared no user replies. */
  async answerAsk(questions: readonly AskQuestion[]): Promise<AskResult> {
    if (this.o.script === undefined) {
      const question = questions.map((q) => q.question ?? q.header ?? "").join(" | ");
      for (const q of questions) this.asked.push(classifyAsk(q).category);
      this.event({ kind: "missing", code: "E_USER_TURNS_MISSING", question });
      return { missing: question };
    }
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const c = classifyAsk(q);
      this.asked.push(c.category);
      const r = this.askAnswers < LIMITS.ask_answers ? await this.reply(c, q.question ?? "", askText(q)) : { text: FALLBACK, source: "fallback" as const, approves: false, misaligned: null };
      this.askAnswers++;
      answers[q.question ?? ""] = r.text;
      this.event({ kind: "ask", question: q.question ?? null, header: q.header ?? null, options: (q.options ?? []).map((o) => o.label ?? ""), category: c.category, tier: c.tier, matched: c.matched, keywords: c.keywords, ambiguous: c.ambiguous, effects: effectsOf(askText(q)), reply: r.text, source: r.source, approves: r.approves, misaligned: r.misaligned });
    }
    return { answers };
  }

  /** After a turn ends: a reply when its last text ends in a question the script or the persona answers, else the end of the session. */
  async afterTurn(finalText: string): Promise<TurnResult> {
    const tail = proseQuestion(finalText);
    if (tail === null || this.o.script === undefined) {
      this.event({ kind: "end", reason: tail === null ? "no_question" : "not_interactive" });
      return { end: tail === null ? "no_question" : "not_interactive" };
    }
    if (this.proseReplies >= LIMITS.prose_replies) {
      this.event({ kind: "end", reason: "prose_limit" });
      return { end: "prose_limit" };
    }
    const c = classifyProse(finalText);
    this.asked.push(c.category);
    const r = await this.reply(c, tail, tail);
    if (r.source === "fallback" && !c.category) {
      this.event({ kind: "end", reason: "unclassified", tail });
      return { end: "unclassified" };
    }
    this.proseReplies++;
    this.event({ kind: "prose", tail, category: c.category, matched: c.matched, keywords: c.keywords, ambiguous: c.ambiguous, effects: effectsOf(tail), reply: r.text, source: r.source, approves: r.approves, misaligned: r.misaligned });
    return { reply: r.text };
  }
}
