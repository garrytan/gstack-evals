#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// The tbv regression table: every case the frozen tbv-rule.ts.txt blocks, hits or refuses, run against the frozen rule and
// against the head rule (lanes/tbv/rule.ts, through the one adapter in adapt.ts). SUPERSET means the head blocks, hits or
// refuses every such case, except rows marked "ordered change", and every row matches its expected column.
//   bun lanes/tbv/regress.ts [--head <rule.ts>] [--out <table.md>]
// --head names the rule to test (default: this checkout's lanes/tbv/rule.ts); the port commit's rule gives the baseline.
// Base: GEVA-322's 41 matcher cases (H1 to H31, L1 to L10). Added before the first change: the underscore cases, fix-check
// 3's forms and their other-direction partners, amendment item 15's exemption, and the input guards.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
export const FROZEN = join(ROOT, "wiki/plans/2026-11-05-geva-313-trust-but-verify-prereg/tbv-rule.ts.txt");
const B = { heldIds: ["held-repo-x", "src/errors/codes.ts", "test_held_only"], devText: "dev history touches src/errors/codes.ts and other files", heldText: "the held out history says alpha beta gamma delta epsilon zeta eta theta iota kappa" };
const Wd = { heldIds: ["test_held"], devText: "dev touches test_held_only", heldText: "the parser test failed after the config change was made" };
const M = "the dev key says the parser test failed after the config change was made";
const h = (heldIds: string[], devText: string, artifact: string) => ({ heldIds, devText, heldText: "x", artifact });
const L = (names: string[], addedLines: string[], gstackAtC = "") => ({ addedLines, gstackAtC, material: M, names });

type Any = Record<string, any>;
const task = (id: string, source: "A" | "B", stratum = "long", nfacts = 2) => ({ id, cluster: id, source, stratum, nfacts });
const rdg = (id: string, t: Any, arm: string, model: string, pass: number, x: Any = {}) => ({ id, task: t.id, family: t.source === "A" ? "investigate" : "ship", arm, model, pass, status: "scored", judge: model === "opus" ? "sol" : "opus", facts: [...Array(t.nfacts)].map((_, i) => ({ in: i === 0, any: i === 0 })), unsupported: 0, exposed: arm === "none" || arm === "lens" ? null : true, words: 120, usd: 0.4, cacheRead: 0.8, ...x });
/** A small stage 1 readings file: two non-clean tasks, Opus none on three passes, full controls. */
function hr(mutate: (rd: Any) => void = () => {}) {
  const ts = [task("t1", "A"), task("t2", "B", "short")];
  const readings = ts.flatMap((t) => [1, 2, 3].map((p) => rdg(t.id + "p" + p, t, "none", "opus", p)));
  const controls = ts.flatMap((t) => ["sol", "opus"].flatMap((judge) => [{ task: t.id, kind: "stock", judge, facts: [{ in: false, any: false }, { in: false, any: false }] }, { task: t.id, kind: "oracle", judge, facts: [{ in: true, any: true }, { in: true, any: true }] }]));
  const rd: Any = { stage: "hr", tasks: ts, readings, controls, plan: { models: ["opus"], passes: { opus: 3 }, skillArms: ["none"] } };
  mutate(rd);
  return rd;
}

export type Case = { id: string; what: string; cmd: string; data: unknown; expected: string; note?: "ordered change" | "build fix" };
const c = (id: string, what: string, cmd: string, data: unknown, expected: string, note?: Case["note"]): Case => ({ id, what, cmd, data, expected, note });
export const CASES: Case[] = [
  c("H1", "pass 1: a shared id (src/errors/codes.ts) never blocks", "handoff", { ...B, artifact: "dev report about src/errors/codes.ts" }, "CLEAR"),
  c("H2", "pass 1: a held-out-only id blocks", "handoff", { ...B, artifact: "mentions test_held_only here" }, "BLOCK"),
  c("H3", "pass 1: an 8-word held-out run blocks", "handoff", { ...B, artifact: "x beta gamma delta epsilon zeta eta theta iota y" }, "BLOCK"),
  c("H4", "pass 1: test_held inside a longer dev name is held-out only", "handoff", { ...Wd, artifact: "mentions test_held here" }, "BLOCK"),
  c("H5", "pass 1: a re-punctuated 8-word run blocks", "handoff", { ...Wd, artifact: "The **parser test** failed, after `the config change` was made." }, "BLOCK"),
  c("H6", "pass 2: held-repo-x inside held-repo-xyz in the artifact blocks", "handoff", { ...B, artifact: "see held-repo-xyz" }, "BLOCK"),
  c("H7", "pass 2: test_held_only inside check_test_held_only_v2 blocks", "handoff", { ...B, artifact: "renames check_test_held_only_v2" }, "BLOCK"),
  c("H8", "pass 2: dashed id inside a longer dev name blocks", "handoff", h(["test-held"], "dev touches test-held-only", "mentions test-held here"), "BLOCK"),
  c("H9", "pass 2: dotted id inside a longer dev name blocks", "handoff", h(["test.held"], "dev touches test.held.v2", "mentions test.held here"), "BLOCK"),
  c("H10", "pass 2: slashed path inside a longer dev path blocks", "handoff", h(["a/b.ts"], "dev touches c/a/b.ts", "mentions a/b.ts"), "BLOCK"),
  c("H11", "pass 2: dev naming the id with a trailing period or comma shares it", "handoff", h(["test-held", "test.held"], "dev touches test-held. then test.held, done", "mentions test-held and test.held"), "CLEAR"),
  c("H12", "pass 2: artifact naming a held-out-only id with trailing punctuation blocks", "handoff", h(["test-held"], "x", "it touched test-held, then test-held."), "BLOCK"),
  c("H13", "fix-check #1: held-repo-x written as 'held repo x' blocks", "handoff", { ...B, artifact: "see held repo x" }, "BLOCK"),
  c("H14", "fix-check #1: TestParser.test_config written with '::' blocks", "handoff", h(["TestParser.test_config"], "x", "failing: TestParser::test_config"), "BLOCK"),
  c("H15", "fix-check #2: a held id with a trailing space blocks", "handoff", h(["held-repo-x "], "x", "see held-repo-x"), "BLOCK"),
  c("H16", "fix-check #2: a held id with a trailing CR blocks", "handoff", h(["held-repo-x\r"], "x", "see held-repo-x"), "BLOCK"),
  c("H17", "fix-check #4: '::' name inside a longer dev name is held-out only", "handoff", h(["tests/a.py::TestB"], "ran tests/a.py::TestB::test_c", "mentions tests/a.py::TestB"), "BLOCK"),
  c("H18", "fix-check #4: a space-joined name never counts as shared", "handoff", h(["parser handles empty config"], "parser handles empty config files", "the parser handles empty config case"), "BLOCK"),
  c("H19", "fix-check #4: '@' name inside a longer dev name is held-out only", "handoff", h(["user@host"], "ssh user@host.example", "mentions user@host"), "BLOCK"),
  c("H20", "other direction: dev naming a '::' id itself, then a colon, shares it", "handoff", h(["tests/a.py::TestB"], "ran tests/a.py::TestB: ok", "mentions tests/a.py::TestB"), "CLEAR"),
  c("H21", "other direction: dev naming an '@' id itself shares it", "handoff", h(["user@host"], "ssh user@host done", "mentions user@host"), "CLEAR"),
  c("H22", "other direction: a held id with a trailing CR that dev holds is shared", "handoff", h(["held-repo-x\r"], "dev touches held-repo-x", "see held-repo-x"), "CLEAR"),
  c("H23", "fix-check #3 (fails closed, named residual): a shared file dev shows only inside an absolute path blocks", "handoff", h(["src/errors/codes.ts"], "Read /workspace/gstack-evals/src/errors/codes.ts", "about src/errors/codes.ts"), "BLOCK"),
  c("H24", "fix-check 2 #1: test_x[a] inside test_x[a,b] in dev is held-out only", "handoff", h(["test_x[a]"], "ran test_x[a,b]", "failing test_x[a]"), "BLOCK"),
  c("H25", "fix-check 2 #1: tests/a.py::test_f[x] inside ...[x][y] in dev is held-out only", "handoff", h(["tests/a.py::test_f[x]"], "ran tests/a.py::test_f[x][y]", "failing tests/a.py::test_f[x]"), "BLOCK"),
  c("H26", "fix-check 2 #1: Bar#testX inside Bar#testX(int) in dev is held-out only", "handoff", h(["Bar#testX"], "ran Bar#testX(int)", "failing Bar#testX"), "BLOCK"),
  c("H27", "fix-check 2 #1: pkg+extra inside pkg+extra+more in dev is held-out only", "handoff", h(["pkg+extra"], "ran pkg+extra+more", "uses pkg+extra"), "BLOCK"),
  c("H28", "other direction: dev holding names whole after an opening bracket or a quote, or before a sentence-ending period, shares them", "handoff", h(["test_x[a]", "Bar#testX", "src/errors/codes.ts", "pkg+extra"], "ran (test_x[a]) and 'Bar#testX', then [src/errors/codes.ts]. It used pkg+extra.", "mentions test_x[a], Bar#testX, src/errors/codes.ts and pkg+extra"), "CLEAR"),
  c("H29", "other direction: dev holding a name inside double quotes or backticks shares it", "handoff", h(["src/errors/codes.ts", "user@host"], "read \"src/errors/codes.ts\" via `user@host`", "about src/errors/codes.ts and user@host"), "CLEAR"),
  c("H30", "fix-check 2 #2 (fails closed, named residual): a shared file dev cites only as path:line blocks", "handoff", h(["src/errors/codes.ts"], "see src/errors/codes.ts:42 and src/errors/codes.ts:10:", "edit src/errors/codes.ts"), "BLOCK"),
  c("H31", "fix-check 2 #2 (fails closed, named residual): a package dev cites only as name@version blocks", "handoff", h(["lodash"], "installed lodash@4.17.21", "uses lodash"), "BLOCK"),
  c("L1", "pass 1: added lines sharing an 8-word run with task material", "leak", L([], ["note: the parser test failed after the config change was made"], "unrelated text"), "HIT"),
  c("L2", "pass 1: the same run already in gstack at C is exempt", "leak", L([], ["note: the parser test failed after the config change was made"], "the parser test failed after the config change was made"), "CLEAN"),
  c("L3", "pass 1: a task name in added lines", "leak", L(["held-repo-x"], ["see held-repo-x"]), "HIT"),
  c("L4", "pass 1: a clean diff", "leak", L(["held-repo-x"], ["lead with failures, skips and unverified claims"]), "CLEAN"),
  c("L5", "pass 1: re-punctuated task material", "leak", L([], ["Note: the parser test failed, after the config change was made."], "unrelated text"), "HIT"),
  c("L6", "pass 2: repo-x inside held-repo-xyz", "leak", L(["repo-x"], ["see held-repo-xyz"]), "HIT"),
  c("L7", "fix-check #1: held-repo-x written as 'held repo x'", "leak", L(["held-repo-x"], ["see held repo x"]), "HIT"),
  c("L8", "fix-check #1: TestParser.test_config written with '::'", "leak", L(["TestParser.test_config"], ["failing: TestParser::test_config"]), "HIT"),
  c("L9", "fix-check #2: a name with a trailing space", "leak", L(["held-repo-x "], ["see held-repo-x"]), "HIT"),
  c("L10", "fix-check #2: a name with a trailing CR", "leak", L(["held-repo-x\r"], ["see held-repo-x"]), "HIT"),

  c("U1", "underscore gap: held-repo-x written held_repo_x in the artifact blocks", "handoff", h(["held-repo-x"], "x", "see held_repo_x"), "BLOCK"),
  c("U2", "underscore gap: test_held_only written test-held-only in the artifact blocks", "handoff", h(["test_held_only"], "x", "calls test-held-only"), "BLOCK"),
  c("U3", "underscore gap: test_held_only written test held only in the artifact blocks", "handoff", h(["test_held_only"], "x", "the test held only once"), "BLOCK"),
  c("U4", "underscore gap: held.repo.x and held::repo::x forms of held_repo_x block", "handoff", h(["held_repo_x"], "x", "see held.repo.x and held::repo::x"), "BLOCK"),
  c("U5", "underscore gap (fails closed): a generic two-token name read_file blocks on 'read file'", "handoff", h(["read_file"], "x", "we read file contents"), "BLOCK"),
  c("U6", "underscore gap: leak names held-repo-x written held_repo_x", "leak", L(["held-repo-x"], ["see held_repo_x"]), "HIT"),
  c("U7", "underscore gap: leak names test_held_only written test-held-only", "leak", L(["test_held_only"], ["calls test-held-only"]), "HIT"),
  c("U8", "other direction: dev naming test_held inside my_test_held keeps it held-out only", "handoff", h(["test_held"], "dev touches my_test_held", "mentions test_held"), "BLOCK"),
  c("F1", "fix-check 3: dev cites the shared file in markdown bold", "handoff", h(["src/x.ts"], "edited **src/x.ts** today", "about src/x.ts"), "CLEAR", "ordered change"),
  c("F2", "fix-check 3: dev cites the shared file in markdown italics in a list", "handoff", h(["src/x.ts"], "- *src/x.ts* edited", "about src/x.ts"), "CLEAR", "ordered change"),
  c("F3", "fix-check 3: dev cites the shared file inside XML tags", "handoff", h(["src/x.ts"], "<path>src/x.ts</path>", "about src/x.ts"), "CLEAR", "ordered change"),
  c("F4", "fix-check 3: dev cites the shared file in a table cell without spaces", "handoff", h(["src/x.ts"], "|src/x.ts|ok|", "about src/x.ts"), "CLEAR", "ordered change"),
  c("F5", "fix-check 3: dev passes the shared name as a --flag= value", "handoff", h(["held-repo-x"], "ran with --repo=held-repo-x", "see held-repo-x"), "CLEAR", "ordered change"),
  c("F6", "fix-check 3: 'held-repo-x?' stays held-out only (? is not whitelisted)", "handoff", h(["held-repo-x"], "is it held-repo-x? yes", "see held-repo-x"), "BLOCK"),
  c("F7", "fix-check 3: 'held-repo-x!' stays held-out only (! is not whitelisted)", "handoff", h(["held-repo-x"], "fixed held-repo-x!", "see held-repo-x"), "BLOCK"),
  c("F8", "other direction: bold around a longer path keeps the inner name held-out only", "handoff", h(["src/x.ts"], "edited **c/src/x.ts** today", "about src/x.ts"), "BLOCK"),
  c("F9", "other direction: a star on one side only keeps the name held-out only", "handoff", h(["src/x.ts"], "glob *src/x.ts matched", "about src/x.ts"), "BLOCK"),
  c("F10", "other direction: bold around path:line keeps the name held-out only", "handoff", h(["src/x.ts"], "see **src/x.ts:42**", "about src/x.ts"), "BLOCK"),
  c("F11", "other direction: a --flag= value that is a longer name keeps it held-out only", "handoff", h(["held-repo-x"], "ran with --repo=held-repo-x-2", "see held-repo-x"), "BLOCK"),
  c("F12", "other direction: an XML tag around a longer name keeps it held-out only", "handoff", h(["src/x.ts"], "<path>src/x.ts.bak</path>", "about src/x.ts"), "BLOCK"),
  c("F13", "other direction: a pipe after a joined name keeps it held-out only", "handoff", h(["a.ts"], "|b/a.ts|ok|", "about a.ts"), "BLOCK"),
  c("A15", "amendment item 15: a task name gstack at C holds whole is exempt from the leak check", "leak", L(["held-repo-x"], ["see held-repo-x"], "gstack already names held-repo-x here"), "CLEAN", "ordered change"),
  c("A15b", "amendment item 15: gstack at C holding only a longer name exempts nothing", "leak", L(["held-repo-x"], ["see held-repo-x"], "gstack names held-repo-xyz here"), "HIT"),
  c("A15c", "amendment item 15: gstack at C holding the name in bold exempts it (fix-check 3 boundaries)", "leak", L(["held-repo-x"], ["see held-repo-x"], "gstack names **held-repo-x** here"), "CLEAN", "ordered change"),
  c("G1", "guard: a duplicated reading is refused", "headroom", hr((rd) => rd.readings.push({ ...rd.readings[0] })), "REFUSED"),
  c("G2", "guard: a reading on an unknown task is refused", "headroom", hr((rd) => (rd.readings[0].task = "t9")), "REFUSED"),
  c("G3", "guard: a pass outside the plan is refused", "headroom", hr((rd) => (rd.readings[0].pass = 4)), "REFUSED"),
  c("G4", "guard: a label count that does not match the task is refused", "headroom", hr((rd) => rd.readings[0].facts.pop()), "REFUSED"),
  c("G5", "guard: a no-report reading with fact labels is refused", "headroom", hr((rd) => (rd.readings[0].status = "no-report")), "REFUSED"),
  c("G6", "guard: a second Opus none reading for a task and pass under the other family is refused", "headroom", hr((rd) => rd.readings.push({ ...rd.readings[0], id: "dup", family: "ship" })), "REFUSED"),
  c("G7", "guard: a negative unsupported count is refused", "headroom", hr((rd) => (rd.readings[0].unsupported = -1)), "REFUSED"),
  c("G8", "guard: the small stage 1 file runs at both heads", "headroom", hr(), "NO"),
  c("I1", "item 1: a source A reading labelled ship is refused", "headroom", hr((rd) => (rd.readings[0].family = "ship")), "REFUSED", "build fix"),
  c("I4", "item 4: a planned task missing from the readings file is refused", "headroom", hr((rd) => (rd.plan.taskIds = ["t1", "t2", "t3"])), "REFUSED", "build fix"),
  c("I5", "item 5: a reading judged by its own model's family is refused", "headroom", hr((rd) => (rd.readings[0].judge = "opus")), "REFUSED", "build fix"),
  c("I6", "item 6: a copied reading (shared response id) under a new label is refused", "headroom", hr((rd) => { rd.readings[1].responseIds = ["same"]; rd.readings[2].responseIds = ["same"]; }), "REFUSED", "build fix"),
];

const bad = (v: string) => v === "BLOCK" || v === "HIT" || v === "REFUSED";
/** Runs every case at the frozen rule and at the head rule and returns the table and the count of failing rows. */
export function table(cases: Case[] = CASES, headRule = join(import.meta.dir, "rule.ts")) {
  const dir = mkdtempSync(join(tmpdir(), "tbv-regress-"));
  try {
    copyFileSync(FROZEN, join(dir, "tbv-rule.ts"));
    writeFileSync(join(dir, "head.ts"), [
      "import { spawnSync } from 'node:child_process';",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { frozenToHead } from " + JSON.stringify(join(import.meta.dir, "adapt.ts")) + ";",
      "const [cmd, file] = process.argv.slice(2) as [string, string];",
      "const a = frozenToHead(cmd, JSON.parse(readFileSync(file, 'utf8')));",
      "writeFileSync(file + '.head.json', JSON.stringify(a.data));",
      "if (a.split) writeFileSync(file + '.split.json', a.split.text);",
      "const r = spawnSync('bun', [" + JSON.stringify(headRule) + ", cmd, file + '.head.json', ...(a.split ? ['--split', file + '.split.json'] : [])], { stdio: 'inherit' });",
      "process.exit(r.status ?? 1);",
    ].join("\n"));
    const env: Record<string, string> = { ...(process.env as Record<string, string>), GSTACK_EVALS_SCORER: ROOT };
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "UBICLOUD_API_KEY"]) delete env[k];
    const verdict = (script: string, cmd: string, f: string) => {
      const r = spawnSync("bun", [join(dir, script), cmd, f], { encoding: "utf8", env });
      if (r.status === 2 && r.stderr.startsWith("E_USAGE")) return "REFUSED";
      if (r.status !== 0) return "ERR(" + r.status + ")";
      return (r.stdout.split("\n").find((l) => l.startsWith("Verdict: ")) ?? "").slice(9).split(" ")[0] || "?";
    };
    const rows: string[] = ["| case | what | frozen tbv-rule.ts.txt | head | expected |", "|---|---|---|---|---|"];
    let failing = 0;
    for (const k of cases) {
      const f = join(dir, k.id + ".json");
      writeFileSync(f, JSON.stringify(k.data));
      const frozen = verdict("tbv-rule.ts", k.cmd, f), now = verdict("head.ts", k.cmd, f);
      const lost = bad(frozen) && !bad(now) && k.note !== "ordered change";
      const miss = now !== k.expected;
      if (lost || miss) failing++;
      rows.push("| " + k.id + " | " + k.what + " | " + frozen + " | " + now + " | " + k.expected + (k.note ? " (" + k.note + ")" : "") + (lost ? " LOST" : "") + (miss ? " MISMATCH" : "") + " |");
    }
    rows.push("", "SUPERSET_AND_EXPECTED: " + (failing ? "FAIL " + failing : "ok") + " (" + cases.length + " cases; the head blocks, hits or refuses wherever the frozen rule does, except rows marked ordered change, and matches the expected column)");
    return { text: rows.join("\n"), failing };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function main(argv: string[]): number {
  const i = argv.indexOf("--out"), j = argv.indexOf("--head");
  const { text, failing } = table(CASES, j >= 0 && argv[j + 1] ? resolve(argv[j + 1]!) : undefined);
  if (i >= 0 && argv[i + 1]) writeFileSync(argv[i + 1]!, text + "\n");
  console.log(text);
  return failing ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
