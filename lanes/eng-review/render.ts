// Copyright (c) 2026 Garry Tan. MIT License.
// The eng phase arm's opening (prereg 2026-11-08-geva-405, section 5, gate answer A1), rendered per unit from gstack at
// ER_ENGPHASE_GSTACK (garrytan/gstack 199931029, VERSION 1.98.0.0). The session holds what an autoplan session holds
// when it enters Phase 3 with no earlier phase run. The rules, with the build-time choices this file makes:
//
// - The checkout must be at the pin: HEAD is the pinned commit, VERSION reads 1.98.0.0 and no tracked file has a local
//   change. Anything else is refused with E_USAGE.
// - From autoplan/SKILL.md the opening carries, verbatim and found by their headings, "## The 6 Decision Principles"
//   (the whole section, so the eng phase's tiebreaker line comes with the other phases' lines beside it), "## Decision
//   Classification", "## What "Auto-Decide" Means" and, from "### Step 3: Locate review skills; load each at phase
//   entry", the section skip list from its "**Section skip list" line through its "Follow ONLY" line. A section runs to
//   the next heading at its level or above outside a code fence and drops its trailing --- rule. A heading that is not
//   there exactly once, or a missing skip list, is refused with E_USAGE.
// - autoplan/sections/eng-phase.md goes in in full, byte for byte.
// - The build runs the pinned bin/gstack-autoplan-snapshot.ts as a keyless subprocess (bun --no-env-file
//   --config=/dev/null, PATH as the only environment variable) in a scratch directory: init (the tool's own Phase 0 step,
//   which wraps a plan with no "## Implementation plan" and "## Review record" headings of its own under those headings
//   and keeps a plan that has both as it is), then methodology eng on plan-eng-review/SKILL.md, then create eng. A plan
//   with only one of those headings, or with them out of order, is refused with E_USAGE and the tool's message.
// - Mounted files, all flat under /work/autoplan/ and written read-only (0444): methodology.md and methodology.json from
//   the methodology step, and eng-implementation.md, source-implementation.md, native-prompt.md and snapshot.json from
//   the create step, so every path snapshot.json names exists in the container. The wrapped active plan and the restore
//   point are not mounted.
// - Host paths become container paths: both tool directories become /work/autoplan, the active plan and the restore
//   point become /work/plan.md (the session's plan is both, as when autoplan runs on a plan in place, and the restore
//   point's sha256 is that of /work/plan.md as given), and the checkout's directory becomes ~/.claude/skills/gstack, where
//   the arm's default install puts it. The identities that hang on rewritten bytes are recomputed the way the tool
//   computes them: methodology.md's sha256, bytes and lines, each source's startByte and endByte, methodology.json's
//   sha256 (manifestSha256), and native-prompt.md's sha256, bytes and lines in snapshot.json and in nativeDispatchPrompt.
//   Any trace of a host path left in the opening or a mounted file is refused with E_INTERNAL.
// - The opening names the pin, marks the CEO, Design and DX phases skipped (no earlier phase ran) and the outside voice
//   unavailable (no Codex in the container), names the left-out run-directory steps (phase-close, amend-input, review
//   logs, the plan-reality check and the Phase 4 gate), gives the phase inputs, tells the session to Read methodology.md
//   at every readRanges offset and limit with the tool's own instruction line, then carries the autoplan parts and
//   eng-phase.md. The session sends snapshot.json's nativeDispatchPrompt itself, as eng-phase.md says.
// - Its sha256 is over the UTF-8 opening text. The same checkout and plan give the same opening and the same files.
// - er render writes the mounted files plus opening.md and opening.json (sha256, gstack pin, methodology, readRanges,
//   files) into --out, which must sit outside this repository and be absent or empty, and prints the sha256.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { removeTree } from "../../src/trial/cleanup.ts";

export const ER_ENGPHASE_GSTACK = { repo: "garrytan/gstack", sha: "199931029e9fe9808554a4863c960d4b9b663a60", version: "1.98.0.0" };

export const MOUNT_DIR = "/work/autoplan";
const PLAN_MOUNT = "/work/plan.md";
const SKILLS_HOME = "~/.claude/skills/gstack";
const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export interface RenderedFile {
  name: string;
  host: string;
  mount: string;
  sha256: string;
}
export interface EngPhaseOpening {
  text: string;
  sha256: string;
  files: RenderedFile[];
  methodology: string;
  readRanges: Array<{ offset: number; limit: number }>;
}

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const fail = (code: "E_USAGE" | "E_INTERNAL", message: string) => Object.assign(new Error(code + " " + message), { code });

function git(dir: string, args: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw fail("E_USAGE", "not a gstack checkout: " + dir + " (" + (r.stderr || "git failed").trim() + ")");
  return r.stdout.trim();
}

function checkPin(gstack: string): void {
  const head = git(gstack, ["rev-parse", "HEAD"]);
  if (head !== ER_ENGPHASE_GSTACK.sha) throw fail("E_USAGE", "gstack checkout is at " + head + ", not the eng phase pin " + ER_ENGPHASE_GSTACK.sha);
  const version = existsSync(join(gstack, "VERSION")) ? readFileSync(join(gstack, "VERSION"), "utf8").trim() : "(none)";
  if (version !== ER_ENGPHASE_GSTACK.version) throw fail("E_USAGE", "gstack checkout VERSION is " + version + ", not " + ER_ENGPHASE_GSTACK.version);
  const dirty = git(gstack, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) throw fail("E_USAGE", "gstack checkout has local changes: " + dirty.split("\n").slice(0, 3).join("; "));
}

export function section(md: string, heading: string): string {
  const lines = md.split("\n");
  const at = lines.flatMap((l, i) => (l.trimEnd() === heading ? [i] : []));
  if (at.length !== 1) throw fail("E_USAGE", "autoplan/SKILL.md has " + at.length + ' "' + heading + '" headings, not 1');
  const level = heading.match(/^#+/)![0].length;
  let fence = false;
  let end = lines.length;
  for (let i = at[0]! + 1; i < lines.length; i++) {
    if (/^ {0,3}(```|~~~)/.test(lines[i]!)) fence = !fence;
    const h = !fence && lines[i]!.match(/^(#{1,6}) /);
    if (h && h[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines
    .slice(at[0], end)
    .join("\n")
    .replace(/(\s*\n---)?\s*$/, "");
}

export function skipList(md: string): string {
  const step3 = section(md, "### Step 3: Locate review skills; load each at phase entry");
  const start = step3.indexOf("**Section skip list");
  const stop = start < 0 ? -1 : step3.indexOf("Follow ONLY the review-specific methodology", start);
  if (stop < 0) throw fail("E_USAGE", "autoplan/SKILL.md has no section skip list under Step 3");
  const lineEnd = step3.indexOf("\n", stop);
  return step3.slice(start, lineEnd < 0 ? undefined : lineEnd);
}

function tool(gstack: string, cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", join(gstack, "bin", "gstack-autoplan-snapshot.ts"), ...args], { cwd, env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr || r.error?.message || "").trim() };
}

function insideRepo(path: string): boolean {
  let p = resolve(path);
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  const rel = relative(realpathSync(REPO_ROOT), realpathSync(p));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function mapStrings(v: unknown, f: (s: string) => string): any {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
  return v;
}

export function renderEngPhase(o: { gstack: string; plan: string; out: string }): EngPhaseOpening {
  if (insideRepo(o.out)) throw fail("E_USAGE", "out dir " + o.out + " is inside the gstack-evals repository; render outside it");
  checkPin(o.gstack);
  const skill = readFileSync(join(o.gstack, "autoplan", "SKILL.md"), "utf8");
  const parts = [section(skill, "## The 6 Decision Principles"), section(skill, "## Decision Classification"), section(skill, '## What "Auto-Decide" Means'), skipList(skill)];
  const engPhase = readFileSync(join(o.gstack, "autoplan", "sections", "eng-phase.md"), "utf8");

  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "er-render-")));
  try {
    const source = join(scratch, "source.md");
    const active = join(scratch, "active.md");
    const restore = join(scratch, "autoplan", "restore.md");
    mkdirSync(dirname(restore));
    writeFileSync(source, o.plan);
    const init = tool(o.gstack, scratch, ["init", source, active, restore]);
    if (!init.ok) throw fail("E_USAGE", "plan.md does not fit the snapshot tool's Implementation plan and Review record layout: " + init.err);
    const wrapped = readFileSync(active, "utf8").replace(/^<!--[^\n]*-->\n/, "") !== o.plan;
    const meth = tool(o.gstack, scratch, ["methodology", "eng", join(o.gstack, "plan-eng-review", "SKILL.md"), restore]);
    if (!meth.ok) throw fail("E_INTERNAL", "snapshot tool methodology eng failed: " + meth.err);
    const methPath: string = JSON.parse(meth.out).methodologyPath;
    const create = tool(o.gstack, scratch, ["create", "eng", active, restore, methPath]);
    if (!create.ok) throw fail("E_INTERNAL", "snapshot tool create eng failed: " + create.err);
    const snapPath: string = JSON.parse(create.out).snapshotPath;
    const methDir = dirname(methPath);
    const snapDir = dirname(snapPath);

    const gstackDirs = [...new Set([realpathSync(o.gstack), resolve(o.gstack)])];
    const swaps: Array<[string, string]> = [
      [methDir + "/", MOUNT_DIR + "/"],
      [snapDir + "/", MOUNT_DIR + "/"],
      [restore, PLAN_MOUNT],
      [active, PLAN_MOUNT],
      ...gstackDirs.map((d): [string, string] => [d + "/", SKILLS_HOME + "/"]),
    ];
    const swap = (s: string) => swaps.reduce((t, [from, to]) => t.split(from).join(to), s);

    const methodology = swap(readFileSync(methPath, "utf8"));
    const mj = JSON.parse(readFileSync(join(methDir, "methodology.json"), "utf8"));
    let offset = 0;
    const sources = mj.sources.map((s: any) => {
      const path = swap(s.path);
      const startByte = offset + Buffer.byteLength("<!-- Autoplan methodology source: " + JSON.stringify(path) + " -->\n");
      offset = startByte + s.bytes + 2;
      return { ...s, path, resolvedPath: swap(s.resolvedPath), startByte, endByte: startByte + s.bytes };
    });
    const methodologyJson = JSON.stringify({ ...mapStrings(mj, swap), sha256: sha256(methodology), bytes: Buffer.byteLength(methodology), lines: methodology.split("\n").length, sources }) + "\n";

    const native = swap(readFileSync(join(snapDir, "native-prompt.md"), "utf8"));
    const sj = JSON.parse(readFileSync(join(snapDir, "snapshot.json"), "utf8"));
    const oldId = sj.nativePromptLines + " lines and " + sj.nativePromptBytes + " UTF-8 bytes; SHA-256 " + sj.nativePromptSha256;
    const newId = native.split("\n").length + " lines and " + Buffer.byteLength(native) + " UTF-8 bytes; SHA-256 " + sha256(native);
    if (!sj.nativeDispatchPrompt.includes(oldId)) throw fail("E_INTERNAL", "nativeDispatchPrompt does not carry native-prompt.md's identity line");
    const snapshotJson =
      JSON.stringify({
        ...mapStrings(sj, swap),
        methodology: { ...mapStrings(sj.methodology, swap), sha256: sha256(methodology), bytes: Buffer.byteLength(methodology), lines: methodology.split("\n").length, manifestSha256: sha256(methodologyJson) },
        nativePromptSha256: sha256(native),
        nativePromptBytes: Buffer.byteLength(native),
        nativePromptLines: native.split("\n").length,
        nativeDispatchPrompt: swap(sj.nativeDispatchPrompt).replace(oldId, newId),
      }) + "\n";

    const contents: Array<[string, string]> = [
      ["methodology.md", methodology],
      ["methodology.json", methodologyJson],
      ["eng-implementation.md", readFileSync(snapPath, "utf8")],
      ["source-implementation.md", readFileSync(join(snapDir, "source-implementation.md"), "utf8")],
      ["native-prompt.md", native],
      ["snapshot.json", snapshotJson],
    ];
    const readRanges: Array<{ offset: number; limit: number }> = mj.readRanges.map((r: any) => ({ offset: r.offset, limit: r.limit }));
    const methodologyMount = MOUNT_DIR + "/methodology.md";

    const text = [
      "# /autoplan Phase 3 (Eng Review + Dual Voices), entered with no earlier phase run",
      "",
      "This session holds what an /autoplan session holds when it enters Phase 3, at gstack " + ER_ENGPHASE_GSTACK.sha.slice(0, 9) + " (VERSION " + ER_ENGPHASE_GSTACK.version + "). It is autoplan's eng phase without its other phases or its gate. The build already ran this phase's snapshot tool steps and mounted their outputs read-only under " + MOUNT_DIR + "/.",
      "",
      "## Phase state",
      "",
      "- Phase 1 (CEO review): skipped. No earlier phase ran.",
      "- Phase 2 (Design review): skipped. No earlier phase ran.",
      "- Phase 2.5 (DX review): skipped. No earlier phase ran.",
      "- Outside voice (Codex): unavailable. Codex is not installed in this container, so outside_status is unavailable and the native eng voice runs alone.",
      "- Left out, because they need a live autoplan run directory: phase-close, amend-input, review logs, the plan-reality check and the Phase 4 gate. Do not run them. Every other review step, decision rule and required output of Phase 3 stays.",
      "",
      "## Phase inputs",
      "",
      "- ACTIVE_PLAN: " + PLAN_MOUNT + ", the plan under review. " + (wrapped ? "It has no Implementation plan and Review record headings of its own, so the snapshot tool read its whole text as the Implementation plan." : 'The snapshot tool read its "## Implementation plan" section.'),
      "- REVIEW_SKILL: " + SKILLS_HOME + "/plan-eng-review/SKILL.md",
      "- methodologyPath: " + methodologyMount + " (" + methodology.split("\n").length + " lines), from `methodology eng` on REVIEW_SKILL. The build ran it; do not run it again.",
      "- <ENG_INPUT>: " + MOUNT_DIR + "/eng-implementation.md, the snapshotPath from `create eng` on ACTIVE_PLAN. The build ran it; do not run it again. snapshot.json beside it holds the nativeDispatchPrompt.",
      "",
      "Before dispatch, Read " + methodologyMount + " with your native Read tool at every readRanges offset and limit, including the final chunk:",
      "",
      ...readRanges.map((r) => "- offset " + r.offset + ", limit " + r.limit),
      "",
      mj.instruction,
      "",
      "# From autoplan/SKILL.md",
      "",
      parts.join("\n\n"),
      "",
      "# autoplan/sections/eng-phase.md",
      "",
      engPhase,
    ].join("\n");

    const hostTraces = [scratch, ...gstackDirs, resolve(o.out)];
    for (const [name, body] of [["opening", text], ...contents] as Array<[string, string]>) {
      const leak = hostTraces.find((h) => body.includes(h));
      if (leak) throw fail("E_INTERNAL", name + " still names the host path " + leak);
    }

    mkdirSync(o.out, { recursive: true });
    const files = contents.map(([name, body]) => {
      const host = join(o.out, name);
      writeFileSync(host, body, { flag: "wx", mode: 0o444 });
      return { name, host, mount: MOUNT_DIR + "/" + name, sha256: sha256(body) };
    });
    return { text, sha256: sha256(text), files, methodology: methodologyMount, readRanges };
  } finally {
    removeTree(scratch);
  }
}

const HELP = "gstack-evals er render --gstack <checkout at 199931029> --plan <plan.md> --out <dir>\n  Renders the eng phase arm's opening for one unit: writes the files to mount read-only under /work/autoplan/, plus opening.md and opening.json, into --out (outside this repo, absent or empty), and prints the opening's sha256.";

export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(HELP);
    return 0;
  }
  const gstack = get("--gstack");
  const planFile = get("--plan");
  const out = get("--out");
  const refuse = (why: string, fix: string) => {
    io.err("E_USAGE er render: " + why + "\nE_USAGE fix: " + fix);
    return 2;
  };
  if (!gstack || !planFile || !out) return refuse("needs --gstack <dir>, --plan <plan.md> and --out <dir>", "run gstack-evals er render --help");
  if (existsSync(out) && readdirSync(out).length) return refuse("--out " + out + " is not empty", "pass a new or empty directory");
  let plan: string;
  try {
    plan = readFileSync(planFile, "utf8");
  } catch (e) {
    return refuse("cannot read " + planFile + ": " + (e as Error).message, "pass the unit's plan.md");
  }
  const r = renderEngPhase({ gstack, plan, out });
  writeFileSync(join(out, "opening.md"), r.text);
  writeFileSync(join(out, "opening.json"), JSON.stringify({ sha256: r.sha256, gstack: ER_ENGPHASE_GSTACK, methodology: r.methodology, readRanges: r.readRanges, files: r.files.map(({ name, mount, sha256 }) => ({ name, mount, sha256 })) }, null, 2) + "\n");
  io.out(r.sha256);
  return 0;
}
