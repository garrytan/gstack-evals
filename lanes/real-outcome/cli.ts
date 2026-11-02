// gstack-evals real: the real-world outcome lane's subcommands (wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan).
// Each build unit owns one row. A subcommand runs once its module exists and exports main(argv); until then it exits 2
// with E_USAGE "not built yet", as src/cli.ts does for top-level commands.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor } from "../../src/errors/codes.ts";

export const SUBCOMMANDS = [
  { name: "mine", summary: "Sample repositories and mine K1 to K3 candidates.", module: "mine/cli.ts", owner: "RO-B1" },
  { name: "task", summary: "Build task directories and check V1 to V9.", module: "task/cli.ts", owner: "RO-B2" },
  { name: "sandbox", summary: "The ship sandbox: the evaluator-owned origin and gh sidecar, egress and shipment records.", module: "sandbox/cli.ts", owner: "RO-B4" },
  { name: "arms", summary: "Build the none, gstack told and gstack untold arms.", module: "arms/cli.ts", owner: "RO-B5" },
  { name: "score", summary: "Score shipment records and run the paired analysis.", module: "score/cli.ts", owner: "RO-B6" },
] as const;

const usage = (message: string): number => {
  console.error(["E_USAGE " + message, "E_USAGE fix: " + CODES.E_USAGE.fix, "E_USAGE docs: " + docAnchor("E_USAGE")].join("\n"));
  return 2;
};

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "--help" || name === "-h") {
    console.log(["Usage: gstack-evals real <subcommand> [options]", "", ...SUBCOMMANDS.map((s) => "  " + s.name.padEnd(8) + s.summary + (existsSync(join(import.meta.dir, s.module)) ? "" : " [not built yet: " + s.owner + "]"))].join("\n"));
    return name === undefined ? 2 : 0;
  }
  const sub = SUBCOMMANDS.find((s) => s.name === name);
  if (!sub) return usage("unknown subcommand " + JSON.stringify(name) + "; gstack-evals real --help lists them");
  const path = join(import.meta.dir, sub.module);
  if (!existsSync(path)) return usage("gstack-evals real " + sub.name + " is not built yet (" + sub.owner + "; it will live at lanes/real-outcome/" + sub.module + ")");
  const mod = (await import(path)) as { main?: (argv: string[]) => Promise<number> };
  if (typeof mod.main !== "function") throw new Error("lanes/real-outcome/" + sub.module + " does not export main");
  return mod.main(rest);
}
