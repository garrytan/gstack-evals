// Copyright (c) 2026 Garry Tan. MIT License.
// The harness mechanics arms (sections 3, 5 and 6): the verify-hook patch, the arm manifests build.sh hm writes, each arm's
// config and hook checks, the snapshot strip, and dry-run steps 1-arm-tars, 2-verify-hook and the env part of
// 7-leak-scan-env.
//
//   bun lanes/harness-mechanics/arms.ts manifest --arm <none|prose|hook> --tree <dir> --tar <file> --out <dir> [--fetch <json> --config <tsv> --lock <json>] [--meta k=v ...]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { checkNone, hookEntries, liteLock, normalize, normTree, type Hook } from "../../quick/laneb/arms/l1.ts";
import type { StepResult } from "./dryrun.ts";
import { loadMatcher } from "./match.ts";
import { GSTACK_VENDOR, HM, REPO, VERIFY_PATCH } from "./pins.ts";
import { parseContract, type Contract } from "./vendor/gstack/lib/skill-contract.ts";

export const HM_TARS = ["none", "prose", "hook"] as const;
export type HmTar = (typeof HM_TARS)[number];
export const SETUP = "./setup --host claude --no-browser --loadout lite";
export const CLAUDE_CODE_VERSION = "2.1.312";
// Section 5: routing off in every gstack arm; contracts off in prose (gstack's defaults at the pin), on in hook.
export const CONFIG: Record<Exclude<HmTar, "none">, { skill_routing: string; skill_contracts: string }> = {
  prose: { skill_routing: "off", skill_contracts: "off" },
  hook: { skill_routing: "off", skill_contracts: "on" },
};
export const CONTRACT_SOURCE = "gstack-skill-contract";

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
/** Both gstack arms register gstack's contract Stop hook (inert in prose, contracts off). */
export function hookProblems(arm: Exclude<HmTar, "none">, entries: Hook[]): string[] {
  const n = entries.filter((h) => h.event === "Stop" && h._gstack_source === CONTRACT_SOURCE).length;
  return n === 1 ? [] : [arm + " registers the contract Stop hook " + n + " times, not once"];
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
      if (name === ".claude" && st.isDirectory()) { removed.add(relative(root, p) + "/"); continue; }
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
  if (arm === "hook") problems.push(...patchedProblems(text).map((p) => "installed verify: " + p));
  else if (!text.includes(VERIFY_PATCH.clause) || contractOf(text) !== null) problems.push("installed verify in prose is not the pin's as shipped");
  return {
    meta: {
      gstack_version: readFileSync(join(tree, ".claude/skills/gstack/VERSION"), "utf8").trim(),
      fetch: { repo: fetch.repo, sha: fetch.sha, head: fetch.head, method: fetch.method }, git_archive_sha256: fetch.git_archive_sha256,
      setup: SETUP, verify_patch: arm === "hook" ? { file: VERIFY_PATCH.file, sha256: VERIFY_PATCH.sha256, blob: VERIFY_PATCH.patchedBlob } : null,
      lite: { spec: lock.spec, spec_sha256: lock.spec_sha256, files: lock.files, lock_sha256: lock.lock_sha256, tree_digest_normalized: normTree(render).digest },
      hooks, gstack_config: { skill_routing: config.skill_routing ?? "", skill_contracts: config.skill_contracts ?? "" },
      verify: { sha256_normalized: sha(verify), first200_sha256: sha([...text.replace(/^---\n[\s\S]*?\n---\n/, "").trimStart()].slice(0, 200).join("")) },
    },
    problems,
  };
}

const ARMS_DIR = () => process.env.HM_ARMS_DIR ?? join(process.env.HOME ?? "", ".capy/work/hm/arms");
const dockerOk = () => spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" }).status === 0;
const manifestOf = (arm: string) => join(REPO, "quick/laneb", HM.armManifests, arm + ".json");

/** Step 1: each tar's committed manifest, the tar's bytes at it, none clean, and each gstack arm's config, hooks and /verify. */
export function stepArmTars(out: string): StepResult {
  const problems: string[] = [];
  const parts: string[] = [];
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
  }
  if (!dockerOk()) problems.push("needs Docker for the in-image checks and the snapshot strip; docker is missing or not running");
  else problems.push("the in-image checks and the strip sessions are not built (unit 5)");
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
  if (p.length) return { pass: false, detail: p[0]! };
  if (!dockerOk()) return { pass: false, detail: detail + "; the scripted sessions need Docker, which is missing" };
  return { pass: false, detail: detail + "; the scripted sessions are not built (unit 5)" };
}

/** Step 7, env part: Harbor runs with HARBOR_TELEMETRY=0 and every Claude Code session with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. The leak scan is unit 7's. */
export function envProblems(vmRun: string, agentPy: string): string[] {
  const p: string[] = [];
  const runs = vmRun.split("\n").filter((l) => /harbor run /.test(l) && !/pkill/.test(l));
  if (!runs.length || runs.some((l) => !/\bHARBOR_TELEMETRY=0\b/.test(l))) p.push("a harbor run line in vm-run.sh lacks HARBOR_TELEMETRY=0");
  if (!/"CLAUDE_CODE_DISABLE_BUNDLED_SKILLS": "1"/.test(agentPy)) p.push("laneb_agent.py's session env lacks CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1");
  return p;
}
export function stepEnv(_out: string): StepResult {
  const p = envProblems(readFileSync(join(REPO, "quick/laneb/runner/vm-run.sh"), "utf8"), readFileSync(join(REPO, "quick/laneb/runner/agent/laneb_agent.py"), "utf8"));
  return { pass: false, detail: (p.length ? p[0] : "HARBOR_TELEMETRY=0 on every harbor run, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every session") + "; leak scan not built (unit 7)" };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const arm = flag("--arm") as HmTar | undefined;
  const [tree, tar, outDir] = [flag("--tree"), flag("--tar"), flag("--out")];
  if (args[0] !== "manifest" || !arm || !HM_TARS.includes(arm) || !tree || !tar || !outDir) {
    console.error("E_USAGE usage: arms.ts manifest --arm <none|prose|hook> --tree <dir> --tar <file> --out <dir> [--fetch <json> --config <tsv> --lock <json>] [--meta k=v ...]");
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
