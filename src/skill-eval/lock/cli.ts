// U5's two skill-eval steps, as functions U7's skill-eval command calls with the remaining arguments:
//   gstack-evals skill-eval --lock --tasks <tasks.json> [--ext <file>] [--before <skill dir>] [--policy <models.json>]
//   gstack-evals skill-eval init --skill <dir> [--out <tasks.json>] [--force]
// Without --before, --lock reads the skill folder that owns the tasks file in gstack's layout:
// <root>/test/fixtures/skill-evals/<skill>/tasks.json belongs to <root>/<skill>/. init writes there by default.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, type Io } from "../../cli.ts";
import { codeLines, consoleIo, parseFlags, usage } from "../contract/cli-io.ts";
import { loadContract } from "../contract/sidecar.ts";
import { checkTasks, KEBAB_ID, type ContractTask } from "../contract/tasks.ts";
import { contractLines, readSkillFiles } from "./contract-lines.ts";
import { buildLock, LOCK_FILE, readLock, writeLock } from "./lock.ts";

const LOCK_HELP = "gstack-evals skill-eval --lock --tasks <tasks.json> [--ext <tasks.ext.json>] [--before <skill dir>] [--policy <models.json>]";
const INIT_HELP = "gstack-evals skill-eval init --skill <dir> [--out <tasks.json>] [--force]";
const FIXTURES = ["test", "fixtures", "skill-evals"];

const show = (path: string) => {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
};

/** The skill folder that owns a tasks file in gstack's layout, or null. */
export function owningSkill(tasksPath: string): string | null {
  const parts = resolve(tasksPath).split(sep);
  const at = parts.length - 2 - FIXTURES.length;
  if (at < 1 || FIXTURES.some((p, i) => parts[at + i] !== p)) return null;
  const dir = [...parts.slice(0, at), parts[parts.length - 2]!].join(sep);
  return existsSync(join(dir, "SKILL.md")) ? dir : null;
}

export async function lockCommand(argv: string[], io: Io = consoleIo): Promise<number> {
  const parsed = parseFlags(argv, ["--tasks", "--ext", "--before", "--policy"], ["--help", "-h"]);
  if (typeof parsed === "string") return usage(io, "skill-eval --lock: " + parsed, LOCK_HELP);
  if (parsed.set.has("--help") || parsed.set.has("-h")) return (io.out("Usage: " + LOCK_HELP), 0);
  const tasksFile = parsed.values.get("--tasks");
  if (!tasksFile) return usage(io, "skill-eval --lock: --tasks is required", LOCK_HELP);
  const contract = loadContract(tasksFile, parsed.values.get("--ext"));
  if (!contract.ok) {
    io.err(codeLines("E_TASKS_INVALID", [...contract.tasks.problems.map((p) => show(contract.tasks.path) + ": " + p), ...(contract.ext?.problems ?? []).map((p) => show(contract.ext!.path) + ": " + p)]));
    return 2;
  }
  const beforeDir = parsed.values.get("--before") ?? owningSkill(contract.tasks.path);
  if (!beforeDir) return usage(io, "skill-eval --lock: the tasks file is not in a skill repo's test/fixtures/skill-evals/<skill>/, so name the skill folder as it is before the edit", LOCK_HELP.replace("[--before <skill dir>]", "--before <skill dir>"));
  if (!existsSync(join(beforeDir, "SKILL.md"))) return usage(io, "skill-eval --lock: " + beforeDir + " holds no SKILL.md", LOCK_HELP);
  const policyPath = parsed.values.get("--policy") ?? (existsSync(join(REPO_ROOT, "policy", "models.json")) ? join(REPO_ROOT, "policy", "models.json") : null);
  if (policyPath !== null && !existsSync(policyPath)) return usage(io, "skill-eval --lock: no policy file at " + policyPath, LOCK_HELP);
  const lockPath = join(contract.tasks.dir, LOCK_FILE);
  let previous = null;
  if (existsSync(lockPath)) {
    const read = readLock(lockPath);
    if (!read.lock) {
      io.err(codeLines("LOCK_DRIFT", [read.problem!, "Its coverage claims cannot be carried, so --lock will not overwrite it."], "Restore the lock from git, or delete it on purpose and claim its lines again."));
      return 2;
    }
    previous = read.lock;
  }
  const before = readSkillFiles(beforeDir);
  const policy = policyPath === null ? null : { path: policyPath, sha256: createHash("sha256").update(readFileSync(policyPath)).digest("hex") };
  const { lock, carried, dropped } = buildLock({ lockPath, tasks: contract.tasks, ext: contract.ext, policy, skillName: basename(resolve(beforeDir)), before, previous });
  writeLock(lockPath, lock);
  const claimed = lock.lines.filter((l) => l.tasks.length).length;
  const short = (s: string | undefined) => (s ? s.slice(0, 12) : "none");
  const files = [lockPath, contract.tasks.path, ...(contract.ext ? [contract.ext.path] : [])].map(show);
  io.out(
    [
      "LOCKED " + show(lockPath) + ": tasks " + short(lock.tasks.sha256) + ", ext " + short(lock.ext?.sha256) + ", policy " + short(lock.policy?.sha256),
      lock.lines.length + " contract lines from " + lock.skill.name + " (" + before.length + " files): " + claimed + " claimed by a task, " + (lock.lines.length - claimed) + " unclaimed and uncovered until a task claims them.",
      ...(previous ? ["Kept " + carried + " claims from the previous lock" + (dropped.length ? "; dropped " + dropped.length + " whose task left the tasks file: " + dropped.join(", ") : "") + "."] : []),
      "To claim a line, add the covering task ids to its tasks list in the lock and run --lock again.",
      "Then commit the lock before you edit the skill:",
      "  git add " + files.join(" ") + " && git commit -m " + JSON.stringify("Lock the " + lock.skill.name + " eval tasks"),
    ].join("\n"),
  );
  return 0;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");

/** One failing safety stub per heading that holds contract lines, so every line belongs to exactly one stub. */
export function scaffold(skillDir: string): { tasks: ContractTask[]; lines: number } {
  const lines = contractLines(readSkillFiles(skillDir));
  const groups = new Map<string, typeof lines>();
  for (const l of lines) groups.set(l.file + "\n" + l.heading, [...(groups.get(l.file + "\n" + l.heading) ?? []), l]);
  const used = new Set<string>();
  const tasks = [...groups.values()].map((group): ContractTask => {
    const { file, heading } = group[0]!;
    const where = heading ? JSON.stringify(heading) + " in " + file : "the top of " + file;
    const base = "keeps-" + (slug(file.replace(/^sections\//, "").replace(/\.md$/, "") + "-" + heading) || "line");
    let id = base;
    for (let n = 2; used.has(id) || !KEBAB_ID.test(id); n++) id = base + "-" + n;
    used.add(id);
    const ids = group.map((l) => l.id);
    return {
      id,
      prompt: "TODO: one request that reaches " + where + " and tempts the agent to break one of its " + group.length + " contract lines (" + ids.slice(0, 3).join(", ") + (ids.length > 3 ? ", ..." : "") + ").",
      check: "echo 'TODO: write the check for " + id + "; it fails until you do' >&2; exit 1",
      safety: true,
    };
  });
  return { tasks, lines: lines.length };
}

export async function initCommand(argv: string[], io: Io = consoleIo): Promise<number> {
  const parsed = parseFlags(argv, ["--skill", "--out"], ["--force", "--help", "-h"]);
  if (typeof parsed === "string") return usage(io, "skill-eval init: " + parsed, INIT_HELP);
  if (parsed.set.has("--help") || parsed.set.has("-h")) return (io.out("Usage: " + INIT_HELP), 0);
  const skillDir = parsed.values.get("--skill");
  if (!skillDir) return usage(io, "skill-eval init: --skill is required", INIT_HELP);
  if (!existsSync(join(skillDir, "SKILL.md"))) return usage(io, "skill-eval init: " + skillDir + " holds no SKILL.md", INIT_HELP);
  const name = basename(resolve(skillDir));
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: skillDir, encoding: "utf8" });
  const out = resolve(parsed.values.get("--out") ?? (top.status === 0 ? join(top.stdout.trim(), ...FIXTURES, name, "tasks.json") : "tasks.json"));
  if (existsSync(out) && !parsed.set.has("--force")) return usage(io, "skill-eval init: " + show(out) + " exists; pass --force to replace it, or --out for another path", INIT_HELP);
  const { tasks, lines } = scaffold(skillDir);
  if (!tasks.length) return usage(io, "skill-eval init: " + skillDir + " has no contract lines (MUST, NEVER, STOP, ask, approval or output lines) to stub", INIT_HELP);
  const problems = checkTasks(tasks, dirname(out));
  if (problems.length) throw new Error("init built a tasks file the contract refuses: " + problems.join("; "));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(tasks, null, 2) + "\n");
  io.out(
    [
      "WROTE " + show(out) + ": " + tasks.length + " safety stubs, one per heading, covering the " + lines + " contract lines of " + name + ".",
      "Each stub fails until you write its prompt and check, and warns NEGATIVE_UNVALIDATED until it gets a mutant in tasks.ext.json.",
      "Next: edit or drop the stubs, run gstack-evals validate --tasks " + show(out) + ", then gstack-evals skill-eval --lock --tasks " + show(out) + ", and commit both before you edit the skill.",
    ].join("\n"),
  );
  return 0;
}
