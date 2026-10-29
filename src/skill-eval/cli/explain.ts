// gstack-evals explain <code>: a reason code's meaning, fix, side effects, retry safety and resumability, read from
// src/errors/codes.ts, so it never disagrees with docs/errors.md (interface v0.4, "Error records").
import type { Io } from "../../cli.ts";
import { CODES, docAnchor, isReasonCode, type CodeInfo, type ReasonCode } from "../../errors/codes.ts";
import { codeLines, consoleIo } from "../contract/cli-io.ts";

const HELP = "gstack-evals explain <code> [--json]";

export function explainText(code: ReasonCode): string {
  const info: CodeInfo = CODES[code];
  const head = info.exit === null ? code + " (warning: attaches to any verdict and never changes the exit code)" : code + " (exit " + info.exit + ", " + (info.exit === 1 ? "FAIL" : "INCOMPLETE") + ")";
  const lines = [head, "meaning: " + info.meaning, "fix: " + info.fix];
  if (info.exit !== null) {
    lines.push("side effects: " + info.side_effects, "retry safe: " + (info.retry_safe ? "yes" : "no"), "resumable: " + (info.resumable ? "yes, with --resume <out>" : "no; start a new run after the fix"));
  }
  lines.push("owner: " + info.owner, "docs: " + docAnchor(code));
  return lines.join("\n");
}

export async function explainCommand(argv: string[], io: Io = consoleIo): Promise<number> {
  const json = argv.includes("--json");
  const rest = argv.filter((a) => a !== "--json");
  if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) return (io.out("Usage: " + HELP), 0);
  if (rest.length !== 1 || rest[0]!.startsWith("-")) {
    io.err(codeLines("E_USAGE", ["explain takes one reason code, such as LOCK_MISSING"], HELP));
    return 2;
  }
  const code = rest[0]!.toUpperCase();
  if (!isReasonCode(code)) {
    const near = Object.keys(CODES).filter((c) => c.includes(code) || code.includes(c)).slice(0, 5);
    io.err(codeLines("E_USAGE", ["unknown reason code " + JSON.stringify(rest[0]) + (near.length ? "; did you mean " + near.join(", ") + "?" : "")], "Every code is listed in docs/errors.md. " + HELP));
    return 2;
  }
  io.out(json ? JSON.stringify({ code, ...CODES[code], doc: docAnchor(code) }, null, 2) : explainText(code));
  return 0;
}

export const main = (argv: string[]): Promise<number> => explainCommand(argv);
