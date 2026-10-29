import { appendFileSync } from "node:fs";
import categoriesFile from "../usersim/categories.json" with { type: "json" };

export interface Question {
  question?: string;
  header?: string;
  options?: { label?: string; description?: string }[];
  multiSelect?: boolean;
}

export interface UserScript {
  persona?: string;
  replies?: Record<string, string>;
}

export interface Classified {
  category: string | null;
  matched: string[];
}

export const CATEGORIES = categoriesFile;

export function classify(text: string): Classified {
  const t = text.toLowerCase();
  const matched = CATEGORIES.order.filter((c) => c.keywords.some((k) => t.includes(k))).map((c) => c.category);
  return { category: matched[0] ?? null, matched };
}

export function classifyAsk(q: Question): Classified {
  const tiers = [q.header ?? "", q.question ?? "", (q.options ?? []).map((o) => o.label ?? "").join("\n")];
  for (const t of tiers) {
    const c = classify(t);
    if (c.category) return c;
  }
  return { category: null, matched: [] };
}

export function proseQuestion(finalText: string): string | null {
  const tail = finalText.slice(-CATEGORIES.limits.prose_window_chars);
  return tail.includes("?") ? tail : null;
}

export type Decision =
  | { kind: "reply"; text: string; category: string; source: "scripted" | "fallback" }
  | { kind: "end"; reason: string; category: string | null };

export class UserSim {
  private counts = new Map<string, number>();
  proseReplies = 0;
  askAnswers = 0;
  sequence: string[] = [];

  constructor(private script: UserScript | undefined, private logPath: string) {}

  private log(event: Record<string, unknown>) {
    appendFileSync(this.logPath, JSON.stringify({ ts: Date.now(), ...event }) + "\n");
  }

  private scripted(category: string | null): string | undefined {
    if (!category) return undefined;
    const n = this.counts.get(category) ?? 0;
    if (n >= CATEGORIES.limits.max_replies_per_category) return undefined;
    return this.script?.replies?.[category];
  }

  answerAsk(questions: Question[]): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const c = classifyAsk(q);
      let reply = this.askAnswers < CATEGORIES.limits.max_ask_answers ? this.scripted(c.category) : undefined;
      const source = reply === undefined ? "fallback" : "scripted";
      if (reply === undefined) reply = CATEGORIES.fallback;
      else this.counts.set(c.category!, (this.counts.get(c.category!) ?? 0) + 1);
      this.askAnswers++;
      this.sequence.push(`ask:${c.category ?? "?"}`);
      this.log({ event: "ask", question: q.question, header: q.header, options: (q.options ?? []).map((o) => o.label), category: c.category, matched: c.matched, answer: reply, source });
      answers[q.question ?? ""] = reply;
    }
    return answers;
  }

  afterTurn(finalText: string): Decision {
    const tail = proseQuestion(finalText);
    if (!tail) {
      this.log({ event: "end", reason: "no_question" });
      return { kind: "end", reason: "no_question", category: null };
    }
    const c = classify(tail);
    if (this.proseReplies >= CATEGORIES.limits.max_prose_replies) {
      this.log({ event: "end", reason: "prose_limit", category: c.category });
      return { kind: "end", reason: "prose_limit", category: c.category };
    }
    const reply = this.scripted(c.category);
    if (reply === undefined) {
      this.log({ event: "end", reason: c.category ? "no_reply_for_category" : "unclassified", category: c.category, matched: c.matched, tail });
      return { kind: "end", reason: c.category ? "no_reply_for_category" : "unclassified", category: c.category };
    }
    this.counts.set(c.category!, (this.counts.get(c.category!) ?? 0) + 1);
    this.proseReplies++;
    this.sequence.push(`prose:${c.category}`);
    this.log({ event: "prose", category: c.category, matched: c.matched, answer: reply, tail });
    return { kind: "reply", text: reply, category: c.category!, source: "scripted" };
  }
}
