// Copyright (c) 2026 Garry Tan. MIT License.
// One family SM session through the real path (the implicit state machines prereg, sections 4 to 6 and 8): the session
// image (image.ts), a Harbor run copy that names that image as its prebuilt docker_image, real_agent in SM mode on the driver's
// control plane (ledger u4), then the sm-session.v1 record from what real_agent wrote. The run copy holds no test, no fix
// and, for a first stage, no issue text: the arm's turn carries the scope. Every provider key is unset for Harbor; the
// only credential the session holds is the driver's slot token.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry, REGISTRY_PATH } from "../arms/registry.ts";
import { readAudit } from "./audit.ts";
import { qaExposure, readSession, textExposure } from "./exposure.ts";
import { issueCut } from "./admission.ts";
import { assertContained, containImage } from "./contain.ts";
import { buildSessionImage, sessionManifest, type SessionImage } from "./image.ts";
import { treeVolume } from "./oracle.ts";
import { questionCounts, refuseUnscored, sessionEnd, writeSessionRecord, type PlannedSession, type SessionRecord } from "./session.ts";
import { memoryPaths } from "./strip.ts";
import { readUnit, smFail, type SmUnit } from "./unit.ts";

const ROOT = join(import.meta.dir, "../../..");
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;
export const HARBOR_MODEL: Record<string, string> = { "claude-opus-5-5": "anthropic/claude-opus-5-5", "openai/gpt-6.1-sol": "anthropic/openai/gpt-6.1-sol", "particle-ai/particle-1": "anthropic/particle-ai/particle-1" };

export interface RunInput {
  unitDir: string; session: PlannedSession; control: string; proxy: string; out: string;
  attempt?: 1 | 2; first?: string; qaHome?: string; qaSha?: string; harbor?: string; jobName?: string;
  /** Section 12's branches: a first stage at file scope (the claim 1 FLOOR retry), a follow-on with the cut issue (the claim 2 raise attempt). */
  scope?: "folder" | "file"; issue?: "full" | "cut";
  /** The arms registry: A3's /qa pin is read from it here, and real_agent reads its turns and the same pin from it as arms_path. */
  registry?: string;
}

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const lines = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : []);
function find(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === name) return p;
      const q = find(p, name);
      if (q) return q;
    }
  }
  return null;
}

/** What the run copy says for one session, and the cell its record keeps. A first stage's instruction holds no issue text
 *  and its turn names the scope: the unit's folder, or at file scope (section 12's claim 1 retry) every file the fix patch
 *  touches (unit.json file_scope), joined into the one line sm_user.py takes. A follow-on's instruction is the issue, or with
 *  the cut issue (section 12's claim 2 raise attempt) issueCut's title and first paragraph, in the cell <cell>-cut so it
 *  never shares a record key with the full-issue session on the same unit. */
export function sessionText(u: SmUnit, s: PlannedSession, issue: string, o: { scope?: "folder" | "file"; issue?: "full" | "cut" } = {}): { scope: string; scope_mode: "folder" | "file" | null; instruction: string; cell: string } {
  if (s.stage === "first" && o.issue) return smFail("E_SM_ARM", "--issue is a follow-on's; " + s.cell + " is a first stage, whose turn names the scope");
  if (s.stage === "followon" && o.scope) return smFail("E_SM_ARM", "--scope is a first stage's; " + s.cell + " is a follow-on, whose turn is the issue");
  const folder = u.scope?.dir ?? "";
  if (s.stage === "followon") {
    if (o.issue !== "cut") return { scope: folder, scope_mode: null, instruction: issue, cell: s.cell };
    const cut = issueCut(issue);
    if (!cut.trim()) return smFail("E_SM_ARM", "unit " + u.id + "'s cut issue is empty");
    return { scope: folder, scope_mode: null, instruction: cut, cell: s.cell + "-cut" };
  }
  const instruction = "The arm's turn names the scope.\n";
  if (o.scope !== "file") return { scope: folder, scope_mode: "folder", instruction, cell: s.cell };
  if (!u.file_scope.length) return smFail("E_SM_ARM", "unit " + u.id + " has no file_scope, so it has no file-scope line");
  const bad = u.file_scope.find((p) => /[\n\r`]/.test(p));
  if (bad !== undefined) return smFail("E_SM_ARM", "unit " + u.id + "'s file scope must be one line with no backtick, and " + JSON.stringify(bad) + " is not");
  return { scope: u.file_scope.join(", "), scope_mode: "file", instruction, cell: s.cell };
}

/** Builds the image and run copy, runs Harbor, writes out/session.json and returns the record. */
export function runSession(i: RunInput): { record: SessionRecord; image: SessionImage; evaluator: string | null; harbor_exit: number } {
  const u = readUnit(i.unitDir);
  const s = i.session;
  const attempt = i.attempt ?? 1;
  const model = HARBOR_MODEL[s.model] ?? smFail("E_SM_ARM", "sm session run has no Harbor model for " + s.model);
  if (existsSync(i.out)) return smFail("E_SM_ARM", i.out + " exists; each session attempt writes a new run dir");
  let treePatch: string | undefined;
  let treeRef: SessionRecord["tree_ref"] = null;
  if (s.stage === "followon") {
    if (s.tree === "S0") treePatch = "";
    else {
      const f = JSON.parse(readFileSync(i.first ?? smFail("E_SM_ARM", "follow-on " + s.cell + " needs --first, its tree's first-stage session record"), "utf8")) as SessionRecord;
      if (f.unit !== u.id || f.model !== s.model || f.cell !== s.tree || !f.tree_patch) return smFail("E_SM_ARM", "the first-stage record is not " + s.tree + " on " + u.id + " for " + s.model + " with a tree patch");
      refuseUnscored(f);
      treePatch = readFileSync(f.tree_patch.path, "utf8");
      if (sha(treePatch) !== f.tree_patch.sha256) return smFail("E_SM_ARM", f.tree_patch.path + " is not the patch the first-stage record pins");
      treeRef = { tree: s.tree!, first_session: f.lease_id + "/" + f.cell };
    }
    treeRef ??= { tree: "S0", first_session: null };
  }
  const told = s.cell === "A3";
  if (told && !(i.qaHome && i.qaSha)) return smFail("E_SM_ARM", "A3 needs --qa-home and --qa-sha, the /qa install and its pin");
  const arms = i.registry ?? REGISTRY_PATH;
  const qaPin = told ? loadRegistry(arms).sm?.pins?.qa?.sha : undefined;
  if (told && (!qaPin || qaPin !== i.qaSha)) return smFail("E_SM_ARM", "A3 runs only once the /qa pin is recorded in registry.json sm.pins.qa and --qa-sha equals it; the pin is " + (qaPin ?? "null") + ", --qa-sha " + i.qaSha);
  const text = sessionText(u, s, s.stage === "followon" ? readFileSync(join(i.unitDir, "issue.md"), "utf8") : "", { ...(i.scope ? { scope: i.scope } : {}), ...(i.issue ? { issue: i.issue } : {}) });
  const image = buildSessionImage(u, { volume: treeVolume(u.id), stage: s.stage, ...(treePatch !== undefined ? { treePatch } : {}), ...(told ? { qaHome: i.qaHome } : {}) });
  assertContained(u.id + "/" + s.model + "/" + s.cell, containImage(image, u, i.unitDir, told ? qaPin ?? undefined : undefined));
  const task = join(i.out, "task");
  mkdirSync(join(task, "environment"), { recursive: true });
  writeFileSync(join(task, "environment/Dockerfile"), "FROM " + image.tag + "\n");
  const toml = readFileSync(join(i.unitDir, "harbor/task.toml"), "utf8").replace(/^\s*docker_image\s*=.*\n?/m, "");
  if (!/^\[environment\]$/m.test(toml)) return smFail("E_SM_ARM", "unit " + u.id + "'s harbor/task.toml has no [environment] section");
  writeFileSync(join(task, "task.toml"), toml.replace(/^\[environment\]$/m, "[environment]\ndocker_image = " + JSON.stringify(image.tag)));
  writeFileSync(join(task, "instruction.md"), text.instruction);
  const label = u.id + "/" + s.model + "/" + text.cell;
  const taskJson = join(i.out, "task.json");
  writeFileSync(taskJson, JSON.stringify({ repo_dir: u.repo_dir, commits: image.commits, base_commit: image.head, kind: "SM", scope: text.scope || smFail("E_SM_ARM", "unit " + u.id + " has no scope"), ...(told ? { qa_sha: i.qaSha, qa_home: image.qa_home!.paths } : {}) }));
  const manifest = join(i.out, "images.json");
  const manifestSha = sessionManifest(manifest, label, image);
  const armTar = join(i.out, "arm.tar");
  writeFileSync(armTar, Buffer.alloc(10240));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
  env.ANTHROPIC_API_KEY = "placeholder-not-a-key";
  env.PYTHONPATH = join(ROOT, "lanes/real-outcome/agent") + ":" + join(ROOT, "quick/laneb/runner/agent");
  env.PYTHONDONTWRITEBYTECODE = "1";
  const ak = { skip_install: "true", task_json: taskJson, arm: s.arm, arm_tar: armTar, upstream_model: s.model, arms_path: arms, control_url: i.control, ledger: "u4", task_label: label, trial_n: "1", ...(attempt === 2 ? { rerun: "fresh container after an " + "upstream or infra end" } : {}), image_id: image.image_id, manifest, manifest_sha256: manifestSha, repo_dir: u.repo_dir, workdir: u.work_dir };
  const started = Date.now();
  const h = spawnSync(i.harbor ?? "harbor", ["run", "-y", "-p", task, "-a", "real_agent:RealAgent", "-m", model, "--base-url", /^https?:\/\//.test(i.proxy) ? i.proxy : "http://" + i.proxy, ...Object.entries(ak).flatMap(([k, v]) => ["--ak", k + "=" + v]), "-e", "docker", "--extra-docker-compose", join(ROOT, "quick/laneb/runner/agent-caps.compose.yaml"), "-o", join(i.out, "jobs"), "--job-name", i.jobName ?? "sm-" + sha(label + attempt + started).slice(0, 12), "--disable-verification", "--delete"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: (s.stage === "first" ? 5400 : 3600) * 1000 + 900_000 });
  const ended = Date.now();
  writeFileSync(join(i.out, "harbor.log"), (h.stdout ?? "") + (h.stderr ?? ""));
  const ev = find(join(i.out, "jobs"), "evaluator");
  const summary = ev && existsSync(join(ev, "real-summary.json")) ? (JSON.parse(readFileSync(join(ev, "real-summary.json"), "utf8")) as Record<string, any>) : null;
  const lb = ev && existsSync(join(ev, "laneb-summary.json")) ? (JSON.parse(readFileSync(join(ev, "laneb-summary.json"), "utf8")) as Record<string, any>) : null;
  const events = ev ? lines(join(ev, "usersim-events.jsonl")) : [];
  const slot = events.find((e) => e.event === "u4_slot");
  const records = ev && existsSync(join(ev, "sdk-messages.jsonl")) ? readSession(join(ev, "sdk-messages.jsonl")) : [];
  const init = lines(ev ? join(ev, "sdk-messages.jsonl") : "").find((r) => r.type === "SystemMessage" && r.subtype === "init");
  const tools: string[] = init?.data?.tools ?? [];
  if (init && tools.some((t) => t === "WebSearch" || t === "WebFetch")) return smFail("E_SM_ARM", "the session's tools list carries a web tool: " + tools.join(", "));
  const { end, unknown_micros } = sessionEnd(summary, !summary || !slot);
  const final = summary?.final as { patch_sha256?: string } | undefined;
  const patchPath = ev ? join(ev, "final.patch") : "";
  const record: SessionRecord = {
    schema: "sm-session.v1", unit: u.id, part: s.part, index: s.index, model: s.model, cell: text.cell, stage: s.stage, tree_ref: treeRef,
    lease_id: slot?.lease_id ?? "", slot: slot?.meter_id ?? "", started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), wall_ms: ended - started,
    turns: lb?.result?.num_turns ?? null, spent_micros: typeof summary?.proxy?.spent_micros === "number" ? summary.proxy.spent_micros : null, unknown_micros, end, attempt,
    scope: text.scope_mode, questions: questionCounts(summary?.persona ?? {}), runtime_id: image.runtime_id, disallowed_tools: ["WebSearch", "WebFetch"], env: { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" },
    strip: { removed: u.strip?.removed ?? [] }, memory_loaded: memoryPaths(records), tree_patch: final?.patch_sha256 && existsSync(patchPath) ? { path: patchPath, sha256: final.patch_sha256 } : null,
    transcript: ev ? join(ev, "sdk-messages.jsonl") : "", qa_home_sha256: image.qa_home?.sha256 ?? null, exposure: s.cell === "A1" || s.cell === "S2" ? { text: textExposure(records, s.cell) } : told ? qaExposure(records) : {},
    reads: (({ inputs, gstack, drive }) => ({ inputs, gstack, drive }))(readAudit(records)),
  };
  writeSessionRecord(join(i.out, "session.json"), record);
  return { record, image, evaluator: ev, harbor_exit: h.status ?? 1 };
}
