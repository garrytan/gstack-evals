// Copyright (c) 2026 Garry Tan. MIT License.
// b2 sessions run --out <dir> [--arms <dir>] [--record]: the keyless start captures (preregistration section 12's "the part
// under test ran" on known cases, before any paid session). No model call: every session talks to a stub.
//
// Claude Code: scripted sessions in the real Claude Code 2.1.312 image (hm-session, B1's sessions image) against B1's stub
// model (lanes/delivery-route/fake-model.ts), driven the way a trial is (sessions-driver.py: LanebHooksAgent with only Harbor
// stubbed, the arm tar extracted after the snapshot strip). They show what each arm's first request carries: none, Claude
// Code's own skill alone; line, the line in the user-instructions reminder and no listing beyond none's; gstack, gstack's
// listing without prove-it and its routing hook's event; prove-it typed, the /prove-it expansion with prove-it's body; and a
// Skill load of prove-it, its body with the load-time output of gstack's start step.
//
// Codex: one session of the real Codex 0.170.0 binary (by its pinned sha256) in a container holding cx-prove-it's tree at
// /root, against a stub Responses server, with the prompt typed "$prove-it " as LanebB2CodexAgent types it. It shows the
// mention injecting prove-it's skill item, which codex debug prompt-input cannot show (it prints the user text only). The
// Codex arms' listings are the build's prompt-input captures, already in each manifest.
//
// Each capture's facts are checked here (startProblems), and with --record their digests go into each arm's committed
// manifest as start.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { ROUTE_CONTEXT, ROUTE_MARK } from "../../quick/laneb/runner/proxy.ts";
import { BASE, CLAUDE_LISTED, LISTING } from "../delivery-route/sessions.ts";
import { sdkPython, SESSION_IMAGE } from "../harness-mechanics/sessions.ts";
import { codexArgs } from "../../src/adapters/codex/driver.ts";
import { MANIFESTS, type B2Manifest } from "./arms.ts";
import { ARM_DEFS, CODEX_BIN, HOSTS, LINE, MODELS, PROVE_IT, REPO, sha256, SKILL, SOL_EFFORT } from "./pins.ts";
import { START_MARK } from "./table.ts";

export type ClaudeCase = { name: string; label: string; mode: "stop" | "load"; told: string };
export const CLAUDE_CASES: ClaudeCase[] = [
  { name: "none-stop", label: "none", mode: "stop", told: "" },
  { name: "line-stop", label: "line", mode: "stop", told: "" },
  { name: "gstack-stop", label: "gstack", mode: "stop", told: "" },
  { name: "prove-it-typed", label: "prove-it", mode: "stop", told: SKILL },
  { name: "prove-it-load", label: "prove-it", mode: "load", told: "" },
];
export const CODEX_CASE = { name: "cx-prove-it-typed", label: "cx-prove-it" } as const;
const TASK = "add() in calc.py returns the difference of its arguments. Make it return their sum.";

export type StartCapture = { listing: string | null; names: string[]; user: string[]; system_has_line: boolean; hook_context: string[]; hook_log: string | null; loaded: string | null; probe: Record<string, string>; requests: number };
export const listingNames = (listing: string | null) => [...(listing ?? "").matchAll(/^- ([\w:-]+)(?::|$)/gm)].map((m) => m[1]!);

/** What one Claude Code start capture must show for its arm. */
export function claudeProblems(c: ClaudeCase, cap: StartCapture, sdk: string): string[] {
  const p: string[] = [], want = (what: string, ok: boolean) => { if (!ok) p.push(c.name + ": " + what); };
  if (!parseLog(sdk).length || cap.listing === null || !cap.user.length) return [c.name + ": no session (no SDK log, listing or first request)"];
  const first = cap.user.join("\n"), names = cap.names, d = ARM_DEFS[c.label]!;
  want("the container holds a .capy folder", cap.probe.capy === "0");
  if (!d.gstack) {
    want("the listing names " + names.join(", ") + ", not Claude Code's own alone", JSON.stringify([...names].sort()) === JSON.stringify([...CLAUDE_LISTED].sort()));
    want("a hook line reached a no-gstack session", !cap.hook_context.length && !first.includes(ROUTE_MARK));
    want("the container holds gstack files (" + cap.probe.gstack_files + ")", cap.probe.gstack_files === "0");
    if (d.arm === "line") want("the line is not in the session's first request", first.includes(LINE) || cap.system_has_line);
    else want("the line reached the none arm", !first.includes(LINE) && !cap.system_has_line);
    return p;
  }
  for (const s of ["verify", "qa", "review", ...CLAUDE_LISTED]) want("the listing does not name " + s, names.includes(s));
  want("the listing " + (d.arm === "prove-it" ? "does not name" : "names") + " prove-it", names.includes(SKILL) === (d.arm === "prove-it"));
  want("gstack-config reads skill_routing " + cap.probe.skill_routing + ", skill_contracts " + cap.probe.skill_contracts + " and telemetry " + cap.probe.telemetry + " in the container", cap.probe.skill_routing === "on" && cap.probe.skill_contracts === "on" && cap.probe.telemetry === "off");
  want("the routing hook logged no event on the prompt", /\bevent=/.test(cap.hook_log ?? ""));
  want("the line reached a gstack arm", !first.includes(LINE) && !cap.system_has_line);
  if (c.told) {
    want("the prompt is not typed as /" + SKILL + " (no command expansion in the first request)", first.includes("<command-name>/" + SKILL + "</command-name>"));
    want("the expansion does not carry prove-it's steps", first.includes(PROVE_IT.stepLine));
  } else want("a typed command reached an untyped session", !first.includes("<command-name>/"));
  if (c.mode === "load") {
    want("the Skill load is not prove-it's base line and steps", !!cap.loaded && cap.loaded.startsWith(BASE(SKILL)) && cap.loaded.includes(PROVE_IT.stepLine));
    want("the Skill load shows no output of gstack's start step (" + START_MARK + ")", !!cap.loaded && cap.loaded.includes(START_MARK));
  }
  return p;
}

/** What the Codex stub session must show: the typed mention reached the model with prove-it's skill item. */
export function codexProblems(bodies: any[]): string[] {
  const p: string[] = [], first = bodies[0];
  if (!first) return [CODEX_CASE.name + ": no request reached the stub Responses server"];
  const items: string[] = (first.input ?? []).map((it: any) => JSON.stringify(it));
  const user = items.find((t) => t.includes("$" + SKILL + " "));
  if (!user) p.push(CODEX_CASE.name + ": the typed prompt ($" + SKILL + " ...) is not in the first request");
  if (!items.some((t) => t.includes(PROVE_IT.stepLine) && t !== user)) p.push(CODEX_CASE.name + ": no item in the first request carries prove-it's steps (the mention injected nothing)");
  if (first.model !== MODELS.sol.id) p.push(CODEX_CASE.name + ": the request names model " + first.model + ", not " + MODELS.sol.id);
  if (first.reasoning?.effort !== SOL_EFFORT) p.push(CODEX_CASE.name + ": the request's effort is " + JSON.stringify(first.reasoning?.effort) + ", not " + SOL_EFFORT);
  return p;
}

const docker = (args: string[], input?: string, timeout = 600_000) => spawnSync("docker", args, { input, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
const RESET = ["set -e", "mkdir -p /testbed", "cd /testbed", "printf 'def add(a, b):\\n    return a - b\\n' > calc.py", "git init -q && git add -A && git -c user.name=b2 -c user.email=b2@example.invalid commit -qm snapshot"].join("\n");
const PROBE = ['echo "capy=$(find / -xdev -maxdepth 3 -type d -name .capy 2>/dev/null | wc -l)"', 'echo "gstack_files=$(find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -iname "*gstack*" ! -iname "*sigstack*" -print 2>/dev/null | wc -l)"',
  'g=/root/.claude/skills/gstack/bin/gstack-config; if [ -x "$g" ]; then for k in skill_routing skill_contracts telemetry; do echo "$k=$("$g" get $k)"; done; fi'].join("\n");
const texts = (m: any): string[] => (typeof m?.content === "string" ? [m.content] : (m?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text));
const kv = (s: string) => Object.fromEntries(s.trim().split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

async function claudeSessions(out: string, arms: string, problems: string[]) {
  const py = sdkPython(), reqLog = join(out, "requests.jsonl"), bodyLog = join(out, "bodies.jsonl");
  rmSync(reqLog, { force: true }); rmSync(bodyLog, { force: true });
  const fake = Bun.spawn(["bun", join(REPO, "lanes/delivery-route/fake-model.ts"), "0", reqLog, bodyLog], { stdout: "pipe", stderr: "inherit" });
  const head = new TextDecoder().decode((await fake.stdout.getReader().read()).value ?? new Uint8Array());
  const port = /127\.0\.0\.1:(\d+)/.exec(head)?.[1], ran: { c: ClaudeCase; extra: Record<string, unknown> }[] = [];
  try {
    if (!port) throw new Error("E_B2_SESSIONS the stub model did not start: " + head.slice(0, 200));
    for (const c of CLAUDE_CASES) {
      const name = "b2-sessions-" + c.name + "-" + process.pid, dir = join(out, c.name), trial = join(dir, "trial"), d = ARM_DEFS[c.label]!;
      rmSync(dir, { recursive: true, force: true }); mkdirSync(trial, { recursive: true });
      const up = docker(["run", "-d", "--name", name, "--network", "host", "--cap-drop", "NET_RAW", "--cap-drop", "NET_ADMIN", SESSION_IMAGE, "sleep", "infinity"]);
      if (up.status !== 0) { problems.push(c.name + ": container did not start: " + up.stderr.trim().slice(-200)); continue; }
      try {
        if (docker(["exec", "-i", name, "sh", "-s"], RESET).status !== 0) { problems.push(c.name + ": reset failed"); continue; }
        const spec = { case: c.name, arm: c.label, tar: join(arms, d.tar + ".tar"), strip: true, told: c.told, session_kind: d.gstack ? "unattended" : "", container: name, base_url: "http://127.0.0.1:" + port, instruction: "[b1-session " + c.name + "] [b1-script " + c.mode + "] " + TASK, out: trial };
        const r = spawnSync(py, [join(REPO, "lanes/test-first/sessions-driver.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 900_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PYTHONPATH: join(REPO, "quick/laneb/runner/agent") } });
        writeFileSync(join(dir, "driver.log"), (r.stdout ?? "") + (r.stderr ?? ""));
        if (r.status !== 0) { problems.push(c.name + ": driver exited " + r.status + " (" + join(dir, "driver.log") + ")"); continue; }
        const probe = kv(docker(["exec", "-i", name, "sh", "-s"], PROBE).stdout ?? "");
        const log = d.gstack ? docker(["exec", name, "sh", "-c", "cat /root/.gstack/hooks/skill-route.log 2>/dev/null | sed 's/session=[^ ]*/session=<id>/; s/also_source=[^ ]*/also_source=<path>/'"]).stdout ?? "" : null;
        ran.push({ c, extra: { hook_log: log, probe } });
      } finally { docker(["rm", "-f", name]); }
    }
    await Bun.sleep(300);
    const bodies = (existsSync(bodyLog) ? readFileSync(bodyLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const { c, extra } of ran) {
      const mine = bodies.filter((b) => b.session === c.name), dest = join(out, c.name, "capture");
      mkdirSync(dest, { recursive: true });
      cpSync(join(out, c.name, "trial", "evaluator", "sdk-messages.jsonl"), join(dest, "sdk-messages.jsonl"));
      const sys = mine[0] ? (typeof mine[0].system === "string" ? mine[0].system : texts({ content: mine[0].system }).join("")) + texts(mine[0].messages.find((m: any) => m.role === "system")).join("") : "";
      const at = sys.indexOf(LISTING), listing = at < 0 ? null : sys.slice(at, sys.indexOf("\n\n", at + LISTING.length) + 1);
      const hook = sys.split(ROUTE_CONTEXT.slice(0, -ROUTE_MARK.length)).slice(1).map((s: string) => s.split("\n")[0]!);
      let loaded: string | null = null;
      for (const b of mine) { const i = b.messages.findIndex((m: any) => m.role === "user" && Array.isArray(m.content) && m.content.some((x: any) => x.type === "tool_result" && /^Launching skill: /.test(String(x.content)))); if (i >= 0) { loaded = texts(b.messages[i]).join("\n"); break; } }
      const cap: StartCapture = { listing, names: listingNames(listing), user: mine[0] ? texts(mine[0].messages.find((m: any) => m.role === "user")) : [], system_has_line: sys.includes(LINE), hook_context: hook, hook_log: extra.hook_log as string | null, loaded, probe: extra.probe as Record<string, string>, requests: mine.length };
      writeFileSync(join(dest, "capture.json"), JSON.stringify(cap, null, 2) + "\n");
      problems.push(...claudeProblems(c, cap, readFileSync(join(dest, "sdk-messages.jsonl"), "utf8")));
    }
  } finally { fake.kill(); }
  return ran.map((r) => r.c.name);
}

/** The stub Responses server: one assistant message per request, every body logged. */
function stubResponses(log: string) {
  return Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const body: any = await req.json().catch(() => ({}));
    writeFileSync(log, JSON.stringify(body) + "\n", { flag: "a" });
    const id = "resp_b2_" + Math.random().toString(36).slice(2), usage = { input_tokens: 100, output_tokens: 1, total_tokens: 101, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
    const item = { type: "message", id: "msg_0", role: "assistant", status: "completed", content: [{ type: "output_text", text: "STATUS: NOT FIXED", annotations: [] }] };
    const ev: [string, unknown][] = [["response.created", { type: "response.created", response: { id, object: "response", model: body.model, status: "in_progress", output: [] } }], ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item }], ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item }], ["response.completed", { type: "response.completed", response: { id, object: "response", model: body.model, status: "completed", output: [item], usage } }]];
    return new Response(ev.map(([n, e]) => "event: " + n + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
  } });
}

async function codexSession(out: string, arms: string, codexDir: string, problems: string[]) {
  const bin = join(codexDir, "bin/codex");
  if (!existsSync(bin) || sha256(readFileSync(bin)) !== HOSTS.codex.binarySha256) throw new Error("E_B2_SESSIONS " + bin + " is not Codex " + HOSTS.codex.version + "'s binary (sha256 " + HOSTS.codex.binarySha256 + ")");
  const dir = join(out, CODEX_CASE.name), bodies = join(dir, "bodies.jsonl");
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const server = stubResponses(bodies), name = "b2-sessions-codex-" + process.pid;
  try {
    const up = docker(["run", "-d", "--name", name, "--network", "host", "-v", resolve(codexDir) + ":/opt/laneb/codex:ro", "-v", join(arms, ARM_DEFS[CODEX_CASE.label]!.tar + ".tar") + ":/arm.tar:ro", SESSION_IMAGE, "sleep", "infinity"]);
    if (up.status !== 0) { problems.push(CODEX_CASE.name + ": container did not start: " + up.stderr.trim().slice(-200)); return; }
    if (docker(["exec", "-i", name, "sh", "-s"], RESET + "\ntar -xf /arm.tar -C /root").status !== 0) { problems.push(CODEX_CASE.name + ": reset failed"); return; }
    const args = codexArgs({ model: MODELS.sol.id, provider: "openai", proxy: { baseUrl: "http://127.0.0.1:" + server.port, slot: "laneb", token: "b2-stub-token" }, effort: SOL_EFFORT, hookTrust: true });
    const proc = Bun.spawn(["docker", "exec", "-i", "-w", "/testbed", "-e", "OPENAI_API_KEY=b2-stub-token", "-e", "CODEX_HOME=/root/.codex", "-e", "GSTACK_SESSION_KIND=unattended", name, CODEX_BIN, ...args], { stdin: new TextEncoder().encode("$" + SKILL + " " + TASK), stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), 300_000);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const r = { status: await proc.exited };
    clearTimeout(timer);
    writeFileSync(join(dir, "codex.log"), stdout + stderr);
    const got = existsSync(bodies) ? readFileSync(bodies, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    problems.push(...codexProblems(got));
    const first = got[0];
    const items = (first?.input ?? []).map((it: any) => JSON.stringify({ ...it, id: undefined }));
    writeFileSync(join(dir, "capture.json"), JSON.stringify({ exit: r.status, requests: got.length, model: first?.model ?? null, effort: first?.reasoning?.effort ?? null, typed: items.find((t: string) => t.includes("$" + SKILL + " ")) ?? null, injected: items.filter((t: string) => t.includes(PROVE_IT.stepLine)).map((t: string) => sha256(t)) }, null, 2) + "\n");
  } finally { docker(["rm", "-f", name]); server.stop(true); }
}

/** A capture's digest for the manifest: the facts the checks read, with nothing that changes run to run. */
export function startDigest(capture: Record<string, unknown>): string {
  const { listing, names, hook_context, loaded, typed, injected, model, effort, user, system_has_line } = capture as Record<string, unknown>;
  const line = Array.isArray(user) ? system_has_line === true || user.some((u) => String(u).includes(LINE)) : undefined;
  return sha256(JSON.stringify({ listing, names, hook_context, loaded, typed, injected, model, effort, line }));
}

export async function runSessions(out: string, arms: string, codexDir: string, record = false) {
  mkdirSync(out, { recursive: true });
  const problems: string[] = [];
  await claudeSessions(out, arms, problems);
  await codexSession(out, arms, codexDir, problems);
  writeFileSync(join(out, "sessions.json"), JSON.stringify({ cases: [...CLAUDE_CASES.map((c) => c.name), CODEX_CASE.name], problems }, null, 2) + "\n");
  if (record && !problems.length) {
    const byLabel = new Map<string, Record<string, string>>();
    for (const c of [...CLAUDE_CASES, CODEX_CASE]) {
      const f = join(out, c.name, c.name === CODEX_CASE.name ? "" : "capture", "capture.json");
      byLabel.set(c.label, { ...(byLabel.get(c.label) ?? {}), [c.name]: startDigest(JSON.parse(readFileSync(f, "utf8"))) });
    }
    for (const [label, start] of byLabel) {
      const f = join(MANIFESTS, label + ".json"), m = JSON.parse(readFileSync(f, "utf8")) as B2Manifest;
      writeFileSync(f, JSON.stringify({ ...m, start }, null, 2) + "\n");
    }
  }
  return problems;
}
