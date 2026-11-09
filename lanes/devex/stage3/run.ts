// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's controller (prereg 2026-11-09-geva-417, section 12, section 6's stage 3 row, section 15 rules 3 and 7). For
// each build unit and each of the four arms it runs one build session in its own sandbox VM, then one docs-only session
// in another, and reads the measures. The controller only moves files and starts commands through VmBackend; repository
// code (the recipe, the checker, the probes, the agents' commands) runs only inside the VMs.
//
// After each VM run the controller reads the network log and the stat-only file list. A connection anywhere but the
// proxy and the mirror marks that build contaminated and missing and stops stage 3 with E_DX_SANDBOX_BREACH: the open
// lease settles at the spend recorded so far, nothing is retried and the stop goes to the Captain. A unit whose base
// fails to install scores first success 0 under E_DX_BUILD_INSTRUMENT; a build with no tree or a tree the sandbox can't
// install scores 0 too. Both are counted and printed. A VM run that fails before it returns is missing under
// E_DX_INFRA_MISSING and waits for the Captain, as section 6's session rows do.
import { ARM_IDS, type AliasMap, type ArmId, type Row, type UnitMeta } from "../types.ts";
import { unaliasText } from "../unit/alias.ts";
import { armBlock, BUILD_ENV, BUILD_LIMITS, buildInstrument, buildPrompt, type BuildEnd } from "./build.ts";
import { DOCS_TURNS, docsFiles, docsPrompt, instrumented, measures, PROBE_SECONDS, scoreProbe, type BuildMeasures, type Command, type ProbeJudge, type ProbeRun } from "./firstsuccess.ts";
import type { GoalRecord, Probe } from "./goal.ts";
import { sandboxed, type Connection, type ExecResult, type StatEntry, type Vm, type VmBackend, type VmSpec } from "./sandbox.ts";

export const WORK = "/work";
export const REPO = WORK + "/repo";
/** The probe's own kill timeout sits past the contract's 10 seconds, so a slow probe is measured, not cut at the edge. */
export const PROBE_KILL_MS = (PROBE_SECONDS + 5) * 1000;

export interface BuildUnit {
  meta: UnitMeta;
  goal: GoalRecord;
  /** plan.md as the review sessions saw it (aliased). */
  plan: string;
  alias: AliasMap;
  /** The real base tree as a tar, read from the untrusted clone as data only. */
  base: Uint8Array;
}

/** Runs Opus 5.5 in Claude Code inside the VM, with no gstack, under the limits. */
export type BuildAgent = (vm: Vm, o: { prompt: string; limits: typeof BUILD_LIMITS; env: Readonly<Record<string, string>> }) => Promise<{ spend_micros: number | null }>;
/** Runs the fresh docs-only agent inside the VM for up to turns turns and returns the commands it ran. */
export type DocsAgent = (vm: Vm, o: { prompt: string; turns: number }) => Promise<{ commands: Command[]; turns: number; minutes: number }>;

export interface Stage3Deps {
  backend: VmBackend;
  spec: (kind: "build" | "docs") => VmSpec;
  buildAgent: BuildAgent;
  docsAgent: DocsAgent;
  judge: ProbeJudge;
  /** Settles the stage's open lease at the spend recorded so far (section 15 rule 3). */
  settle: (code: "E_DX_SANDBOX_BREACH", why: string) => Promise<void>;
  /** A fresh canary value per docs-only run; probes that need a credential read it from $DX_CANARY. */
  canary: () => string;
}

export interface Stage3Stop {
  code: "E_DX_SANDBOX_BREACH";
  unit: string;
  arm: ArmId;
  phase: "build" | "docs";
  breach: Connection[];
  log: Connection[];
  files: StatEntry[];
}

export interface Stage3Result {
  builds: BuildMeasures[];
  stop: Stage3Stop | null;
}

const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const ok = (r: ExecResult) => r.exit === 0;
const lastLine = (s: string) => s.trim().split("\n").pop()?.trim() ?? "";

/** Splits a curl -si reply into its media type and body; a CLI probe keeps its stdout. */
export function probeRun(p: Probe, r: ExecResult): ProbeRun {
  if (p.kind === "cli") return { kind: "cli", exit: r.exit, stdout: r.stdout, stderr: r.stderr, elapsed_ms: r.elapsed_ms, stdin_closed: r.stdin_closed, content_type: null };
  const parts = r.stdout.split(/\r?\n\r?\n/);
  const head = parts.shift() ?? "";
  const type = /^content-type:\s*([^\r\n;]+)/im.exec(head)?.[1]?.trim() ?? null;
  return { kind: "api", exit: r.exit, stdout: parts.join("\n\n"), stderr: r.stderr, elapsed_ms: r.elapsed_ms, stdin_closed: r.stdin_closed, content_type: type };
}

interface Built extends BuildEnd {
  artifact: Uint8Array | null;
  readme: string;
  docs: Record<string, string>;
}

async function buildJob(vm: Vm, u: BuildUnit, prompt: string, d: Stage3Deps): Promise<Built> {
  const b = d.backend, r = u.goal.recipe;
  const none: Built = { base_installs: false, tree: false, tree_installs: false, artifact: null, readme: "", docs: {} };
  await b.write(vm, WORK + "/base.tar", u.base);
  if (!ok(await b.exec(vm, "mkdir -p " + REPO + " && tar -xf " + WORK + "/base.tar -C " + REPO + " && cp -a " + REPO + " " + WORK + "/base-check && chown -R run " + WORK, { user: "root", stdinClosed: true }))) return none;
  const baseBuild = await b.exec(vm, "cd " + WORK + "/base-check && " + r.build, { user: "run", stdinClosed: true });
  const baseInstall = ok(baseBuild) && ok(await b.exec(vm, "cd " + WORK + "/base-check && ARTIFACT=" + sh(lastLine(baseBuild.stdout)) + " " + r.install, { user: "run", stdinClosed: true }));
  await b.exec(vm, "rm -rf " + WORK + "/base-check", { user: "root", stdinClosed: true });
  if (!baseInstall) return none;
  await b.write(vm, REPO + "/plan.md", unaliasText(u.plan, u.alias));
  await d.buildAgent(vm, { prompt, limits: BUILD_LIMITS, env: BUILD_ENV });
  const tree = ok(await b.exec(vm, "test -d " + REPO + " && test -n \"$(ls -A " + REPO + ")\"", { user: "run", stdinClosed: true }));
  if (!tree) return { ...none, base_installs: true };
  const built = await b.exec(vm, "cd " + REPO + " && " + r.build, { user: "run", stdinClosed: true });
  const path = lastLine(built.stdout);
  const installs = ok(built) && !!path && ok(await b.exec(vm, "cd " + REPO + " && ARTIFACT=" + sh(path) + " " + r.install, { user: "run", stdinClosed: true }));
  if (!installs) return { ...none, base_installs: true, tree: true };
  const readme = await b.exec(vm, "cat " + REPO + "/README.md", { user: "run", stdinClosed: true });
  const list = await b.exec(vm, "cd " + REPO + " && find docs -type f 2>/dev/null", { user: "run", stdinClosed: true });
  const docs: Record<string, string> = {};
  for (const f of list.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) docs[f.replace(/^docs\//, "")] = new TextDecoder().decode(await b.read(vm, REPO + "/" + f));
  return { base_installs: true, tree: true, tree_installs: true, artifact: await b.read(vm, path.startsWith("/") ? path : REPO + "/" + path), readme: ok(readme) ? readme.stdout : "", docs };
}

interface Docs {
  installs: boolean;
  session: { commands: Command[]; turns: number; minutes: number } | null;
  checker_pass: boolean;
  runs: ProbeRun[];
}

async function docsJob(vm: Vm, u: BuildUnit, built: Built, canary: string, d: Stage3Deps): Promise<Docs> {
  const b = d.backend, r = u.goal.recipe;
  await b.write(vm, WORK + "/artifact", built.artifact!);
  if (!ok(await b.exec(vm, "cd " + WORK + " && ARTIFACT=" + WORK + "/artifact " + r.install, { user: "run", stdinClosed: true }))) return { installs: false, session: null, checker_pass: false, runs: [] };
  const help = await b.exec(vm, r.help, { user: "run", stdinClosed: true });
  for (const [path, text] of Object.entries(docsFiles({ readme: built.readme, docs: built.docs, help: help.stdout + help.stderr, goal: u.goal.goal }))) await b.write(vm, path, text);
  const session = await d.docsAgent(vm, { prompt: docsPrompt(u.goal.goal), turns: DOCS_TURNS });
  const checker_pass = ok(await b.exec(vm, u.goal.checker, { user: "run", stdinClosed: true }));
  const runs: ProbeRun[] = [];
  for (const p of u.goal.probes) runs.push(probeRun(p, await b.exec(vm, "DX_CANARY=" + sh(canary) + " " + p.command, { user: "run", stdinClosed: true, timeoutMs: PROBE_KILL_MS })));
  return { installs: true, session, checker_pass, runs };
}

/** A VM run that failed before it returned (a preamble step, a lost VM, an agent crash): missing, for the Captain. */
const infra = (unit: string, arm: ArmId, why: string | null): BuildMeasures => ({ ...instrumented(unit, arm, "E_DX_INFRA_MISSING", "sandbox error: " + (why ?? "unknown")), missing: true });

/** Runs every build unit's four arms, in unit order then ARM_IDS order, until the end or a sandbox breach. */
export async function runStage3(units: readonly BuildUnit[], rows: readonly Row[], d: Stage3Deps): Promise<Stage3Result> {
  const builds: BuildMeasures[] = [];
  const breach = async (u: BuildUnit, arm: ArmId, phase: "build" | "docs", run: { breach: Connection[]; log: Connection[]; files: StatEntry[] }): Promise<Stage3Result> => {
    builds.push({ ...instrumented(u.meta.id, arm, "E_DX_SANDBOX_BREACH", "sandbox breach"), contaminated: true, missing: true });
    await d.settle("E_DX_SANDBOX_BREACH", u.meta.id + " " + arm + " " + phase + ": " + run.breach.map((c) => c.host + ":" + c.port).join(", "));
    return { builds, stop: { code: "E_DX_SANDBOX_BREACH", unit: u.meta.id, arm, phase, breach: run.breach, log: run.log, files: run.files } };
  };
  for (const u of units)
    for (const arm of ARM_IDS) {
      const prompt = buildPrompt(armBlock(rows, u.meta.id, arm, u.alias));
      const b = await sandboxed(d.backend, d.spec("build"), WORK, (vm) => buildJob(vm, u, prompt, d));
      if (b.breach.length) return breach(u, arm, "build", b);
      if (!b.value) {
        builds.push(infra(u.meta.id, arm, b.error));
        continue;
      }
      const built = b.value;
      const inst = buildInstrument(built);
      if (inst) {
        builds.push(instrumented(u.meta.id, arm, inst.code, inst.why));
        continue;
      }
      const canary = d.canary();
      const x = await sandboxed(d.backend, d.spec("docs"), WORK, (vm) => docsJob(vm, u, built, canary, d));
      if (x.breach.length) return breach(u, arm, "docs", x);
      if (!x.value) {
        builds.push(infra(u.meta.id, arm, x.error));
        continue;
      }
      if (!x.value.installs || !x.value.session) {
        builds.push(instrumented(u.meta.id, arm, null, "tree does not install"));
        continue;
      }
      const v = x.value, session = v.session!;
      const probes = [];
      for (let i = 0; i < u.goal.probes.length; i++) probes.push(await scoreProbe(u.goal.probes[i]!, v.runs[i]!, { goal: u.goal.goal, secrets: [canary], judge: d.judge }));
      builds.push(measures({ unit: u.meta.id, arm, session: { ...session, checker_pass: v.checker_pass }, probes, readme: built.readme }));
    }
  return { builds, stop: null };
}
