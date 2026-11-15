// Copyright (c) 2026 Garry Tan. MIT License.
// What the two breadth miners share (plan section 6): the exclusion list and the permissive licence list from prereg.json,
// applied before any draw; the windows (the primary window and the widened one the fallback may use, both mined in the one
// frozen run); the per-ecosystem file classes the 1 to 6 rule counts with (the state machines eval's frozen lists); a
// GitHub GraphQL caller through the authenticated gh CLI that refuses a query costing more than its budget and waits out
// the rate-limit window; and a small async pool.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { classify, type Lang } from "../../statemachines/langs.ts";
import { h2hFail, POST_ID, readPrereg, type H2hPrereg } from "../prereg.ts";

export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
export const BUNDLE_DIR = join(import.meta.dir, "..", "..", "..", "..", "wiki", "plans", POST_ID);
/** The freeze date of every frozen read in part B (miners, licences, the repository search). */
export const FREEZE_DATE = "2026-11-15";

/** The first exclusion pattern a repository matches, case-insensitive, or null. "owner/*" matches every repository of the
 *  owner; any other pattern matches one repository. */
export function excludedBy(repo: string, patterns: readonly string[]): string | null {
  const r = repo.toLowerCase();
  for (const p of patterns) {
    const q = p.toLowerCase();
    if (q.endsWith("/*") ? r.startsWith(q.slice(0, -1)) : r === q) return p;
  }
  return null;
}

/** The B windows from prereg.json: primary [window[0], window[1]] and widened [widen_to, window[1]]. */
export interface Windows { from: string; to: string; widen_to: string }
export const windows = (p: H2hPrereg = readPrereg()): Windows => ({ from: p.classes.B.window[0], to: p.classes.B.window[1], widen_to: p.classes.B.widen_to });
/** "primary" inside the post's window, "widened" inside the fallback's extra months, null outside both. Dates are UTC days. */
export function windowOf(day: string, w: Windows): "primary" | "widened" | null {
  if (day > w.to || day < w.widen_to) return null;
  return day >= w.from ? "primary" : "widened";
}

/** The ecosystems B2 reads, each with the state machines language whose frozen source and test-file lists classify its
 *  files. npm reads as ts, whose source list holds the JavaScript extensions too. */
export const ECOSYSTEM_LANG: Record<string, Lang> = { npm: "ts", Go: "go", Maven: "java", "crates.io": "rust", NuGet: "csharp" };

/** A file's class for the 1 to 6 rule under one or more languages: test when any language's test-file convention takes it
 *  (a source extension under a test path), else source when any language's source list takes it, else other. Vendored,
 *  generated and build paths are other (langs.ts classify). */
export function fileClass(langs: readonly Lang[], path: string): "test" | "source" | "other" {
  const c = langs.map((l) => classify(l, path));
  return c.includes("test") ? "test" : c.includes("source") ? "source" : "other";
}
export function fileCounts(langs: readonly Lang[], paths: readonly string[]): { test: number; source: number; total: number } {
  let test = 0, source = 0;
  for (const p of paths) {
    const k = fileClass(langs, p);
    if (k === "test") test++;
    else if (k === "source") source++;
  }
  return { test, source, total: paths.length };
}

export interface GqlResult { data: Record<string, any>; errors?: { message: string; type?: string; path?: (string | number)[] }[] }
/** One GraphQL call. */
export type Gql = (query: string) => Promise<GqlResult>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function gh(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const t = setTimeout(() => c.kill("SIGKILL"), 180_000);
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => {
      clearTimeout(t);
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

/** The gh CLI's GraphQL endpoint. Every query must ask rateLimit { cost remaining resetAt }; a query whose cost passes
 *  maxCost refuses (E_H2H_B_MINE), and when remaining drops under floor the caller sleeps until resetAt. A transport failure
 *  or a rate-limit refusal is retried up to 4 times; partial errors (a missing repository) return with the data. */
export function ghGql(o: { maxCost?: number; floor?: number; log?: (s: string) => void } = {}): Gql {
  const maxCost = o.maxCost ?? 1, floor = o.floor ?? 300;
  return async (query) => {
    let last = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await gh(["api", "graphql", "-f", "query=" + query]);
      let body: any;
      try {
        body = JSON.parse(r.stdout || "");
      } catch {
        last = (r.stderr || "").slice(-300);
        await sleep(/rate limit/i.test(last) ? 60_000 : 5_000 * (attempt + 1));
        continue;
      }
      const rl = body?.data?.rateLimit;
      if (rl && rl.cost > maxCost) h2hFail("E_H2H_B_MINE", "a GraphQL query cost " + rl.cost + " points, over the miner's budget of " + maxCost);
      if (rl && rl.remaining < floor) {
        const wait = Math.max(0, Date.parse(rl.resetAt) - Date.now()) + 5_000;
        o.log?.("rate limit: " + rl.remaining + " left, waiting " + Math.round(wait / 1000) + " s");
        await sleep(wait);
      }
      if (!body.data && body.errors) {
        last = JSON.stringify(body.errors).slice(0, 300);
        if (/RATE_LIMITED|rate limit|timeout|something went wrong/i.test(last)) {
          await sleep(30_000 * (attempt + 1));
          continue;
        }
        h2hFail("E_H2H_B_MINE", "GraphQL refused the query: " + last);
      }
      return { data: body.data ?? {}, errors: body.errors };
    }
    return h2hFail("E_H2H_B_MINE", "GraphQL failed 5 times: " + last);
  };
}

/** Runs f over items with at most n in flight, keeping input order in the result. */
export async function pool<T, R>(items: readonly T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await f(items[i]!, i);
    }
  }));
  return out;
}

/** Writes a JSON file atomically with a final newline. */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 1) + "\n");
  renameSync(path + ".tmp", path);
}

export const bump = (m: Record<string, number>, k: string, by = 1): void => {
  m[k] = (m[k] ?? 0) + by;
};

/** A count map with its keys sorted, for stable frozen files. */
export const sorted = (m: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
