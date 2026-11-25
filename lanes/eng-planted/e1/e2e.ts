#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's driven launch (prereg 2026-11-24-geva-587-design-time-state-modeling section 10), keyless: the pilot's own
// commands (ep e1-reviews, e1-builds and e1-pilot, phase pilot) on one Go fixture unit, with the real review launcher
// (launch.ts e1ReviewLauncher on the Docker rig: the metering proxy, the trial image, the tools volume, each arm's install
// at its pin, Claude Code for Opus and particle-1, Codex CLI 0.170.0 for Sol) and the real build launcher (eng-build
// launch.ts buildLauncher: Harbor at its pin, real_agent, the sandbox sidecar, the session image). A stub upstream in this
// process stands in for every model: in a review it runs one shell command per arm, then ends its turn; in a build it reads
// /work/review/, writes the fixed Mul and a test, then ends its turn. The commands are:
//   every arm   writes /tmp/e1-dry-note.md (the /tmp capture)
//   N, G        rewrites plan.md with a review section
//   D           rewrites plan.md with a 4-line state diagram
//   C, P        writes a TLA+ model under /tmp and checks it with "$JAVA" -cp "$TLA2TOOLS" tlc2.TLC, then rewrites plan.md
//   N on particle-1 refuses with no tool call, so its build runs on the plan as left
// Every lease opens on a temporary ledger whose items are inited here as the run's are, and settles. Every key variable is
// removed first; the upstream key is a placeholder only the stub sees. It prints one PASS or FAIL line per check, with
// counts, outcome words and fixture file names only (no pstack or gstack text), then tears down what it started and checks
// that no container or network it made is left.
// Usage: bun lanes/eng-planted/e1/e2e.ts --pstack <pstack checkout at the pin> [--harbor <bin>] [--p-command <cmd>] [--keep]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sse } from "../../../quick/laneb/runner/fake_upstream.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { machineId, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { dropKeyEnv } from "../../../src/trial/env.ts";
import { goRepo, GO_CALC, GO_FIXED } from "../../../tests/eng-build/fixture.ts";
import { BUILD_LINE } from "../../eng-build/build-stage.ts";
import { EB_FORCED } from "../../eng-build/arms.ts";
import { removeCoverageImages } from "../../eng-build/coverage.ts";
import { buildLauncher } from "../../eng-build/launch.ts";
import { unitGrader } from "../../eng-build/pipeline.ts";
import { removeLabelled } from "../../eng-build/screen.ts";
import { removeSessionImages } from "../../eng-build/session-image.ts";
import { buildUnit } from "../../eng-build/unit.ts";
import { buildToolsVolume, tla2tools } from "../../outcome-skills/pfchecks/tools.ts";
import { startSidecar } from "../../real-outcome/sandbox/sidecar.ts";
import { ebSession, type MountTable } from "../stages/build.ts";
import { stagePlan } from "../stages/rerun-log.ts";
import { armName } from "../../eng-build/build-stage.ts";
import type { Command, PlantedUnit } from "../types.ts";
import { C_LINE, D_LINE, P_COMMANDS, P_TAIL, pMarker, type PCommand } from "./arms.ts";
import { e1Commands, E1_PROGRAM, E1_REAL, E1_RUN, E1_SKILL, type E1Seams } from "./commands.ts";
import { E1_ARMS, RUNS_ON, type E1Arm, type E1Model } from "./frozen.ts";
import { e1ReviewLauncher } from "./launch.ts";
import { cellKey, E1_ITEMS, mountDir, reviewRecordPath, buildRecordPath, type E1Build, type E1ReviewRecord } from "./pipeline.ts";

export interface Check {
  check: string;
  ok: boolean;
  detail: string;
}

const D = 1_000_000;
const AUTHORED = "# Plan\n\nAdd Mul(a, b int) int to the calculator, with tests.\n";
const REVIEWED = AUTHORED + "\n## Review\n\nTest Mul with a zero on either side.\n";
const DIAGRAMMED = REVIEWED + "\n## States\n\n" + ["Idle --start--> Running", "Running --finish--> Done", "Running --cancel--> Idle", "Done --start--> refused (Done is final)"].join("\n") + "\n";
const TLA = '---- MODULE m ----\nVARIABLE s\nInit == s = "idle"\nNext == \\/ (s = "idle" /\\ s\' = "run")\n        \\/ (s = "run" /\\ s\' = "done")\n        \\/ (s = "done" /\\ s\' = "done")\nOk == s \\in {"idle", "run", "done"}\n====\n';
const CFG = "INIT Init\nNEXT Next\nINVARIANT Ok\n";
const REPLY = "Review done: the plan now says how to test Mul.";
const REFUSAL = "I can't help with reviewing this plan.";
const NOTE = "/tmp/e1-dry-note.md";
const b64 = (s: string) => Buffer.from(s).toString("base64");
const put = (text: string, path: string) => "echo " + b64(text) + " | base64 -d > " + path;
const TLC = '"$JAVA" -cp "$TLA2TOOLS" tlc2.TLC -config /tmp/m.cfg /tmp/m.tla';

/** The one shell command a review session runs for its arm; null for the refusal. */
export function armCommand(arm: E1Arm, model: E1Model): string | null {
  if (arm === "N" && model === "particle") return null;
  const note = put("dry-run note for " + arm + " on " + model + "\n", NOTE);
  if (arm === "D") return note + " && " + put(DIAGRAMMED, "/work/plan.md");
  if (arm === "C" || arm === "P") return note + " && " + put(TLA, "/tmp/m.tla") + " && " + put(CFG, "/tmp/m.cfg") + " && cd /tmp && " + TLC + " && " + put(REVIEWED, "/work/plan.md");
  return note + " && " + put(REVIEWED, "/work/plan.md");
}

/** The arm a review request's text belongs to, or "build"; G before P, P before C, C before D. */
export function armOfText(text: string): E1Arm | "build" | null {
  if (text.includes(BUILD_LINE)) return "build";
  if (text.includes(JSON.stringify(EB_FORCED).slice(1, -1))) return "G";
  if (text.includes(JSON.stringify(P_TAIL).slice(1, -1))) return "P";
  if (text.includes(JSON.stringify(C_LINE).slice(1, -1))) return "C";
  if (text.includes(JSON.stringify(D_LINE).slice(1, -1))) return "D";
  if (text.includes("Leave the improved plan in plan.md")) return "N";
  return null;
}

interface Seen {
  host: "claude" | "codex";
  arm: E1Arm | "build" | null;
  model: string;
  first: boolean;
  text: string;
}

type Item = Record<string, unknown>;
const responsesSse = (id: string, items: Item[]) => {
  const usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1050 };
  const ev = [{ type: "response.created", response: { id } }, ...items.map((it, i) => ({ type: "response.output_item.done", output_index: i, item: it })), { type: "response.completed", response: { id, status: "completed", usage } }];
  return new Response(ev.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
};
const itemText = (i: any): string => (Array.isArray(i?.content) ? i.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("") : typeof i?.content === "string" ? i.content : "");
const toolNames = (body: any): string[] => {
  const names = (ts: any[]): string[] => ts.flatMap((t) => (t?.type === "namespace" && Array.isArray(t.tools) ? t.tools.map((x: any) => String(x.name)) : t?.name ? [String(t.name)] : []));
  return [...names(Array.isArray(body?.tools) ? body.tools : []), ...(Array.isArray(body?.input) ? body.input : []).filter((i: any) => i?.type === "additional_tools").flatMap((i: any) => names(i.tools ?? []))];
};

/** Runs the driven launch and returns its checks; the dry run reads ok and one line from it. */
export async function drivenLaunch(o: { pstack?: string; harbor?: string; pCommand?: PCommand; keep?: boolean; log?: (l: string) => void } = {}): Promise<{ ok: boolean; detail: string; checks: Check[] }> {
  dropKeyEnv();
  const log = o.log ?? ((l: string) => console.error(l));
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ check: name, ok, detail });
    log((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  const pstack = o.pstack ?? process.env.GSTACK_EVALS_PSTACK_CHECKOUT ?? join(homedir(), ".local", "share", "pstack");
  const harness = join(pstack, "harness", "pstack", "claude-code");
  const harbor = o.harbor ?? process.env.GSTACK_EVALS_HARBOR ?? "harbor";
  const pCommand = o.pCommand ?? "/statechart";
  const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 300_000 });
  const ids = (args: string[]) => new Set(docker(args).stdout.split("\n").filter(Boolean));
  const before = { containers: ids(["ps", "-aq"]), networks: ids(["network", "ls", "-q"]) };
  mkdirSync(join(homedir(), ".capy", "work"), { recursive: true });
  const W = mkdtempSync(join(homedir(), ".capy", "work", "e1-e2e-"));
  const marker = pMarker(harness);
  const seen: Seen[] = [];
  let n = 0;
  const stub = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return Response.json({ object: "list", data: [] });
      const body = (await req.json()) as Record<string, any>;
      n++;
      if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      if (path.endsWith("/responses")) {
        const input: any[] = Array.isArray(body.input) ? body.input : [];
        const text = JSON.stringify(input);
        const users = input.map((x, i) => [x, i] as const).filter(([x]) => x?.type === "message" && x.role === "user" && !itemText(x).startsWith("<environment_context>") && !itemText(x).startsWith("<skill>"));
        const last = users.at(-1);
        const steps = last ? input.slice(last[1] + 1).filter((x) => x?.type === "function_call_output" || x?.type === "custom_tool_call_output").length : 0;
        const arm = armOfText(text);
        seen.push({ host: "codex", arm, model: String(body.model ?? ""), first: steps === 0, text });
        if (o.keep) writeFileSync(join(W, "req-" + n + "-codex-" + (arm ?? "x") + ".json"), JSON.stringify(body));
        const cmd = arm && arm !== "build" && steps === 0 ? armCommand(arm, "sol") : null;
        if (!cmd) return responsesSse("resp_" + n, [{ type: "message", id: "msg_" + n, role: "assistant", status: "completed", content: [{ type: "output_text", text: REPLY, annotations: [] }] }]);
        const tools = toolNames(body);
        const item: Item = tools.includes("exec")
          ? { type: "custom_tool_call", id: "ctc_" + n, call_id: "call_exec_" + n, name: "exec", input: "const r = await tools.exec_command({cmd: " + JSON.stringify(cmd) + ", workdir: \"/work\"});\ntext(typeof r === \"string\" ? r : (r.output ?? JSON.stringify(r)));", status: "completed" }
          : { type: "function_call", id: "fc_" + n, call_id: "call_exec_" + n, name: "exec_command", arguments: JSON.stringify({ cmd, workdir: "/work" }), status: "completed" };
        return responsesSse("resp_" + n, [item]);
      }
      const tools: string[] = Array.isArray(body.tools) ? body.tools.map((t: any) => t.name ?? t.type) : [];
      const main = tools.includes("Bash");
      const text = JSON.stringify(body.messages ?? []);
      const first = main && !text.includes("tool_result");
      const arm = main ? armOfText(text) : null;
      const model = String(body.model ?? "");
      seen.push({ host: "claude", arm, model, first, text: main ? text : "" });
      const particle = /particle/i.test(model);
      let command: string | null = null;
      if (first && arm === "build") command = "ls /work/review && cat /work/review/*.md > /dev/null && cd /work/repo && " + put(GO_CALC + GO_FIXED, "calc.go") + " && " + put('package calc\n\nimport "testing"\n\nfunc TestMulBuild(t *testing.T) {\n\tif Mul(0, 5) != 0 || Mul(2, 3) != 6 {\n\t\tt.Fatal("mul")\n\t}\n}\n', "calc_mul_test.go");
      else if (first && arm && arm !== "build") command = armCommand(arm, particle ? "particle" : "opus");
      const refused = main && arm === "N" && particle;
      const reply = command ? [{ type: "tool_use", id: "toolu_e1_e2e_" + n, name: "Bash", input: { command, description: "Run the step" } }] : [{ type: "text", text: refused ? REFUSAL : arm === "build" ? "Done." : REPLY }];
      if (body.stream) return new Response(sse(model, reply as any), { headers: { "content-type": "text/event-stream" } });
      return Response.json({ id: "msg_e1_e2e_" + n, type: "message", role: "assistant", model, content: reply, stop_reason: command ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    },
  });
  const gw = docker(["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"]).stdout.trim();
  const sidecar = startSidecar({ root: join(W, "sidecar"), agentHost: gw, agentPort: 0, controlPort: 0 });
  const record = join(W, "record");
  const ledger = join(W, "ledger.sqlite");
  const run = join(W, "run");
  const units = join(W, "units");
  const repos = join(W, "repos");
  const quote = { words: "keyless driven launch on a temporary ledger, not an approval", by: "e1 e2e", source: "lanes/eng-planted/e1/e2e.ts" };
  const total = E1_ITEMS.reduce((s, i) => s + i.capUsd, 0);
  const pairs = E1_ARMS.flatMap((arm) => RUNS_ON[arm].map((model) => ({ arm, model })));
  let unitImage = "";
  try {
    recordProgram(record, { program: E1_PROGRAM, cap_micros: Math.round(total * D), skill_cap_micros: Math.round(total * D), skills: [E1_SKILL], credit_rate_micros: D, quotes: [quote] });
    for (const i of E1_ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: Math.round(i.capUsd * D), quotes: [quote], admission: "warn", program: E1_PROGRAM, skills: [E1_SKILL] });
    const tools = buildToolsVolume(await tla2tools(join(homedir(), ".capy", "work", "pf-tools", "tla2tools.jar")));
    check("the tools volume holds TLC and Java at #358's pins", true, tools.reused ? "reused" : "built");

    const fx = goRepo(join(W, "fixture"));
    const id = fx.spec.id;
    const unitDir = join(units, id);
    const built = buildUnit(fx.spec, fx.repo, unitDir, { work: join(W, "work"), labels: join(W, "labels.json"), seed: 7 });
    unitImage = built.eb.image.id;
    check("fixture unit qualifies", built.qualifies, built.eb.unit.functional.length + " functional, " + built.eb.unit.aftermath.reduce((s, a) => s + a.cases.length, 0) + " planted cases");
    const planted = built.eb.unit.aftermath.flatMap((a) => a.cases);
    const unit: PlantedUnit = { id, repo: "fixture", set: "calibration", ecosystem: "go", stars: "300-999", publicMonth: "2026-10", strictWindow: true, regionLines: 3, planted, plantedClass: Object.fromEntries(planted.map((c) => [c, "assert"])), functional: built.eb.unit.functional, foresee: null, winnable: null, hard: null, pilot: true };
    writeFileSync(join(unitDir, "ep-unit.json"), JSON.stringify(unit));
    const base = join(repos, id);
    mkdirSync(base, { recursive: true });
    const git = (args: string[]) => spawnSync("git", ["-C", base, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
    spawnSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", fx.repo, fx.sha.base!, base]);
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    mkdirSync(join(run, "author", id), { recursive: true });
    writeFileSync(join(run, "author", id, "plan.md"), AUTHORED);
    mkdirSync(join(run, "e1"), { recursive: true });
    writeFileSync(join(run, "e1", "draw.json"), JSON.stringify({ seed: "e1-e2e", calibration: [id], comparison: [], reserve: [], skipped: [], waiting: null }));

    const upstream = "http://host.docker.internal:" + stub.port;
    const keys = { ANTHROPIC_API_KEY: "stub-not-a-key", OPENAI_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" };
    const machine = machineId();
    const seams: E1Seams = {
      ...E1_REAL,
      review: (r) => e1ReviewLauncher({ arms: [r.arm], model: r.model, out: r.out, env: { ...process.env, ...keys }, runId: E1_RUN, log: r.log, upstream }),
      build: (b) => {
        const table: MountTable = new Map();
        const plan = stagePlan(b.driver, E1_RUN, armName("plain"), b.cells);
        const inner = buildLauncher({ arm: "plain", units: new Map(b.ids.map((u) => [u, { dir: b.src.dir(u) }])), repos: b.repos, plans: b.out, bundles: null, out: b.out, host: gw, envelopeHost: machine, sidecar: sidecar.controlUrl, forbidden: [b.units, join(homedir(), ".capy", "drive")], planned: plan.planned, harbor, planFor: (cell) => table.get(cell)!.plan, reviewFor: (cell) => table.get(cell)!.review, runId: E1_RUN, skill: E1_SKILL, stripBase: true, serve: { dir: b.driver, unheld_ok: true, reruns: plan.reruns, machine, fetch: (url, init) => fetch(url.replace("https://api.anthropic.com", "http://127.0.0.1:" + stub.port), init), env: { ANTHROPIC_API_KEY: "stub-not-a-key" }, requireAdmission: () => null, log } });
        return async (p) => {
          const h = await inner(p);
          return { ...h, backend: ebSession(h.backend, table) };
        };
      },
      grader: async (g) => {
        const grade = unitGrader({ dirs: new Map([[id, unitDir]]), work: g.work, log: g.log });
        return {
          grade: async (_u, _dir, tree) => {
            const r = await grade({ unit: built.eb.unit, tree });
            return { planted: Object.values(r.aftermath).flat(), functional: r.functional };
          },
          catchOf: async () => ({ catch: null, drop: "the driven launch grades avoid only; the catch rule is the construct part's" }),
        };
      },
    };
    const cmds = e1Commands(seams);
    const io = { out: (l: string) => log("  " + l), err: (l: string) => log("  " + l) };
    const flags = (extra: Record<string, string> = {}): Parameters<Command["run"]>[0] => ({ flags: new Map(Object.entries({ "--run": run, "--units": units, "--repos": repos, "--item": "e1-pilot", "--cap-usd": "165", "--ledger-record": record, "--ledger": ledger, "--crew-usd": "0", "--hosts-usd": "0", "--phase": "pilot", "--pstack": harness, "--p-command": pCommand, "--work": join(W, "grade"), ...extra })), bools: new Set<string>(), rest: [] });

    check("ep e1-reviews --phase pilot exits 0", (await cmds["e1-reviews"]!.run(flags(), io)) === 0, pairs.length + " arm and model pairs");
    const cell = (arm: E1Arm, model: E1Model) => ({ unit: id, arm, model, rep: 0 });
    const rec = (arm: E1Arm, model: E1Model) => JSON.parse(readFileSync(reviewRecordPath(run, cell(arm, model)), "utf8")) as E1ReviewRecord;
    const recs = pairs.map((p) => ({ ...p, r: existsSync(reviewRecordPath(run, cell(p.arm, p.model))) ? rec(p.arm, p.model) : null }));
    check("every pair's review ends completed", recs.every((x) => x.r?.outcome === "completed"), recs.map((x) => x.arm + "/" + x.model + " " + (x.r?.outcome ?? "none")).join(", "));
    const want: Record<E1Arm, boolean | null> = { N: null, D: true, C: true, P: true, G: false };
    check("exposure reads as the stub's sessions earn it (N null, D, C and P exposed, G's procedure not run)", recs.every((x) => x.r?.exposed === want[x.arm]), recs.map((x) => x.arm + "/" + x.model + " " + String(x.r?.exposed)).join(", "));
    const firsts = (arm: E1Arm, host: "claude" | "codex", model?: RegExp) => seen.filter((s) => s.host === host && s.arm === arm && s.first && (!model || model.test(s.model)));
    const pFirst = [...firsts("P", "claude", /opus/i), ...firsts("P", "claude", /particle/i)];
    check("P's " + pCommand + " resolves to statechart's body through the plugin dir on Opus and particle-1", pFirst.length >= 2 && pFirst.every((s) => s.text.includes(JSON.stringify(marker).slice(1, -1))), pFirst.length + " first requests, " + pFirst.filter((s) => s.text.includes(JSON.stringify(marker).slice(1, -1))).length + " with the marker line");
    const gClaude = firsts("G", "claude");
    check("G's /plan-eng-review expands gstack's skill on Claude Code", gClaude.length >= 2 && gClaude.every((s) => /name: plan-eng-review|plan-eng-review\/SKILL\.md|<command-name>\/plan-eng-review/.test(s.text)), gClaude.length + " first requests");
    const gCodex = firsts("G", "codex");
    check("G's $plan-eng-review injects gstack's skill on Codex", gCodex.length >= 1 && gCodex.every((s) => s.text.includes("<skill>") && s.text.includes("plan-eng-review")), gCodex.length + " first requests, " + gCodex.filter((s) => s.text.includes("<skill>")).length + " with a skill item");
    const sol = recs.filter((x) => x.model === "sol");
    const solDirs = sol.map((x) => join(run, "e1", "reviews", "sessions", cellKey(cell(x.arm, "sol")), "a1", "run", "host", "codex-sessions"));
    const rolled = solDirs.filter((d) => existsSync(d) && readdirSync(d, { recursive: true }).some((f) => String(f).endsWith(".jsonl")));
    check("every Sol session's rollouts land in host/codex-sessions", rolled.length === sol.length, rolled.length + " of " + sol.length);
    const cSol = recs.find((x) => x.arm === "C" && x.model === "sol")?.r;
    check("codexAsClaude reads Sol's TLC run as a Bash call with its result", cSol?.exposed === true, "C on sol exposed " + String(cSol?.exposed));
    const tmpNames = (arm: E1Arm, model: E1Model) => {
      const m = mountDir(run, cell(arm, model));
      return existsSync(m) ? readdirSync(m, { recursive: true }).map(String) : [];
    };
    const noted = recs.filter((x) => !(x.arm === "N" && x.model === "particle"));
    const withNote = noted.filter((x) => tmpNames(x.arm, x.model).some((f) => f.endsWith("e1-dry-note.md")));
    check("the /tmp capture puts the session's /tmp file in the build's review bundle", withNote.length === noted.length, withNote.length + " of " + noted.length + " mounts hold e1-dry-note.md");
    const extra = [...new Set(recs.flatMap((x) => tmpNames(x.arm, x.model)).map((f) => f.split("/").at(-1)!).filter((f) => !["plan.md", "review.md", "e1-dry-note.md", "m.tla", "m.cfg"].includes(f) && !f.startsWith("review")))].sort();
    check("harness noise in the bundles is listed", true, extra.length ? extra.length + " other file names: " + extra.slice(0, 12).join(", ") : "none beyond the stub's own files");
    const refused = recs.find((x) => x.arm === "N" && x.model === "particle");
    const leftPlan = existsSync(join(mountDir(run, cell("N", "particle")), "plan.md")) ? readFileSync(join(mountDir(run, cell("N", "particle")), "plan.md"), "utf8") : null;
    check("a refusal ends completed and its mount is the plan as left", refused?.r?.outcome === "completed" && leftPlan === AUTHORED, "outcome " + (refused?.r?.outcome ?? "none") + ", mounted plan " + (leftPlan === AUTHORED ? "is the authored plan" : "differs"));
    const leases1 = readItem(record, "e1-pilot").leases;
    check("one lease per pair opened and settled on e1-pilot", leases1.length === pairs.length && leases1.every((l) => l.close !== null), leases1.length + " opened, " + leases1.filter((l) => l.close !== null).length + " settled");

    check("ep e1-builds --phase pilot exits 0", (await cmds["e1-builds"]!.run(flags(), io)) === 0, pairs.length + " cells");
    const builds = pairs.map((p) => (existsSync(buildRecordPath(run, cell(p.arm, p.model))) ? (JSON.parse(readFileSync(buildRecordPath(run, cell(p.arm, p.model)), "utf8")) as E1Build) : null));
    check("every build completes and reads the review", builds.every((b) => b?.outcome === "completed" && b.readReview === true), builds.map((b, i) => pairs[i]!.arm + "/" + pairs[i]!.model + " " + (b?.outcome ?? "none") + (b?.readReview ? "" : " unread")).join(", "));
    const passing = (c: { runs: string[] }[]) => c.filter((x) => x.runs.filter((r) => r === "pass").length >= 2).length;
    check("the grader scores every built tree", builds.every((b) => b !== null && passing(b.planted) === planted.length && passing(b.functional) === b.functional.length), builds.filter((b) => b !== null && passing(b.planted) === planted.length).length + " of " + pairs.length + " with every planted case passing");
    const leases2 = readItem(record, "e1-pilot").leases;
    check("the build stage opened and settled one more lease", leases2.length === pairs.length + 1 && leases2.every((l) => l.close !== null), leases2.length + " opened, " + leases2.filter((l) => l.close !== null).length + " settled");
    const pilot = await cmds["e1-pilot"]!.run({ flags: new Map(Object.entries({ "--run": run, "--units": units, "--repos": repos })), bools: new Set(), rest: [] }, io);
    check("ep e1-pilot reads the pilot and writes pilot.json", existsSync(join(run, "e1", "pilot.json")) && existsSync(join(run, "e1", "seeds.json")), "exit " + pilot + " (one unit, so the start rule cannot pass)");
  } catch (e) {
    check("the driven launch ran", false, (e as Error).message.slice(0, 800));
  } finally {
    stub.stop(true);
    sidecar.stop();
    writeFileSync(join(W, "e2e.json"), JSON.stringify({ checks, stub: seen.length }, null, 1) + "\n");
    if (!o.keep) {
      removeSessionImages();
      removeCoverageImages();
      removeLabelled();
      if (unitImage) {
        docker(["run", "--rm", "--network", "none", "--user", "0:0", "-v", W + ":/x", "--entrypoint", "sh", unitImage, "-c", "rm -rf /x/* /x/.[!.]* 2>/dev/null; true"]);
        docker(["rmi", "-f", "--no-prune", unitImage]);
      }
      rmSync(W, { recursive: true, force: true });
    }
    const after = { containers: [...ids(["ps", "-aq"])].filter((c) => !before.containers.has(c)), networks: [...ids(["network", "ls", "-q"])].filter((x) => !before.networks.has(x)) };
    check("teardown leaves no container or network", after.containers.length === 0 && after.networks.length === 0, after.containers.length + " containers, " + after.networks.length + " networks left");
  }
  const failed = checks.filter((c) => !c.ok);
  return { ok: checks.length > 0 && failed.length === 0, detail: checks.length + " checks, " + failed.length + " failed" + (failed.length ? ": " + failed.map((c) => c.check).join("; ") : "") + (o.keep ? "; kept " + W : ""), checks };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const p = arg("--p-command");
  if (p !== undefined && !(P_COMMANDS as readonly string[]).includes(p)) {
    console.error("E_USAGE --p-command is " + P_COMMANDS.join(" or "));
    process.exit(2);
  }
  const r = await drivenLaunch({ pstack: arg("--pstack"), harbor: arg("--harbor"), ...(p ? { pCommand: p as PCommand } : {}), keep: argv.includes("--keep") });
  console.log((r.ok ? "PASS" : "FAIL") + " e1 driven launch: " + r.detail);
  process.exit(r.ok ? 0 : 1);
}
