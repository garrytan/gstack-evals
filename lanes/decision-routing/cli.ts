// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals decision-routing: the decision-routing lane's subcommands (wiki/plans, the 2026-11-09 decision-routing
// preregistration). Each build unit owns one row. A subcommand runs once its module exists and exports main(argv); until
// then it exits 2 with E_USAGE "not built yet", as src/cli.ts does for top-level commands.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor } from "../../src/errors/codes.ts";

export const SUBCOMMANDS = [
  { name: "score", summary: "Score trial directories: Primary A and B with their verdicts, P against N, stops and S10 acting rates.", module: "score/cli.ts", owner: "B5" },
  { name: "admit", summary: "Admission: room, transfer, the cut's ceiling (S3) and per-contrast discordance from calibration and pilot.", module: "score/admit-cli.ts", owner: "B5" },
  { name: "pilot", summary: "Pilot rules: the re-cost from pilot means, the drop order, particle-1's max_tokens rule and the pilot session stop.", module: "score/pilot.ts", owner: "B5" },
  { name: "tune", summary: "Tune acting bands from labelled calibration decisions and print the question-rewrite plan.", module: "tune/cli.ts", owner: "B6" },
  { name: "pin", summary: "Write the pin file and its sha256 from the tuned bands, questions.json and the frozen rules.", module: "tune/pin-cli.ts", owner: "B6" },
  { name: "labels", summary: "Grounded labels: the constructed safety set, per-trial labels in label containers, the join for the tuner.", module: "labels/cli.ts", owner: "B7" },
  { name: "dry-run", summary: "The keyless dry run that drives every frozen rule.", module: "dryrun.ts", owner: "B8" },
  { name: "run", summary: "Run a batch on the runner host: leases, proxies, Harbor jobs and stop files.", module: "host/controller.ts", owner: "B3 host" },
] as const;

const usage = (message: string): number => {
  console.error(["E_USAGE " + message, "E_USAGE fix: " + CODES.E_USAGE.fix, "E_USAGE docs: " + docAnchor("E_USAGE")].join("\n"));
  return 2;
};

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "--help" || name === "-h") {
    console.log(["Usage: gstack-evals decision-routing <subcommand> [options]", "", ...SUBCOMMANDS.map((s) => "  " + s.name.padEnd(8) + s.summary + (existsSync(join(import.meta.dir, s.module)) ? "" : " [not built yet: " + s.owner + "]"))].join("\n"));
    return name === undefined ? 2 : 0;
  }
  const sub = SUBCOMMANDS.find((s) => s.name === name);
  if (!sub) return usage("unknown subcommand " + JSON.stringify(name) + "; gstack-evals decision-routing --help lists them");
  const path = join(import.meta.dir, sub.module);
  if (!existsSync(path)) return usage("gstack-evals decision-routing " + sub.name + " is not built yet (" + sub.owner + "; it will live at lanes/decision-routing/" + sub.module + ")");
  const mod = (await import(path)) as { main?: (argv: string[]) => Promise<number> };
  if (typeof mod.main !== "function") throw new Error("lanes/decision-routing/" + sub.module + " does not export main");
  return mod.main(rest);
}
