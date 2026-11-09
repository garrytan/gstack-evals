// Copyright (c) 2026 Garry Tan. MIT License.
// The DX scope rate (prereg 2026-11-09-geva-417, section 4: the supply reading and the scope check before stage 2). It runs
// the pinned gstack's own keyless scope detector on plan.md wrapped as the autoplan arm wraps it (under "## Implementation
// plan" and "## Review record" headings), so the share it reports is the share of plans on which autoplan's run would
// load the DX lens. Below 0.80 of comparison plans, no stage 2 lease opens until the Captain answers.
//
// Vendored from gstack (https://github.com/garrytan/gstack) bin/gstack-autoplan-snapshot.ts at
// b6155921a564ba9ec2470fd2cb3894c05e2c2d13, MIT License, Copyright (c) 2026 Garry Tan: DX_TERMS, dxTermsFor,
// sectionHeadings, implementationBounds and extractImplementationPlan, byte for byte in their logic. Changes: TypeScript
// export keywords, double quotes, and detectDxScope reduced to its term rule on text (the pin's version also reads a file,
// takes the --developer-tool and --agent-primary flags, which the arm never passes, and adds UI evidence, which DX ignores).
// tests/devex/author/scope.test.ts pins the term list by sha256.
import { createHash } from "node:crypto";

// Exact terms from Autoplan's existing Phase 0 DX trigger. Count occurrences,
// not a subjective reinterpretation of whether an API is internal or external.
export const DX_TERMS = ["API", "endpoint", "REST", "GraphQL", "gRPC", "webhook", "CLI", "command", "flag", "argument", "terminal", "shell", "SDK", "library", "package", "npm", "pip", "import", "require", "SKILL.md", "skill template", "Claude Code", "MCP", "agent", "OpenClaw", "action", "developer docs", "getting started", "onboarding", "integration", "debug", "implement", "error message"];

export const GSTACK_PIN = "b6155921a564ba9ec2470fd2cb3894c05e2c2d13";
/** sha256 of JSON.stringify(DX_TERMS) at the pin. */
export const DX_TERMS_SHA256 = "cda98bfe5a4cc1852e26c8053c8134ffebf18d4d25a7bdb887ec89d719277c89";
/** Section 4's bar: under this share of comparison plans, stage 2 waits for the Captain. */
export const SCOPE_BAR = 0.8;

export function dxTermsFor(content: string) {
  const matches = DX_TERMS.map((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { term, count: [...content.matchAll(new RegExp(`\\b${escaped}\\b`, "gi"))].length };
  }).filter((match) => match.count > 0);
  const matchCount = matches.reduce((sum, match) => sum + match.count, 0);
  return { threshold: 2, matches, matchCount, dxRequiredByTerms: matchCount >= 2 };
}

/** The section headings outside code fences, in order (the runner's PLAN_SECTIONS_INVALID diagnosis reads these). */
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

// ---- end of the vendored code ----

/** plan.md as the autoplan arm hands it to autoplan: the whole plan under "## Implementation plan", then an empty "## Review record". */
export function wrapForAutoplan(planMd: string): string {
  return "## Implementation plan\n\n" + planMd.replace(/\s+$/, "") + "\n\n## Review record\n";
}

/** Whether the pinned detector would load the DX lens on this plan.md; null when the wrapped plan is not one the pin can read. */
export function loadsDx(planMd: string): boolean | null {
  try {
    return dxTermsFor(extractImplementationPlan(wrapForAutoplan(planMd))).dxRequiredByTerms;
  } catch {
    return null;
  }
}

export interface ScopeRate {
  plans: number;
  loads: number;
  /** Plans the pin could not read (a plan holding its own Implementation plan or Review record heading); they count as not loading. */
  unreadable: number;
  rate: number;
  /** At or above SCOPE_BAR, rounded to four places as every band edge in the prereg is. */
  passes: boolean;
}

export function scopeRate(plans: readonly string[]): ScopeRate {
  const reads = plans.map(loadsDx);
  const loads = reads.filter((r) => r === true).length;
  const rate = plans.length ? loads / plans.length : 0;
  return { plans: plans.length, loads, unreadable: reads.filter((r) => r === null).length, rate, passes: plans.length > 0 && Math.round(rate * 1e4) / 1e4 >= SCOPE_BAR };
}

export const termsDigest = () => createHash("sha256").update(JSON.stringify(DX_TERMS)).digest("hex");
