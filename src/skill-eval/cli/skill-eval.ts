// gstack-evals skill-eval: the Lane A command (interface v0.5, v0.4 where v0.5 is silent). It routes init and --lock to
// U5's commands, and resolves the call with its effective defaults. Preflight, --dry-run and the fake-host run land in
// U7's next pull requests; until then a call stops after printing its effective defaults.
import type { Io } from "../../cli.ts";
import { codeLines, consoleIo } from "../contract/cli-io.ts";
import { initCommand, lockCommand } from "../lock/cli.ts";
import { effectiveLines, resolveCall, SKILL_EVAL_HELP } from "./call.ts";
import { flagHelp, parseFlags, SKILL_EVAL_FLAGS } from "./flags.ts";

const HINT = "gstack-evals skill-eval --help shows the call and every flag.";

export async function skillEvalCommand(argv: string[], io: Io = consoleIo, env: Record<string, string | undefined> = process.env): Promise<number> {
  if (argv[0] === "init") return initCommand(argv.slice(1), io);
  if (argv.includes("--lock")) return lockCommand(argv.filter((a) => a !== "--lock"), io);
  const parsed = parseFlags(argv, SKILL_EVAL_FLAGS, env);
  if (typeof parsed === "string") {
    io.err(codeLines("E_USAGE", ["skill-eval: " + parsed], HINT));
    return 2;
  }
  if (parsed.values.has("--help")) {
    io.out(SKILL_EVAL_HELP + "\n" + flagHelp(SKILL_EVAL_FLAGS));
    return 0;
  }
  const call = resolveCall(parsed, env);
  if ("code" in call) {
    io.err(codeLines(call.code, ["skill-eval: " + call.message], call.fix ?? (call.code === "E_USAGE" ? HINT : undefined)));
    return 2;
  }
  io.out(effectiveLines(call).join("\n"));
  io.err(codeLines("E_USAGE", ["skill-eval: the run is not built yet; preflight, --dry-run and the fake host land in U7's next pull requests"], HINT));
  return 2;
}

export const main = (argv: string[]): Promise<number> => skillEvalCommand(argv);
