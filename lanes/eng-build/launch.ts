// Copyright (c) 2026 Garry Tan. MIT License.
// The paid stages' real launchers, each holding one lease on its stage's item under run geva-522-eb and settling it on
// close, after its proxy journal is reconciled: the statement notes on the product-value meter, the review sessions on
// the Docker rig and eng-review's session loop (src/trial/review/er-run.ts's attempt, with the build read's prompt, arm
// installs and Stop hook on every skill arm), and the build sessions on the outcome-skills session driver with the Lane B
// agent (real_agent) through Harbor. None of this runs keyless: the tests drive the same stages through stub launchers.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { BACKGROUND_WAIT_MS } from "../../src/adapters/claude-code/driver.ts";
import { hostDriver } from "../../src/adapters/host.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import type { ResolvedArms } from "../../src/skill-eval/cli/arms.ts";
import { DEFAULT_POLICY, loadPolicy, providerOf, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { armNamespaces, dockerRig, slotModels } from "../../src/skill-eval/cli/run-host.ts";
import { ER_COVERAGE_DIR, ER_INSTALL_SKILL, ER_REC_USER, ER_SKILL, ER_SYSTEM_PROMPT, erFreeform } from "../../src/trial/review/eng-review.ts";
import { STATE_ROOT_DIR } from "../../src/trial/state-root.ts";
import { runTrial } from "../../src/trial/trial.ts";
import { erOutcome, type ErOutcome } from "../eng-review/parse.ts";
import { serveStages, type ServeOptions } from "../outcome-skills/driver/stage.ts";
import { HARBOR_MODEL } from "../outcome-skills/statemachines/run.ts";
import { sessionEnd } from "../outcome-skills/statemachines/session.ts";
import { isSkillArm, REVIEW_SESSION } from "./arms.ts";
import { armName, BUILD_MODEL, buildMounts, buildRegistry, checkMounts, preflight, prepareTree, REPO_DIR, type BuildSession } from "./build-stage.ts";
import { repoEdits } from "./bundle.ts";
import { trialTask } from "./contain.ts";
import { fail } from "./errors.ts";
import { EB_BUILD_SKILL, EB_RUN } from "./ledger.ts";
import { NOTE_MODELS, type ModelCall } from "./note.ts";
import { reviewArmSpec, type AttemptEnd } from "./review-stage.ts";
import { openingEvidence, type Launcher, type ReviewSession } from "./pipeline.ts";
import type { Arm, Reviewer, SessionOutcome } from "./types.ts";
import { sessionImage, type SessionImage } from "./session-image.ts";
import { readUnit } from "./unit.ts";
import { openMeter } from "../product-value/meter.ts";

const ROOT = join(import.meta.dir, "../..");
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

/** The reviewer's model as the policy and the proxies name it. */
export const REVIEWER_MODEL: Record<Reviewer, string> = { opus: "claude-opus-5-5", sol: "openai/gpt-6.1-sol", particle: "particle-ai/particle-1" };

/** The note writer's and auditor's answer budget, in output tokens. */
export const NOTE_MAX_TOKENS = 4000;

/** Notes: the meter opens the item's lease, and each role's call goes through its proxy. */
export function noteLauncher(o: { out: string; cacheDir: string; env?: Record<string, string | undefined> }): Launcher<ModelCall> {
  return async (p) => {
    const meter = await openMeter({ item: p.item, runId: EB_RUN, out: o.out, cacheDir: o.cacheDir, maxOutputTokens: NOTE_MAX_TOKENS, record: p.record, ledger: p.ledger, env: o.env });
    const key = { writer: "sol", audit: "opus" } as const;
    if (NOTE_MODELS.writer !== "openai/gpt-6.1-sol" || NOTE_MODELS.audit !== "anthropic/claude-opus-5-5") fail("E_USAGE", "note.ts's models moved; update the note launcher's route keys");
    const call: ModelCall = async (role, prompt) => {
      const r = await meter.call({ model: key[role], prompt, maxTokens: NOTE_MAX_TOKENS, effort: null, label: "eb-note:" + role });
      if (r.status !== 200 || r.text === null) return fail("E_USAGE", "the note " + role + " call ended " + r.status + (r.problem ? " (" + r.problem + ")" : "") + "; rerun the notes stage, which skips written notes");
      return r.text;
    };
    return { lease_id: meter.leaseId, backend: call, close: async () => void (await meter.close()) };
  };
}

/** Reviews: the Docker rig opens the item's lease, builds the arm's install from reviewArmSpec and starts the proxy. */
export function reviewLauncher(o: { arms: Exclude<Arm, "none">[]; reviewer: Reviewer; out: string; env: Record<string, string | undefined>; policy?: string; log?: (line: string) => void }): Launcher<ReviewSession> {
  return async (p) => {
    const loaded = loadPolicy(o.policy ?? DEFAULT_POLICY);
    if ("problem" in loaded) return fail("E_USAGE", "model policy: " + loaded.problem);
    const policy = loaded as LoadedPolicy;
    const model = REVIEWER_MODEL[o.reviewer];
    const specs = o.arms.map((arm) => reviewArmSpec(arm) ?? fail("E_USAGE", "arm " + arm + " runs no review session"));
    const tasks = join(o.out, "fixtures", "tasks.json");
    mkdirSync(join(o.out, "fixtures"), { recursive: true });
    writeFileSync(tasks, "[]\n");
    const arms: ResolvedArms = { arms: specs, base: null, skill: null, notes: [] };
    const env = o.env as Record<string, string>;
    const call = { host: "claude" as const, arms, tasks, out: { path: o.out, rule: "--out" }, ledger: ledgerPath(p.ledger), record: recordPath(p.record, env), item: p.item, runId: EB_RUN, models: [model], policy };
    const skills = Object.fromEntries(o.arms.filter(isSkillArm).map((a) => [a, ER_INSTALL_SKILL[a]]));
    const rig = dockerRig(call, { env, skill: null, skills, nonce: randomBytes(6).toString("hex"), cap: Math.round(p.capUsd * 1_000_000), voice: false });
    const empty = join(o.out, "fixtures");
    const session: ReviewSession = async (s) => {
      const provider = providerOf(policy, model) ?? fail("E_USAGE", model + " has no provider in the policy");
      const skillArm = isSkillArm(s.arm);
      const binding = await rig.bind({ cell: { run_id: EB_RUN, arm: s.arm, task: s.unit.id, model, trial: s.rep, attempt: s.attempt }, models: slotModels(policy, model, null), allowance_micros: REVIEW_SESSION.allowanceMicros });
      const sandbox = rig.sandbox(s.arm, false, model);
      const run = join(s.dir, "run");
      mkdirSync(join(run, "host"), { recursive: true });
      const home = sandbox.homePath(run);
      const install = rig.arms[s.arm]!;
      const name = skillArm ? ER_SKILL[s.arm as "precut" | "engphase" | "candidate"] : null;
      const skill = install.skill && name ? { name, roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
      const work = join(run, "work", s.unit.id);
      const opening = s.arm === "engphase" ? openingEvidence(s.unit) : null;
      if (opening) writeFileSync(join(run, "host", "er-opening.json"), JSON.stringify(opening, null, 2) + "\n");
      const hook = s.hook((t) => ({ transcript: t, stateRoot: join(work, STATE_ROOT_DIR), coverage: join(work, ER_COVERAGE_DIR), opening }));
      let captured: ReviewCapture | null = null;
      const gate = (w: string) => {
        captured = captureReview(w, s.unit.repo, join(run, "host"));
        return { copy_out: [], gate: { plan: captured.plan !== null, repo_edits: captured.repoEdits } };
      };
      const agent = (rig.driver ?? hostDriver)({ host: "claude", model, provider, proxy: { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token }, interactive: true, skill, out: join(run, "host"), entry: { user: ER_REC_USER }, freeform: erFreeform, systemPrompt: ER_SYSTEM_PROMPT, maxTurns: REVIEW_SESSION.maxTurns, ...(skillArm ? { sessionKind: "unattended" as const } : {}), disable1mContext: true, capStops: true, backgroundWaitMs: BACKGROUND_WAIT_MS, ...(hook ? { stopHook: hook.onStop } : {}) });
      const trial = await runTrial({ cell: { model, arm: s.arm, round: 1, trial: s.rep }, task: { id: s.unit.id, prompt: s.prompt }, tasksDir: empty, sandbox, agent, dir: run, timeoutS: REVIEW_SESSION.timeoutS, network: rig.network, seed: s.seed, root: true, gate, copyDirs: [{ from: STATE_ROOT_DIR, to: join(run, "host", "gstack-state") }, { from: ER_COVERAGE_DIR, to: join(run, "host", "plan-coverage") }], ...(skillArm ? {} : { stateRoot: false as const }), ...(s.arm === "engphase" && s.unit.opening?.mounts ? { mounts: s.unit.opening.mounts } : {}) });
      const meter = await rig.finalize(binding.meter_id);
      const transcriptFile = join(run, "host", "transcript.ndjson");
      const transcript = existsSync(transcriptFile) ? readFileSync(transcriptFile, "utf8") : null;
      const { end, why } = reviewEnd(erOutcome(trial.record.termination, transcript).outcome, s.cell);
      if (why) o.log?.("cell " + s.cell + " a" + s.attempt + ": " + why);
      const kept = (captured as ReviewCapture | null) ?? fail("E_USAGE", "cell " + s.cell + " a" + s.attempt + ": the trial ended before its work tree was read");
      const dirOf = (d: string) => (existsSync(d) ? d : null);
      return { end, costUsd: meter.micros / 1_000_000, result: { dir: run, outputs: { plan: kept.plan, transcript: transcript ?? "", stateRoot: skillArm ? dirOf(join(run, "host", "gstack-state")) : null, coverage: dirOf(join(run, "host", "plan-coverage")) }, repoEdits: kept.repoEdits, blocks: hook?.blocks() ?? 0 } };
    };
    return { lease_id: rig.recovery?.lease_id ?? "", backend: session, close: async () => void (await rig.close()) };
  };
}

export interface ReviewCapture {
  plan: string | null;
  repoEdits: number;
}

/** What a review attempt leaves in its work tree, read before runTrial removes the tree: the final plan.md, copied to
 * <host>/plan.md, and the count of repository edits against the unit's base tree. The reply and the skill's written files
 * reach the host through the transcript and runTrial's copyDirs. */
export function captureReview(work: string, baseRepo: string, host: string): ReviewCapture {
  const file = join(work, "plan.md");
  const plan = lstatSync(file, { throwIfNoEntry: false })?.isFile() ? readFileSync(file, "utf8") : null;
  if (plan !== null) {
    mkdirSync(host, { recursive: true });
    writeFileSync(join(host, "plan.md"), plan);
  }
  return { plan, repoEdits: repoEdits(baseRepo, join(work, "repo")) };
}

/** A review attempt's end from eng-review's outcome reading. A web result despite the denied web tools is a containment
 * failure: infra, so it gets one rerun and then a gap, with the reason printed. A cap stop ends the stage incomplete. */
export function reviewEnd(read: ErOutcome, cell: string): { end: AttemptEnd; why: string | null } {
  if (read.state === "cap") return fail("E_EB_CELL_INCOMPLETE", "the proxy stopped cell " + cell + " at the cap; the stage is incomplete and is never retried to change a reading");
  if (read.state === "contaminated") return { end: "infra", why: read.web.length + " web result" + (read.web.length === 1 ? "" : "s") + " despite the denied web tools, a containment failure, so the attempt ends infra (one rerun, then a gap)" };
  if (read.state === "arm-stop") return { end: "limit", why: null };
  if (read.state === "infra") return { end: read.reason === "API error" ? "upstream" : "infra", why: null };
  return { end: "completed", why: null };
}

const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;

/** Removes the dependency files the launcher copied into the build tree and the empty mountpoints Docker made for the
 * dependency volumes, and each parent made with them, so the tree holds what it held before the session. */
export function restoreTree(tree: string, deps: string[], files: string[] = []): void {
  for (const f of files) rmSync(join(tree, f), { force: true });
  for (const d of deps) {
    for (let rel = d; rel !== "." && rel !== ""; rel = posix.dirname(rel)) {
      const at = join(tree, rel);
      if (!existsSync(at) || readdirSync(at).length > 0) break;
      rmdirSync(at);
    }
  }
}

function findDir(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === name) return join(dir, e.name);
    const q = findDir(join(dir, e.name), name);
    if (q) return q;
  }
  return null;
}

/** A Lane B session's end from real_agent's real-summary.json: the outcome driver's end kind (statemachines/session.ts
 * sessionEnd), with every limit scored as is and an upstream or infra end sent to the outcome rule's retry. */
export function buildEnd(summary: Record<string, any> | null): SessionOutcome {
  const { end } = sessionEnd(summary, !summary);
  return end === "completed" ? "completed" : end === "upstream" ? "upstream_gap" : end === "infra" ? "infra_gap" : "limit";
}

/** Runs a command without blocking this process, which serves the driver's control plane and proxy to the session; resolves with its output, after a kill at timeoutMs. */
function runAsync(cmd: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<string> {
  return new Promise((done) => {
    const c = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => c.kill("SIGKILL"), timeoutMs);
    c.on("error", (e) => (out += "\n" + e.message));
    c.on("close", () => {
      clearTimeout(timer);
      done(out);
    });
  });
}

/**
 * The Harbor task.toml of one build session, in family SM's shape (statemachines/unit.ts): the session image, no Harbor
 * network policy, and an agent timeout past the arm's wall limit, so real_agent's own wall limit ends the session. The
 * unit's real-outcome task.toml is the verifier's: its agent allowlist with no hosts and its no-network environment
 * would leave real_agent no route to the proxy, and Harbor refuses the allowlist on a kernel without nftables inet.
 * real_agent's egress table (ip and ip6 families) is what limits the session: its non-SM path allows the proxy and the
 * sidecar's agent plane only, and its probe checks that.
 */
export function sessionToml(id: string, image: string, wallSec: number): string {
  return ["version = \"1.0\"", "", "[metadata]", "id = " + JSON.stringify(id), "", "[agent]", "timeout_sec = " + (wallSec + 600), "", "[verifier]", "timeout_sec = 900", "", "[environment]", "docker_image = " + JSON.stringify(image), ""].join("\n");
}

/**
 * Builds: the outcome driver opens the item's lease and serves one stage for the arm (kind none, from buildRegistry,
 * charging EB_BUILD_SKILL), and each attempt is one Harbor run of real_agent on the driver's control plane (ledger u4) in
 * the unit's session image (session-image.ts: the unit's pinned image with the review stage's Claude Code on top, built
 * once per unit and removed on close), with the build tree, plan and bundle mounted by buildMounts after checkMounts and
 * the clean-room preflight on that image. Harbor runs as a child process this one awaits, so the driver keeps serving
 * the session's control plane and proxy meanwhile. real_agent's non-SM path opens its trial on the real-outcome sandbox sidecar,
 * which the operator serves at sidecar. serve passes the keyless end-to-end run's stub upstream to the driver.
 */
export function buildLauncher(o: { arm: Arm | Arm[]; units: Map<string, { dir: string }>; repos: string; plans: string; bundles: string | null; out: string; host: string; envelopeHost: string; sidecar: string; forbidden: string[]; planned: number; harbor?: string; docker?: string; serve?: Pick<ServeOptions, "fetch" | "env" | "requireAdmission" | "machine" | "log"> }): Launcher<BuildSession> {
  return async (p) => {
    const names = [...new Set((Array.isArray(o.arm) ? o.arm : [o.arm]).map(armName))];
    if (names.length !== 1) fail("E_USAGE", "one build launch serves one driver stage, so it runs the none arm alone or reviewed arms together");
    const local = openLocalLedger(ledgerPath(p.ledger));
    const registry = buildRegistry();
    const arms = join(o.out, "eb-registry.json");
    mkdirSync(o.out, { recursive: true });
    writeFileSync(arms, JSON.stringify(registry, null, 2) + "\n");
    const served = await serveStages({ record: p.record, local, run_id: EB_RUN, envelope_host: o.envelopeHost, stages: [{ item: p.item, arm: names[0]!, skills: [EB_BUILD_SKILL] }], host: o.host, dir: join(o.out, "driver"), planned: o.planned, registry, ...o.serve });
    const stage = served.stages[0]!;
    const images = new Map<string, SessionImage>();
    const session: BuildSession = async (s) => {
      const unit = o.units.get(s.unit.id) ?? fail("E_USAGE", "no unit folder for " + s.unit.id);
      const { eb } = readUnit(unit.dir);
      const out = join(o.out, "sessions", s.cell.replace(/[^A-Za-z0-9._-]/g, "_"), "a" + s.attempt);
      rmSync(out, { recursive: true, force: true });
      const tree = join(out, "repo");
      cpSync(join(o.repos, s.unit.id), tree, { recursive: true });
      prepareTree(tree);
      const plan = join(o.plans, s.unit.id + ".md");
      const review = s.arm === "none" ? null : join(o.bundles ?? fail("E_USAGE", "a reviewed arm builds from its review bundles; pass --bundles"), s.cell.replace(/[^A-Za-z0-9._-]/g, "_"));
      const mounts = buildMounts({ arm: s.arm, repo: tree, plan, review });
      checkMounts(mounts, [unit.dir, ...o.forbidden]);
      const img = images.get(eb.image.id) ?? sessionImage(eb.image.id, { docker: o.docker });
      images.set(eb.image.id, img);
      preflight({ docker: o.docker ?? "docker", image: img.tag, digest: img.id, mounts });
      const task = join(out, "task");
      mkdirSync(join(task, "environment"), { recursive: true });
      writeFileSync(join(task, "environment/Dockerfile"), "FROM " + img.tag + "\n");
      writeFileSync(join(task, "task.toml"), sessionToml(s.unit.id, img.tag, registry.arms[s.armName]!.limits.wall_limit_sec));
      writeFileSync(join(task, "instruction.md"), s.prompt);
      const compose = join(out, "mounts.compose.yaml");
      writeFileSync(compose, "services:\n  main:\n    volumes:\n" + [...mounts, ...img.deps.filter((d) => !img.depFiles.includes(d)).map((d) => REPO_DIR + "/" + d)].map((m) => "      - " + JSON.stringify(m) + "\n").join(""));
      const taskJson = join(out, "task.json");
      writeFileSync(taskJson, JSON.stringify(trialTask(tree, img.deps)));
      if (img.depFiles.length) {
        const tar = spawnSync(o.docker ?? "docker", ["run", "--rm", "--network", "none", "--entrypoint", "tar", img.id, "-C", REPO_DIR, "-cf", "-", "--", ...img.depFiles], { timeout: 300_000, maxBuffer: 1024 * 1024 * 1024 });
        if (tar.status !== 0 || spawnSync("tar", ["-x", "-C", tree, "-f", "-"], { input: tar.stdout }).status !== 0) fail("E_USAGE", "could not copy the dependency files " + img.depFiles.join(", ") + " from the session image into the build tree");
      }
      const label = s.cell;
      const manifest = join(out, "images.json");
      const manifestText = JSON.stringify({ rows: [{ label, image_id: img.id, unit_image_id: eb.image.id, claude_code: img.claude }] }) + "\n";
      writeFileSync(manifest, manifestText);
      const armTar = join(out, "arm.tar");
      writeFileSync(armTar, Buffer.alloc(10240));
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
      env.ANTHROPIC_API_KEY = "placeholder-not-a-key";
      env.PYTHONPATH = join(ROOT, "lanes/real-outcome/agent") + ":" + join(ROOT, "quick/laneb/runner/agent");
      env.PYTHONDONTWRITEBYTECODE = "1";
      const ak = { skip_install: "true", task_json: taskJson, arm: s.armName, arm_tar: armTar, upstream_model: BUILD_MODEL, arms_path: arms, control_url: served.control, ledger: "u4", task_label: label, trial_n: "1", ...(s.attempt > 1 ? { rerun: "fresh container after an upstream or infra end" } : {}), image_id: img.id, manifest, manifest_sha256: sha(manifestText), repo_dir: "/work/repo", workdir: "/work", sidecar_url: o.sidecar };
      const proxy = /^https?:\/\//.test(stage.proxy) ? stage.proxy : "http://" + stage.proxy;
      const model = HARBOR_MODEL[BUILD_MODEL] ?? fail("E_USAGE", "no Harbor model for " + BUILD_MODEL);
      const h = await runAsync(o.harbor ?? "harbor", ["run", "-y", "-p", task, "-a", "real_agent:RealAgent", "-m", model, "--base-url", proxy, ...Object.entries(ak).flatMap(([k, v]) => ["--ak", k + "=" + v]), "-e", "docker", "--extra-docker-compose", join(ROOT, "quick/laneb/runner/agent-caps.compose.yaml"), "--extra-docker-compose", compose, "-o", join(out, "jobs"), "--job-name", "eb-" + sha(label + s.attempt + Date.now()).slice(0, 12), "--disable-verification", "--delete"], env, (registry.arms[s.armName]!.limits.wall_limit_sec + 900) * 1000);
      writeFileSync(join(out, "harbor.log"), h);
      spawnSync(o.docker ?? "docker", ["run", "--rm", "--network", "none", "--user", "0:0", "-v", tree + ":/eb-tree", "--entrypoint", "chown", img.id, "-R", (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000), "/eb-tree"], { encoding: "utf8", timeout: 300_000 });
      restoreTree(tree, img.deps, img.depFiles);
      const ev = findDir(join(out, "jobs"), "evaluator");
      const summary = ev && existsSync(join(ev, "real-summary.json")) ? (JSON.parse(readFileSync(join(ev, "real-summary.json"), "utf8")) as Record<string, any>) : null;
      const spent = typeof summary?.proxy?.spent_micros === "number" ? summary.proxy.spent_micros / 1_000_000 : 0;
      const outcome = buildEnd(summary);
      return { outcome, tree: ev && existsSync(join(ev, "final.patch")) ? ev : null, costUsd: spent };
    };
    return {
      lease_id: stage.lease_id,
      backend: session,
      close: async () => {
        try {
          await served.stop();
        } finally {
          local.close();
          if (images.size) spawnSync(o.docker ?? "docker", ["rmi", "-f", "--no-prune", ...[...images.values()].map((i) => i.tag)], { encoding: "utf8", timeout: 120_000 });
        }
      },
    };
  };
}
