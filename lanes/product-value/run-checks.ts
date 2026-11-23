// Copyright (c) 2026 Garry Tan. MIT License.
// The run side's dry-run checks (prereg 2026-11-08-geva-403 section 17 item 4), plugged into pv dryrun through
// RUN_SIDE_HOOK. Each frozen run-side rule passes only when every keyless test that drives it ran and passed (parse,
// exposure and the run loop through the real pinned Agent SDK and the stub CLI), plus direct checks on the denied web
// tools and on both families' mounts.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISALLOWED_TOOLS } from "../../src/adapters/claude-code/driver.ts";
import { REPO_ROOT } from "../../src/cli.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { mountProblems } from "../../src/trial/review/product-value.ts";
import { RUN_SIDE_RULES } from "./dryrun.ts";

const FILES = ["tests/pv/parse.test.ts", "tests/pv/exposure.test.ts", "tests/pv/run.test.ts"];

/** Each rule's driving tests: describe blocks (every test in them) and single tests, by exact name. */
const DRIVERS: Array<{ suites?: string[]; tests?: string[]; file?: string }> = [
  { suites: ["the strict parse and the one lenient parse", "the normalizer"] },
  { tests: ["each infrastructure failure gets its named reason", "end states: an infrastructure failure on the retry is missing; a cap stop has none", "each attempt sends its arm's frozen prompt, the retry included", "one parse per session with the parser's sha256; end states after the one retry; contamination and missing"] },
  { tests: ["a successful web result contaminates the session, a subagent's included; a refused call does not", "one parse per session with the parser's sha256; end states after the one retry; contamination and missing"] },
  { tests: ["the session sees plan.md and context/ only; units.json and stops.json record the run"] },
  { file: "tests/pv/exposure.test.ts", tests: ["exposed: the handoff, a 0F proposal in an expansion mode, and sections 9 and 10; the block carries a pending proposal"] },
];

const unescape = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

interface Case { name: string; suite: string; file: string; ok: boolean }

function runTests(): { cases: Case[]; error: string | null } {
  const dir = mkdtempSync(join(tmpdir(), "pv-run-checks-"));
  try {
    const xml = join(dir, "junit.xml");
    const r = spawnSync(process.execPath, ["test", ...FILES, "--reporter=junit", "--reporter-outfile=" + xml], { cwd: REPO_ROOT, encoding: "utf8", timeout: 240_000 });
    let text = "";
    try {
      text = readFileSync(xml, "utf8");
    } catch {
      return { cases: [], error: "bun test wrote no report (exit " + r.status + ")" };
    }
    const cases: Case[] = [];
    for (const m of text.matchAll(/<testcase ([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const attr = (k: string) => unescape(new RegExp(k + '="([^"]*)"').exec(m[1]!)?.[1] ?? "");
      cases.push({ name: attr("name"), suite: attr("classname"), file: attr("file"), ok: !/<(failure|error|skipped)/.test(m[3] ?? "") });
    }
    return { cases, error: null };
  } finally {
    removeTree(dir);
  }
}

export async function runSideChecks(): Promise<Array<{ rule: string; pass: boolean; detail?: string }>> {
  const { cases, error } = runTests();
  const web = DISALLOWED_TOOLS.length === 2 && DISALLOWED_TOOLS.includes("WebSearch") && DISALLOWED_TOOLS.includes("WebFetch") && /disallowedTools: DISALLOWED_TOOLS/.test(readFileSync(join(REPO_ROOT, "src/adapters/claude-code/driver.ts"), "utf8"));
  const mounts = mountProblems(["plan.md", "context/a.md"], "plan").length === 0 && mountProblems(["brief.md", "context/a.md"], "brief").length === 0 && mountProblems(["plan.md", "context/a.md", "key.json"], "plan").length === 1 && mountProblems(["brief.md", "context/a.md", "unit.json"], "brief").length === 1 && mountProblems(["plan.md", "brief.md", "context/a.md"], "brief").length === 1 && mountProblems(["brief.md"], "brief").length === 1;
  return RUN_SIDE_RULES.map((rule, i) => {
    const d = DRIVERS[i]!;
    const picked = cases.filter((c) => d.suites?.includes(c.suite) || d.tests?.includes(c.name) || (d.file !== undefined && c.file === d.file));
    const missing = (d.tests ?? []).filter((t) => !cases.some((c) => c.name === t)).concat((d.suites ?? []).filter((s) => !cases.some((c) => c.suite === s)));
    const failed = picked.filter((c) => !c.ok).map((c) => c.name);
    const extra = i === 2 ? web : i === 3 ? mounts : true;
    const pass = error === null && picked.length > 0 && !missing.length && !failed.length && extra;
    const detail = error ?? picked.length + " tests" + (missing.length ? "; missing: " + missing.join(" | ") : "") + (failed.length ? "; failed: " + failed.join(" | ") : "") + (i === 2 ? "; driver denies " + DISALLOWED_TOOLS.join(", ") : "") + (i === 3 ? "; both families' mounts " + (mounts ? "hold" : "fail") : "");
    return { rule, pass, detail };
  });
}
