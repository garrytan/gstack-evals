// Copyright (c) 2026 Garry Tan. MIT License.
// SR's dry run (plan section 14): a stub model (no network, no keys) drives one session per model and arm on a real unit
// (converted by sr convert, kept by the oracle at the fix base and by the harmless-edit check) through the driver's SR
// stages on a temporary ledger, the review image (HEAD the change, origin/main its base), pf_turns.py on the real Claude
// Agent SDK and Claude Code, and the G+ and G0 gstack homes. Then it scores every session as the counted run does, reads
// exposure and false alarms, runs the analysis and the look, and opens and settles one lease per frozen item. One PASS or
// FAIL line per rule; exit 1 on any FAIL.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { machineId, openLease, recordApproval, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { UPSTREAM } from "../../../src/runner/proxy/metering-proxy.ts";
import { sse } from "../../../quick/laneb/runner/fake_upstream.ts";
import { dropKeyEnv } from "../../../src/trial/env.ts";
import { PF_STAGES, serveStages } from "../driver/stage.ts";
import { CLAUDE_BIN } from "../statemachines/stub-claude.ts";
import { treeVolume as smTreeVolume } from "../statemachines/oracle.ts";
import { readUnit } from "../statemachines/unit.ts";
import { WRAPUP } from "../pfchecks/arms.ts";
import { labelsGate, neutralGate, oracleGate, readLabels } from "../pfchecks/draw.ts";
import { P_HEADING } from "../pfchecks/exposure.ts";
import { buildPstackVolume } from "../pfchecks/pstack.ts";
import { dockerExecutor } from "../pfchecks/runner.ts";
import type { PfSessionRecord } from "../pfchecks/session.ts";
import { buildToolsVolume, tla2tools } from "../pfchecks/tools.ts";
import { analyse, look, type UnitFacts } from "./analysis.ts";
import { GSTACK, SR_ARMS, SR_MODELS, srLimits, type SrArm } from "./arms.ts";
import type { BicRecord } from "./bic.ts";
import { srDraw } from "./draw.ts";
import { ARMY, SPECIALIST } from "./exposure.ts";
import { ITEMS, LINE, SR_STAGES } from "./items.ts";
import { readJsonl } from "./labels.ts";
import { sessionOf, srScoreSession, type SrCatch } from "./score.ts";
import { runSrSession, srPlan, type SrPlanned } from "./session.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const HOME = "/root/.claude/skills/gstack";
/** What each session's first Bash call prints: the review tree, origin, gstack and drive visibility. */
const PROBE = [
  "echo SR_HEAD_TREE=$(git rev-parse HEAD^{tree})", "echo SR_MAIN=$(git rev-parse origin/main)", "echo SR_PARENT=$(git rev-parse HEAD~1)",
  "echo SR_DIFF=$(git diff --name-only origin/main HEAD | tr '\\n' ,)", "echo SR_HEADREF=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>&1)",
  "echo SR_GSTACK=$(test -e " + HOME + " && git -C " + HOME + " rev-parse 'HEAD^{tree}' || echo absent)",
  "echo SR_ARMY_SM=$(if test -f " + HOME + "/review/sections/review-army.md; then grep -c 'State Machines' " + HOME + "/review/sections/review-army.md; else echo absent; fi)",
  "echo SR_ARMY_ALWAYS=$(if test -f " + HOME + "/review/sections/review-army.md; then grep -c 'always, whatever SCOPE_STATE_MACHINE says' " + HOME + "/review/sections/review-army.md; else echo absent; fi)",
  "echo SR_DRIVE=$(find /home /root -maxdepth 2 -name .capy 2>/dev/null | tr '\\n' , || true)",
].join("; ");
const CATCH_TEST = "package resolve_test\n\nimport (\n\t\"testing\"\n\n\t\"go.starlark.net/resolve\"\n\t\"go.starlark.net/syntax\"\n)\n\nfunc TestSrDryBreakInNestedDef(t *testing.T) {\n\tf, err := syntax.Parse(\"x.star\", \"def f():\\n  for a in [1]:\\n    def g():\\n      break\\n\", 0)\n\tif err != nil {\n\t\tt.Fatal(err)\n\t}\n\tno := func(string) bool { return false }\n\tif err := resolve.File(f, no, no); err == nil {\n\t\tt.Fatal(\"break inside a def nested in a loop was not rejected\")\n\t}\n}\n";
type Call = { name: string; input: Record<string, unknown> };
type Script = { task: Call[]; checks: string[] };
const bash = (command: string): Call => ({ name: "Bash", input: { command, description: "Fixture step" } });
const read = (file_path: string): Call => ({ name: "Read", input: { file_path } });
const manifest = (cmds: string[]) => JSON.stringify(cmds.map((command, i) => ({ name: "check-" + i, command, what_it_checks: "fixture " + i })));
/** Per arm: the probe, the arm's own reads, then a planted check. N plants a check that catches the unit's bug; C one
 *  that fails everywhere (a false alarm); P, G+ and G0 plant nothing new and list a check that passes. */
const SCRIPTS: Record<SrArm, Script> = {
  N: { task: [bash(PROBE), bash("echo " + b64(CATCH_TEST) + " | base64 -d > resolve/sr_dry_test.go")], checks: ["go test ./resolve -run TestSrDryBreakInNestedDef -count=1"] },
  C: { task: [bash(PROBE), bash("mkdir -p checks && printf 'exit 1\\n' > checks/sr_fail.sh")], checks: ["bash checks/sr_fail.sh"] },
  P: { task: [bash(PROBE)], checks: [] },
  "G+": { task: [bash(PROBE), read(ARMY), read(SPECIALIST)], checks: [] },
  G0: { task: [bash(PROBE), read(ARMY)], checks: [] },
};

function startStub(host: string) {
  const st = { current: "", bodies: [] as Array<{ session: string; phase: string; body: Record<string, any> }>, calls: new Map<string, number>() };
  const server = Bun.serve({
    hostname: host, port: 0,
    async fetch(req) {
      if (req.method !== "POST") return Response.json({});
      const body = JSON.parse(await req.text()) as Record<string, any>;
      if (new URL(req.url).pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      const phase = JSON.stringify(body.messages ?? []).includes(JSON.stringify(WRAPUP).slice(1, -1)) ? "wrapup" : "task";
      st.bodies.push({ session: st.current, phase, body });
      const done = new Response(sse(body.model, [{ type: "text", text: "Done." }] as any), { headers: { "content-type": "text/event-stream" } });
      if (!(Array.isArray(body.tools) && body.tools.length)) return done;
      const arm = st.current.split("|")[1] as SrArm;
      const key = st.current + ":" + phase, n = st.calls.get(key) ?? 0;
      st.calls.set(key, n + 1);
      const s = SCRIPTS[arm];
      const call = phase === "task" ? s.task[n] : n === 0 ? bash("echo " + b64(manifest(s.checks)) + " | base64 -d > CHECKS.json") : undefined;
      if (!call) return done;
      return new Response(sse(body.model, [{ type: "tool_use", id: "toolu_sr_" + phase + "_" + n, ...call }] as any), { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { st, server };
}

export async function main(argv: string[]): Promise<number> {
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const need = (k: string) => arg(k) ?? (() => { throw new Error("E_USAGE sr dryrun needs " + k); })();
  const W = arg("--out") ?? mkdtempSync(join(homedir(), ".capy/work/sr-dryrun-"));
  mkdirSync(W, { recursive: true });
  dropKeyEnv();
  const lines: string[] = [];
  const rule = (name: string, ok: boolean, detail: string) => { const l = (ok ? "PASS " : "FAIL ") + name + ": " + detail; lines.push(l); console.log(l); };
  const unitDir = need("--unit"), neutralDir = need("--neutral"), bicPath = need("--bic");
  const homes = { "G+": need("--home-gplus"), G0: need("--home-g0") };
  const python = arg("--python") ?? join(homedir(), ".capy/work/real/venv/bin/python");
  const harbor = arg("--harbor") ?? join(homedir(), ".capy/work/real/venv/bin/harbor");
  const claudeBin = arg("--claude") ?? CLAUDE_BIN;
  const sdk = spawnSync(python, ["-c", "import claude_agent_sdk;print(claude_agent_sdk.__version__)"], { encoding: "utf8" }).stdout?.trim();
  const cv = spawnSync(claudeBin, ["--version"], { encoding: "utf8" }).stdout?.trim();
  rule("pinned SDK and Claude Code", sdk === "0.2.174" && /^2\.1\.312 /.test(cv ?? ""), "sdk " + sdk + ", claude " + cv);
  const u = readUnit(unitDir);
  const neutral = join(neutralDir, u.id + ".json");
  const bics = readJsonl(bicPath) as unknown as BicRecord[];
  const bic = bics.find((b) => b.id === u.id)!;
  rule("real unit: converted with its change under review, kept by the oracle at the fix base and by the harmless edit", !!bic && !bic.drop && existsSync(join(unitDir, "pr.patch")) && u.oracle?.verdict === "kept" && existsSync(neutral) && JSON.parse(readFileSync(neutral, "utf8")).verdict === "kept", u.id + " oracle " + u.oracle?.verdict + ", stable " + u.oracle?.stable?.length + ", pr +" + bic?.pr_added + "/-" + bic?.pr_deleted + " in " + bic?.pr_files.join(","));

  // The draw over the real BIC records and labels: the walk reads each gate's real record and stops at the first unit
  // with none.
  const labels = need("--labels");
  const d = srDraw(bics, 1, [labelsGate(readLabels([labels])), oracleGate(join(unitDir, "..")), neutralGate(neutralDir)]);
  rule("draw walks the real records in seeded order and stops at the first gate with no record", !!d.pending && d.order.length === bics.filter((b) => !b.drop).length, "pending " + JSON.stringify(d.pending) + ", drops " + d.drops.length + ", pilot so far " + d.pilot.length);

  // Ledger: the program and every item on a temporary ledger.
  const quote = { words: "dry-run fixture words on a temporary ledger, not an approval", by: "sr-dryrun", source: "smreview/dryrun.ts" };
  const record = join(W, "record");
  const total = Object.values(ITEMS).reduce((a, x) => a + x.cap_micros, 0);
  recordProgram(record, { program: LINE.name, cap_micros: total, skill_cap_micros: total, skills: ["sr"], credit_rate_micros: 1_000_000, quotes: [quote] });
  const local = LocalLedger.open(join(W, "ledger.sqlite"));
  for (const x of Object.values(ITEMS)) recordApproval(record, { action: "init", item: x.item, cap_micros: x.cap_micros, quotes: [quote], admission: "required", program: LINE.name, skills: ["sr"] });
  buildToolsVolume(await tla2tools(join(homedir(), ".capy/work/pf/tla2tools.jar")));
  buildPstackVolume([arg("--pstack-source") ?? join(homedir(), ".capy/work/pstack/plugins")]);

  const gw = spawnSync("docker", ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"], { encoding: "utf8" }).stdout.trim();
  const { st, server } = startStub(gw);
  const url = "http://" + gw + ":" + server.port;
  const machine = machineId();
  const serve = (n: number, items: string[]) => serveStages({ record, local, run_id: "sr-dryrun-" + n, envelope_host: machine, machine, stages: items.map((item) => ({ item, arm: PF_STAGES[item]!.arms[0]!, arms: [...PF_STAGES[item]!.arms] })), host: gw, dir: join(W, "driver-" + n), fetch: (x, init) => fetch(x.replace(UPSTREAM.anthropic, url).replace(UPSTREAM.openrouter, url), init), env: { ANTHROPIC_API_KEY: "stub-not-a-key", OPENROUTER_API_KEY: "stub-not-a-key" }, requireAdmission: () => null, log: (l) => console.error(l) });
  const volume = smTreeVolume(u.id);
  const catches: Array<SrCatch & { arm: SrArm }> = [];
  let batch = await serve(1, ["sr-pilot"]);
  let stopped = false;
  try {
    const plan = srPlan([u.id], 11, "pilot");
    rule("pilot plan: every model and arm once on the unit, on sr-pilot", plan.length === SR_MODELS.length * SR_ARMS.length && plan.every((s) => s.item === "sr-pilot"), plan.map((s) => s.model.split("/").at(-1) + ":" + s.arm).join(" "));
    let refused = "";
    try {
      await runSrSession({ unitDir, session: plan.find((s) => s.arm === "G+")!, names: "short", control: batch.control, proxy: batch.stages[0]!.proxy, out: join(W, "s-wronghome"), volume, effort: null, homes: { "G+": homes.G0 } });
    } catch (e) {
      refused = (e as Error).message;
    }
    rule("a G+ session whose home holds another gstack commit is refused before any container", refused.startsWith("E_SR_ARM"), refused.slice(0, 160));
    const base = u.base_commit;
    const ran: Array<{ s: SrPlanned; rec: PfSessionRecord; file: string; out: string; turns: Record<string, any> }> = [];
    for (const s of plan) {
      const name = s.model + "|" + s.arm;
      st.current = name;
      const stage = batch.stages.find((x) => SR_STAGES[x.item]!.arms.includes("pf:" + s.arm) && SR_STAGES[x.item]!.models.includes(s.model))!;
      const run = await runSrSession({ unitDir, session: s, names: "short", control: batch.control, proxy: stage.proxy, out: join(W, "s-" + s.index), volume, effort: null, homes, harbor, claude: claudeBin, probeNode: "" });
      const a = run.attempts.at(-1)!;
      ran.push({ s, rec: run.record as PfSessionRecord, file: run.file, out: a.evaluator ?? a.dir, turns: (a.summary ?? {}) as Record<string, any> });
    }
    const toolOut = (session: string): string => {
      for (const b of st.bodies) if (b.session === session) for (const m of (b.body.messages ?? []) as Array<{ content?: unknown }>) for (const c of Array.isArray(m.content) ? m.content : []) if (c.type === "tool_result" && c.tool_use_id === "toolu_sr_task_0") return typeof c.content === "string" ? c.content : (c.content ?? []).map((x: { text?: string }) => x.text ?? "").join("");
      return "";
    };
    const baseTree = spawnSync("git", ["-C", join(homedir(), ".capy/work/sme2/repos", u.repo.replace("/", "__")), "rev-parse", base + "^{tree}"], { encoding: "utf8" }).stdout.trim();
    for (const r of ran) {
      const name = r.s.model + "|" + r.s.arm, out = toolOut(name);
      const get = (k: string) => new RegExp("^" + k + "=(.*)$", "m").exec(out)?.[1] ?? "";
      const g = r.s.arm === "G+" || r.s.arm === "G0";
      const wantDiff = [...bic.pr_files].sort().join(",") + ",";
      const diff = get("SR_DIFF").split(",").filter(Boolean).sort().join(",") + ",";
      const ok = r.rec.gap === null && get("SR_HEAD_TREE") === baseTree && get("SR_MAIN") === get("SR_PARENT") && diff === wantDiff && get("SR_HEADREF") === "origin/main" &&
        get("SR_GSTACK") === (g ? GSTACK.tree[r.s.arm as "G+" | "G0"] : "absent") && get("SR_DRIVE") === "" &&
        (r.s.arm === "G+" ? get("SR_ARMY_ALWAYS") === "1" : r.s.arm === "G0" ? get("SR_ARMY_SM") === "0" : get("SR_ARMY_SM") === "absent");
      rule("session " + name + ": HEAD is the fix base's tree, origin/main its parent with the change's files between them, gstack only in G+ and G0 at its arm's tree, no drive", ok, "gap " + r.rec.gap + ", tree " + (get("SR_HEAD_TREE") === baseTree) + ", diff " + diff + " want " + wantDiff + ", origin/HEAD " + get("SR_HEADREF") + ", gstack " + get("SR_GSTACK") + ", army State Machines lines " + get("SR_ARMY_SM") + ", forced " + get("SR_ARMY_ALWAYS") + ", drive '" + get("SR_DRIVE") + "'");
      const slots = (r.turns.slots ?? []) as Array<Record<string, any>>;
      const lim = srLimits(r.s.model);
      const want = (x: Record<string, any>) => Math.round(lim[x.phase as "task" | "wrapup"].allowance_usd * 1_000_000);
      rule("session " + name + " opened a task and a wrap-up slot with SR's allowances, both closed", slots.filter((x) => x.phase === "task").length === 1 && slots.some((x) => x.phase === "wrapup") && slots.every((x) => x.allowance_micros === want(x) && x.close && !x.close.error), slots.map((x) => x.phase + " " + x.allowance_micros + " of " + want(x)).join("; "));
      const first = st.bodies.find((b) => b.session === name && b.phase === "task" && Array.isArray(b.body.tools) && b.body.tools.length);
      const said = JSON.stringify(first?.body.messages ?? []);
      if (r.s.arm === "P") rule("session " + name + ": pstack's skill body reached the first request", said.includes(P_HEADING), "heading " + said.includes(P_HEADING));
      if (g) rule("session " + name + ": /review's skill body reached the first request", /Review Army|review-army/.test(said), "army named " + /Review Army|review-army/.test(said));
      const rec = r.rec as PfSessionRecord & { s?: { repo: string } };
      const c = await srScoreSession({ s: rec.s!.repo, ref: "HEAD", unitDir, neutral, checks: rec.checks, session: r.file, transcript: rec.transcript, claudeSession: existsSync(join(r.out, "claude-session.jsonl")) ? join(r.out, "claude-session.jsonl") : null, arm: r.s.arm, exec: (repo, uu) => dockerExecutor({ repo, image: uu.image.runtime_id ?? "", base: volume, repoDir: uu.repo_dir, workDir: uu.work_dir, mode: "hardened", mounts: [], env: {}, rebuild: uu.commands.rebuild }) });
      writeFileSync(join(W, "catch-" + r.s.index + ".json"), JSON.stringify({ ...c, arm: r.s.arm }, null, 1) + "\n");
      catches.push({ ...c, arm: r.s.arm });
      const wantScore = r.s.arm === "N" ? 1 : 0, wantFa = r.s.arm === "C" ? 1 : 0;
      rule("session " + name + " scored against origin with the fix base as S's base: score " + wantScore + ", false alarms " + wantFa, c.score === wantScore && c.sr.false_alarms === wantFa && c.gap === null, "score " + c.score + ", gap " + c.gap + ", checks " + c.sr.checks + ", false alarms " + c.sr.false_alarms);
      if (g) rule("session " + name + ": exposure " + (r.s.arm === "G+" ? "ran" : "absent"), c.sr.exposure?.part_under_test === (r.s.arm === "G+" ? "ran" : "absent") && c.sr.exposure?.army === true, JSON.stringify(c.sr.exposure));
    }
    await batch.stop();
    batch = await serve(2, ["sr-opus", "sr-particle"]);
    const t = srPlan([u.id], 11, "test");
    const one = [t.find((s) => s.model === SR_MODELS[0] && s.arm === "N")!, t.find((s) => s.model === SR_MODELS[1] && s.arm === "N")!];
    for (const s of one) {
      st.current = s.model + "|N|test";
      const stage = batch.stages.find((x) => x.item === s.item)!;
      const run = await runSrSession({ unitDir, session: s, names: "short", control: batch.control, proxy: stage.proxy, out: join(W, "t-" + s.index), volume, effort: null, homes, harbor, claude: claudeBin, probeNode: "" });
      rule("counted-run session on " + s.item + " (" + s.model + ") runs on its own stage", run.record.gap === null && run.record.item === s.item, "gap " + run.record.gap + ", item " + run.record.item);
    }
    stopped = true;
    const code = await batch.stop();
    for (const x of Object.values(ITEMS)) if (!PF_STAGES[x.item]) settleLease(record, local, openLease(record, local, { item: x.item, run_id: "sr-dryrun-direct", machine_id: machine, requireAdmission: () => null }).lease_id);
    for (const x of Object.values(ITEMS)) {
      const it = readItem(record, x.item);
      rule("ledger lease " + x.item, it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null, "opened and settled " + (PF_STAGES[x.item] ? "by the driver" : "directly") + ", spent " + it.leases[0]?.close?.spent_micros + " of cap " + x.cap_micros + ", driver exit " + code);
    }
    const facts: UnitFacts[] = [{ id: u.id, repo: u.repo, detected: !!bic.detector?.detected, pr_lines: (bic.pr_added ?? 0) + (bic.pr_deleted ?? 0) }];
    const ss = catches.map((c) => sessionOf(c, c.arm));
    const an = analyse(ss, facts, 5, SR_MODELS);
    const N = an.rates.filter((x) => x.arm === "N" && x.k === 1).length;
    rule("analysis reads the scored sessions: N caught on both models, every contrast computed, exposure and false alarms per cell", N === 2 && an.contrasts.length === 24 && an.exposure.some((e) => e.arm === "G+" && e.ran === e.sessions) && an.false_alarms.some((f) => f.arm === "C" && f.false_alarms === f.sessions), "decision " + an.decision + ", contrasts " + an.contrasts.length + ", G+ ran " + an.exposure.filter((e) => e.arm === "G+").map((e) => e.ran + "/" + e.sessions).join(",") + ", C false alarms " + an.false_alarms.filter((f) => f.arm === "C").map((f) => f.false_alarms).join(","));
    const l = look(ss, facts, [u.id], 1, 5, SR_MODELS);
    rule("the look reads half the counted units, rounded up, once all their G+ and G0 sessions are in", l.units === 1 && l.done === 1 && l.p !== null && l.stop === false, JSON.stringify(l));
  } catch (e) {
    rule("dry run", false, (e as Error).stack?.slice(0, 900) ?? String(e));
  } finally {
    if (!stopped) await batch.stop();
    server.stop(true);
  }
  writeFileSync(join(W, "dryrun.txt"), lines.join("\n") + "\n");
  const bad = lines.filter((x) => x.startsWith("FAIL")).length;
  console.log(bad ? "E_SR_INPUT " + bad + " dry-run rule(s) failed; see " + W : "DRYRUN: ok (" + lines.length + " rules, work " + W + ")");
  return bad ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
