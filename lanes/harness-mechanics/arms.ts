// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics arms (sections 3, 5 and 6): the verify-hook patch, the arm manifests build.sh hm writes, each arm's
// config and hook checks, the snapshot strip, and dry-run steps 1-arm-tars, 2-verify-hook and the env part of
// 7-leak-scan-env.
//
//   bun lanes/harness-mechanics/arms.ts manifest --arm <none|prose|hook|judge> --tree <dir> --tar <file> --out <dir> [--fetch <json> --config <tsv> --lock <json>] [--meta k=v ...]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { checkNone, hookEntries, liteLock, normalize, normTree, type Hook } from "../../quick/laneb/arms/l1.ts";
import type { StepResult } from "./dryrun.ts";
import { loadMatcher } from "./match.ts";
import { GSTACK_VENDOR, HM, REPO, VERIFY_PATCH } from "./pins.ts";
import { parseContract, type Contract } from "./vendor/gstack/lib/skill-contract.ts";

export const HM_TARS = ["none", "prose", "hook", "judge"] as const;
export type HmTar = (typeof HM_TARS)[number];
export const SETUP = "./setup --host claude --no-browser --loadout lite";
export const CLAUDE_CODE_VERSION = "2.1.312";
// Section 5: routing off in every gstack arm; contracts off in prose (gstack's defaults at the pin), on in hook.
export const CONFIG: Record<Exclude<HmTar, "none">, { skill_routing: string; skill_contracts: string }> = {
  prose: { skill_routing: "off", skill_contracts: "off" },
  hook: { skill_routing: "off", skill_contracts: "on" },
  judge: { skill_routing: "off", skill_contracts: "on" },
};
export const CONTRACT_SOURCE = "gstack-skill-contract";
export const RISKY_SOURCE = "hm-judge-risky";
export const JUDGE_STOP = "<HOME>/.hm/judge/stop";
export const JUDGE_RISKY = "<HOME>/.hm/judge/risky";
export const JUDGE_FILES = { band_sha256: ".hm/judge/band.json", hm_judge_sha256: ".hm/judge/hm_judge.py", facts_sha256: ".hm/judge/facts.js" } as const;
export const SECRET_ENV = ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
const KEY_SHAPES: [string, RegExp][] = [["an OpenRouter key", /sk-or-v1-[0-9a-f]{32,}/], ["an Anthropic key", /sk-ant-api\d\d-[\w-]{20,}/], ["an OpenAI key", /sk-proj-[\w-]{20,}/]];

const pinErr = (m: string): never => { throw new Error("E_HM_PIN " + m); };
export const gitBlob = (b: Buffer | string) => { const buf = Buffer.from(b); return createHash("sha1").update("blob " + buf.length + "\0").update(buf).digest("hex"); };
export const vendoredVerify = () => readFileSync(join(REPO, GSTACK_VENDOR, "verify/SKILL.md"));

/** verify/SKILL.md at the pin with the committed patch applied by git apply; the input must be the pin's blob and the result the recorded one. */
export function applyVerifyPatch(pin: Buffer): Buffer {
  const patch = readFileSync(join(REPO, VERIFY_PATCH.file));
  if (createHash("sha256").update(patch).digest("hex") !== VERIFY_PATCH.sha256) pinErr(VERIFY_PATCH.file + " is not sha256 " + VERIFY_PATCH.sha256);
  if (gitBlob(pin) !== VERIFY_PATCH.pinBlob) pinErr("verify/SKILL.md is blob " + gitBlob(pin) + ", not the pin's " + VERIFY_PATCH.pinBlob);
  const d = mkdtempSync(join(tmpdir(), "hm-verify-"));
  try {
    spawnSync("mkdir", ["-p", join(d, "verify")]);
    writeFileSync(join(d, "verify/SKILL.md"), pin);
    const r = spawnSync("git", ["apply", join(REPO, VERIFY_PATCH.file)], { cwd: d, encoding: "utf8" });
    if (r.status !== 0) pinErr("the patch does not apply: " + r.stderr.trim().slice(0, 200));
    const out = readFileSync(join(d, "verify/SKILL.md"));
    if (gitBlob(out) !== VERIFY_PATCH.patchedBlob) pinErr("the patched file is blob " + gitBlob(out) + ", not " + VERIFY_PATCH.patchedBlob);
    return out;
  } finally { rmSync(d, { recursive: true, force: true }); }
}

/** gstack's own parseContract (validateContract inside) on a SKILL.md's front matter. */
export function contractOf(skillMd: string): { contract: Contract } | { error: string } | null {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(skillMd);
  return fm ? parseContract(fm[1]!) : null;
}

/** What the patched /verify must hold: no step 2 clause, step 2 kept, and exactly section 6's item with the frozen regex. */
export function patchedProblems(skillMd: string, regex = loadMatcher().match.regex): string[] {
  const p: string[] = [];
  if (skillMd.includes(VERIFY_PATCH.clause)) p.push("step 2 still holds the clause");
  if (!skillMd.includes("run --only <name>` while fixing it.")) p.push("step 2's first sentence is gone");
  const c = contractOf(skillMd);
  if (!c || !("contract" in c)) return [...p, "gstack refuses the contract: " + (c && "error" in c ? c.error : "none")];
  const items = c.contract.items;
  const want: Record<string, string> = { ...VERIFY_PATCH.item, match: regex };
  const got = items[0] as unknown as Record<string, string> | undefined;
  if (items.length !== 1 || !got || Object.keys(got).length !== 4 || Object.entries(want).some(([k, v]) => got[k] !== v)) p.push("contract items are " + JSON.stringify(items).slice(0, 200));
  return p;
}

export function configProblems(arm: Exclude<HmTar, "none">, values: Record<string, string>): string[] {
  return Object.entries(CONFIG[arm]).filter(([k, v]) => values[k] !== v).map(([k, v]) => arm + " " + k + " is " + JSON.stringify(values[k] ?? null) + ", not " + v);
}
/** Every gstack arm registers gstack's contract Stop hook once (inert in prose, contracts off). In judge it runs the judge's stop, which calls the contract hook first, and judge adds one PreToolUse entry for the risky point. */
export function hookProblems(arm: Exclude<HmTar, "none">, entries: Hook[]): string[] {
  const contract = entries.filter((h) => h.event === "Stop" && h._gstack_source === CONTRACT_SOURCE);
  const p = contract.length === 1 ? [] : [arm + " registers the contract Stop hook " + contract.length + " times, not once"];
  if (arm !== "judge") return p;
  if (contract.length === 1 && contract[0]!.command !== JUDGE_STOP) p.push("judge's contract Stop entry runs " + contract[0]!.command + ", not " + JUDGE_STOP);
  const risky = entries.filter((h) => h._gstack_source === RISKY_SOURCE);
  if (risky.length !== 1 || risky[0]!.event !== "PreToolUse" || risky[0]!.command !== JUDGE_RISKY) p.push("judge registers the risky hook as " + JSON.stringify(risky) + ", not one PreToolUse entry running " + JUDGE_RISKY);
  return p;
}

/** The names of the key shapes, and of the env keys whose values, found in a buffer. Never the values. */
export function keyHits(buf: Buffer, secrets: [string, string][], shapes = true): string[] {
  const text = buf.toString("latin1");
  return [...(shapes ? KEY_SHAPES : []).filter(([, re]) => re.test(text)).map(([n]) => n), ...secrets.filter(([, v]) => v.length >= 16 && text.includes(v)).map(([n]) => n)];
}
/** keyHits over a file read in 64 MiB chunks that overlap by 512 bytes, so a multi-GB tar never becomes one string. */
export function keyHitsFile(path: string, secrets: [string, string][], shapes = true): string[] {
  const size = 64 << 20, keep = 512, buf = Buffer.alloc(size + keep), hits = new Set<string>(), fd = openSync(path, "r");
  let carry = 0;
  try {
    for (let n = readSync(fd, buf, carry, size, null); n > 0; n = readSync(fd, buf, carry, size, null)) {
      const end = carry + n;
      for (const h of keyHits(buf.subarray(0, end), secrets, shapes)) hits.add(h);
      carry = Math.min(keep, end);
      buf.copy(buf, 0, end - carry, end);
    }
  } finally { closeSync(fd); }
  return [...hits];
}
export const envSecrets = (): [string, string][] => SECRET_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]!] as [string, string]] : []));

/** Step 1's judge checks on the unpacked tar: the matcher on the risky entry, the judge files at the manifest's digests, hm_judge.py as committed, the runtime digest and its python, both backend configs, and no key in the tar: no env key value anywhere, and no key shape in the judge's own files (gstack ships fake keys in its redaction tests). */
export function judgeTarProblems(tree: string, m: Record<string, any>, tar: string, secrets: [string, string][], drTarball?: string): string[] {
  const p: string[] = [];
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const risky = ((m.settings?.hooks ?? []) as { event: string; matcher: string; command: string }[]).filter((h) => h.command === JUDGE_RISKY.replace("<HOME>", "/root"));
  if (risky.length !== 1 || risky[0]!.event !== "PreToolUse" || risky[0]!.matcher !== "Bash") p.push("the risky hook is not one PreToolUse entry with matcher Bash");
  for (const [k, f] of Object.entries(JUDGE_FILES)) {
    const f2 = join(tree, f);
    if (!existsSync(f2)) { p.push("judge: no " + f); continue; }
    if (sha(readFileSync(f2)) !== m[k]) p.push("judge: " + f + " is not the manifest's " + k);
  }
  const committed = join(REPO, "lanes/harness-mechanics/judge/hm_judge.py");
  if (existsSync(join(tree, JUDGE_FILES.hm_judge_sha256)) && !readFileSync(join(tree, JUDGE_FILES.hm_judge_sha256)).equals(readFileSync(committed))) p.push("judge: hm_judge.py differs from the committed file");
  if (!/^[0-9a-f]{64}$/.test(String(m.dr_runtime_sha256 ?? ""))) p.push("judge: no dr_runtime_sha256");
  else if (drTarball && existsSync(drTarball) && sha(readFileSync(drTarball)) !== m.dr_runtime_sha256) p.push("judge: the decision-routing runtime tarball is not the manifest's dr_runtime_sha256");
  try { lstatSync(join(tree, ".hm/dr/venv/bin/python")); } catch { p.push("judge: no runtime python at .hm/dr/venv/bin/python"); }
  for (const b of ["jev", "p1"]) {
    const f = join(tree, ".hm/judge/judge-" + b + ".json");
    if (!existsSync(f) || JSON.parse(readFileSync(f, "utf8")).backend !== b) p.push("judge: judge-" + b + ".json is missing or not backend " + b);
  }
  const judgeDir = join(tree, ".hm/judge");
  const hits = [...keyHitsFile(tar, secrets, false), ...(existsSync(judgeDir) ? readdirSync(judgeDir).flatMap((f) => keyHits(readFileSync(join(judgeDir, f)), [])) : [])];
  if (hits.length) p.push("judge: the tar holds " + hits.join(", "));
  return p;
}

// Section 3's snapshot strip: auto-loaded instruction files at any depth, and the files a CLAUDE.md imports with @path
// inside the snapshot. Returns the removed paths, relative and sorted, so the run records which units had them.
const INSTRUCTION = /^(?:CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$/;
export function stripSnapshot(root: string): string[] {
  const removed = new Set<string>();
  const imports: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name), st = lstatSync(p);
      if (name === ".git") continue;
      if (name === ".claude") { removed.add(relative(root, p) + (st.isDirectory() ? "/" : "")); continue; }
      if (st.isDirectory()) visit(p);
      else if (INSTRUCTION.test(name)) {
        removed.add(relative(root, p));
        if (/^CLAUDE/.test(name) && st.isFile()) for (const m of readFileSync(p, "utf8").matchAll(/(?:^|\s)@((?:~|\.{0,2}\/|[\w.-]+\/)?[\w./-]+)/g)) imports.push(resolve(dirname(p), m[1]!));
      }
    }
  };
  visit(root);
  for (const f of imports) if (f.startsWith(resolve(root) + "/") && existsSync(f) && lstatSync(f).isFile()) removed.add(relative(root, f));
  for (const r of removed) rmSync(join(root, r), { recursive: true, force: true });
  return [...removed].sort();
}

function gstackMeta(arm: Exclude<HmTar, "none">, tree: string, fetchFile: string, configFile: string, lockFile: string) {
  const render = join(tree, ".gstack/render/claude");
  const lock = liteLock(lockFile);
  const fetch = JSON.parse(readFileSync(fetchFile, "utf8"));
  const config = Object.fromEntries(readFileSync(configFile, "utf8").trim().split("\n").map((l) => l.split("\t") as [string, string]));
  const verify = normalize(readFileSync(join(render, "verify/SKILL.md")));
  const hooks = hookEntries(readFileSync(join(tree, ".claude/settings.json"), "utf8"));
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const problems = [...configProblems(arm, config), ...hookProblems(arm, hooks)];
  const text = verify.toString("utf8");
  let patched: { path: string; blob: string }[] | null = null;
  if (arm !== "prose") {
    problems.push(...patchedProblems(text).map((p) => "installed verify: " + p));
    patched = [".claude/skills/gstack/verify/SKILL.md", ".gstack/render/claude/verify/SKILL.md", ".claude/skills/verify/SKILL.md"].map((p) => ({ path: p, blob: gitBlob(readFileSync(join(tree, p))) }));
    if (patched[0]!.blob !== VERIFY_PATCH.patchedBlob) problems.push("the checkout's verify/SKILL.md is blob " + patched[0]!.blob + ", not the patched " + VERIFY_PATCH.patchedBlob);
    if (patched[2]!.blob !== patched[1]!.blob) problems.push("the ~/.claude/skills verify copy is not the patched render");
    const applied = readFileSync(join(tree, ".gstack/hm-patched.tsv"), "utf8").trim().split("\n").map((l) => l.split("\t")[1]);
    if (applied[0] !== patched[0]!.blob || applied[1] !== patched[1]!.blob) problems.push("hm-patched.tsv does not match the installed copies");
  }
  else if (!text.includes(VERIFY_PATCH.clause) || contractOf(text) !== null) problems.push("installed verify in prose is not the pin's as shipped");
  return {
    meta: {
      gstack_version: readFileSync(join(tree, ".claude/skills/gstack/VERSION"), "utf8").trim(),
      fetch: { repo: fetch.repo, sha: fetch.sha, head: fetch.head, method: fetch.method }, git_archive_sha256: fetch.git_archive_sha256,
      setup: SETUP + " --skill-contracts", verify_patch: arm !== "prose" ? { file: VERIFY_PATCH.file, sha256: VERIFY_PATCH.sha256, blob: VERIFY_PATCH.patchedBlob, applied: "after setup, to every installed copy", copies: patched } : null,
      lite: { spec: lock.spec, spec_sha256: lock.spec_sha256, files: lock.files, lock_sha256: lock.lock_sha256, tree_digest_normalized: normTree(render).digest },
      hooks, gstack_config: { skill_routing: config.skill_routing ?? "", skill_contracts: config.skill_contracts ?? "" },
      verify: { sha256_normalized: sha(verify), first200_sha256: sha([...text.replace(/^---\n[\s\S]*?\n---\n/, "").trimStart()].slice(0, 200).join("")) },
    },
    problems,
  };
}

export const ARMS_DIR = () => process.env.HM_ARMS_DIR ?? join(process.env.HOME ?? "", ".capy/work/hm/arms");
export const dockerOk = () => spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" }).status === 0;
export const manifestOf = (arm: string) => join(REPO, "quick/laneb", HM.armManifests, arm + ".json");

// The scripted sessions and the in-image checks (sessions.ts) run once per dry run, as a subprocess: step 1 starts them,
// step 2 reads the same sessions.json.
type SessionsRun = { in_image: string[]; problems: { step: 1 | 2; text: string }[] };
function sessionsOf(out: string, fresh: boolean): SessionsRun | string {
  const dir = join(out, "sessions"), f = join(dir, "sessions.json");
  if (fresh) rmSync(dir, { recursive: true, force: true });
  if (!existsSync(f)) {
    const r = spawnSync("bun", [join(REPO, "lanes/harness-mechanics/sessions.ts"), "run", "--out", dir], { encoding: "utf8", timeout: 1_800_000 });
    if (!existsSync(f)) return "the scripted sessions did not run: " + ((r.stderr ?? "").trim().split("\n").pop() ?? "");
  }
  return JSON.parse(readFileSync(f, "utf8"));
}

/** Step 1: each tar's committed manifest, the tar's bytes at it, none clean, and each gstack arm's config, hooks and /verify. */
export function stepArmTars(out: string): StepResult {
  const problems: string[] = [];
  const parts: string[] = [];
  const docker = dockerOk();
  if (!docker) problems.push("needs Docker for the in-image checks and the snapshot strip; docker is missing or not running");
  for (const arm of HM_TARS) {
    if (!existsSync(manifestOf(arm))) { problems.push(arm + ": no manifest"); continue; }
    const m = JSON.parse(readFileSync(manifestOf(arm), "utf8"));
    if (arm === "none" ? m.gstack_sha !== undefined : m.gstack_sha !== HM.gstackPin) problems.push(arm + ": gstack_sha " + m.gstack_sha);
    if (arm !== "none") problems.push(...configProblems(arm, m.gstack_config ?? {}), ...hookProblems(arm, m.hooks ?? []));
    const tar = join(ARMS_DIR(), arm + ".tar");
    if (!existsSync(tar)) { problems.push(arm + ": no tar at " + tar); continue; }
    const got = createHash("sha256").update(readFileSync(tar)).digest("hex");
    if (got !== m.tar.sha256) problems.push(arm + ": tar sha256 " + got + ", manifest " + m.tar.sha256);
    parts.push(arm + " " + got.slice(0, 12));
    if (arm === "judge") {
      const tree = join(out, "judge-tree");
      rmSync(tree, { recursive: true, force: true });
      spawnSync("mkdir", ["-p", tree]);
      const x = spawnSync("tar", ["-xf", tar, "-C", tree], { encoding: "utf8" });
      if (x.status !== 0) { problems.push("judge: the tar does not unpack: " + x.stderr.trim().slice(0, 120)); continue; }
      const jp = judgeTarProblems(tree, m, tar, envSecrets(), join(ARMS_DIR(), "dr-out/dr-runtime.tar.gz"));
      problems.push(...jp);
      if (!jp.length) parts.push("judge: contract Stop once and PreToolUse Bash once, runtime " + m.dr_runtime_sha256.slice(0, 12) + ", band " + m.band_sha256.slice(0, 12) + ", hm_judge " + m.hm_judge_sha256.slice(0, 12) + ", facts " + m.facts_sha256.slice(0, 12) + ", no key in the tar");
    }
  }
  if (docker) {
    const s = sessionsOf(out, true);
    if (typeof s === "string") problems.push(s);
    else problems.push(...s.problems.filter((p) => p.step === 1).map((p) => p.text));
    if (!problems.length) parts.push("in-image checks pass; the hostile CLAUDE.md, AGENTS.md and .claude/ reached no session's first request (the strip-off control loaded them); gstack's install survived in prose and hook");
  }
  writeFileSync(join(out, "arm-tars.txt"), [...parts, ...problems].join("\n") + "\n");
  return { pass: problems.length === 0, detail: (parts.join(", ") || "no tars") + (problems.length ? "; " + problems[0] + (problems.length > 1 ? " (+" + (problems.length - 1) + ")" : "") : "") };
}

/** Step 2, keyless part: the patch on the pin's verify/SKILL.md (blob checked) and gstack's validateContract on the result. The scripted sessions need Docker. */
export function stepVerifyHook(out: string): StepResult {
  const pin = vendoredVerify();
  const patched = applyVerifyPatch(pin).toString("utf8");
  const p = patchedProblems(patched);
  if (process.env.HM_GSTACK) {
    const real = readFileSync(join(process.env.HM_GSTACK, "verify/SKILL.md"));
    if (!real.equals(pin)) p.push("HM_GSTACK's verify/SKILL.md differs from the vendored pin copy");
  }
  writeFileSync(join(out, "verify-hook.txt"), patched);
  const detail = "patch " + VERIFY_PATCH.sha256.slice(0, 12) + " applies to blob " + VERIFY_PATCH.pinBlob.slice(0, 12) + " giving " + VERIFY_PATCH.patchedBlob.slice(0, 12) + "; validateContract accepts check-after-edit";
  if (!dockerOk()) return { pass: false, detail: "the scripted sessions need Docker, which is missing; " + (p[0] ?? detail) };
  if (p.length) return { pass: false, detail: p[0]! };
  const s = sessionsOf(out, false);
  if (typeof s === "string") return { pass: false, detail: s };
  const bad = s.problems.filter((x) => x.step === 2);
  if (bad.length) return { pass: false, detail: bad[0]!.text + (bad.length > 1 ? " (+" + (bad.length - 1) + ")" : "") };
  return { pass: true, detail: detail + "; hook: edit then stop is blocked once with gstack's text, then allowed (miss); prose: nothing blocked, no record; a waiver (met_after_block) and STATUS: BLOCKED (met) let the stop through and print; a reread is met by the hook and non-adherent in score.ts; '/verify ' gives one load; routing off" };
}

/** Step 7, env part: Harbor runs with HARBOR_TELEMETRY=0 and every Claude Code session with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. The leak scan half runs leak.ts dryrun (unit 7). */
export function envProblems(vmRun: string, agentPy: string): string[] {
  const p: string[] = [];
  const runs = vmRun.split("\n").filter((l) => /harbor run /.test(l) && !/pkill/.test(l));
  if (!runs.length || runs.some((l) => !/\bHARBOR_TELEMETRY=0\b/.test(l))) p.push("a harbor run line in vm-run.sh lacks HARBOR_TELEMETRY=0");
  if (!/"CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1"/.test(agentPy)) p.push("laneb_agent.py's session env lacks CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1");
  return p;
}
// Harbor at its pin reads HARBOR_TELEMETRY from its own process env (src/harbor/telemetry.py). Its JobConfig has env maps
// only for the task environment, the agent and the verifier, which reach containers, not the harbor process, so the job file
// carries none and vm-run.sh sets it on every harbor run line. prepare writes this record into hm.json.
export const HARBOR_PIN = "f3a5a923f6d722472c9e797af836ae4425fb215f";
export function harborEnvRecord(vmRun: string) {
  const p = envProblems(vmRun, '"CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1"');
  if (p.length) pinErr(p[0]!);
  return { HARBOR_TELEMETRY: "0", set_by: "quick/laneb/runner/vm-run.sh, on every harbor run line", job_config_field: false, harbor_pin: HARBOR_PIN,
    why: "the pinned Harbor reads HARBOR_TELEMETRY from its own process env; JobConfig's env maps (environment, agents, verifier) reach containers only" };
}
export function stepEnv(out: string): StepResult {
  const vm = readFileSync(join(REPO, "quick/laneb/runner/vm-run.sh"), "utf8");
  const p = envProblems(vm, readFileSync(join(REPO, "quick/laneb/runner/agent/laneb_agent.py"), "utf8"));
  if (!p.length) writeFileSync(join(out, "harbor-env.json"), JSON.stringify(harborEnvRecord(vm), null, 2) + "\n");
  const leak = spawnSync(process.execPath, [join(REPO, "lanes/harness-mechanics/leak.ts"), "dryrun", out], { encoding: "utf8", timeout: 60_000 });
  return { pass: !p.length && leak.status === 0, detail: (p.length ? p[0] : "HARBOR_TELEMETRY=0 on every harbor run line (the pinned job config has no field for Harbor's own env; hm.json records it), CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every session") + "; leak scan: " + (leak.stdout.trim().split("\n").at(-1) || leak.stderr.trim()) + "" };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const arm = flag("--arm") as HmTar | undefined;
  const [tree, tar, outDir] = [flag("--tree"), flag("--tar"), flag("--out")];
  if (args[0] !== "manifest" || !arm || !HM_TARS.includes(arm) || !tree || !tar || !outDir) {
    console.error("E_USAGE usage: arms.ts manifest --arm <none|prose|hook|judge> --tree <dir> --tar <file> --out <dir> [--fetch <json> --config <tsv> --lock <json>] [--meta k=v ...]");
    process.exit(2);
  }
  const meta: Record<string, unknown> = {};
  args.forEach((a, i) => { if (a !== "--meta") return; const [k, ...v] = (args[i + 1] ?? "").split("="); if (k) meta[k] = v.join("="); });
  let problems: string[];
  if (arm === "none") problems = checkNone(tree);
  else {
    const [f, c, l] = [flag("--fetch"), flag("--config"), flag("--lock")];
    if (!f || !c || !l) { console.error("E_USAGE manifest for a gstack arm needs --fetch, --config and --lock"); process.exit(2); }
    const g = gstackMeta(arm, tree, f, c, l);
    Object.assign(meta, g.meta);
    problems = g.problems;
  }
  const { summary, list } = manifest(arm, tree, tar, meta);
  writeFileSync(join(outDir, arm + ".json"), JSON.stringify({ ...summary, inventory_sha256: createHash("sha256").update(list).digest("hex") }, null, 2) + "\n");
  writeFileSync(join(dirname(tar), arm + ".files.tsv"), list);
  console.log(arm + " files=" + summary.tree.files + " tar_sha256=" + summary.tar.sha256);
  if (problems.length) { for (const p of problems) console.error("E_HM_PIN " + arm + ": " + p); process.exit(1); }
}
