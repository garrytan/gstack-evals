// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review run side's dry-run cases (prereg 2026-11-08-geva-405, section 16 item 4), which the score side's dry run
// calls. Each case drives the code: the parser and normalizer, erOutcome, retries and endStateOf on built transcripts,
// unit trees built from a temp git repository, the docker sandbox's arguments through a recording docker stand-in, the
// renderer and the candidate's install checks on a gstack clone, the Stop hook, the OpenRouter routing the proxy sends,
// and the keyless test files for the detectors and for the loop through the real Agent SDK.
//
// Build-time choices: the gstack clone is GSTACK_EVALS_ER_GSTACK, else ~/.capy/work/gstack, else a fresh clone of
// https://github.com/garrytan/gstack in a temp dir (removed after). A test file case passes only when bun test exits 0
// with no failed or skipped test.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeEnv, DISALLOWED_TOOLS } from "../../src/adapters/claude-code/driver.ts";
import { REPO_ROOT } from "../../src/cli.ts";
import { chatPrice, openRouterRouting } from "../../src/runner/pricing/prices.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import { dockerSandbox } from "../../src/trial/sandbox.ts";
import { buildErTree, clonePinProblems, ER_GSTACK_URL, ER_PINS, erAdmits, erUnitProblems, installPinProblems, safeGit } from "../../src/trial/review/eng-review.ts";
import { endStateOf, erOutcome, normalizeEngPlan, parseEngPlan, retries } from "./parse.ts";
import { renderEngPhase } from "./render.ts";
import { erStopHook } from "./stophook.ts";

type Case = { name: string; pass: boolean; detail: string };
const tick = "\u0060\u0060\u0060";
const say = (t: string) => JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "text", text: t }] } });
const nd = (...l: string[]) => l.join("\n") + "\n";
const block = tick + "eng-plan\n" + JSON.stringify({ paths: ["a.py f"], checks: ["unit test of f"] }) + "\n" + tick;

function testFile(file: string): { pass: boolean; detail: string } {
  const r = spawnSync(process.execPath, ["test", file], { cwd: REPO_ROOT, encoding: "utf8", timeout: 300_000 });
  const text = r.stdout + r.stderr;
  const pass = r.status === 0 && /\b0 fail\b/.test(text) && !/\(skip\)|\b[1-9]\d* skip\b/.test(text);
  return { pass, detail: file + ": " + ((/(\d+) pass/.exec(text)?.[1] ?? "0") + " pass, " + (/(\d+) fail/.exec(text)?.[1] ?? "?") + " fail") + (/\(skip\)/.test(text) ? ", skipped tests" : "") };
}

function repoUnit(root: string, id: string, commits: number): void {
  const repo = join(root, id, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(root, id, "unit.json"), JSON.stringify({ id }));
  writeFileSync(join(root, id, "plan.md"), "Add a nightly export.\n");
  writeFileSync(join(root, id, "key.json"), JSON.stringify({ items: ["sealed"] }));
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=Test Writer", "-c", "user.email=test@example.invalid", "-C", repo, ...a]);
  git("init", "-q");
  for (let i = 0; i < commits; i++) {
    writeFileSync(join(repo, "f" + i + ".py"), "x = " + i + "\n");
    git("add", ".");
    git("commit", "-q", "-m", "c" + i);
  }
}

function gstackClone(scratch: string): string | null {
  const given = process.env.GSTACK_EVALS_ER_GSTACK ?? join(homedir(), ".capy", "work", "gstack");
  if (existsSync(join(given, ".git"))) return given;
  const dir = join(scratch, "gstack");
  return safeGit(scratch, ["clone", "--quiet", "--no-checkout", ER_GSTACK_URL, dir]).status === 0 ? dir : null;
}

export async function runSideChecks(): Promise<Case[]> {
  const scratch = mkdtempSync(join(tmpdir(), "er-run-checks-"));
  const cases: Case[] = [];
  const add = (name: string, f: () => { pass: boolean; detail: string }) => {
    try {
      cases.push({ name, ...f() });
    } catch (e) {
      cases.push({ name, pass: false, detail: "threw: " + (e as Error).message });
    }
  };
  try {
    add("normalization and the lenient parse", () => {
      const strict = parseEngPlan(["x\n" + block]);
      const lenient = parseEngPlan([tick + "json\n" + '{"paths": ["a"],}' + "\n" + tick]);
      const heads = parseEngPlan(["Paths:\n" + tick + '\n["a"]\n' + tick + "\nChecks:\n" + tick + '\n["b"]\n' + tick]);
      const none = parseEngPlan(["no block here"]);
      const n = normalizeEngPlan(Array(16).fill("**p** " + "w ".repeat(30)), Array(9).fill("1. " + "c ".repeat(45)));
      const pass = strict.kind === "block" && strict.lenient === null && lenient.kind === "block" && JSON.stringify(lenient.lenient) === '["label","commas","one-key"]' && heads.kind === "block" && JSON.stringify(heads.lenient) === '["headings"]' && none.kind === "no-block" && n.paths.length === 15 && n.checks.length === 8 && n.paths[0]!.split(" ").length === 25 && n.checks[0]!.split(" ").length === 40 && n.cut === 23 && !n.paths[0]!.includes("*");
      return { pass, detail: "strict, lenient (label, commas, one-key), headings and no-block parses; 15 paths and 8 checks kept, cut at 25 and 40 words" };
    });
    add("a no-block reply", () => {
      const r = erOutcome({ kind: "completed" }, nd(say("A review with no block.")));
      return { pass: r.outcome.state === "no-block" && JSON.stringify(endStateOf(r.outcome)) === '{"end":"no-block","arm_stop":false}', detail: "a completed reply with no block is no-block, scored 0" };
    });
    add("an arm stop scored 0 after its retry beside a provider error left missing", () => {
      const stop = erOutcome({ kind: "turn_cap" }, nd(say("Working.")));
      const infra = erOutcome({ kind: "missing", code: "UPSTREAM" }, nd(say("Working.")));
      const pass = stop.outcome.state === "arm-stop" && retries(stop.outcome, 1) && !retries(stop.outcome, 2) && JSON.stringify(endStateOf(stop.outcome)) === '{"end":"no-block","arm_stop":true}' && infra.outcome.state === "infra" && retries(infra.outcome, 1) && !retries(infra.outcome, 2) && endStateOf(infra.outcome)?.end === "missing";
      return { pass, detail: "turn_cap: one retry, then no-block with arm_stop (E_ER_ARM_STOP); UPSTREAM: one retry, then missing (E_ER_INFRA_MISSING)" };
    });
    add("each session limit", () => {
      const reason = (t: Parameters<typeof erOutcome>[0], tr = nd(say("Working."))) => {
        const o = erOutcome(t, tr).outcome;
        return o.state === "arm-stop" ? o.reason : o.state;
      };
      const overflow = nd(JSON.stringify({ type: "result", is_error: true, result: "Prompt is too long" }));
      const got = [reason({ kind: "turn_cap" }), reason({ kind: "timeout" }), reason({ kind: "allowance_stop" }), reason({ kind: "missing", code: "UPSTREAM" }, overflow)];
      const env = claudeCodeEnv({ model: "m", provider: "anthropic", proxy: { baseUrl: "http://p", slot: "s", token: "t" }, disable1mContext: true });
      const pass = got.join(",") === "turn limit,harness timeout,allowance stop,context overflow" && env.CLAUDE_CODE_DISABLE_1M_CONTEXT === "1" && env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS === "1";
      return { pass, detail: got.join(", ") + "; the session env sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1 and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1" };
    });
    add("a web-contaminated session", () => {
      const web = nd(JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "text", text: block }, { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://example.com" }] }] } }));
      const r = erOutcome({ kind: "completed" }, web);
      return { pass: r.outcome.state === "contaminated" && endStateOf(r.outcome)?.end === "contaminated", detail: "a successful web result makes the session contaminated (E_ER_WEB_CONTAMINATED), excluded as missing" };
    });
    add("refusal of WebSearch and WebFetch", () => ({ pass: DISALLOWED_TOOLS.join(",") === "WebSearch,WebFetch", detail: "the driver passes --disallowedTools=" + DISALLOWED_TOOLS.join(",") + " (the real-SDK case below checks the CLI's argv)" }));
    add("the mounts with key.json absent and no later git history", () => {
      const units = join(scratch, "units");
      repoUnit(units, "one", 1);
      repoUnit(units, "two", 2);
      const tree = buildErTree(units, "one", join(scratch, "tree"));
      const later = erUnitProblems(units, "two");
      const log = join(scratch, "docker.log");
      const fake = join(scratch, "docker");
      writeFileSync(fake, "#!/bin/sh\necho \"$@\" >> " + log + "\n");
      chmodSync(fake, 0o755);
      dockerSandbox({ trialImage: "img", docker: fake }).agent("t", { work: join(scratch, "tree"), env: {}, root: true, mounts: [{ host: join(scratch, "m.md"), path: "/work/autoplan/methodology.md" }] }).stop();
      const args = readFileSync(log, "utf8");
      const pass = tree.problems.length === 0 && !existsSync(join(scratch, "tree", "key.json")) && later.some((p) => /2 commits/.test(p)) && args.includes(join(scratch, "tree") + ":/work ") && args.includes(join(scratch, "m.md") + ":/work/autoplan/methodology.md:ro") && args.includes("-w /work ");
      return { pass, detail: "the tree is plan.md and repo/ at one commit with no key.json; a repo with a later commit is refused; docker mounts the work dir at /work and the eng phase input read-only" };
    });
    add("each detector on its exposed and unexposed fixtures, the candidate's Status: no-plan included", () => testFile("tests/er/exposure.test.ts"));
    add("the Stop hook's two blocks and its release", () => {
      const hook = erStopHook("candidate", (t) => ({ transcript: t, stateRoot: null, coverage: null, opening: null }));
      const seq = [hook.onStop(nd(say("x"))), hook.onStop(nd(say("x"))), hook.onStop(nd(say("x")))];
      return { pass: typeof seq[0] === "string" && typeof seq[1] === "string" && seq[2] === null && hook.blocks() === 2, detail: "blocks, blocks, releases; " + hook.blocks() + " blocks" };
    });
    add("the session loop through the real Agent SDK: retries, end states, the Stop hook and admission", () => testFile("tests/er/run-sdk.test.ts"));
    add("admission per attempt", () => ({ pass: erAdmits(5e6, 10e6, 10e6, 25e6) && !erAdmits(5e6 + 1, 10e6, 10e6, 25e6) && erAdmits(0, 0, 10e6, 10e6) && !erAdmits(0, 0, 10e6, 10e6 - 1), detail: "settled plus in-flight allowances plus its own allowance must fit under the cap" }));
    const clone = gstackClone(scratch);
    add("the renderer on a plan.md without its headings", () => {
      if (!clone) return { pass: false, detail: "no gstack clone" };
      const wt = join(scratch, "engphase");
      safeGit(clone, ["worktree", "add", "--quiet", "--detach", wt, ER_PINS.engphase.sha]);
      const o = renderEngPhase({ gstack: wt, plan: "Add a nightly export of the ledger to CSV. Keep the old report.\n", out: join(scratch, "opening") });
      safeGit(clone, ["worktree", "remove", "--force", wt]);
      return { pass: o.text.length > 0 && o.readRanges.length > 0 && o.files.some((f) => f.mount === o.methodology) && !o.text.includes(scratch), detail: "opening sha256 " + o.sha256 + ", " + o.files.length + " read-only files, " + o.readRanges.length + " readRanges" };
    });
    add("the candidate's install at its pinned commit with both digests checked", () => {
      if (!clone) return { pass: false, detail: "no gstack clone" };
      const pins = clonePinProblems(clone);
      const wt = join(scratch, "candidate");
      safeGit(clone, ["worktree", "add", "--quiet", "--detach", wt, ER_PINS.candidate.sha]);
      const home = join(scratch, "home");
      mkdirSync(join(home, ".claude", "skills", "plan-coverage"), { recursive: true });
      copyFileSync(join(wt, "plan-coverage", "SKILL.md"), join(home, ".claude", "skills", "plan-coverage", "SKILL.md"));
      const ok = installPinProblems("candidate", wt, home);
      writeFileSync(join(home, ".claude", "skills", "plan-coverage", "SKILL.md"), "edited\n");
      const tampered = installPinProblems("candidate", wt, home);
      safeGit(clone, ["worktree", "remove", "--force", wt]);
      return { pass: pins.length === 0 && ok.length === 0 && tampered.length === 1, detail: "clone pins " + (pins.length ? pins.join("; ") : "ok") + "; installed tree " + (ok.length ? ok.join("; ") : "ok") + "; an edited installed skill is refused" };
    });
    add("the Sol and particle-1 provider pins", () => {
      const sol = openRouterRouting(chatPrice("openrouter:openai/gpt-6.1-sol")!) as Record<string, unknown>;
      const particle = openRouterRouting(chatPrice("openrouter:particle-ai/particle-1")!) as Record<string, unknown>;
      const pass = JSON.stringify(sol.only) === '["openai"]' && sol.allow_fallbacks === false && sol.data_collection === "deny" && JSON.stringify(particle.only) === '["particle-ai"]' && particle.allow_fallbacks === false && particle.data_collection === "deny";
      return { pass, detail: "Sol " + JSON.stringify({ only: sol.only, allow_fallbacks: sol.allow_fallbacks, data_collection: sol.data_collection }) + "; particle-1 " + JSON.stringify({ only: particle.only, allow_fallbacks: particle.allow_fallbacks, data_collection: particle.data_collection }) };
    });
  } finally {
    removeTree(scratch);
  }
  return cases;
}
