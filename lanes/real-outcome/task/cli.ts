// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals real task: build a task directory, check V1 to V9 and the leak checks in Docker, and grade one tree
// under test with the verifier. Keyless: nothing here calls a model. Upstream tasks build and run only on hosts whose
// environment holds no provider or GitHub credential.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CODES, docAnchor, type ReasonCode } from "../../../src/errors/codes.ts";
import { buildTask, saveTask } from "./build.ts";
import { buildImage, checkTask } from "./check.ts";
import { readTask, regressionDigest, TaskError } from "./format.ts";
import { resultFor } from "./record.ts";
import { allPass, requiredTests, verifyTree } from "./verify.ts";

export const HELP = `Usage: gstack-evals real task <command> [options]

  build --spec <spec.json> --repo-dir <full clone> --out <task dir>
      Build a task directory (lanes/real-outcome/task/SPEC.md) from a build spec and a local clone. Reads git objects
      only; refuses an upstream task on a host whose environment holds a credential.
  check <task dir> [--runs <n>] [--seed <n>] [--cpus <n>] [--work <dir>] [--mechanical] [--freeze-regression]
        [--out <check.json>]
      Build the agent image and run the leak checks and V1 to V9. Exit 0 when the task is valid and its regression list
      is frozen, 1 when a rule fails or the list is not frozen (the verdict and each rule print on stdout). --runs sets
      V1's gold runs (default 10). --mechanical skips V4 and V5's audit records. --freeze-regression writes the derived
      regression and quarantine lists and their digest into task.json.
  verify <task dir> --patch <file> [--runs <n>] [--seed <n>] [--work <dir>] [--out <file>]
      Grade one tree under test (a patch against the task's starting tree) with the hidden tests, as the scorer
      does. Prints each required test's result and whether all passed. Refuses a task whose regression list check
      --freeze-regression did not freeze (E_REAL_TASK_FORMAT), and a run the verifier never started (E_REAL_TASK_DOCKER).
`;

function fail(code: ReasonCode, message: string): number {
  const info = CODES[code];
  console.error([code + " " + message, code + " fix: " + info.fix, code + " docs: " + docAnchor(code)].join("\n"));
  return info.exit ?? 2;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return cmd === undefined ? 2 : 0;
  }
  let parsed: { values: Record<string, string | boolean | undefined>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: true,
      options: {
        spec: { type: "string" },
        "repo-dir": { type: "string" },
        out: { type: "string" },
        runs: { type: "string" },
        seed: { type: "string" },
        cpus: { type: "string" },
        work: { type: "string" },
        mechanical: { type: "boolean" },
        "freeze-regression": { type: "boolean" },
        patch: { type: "string" },
      },
    }) as typeof parsed;
  } catch (error) {
    return fail("E_USAGE", (error as Error).message);
  }
  const v = parsed.values;
  const s = (k: string) => v[k] as string | undefined;
  const num = (k: string, d: number) => (s(k) === undefined ? d : Number(s(k)));
  for (const [k, min] of [["runs", 1], ["seed", 0]] as const) {
    const x = s(k);
    if (x !== undefined && !(/^\d+$/.test(x) && Number(x) >= min)) return fail("E_USAGE", "--" + k + " must be a whole number of at least " + min);
  }
  if (s("cpus") !== undefined && !(/^\d+(\.\d+)?$/.test(s("cpus")!) && Number(s("cpus")) > 0)) return fail("E_USAGE", "--cpus must be a positive number");
  const work = s("work") ? resolve(s("work")!) : mkdtempSync(join(tmpdir(), "real-task-"));
  mkdirSync(work, { recursive: true });
  try {
    if (cmd === "build") {
      if (!s("spec") || !s("repo-dir") || !s("out")) return fail("E_USAGE", "build needs --spec, --repo-dir and --out");
      const r = buildTask(resolve(s("spec")!), resolve(s("repo-dir")!), resolve(s("out")!));
      console.log("built " + r.task.id + " (" + r.task.kind + ") at " + r.dir + ": " + r.task.new_test_files.length + " new test files, " + Object.keys(r.task.files).length + " files");
      return 0;
    }
    const dir = parsed.positionals[0] ? resolve(parsed.positionals[0]) : undefined;
    if (!dir) return fail("E_USAGE", cmd + " needs a task directory");
    if (cmd === "check") {
      const result = checkTask({ taskDir: dir, work, runs: num("runs", 10), seed: num("seed", 1), cpus: s("cpus") ? Number(s("cpus")) : undefined, mechanical: v.mechanical === true });
      if (s("out")) writeFileSync(resolve(s("out")!), JSON.stringify(result, null, 2) + "\n");
      for (const r of result.rules) console.log((r.pass ? "PASS " : "FAIL ") + r.rule + ": " + r.detail);
      const frozen = result.regression_frozen || v["freeze-regression"] === true;
      console.log("verdict: " + result.verdict + (result.verdict === "valid" && !frozen ? ", regression not frozen (verify refuses the task until check --freeze-regression writes the list)" : "") + " (" + result.task + ", image " + result.image.tag + ")");
      if (result.verdict !== "valid") return 1;
      if (v["freeze-regression"]) {
        const t = readTask(dir);
        t.tests.regression = result.derived.regression;
        t.tests.quarantine = result.derived.quarantine;
        t.tests.regression_frozen = regressionDigest(t);
        saveTask(dir, t);
        console.log("froze " + result.derived.regression.length + " regression tests and " + result.derived.quarantine.length + " quarantined ones into task.json");
      }
      return frozen ? 0 : 1;
    }
    if (cmd === "verify") {
      if (!s("patch")) return fail("E_USAGE", "verify needs --patch");
      const t = readTask(dir);
      const required = requiredTests(t);
      const image = buildImage(dir, t);
      const tree = verifyTree({ taskDir: dir, task: t, image: image.tag, label: "verify", patch: readFileSync(resolve(s("patch")!), "utf8"), runs: num("runs", 1), seed: num("seed", 1), work });
      const out = { task: t.id, image: image.tag, prepare: tree.prepare, all_pass: allPass(tree, required), runs: tree.runs.map((r) => ({ seed: r.seed, wall_ms: r.wall_ms, timed_out: r.timed_out, results: Object.fromEntries(required.map((id) => [id, resultFor(r.parsed, id)])) })) };
      if (s("out")) writeFileSync(resolve(s("out")!), JSON.stringify(out, null, 2) + "\n");
      for (const id of required) console.log(id + " " + tree.runs.map((r) => resultFor(r.parsed, id).status).join(","));
      console.log("all_pass: " + out.all_pass);
      return 0;
    }
    return fail("E_USAGE", "unknown command " + JSON.stringify(cmd) + "; gstack-evals real task --help lists them");
  } catch (error) {
    if (error instanceof TaskError) return fail(error.code, error.message);
    throw error;
  } finally {
    if (!s("work")) rmSync(work, { recursive: true, force: true });
  }
}
