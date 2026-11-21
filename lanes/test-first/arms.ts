// Copyright (c) 2026 Garry Tan. MIT License.
// B2's eight arm tars (preregistration section 4) and their manifests under quick/laneb/arms/manifests/b2. On Claude Code:
// none (B1's none tar, byte for byte), line (~/.claude/CLAUDE.md holding the line), gstack (gstack v1.102.1.0 by its own
// ./setup --host claude --no-browser --loadout full with Lane B's seeded long-time user and telemetry off, build-claude.sh)
// and prove-it (that tree with B1's prove-it skill beside it). On Codex the same four (cx-*): ./setup --host codex
// --no-browser in arms/codex.Dockerfile, CODEX_HOME /root/.codex, prove-it rewritten as part R does, the line at
// ~/.codex/AGENTS.md. Each tar is tarred twice and must give the same bytes; check rebuilds every tar into a scratch dir,
// compares it with the committed manifest, reads back each gstack tree's skill_routing and telemetry, and checks that none
// and line hold no gstack file and no ~/.gstack.
//
//   bun lanes/test-first/cli.ts arms build [--out <dir>] [--register]   none, line and the Codex four; build-claude.sh first
//   bun lanes/test-first/cli.ts arms check [--out <dir>]
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { manifest, walk } from "../../quick/laneb/arms/tree.ts";
import { build as b1Build, TAR_ARGS } from "../delivery-route/arms.ts";
import { normalizePromptInput, skillLines, skillsListed } from "../codex-hooks/r/arms.ts";
import { proveItText } from "../codex-hooks/r/pins.ts";
import { ARM_DEFS, B1_NONE_SHA256, B2, CODEX, GSTACK, HERE, HOSTS, LABELS, LINE, LINE_FILE, PROVE_IT, REPO, sha256, type ArmDef } from "./pins.ts";

const armsErr = (m: string): never => { throw new Error("E_B2_ARMS " + m); };
export const ARMS_DIR = () => process.env[B2.armsDirEnv] ?? join(process.env.HOME ?? "", ".capy/work/b2/arms");
export const MANIFESTS = join(REPO, "quick/laneb", B2.armManifests);
export const TAR_COMMAND = "tar " + TAR_ARGS.join(" ");
// Lane B's seeded long-time user, the gstack-l1-build stage's markers (quick/laneb/arms/Dockerfile), for the Codex homes too.
export const MARKERS = [".feature-prompted-model-overlay", ".completeness-intro-seen", ".telemetry-prompted", ".proactive-prompted", ".activated", ".first-loop-tip-shown"];
export const SEED = { update_check: "false", routing_declined: "true", telemetry: "off" } as const;
export const SWITCHES = { skill_routing: "on", skill_contracts: "on", telemetry: "off" } as const;
// The prompt stand-in Codex's start capture appends (arms/codex.Dockerfile PROMPT_STANDIN), typed with "$prove-it " in
// cx-prove-it.
export const PROMPT_STANDIN = "Fix the bug described in the task.";
const run = (cmd: string[], o: { cwd?: string; log?: string } = {}) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: o.cwd, encoding: "utf8", maxBuffer: 1 << 30 });
  if (o.log) writeFileSync(o.log, (r.stdout ?? "") + (r.stderr ?? ""));
  if (r.status !== 0) armsErr(cmd.slice(0, 3).join(" ") + " exited " + r.status + ": " + String(r.stderr ?? "").slice(-600));
  return r.stdout ?? "";
};
const tarTwice = (tar: string, dir: string, paths: string[]) => {
  run(["tar", ...TAR_ARGS, "-cf", tar, "-C", dir, ...paths]);
  run(["tar", ...TAR_ARGS, "-cf", tar + ".again", "-C", dir, ...paths]);
  if (sha256(readFileSync(tar)) !== sha256(readFileSync(tar + ".again"))) armsErr(tar + " is not the same bytes tarred twice");
  rmSync(tar + ".again");
};

/** none (B1's build, which must give B1's none tar) and line, each tree under <out>/trees and its tar at <out>/<arm>.tar. */
export function buildPlain(outArg: string) {
  const out = resolve(outArg), scratch = mkdtempSync(join(tmpdir(), "b2-plain-"));
  try {
    const none = b1Build(scratch).none;
    if (sha256(readFileSync(none)) !== B1_NONE_SHA256) armsErr("B1's none build gives " + sha256(readFileSync(none)) + ", not " + B1_NONE_SHA256);
    mkdirSync(join(out, "trees"), { recursive: true });
    copyFileSync(none, join(out, "none.tar"));
    for (const arm of ["none", "line"]) {
      const tree = join(out, "trees", arm);
      rmSync(tree, { recursive: true, force: true });
      mkdirSync(join(tree, ".claude/skills"), { recursive: true });
      if (arm === "line") writeFileSync(join(tree, ".claude/CLAUDE.md"), LINE_FILE);
      if (arm === "line") chmodSync(join(tree, ".claude/CLAUDE.md"), 0o644);
      chmodSync(join(tree, ".claude"), 0o755); chmodSync(join(tree, ".claude/skills"), 0o755);
    }
    tarTwice(join(out, "line.tar"), join(out, "trees/line"), [".claude"]);
    run(["tar", ...TAR_ARGS, "-cf", join(scratch, "none-again.tar"), "-C", join(out, "trees/none"), ".claude"]);
    if (sha256(readFileSync(join(scratch, "none-again.tar"))) !== B1_NONE_SHA256) armsErr("the none tree does not tar to B1's none tar");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** The four Codex homes in docker (arms/codex.Dockerfile), with gstack fetched at its pin by sha and repacked on one thread. */
export function buildCodex(outArg: string) {
  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });
  const src = join(out, "cx-src-pin"), ctx = join(out, "cx-ctx");
  for (const d of [src, ctx, join(out, "cx-export")]) rmSync(d, { recursive: true, force: true });
  run(["git", "init", "-q", src]);
  run(["git", "-C", src, "fetch", "-q", "--depth", "1", GSTACK.repo, GSTACK.sha]);
  run(["git", "-C", src, "checkout", "-q", "FETCH_HEAD"]);
  if (run(["git", "-C", src, "rev-parse", "HEAD"]).trim() !== GSTACK.sha) armsErr("gstack's checkout is not at " + GSTACK.sha);
  run(["git", "-C", src, "-c", "pack.threads=1", "repack", "-a", "-d", "-F", "-q"]);
  mkdirSync(ctx);
  copyFileSync(join(REPO, HERE, "arms/codex.Dockerfile"), join(ctx, "Dockerfile"));
  writeFileSync(join(ctx, "prove-it.md"), proveItText());
  writeFileSync(join(ctx, "line.md"), LINE_FILE);
  const seed = Object.entries(SEED).map(([k, v]) => k + "=" + v).join(" ");
  run(["docker", "buildx", "build", "--progress=plain", "--build-context", "gstack=" + src, "--build-arg", "GSTACK_MARKERS=" + MARKERS.join(" "), "--build-arg", "GSTACK_SEED=" + seed,
    "--build-arg", "PROMPT_STANDIN=" + PROMPT_STANDIN, "--target", "out", "--output", "type=local,dest=" + join(out, "cx-export"), ctx], { log: join(out, "build-codex.log") });
  const version = readFileSync(join(out, "cx-export/codex-version.txt"), "utf8").trim();
  if (version !== "codex-cli " + CODEX.version) armsErr("the builder's Codex reports " + version);
  for (const l of LABELS.filter((x) => ARM_DEFS[x]!.host === "codex")) for (const ext of [".tar", ".files.tsv", ".switches.tsv", ".prompt-input.json"]) renameSync(join(out, "cx-export", l + ext), join(out, l + ext));
  rmSync(join(out, "cx-export"), { recursive: true, force: true });
}

const tsv = (p: string) => Object.fromEntries(readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t") as [string, string]));
const gstackMeta = (host: "claude" | "codex") => ({ repo: GSTACK.repo, tag: GSTACK.tag, sha: GSTACK.sha, version: GSTACK.version, setup: host === "claude" ? GSTACK.claudeSetup : GSTACK.codexSetup });
const proveItMeta = (d: ArmDef) => (d.arm === "prove-it" ? { path: d.host === "claude" ? PROVE_IT.claudePath : PROVE_IT.codexPath, sha256: d.host === "claude" ? PROVE_IT.sha256 : PROVE_IT.codexSha256 } : null);
const lineMeta = (d: ArmDef) => (d.arm === "line" ? { path: d.host === "claude" ? ".claude/CLAUDE.md" : ".codex/AGENTS.md", sha256: sha256(LINE_FILE), text: LINE } : null);

export type B2Manifest = {
  arm: string; base_arm: string; host: string; cli: string; spec: string; typed: boolean; session_kind: string | null; hook_trust: boolean;
  gstack: ReturnType<typeof gstackMeta> | null; prove_it: { path: string; sha256: string } | null; line: { path: string; sha256: string; text: string } | null;
  switches: Record<string, string> | null; tar_command: string; tar: { file: string; bytes: number; sha256: string }; tar_gz_sha256?: string;
  tree: { files: number; symlinks: number; dirs: number; digest: string }; inventory_sha256: string;
  prompt_input?: { sha256: string; skills: string[]; prove_it_line: string | null; agents_md: boolean };
  start?: Record<string, unknown>;
};

/** A Claude Code arm's manifest from its tree and tar under out (the inventory is tree.ts's file list). */
function claudeManifest(out: string, d: ArmDef): { m: B2Manifest; list: string } {
  const tree = join(out, "trees", d.arm), tar = join(out, d.tar + ".tar");
  const switches = d.gstack ? tsv(join(out, d.arm + ".gstack-config.tsv")) : null;
  const meta = {
    base_arm: d.arm, host: "claude", cli: "claude-code " + HOSTS.claude.version, spec: d.spec, typed: d.typed, session_kind: d.gstack ? "unattended" : null, hook_trust: false,
    gstack: d.gstack ? gstackMeta("claude") : null, prove_it: proveItMeta(d), line: lineMeta(d), switches,
    tar_command: TAR_COMMAND + " -cf <arm>.tar .claude" + (d.gstack ? " .gstack (in quick/laneb/arms/Dockerfile's builder image)" : ""),
    ...(d.gstack ? { tar_gz_sha256: sha256(readFileSync(join(out, d.tar + ".tar.gz"))), loadout_lock_sha256: sha256(readFileSync(join(out, "loadout.lock.json"))), fetch: JSON.parse(readFileSync(join(out, "fetch-pin.json"), "utf8")) } : {}),
  };
  const r = manifest(d.label, tree, tar, meta) as unknown as { summary: Record<string, unknown>; list: string };
  return { m: { ...(r.summary as unknown as B2Manifest), inventory_sha256: sha256(r.list) }, list: r.list };
}

/** A Codex arm's manifest from the build's outputs (part R's shape: the docker build's inventory, switches and start capture). */
function codexManifest(out: string, d: ArmDef): { m: B2Manifest; list: string } {
  const tar = join(out, d.tar + ".tar"), list = readFileSync(join(out, d.tar + ".files.tsv"), "utf8"), pi = readFileSync(join(out, d.tar + ".prompt-input.json"), "utf8");
  const rows = list.split("\n").filter(Boolean).map((l) => l.split("\t"));
  const switches = tsv(join(out, d.tar + ".switches.tsv"));
  const listed = skillsListed(pi);
  const m: B2Manifest = {
    arm: d.label, base_arm: d.arm, host: "codex", cli: "codex-cli " + CODEX.version, spec: d.spec, typed: d.typed, session_kind: d.gstack ? "unattended" : null, hook_trust: d.gstack,
    gstack: d.gstack ? gstackMeta("codex") : null, prove_it: proveItMeta(d), line: lineMeta(d), switches: Object.keys(switches).length ? switches : null,
    tar_command: TAR_COMMAND + " (in arms/codex.Dockerfile's build stage)", tar: { file: d.tar + ".tar", bytes: readFileSync(tar).length, sha256: sha256(readFileSync(tar)) },
    tree: { files: rows.filter((r) => r[0] === "f").length, symlinks: rows.filter((r) => r[0] === "l").length, dirs: rows.filter((r) => r[0] === "d").length, digest: sha256(list) },
    inventory_sha256: sha256(list),
    prompt_input: { sha256: sha256(normalizePromptInput(pi)), skills: listed.skills, prove_it_line: listed.proveIt, agents_md: pi.includes("# AGENTS.md instructions") && pi.includes(LINE) },
  };
  return { m, list };
}

export const manifestOf = (out: string, label: string) => (ARM_DEFS[label]!.host === "claude" ? claudeManifest : codexManifest)(out, ARM_DEFS[label]!);

/** Paths in an inventory (tree.ts's list or the Codex build's files.tsv) that are gstack files or ~/.gstack. */
export function gstackPaths(list: string): string[] {
  return list.split("\n").filter(Boolean).map((l) => l.split(/\t|  /).find((x) => /^(\.|gstack)/.test(x)) ?? l.split("\t").at(-1)!).filter((p) => /(^|\/)\.gstack(\/|$)|(^|\/)gstack(\/|$)|gstack-/.test(p));
}

/** What each arm must hold. none and line: no gstack file, no ~/.gstack, no switch, and line's file the line alone. The gstack
 *  arms: gstack at its pin, skill_routing and skill_contracts on and telemetry off as the tree reads them, and prove-it only
 *  in the prove-it arm at its digest. Codex arms also: the start capture lists prove-it only in cx-prove-it, and cx-line's
 *  start carries the line as its AGENTS.md instructions. */
export function armProblems(m: B2Manifest, list: string): string[] {
  const out: string[] = [], d = ARM_DEFS[m.arm];
  if (!d) return [m.arm + ": not a B2 arm"];
  if (m.spec !== d.spec) out.push(m.arm + ": the manifest's spec is not " + d.spec);
  const prove = d.host === "claude" ? PROVE_IT.claudePath : PROVE_IT.codexPath;
  const proveRow = list.split("\n").find((l) => l.includes(prove));
  if (!d.gstack) {
    if (gstackPaths(list).length) out.push(m.arm + ": the no-gstack arm holds gstack files: " + gstackPaths(list).slice(0, 3).join(", "));
    if (m.switches) out.push(m.arm + ": the no-gstack arm reads gstack switches");
    if (d.arm === "none" && m.tree.files !== 0) out.push(m.arm + ": none holds " + m.tree.files + " files, not 0");
    if (d.arm === "line" && m.tree.files !== 1) out.push(m.arm + ": line holds " + m.tree.files + " files, not its instructions file alone");
    if (d.arm === "line" && !list.includes(sha256(LINE_FILE))) out.push(m.arm + ": the instructions file is not the line");
    if (m.prompt_input && (m.prompt_input.skills.length || m.prompt_input.prove_it_line)) out.push(m.arm + ": Codex lists skills in a no-gstack arm: " + m.prompt_input.skills.join(", "));
    if (m.prompt_input && m.prompt_input.agents_md !== (d.arm === "line")) out.push(m.arm + ": Codex's start capture " + (d.arm === "line" ? "lacks" : "holds") + " the line as AGENTS.md instructions");
  } else {
    if (!m.gstack || m.gstack.sha !== GSTACK.sha) out.push(m.arm + ": gstack is not at " + GSTACK.sha);
    for (const [k, v] of Object.entries(SWITCHES)) if (m.switches?.[k] !== v) out.push(m.arm + ": gstack-config reads " + k + " " + JSON.stringify(m.switches?.[k] ?? null) + ", not " + v);
    if (d.arm === "prove-it" && !(proveRow && proveRow.includes(m.prove_it!.sha256))) out.push(m.arm + ": prove-it is not at " + prove + " with sha256 " + m.prove_it!.sha256);
    if (d.arm === "gstack" && proveRow) out.push(m.arm + ": the gstack arm holds prove-it");
    if (m.prompt_input && !!m.prompt_input.prove_it_line !== (d.arm === "prove-it")) out.push(m.arm + ": Codex's start capture " + (d.arm === "prove-it" ? "does not list" : "lists") + " prove-it");
    if (m.prompt_input && !m.prompt_input.skills.length) out.push(m.arm + ": Codex lists no gstack skill");
  }
  return out;
}

/** The inventory of each arm's tree (Claude: tree.ts's list; Codex: the build's files.tsv). */
function inventory(out: string, label: string): string {
  const d = ARM_DEFS[label]!;
  return d.host === "codex" ? readFileSync(join(out, d.tar + ".files.tsv"), "utf8") : manifestOf(out, label).list;
}

/** The skill lines the Codex load reader matches (part R's detect.ts), from cx-prove-it's tar: prove-it's and gstack-verify's
 *  body lines and those unique to each. */
export const skillLinesText = (out: string) => JSON.stringify(skillLines(join(resolve(out), ARM_DEFS["cx-prove-it"]!.tar + ".tar")), null, 2) + "\n";

/** Writes each arm's manifest beside its tar, and with register also into MANIFESTS with skill-lines.json. A manifest's start
 *  captures (sessions.ts) are kept across a rewrite. */
export function writeManifests(outArg: string, o: { register?: boolean } = {}): B2Manifest[] {
  const out = resolve(outArg), all: B2Manifest[] = [];
  for (const label of LABELS) {
    const { m, list } = manifestOf(out, label);
    const bad = armProblems(m, list);
    if (bad.length) armsErr(bad.join("; "));
    const prior = join(MANIFESTS, label + ".json");
    const keep = existsSync(prior) ? (JSON.parse(readFileSync(prior, "utf8")) as B2Manifest).start : undefined;
    const body = JSON.stringify(keep ? { ...m, start: keep } : m, null, 2) + "\n";
    writeFileSync(join(out, label + ".json"), body);
    writeFileSync(join(out, label + ".inventory.tsv"), list);
    if (o.register) {
      mkdirSync(MANIFESTS, { recursive: true });
      writeFileSync(prior, body);
      writeFileSync(join(MANIFESTS, label + ".files.tsv"), list);
    }
    all.push(m);
  }
  if (o.register) writeFileSync(join(MANIFESTS, "skill-lines.json"), skillLinesText(out));
  return all;
}

/** Rebuilds every tar into out (a scratch dir by default) and compares it with the committed manifests: each tar's sha256, its
 *  inventory's, and each arm's own checks on what it holds and what its gstack reads. Claude's gstack trees come from
 *  build-claude.sh, run into the same dir. */
export function check(outArg?: string, o: { claude?: boolean } = { claude: true }): { pass: boolean; lines: string[] } {
  const out = resolve(outArg ?? mkdtempSync(join(tmpdir(), "b2-arms-check-"))), lines: string[] = [], problems: string[] = [];
  buildPlain(out);
  buildCodex(out);
  if (o.claude !== false) run(["bash", join(REPO, HERE, "build-claude.sh"), out], { log: join(out, "build-claude.stdout") });
  for (const label of LABELS) {
    const f = join(MANIFESTS, label + ".json");
    if (!existsSync(f)) { problems.push(label + ": no committed manifest " + f); continue; }
    const want = JSON.parse(readFileSync(f, "utf8")) as B2Manifest;
    if (!existsSync(join(out, ARM_DEFS[label]!.tar + ".tar"))) { problems.push(label + ": the rebuild wrote no tar"); continue; }
    const { m, list } = manifestOf(out, label);
    if (m.tar.sha256 !== want.tar.sha256) problems.push(label + ": the rebuilt tar is sha256 " + m.tar.sha256 + ", not the manifest's " + want.tar.sha256);
    else if (sha256(list) !== want.inventory_sha256) problems.push(label + ": the rebuilt inventory differs from the manifest's");
    else lines.push(label + ": tar " + m.tar.sha256 + " rebuilt byte for byte, " + m.tree.files + " files" + (m.switches ? ", switches " + JSON.stringify(m.switches) : ""));
    problems.push(...armProblems(m, list));
  }
  const lf = join(MANIFESTS, "skill-lines.json");
  if (!existsSync(lf) || readFileSync(lf, "utf8") !== skillLinesText(out)) problems.push("skill-lines.json is not cx-prove-it's rebuilt skill lines");
  for (const p of problems) lines.push("PROBLEM " + p);
  return { pass: !problems.length, lines };
}
export { inventory, walk };
