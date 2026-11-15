// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's keyless driven launch (post section 14's dry run). A stub upstream (no network, no key) answers the
// real Claude Code binary, which h2h_turns.py drives on the real Claude Agent SDK through the outcome driver's h2h stage
// and its metering proxy, on a temporary ledger. Sessions run one at a time on the host, each in a fresh git tree with its
// arm's home as HOME: part A's homes when --homes and --pins are given, else fixture homes linked from the pinned pack
// clones under --packs (plugin packs passed as local plugin dirs). It prints one PASS or FAIL line per rule:
//   home <arm>: the session loads its pack into the first model request (the none arm's loads no pack), ends completed
//     with DONE after its scripted turn and no continuation, and the exposure detectors read it as loaded where the entry
//     names a command or the pack starts the session; the arms rotate through the DONE variants;
//   cap: GSD's two scripted feature turns run, then 6 continuations while DONE is absent, then the session ends at the cap,
//     each continuation that changed nothing counted as spurious;
//   ask: AskUserQuestion gets texts.question_reply, and the question is counted;
//   reservation: while Claude Code runs a tool, calls on its slot fill the allowance with reservations; its next request,
//     refused only for those reservations, is a retryable 429 that it retries after the retry-after once they are
//     released, and the refusal is counted apart from allowance stops;
//   concurrency: 5 and 21 calls in flight at the proxy's byte fallback;
//   teardown: every slot closed with its proxy finalize, and the driver stopped clean.
// It exits 1 (E_H2H_DRYRUN_FAIL) on any FAIL. _drive's quiet wait is shortened (quiet_sec 3); no frozen value changes.
// Usage: bun lanes/outcome-skills/h2h/sessions/dryrun.ts [--out <dir>] [--python <venv python>] [--claude <binary>]
//   [--packs <pinned clones>] [--homes <dir> --pins <arms-pins.json>] [--only <rule,...>]
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sse } from "../../../../quick/laneb/runner/fake_upstream.ts";
import { recordProgram } from "../../../../src/runner/ledger/envelope.ts";
import { recordApproval } from "../../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../../src/runner/ledger/local.ts";
import { RESERVATION_RETRY_AFTER_S } from "../../../../src/runner/proxy/metering-proxy.ts";
import { serveStages } from "../../driver/stage.ts";
import { readPrereg } from "../prereg.ts";
import type { ArmInstall, Entry, H2hArm } from "../types.ts";
import { H2H_PREFIX, H2H_STAGES } from "./driver.ts";
import { exposure, readEvents, readInstalls } from "./exposure.ts";
import { armHome, homeRule } from "./home.ts";
import { h2hConfig } from "./run.ts";
import { endOf } from "./session.ts";

const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
const ALIASES = ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"];
const HOLD = "h2h-dry-hold";
const SH = [join(import.meta.dir, "../../pfchecks/sh"), join(import.meta.dir, "sh")];
/** A pack skill each arm's home lists in the first model request, and the none arm's lists none of. */
export const NEEDLE: Record<string, string> = { gstack: "autoplan", "gstack-oneline": "autoplan", "gstack-qa": "autoplan", "gstack-pony": "ponystack", superpowers: "brainstorming", "agent-skills": "spec-driven-development", gsd: "gsd-debug", pstack: "poteto-mode", tstack: "full-send" };
export const DONE_VARIANTS = ["DONE", "**DONE**", "DONE.", "\u0060\u0060\u0060\nDONE\n\u0060\u0060\u0060", "DONE\nGSTACK_RESULT: ok", "done!"];
/** The home rows: each arm once, on the entry that exercises its pack's command where it has one. */
export const HOME_ROWS: Array<[H2hArm, Entry, boolean]> = [["none", "bug", false], ["gstack", "feature", true], ["gstack-oneline", "bug", true], ["gstack-qa", "bug", true], ["gstack-pony", "bug", true], ["superpowers", "bug", true], ["agent-skills", "bug", true], ["gsd", "bug", true], ["pstack", "bug", true], ["tstack", "bug", false]];

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
type Script = (n: number, said: string) => Promise<Block[]> | Block[];
const bash = (command: string): Block => ({ type: "tool_use", id: "toolu_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), name: "Bash", input: { command, description: "dry run step" } });
const text = (t: string): Block => ({ type: "text", text: t });

/** Fixture homes from the pinned clones: gstack's skills linked into .claude/skills with the frozen gstack CLAUDE.md, the
 *  files packs' skills linked likewise, and each plugin pack copied (without .git) as a local plugin dir under
 *  .claude/plugins/fixture. A plugin's commands under a symlinked .claude dir do not load in Claude Code 2.1.325, so plugin
 *  packs are copied, not linked. */
export function fixtureHome(arm: H2hArm, packs: string, dir: string): string[] {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const link = (src: string, dst: string) => {
    mkdirSync(dirname(dst), { recursive: true });
    symlinkSync(src, dst);
  };
  const skills = (root: string) => readdirSync(root).filter((d) => existsSync(join(root, d, "SKILL.md"))).forEach((d) => link(join(root, d), join(dir, ".claude/skills", d)));
  const plugin = (name: string, src: string) => {
    const d = join(dir, ".claude/plugins/fixture", name);
    cpSync(src, d, { recursive: true, filter: (p) => !/(^|\/)\.git$/.test(p) });
    if (!existsSync(join(d, ".claude-plugin/plugin.json"))) {
      mkdirSync(join(d, ".claude-plugin"), { recursive: true });
      copyFileSync(join(src, "plugin.json"), join(d, ".claude-plugin/plugin.json"));
    }
    return d;
  };
  const plugins: string[] = [];
  if (homeRule(arm) === "gstack") {
    link(join(packs, "gstack"), join(dir, ".claude/skills/gstack"));
    readdirSync(join(packs, "gstack")).filter((d) => existsSync(join(packs, "gstack", d, "SKILL.md"))).forEach((d) => link(join(packs, "gstack", d), join(dir, ".claude/skills", d)));
    writeFileSync(join(dir, ".claude/CLAUDE.md"), readPrereg().gstack_claude_md);
  }
  if (arm === "gstack-pony") plugins.push(plugin("ponystack", join(packs, "ponystack")));
  if (arm === "superpowers" || arm === "agent-skills") plugins.push(plugin(arm, join(packs, arm)));
  if (arm === "pstack") plugins.push(plugin("pstack", join(packs, "cursor-plugins/harness/pstack/claude-code")));
  if (arm === "gsd" || arm === "tstack") skills(join(packs, arm, "skills"));
  return plugins;
}

function gitTree(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "app.txt"), "bug\n");
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "base"]]) Bun.spawnSync(["git", "-C", dir, ...a], { env });
  return Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
}

const run = (cmd: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<{ exit: number; out: string }> =>
  new Promise((done) => {
    const c = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    c.stdout.on("data", (d) => chunks.push(d));
    c.stderr.on("data", (d) => chunks.push(d));
    const t = setTimeout(() => c.kill("SIGKILL"), timeoutMs);
    c.on("close", (n) => {
      clearTimeout(t);
      done({ exit: n ?? 1, out: Buffer.concat(chunks).toString() });
    });
  });

export async function main(argv: string[]): Promise<number> {
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  for (const k of Object.keys(process.env)) if (KEYS.test(k)) delete process.env[k];
  const P = readPrereg();
  const python = arg("--python") ?? process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
  const claude = arg("--claude") ?? process.env.H2H_CLAUDE_BIN ?? join(homedir(), ".capy/work/h2h-s/claude/claude-2.1.325/package/claude");
  const packs = arg("--packs") ?? join(homedir(), ".capy/work/h2h-s/packs");
  const installs: ArmInstall[] | undefined = arg("--pins") ? readInstalls(arg("--pins")!) : undefined;
  const only = arg("--only")?.split(",");
  const want = (rule: string) => !only || only.some((o) => rule === o || rule.startsWith(o + " "));
  const W = arg("--out") ?? mkdtempSync(join(homedir(), ".capy/work/h2h-dryrun-"));
  mkdirSync(join(W, "bin"), { recursive: true });
  if (!existsSync(join(W, "bin/claude"))) symlinkSync(claude, join(W, "bin/claude"));
  mkdirSync(join(W, "sh"), { recursive: true });
  for (const s of SH) cpSync(s, join(W, "sh"), { recursive: true });
  const lines: string[] = [];
  const rule = (name: string, ok: boolean, detail: string) => {
    const l = (ok ? "PASS " : "FAIL ") + name + ": " + detail;
    lines.push(l);
    console.log(l);
  };
  const version = Bun.spawnSync([claude, "--version"]).stdout.toString().trim();
  console.log("claude " + version + ", work " + W);

  let current: { script: Script; n: number; first: string | null; said: string[]; at: number[] } | null = null;
  let release: () => void = () => {};
  let gate = Promise.resolve();
  const held = { arrived: 0 };
  const upstream = async (url: string, init: RequestInit): Promise<Response> => {
    const raw = typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as Uint8Array);
    if (url.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
    const body = JSON.parse(raw) as Record<string, any>;
    const said = JSON.stringify(body.messages ?? []);
    if (said.includes(HOLD)) {
      held.arrived++;
      await gate;
      return Response.json({ id: "msg_hold", type: "message", role: "assistant", model: body.model, content: [text("ok")], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    }
    const main = Array.isArray(body.tools) && body.tools.length > 0;
    const s = current;
    if (!main || !s) return new Response(sse(body.model, [text("ok")] as any), { headers: { "content-type": "text/event-stream" } });
    if (s.n === 0) s.first = raw;
    s.said.push(said);
    s.at.push(Date.now());
    const blocks = await s.script(s.n++, said);
    return new Response(sse(body.model, blocks as any), { headers: { "content-type": "text/event-stream" } });
  };

  const record = join(W, "record");
  const quote = { words: "dry-run fixture words on a temporary ledger, not an approval", by: "h2h-dryrun", source: "h2h/sessions/dryrun.ts" };
  const D = 1_000_000;
  recordProgram(record, { program: "h2h-dry", cap_micros: 2_000 * D, skill_cap_micros: 2_000 * D, skills: ["h2h"], credit_rate_micros: D, quotes: [quote] });
  recordApproval(record, { action: "init", item: "h2h-smoke", cap_micros: 1_000 * D, quotes: [quote], admission: "required", program: "h2h-dry", skills: ["h2h"] });
  const local = LocalLedger.open(join(W, "ledger.sqlite"));
  const served = await serveStages({ record, local, run_id: "h2h-dry", envelope_host: "dry", machine: "dry", stages: [{ item: "h2h-smoke", arm: H2H_STAGES["h2h-smoke"]![0]!, arms: H2H_STAGES["h2h-smoke"]! }], host: "127.0.0.1", dir: join(W, "run"), fetch: upstream as typeof fetch, requireAdmission: () => null, env: { ANTHROPIC_API_KEY: "stub-upstream-not-a-key" }, log: () => {}, planned: 16, reruns: 0 });
  const control = served.control;
  const big = (model: string, small = false) => JSON.stringify({ model, max_tokens: small ? 1_000 : 32_000, system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: HOLD + " " + "x".repeat(small ? 10 : 690_000) }], tools: [{ name: "Bash", description: "run", input_schema: { type: "object" } }] });
  const fire = (base: string, token: string, n: number, small = false) => Array.from({ length: n }, () => fetch(base + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": token }, body: big(P.model, small) }).then(async (r) => ({ status: r.status, retry: r.headers.get("retry-after"), should: r.headers.get("x-should-retry"), code: r.status === 200 ? null : ((await r.json()) as any)?.error?.message ?? null })));
  const openSlot = async (arm: H2hArm, task: string) => (await (await fetch(control + "/sessions", { method: "POST", body: JSON.stringify({ trial: "dry-" + task, model: P.model, cap_usd: P.limits.allowance_usd, ledger: "u4", open_key: crypto.randomUUID(), meta: { arm: H2H_PREFIX + arm, task, trial_n: 1 } }) })).json()) as Record<string, any>;
  const closeSlot = async (id: string) => (await (await fetch(control + "/sessions/" + id + "/close", { method: "POST", body: JSON.stringify({ reason: "agent_finished" }) })).json()) as Record<string, any>;
  const closes: Array<Record<string, any>> = [];

  const session = async (name: string, arm: H2hArm, entry: Entry, script: Script, slot?: Record<string, any>) => {
    const dir = join(W, name);
    const repo = join(dir, "repo");
    const head = gitTree(repo);
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    let plugins: string[] = [];
    if (installs && arg("--homes") && arm !== "none") cpSync(armHome(arm, { installs, homes: arg("--homes")! }).dir!, home, { recursive: true, verbatimSymlinks: true });
    else plugins = fixtureHome(arm, packs, home);
    const statement = "h2h-dry " + name + ": app.txt says bug; make it say fixed.";
    const base = h2hConfig({ session: { unit: name, kind: "O", entry, stage: "stage0", index: 0, arm, item: "h2h-smoke" }, home: { arm, dir: home, home_rule: homeRule(arm), home_tree_sha256: null } }, statement, "O", P);
    const model = Object.fromEntries(ALIASES.map((k) => [k, P.model]));
    const cfg = {
      ...base, limits: { ...base.limits, quiet_sec: 3, bg_wait_sec: 10 }, env: { ...base.env, ...model, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") }, cli_path: claude, cwd: repo, repo, work: join(dir, "work"), sh_dir: join(W, "sh"), home,
      exec_prefix: [], out: join(dir, "out"), model: P.model, plugins, commits: 1, head, ...(slot ? { base_url: slot.base_url, token: slot.token } : { control, arm: H2H_PREFIX + arm, task: name }),
    };
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg, null, 1));
    current = { script, n: 0, first: null, said: [], at: [] };
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
    const r = await run(python, [join(import.meta.dir, "h2h_turns.py"), join(dir, "config.json")], { ...env, PATH: join(W, "bin") + ":" + env.PATH, PYTHONDONTWRITEBYTECODE: "1" }, 900_000);
    writeFileSync(join(dir, "python.log"), r.out);
    const s = current;
    current = null;
    const file = join(dir, "out/h2h-summary.json");
    const summary = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, any>) : null;
    if (summary?.slot?.close && "finalized" in summary.slot.close) closes.push(summary.slot.close);
    const files = ["sdk-messages.jsonl", "claude-session.jsonl"].map((f) => join(dir, "out", f)).filter(existsSync);
    return { summary, stub: s!, exposure: files.length ? exposure(arm, entry, readEvents(files)) : null, log: r.out.slice(-600) };
  };
  const brief = (x: Record<string, any> | null) => x ? "end " + endOf(x) + ", phases " + (x.turns ?? []).map((t: any) => t.phase + ":" + t.termination).join(",") + ", continuations " + x.continuations + ", spurious " + x.spurious_continuations + ", done " + x.done + (x.refused ? ", refused " + String(x.refused).slice(0, 200) : "") : "no summary";

  try {
    for (const [i, [arm, entry, loaded]] of HOME_ROWS.entries()) {
      if (!want("home " + arm)) continue;
      const variant = DONE_VARIANTS[i % DONE_VARIANTS.length]!;
      const r = await session("home-" + arm, arm, entry, (n) => (n === 0 ? [bash("printf 'fixed\\n' > app.txt")] : [text("Fixed app.txt.\n\n" + variant)]));
      const first = r.stub.first ?? "";
      const lists = arm === "none" ? Object.values(NEEDLE).filter((x) => first.includes(x)) : first.includes(NEEDLE[arm]!) ? [NEEDLE[arm]!] : [];
      const ok = !!r.summary && endOf(r.summary) === "completed" && r.summary.done === true && r.summary.continuations === 0 && r.summary.turns.length === 1 && (arm === "none" ? lists.length === 0 : lists.length === 1) && r.exposure?.loaded === loaded;
      rule("home " + arm, ok, brief(r.summary) + "; first request " + (arm === "none" ? "lists no pack skill" + (lists.length ? " but lists " + lists.join(", ") : "") : (lists.length ? "lists " : "does not list ") + NEEDLE[arm]) + "; DONE variant " + JSON.stringify(variant) + "; exposure " + JSON.stringify(r.exposure) + (ok ? "" : "; log " + r.log));
    }
    if (want("cap")) {
      const r = await session("cap", "gsd", "feature", () => [text("Still looking into it.")]);
      const x = r.summary;
      const phases = (x?.turns ?? []).map((t: any) => t.phase).join(",");
      rule("cap", !!x && phases === "t1,t2,c1,c2,c3,c4,c5,c6" && x.next === "end_cap" && x.continuations === P.continuation_cap && x.spurious_continuations === P.continuation_cap && x.done === false && endOf(x) === "completed", brief(x) + "; next " + x?.next);
    }
    if (want("ask")) {
      const q = { questions: [{ question: "Which file should I change?", header: "File", options: [{ label: "app.txt", description: "the file the report names" }, { label: "other", description: "another file" }], multiSelect: false }] };
      const r = await session("ask", "none", "bug", (n, said) => (n === 0 ? [{ type: "tool_use", id: "toolu_ask0001", name: "AskUserQuestion", input: q }] : said.includes(P.texts.question_reply.slice(0, 40)) ? [text("Answered.\nDONE")] : [text("The answer did not arrive.")]));
      const x = r.summary;
      const asked = Object.values((x?.questions ?? {}) as Record<string, any>).reduce((a: number, c: any) => a + (c.ask_user_question ?? 0), 0);
      rule("ask", !!x && asked === 1 && x.done === true && endOf(x) === "completed", brief(x) + "; AskUserQuestion answered " + asked + " time(s) with the frozen reply");
    }
    if (want("reservation")) {
      const slot = await openSlot("none", "reservation");
      let fired: Promise<Array<{ status: number }>> = Promise.resolve([]);
      let answered = 0;
      let filled = 0;
      const r = await session("reservation", "none", "bug", async (n) => {
        if (n > 0) return [text("DONE")];
        gate = new Promise((ok) => (release = ok));
        held.arrived = 0;
        answered = Date.now();
        setTimeout(() => {
          const calls = [...fire(slot.base_url, slot.token, 6), ...fire(slot.base_url, slot.token, 500, true)];
          fired = Promise.all(calls);
          const refused = { n: 0 };
          calls.forEach((c) => c.then((x) => x.status !== 200 && refused.n++));
          const watch = setInterval(() => {
            if (held.arrived + refused.n < calls.length) return;
            filled = Date.now();
            clearInterval(watch);
          }, 20);
          setTimeout(() => release(), 25_000);
        }, 500);
        return [bash("sleep 15")];
      }, slot);
      const big = await fired;
      const close = await closeSlot(slot.id);
      closes.push(close);
      const refusedBig = big.filter((b) => b.status === 429).length;
      const waited = r.stub.at.length > 1 ? (r.stub.at[1]! - answered) / 1000 : -1;
      const own = Number(close.reservation_bound ?? 0) - refusedBig;
      rule("reservation", !!r.summary && endOf(r.summary) === "completed" && r.summary.done === true && own >= 1 && Number(close.allowance_stops ?? 0) === 0 && filled > 0 && filled - answered < 15_000 && waited >= RESERVATION_RETRY_AFTER_S - 2, brief(r.summary) + "; the calls filled the allowance " + ((filled - answered) / 1000).toFixed(1) + " s after the answer; held " + big.filter((b) => b.status === 200).length + " calls in flight (" + refusedBig + " more refused), Claude Code's own reservation-bound refusals " + own + ", its next request " + waited.toFixed(1) + " s after the answer before them, allowance stops " + close.allowance_stops);
    }
    if (want("concurrency")) {
      const slot = await openSlot("none", "concurrency");
      const out: string[] = [];
      let ok = true;
      for (const [n, inFlight, refusedWant] of [[5, 5, 0], [21, 6, 15]] as const) {
        gate = new Promise((r) => (release = r));
        held.arrived = 0;
        const calls = fire(slot.base_url, slot.token, n);
        const refused = { n: 0, ok: true };
        calls.forEach((c) => c.then((x) => {
          if (x.status === 200) return;
          refused.n++;
          if (!(x.status === 429 && x.retry === String(RESERVATION_RETRY_AFTER_S) && x.should === "true" && String(x.code).startsWith("E_H2H_RESERVATION_BOUND"))) refused.ok = false;
        }));
        for (let i = 0; i < 500 && held.arrived + refused.n < n; i++) await Bun.sleep(20);
        const arrived = held.arrived;
        release();
        await Promise.all(calls);
        ok &&= arrived === inFlight && refused.n === refusedWant && refused.ok;
        out.push(n + " calls: " + arrived + " in flight, " + refused.n + " retryable 429s");
      }
      const close = await closeSlot(slot.id);
      closes.push(close);
      rule("concurrency", ok && Number(close.reservation_bound) === 15 && Number(close.allowance_stops ?? 0) === 0, out.join("; ") + "; reservation_bound " + close.reservation_bound + ", allowance stops " + close.allowance_stops);
    }
  } finally {
    const stopped = await served.stop();
    rule("teardown", stopped === 0 && closes.length > 0 && closes.every((c) => c.finalized === true), closes.length + " slots closed, finalized " + closes.filter((c) => c.finalized === true).length + "; driver stop exit " + stopped);
  }
  writeFileSync(join(W, "dryrun.txt"), lines.join("\n") + "\n");
  const failed = lines.filter((l) => l.startsWith("FAIL"));
  if (failed.length) console.error("E_H2H_DRYRUN_FAIL " + failed.length + " of " + lines.length + " rules failed; " + join(W, "dryrun.txt"));
  return failed.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
