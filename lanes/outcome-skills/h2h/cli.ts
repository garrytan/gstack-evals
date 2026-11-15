// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals h2h: the skill-pack head-to-head's commands (wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg). Each
// build part exports `commands` from lanes/outcome-skills/h2h/<dir>/commands.ts; COMMAND_MODULES lists the ones this
// dispatcher loads, and a part is wired by adding its path there. rerun is the dispatcher's own command (rerun.ts), and
// RERUN_RUNNER is part S's session runner (sessions/rerunner.ts). Every refusal prints its reason code first.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode } from "../../../src/errors/codes.ts";
import { H2hError, h2hFail } from "./prereg.ts";
import { rerun, type RerunRunner } from "./rerun.ts";
import { sessionRunner } from "./sessions/rerunner.ts";

export type Command = (argv: string[]) => Promise<number>;

/** Part modules, relative to this file. Add a part's "./<dir>/commands.ts" here to wire it. */
export const COMMAND_MODULES = ["./ordinary/commands.ts", "./arms/commands.ts", "./sessions/commands.ts", "./score/commands.ts", "./analysis/commands.ts"];
/** Part S's session runner for rerun; null would make rerun refuse with E_H2H_RERUN_UNWIRED. */
export const RERUN_RUNNER: RerunRunner | null = sessionRunner();

/** Process exit codes by reason code; every other refusal exits 2. rerun's are section 12's. */
export const EXIT: Record<string, number> = { E_H2H_RERUN_PRECONDITION: 3, E_H2H_RERUN_UNWIRED: 3, E_H2H_RERUN_CAP_STOP: 10, E_H2H_RERUN_CONTAINMENT: 12 };

export async function loadCommands(modules: readonly string[] = COMMAND_MODULES): Promise<Record<string, Command>> {
  const all: Record<string, Command> = { rerun: (argv) => rerun(argv, RERUN_RUNNER) };
  for (const m of modules) {
    if (!existsSync(join(import.meta.dir, m))) continue;
    const cmds = ((await import(m)) as { commands?: Record<string, Command> }).commands ?? {};
    for (const [name, fn] of Object.entries(cmds)) {
      if (all[name]) h2hFail("E_USAGE", "two h2h parts both export the command " + name + " (" + m + ")");
      all[name] = fn;
    }
  }
  return all;
}

const HELP = (names: string[]) => "Usage: gstack-evals h2h <command> [options]\nCommands: " + names.sort().join(", ") + "\nEach command takes --help. Plan: wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/README.md.";

/** A refusal as lines that each start with the code, then its fix and docs anchor. */
export function refusal(e: unknown): { code: string; text: string } {
  const message = e instanceof Error ? e.message : String(e);
  const code = e instanceof H2hError ? e.code : (message.match(/^(E_[A-Z0-9_]+|CAP_STOP)\b/)?.[1] ?? "E_INTERNAL");
  const body = e instanceof H2hError || message.startsWith(code) ? message.slice(code.length).trim() : message;
  const tail = isReasonCode(code) ? ["fix: " + CODES[code].fix, "docs: " + docAnchor(code)] : [];
  return { code, text: [...body.split("\n"), ...tail].map((l) => code + " " + l).join("\n") };
}

export async function main(argv: string[]): Promise<number> {
  try {
    const cmds = await loadCommands();
    const [sub, ...rest] = argv;
    if (sub === undefined || sub === "--help" || sub === "-h") {
      console.log(HELP(Object.keys(cmds)));
      return sub === undefined ? 2 : 0;
    }
    const fn = cmds[sub] ?? h2hFail("E_USAGE", "unknown h2h command " + JSON.stringify(sub) + "; gstack-evals h2h --help lists them");
    return await fn(rest);
  } catch (e) {
    const r = refusal(e);
    console.error(r.text);
    return EXIT[r.code] ?? 2;
  }
}

export interface Flags { one: (k: string) => string | undefined; need: (k: string) => string; has: (k: string) => boolean; all: (k: string) => string[] }
/** Parses --flag value and --switch arguments. Prints help and returns null on --help; refuses an unknown or repeated flag
 *  and a missing value (E_USAGE). */
export function parseFlags(argv: string[], valued: readonly string[], switches: readonly string[], help: string, repeatable: readonly string[] = []): Flags | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(help);
    return null;
  }
  const got = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (switches.includes(a)) got.set(a, ["true"]);
    else if (valued.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) h2hFail("E_USAGE", a + " needs a value\n" + help);
      if (got.has(a) && !repeatable.includes(a)) h2hFail("E_USAGE", a + " is given twice");
      got.set(a, [...(got.get(a) ?? []), v!]);
    } else h2hFail("E_USAGE", "unknown argument " + JSON.stringify(a) + "\n" + help);
  }
  return {
    one: (k) => got.get(k)?.[0],
    need: (k) => got.get(k)?.[0] ?? h2hFail("E_USAGE", k + " is required\n" + help),
    has: (k) => got.has(k),
    all: (k) => got.get(k) ?? [],
  };
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
