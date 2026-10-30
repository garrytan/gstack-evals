// gstack-evals tokens export: the review token table's measured output tokens for one model, as the JSON object gstack's
// scripts/review-dispatch-compare.ts reads through --tokens. Stdout holds that object and nothing else; flagged rows and
// errors go to stderr, and every error line starts with its reason code. It never fills a default and never calls a model.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { errorLines, errorRecord } from "../../src/skill-eval/verdict/error-record.ts";
import { exportTokens, flaggedRows, loadTable, rowName, STATS, TABLE_PATH, TableError, type Stat } from "./tokens.ts";

export const HELP = `Usage: gstack-evals tokens export --model <id> --stat median|p90 --for review-dispatch-compare [--role <role>]... [--table <path>]

Prints one model's measured output tokens per review dispatch as the JSON object gstack's
scripts/review-dispatch-compare.ts reads through --tokens, such as {"specialist":{"full":6929,"light":5446}},
and nothing else on stdout. Output tokens count output plus reasoning tokens per call.

  --model <id>    The model's id in the table, such as claude-opus-5-5.
  --stat <stat>   median or p90 of the measured output tokens.
  --for <target>  review-dispatch-compare, the only target.
  --role <role>   A reviewer role to export, such as specialist. Repeat it for several. Without it, every role
                  the table has for the model. Each role needs both efforts, full and light.
  --table <path>  The token table; tables/review-tokens.json by default.

A model, role or effort the table lacks exits 2 with E_TOKENS_COVERAGE, naming the measured rows needed.
Rows with n under 10 or as_of over 30 days old still export and are listed on stderr as flagged: lines.`;

const FLAGS = ["--model", "--stat", "--for", "--role", "--table"];

export interface TokensIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

class Usage extends Error {}

function fail(message: string): never {
  throw new Usage(message);
}

function version(): string {
  try {
    return readFileSync(join(import.meta.dir, "..", "..", "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

function report(io: TokensIo, code: ReasonCode, message: string, model: string | null, table: string | null): number {
  const resource_ids: Record<string, string> = table ? { table } : {};
  const context = { resource_ids, gstack_evals_version: version(), host: null, host_version: null, image_digest: null, policy_sha256: null, ledger: null, ledger_record: null, env_names: [] };
  io.err(errorLines(errorRecord({ code, operation: "tokens export", message, model, context })).join("\n"));
  return 2;
}

export async function tokensCli(argv: string[], io: TokensIo, now: Date = new Date()): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || rest.includes("--help") || rest.includes("-h")) {
    io.out(HELP);
    return cmd === undefined ? 2 : 0;
  }
  try {
    if (cmd !== "export") fail("unknown tokens command " + JSON.stringify(cmd) + "; gstack-evals tokens --help shows export");
    const flags = new Map<string, string[]>();
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]!;
      if (!FLAGS.includes(flag)) fail("gstack-evals tokens export does not take " + JSON.stringify(flag));
      const value = rest[++i];
      if (value === undefined || FLAGS.includes(value)) fail(flag + " needs a value");
      if (flags.has(flag) && flag !== "--role") fail(flag + " is given twice");
      flags.set(flag, [...(flags.get(flag) ?? []), value]);
    }
    const need = (flag: string) => flags.get(flag)?.[0] ?? fail("gstack-evals tokens export needs " + flag);
    const model = need("--model");
    const stat = need("--stat");
    if (!STATS.includes(stat as Stat)) fail("--stat is median or p90, not " + JSON.stringify(stat));
    const target = need("--for");
    if (target !== "review-dispatch-compare") fail("--for is review-dispatch-compare, not " + JSON.stringify(target));
    const path = flags.get("--table")?.[0] ?? TABLE_PATH;
    let table;
    try {
      table = loadTable(path);
    } catch (error) {
      if (error instanceof TableError) fail(error.message);
      throw error;
    }
    const result = exportTokens(table, model, stat as Stat, flags.get("--role"));
    if (!result.ok) {
      const rows = result.missing.map(rowName).join(", ");
      return report(io, "E_TOKENS_COVERAGE", "the token table " + path + " lacks the measured rows " + rows + "; no export is written and no default is filled", model, path);
    }
    io.out(JSON.stringify(result.tokens));
    const flagged = flaggedRows(table, result.rows, now);
    if (flagged.length > 0) io.err(flagged.map((f) => "flagged: " + rowName(f.row) + ": " + f.reasons.join("; ")).join("\n"));
    return 0;
  } catch (error) {
    if (!(error instanceof Usage)) throw error;
    return report(io, "E_USAGE", error.message, null, null);
  }
}

export async function main(argv: string[]): Promise<number> {
  return tokensCli(argv, { out: (t) => console.log(t), err: (t) => console.error(t) });
}
