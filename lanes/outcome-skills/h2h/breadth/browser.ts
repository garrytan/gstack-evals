// Copyright (c) 2026 Garry Tan. MIT License.
// The browser-engine check (plan section 6, B1): every fail-to-pass test must run in a real browser engine, shown by
// the runner's own report (a Playwright project, the Karma or Web Test Runner browser string) or, for Vitest, by the
// browser provider in its config together with the report's project name; and no fail-to-pass test file may also be
// collected under jsdom or node (a Vitest project without browser mode, or Jest). Keyless: it reads the parsed report ids
// and the in-image discovery (discover.ts). A runner whose report names no engine (Cypress, Puppeteer through Jest or
// Mocha) fails the check by rule, because the post accepts only the report evidence it lists.
import type { Discovery } from "./discover.ts";
import { idParts, testFileOf, type ReportFormat } from "./parse.ts";
import type { TestRunner } from "./recipes.ts";

export const ENGINE = /(?<![a-z])(chrom(e|ium)|firefox|webkit|safari|edge)(?![a-z])/i;
export type BrowserRule = "no_engine_in_report" | "not_a_browser_project" | "collected_under_node_or_jsdom";
export interface EngineReading { id: string; engine: string | null; evidence: string }
export interface BrowserCheck { ok: boolean; rule: BrowserRule | null; tests: EngineReading[]; also_collected: { file: string; by: string }[] }

function engineOf(runner: TestRunner, format: ReportFormat, id: string, d: Discovery): EngineReading & { rule?: BrowserRule } {
  const ctx = idParts(format, id).context;
  if (runner === "playwright") {
    const name = (id.split("::")[0] ?? "").replace(/^\[|\]$/g, "");
    const p = d.playwright_projects?.find((x) => x.name === name);
    if (!p) return { id, engine: null, evidence: "Playwright project " + JSON.stringify(name) + " is not in the config's project list", rule: "not_a_browser_project" };
    return { id, engine: p.browserName ?? (name.match(ENGINE)?.[0] ?? "chromium").toLowerCase(), evidence: "Playwright project " + JSON.stringify(name) };
  }
  if (runner === "karma" || runner === "web-test-runner") {
    const m = ctx.match(ENGINE);
    return m ? { id, engine: m[0].toLowerCase(), evidence: runner + " browser string " + JSON.stringify(ctx) } : { id, engine: null, evidence: runner + " report names no browser engine", rule: "no_engine_in_report" };
  }
  if (runner === "vitest") {
    const ps = d.discovered.vitest_projects ?? [];
    const p = ps.find((x) => x.name === ctx) ?? (ctx === "" && ps.length === 1 ? ps[0] : undefined);
    if (!p || !p.browser || !p.provider) return { id, engine: null, evidence: "Vitest project " + JSON.stringify(ctx) + (p ? " has no browser provider" : " is not in the config"), rule: "not_a_browser_project" };
    return { id, engine: p.provider, evidence: "Vitest project " + JSON.stringify(p.name) + " with browser provider " + p.provider };
  }
  return { id, engine: null, evidence: runner + " reports no browser engine", rule: "no_engine_in_report" };
}

/** The check over a unit's fail-to-pass ids. testFiles are the fix's test files (for the collection half). */
export function browserCheck(o: { runner: TestRunner; format: ReportFormat; f2p: readonly string[]; testFiles: readonly string[]; discovery: Discovery }): BrowserCheck {
  const tests = o.f2p.map((id) => engineOf(o.runner, o.format, id, o.discovery));
  const files = new Set<string>();
  for (const id of o.f2p) {
    const f = testFileOf(o.format, id, o.testFiles);
    if (f) files.add(f);
    else if (f === undefined) o.testFiles.forEach((t) => files.add(t));
  }
  const nodeProjects = new Set((o.discovery.discovered.vitest_projects ?? []).filter((p) => !p.browser).map((p) => p.name));
  const also: { file: string; by: string }[] = [];
  for (const f of [...files].sort()) {
    for (const t of o.discovery.vitest_tests ?? []) if (t.file === f && nodeProjects.has(t.project) && !also.some((a) => a.file === f && a.by === "vitest:" + t.project)) also.push({ file: f, by: "vitest:" + t.project });
    if (o.runner !== "jest" && o.discovery.jest_files?.includes(f)) also.push({ file: f, by: "jest" });
  }
  const bad = tests.find((t) => t.rule);
  const rule: BrowserRule | null = bad?.rule ?? (also.length ? "collected_under_node_or_jsdom" : null);
  return { ok: !rule && tests.length > 0, rule, tests: tests.map(({ id, engine, evidence }) => ({ id, engine, evidence })), also_collected: also };
}
