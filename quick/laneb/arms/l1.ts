// L1 arms (wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000, sections 2 and 10): the two gstack pins, the
// prereg's frozen values, each arm's manifest meta and the checks that run inside the arm images.
//
//   bun arms/l1.ts manifest --arm <arm> --tree <dir> --tar <file> --out <dir> [--fetch <json> --config <tsv> --lock <json>] [--meta k=v ...]
//   bun arms/l1.ts check --arm <arm> [--doctor <kind>]                  inside a check container, the arm extracted in /root
//   bun arms/l1.ts session --arm <arm> [--prompt <text>] [--doctor <kind>]   the same; one untold and one told session
//
// Paths in the lite tree digest are normalized as manifest.py does: <RENDER> for /root/.gstack/render/claude, then
// <HOME> for /root, and loadout.lock.json is left out.

import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { manifest } from "./tree.ts";
import { sse } from "../runner/fake_upstream.ts";

export const ARMS = ["none", "before", "after", "off"] as const;
export type Arm = (typeof ARMS)[number];
export type GstackArm = Exclude<Arm, "none">;
export const REPO_URL = "https://github.com/garrytan/gstack.git";
export const PINS = {
  before: { sha: "82db89ab3ea3c64185538b8af33da2ffd1a18b57", version: "1.93.22.0" },
  after: { sha: "699a41cb6808e01240d02e82247693f9170d401a", version: "1.94.39.0" },
} as const;
export const pinOf = (arm: GstackArm) => (arm === "before" ? "before" : "after");
export const SETUP = "./setup --host claude --no-browser --loadout lite";
export const CLAUDE_CODE_VERSION = "2.1.312";
export const FROZEN = {
  spec: "lite",
  spec_sha256: "c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d",
  files: 204,
  tree_digest: { before: "35dbf7b3ce88149e45e91f5d1932c790e608d583837b69e85784564a24ab8321", after: "ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7" },
  investigate_sha256: { before: "c303d9febdc326b90d2fd4512f5aa2516618a209cf6da0db8973ed2e07dd20e9", after: "02b0e1e7491330d1d08b4fd92b2c76f0181655c3a176874fbda5bd35bc5de7f9" },
  investigate_first200: { before: "07bd7af57db2433d97f3d9a4646bf9e3314f69d08c37a35dcec8cd5987e916a0", after: "5bd9a0c6e900276b4d8a08727bee300c3ce85ba1a08ae47361729d7056c83f61" },
} as const;

export type Hook = { event: string; _gstack_source: string | null; command: string; timeout: number | null };
const hook = (event: string, source: string, file: string, timeout: number): Hook => ({ event, _gstack_source: source, command: "<HOME>/.claude/skills/gstack/hosts/claude/hooks/" + file, timeout });
const TIMELINE = hook("Stop", "gstack-timeline-stop", "timeline-stop-hook", 5);
const CONTRACT = hook("Stop", "gstack-skill-contract", "skill-contract-stop-hook", 10);
const ROUTE = hook("UserPromptSubmit", "gstack-skill-route", "skill-route-hook", 5);
export const EXPECTED_HOOKS: Record<GstackArm, Hook[]> = { before: [TIMELINE], after: [TIMELINE, CONTRACT, ROUTE], off: [TIMELINE, CONTRACT, ROUTE] };

// The fixture prompt for the hook sessions, and the after pin's own gstack-skill-route score for it at threshold 0.66.
export const FIXTURE_PROMPT = "The test suite fails with a KeyError in the parser after the last change. Find the root cause and fix it.";
export const FIXTURE_ROUTE = { skill: "investigate", score: 1, trigger: "test fails" };
export const ROUTE_MARK = "gstack skill routing (UserPromptSubmit hook;";
export const CONTRACT_MARK = "Stop hook feedback:\nSKILL_CONTRACT_UNMET investigate";

export const DOCTORS = ["render-byte", "no-contract-hook", "gstack-in-none", "routing-on", "silent-route-hook"] as const;
export type Doctor = (typeof DOCTORS)[number];

const HOME = "/root";
const RENDER = "/root/.gstack/render/claude";
const GSTACK = "/root/.claude/skills/gstack";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export function normalize(bytes: Uint8Array, home = HOME, render = RENDER): Buffer {
  return Buffer.from(Buffer.from(bytes).toString("latin1").split(render).join("<RENDER>").split(home).join("<HOME>"), "latin1");
}

/** manifest.py's tree(): one "<rel>\t<sha256 of the normalized bytes>" row per file, sorted, loadout.lock.json left out. */
export function normTree(root: string, home = HOME, render = RENDER): { rows: [string, string][]; digest: string } {
  const rows: [string, string][] = [];
  const visit = (rel: string) => {
    for (const name of readdirSync(join(root, rel))) {
      const path = rel ? rel + "/" + name : name;
      const st = lstatSync(join(root, path));
      if (st.isDirectory()) visit(path);
      else if (st.isSymbolicLink() && statSync(join(root, path)).isDirectory()) continue;
      else if (path !== "loadout.lock.json") rows.push([path, sha256(normalize(readFileSync(join(root, path)), home, render))]);
    }
  };
  visit("");
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { rows, digest: sha256(rows.map(([p, h]) => p + "\t" + h + "\n").join("")) };
}

export function liteLock(file: string) {
  const raw = readFileSync(file);
  const lock = JSON.parse(raw.toString()) as { spec: string; spec_sha256: string; files: { path: string; sha256: string }[] };
  return { spec: lock.spec, spec_sha256: lock.spec_sha256, files: lock.files.length, lock_sha256: sha256(raw), paths: lock.files };
}

/** Every file a fresh render's lock lists must be in the installed render with the same bytes, and nothing else. */
export function liteMatch(installed: string, fresh: string): { spec_sha256: string; files: number; matched: number; problems: string[] } {
  const lock = liteLock(join(fresh, "loadout.lock.json"));
  const problems: string[] = [];
  if (lock.spec !== FROZEN.spec) problems.push("lock spec " + lock.spec);
  if (lock.spec_sha256 !== FROZEN.spec_sha256) problems.push("lock spec_sha256 " + lock.spec_sha256);
  if (lock.files !== FROZEN.files) problems.push("lock lists " + lock.files + " files");
  let matched = 0;
  for (const f of lock.paths) {
    const [a, b] = [join(installed, f.path), join(fresh, f.path)];
    if (existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b)) && sha256(readFileSync(b)) === f.sha256) matched++;
    else problems.push("differs: " + f.path);
  }
  const listed = new Set(lock.paths.map((f) => f.path));
  for (const [p] of normTree(installed).rows) if (!listed.has(p)) problems.push("not in the lock: " + p);
  return { spec_sha256: lock.spec_sha256, files: lock.files, matched, problems };
}

export function hookEntries(settingsText: string, home = HOME): Hook[] {
  const hooks = (JSON.parse(settingsText) as { hooks?: Record<string, { _gstack_source?: string; hooks?: { command: string; timeout?: number }[] }[]> }).hooks ?? {};
  return Object.keys(hooks).sort().flatMap((event) => hooks[event]!.flatMap((g) => (g.hooks ?? []).map((h) => ({
    event, _gstack_source: g._gstack_source ?? null, command: String(h.command).split(home).join("<HOME>"), timeout: h.timeout ?? null,
  }))));
}

export function checkHooks(arm: GstackArm, entries: Hook[]): string[] {
  return JSON.stringify(entries) === JSON.stringify(EXPECTED_HOOKS[arm]) ? [] : ["hooks " + JSON.stringify(entries) + " are not " + JSON.stringify(EXPECTED_HOOKS[arm])];
}

/** The none arm: no gstack checkout, no gstack state, nothing under ~/.claude/skills and no gstack hook in any settings file. */
export function checkNone(root: string): string[] {
  const problems: string[] = [];
  for (const p of [".local/share/gstack", ".gstack"]) if (existsSync(join(root, p))) problems.push(p + " exists");
  const skills = join(root, ".claude/skills");
  if (!existsSync(skills)) problems.push(".claude/skills is missing");
  else for (const name of readdirSync(skills)) problems.push(".claude/skills/" + name + (/gstack/i.test(name) ? " is gstack" : " is not empty"));
  if (existsSync(join(root, ".claude")))
    for (const name of readdirSync(join(root, ".claude")).filter((n) => /^settings.*\.json$/.test(n)))
      if (/gstack/i.test(JSON.stringify((JSON.parse(readFileSync(join(root, ".claude", name), "utf8")) as { hooks?: unknown }).hooks ?? {}))) problems.push(".claude/" + name + " has a gstack hook");
  return problems;
}

export function checkConfig(arm: GstackArm, values: Record<string, string>): string[] {
  const keys = ["skill_routing", "skill_contracts"];
  if (arm === "off") return keys.filter((k) => values[k] !== "off").map((k) => k + " is " + JSON.stringify(values[k]) + ", not off");
  if (arm === "after") return keys.filter((k) => values[k] === "off").map((k) => k + " is off");
  return [];
}

/** A task image passes when the hooks' bash shims would find bash and the runtime's own Bun 1.4.4 first on PATH. */
export const bunOk = (path: string, version: string, bash: string) => path === "/opt/laneb/bin/bun" && version === "1.4.4" && bash === "yes";

const inJson = (value: unknown, text: string) => JSON.stringify(value ?? "").includes(JSON.stringify(text).slice(1, -1));
export function sessionSignals(bodies: { messages?: unknown }[]) {
  return {
    requests: bodies.length,
    route_in_first: inJson(bodies[0]?.messages, ROUTE_MARK),
    route_anywhere: bodies.some((b) => inJson(b.messages, ROUTE_MARK)),
    contract_feedback: bodies.some((b) => inJson(b.messages, CONTRACT_MARK)),
  };
}

export function investigate(render: string) {
  const nb = normalize(readFileSync(join(render, "investigate", "SKILL.md")));
  return { sha256_normalized: sha256(nb), first200_sha256: sha256([...nb.toString("utf8")].slice(0, 200).join("")) };
}

/** The frozen values an arm's tree must carry; returns each difference. */
export function frozenProblems(arm: GstackArm, meta: { lite: { spec: string; spec_sha256: string; files: number; tree_digest_normalized: string }; investigate: { sha256_normalized: string; first200_sha256: string }; hooks: Hook[] }): string[] {
  const pin = pinOf(arm);
  const want: [string, unknown, unknown][] = [
    ["lite spec", meta.lite.spec, FROZEN.spec],
    ["lite spec_sha256", meta.lite.spec_sha256, FROZEN.spec_sha256],
    ["lite files", meta.lite.files, FROZEN.files],
    ["lite tree digest", meta.lite.tree_digest_normalized, FROZEN.tree_digest[pin]],
    ["investigate sha256", meta.investigate.sha256_normalized, FROZEN.investigate_sha256[pin]],
    ["investigate first 200", meta.investigate.first200_sha256, FROZEN.investigate_first200[pin]],
  ];
  return [...want.filter(([, got, exp]) => got !== exp).map(([k, got, exp]) => k + ": got " + got + ", prereg " + exp), ...checkHooks(arm, meta.hooks)];
}

function gstackMeta(tree: string, fetchFile: string, configFile: string, lockFile: string) {
  const render = join(tree, ".gstack/render/claude");
  const lock = liteLock(lockFile);
  const fetch = JSON.parse(readFileSync(fetchFile, "utf8")) as { repo: string; sha: string; head: string; method: string; git_archive_sha256: string };
  const config = Object.fromEntries(readFileSync(configFile, "utf8").trim().split("\n").map((l) => l.split("\t") as [string, string]));
  return {
    gstack_version: readFileSync(join(tree, ".claude/skills/gstack/VERSION"), "utf8").trim(),
    fetch: { repo: fetch.repo, sha: fetch.sha, head: fetch.head, method: fetch.method },
    git_archive_sha256: fetch.git_archive_sha256,
    setup: SETUP,
    lite: { spec: lock.spec, spec_sha256: lock.spec_sha256, files: lock.files, lock_sha256: lock.lock_sha256, tree_digest_normalized: normTree(render).digest },
    hooks: hookEntries(readFileSync(join(tree, ".claude/settings.json"), "utf8")),
    gstack_config: { skill_routing: config.skill_routing ?? "", skill_contracts: config.skill_contracts ?? "" },
    investigate: investigate(render),
  };
}

const run = (cmd: string, args: string[], cwd = "/app") => spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120_000 });
const cfg = (...args: string[]) => run(GSTACK + "/bin/gstack-config", args).stdout.trim();

function doctor(kind: Doctor | undefined) {
  if (kind === "render-byte") {
    const f = RENDER + "/investigate/SKILL.md";
    const b = readFileSync(f);
    b[100] = b[100]! ^ 1;
    writeFileSync(f, b);
  } else if (kind === "no-contract-hook") {
    const f = HOME + "/.claude/settings.json";
    const st = JSON.parse(readFileSync(f, "utf8"));
    st.hooks.Stop = st.hooks.Stop.filter((g: { _gstack_source?: string }) => g._gstack_source !== "gstack-skill-contract");
    writeFileSync(f, JSON.stringify(st, null, 2));
  } else if (kind === "gstack-in-none") run("mkdir", ["-p", HOME + "/.claude/skills/gstack"]);
  else if (kind === "routing-on") cfg("set", "skill_routing", "on");
  else if (kind === "silent-route-hook") writeFileSync(GSTACK + "/hosts/claude/hooks/skill-route-hook", "#!/usr/bin/env bash\nexit 0\n");
}

/** The in-image checks for one arm. Each result carries ok and its problems. */
export function inImageChecks(arm: Arm) {
  if (arm === "none") {
    const problems = checkNone(HOME);
    return { none: { ok: problems.length === 0, problems } };
  }
  const aside = RENDER + ".installed";
  renameSync(RENDER, aside);
  const render = run(GSTACK + "/bin/gstack-modules", ["render", "--host", "claude", "--loadout", "lite", "--out-dir", RENDER], GSTACK);
  const lite = render.status === 0 ? liteMatch(aside, RENDER) : { spec_sha256: "", files: 0, matched: 0, problems: ["gstack-modules render exited " + render.status + ": " + render.stderr.slice(-300)] };
  rmSync(RENDER, { recursive: true, force: true });
  renameSync(aside, RENDER);
  const entries = hookEntries(readFileSync(HOME + "/.claude/settings.json", "utf8"));
  const hookProblems = checkHooks(arm, entries);
  const values = { skill_routing: cfg("get", "skill_routing"), skill_contracts: cfg("get", "skill_contracts") };
  const configProblems = checkConfig(arm, values);
  return {
    lite: { ok: lite.problems.length === 0, ...lite },
    hooks: { ok: hookProblems.length === 0, entries, problems: hookProblems },
    config: { ok: configProblems.length === 0, values, problems: configProblems },
  };
}

// Claude Code writes the session transcript a moment after the reply arrives. Answered at once, the Stop hooks ran
// before the transcript existed and the contract hook failed open (ENOENT, logged in hooks/skill-contract.log).
// A real model takes seconds per turn; the fake upstream waits 2 s.
export const REPLY_DELAY_MS = 2000;

/** One Claude Code session as the Lane B agent starts it, against a fake upstream that answers every turn with text. */
export async function claudeSession(prompt: string, claude = "claude"): Promise<{ code: number | null; bodies: Record<string, unknown>[]; stderr: string }> {
  const bodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (req.method !== "POST") return Response.json({});
      const body = (await req.json()) as Record<string, unknown>;
      if (new URL(req.url).pathname.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      bodies.push(body);
      await Bun.sleep(REPLY_DELAY_MS);
      return new Response(sse(String(body.model), [{ type: "text", text: "DONE" }]), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const model = "claude-opus-5-5";
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ANTHROPIC_API_KEY: "placeholder-not-a-key",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:" + server.port,
    ANTHROPIC_MODEL: model,
    CLAUDE_CONFIG_DIR: HOME + "/.claude",
    HOME,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    IS_SANDBOX: "1",
  };
  try {
    const argv = [claude, "--print", "--verbose", "--output-format", "stream-json", "--input-format", "stream-json", "--model", model, "--permission-mode", "default", "--setting-sources", "user,project", "--max-turns", "4", "--disallowedTools", "WebSearch,WebFetch"];
    const proc = Bun.spawn(argv, { cwd: "/app", env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\n");
    proc.stdin.end();
    const timer = setTimeout(() => proc.kill(), 120_000);
    const [, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    return { code, bodies, stderr: stderr.slice(-500) };
  } finally {
    server.stop(true);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const arm = flag("--arm") as Arm | undefined;
  const kind = flag("--doctor") as Doctor | undefined;
  if (!arm || !ARMS.includes(arm) || (kind && !DOCTORS.includes(kind))) {
    console.error("E_USAGE usage: l1.ts manifest|check|session --arm <none|before|after|off> [--doctor <kind>] ...");
    process.exit(2);
  }
  if (args[0] === "manifest") {
    const [tree, tar, out] = [flag("--tree"), flag("--tar"), flag("--out")];
    if (!tree || !tar || !out) {
      console.error("E_USAGE usage: l1.ts manifest --arm <arm> --tree <dir> --tar <file> --out <dir> [--fetch <json> --config <tsv> --lock <json>] [--meta k=v ...]");
      process.exit(2);
    }
    const meta: Record<string, unknown> = {};
    args.forEach((a, i) => {
      if (a !== "--meta") return;
      const [k, ...v] = (args[i + 1] ?? "").split("=");
      if (k) meta[k] = v.join("=");
    });
    let problems: string[] = [];
    if (arm !== "none") {
      const [fetchFile, configFile, lockFile] = [flag("--fetch"), flag("--config"), flag("--lock")];
      if (!fetchFile || !configFile || !lockFile) {
        console.error("E_USAGE manifest for a gstack arm needs --fetch, --config and --lock");
        process.exit(2);
      }
      const g = gstackMeta(tree, fetchFile, configFile, lockFile);
      Object.assign(meta, g);
      problems = frozenProblems(arm, g);
    }
    const { summary, list } = manifest(arm, tree, tar, meta);
    writeFileSync(join(out, arm + ".json"), JSON.stringify(summary, null, 2) + "\n");
    writeFileSync(join(out, arm + ".files.tsv"), list);
    console.log(arm + " files=" + summary.tree.files + " tree_digest=" + summary.tree.digest + " tar_sha256=" + summary.tar.sha256);
    if (problems.length) {
      for (const p of problems) console.error("E_INTERNAL " + arm + " differs from the prereg: " + p);
      process.exit(1);
    }
  } else if (args[0] === "check") {
    doctor(kind);
    console.log(JSON.stringify({ arm, doctor: kind ?? null, checks: inImageChecks(arm) }));
  } else if (args[0] === "session") {
    doctor(kind);
    const prompt = flag("--prompt") ?? FIXTURE_PROMPT;
    const explain = arm === "before" ? null : JSON.parse(run(GSTACK + "/bin/gstack-skill-route", ["--explain", prompt, "--json"]).stdout || "null");
    const out: Record<string, unknown> = { arm, doctor: kind ?? null, prompt, route: explain && { route: explain.route, score: explain.candidates?.[0]?.score ?? null, hint: explain.hint, switch: explain.switch } };
    for (const [name, text] of [["untold", prompt], ["told", "/investigate " + prompt]] as const) {
      const s = await claudeSession(text);
      out[name] = { code: s.code, stderr: s.code === 0 ? "" : s.stderr, ...sessionSignals(s.bodies), hint_in_first: Boolean(explain?.hint) && inJson(s.bodies[0]?.messages, explain.hint) };
    }
    console.log(JSON.stringify(out));
  } else {
    console.error("E_USAGE usage: l1.ts manifest|check|session --arm <arm> ...");
    process.exit(2);
  }
}
