// Copyright (c) 2026 Garry Tan. MIT License.
// bun lanes/codex-hooks/cli.ts r|c <command>: the Codex hooks eval (lanes/codex-hooks/README.md). r is part R, routing on
// against off (r/cli.ts); c is part C, the /review contract on against off and the effort arm (c/cli.ts).
import { existsSync } from "node:fs";
import { join } from "node:path";

const USAGE = "E_USAGE usage: codex-hooks r <command> | codex-hooks c <command>";

export async function main(argv: string[]): Promise<number> {
  const [part, ...rest] = argv;
  if (part !== "r" && part !== "c") {
    console.error(USAGE);
    return 2;
  }
  const module = join(import.meta.dir, part, "cli.ts");
  if (!existsSync(module)) {
    console.error("E_USAGE codex-hooks " + part + " is not built yet (it will live at lanes/codex-hooks/" + part + "/cli.ts)");
    return 2;
  }
  const { main: partMain } = (await import(module)) as { main: (argv: string[]) => Promise<number> };
  return partMain(rest);
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
