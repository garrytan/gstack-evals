// gstack-evals doctor (interface v0.4, Quickstart and Spend and ledger): keyless checks of this machine before a run.
// Bun, the Docker daemon, the host CLIs, keys by name (never their values), both ledger paths with the rule that chose
// each, and gstack-approvals' presence and version. The trial image and its digest are U9's; doctor says so and skips it.
// Every check prints one line on stdout (ok, warn or skip); a failing check also prints its code lines on stderr, and
// doctor then exits 2.
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Io } from "../../cli.ts";
import type { ReasonCode } from "../../errors/codes.ts";
import { approvalsBin } from "../../runner/ledger/approvals.ts";
import { ledgerStatus } from "../../runner/ledger/ledger.ts";
import { ledgerPath, readMounts, recordPath, remoteMount, type Mount } from "../../runner/ledger/paths.ts";
import { LedgerError } from "../../runner/ledger/record.ts";
import type { Host } from "../../types.ts";
import { codeLines, consoleIo } from "../contract/cli-io.ts";
import { HOST_PROVIDERS } from "./call.ts";
import { flagHelp, parseFlags, SKILL_EVAL_FLAGS } from "./flags.ts";
import { DEFAULT_POLICY, loadPolicy } from "./policy.ts";
import { PROVIDER_KEYS } from "./preflight.ts";

type Env = Record<string, string | undefined>;
export type Runner = (command: string, args: string[]) => { status: number | null; stdout: string; stderr: string };

export interface Check {
  name: string;
  status: "ok" | "warn" | "skip" | "fail";
  detail: string;
  code?: ReasonCode;
  fix?: string;
}

export interface DoctorOptions {
  env: Env;
  hosts: Host[];
  ledger?: string;
  record?: string;
  run?: Runner;
  mounts?: Mount[];
}

const DOCTOR_FLAGS = SKILL_EVAL_FLAGS.filter((f) => ["--host", "--ledger", "--ledger-record", "--json", "--help"].includes(f.name));
const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";
const localRun: Runner = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 15_000 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error.message) : "") };
};

/** Why SQLite could not open or create the ledger file here, or null: it must not be a directory, and its directory (or the nearest one that exists) must take new files, since SQLite writes its WAL files beside it. */
function ledgerFileProblem(path: string): string | null {
  if (existsSync(path)) {
    if (statSync(path).isDirectory()) return "is a directory, not a SQLite file";
    try {
      accessSync(path, constants.R_OK | constants.W_OK);
    } catch {
      return "exists but is not readable and writable by this user";
    }
  }
  let dir = dirname(resolve(path));
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  try {
    accessSync(dir, constants.W_OK | constants.X_OK);
    return null;
  } catch {
    return "cannot be created or opened: " + dir + " is not writable by this user";
  }
}

export function doctorChecks(opts: DoctorOptions): Check[] {
  const run = opts.run ?? localRun;
  const env = opts.env;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add({ name: "bun", status: "ok", detail: process.versions.bun ?? "not Bun: " + process.version });

  const docker = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (docker.status === 0) add({ name: "docker", status: "ok", detail: "daemon " + firstLine(docker.stdout) });
  else add({ name: "docker", status: "fail", code: "E_ISOLATION_UNSAFE", detail: "no Docker daemon answered docker version" + (firstLine(docker.stderr) ? ": " + firstLine(docker.stderr) : "") });
  add({ name: "trial image", status: "skip", detail: "the image build and its digest land with U9's trial module" });

  for (const host of opts.hosts) {
    const cli = run(host, ["--version"]);
    if (cli.status === 0) add({ name: host + " CLI", status: "ok", detail: firstLine(cli.stdout) || "--version exited 0" });
    else add({ name: host + " CLI", status: "fail", code: "E_HOST_CLI", detail: host + " --version " + (cli.status === null ? "did not run" : "exited " + cli.status) + (firstLine(cli.stderr) ? ": " + firstLine(cli.stderr) : "") });
  }

  const loaded = loadPolicy(DEFAULT_POLICY);
  const defaults = "policy" in loaded ? loaded.policy.defaults : null;
  for (const host of opts.hosts) {
    const [subject, ...others] = HOST_PROVIDERS[host];
    const key = PROVIDER_KEYS[subject!];
    if (env[key]) add({ name: host + " key", status: "ok", detail: key + " set (checked by name)" });
    else add({ name: host + " key", status: "fail", code: "E_KEY_MISSING", detail: key + " is not set; every " + host + " run needs it" });
    const optional = new Map<string, string>();
    for (const p of others) optional.set(PROVIDER_KEYS[p], p + " models under test");
    const judge = defaults?.judge[subject!];
    const judgeProvider = judge && "policy" in loaded ? loaded.policy.models[judge]?.provider : undefined;
    if (judgeProvider) optional.set(PROVIDER_KEYS[judgeProvider], (optional.has(PROVIDER_KEYS[judgeProvider]) ? optional.get(PROVIDER_KEYS[judgeProvider]) + ", " : "") + "the default judge " + judge);
    for (const [name, use] of optional) add({ name: host + " key", status: env[name] ? "ok" : "warn", detail: name + (env[name] ? " set" : " not set") + " (" + use + ")" });
  }

  const ledger = ledgerPath(opts.ledger, env);
  const remote = remoteMount(ledger.path, opts.mounts ?? readMounts());
  if (remote) add({ name: "ledger", status: "fail", code: "E_LEDGER_PATH", detail: ledger.path + " (" + ledger.rule + ") is on a " + remote + " mount; the local ledger must sit on a local disk" });
  else {
    const problem = ledgerFileProblem(ledger.path);
    if (problem) add({ name: "ledger", status: "fail", code: "E_LEDGER_PATH", detail: ledger.path + " (" + ledger.rule + ") " + problem });
    else add({ name: "ledger", status: "ok", detail: ledger.path + " (" + ledger.rule + ")" });
  }

  const record = recordPath(opts.record, env);
  try {
    const items = existsSync(record.path) ? ledgerStatus(record.path) : [];
    add({ name: "ledger record", status: "ok", detail: record.path + " (" + record.rule + "), " + (items.length ? items.length + " line item" + (items.length > 1 ? "s" : "") : "no line items yet") });
  } catch (error) {
    add({ name: "ledger record", status: "fail", code: error instanceof LedgerError ? error.code : "E_LEDGER_RECORD", detail: record.path + " (" + record.rule + "): " + (error as Error).message });
  }

  const bin = approvalsBin(env);
  if (!bin || !existsSync(bin)) add({ name: "gstack-approvals", status: "fail", code: "E_APPROVAL_RECORD", detail: (bin ? bin + " does not exist" : "not found (GSTACK_EVALS_APPROVALS_BIN, PATH or ~/.local/share/gstack/bin)") + "; ledger init and raise mirror approvals through it" });
  else {
    const versionFile = resolve(dirname(bin), "..", "VERSION");
    add({ name: "gstack-approvals", status: "ok", detail: bin + ", gstack " + (existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "version unknown (no VERSION beside its bin directory)") });
  }
  return checks;
}

export async function doctorCommand(argv: string[], io: Io = consoleIo, env: Env = process.env, run?: Runner): Promise<number> {
  const parsed = parseFlags(argv, DOCTOR_FLAGS, env);
  if (typeof parsed === "string") {
    io.err(codeLines("E_USAGE", ["doctor: " + parsed], "gstack-evals doctor --help shows its flags."));
    return 2;
  }
  if (parsed.values.has("--help")) {
    io.out("Usage: gstack-evals doctor [--host claude|codex] [--ledger <path>] [--ledger-record <dir>] [--json]\n\nKeyless checks of this machine: Bun, Docker, the host CLI, keys by name, both ledger paths and gstack-approvals. Without --host it checks both hosts.\n\n" + flagHelp(DOCTOR_FLAGS));
    return 0;
  }
  const host = parsed.values.get("--host") as Host | undefined;
  const fromFlag = (name: string) => (parsed.from.get(name) === "flag" ? (parsed.values.get(name) as string) : undefined);
  const checks = doctorChecks({ env, hosts: host ? [host] : ["claude", "codex"], ledger: fromFlag("--ledger"), record: fromFlag("--ledger-record"), ...(run ? { run } : {}) });
  const failed = checks.filter((c) => c.status === "fail");
  if (parsed.values.has("--json")) io.out(JSON.stringify({ ok: failed.length === 0, checks }));
  else {
    io.out(checks.map((c) => (c.status === "fail" ? "FAIL" : c.status) + " " + c.name + ": " + c.detail).join("\n"));
    for (const c of failed) io.err(codeLines(c.code!, ["doctor: " + c.name + ": " + c.detail], c.fix));
  }
  return failed.length ? 2 : 0;
}

export const main = (argv: string[]): Promise<number> => doctorCommand(argv);
