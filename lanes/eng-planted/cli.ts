// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep: the planted-unit eng-review read (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg). Every
// error line on stderr starts with its reason code. Each module plugs its subcommands into SUBCOMMANDS when it lands.
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { COMMANDS as CONSTRUCT } from "./construct/commands.ts";
import { dryRun, PARTS } from "./dryrun.ts";
import { EpError } from "./errors.ts";
import { COMMANDS as READINGS } from "./readings/commands.ts";
import { COMMANDS as STAGES } from "./stages/commands.ts";
import type { Command } from "./types.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export type Args = { flags: Map<string, string>; bools: Set<string>; rest: string[] };

export function parse(argv: string[], bools: string[]): Args {
  const flags = new Map<string, string>();
  const on = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) rest.push(a);
    else if (bools.includes(a)) on.add(a);
    else {
      const v = argv[++i];
      if (v === undefined) throw new EpError("E_USAGE", a + " needs a value");
      flags.set(a, v);
    }
  }
  return { flags, bools: on, rest };
}

/** One error record: the message, the fix and its docs/errors.md anchor, every line starting with the code. */
export const lines = (code: ReasonCode, message: string): string =>
  [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)]
    .flatMap((t) => t.split(/\r\n|\r|\n/))
    .map((l) => code + " " + l)
    .join("\n");

const dryrun: Command = {
  bools: [],
  usage: "[--part construct|stages|readings]",
  summary: "the keyless dry run of every frozen rule; Docker cases need GSTACK_EVALS_DOCKER=1, and a SKIP is never a pass",
  run: async (a, io) => {
    const part = a.flags.get("--part");
    if (part !== undefined && !PARTS[part]) throw new EpError("E_USAGE", "--part is construct, stages or readings");
    const r = await dryRun(part ? [part] : undefined);
    for (const l of r.lines) io.out(l);
    io.out("DRYRUN: passed=" + r.passed + " failed=" + r.failed + " skipped=" + r.skipped + (r.ok ? " ok" : " not ok"));
    if (r.ok) return 0;
    io.err(lines("E_EP_DRYRUN_FAIL", r.failed + " case(s) failed and " + r.skipped + " skipped"));
    return 2;
  },
};

const SUBCOMMANDS: Record<string, Command> = { dryrun };
for (const table of [CONSTRUCT, STAGES, READINGS]) {
  for (const [name, command] of Object.entries(table)) {
    if (SUBCOMMANDS[name]) throw new Error("gstack-evals ep: two parts define the subcommand " + name);
    SUBCOMMANDS[name] = command;
  }
}

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  const help = () => ["gstack-evals ep <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(10) + v.summary + (v.usage ? "\n" + " ".repeat(12) + v.usage : ""))].join("\n");
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(help());
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals ep: unknown command " + JSON.stringify(sub) + "; gstack-evals ep --help lists them"));
    return 2;
  }
  try {
    return await entry.run(parse(rest, entry.bools), io);
  } catch (e) {
    if (!(e instanceof EpError)) throw e;
    io.err(lines(e.code, "gstack-evals ep " + sub + ": " + e.message));
    return CODES[e.code].exit ?? 2;
  }
}
