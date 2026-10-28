// Output helpers shared by U5's commands (validate, and skill-eval init and --lock): every error line on stderr starts
// with its reason code, then the fix and the docs anchor, as bin/gstack-evals prints its own errors.
import type { Io } from "../../cli.ts";
import { CODES, docAnchor, type ReasonCode } from "../../errors/codes.ts";

export const consoleIo: Io = { out: (text) => console.log(text), err: (text) => console.error(text) };

export function codeLines(code: ReasonCode, messages: string[], fix: string = CODES[code].fix): string {
  return [...messages, "fix: " + fix, "docs: " + docAnchor(code)]
    .flatMap((text) => text.split(/\r\n|\r|\n/))
    .map((line) => code + " " + line)
    .join("\n");
}

/** Prints an E_USAGE error and returns its exit code. */
export function usage(io: Io, message: string, help: string): number {
  io.err(codeLines("E_USAGE", [message], help));
  return 2;
}

/**
 * Parses --flag value pairs and bare --switches. Returns the values by flag name, or the first problem.
 * Every flag must be in flags (takes a value) or switches (takes none); a flag given twice is refused.
 */
export function parseFlags(argv: string[], flags: readonly string[], switches: readonly string[]): { values: Map<string, string>; set: Set<string> } | string {
  const values = new Map<string, string>();
  const set = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    if (switches.includes(name) && eq < 0) {
      set.add(name);
      continue;
    }
    if (!flags.includes(name)) return "unknown argument " + JSON.stringify(arg);
    if (values.has(name)) return name + " given twice";
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "") return name + " needs a value";
    values.set(name, value);
  }
  return { values, set };
}
