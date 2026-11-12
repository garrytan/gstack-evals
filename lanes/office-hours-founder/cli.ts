// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals of: the office-hours founder eval's commands (prereg 2026-11-09-geva-418). Each subcommand lives in its
// area; this file wires the simulator into the run area's launch and the scoring step into its end to end.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CODES, docAnchor, isReasonCode, type ReasonCode } from "../../src/errors/codes.ts";
import { scoreE2e } from "./e2e-score.ts";
import { commands as auditCommands } from "./audit.ts";
import { commands as authorCommands } from "./author/cli.ts";
import { commands as readCommands } from "./read/cli.ts";
import { e2eCommand, rowsCommand, runCommand } from "./run/cli.ts";
import { commands as scoreCommands } from "./score/cli.ts";
import { simFounder } from "./wire.ts";

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}
type Env = Record<string, string | undefined>;
type Run = (argv: string[], io: Io, env: Env) => Promise<number> | number;

/** of run takes --sim-rules <file> only under the sim-prompt repair: the recorded rule-wording repair of section 4's prompt. */
function runWithSimulator(argv: string[], io: Io, env: Env): Promise<number> {
  const at = argv.indexOf("--sim-rules");
  const repaired = argv.includes("sim-prompt");
  if (at >= 0 && !argv[at + 1]) throw Object.assign(new Error("--sim-rules needs a file"), { code: "E_USAGE" });
  if ((at >= 0) !== repaired) throw Object.assign(new Error(repaired ? "the sim-prompt repair needs --sim-rules <file> with the recorded wording" : "--sim-rules is only for the sim-prompt repair"), { code: "E_USAGE" });
  const rules = at >= 0 ? readFileSync(argv[at + 1]!, "utf8") : undefined;
  if (rules !== undefined) io.err("of run: simulator prompt repaired, sha256 " + createHash("sha256").update(rules).digest("hex"));
  const rest = at >= 0 ? [...argv.slice(0, at), ...argv.slice(at + 2)] : argv;
  return runCommand(rest, io, env, { founderTurn: simFounder(rules) });
}

export const SUBCOMMANDS: Record<string, { summary: string; run: Run }> = {
  ...authorCommands,
  run: { summary: "one cell's sessions on the Docker rig with the simulated founder (stage1, smoke, stage2, pitch, real)", run: runWithSimulator },
  rows: { summary: "a launch's rows against its frozen manifest, with the end-state counts", run: (argv, io) => rowsCommand(argv, io) },
  ...scoreCommands,
  ...auditCommands,
  ...readCommands,
  e2e: { summary: "the keyless end to end: fixture founders through the real rig, proxy, ledger, simulator, packets and scorer", run: (argv, io, env) => e2eCommand(argv, io, env, { founder: simFounder(), after: scoreE2e }) },
  dryrun: { summary: "the keyless dry run that drives every frozen rule (start rule 7)", run: async (argv, io) => (await import("./dryrun.ts")).run(argv, io) },
};

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }, env: Env = process.env): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(["gstack-evals of <command>", "", ...Object.entries(SUBCOMMANDS).map(([k, v]) => "  " + k.padEnd(14) + v.summary)].join("\n"));
    return sub ? 0 : 2;
  }
  const entry = SUBCOMMANDS[sub];
  if (!entry) {
    io.err(lines("E_USAGE", "gstack-evals of: no command " + JSON.stringify(sub) + "; run gstack-evals of --help"));
    return 2;
  }
  try {
    return await entry.run(rest, io, env);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const lead = /^(E_[A-Z0-9_]+) /.exec(String(err.message ?? ""))?.[1];
    const named = err.code ?? lead;
    const code = typeof named === "string" && isReasonCode(named) ? named : "E_INTERNAL";
    io.err(lines(code, "gstack-evals of " + sub + ": " + String(err.message ?? e).replace(new RegExp("^" + code + " "), "")));
    return CODES[code].exit ?? 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
