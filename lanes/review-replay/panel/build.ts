// Copyright (c) 2026 Garry Tan. MIT License.
// Vendored from GSTA-131's review replay panel: the org drive's handoffs/gsta131-review-replay/build.ts
// (sha256 6886718c0c3c31abc0f2fa3ea04ac8557c519c6f000bd18b2ca5297ae5428e71) and build2.ts
// (sha256 4d83a3ec021d5745bf3afbe5fea1ca52b4d13e42b29aa03d84758a95a45a4dd9). They are scratch scripts from GSTA-131's
// machine, not part of garrytan/gstack#3527, so there is no source commit. build2.ts is build.ts's seven items plus
// eval 2's eight, so this file starts from build2.ts and keeps its rendering: the callers scan, the fix-check and
// specialist prompts, the floor sentence and the item list.
// Changes from upstream (U13a):
// - The gstack checkout is --gstack <dir> instead of a hardcoded /workspace/gstack, and scripts/resolvers/fix-check.ts is
//   imported from it at run time.
// - The output dir is --out <dir> instead of PROMPTS_OUT or a scratch path.
// - git runs with core.abbrev=9, so the diffs' index lines match the frozen prompts whatever the clone's object count.
// - Before rendering, every commit the items diff must resolve in the checkout. GSTA-131's git calls ignore failures,
//   so a missing commit rendered an empty diff.
// - A plain build refuses to overwrite an existing prompt whose bytes differ, and leaves an identical one in place.
// - --check <eval dir> renders into a scratch dir and compares every prompt the eval's frozen sha256 file lists, matched
//   by file name. It prints one OK or DIFF line per prompt, exits 1 on any difference and never writes the frozen file
//   or the eval dir. It refuses a checkout whose HEAD is not PINNED_GSTACK.
// - The digest comparison and the overwrite refusal are exported, so keyless tests run them without a checkout.
// - Refusals, including a missing checkout, print E_USAGE on stderr and exit 2.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

/** The gstack commit at which every frozen prompt of eval1 and eval2 reproduces byte for byte. */
export const PINNED_GSTACK = "148d28ea81b7be4daad89d91b911c9efd85391eb";

/** Commits the items diff; each must resolve in the checkout before anything renders. */
const COMMITS = ["ee73419c3", "3712b79", "2114d7ab3", "a2077ff7", "27a1b1fd", "ada2acce", "392f50d", "392f50d^"];

const FLOOR = "CRITICAL means the finding would fail a test, break production, or lose data or secrets; everything else is INFORMATIONAL.";

/** A refusal: printed as E_USAGE, exit 2. */
export class Refusal extends Error {}

export interface FrozenEntry {
  sha256: string;
  path: string;
}

/** Parses a sha256sum file: one "<64 hex>  <path>" line per file, blank lines skipped. */
export function parseFrozen(text: string): FrozenEntry[] {
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(l);
    if (!m) throw new Refusal("not a sha256sum line: " + l);
    return { sha256: m[1]!, path: m[2]! };
  });
}

export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export interface PromptCheck {
  name: string;
  ok: boolean;
  line: string;
}

/**
 * Compares every prompt a frozen file lists (each entry under a directory) with the file of the same name in dir.
 * Entries at the eval dir's top level, such as the preregistration, are not prompts and are skipped.
 */
export function compareFrozen(frozenText: string, dir: string): PromptCheck[] {
  return parseFrozen(frozenText).filter((e) => dirname(e.path) !== ".").map((e) => {
    const name = basename(e.path);
    const file = join(dir, name);
    if (!existsSync(file)) return { name, ok: false, line: "DIFF " + e.path + " missing from the render" };
    const got = sha256(readFileSync(file));
    return got === e.sha256 ? { name, ok: true, line: "OK " + e.path } : { name, ok: false, line: "DIFF " + e.path + " frozen " + e.sha256 + " rendered " + got };
  });
}

/** Writes a prompt unless a file with different bytes is already there; an identical file is left untouched. */
export function writePrompt(out: string, id: string, text: string): void {
  const file = join(out, id + ".md");
  if (existsSync(file)) {
    if (readFileSync(file).equals(Buffer.from(text))) return;
    throw new Refusal(file + " exists with different bytes, and build.ts never overwrites a prompt. Compare with --check <eval dir>, or render into an empty --out.");
  }
  writeFileSync(file, text);
}

/** Finds the eval dir's one frozen sha256 file (frozen.sha256, frozen2.sha256). */
export function frozenFile(evalDir: string): string {
  if (!existsSync(evalDir)) throw new Refusal(evalDir + " does not exist");
  const found = readdirSync(evalDir).filter((f) => /^frozen.*\.sha256$/.test(f));
  if (found.length !== 1) throw new Refusal(evalDir + " must hold exactly one frozen*.sha256 file, found " + found.length);
  return join(evalDir, found[0]!);
}

/** Renders every panel item from the checkout into out, as GSTA-131's build2.ts did. */
export async function render(gstack: string, out: string): Promise<void> {
  const G = (a: string[]) => spawnSync("git", ["-c", "core.abbrev=9", ...a], { cwd: gstack, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stdout;
  const missing = COMMITS.filter((c) => spawnSync("git", ["rev-parse", "--verify", "-q", c + "^{commit}"], { cwd: gstack }).status !== 0);
  if (missing.length) throw new Refusal(gstack + " lacks commits " + missing.join(", ") + "; fetch refs/pull/3516/head and refs/pull/3518/head from garrytan/gstack");
  const { renderFixCheckPrompt } = await import(join(gstack, "scripts/resolvers/fix-check.ts"));
  mkdirSync(out, { recursive: true });
  function callers(from: string, to: string): string {
    const diff = G(["diff", "-U0", from, to]);
    const names = new Set<string>();
    for (const l of diff.split("\n")) {
      const h = /^@@ .* @@\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(l);
      if (h) names.add(h[1]!);
      const d = /^[+-]\s*(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|async))/.exec(l);
      if (d) names.add((d[1] ?? d[2])!);
    }
    const skip = new Set(["if", "for", "while", "switch", "test", "describe", "expect", "it"]);
    const lines: string[] = [];
    for (const n of [...names].filter((n) => !skip.has(n) && n.length > 2).slice(0, 12)) {
      const hits = G(["grep", "-n", "-E", "\\b" + n + "\\(", to, "--", "*.ts"]).split("\n").filter(Boolean).slice(0, 8).map((l) => l.replace(to + ":", ""));
      lines.push("### " + n, ...hits);
    }
    return lines.join("\n");
  }
  function fixCheck(id: string, from: string, to: string) {
    const msg = G(["log", "-1", "--format=%B", to]);
    const p = renderFixCheckPrompt({ fixList: msg, touchedHunks: G(["diff", from, to]), callers: callers(from, to), testResults: "The focused tests for the touched files passed after these fixes." });
    writePrompt(out, id, p);
  }
  function specialist(id: string, checklist: string, from: string, to: string) {
    const p = ["You are a specialist code reviewer. Read the checklist below and review the diff against it. " + FLOOR + ' Name the input or call site that reaches each defect. Output one JSON object per line, {"severity":"CRITICAL|INFORMATIONAL","path":"<file>","line":<n>,"summary":"<what breaks>"}, or the two words NO FINDINGS.',
      "", "## Checklist", readFileSync(join(gstack, "review/specialists", checklist + ".md"), "utf8"), "", "## Diff", "```" + "diff", G(["diff", from, to]), "```"].join("\n");
    writePrompt(out, id, p);
  }
  fixCheck("c1-fixcheck", "ee73419c3", "3712b79");
  specialist("c1-statemachines-range", "state-machines", "ee73419c3", "3712b79");
  fixCheck("c2-fixcheck", "2114d7ab3", "a2077ff7");
  fixCheck("d1-fixcheck-fixed", "3712b79", "27a1b1fd");
  fixCheck("d2-fixcheck-fixed", "a2077ff7", "ada2acce");
  specialist("t-testing-code", "testing", "392f50d^", "392f50d");
  specialist("t-maint-code", "maintainability", "392f50d^", "392f50d");

  specialist("c2-range-testing", "testing", "2114d7ab3", "a2077ff7");
  specialist("c2-range-security", "security", "2114d7ab3", "a2077ff7");
  specialist("c2-range-maintainability", "maintainability", "2114d7ab3", "a2077ff7");
  specialist("c2-range-statemachines", "state-machines", "2114d7ab3", "a2077ff7");
  specialist("c2-range-redteam", "red-team", "2114d7ab3", "a2077ff7");
  specialist("c1-range-testing", "testing", "ee73419c3", "3712b79");
  specialist("c1-range-maintainability", "maintainability", "ee73419c3", "3712b79");
  specialist("c1-range-redteam", "red-team", "ee73419c3", "3712b79");
}

const USAGE = "usage: bun lanes/review-replay/panel/build.ts --gstack <checkout> (--out <dir> | --check <eval dir>)";

export async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: { gstack: { type: "string" }, out: { type: "string" }, check: { type: "string" } }, strict: true });
    if (!values.gstack || (values.out === undefined) === (values.check === undefined)) throw new Refusal(USAGE);
    const gstack = resolve(values.gstack);
    if (!existsSync(gstack)) throw new Refusal(gstack + " does not exist; --gstack takes a gstack checkout");
    if (values.out !== undefined) {
      const out = resolve(values.out);
      await render(gstack, out);
      for (const f of readdirSync(out)) console.log(f, statSync(join(out, f)).size);
      return 0;
    }
    const evalDir = resolve(values.check!);
    const frozen = readFileSync(frozenFile(evalDir), "utf8");
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: gstack, encoding: "utf8" }).stdout?.trim();
    if (head !== PINNED_GSTACK) throw new Refusal(gstack + " is at " + (head || "no commit") + "; --check needs gstack at " + PINNED_GSTACK + " (lanes/review-replay/README.md, The panel)");
    const scratch = mkdtempSync(join(tmpdir(), "review-replay-check-"));
    try {
      await render(gstack, scratch);
      const checks = compareFrozen(frozen, scratch);
      for (const c of checks) console.log(c.line);
      return checks.every((c) => c.ok) ? 0 : 1;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } catch (e) {
    if (!(e instanceof Refusal) && !String((e as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS")) throw e;
    console.error("E_USAGE " + (e as Error).message);
    return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
