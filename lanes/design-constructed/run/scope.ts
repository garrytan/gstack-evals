// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless UI scope read (2026-11-09-geva-420 sections 4 and 9; plan section 10): gstack's own UI scope rule at the
// pin, on each unit's plan.md as the autoplan arm's run takes it, with the repository root as the rule reads it, and
// the share with UI scope detected. Under 80% of comparison plans, whether autoplan's stage 2 cells run goes to the
// Captain (the read area decides that; this file prints the share).
//
// How the run takes plan.md at the pin: the --scaffold route (lib/autoplan-plan-text.ts scaffold) adds a missing
// section heading or leaves a plan with no section heading as it is; init (bin/gstack-autoplan-snapshot.ts) wraps a
// plan with no section heading under "## Implementation plan" and "## Review record"; the scope rule
// (lib/autoplan-scope.ts detectUiScope) reads the Implementation plan with root set to the session's working folder
// (process.cwd() of the snapshot tool, /work in the container, which holds plan.md and repo/). A plan the run refuses
// (duplicate, reversed or empty sections) is unreadable and counts as no UI scope.
//
// Vendored from gstack (https://github.com/garrytan/gstack) at b6155921a564ba9ec2470fd2cb3894c05e2c2d13, MIT License,
// Copyright (c) 2026 Garry Tan: sectionHeadings, implementationBounds and extractImplementationPlan from
// bin/gstack-autoplan-snapshot.ts; scaffold from lib/autoplan-plan-text.ts; UI_TERMS, VISUAL_NOUNS, the rendered-path
// rules, wordOf, holdsTemplate and detectUiScope from lib/autoplan-scope.ts; TEMPLATE_TAG_ERE, TEMPLATE_TAG,
// TEST_PATH_ERE and isTemplateCandidate from lib/frontend-scope.ts. Their logic is byte for byte; changes are
// TypeScript export keywords, double quotes, and init's wrap reduced to its text rule. SCOPE_SOURCES pins each file.
import * as fs from "node:fs";
import * as path from "node:path";

export const SCOPE_PIN = "b6155921a564ba9ec2470fd2cb3894c05e2c2d13";
/** sha256 of each vendored source file at the pin. */
export const SCOPE_SOURCES = {
  "bin/gstack-autoplan-snapshot.ts": "f9a31c701d8a86af3b752ab0901661a12f54cd7cd73b512e33f0eea62e555e73",
  "lib/autoplan-plan-text.ts": "decb0fb8809ed85afa5bf3c7889fd65507856ecec3a0c50c4ae1b94b16e01bd7",
  "lib/autoplan-scope.ts": "898c3cb791eb36a09113ce5b0a998b20e7576fc0755bc786998f6a7c18292ab7",
  "lib/frontend-scope.ts": "27c8a69861ed35b7c28de88f2c17a80dc15191a5a852f3fbf22cc6696e804cae",
} as const;

// ---- vendored: bin/gstack-autoplan-snapshot.ts

export function sectionHeadings(plan: string) {
  const boundaries: Array<{ name: string; start: number; end: number }> = [];
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  for (const raw of plan.split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, "");
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      const run = delimiter[1]!;
      if (fence) {
        if (run[0] === fence.char && run.length >= fence.length && !delimiter[2]!.trim()) fence = null;
      } else if (run[0] !== "`" || !delimiter[2]!.includes("`")) {
        fence = { char: run[0]!, length: run.length };
      }
    } else if (!fence) {
      const heading = /^ {0,3}##[ \t]+(Implementation plan|Review record)[ \t]*(?:#+[ \t]*)?$/.exec(line);
      if (heading) boundaries.push({ name: heading[1]!, start: offset, end: offset + raw.length });
    }
    offset += raw.length;
  }
  return boundaries;
}

function implementationBounds(plan: string) {
  const boundaries = sectionHeadings(plan);
  if (boundaries.length !== 2 || boundaries[0]!.name !== "Implementation plan" || boundaries[1]!.name !== "Review record") {
    throw new Error("Expected one Implementation plan section followed by one Review record section outside Markdown code/quotes");
  }
  const start = boundaries[0]!.end;
  const end = boundaries[1]!.start;
  if (!plan.slice(start, end).trim()) throw new Error("Implementation plan is empty");
  return { start, end, reviewStart: boundaries[1]!.end };
}

export function extractImplementationPlan(plan: string): string {
  const { start, end } = implementationBounds(plan);
  return plan.slice(start, end);
}

// ---- vendored: lib/autoplan-plan-text.ts

export interface SectionDiagnosis { problem?: string; text?: string; added?: string }

export function scaffold(text: string): SectionDiagnosis {
  const heads = sectionHeadings(text);
  const names = heads.map(h => h.name).join(",");
  if (!heads.length) return {};
  if (names === "Implementation plan,Review record") {
    try { extractImplementationPlan(text); return {}; } catch (e: any) { return { problem: String(e.message) }; }
  }
  if (names === "Implementation plan") {
    return { problem: "has \"## Implementation plan\" but no \"## Review record\"", text: `${text}${text.endsWith("\n") ? "" : "\n"}\n## Review record\n`, added: "## Review record" };
  }
  if (names === "Review record") {
    const before = text.slice(0, heads[0]!.start);
    const title = /^(?:\s*\n|#[ \t][^\n]*\n)*/.exec(before)![0];
    if (!before.slice(title.length).trim()) return { problem: "has \"## Review record\" but no plan text before it" };
    return { problem: "has \"## Review record\" but no \"## Implementation plan\"", text: `${title}## Implementation plan\n${text.slice(title.length)}`, added: "## Implementation plan" };
  }
  return { problem: `ambiguous sections (${heads.map(h => `## ${h.name}`).join(", ")}): duplicate or reversed headings` };
}

// ---- vendored: lib/frontend-scope.ts

export const TEMPLATE_TAG_ERE = "(^|[^A-Za-z0-9_$.])(html|css|svg)[[:space:]]*`";
export const TEMPLATE_TAG = new RegExp(TEMPLATE_TAG_ERE.replace("[[:space:]]", "[^\\S\\n]"), "m");
export const TEST_PATH_ERE = "(^|/)(tests?|spec|__tests__)/|(^|/)tests?\\.py$|(^|/)test_[^/]+\\.py$|_test\\.(go|py|rb|ts|js|exs|dart)$|\\.(test|spec)\\.[jt]sx?$|_spec\\.rb$|Test\\.(java|kt)$";
const TEST_PATH = new RegExp(TEST_PATH_ERE);
const TEMPLATE_EXT = /\.(ts|js|mjs|cjs|mts|cts)$/;
const TEMPLATE_SKIP = /\.(test|spec)\.|^(test|tests|spec|__tests__|cypress|e2e)\//;

export function isTemplateCandidate(relPath: string): boolean {
  const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return TEMPLATE_EXT.test(rel) && !TEMPLATE_SKIP.test(rel) && !TEST_PATH.test(rel);
}

// ---- vendored: lib/autoplan-scope.ts

export const UI_TERMS = ["component", "screen", "form", "button", "modal", "layout", "dashboard", "sidebar", "nav", "dialog", "row", "list", "picker", "menu", "section"] as const;
export const VISUAL_NOUNS = ["page", "layout", "style", "pixel", "view", "browser", "css"] as const;
const VISUAL_WINDOW = 4;
const RENDERED_EXT = /(?:^|\/)[^/.][^/]*\.(?:tsx|jsx|vue|svelte|css|scss|html|erb|hbs)$/i;
const RENDERED_DIR = /(?:^|\/)(?:components|pages|views|styles)\//i;
const TEMPLATE_MAX_BYTES = 2_000_000;

export interface UiEvidence { terms: Array<{ term: string; count: number }>; visual: string[]; files: string[] }
export interface UiScope { uiRequired: boolean; uiMatches: number; uiEvidence: UiEvidence }

const wordOf = (w: string, list: readonly string[]) => list.find(t => w === t || w === `${t}s` || (t === "style" && w === "stylesheet"));

function holdsTemplate(file: string, root: string): boolean {
  if (!isTemplateCandidate(file)) return false;
  try {
    const base = fs.realpathSync(root);
    const real = fs.realpathSync(path.resolve(base, file));
    const rel = path.relative(base, real);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
    const st = fs.statSync(real);
    return st.isFile() && st.size <= TEMPLATE_MAX_BYTES && TEMPLATE_TAG.test(fs.readFileSync(real, "utf8"));
  } catch {
    return false;
  }
}

export function detectUiScope(implementationPlan: string, root?: string): UiScope {
  const files = [...new Set([...implementationPlan.matchAll(/[\w@~$.\/-]+/g)].map(m => m[0].replace(/[.\-]+$/, "")))]
    .filter(t => t.length > 1 && (RENDERED_EXT.test(t) || RENDERED_DIR.test(t) || (root !== undefined && holdsTemplate(t, root))));
  const counts = new Map<string, number>();
  const visual: string[] = [];
  for (const sentence of implementationPlan.split(/[.!?;:](?:\s|$)|\n\s*\n/)) {
    const words = sentence.replace(/\S*\/\S*|\b[\w-]+\.[a-z]{1,6}\b/gi, " ").toLowerCase().match(/[a-z]+/g) ?? [];
    words.forEach((w, i) => {
      const term = wordOf(w, UI_TERMS);
      if (!term) return;
      counts.set(term, (counts.get(term) ?? 0) + 1);
      for (let j = Math.max(0, i - VISUAL_WINDOW); j <= Math.min(words.length - 1, i + VISUAL_WINDOW); j++) {
        const noun = j !== i ? wordOf(words[j]!, VISUAL_NOUNS) : undefined;
        if (noun && noun !== term) { visual.push(`${term}~${noun}`); return; }
      }
    });
  }
  const terms = UI_TERMS.flatMap(term => (counts.has(term) ? [{ term, count: counts.get(term)! }] : []));
  return { uiRequired: files.length > 0 || visual.length > 0, uiMatches: terms.reduce((s, t) => s + t.count, 0), uiEvidence: { terms, visual: [...new Set(visual)], files } };
}

// ---- end of the vendored code

/** plan.md as the run reviews it: the --scaffold route, then init's wrap of a plan with no section heading. Throws when the run would refuse it. */
export function scaffoldedPlan(planMd: string): string {
  const diag = scaffold(planMd);
  if (diag.problem && !diag.text) throw new Error("PLAN_SECTIONS_INVALID: " + diag.problem);
  const source = diag.text ?? planMd;
  try {
    extractImplementationPlan(source);
    return source;
  } catch (error) {
    if (sectionHeadings(source).length) throw error;
    const wrapped = "## Implementation plan\n" + source + (source.endsWith("\n") ? "" : "\n") + "## Review record\n";
    extractImplementationPlan(wrapped);
    return wrapped;
  }
}

/** One plan's read: the rule's answer, or null when the run would refuse the plan. root is the session's working folder. */
export function scopeOf(planMd: string, root: string): UiScope | null {
  try {
    return detectUiScope(extractImplementationPlan(scaffoldedPlan(planMd)), root);
  } catch {
    return null;
  }
}

export interface ScopeShare {
  plans: number;
  ui: number;
  unreadable: number;
  /** ui over plans, four decimals; 0 with no plans. */
  share: number;
}

export function scopeShare(reads: ReadonlyArray<UiScope | null>): ScopeShare {
  const ui = reads.filter((r) => r?.uiRequired === true).length;
  return { plans: reads.length, ui, unreadable: reads.filter((r) => r === null).length, share: reads.length ? Math.round((ui / reads.length) * 1e4) / 1e4 : 0 };
}

export const printScopeShare = (label: string, s: ScopeShare): string => "scope read " + label + ": UI scope on " + s.ui + " of " + s.plans + " plans (" + s.share.toFixed(4) + "), " + s.unreadable + " unreadable";
