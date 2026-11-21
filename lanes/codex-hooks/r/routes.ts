// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's route table (preregistration section 4.4, pre-run change 1 sections 3 and 4), keyless. For each of B1's 62 prompts
// as the rig sends them (B1b's promptOf: the wrapper, the instruction and the closing line), the registered UserPromptSubmit
// command of the r-on arm's home runs on a Codex 0.170 payload, and the row records what its line names and where it puts
// prove-it. Then the pilot candidates (change 1 section 4): hm-screened.txt's tasks in the 62's repositories and not among
// them, in L1's seeded order, each routed the same way and never counted toward the gate. Ported from the pin check's
// routes.ts; its output is change 1's route-table.tsv byte for byte (ROUTE_TABLE_SHA256).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promptOf } from "../../delivery-route/b1b.ts";
import { drawnTasks, loadBundle } from "../../delivery-route/pins.ts";
import { L1, seeded } from "../../../quick/laneb/l1/l1.ts";
import { MODEL, PILOT_TASKS, R, REPO, ROUTE_TABLE_SHA256, sha256 } from "./pins.ts";

export const HEADER = "kind\ttask\tprompt_sha256\tmatches_b1b\tchars\tnamed\tprove_it_position\ttrigger\tline_sha256";
export type Position = "alone" | "first of two" | "second of two" | "not named";
export type RouteRow = { kind: "run" | "smoke" | "candidate"; task: string; prompt_sha256: string; matches_b1b: string; chars: number; named: string; position: Position; trigger: string; line_sha256: string };

/** What a routing line names, in order, and prove-it's place in it. */
export function namedBy(line: string): { named: string[]; position: Position } {
  const two = /fits the ([\w-]+) or ([\w-]+) skill/.exec(line), one = /fits the ([\w-]+) skill\./.exec(line);
  const named = two ? [two[1]!, two[2]!] : one ? [one[1]!] : [];
  const position: Position = !named.includes("prove-it") ? "not named" : named.length === 1 ? "alone" : named[0] === "prove-it" ? "first of two" : "second of two";
  return { named, position };
}

/** One prompt through the home's registered UserPromptSubmit command, as Codex 0.170 hands it the payload. */
export function route(home: string, task: string, prompt: string) {
  const codexHome = join(home, ".codex");
  const command = JSON.parse(readFileSync(join(codexHome, "hooks.json"), "utf8")).hooks.UserPromptSubmit[0].hooks[0].command as string;
  const payload = { session_id: "geva562-route-" + sha256(task).slice(0, 12), turn_id: "t1", transcript_path: null, cwd: "/app", hook_event_name: "UserPromptSubmit", model: MODEL, permission_mode: "bypassPermissions", prompt };
  const r = spawnSync(command, [], { input: JSON.stringify(payload), encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: codexHome } });
  let line = "";
  try { line = JSON.parse(r.stdout || "{}").hookSpecificOutput?.additionalContext ?? ""; } catch { line = "UNPARSED " + (r.stdout || "").slice(0, 80); }
  const { named, position } = namedBy(line);
  const trig = /matched the installed ([\w-]+) trigger "([^"]*)"/.exec(line);
  return { prompt_sha256: sha256(prompt), chars: prompt.length, named: named.join("+") || "-", position, trigger: trig ? trig[2]! : "", line_sha256: line ? sha256(line) : "-", exit: r.status };
}

/** The table's rows and text, the gate's count and the pilot's four extra tasks. */
export function routeTable(exportDir: string, home: string) {
  if (!existsSync(join(home, ".codex/hooks.json"))) throw new Error("E_USAGE codex-hooks r routes: " + home + "/.codex/hooks.json does not exist; pass the r-on arm's home");
  const instruction = (task: string) => readFileSync(join(exportDir, task, "instruction.md"), "utf8");
  const b1b = new Map(readFileSync(join(REPO, "wiki/plans/2026-11-18-capy-b1b-prose-route-prereg/route-table.tsv"), "utf8").trim().split("\n").slice(1).map((l) => { const c = l.split("\t"); return [c[1]!, c[2]!]; }));
  const t = drawnTasks(loadBundle());
  const rows: RouteRow[] = [];
  for (const [kind, list] of [["run", t.run], ["smoke", t.smoke]] as const) for (const task of list) {
    const x = route(home, task, promptOf(instruction(task)));
    rows.push({ kind, task, prompt_sha256: x.prompt_sha256, matches_b1b: String(b1b.get(task) === x.prompt_sha256), chars: x.chars, named: x.named, position: x.position, trigger: x.trigger, line_sha256: x.line_sha256 });
  }
  const repoOf = new Map<string, string>((JSON.parse(readFileSync(join(REPO, "quick/laneb/tasks/swerebench-r3a4.json"), "utf8")).tasks as { task_id: string; repo: string }[]).map((x) => [x.task_id, x.repo.toLowerCase()]));
  const ours = new Set([...t.run, ...t.smoke]);
  const repos = new Set([...ours].map((x) => repoOf.get(x)));
  const screened = readFileSync(join(REPO, "wiki/plans/2026-11-17-geva-547-delivery-route-prereg/hm-screened.txt"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/)[1]!);
  const candidates = screened.filter((x) => !ours.has(x) && repos.has(repoOf.get(x)));
  const pilot: string[] = [];
  for (const task of seeded([{ tasks: candidates, arms: [], attempts: 1 }], L1.seed)[0]!.tasks) {
    const x = route(home, task, promptOf(instruction(task)));
    if (x.position !== "not named" && pilot.length < 4) pilot.push(task);
    rows.push({ kind: "candidate", task, prompt_sha256: x.prompt_sha256, matches_b1b: "-", chars: x.chars, named: x.named, position: x.position, trigger: x.trigger, line_sha256: x.line_sha256 });
  }
  const text = [HEADER, ...rows.map((r) => [r.kind, r.task, r.prompt_sha256, r.matches_b1b, r.chars, r.named, r.position, r.trigger, r.line_sha256].join("\t"))].join("\n") + "\n";
  const run = rows.filter((r) => r.kind === "run");
  const tally: Record<string, number> = {};
  for (const r of run) tally[r.position] = (tally[r.position] ?? 0) + 1;
  const covered = run.filter((r) => r.position !== "not named").length;
  return { rows, text, tally, covered, gate: covered >= R.gate ? "clears" : "holds", pilot, candidates: candidates.length };
}

/** A route table's rows from its TSV text, as the session table and the report read them. */
export function readRouteTable(text: string): RouteRow[] {
  const lines = text.split("\n").filter(Boolean);
  if (lines[0] !== HEADER) throw new Error("E_USAGE codex-hooks r: a route table starts with its header line");
  return lines.slice(1).map((l) => {
    const c = l.split("\t");
    return { kind: c[0] as RouteRow["kind"], task: c[1]!, prompt_sha256: c[2]!, matches_b1b: c[3]!, chars: Number(c[4]), named: c[5]!, position: c[6] as Position, trigger: c[7]!, line_sha256: c[8]! };
  });
}

/** The committed route table (change 1's attachment, copied beside this file), checked against its digest. */
export function frozenRouteTable(): RouteRow[] {
  const text = readFileSync(join(REPO, "lanes/codex-hooks/r/route-table.tsv"), "utf8");
  if (sha256(text) !== ROUTE_TABLE_SHA256) throw new Error("E_CODEX_R_PIN lanes/codex-hooks/r/route-table.tsv hashes to " + sha256(text) + ", not change 1's " + ROUTE_TABLE_SHA256);
  return readRouteTable(text);
}

/** The covered tasks: the run tasks the table names prove-it on, in any position. */
export const coveredTasks = (rows: RouteRow[]) => rows.filter((r) => r.kind === "run" && r.position !== "not named").map((r) => r.task);

export function checkPilot(pilot: string[]) {
  const want = PILOT_TASKS.slice(2);
  if (pilot.join() !== want.join()) throw new Error("E_CODEX_R_PIN the route table's first four covered candidates are " + pilot.join(", ") + ", not change 1's " + want.join(", "));
}
