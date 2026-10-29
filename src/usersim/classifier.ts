// The deterministic question-category classifier for scripted users (interface v0.4, "Interactive tasks"): keyword
// and option-label matching, no model.
//
// An AskUserQuestion question is classified on its header first, then its question text, then its option labels. A
// prose question is classified on the last PROSE_WINDOW characters of the turn's final text, and only when they hold a
// "?". Within the deciding tier, every category with a keyword in the text (a lowercase substring) matches; the first
// in CATEGORIES order is the category. More than one match makes the classification ambiguous, and the user
// simulator (U10) never answers an ambiguous question with an approval.
//
// tasks.ext.json keys its scripted replies by these category names, and schema/tasks.schema.json publishes the same
// list. Adding a category is a minor change; renaming or removing one breaks callers' sidecars.
//
// The categories and keywords come from GSTA-13's quick Lane A runner (quick/lanea-quick/usersim/categories.json in
// gstack-evals PR #6), whose names match the replies in GSTA-142's office-hours tasks.ext.json (gstack PR #3550).
import { createHash } from "node:crypto";

export const CLASSIFIER_VERSION = 1;

/** Characters of a turn's final text that a prose question is read from. */
export const PROSE_WINDOW = 600;

export const CATEGORIES = [
  { name: "second_opinion", keywords: ["second opinion", "independent ai", "outside voice", "cold read", "cold-read"] },
  { name: "landscape_search", keywords: ["search for what the world", "search engine", "landscape", "search away", "keep this session private", "ok to search", "web search"] },
  { name: "visual", keywords: ["mockup", "mock-up", "wireframe", "sketch", "visual", "variant"] },
  { name: "design_doc", keywords: ["design doc", "status: approved", "start over", "the doc look", "this doc"] },
  { name: "approach", keywords: ["approach a", "approach b", "which approach", "approaches", "alternative", "which option should", "go with", "approach"] },
  { name: "premises", keywords: ["premise", "agree or disagree", "agree/disagree", "do you agree"] },
  { name: "mode", keywords: ["your goal with this", "what's your goal", "what is your goal", "building a startup", "intrapreneurship", "hackathon", "having fun", "side project"] },
  { name: "stage", keywords: ["pre-product", "product stage", "has users", "paying customers", "what stage", "which stage", "where are you with"] },
  { name: "specificity", keywords: ["name the actual", "actual human", "who needs this most", "specific person", "name one", "desperate specificity", "who exactly"] },
  { name: "status_quo", keywords: ["status quo", "right now to solve", "doing right now", "doing today", "workaround", "solve this today", "currently solve", "currently do"] },
  { name: "demand", keywords: ["evidence", "demand", "actually wants", "actually want", "would be upset", "disappear", "pay for", "paid for", "willing to pay"] },
] as const;

export type Category = (typeof CATEGORIES)[number]["name"];

export const CATEGORY_NAMES: readonly Category[] = CATEGORIES.map((c) => c.name);

export const isCategory = (value: string): value is Category => (CATEGORY_NAMES as readonly string[]).includes(value);

/** sha256 over the version, the prose window and the ordered categories: the event log and the verdict record it. */
export const CLASSIFIER_SHA256 = createHash("sha256").update(JSON.stringify({ version: CLASSIFIER_VERSION, prose_window: PROSE_WINDOW, categories: CATEGORIES })).digest("hex");

/** One question of an AskUserQuestion call. */
export interface AskQuestion {
  question?: string;
  header?: string;
  options?: { label?: string; description?: string }[];
}

export type Tier = "header" | "question" | "options" | "prose";

export interface Classification {
  /** The first matching category in CATEGORIES order, or null when nothing matched. */
  category: Category | null;
  /** The tier that decided, or null when nothing matched. */
  tier: Tier | null;
  /** Every category that matched in the deciding tier, in CATEGORIES order. */
  matched: Category[];
  /** The keywords that matched in the deciding tier, for the event log. */
  keywords: string[];
  ambiguous: boolean;
}

const NONE: Classification = { category: null, tier: null, matched: [], keywords: [], ambiguous: false };

function classifyTier(text: string, tier: Tier): Classification {
  const lower = text.toLowerCase();
  const matched: Category[] = [];
  const keywords: string[] = [];
  for (const c of CATEGORIES) {
    const hits = c.keywords.filter((k) => lower.includes(k));
    if (!hits.length) continue;
    matched.push(c.name);
    keywords.push(...hits);
  }
  if (!matched.length) return NONE;
  return { category: matched[0]!, tier, matched, keywords, ambiguous: matched.length > 1 };
}

export function classifyAsk(question: AskQuestion): Classification {
  const tiers: [Tier, string][] = [
    ["header", question.header ?? ""],
    ["question", question.question ?? ""],
    ["options", (question.options ?? []).map((o) => o.label ?? "").join("\n")],
  ];
  for (const [tier, text] of tiers) {
    const c = classifyTier(text, tier);
    if (c.category) return c;
  }
  return NONE;
}

/** The question at the end of a turn's final text, or null when its last PROSE_WINDOW characters hold no "?". */
export function proseQuestion(finalText: string): string | null {
  const tail = finalText.slice(-PROSE_WINDOW);
  return tail.includes("?") ? tail : null;
}

export function classifyProse(finalText: string): Classification {
  const tail = proseQuestion(finalText);
  return tail === null ? NONE : classifyTier(tail, "prose");
}

/** Classifies free text, such as a skill's ask line, as one prose tier that needs no "?". */
export function classifyText(text: string): Classification {
  return classifyTier(text, "prose");
}
