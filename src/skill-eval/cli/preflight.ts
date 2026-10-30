// Preflight (interface v0.4, "Preflight and the vacuity check"): the free checks every paid command runs before any
// spend, and gstack-evals preflight runs alone. In order: the contract (sanity), the host, the model policy, keys by
// name, the vacuity check, the lock, the ledger and the spend cap, the PDF flag, and last the host adapter.
//
// Vacuity runs before the lock step, so an unlocked task set gets its vacuity and sanity verdict before anyone runs
// --lock, and skill-eval --lock itself refuses a set that fails them (GST-109 decision 1: a rebuilt set, such as the
// office-hours set gstack rebuilt in U12, is a new set that is checked and locked fresh; the CLI keeps no numbers
// across task sets). Every step that can run does, so one call reports every stop.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import { usd } from "../../runner/ledger/money.ts";
import { ledgerStatus } from "../../runner/ledger/ledger.ts";
import { remoteMount, type Mount, readMounts } from "../../runner/ledger/paths.ts";
import { LedgerError } from "../../runner/ledger/record.ts";
import { isInteractive, loadContract, type Contract } from "../contract/sidecar.ts";
import type { ContractTask } from "../contract/tasks.ts";
import { checkVacuity, type ShellRunner, type VacuityReport } from "../contract/vacuity.ts";
import { readSkillFiles } from "../lock/contract-lines.ts";
import { owningSkill } from "../lock/cli.ts";
import { LOCK_FILE, lockCommit, lockDrift, readLock, type Lock } from "../lock/lock.ts";
import type { GateEvidence } from "../verdict/lock.ts";
import { rederiveLock } from "../verdict/lock.ts";
import { HOST_PROVIDERS, type Call } from "./call.ts";
import { plan, type Plan } from "./dry-run.ts";
import { DEFAULT_POLICY, modelProblem, providerOf, type PolicyProvider } from "./policy.ts";

export const PROVIDER_KEYS: Record<PolicyProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY" };

export interface Stop {
  code: ReasonCode;
  message: string;
  fix?: string;
}

export interface PreflightReport {
  stops: Stop[];
  warnings: { code: ReasonCode; message: string }[];
  /** One line per step that passed. */
  passed: string[];
  contract: Contract | null;
  /** The tasks the run uses, after --tasks-only. */
  tasks: ContractTask[];
  plan: Plan | null;
  vacuity: VacuityReport | null;
  lock: { lock: Lock; commit: string; gate: GateEvidence | null } | null;
  /** Names of the variables preflight read, never their values. */
  env_names: string[];
}

export interface PreflightOptions {
  env?: Record<string, string | undefined>;
  /** --dry-run: the contract, host, policy and plan only; no key, ledger, lock or vacuity step. */
  dryRun?: boolean;
  /** The host adapter's own readiness, checked last; null when it is ready. */
  host: () => Stop | null;
  runner?: ShellRunner;
  mounts?: Mount[];
}

const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");
const show = (path: string) => {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
};

/** A task sends a PDF when its prompt, setup, check or mutant names one, or when it has a setup and its fixtures hold one. */
function pdfTasks(contract: Contract, tasks: readonly ContractTask[]): string[] {
  const hasPdf = (dir: string, depth: number): boolean =>
    readdirSync(dir).some((name) => {
      const stat = statSync(join(dir, name), { throwIfNoEntry: false });
      return (stat?.isFile() && /\.pdf$/i.test(name)) || (!!stat?.isDirectory() && depth < 3 && !name.startsWith(".") && hasPdf(join(dir, name), depth + 1));
    });
  const fixtures = hasPdf(contract.tasks.dir, 0);
  const ext = contract.ext?.sidecar?.tasks ?? {};
  return tasks.filter((t) => /\.pdf\b/i.test([t.prompt, t.setup, t.check, ext[t.id]?.mutant?.setup, ext[t.id]?.mutant?.answer].join("\n")) || (fixtures && t.setup !== undefined)).map((t) => t.id);
}

/** The exact --lock command and git steps for this call's tasks file (LOCK_MISSING). */
export function lockSteps(call: Call, contract: Contract): string[] {
  const before = call.arms.arms.find((a) => a.name === "before")!;
  const beforeDir = before.kind === "overlay" ? before.dir : null;
  const owner = owningSkill(contract.tasks.path);
  const args = ["gstack-evals", "skill-eval", "--lock", "--tasks", quote(show(contract.tasks.path))];
  if (call.ext) args.push("--ext", quote(show(call.ext)));
  if (beforeDir && beforeDir !== owner) args.push("--before", quote(show(beforeDir)));
  if (call.policy.path !== DEFAULT_POLICY) args.push("--policy", quote(show(call.policy.path)));
  const dir = quote(show(contract.tasks.dir));
  const files = [join(contract.tasks.dir, LOCK_FILE), contract.tasks.path, ...(contract.ext ? [contract.ext.path] : [])].map((p) => quote(relative(contract.tasks.dir, p).split(sep).join("/")));
  const skill = call.arms.skill?.name ?? (beforeDir ? beforeDir.split(sep).pop()! : "skill");
  return [
    "run: " + args.join(" "),
    "then: git -C " + dir + " add " + files.join(" ") + " && git -C " + dir + " commit -m " + quote("Lock the " + skill + " eval tasks"),
    ...(!beforeDir && !owner ? ["--lock also needs --before <the skill folder as it is before the edit>, since the before arm is not a folder"] : []),
  ];
}

export function preflight(call: Call, opts: PreflightOptions): PreflightReport {
  const env = opts.env ?? process.env;
  const report: PreflightReport = { stops: [], warnings: [], passed: [], contract: null, tasks: [], plan: null, vacuity: null, lock: null, env_names: [] };
  const stop = (code: ReasonCode, message: string, fix?: string) => report.stops.push({ code, message, ...(fix ? { fix } : {}) });

  const contract = loadContract(call.tasks, call.ext ?? undefined);
  if (!contract.ok) {
    stop("E_TASKS_INVALID", [...contract.tasks.problems.map((p) => show(contract.tasks.path) + ": " + p), ...(contract.ext?.problems ?? []).map((p) => show(contract.ext!.path) + ": " + p)].join("\n"));
    return report;
  }
  report.contract = contract;
  const all = contract.tasks.tasks;
  const unknown = (call.tasksOnly ?? []).filter((id) => !all.some((t) => t.id === id));
  if (unknown.length) stop("E_USAGE", "--tasks-only names tasks the tasks file lacks: " + unknown.join(", "));
  const tasks = call.tasksOnly ? all.filter((t) => call.tasksOnly!.includes(t.id)) : all;
  report.tasks = tasks;
  const ext = contract.ext?.sidecar?.tasks ?? {};
  const interactive = tasks.filter((t) => isInteractive(ext[t.id])).map((t) => t.id);
  const judged = tasks.some((t) => ext[t.id]?.judge !== undefined);
  report.passed.push("contract: " + tasks.length + " tasks (" + tasks.filter((t) => t.safety).length + " safety, " + interactive.length + " interactive)" + (contract.ext ? " with " + show(contract.ext.path) : ""));

  if (call.host === "codex" && interactive.length) {
    const others = tasks.filter((t) => !interactive.includes(t.id)).map((t) => t.id);
    stop("E_INTERACTIVE_HOST", "--host codex runs only non-interactive tasks in v1; these tasks are declared interactive: " + interactive.join(", "), "Use --host claude, or " + (others.length ? "--tasks-only " + others.join(",") : "drop the interactive tasks (no task would be left)") + ". Do not --resume.");
  }
  const subjects = call.models.map((m) => ({ model: m, provider: providerOf(call.policy, m) }));
  const offHost = subjects.filter((s) => s.provider && !HOST_PROVIDERS[call.host].includes(s.provider));
  if (offHost.length) stop("E_USAGE", "--host " + call.host + " runs " + HOST_PROVIDERS[call.host].join(" and ") + " models; " + offHost.map((s) => s.model + " is " + s.provider).join(", "));

  const policy: string[] = call.models.flatMap((m) => modelProblem(call.policy, m, "subject", { smoke: call.smoke }) ?? []);
  const judgeProvider = providerOf(call.policy, call.judgeModel);
  const judgeProblem = modelProblem(call.policy, call.judgeModel, "judge", { smoke: call.smoke });
  if (judgeProblem) policy.push(judgeProblem);
  else if (subjects.some((s) => s.provider === judgeProvider)) policy.push(call.judgeModel + " as the judge: judges come from another model family than the models under test (" + subjects.filter((s) => s.provider === judgeProvider).map((s) => s.model).join(", ") + ")");
  if (interactive.length) policy.push(...(modelProblem(call.policy, call.usersimModel, "usersim", { smoke: call.smoke }) ?? []));
  if (policy.length) stop("E_MODEL_POLICY", policy.join("\n"));
  else report.passed.push("policy: " + call.models.join(", ") + " under " + call.policy.policy.name + " (sha256 " + call.policy.sha256.slice(0, 12) + ")");

  report.plan = plan(call, tasks.map((t) => ({ id: t.id, judge: ext[t.id]?.judge !== undefined, interactive: interactive.includes(t.id), timeout_s: ext[t.id]?.timeout_s ?? call.timeoutS })));
  if (opts.dryRun) return report;

  const providers = new Set<PolicyProvider>(subjects.flatMap((s) => (s.provider ? [s.provider] : [])));
  if (judged && judgeProvider) providers.add(judgeProvider);
  const usersimProvider = providerOf(call.policy, call.usersimModel);
  if (interactive.length && usersimProvider) providers.add(usersimProvider);
  const keys = [...providers].map((p) => PROVIDER_KEYS[p]);
  report.env_names.push(...keys);
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) stop("E_KEY_MISSING", "not set: " + missing.join(", ") + " (the run needs " + keys.join(", ") + "; values are never printed)");
  else report.passed.push("keys: " + keys.join(", ") + " set (checked by name)");

  if (call.isolation === "docker" && !opts.runner) {
    stop("E_ISOLATION_UNSAFE", "the vacuity check runs each task's setup, mutant and check; under --isolation docker they need the container runner U9 builds, which is not built yet, so preflight did not run them", "Pass --isolation process to run the controls as this user with the trial's env allowlist; the verdict records it.");
  } else {
    const vacuity = checkVacuity({ tasks, dir: contract.tasks.dir, sidecar: ext }, opts.runner ? { runner: opts.runner } : {});
    report.vacuity = vacuity;
    for (const s of vacuity.stops) stop(s.code, s.message);
    report.warnings.push(...vacuity.warnings);
    if (!vacuity.stops.length) report.passed.push("vacuity: " + vacuity.results.filter((r) => r.status === "ok").length + " tasks bite on their control, " + vacuity.results.filter((r) => r.status === "negative_unvalidated").length + " safety tasks without a mutant" + (opts.runner ? "" : " (controls ran as this user with the env allowlist, --isolation process)"));
  }

  const lockPath = join(contract.tasks.dir, LOCK_FILE);
  const committed = lockCommit(lockPath, [contract.tasks.path, ...(contract.ext ? [contract.ext.path] : [])]);
  if (!committed.ok) stop("LOCK_MISSING", ["no lock committed and clean at HEAD for " + show(contract.tasks.path) + ": " + committed.reason, ...lockSteps(call, contract)].join("\n"));
  else {
    const read = readLock(lockPath);
    if (!read.lock) stop("LOCK_DRIFT", read.problem!);
    else {
      const policyPin = { path: call.policy.path, sha256: call.policy.sha256 };
      const [before, after] = ["before", "after"].map((n) => call.arms.arms.find((a) => a.name === n)!);
      const folder = (arm: typeof before) => (arm.kind === "overlay" && arm.dir ? readSkillFiles(arm.dir) : null);
      const [beforeFiles, afterFiles] = [folder(before), folder(after)];
      const evidence = beforeFiles ? { lockPath, lock: read.lock, tasks: contract.tasks, ext: contract.ext, policy: policyPin, before: beforeFiles, after: afterFiles ?? [] } : null;
      const gate: GateEvidence | null = evidence && afterFiles ? evidence : null;
      const drift = evidence ? rederiveLock(evidence).drift : lockDrift(read.lock, { tasks: contract.tasks, ext: contract.ext, policySha256: call.policy.sha256 });
      if (drift.length) stop("LOCK_DRIFT", drift.join("\n"));
      else {
        report.lock = { lock: read.lock, commit: committed.commit, gate };
        report.passed.push("lock: " + show(lockPath) + " committed at " + committed.commit.slice(0, 12) + ", " + read.lock.lines.length + " contract lines, no drift");
      }
    }
  }

  if (call.spendCap === null) stop("E_USAGE", "--spend-cap is required on a call that can spend; the dry-run matrix is below. The CLI never suggests a cap.");
  if (call.item === null) stop("E_USAGE", "--item (or GSTACK_EVALS_ITEM) must name the ledger line item this run spends from; it is never implied");
  const remote = remoteMount(call.ledger.path, opts.mounts ?? readMounts());
  if (remote) stop("E_LEDGER_PATH", "the local ledger " + call.ledger.path + " (" + call.ledger.rule + ") is on a " + remote + " mount");
  if (call.item !== null) {
    let status;
    try {
      status = ledgerStatus(call.record.path, call.item)[0];
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      stop(error.code, error.message);
    }
    if (status === undefined || status.cap_micros === null) {
      if (!report.stops.some((s) => s.code === "E_LEDGER_RECORD")) stop("E_LEDGER_MISSING", "no approved cap is on record for line item " + call.item + " in " + call.record.path + " (" + call.record.rule + "). Escalate: a human approves a cap and records it with their exact words; on Capy, ask your Captain through a needs-you report.");
    } else if (call.spendCap !== null) {
      const approval = status.approval!;
      const words = approval.quotes.map((q) => JSON.stringify(q.words) + " (" + q.by + ", " + q.source + ")").join("; ");
      if (call.spendCap > status.cap_micros) stop("E_LEDGER_MISSING", "--spend-cap " + usd(call.spendCap) + " is above the approved cap of " + usd(status.cap_micros) + " for line item " + call.item + " (" + words + "). Escalate for a higher cap (gstack-evals ledger raise with the owner's words), or lower --spend-cap.");
      else if (call.spendCap > status.left_micros) stop("E_LEDGER_MISSING", "--spend-cap " + usd(call.spendCap) + " is above the " + usd(status.left_micros) + " left on line item " + call.item + " (cap " + usd(status.cap_micros) + ", " + usd(status.committed_micros) + " committed).");
      else if (status.run_id !== null) stop("E_ITEM_BOUND", "line item " + call.item + " is bound to run " + status.run_id + "; each line item funds one run");
      else report.passed.push("ledger: line item " + call.item + " approved at " + usd(status.cap_micros) + " (" + words + "); --spend-cap " + usd(call.spendCap) + " is within it");
    }
  }
  if (call.spendCap !== null && report.plan.round !== null && call.spendCap < report.plan.round) stop("E_CAP_TOO_LOW", "--spend-cap " + usd(call.spendCap) + " is below one arm-balanced round, " + usd(report.plan.round) + " at the session allowance; read the worst case in parts with --dry-run");

  const pdf = pdfTasks(contract, tasks);
  if (pdf.length) report.warnings.push({ code: "PDF_INPUT", message: "these tasks may send a PDF, which the metering proxy reserves loosely when it is inline base64: " + pdf.join(", ") });

  const host = opts.host();
  if (host) report.stops.push(host);
  else report.passed.push("host: " + call.host + " adapter ready");
  return report;
}

/** gstack-evals preflight: the call's flags, the same steps as a paid call, and no run. */
export async function main(argv: string[]): Promise<number> {
  const { skillEvalCommand } = await import("./skill-eval.ts");
  return skillEvalCommand(argv, undefined, process.env, "preflight");
}
