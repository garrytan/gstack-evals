#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// The build stage's paid path end to end, keyless: one Go fixture unit built by unit.ts, its session image
// (session-image.ts), the build launcher (launch.ts buildLauncher) on the outcome driver with a temporary ledger, Harbor at
// its pin, real_agent's non-SM path with the real-outcome sandbox sidecar, Claude Code at the review stage's pin, and a
// stub Anthropic upstream in this process in place of the model. The stub answers the first main-loop request with one
// Bash call that writes the fixed Mul into calc.go and adds a test, then ends the turn. The unit's grader (pipeline.ts
// unitGrader) scores the built tree. Every key variable is removed before anything starts, so no key reaches Harbor, the
// driver or the container; the upstream key is a placeholder only the stub sees. It prints one PASS or FAIL line per check,
// counts and outcome words only, and removes the images and containers it made.
// Usage: bun lanes/eng-build/e2e.ts --harbor <harbor bin> [--keep]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sse } from "../../quick/laneb/runner/fake_upstream.ts";
import { recordProgram } from "../../src/runner/ledger/envelope.ts";
import { machineId, recordApproval } from "../../src/runner/ledger/ledger.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { GO_CALC, GO_FIXED, goRepo } from "../../tests/eng-build/fixture.ts";
import { startSidecar } from "../real-outcome/sandbox/sidecar.ts";
import { removeCoverageImages } from "./coverage.ts";
import { buildLauncher } from "./launch.ts";
import { EB_BUILD_SKILL, EB_PROGRAM, itemOf } from "./ledger.ts";
import { paidItem, runBuilds, underLease, unitGrader } from "./pipeline.ts";
import { removeLabelled } from "./screen.ts";
import { claudePin, removeSessionImages, SESSION_LABEL } from "./session-image.ts";
import { buildUnit } from "./unit.ts";

const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const harbor = arg("--harbor") ?? "harbor";
const keep = process.argv.includes("--keep");
const D = 1_000_000;
const ITEM = "eb-builds-opus";
const quote = { words: "keyless end-to-end run on a temporary ledger, not an approval", by: "eb e2e", source: "lanes/eng-build/e2e.ts" };
const results: Array<{ check: string; ok: boolean; detail: string }> = [];
const rule = (check: string, ok: boolean, detail: string) => { results.push({ check, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + check + ": " + detail); };
const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 300_000 });
const lines = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : []);
const find = (dir: string, name: string): string | null => {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === name) return join(dir, e.name);
    const q = find(join(dir, e.name), name);
    if (q) return q;
  }
  return null;
};

mkdirSync(join(homedir(), ".capy/work"), { recursive: true });
const W = mkdtempSync(join(homedir(), ".capy/work/eb-e2e-"));
const fx = goRepo(join(W, "fixture"));
const id = fx.spec.id;
const unitDir = join(W, "units", id);
const built = buildUnit(fx.spec, fx.repo, unitDir, { work: join(W, "work"), labels: join(W, "labels.json"), seed: 7 });
rule("fixture unit qualifies", built.qualifies, id + ": " + built.eb.unit.functional.length + " functional, " + built.eb.unit.aftermath.reduce((s, a) => s + a.cases.length, 0) + " aftermath cases");
const unitImage = built.eb.image.id;

const repo = join(W, "repos", id);
mkdirSync(repo, { recursive: true });
const git = (dir: string, args: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
spawnSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", fx.repo, fx.sha.base!, repo]);
git(repo, ["init", "-q", "-b", "main"]);
git(repo, ["add", "-A"]);
git(repo, ["commit", "-q", "-m", "base"]);
mkdirSync(join(W, "plans"), { recursive: true });
writeFileSync(join(W, "plans", id + ".md"), "# Plan\n\nAdd Mul(a, b int) int to the calculator, with tests.\n");
const note = "The change adds Mul(a, b int) int, which returns the product of a and b.";

const record = join(W, "record");
recordProgram(record, { program: EB_PROGRAM, cap_micros: itemOf(ITEM).capUsd * D, skill_cap_micros: itemOf(ITEM).capUsd * D, skills: [EB_BUILD_SKILL], credit_rate_micros: D, quotes: [quote] });
recordApproval(record, { action: "init", item: ITEM, cap_micros: itemOf(ITEM).capUsd * D, quotes: [quote], admission: "warn", program: EB_PROGRAM, skills: [EB_BUILD_SKILL] });
const paid = paidItem("build", { item: ITEM, capUsd: "20", record, ledger: join(W, "ledger.sqlite") });

const fixed = Buffer.from(GO_CALC + GO_FIXED).toString("base64");
const test = Buffer.from('package calc\n\nimport "testing"\n\nfunc TestMulBuild(t *testing.T) {\n\tif Mul(0, 5) != 0 || Mul(2, 3) != 6 {\n\t\tt.Fatal("mul")\n\t}\n}\n').toString("base64");
const stubLog: Array<{ main: boolean; edit: boolean; tools: string[]; skills: string[] }> = [];
const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method !== "POST") return Response.json({});
    const body = (await req.json()) as Record<string, any>;
    if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
    const main = Array.isArray(body.tools) && body.tools.length > 0;
    const text = JSON.stringify(body.messages ?? []);
    const edit = main && !text.includes("tool_result");
    const skills = [...new Set([...JSON.stringify(body).matchAll(/- ([a-z][a-z0-9:-]*): /g)].map((m) => m[1]!))].filter((s) => /plugin-authoring|doctor|skill/.test(s));
    stubLog.push({ main, edit, tools: main ? body.tools.map((t: any) => t.name ?? t.type) : [], skills });
    const reply = edit ? [{ type: "tool_use", id: "toolu_eb_e2e_" + stubLog.length, name: "Bash", input: { command: "echo " + fixed + " | base64 -d > calc.go && echo " + test + " | base64 -d > calc_mul_test.go", description: "Write Mul and its test" } }] : [{ type: "text", text: "Done." }];
    if (body.stream) return new Response(sse(body.model, reply as any), { headers: { "content-type": "text/event-stream" } });
    return Response.json({ id: "msg_eb_e2e", type: "message", role: "assistant", model: body.model, content: reply, stop_reason: edit ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  },
});
const gw = docker(["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"]).stdout.trim();
const sidecar = startSidecar({ root: join(W, "sidecar"), agentHost: gw, agentPort: 0, controlPort: 0 });
const machine = machineId();
let lease = "";
try {
  const launcher = buildLauncher({ arm: "none", units: new Map([[id, { dir: unitDir }]]), repos: join(W, "repos"), plans: join(W, "plans"), bundles: null, out: join(W, "build"), host: gw, envelopeHost: machine, sidecar: sidecar.controlUrl, forbidden: [join(W, "units"), join(homedir(), ".capy", "drive")], planned: 1, harbor, serve: { machine, fetch: (url, init) => fetch(url.replace("https://api.anthropic.com", "http://127.0.0.1:" + stub.port), init), env: { ANTHROPIC_API_KEY: "stub-not-a-key" }, requireAdmission: () => null, log: (l) => console.error(l) } });
  const grader = unitGrader({ dirs: new Map([[id, unitDir]]), work: join(W, "work"), log: (l) => console.log(l) });
  const builds = await underLease(paid, launcher, async (session, leaseId) => {
    lease = leaseId;
    rule("lease opens", readItem(record, ITEM).open?.lease_id === leaseId, "1 lease open on " + ITEM);
    const imgs = docker(["images", "-q", "--filter", "label=" + SESSION_LABEL]).stdout.split("\n").filter(Boolean).length;
    const done = await runBuilds({ units: [{ unit: built.eb.unit, note }], arm: "none", reviewer: null, reps: [1], pilot: false, reviews: [], out: join(W, "build"), session, grader, log: (l) => console.log(l) });
    rule("one session image during the run, on the unchanged unit image", docker(["images", "-q", "--filter", "label=" + SESSION_LABEL]).stdout.split("\n").filter(Boolean).length === 1 && docker(["image", "inspect", "-f", "{{.Id}}", unitImage]).stdout.trim() === unitImage, imgs + " before the session, the unit image id unchanged");
    return done;
  });
  const b = builds[0]!;
  const pass = (c: { runs: string[] }[] | undefined) => (c ?? []).filter((x) => x.runs.filter((r) => r === "pass").length >= 2).length;
  rule("session completes", b.outcome === "completed", "outcome " + b.outcome);
  rule("grader scores the built tree", pass(b.functional) === built.eb.unit.functional.length && pass(b.aftermath.B1) === built.eb.unit.aftermath[0]!.cases.length, "functional " + pass(b.functional) + " of " + b.functional.length + " pass, aftermath B1 " + pass(b.aftermath.B1) + " of " + (b.aftermath.B1?.length ?? 0) + " pass, test lines added " + b.testLinesAdded + ", catch B1 " + JSON.stringify(b.catches.B1 ?? null));
  const ev = find(join(W, "build", "sessions"), "evaluator");
  const events = ev ? lines(join(ev, "usersim-events.jsonl")) : [];
  const egress = events.find((e) => e.event === "egress");
  const probe = (events.find((e) => e.event === "egress_probe")?.result ?? {}) as Record<string, string>;
  const allow: string[] = egress?.allow ?? [];
  const agent = new URL(sidecar.agentUrl).host;
  const open = Object.entries(probe).filter(([, v]) => v === "open").map(([k]) => k);
  rule("egress: the proxy and the sidecar's agent plane only", allow.length === 2 && allow.includes(agent) && open.length === 2 && open.every((a) => allow.includes(a)), allow.length + " allowed endpoints (the proxy and the sidecar's agent plane), probe: " + open.length + " open, " + (Object.keys(probe).length - open.length) + " denied targets closed");
  const init = (ev ? lines(join(ev, "sdk-messages.jsonl")) : []).find((r) => r.type === "SystemMessage" && r.subtype === "init");
  const skills: string[] = init?.data?.skills ?? [];
  const slash: string[] = init?.data?.slash_commands ?? [];
  console.log("init: claude_code " + (init?.data?.claude_code_version ?? "?") + ", " + skills.length + " skills " + JSON.stringify(skills) + ", " + slash.length + " slash commands");
  writeFileSync(join(W, "init.json"), JSON.stringify(init ?? null, null, 1) + "\n");
  rule("Claude Code at the review stage's pin, no web tool offered", init?.data?.claude_code_version === claudePin().version && stubLog.length > 0 && stubLog.every((e) => !e.tools.some((t) => /web/i.test(t))), "version " + (init?.data?.claude_code_version ?? "?") + ", " + stubLog.length + " stub requests, " + stubLog.filter((e) => e.edit).length + " edits");
} catch (e) {
  rule("build ran", false, (e as Error).message.slice(0, 800));
} finally {
  const item = readItem(record, ITEM);
  rule("lease settles", item.open === null && item.leases.length === 1 && item.leases[0]!.close !== null, item.leases.length + " opened, " + item.leases.filter((l) => l.close !== null).length + " settled, spent " + (item.leases[0]?.close?.spent_micros ?? "?") + " micros");
  stub.stop(true);
  sidecar.stop();
  writeFileSync(join(W, "e2e.json"), JSON.stringify({ unit: id, lease, results, stub: stubLog }, null, 1) + "\n");
  if (!keep) {
    removeSessionImages();
    removeCoverageImages();
    removeLabelled();
    const units = docker(["images", "-q", "--filter", "label=gstack-evals.eb.unit=" + id]).stdout.split("\n").filter(Boolean);
    if (units.length) docker(["rmi", "-f", "--no-prune", ...new Set(units)]);
  }
  console.log("e2e dir " + W);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
