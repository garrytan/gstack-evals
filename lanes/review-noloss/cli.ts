// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals noloss: the review no-loss category's commands (wiki/plans/2026-10-30-gsta-40-review-noloss-plan). No
// command here calls a model or spends. Every error line on stderr starts with its reason code; an unexpected failure
// writes a scrubbed trace file and prints its path with a correlation id.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { errorLines, errorRecord, scrubSecrets } from "../../src/skill-eval/verdict/error-record.ts";
import { ContractError } from "./contract.ts";
import { ARMS_ROOT, prepare, publish, snapshot } from "./ingest.ts";
import { blockerCount, checkSuite, loadSuite, SuiteError, suiteFromCatalog } from "./suite.ts";

export const HELP = `Usage: gstack-evals noloss <command> [options]

Scores review variants on the blockers a reference review catches. No command calls a model.

  suite --check [--suite <id|path>] [--prereg <file>]
      Check a suite: every blocker's case loads with a confirmed answer-key audit and matches its unit's range,
      file and line. --prereg checks each recorded freeze digest on its byte prefix. Default suite: gsta167-14pr.
  suite --from-catalog <dir> [--from-catalog <dir>]... --id <id> --released <YYYY-MM-DD> [--with <suite>] [--out <path>]
      Build a suite from catalog dirs: one unit and one blocker per case with a confirmed audit. --released is the
      newest release date among the arm's models (from its prereg); short-shelf-life cases whose fix appeared on or
      before it are listed as ineligible. --with merges into a suite and skips the cases it already names.
      Prints the suite JSON, or writes it to --out.
  ingest <arm dir> --suite <id|path> [--check] [--root <dir>] [--digest-only <finding id>|all]... [--replace <reason>]
      Validate an arm against contract v1 (lanes/review-noloss/arm.schema.json), scan it, and publish it to
      <root>/<suite>/<arm id>/ (root: lanes/review-noloss/arms). --check validates and scans and writes nothing.
      A finding that breaks the scan is refused unless --digest-only names it; then only its digest is published.
      A destination holding different bytes is refused unless --replace gives a reason, recorded in ingest.json.

Exit 0 on success, 2 on any refusal. Reason codes: E_NOLOSS_SUITE, E_NOLOSS_ARM, E_NOLOSS_JUDGMENT, E_NOLOSS_COST
(docs/errors.md).`;

export interface NolossIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

class Usage extends Error {}

function version(): string {
  try {
    return readFileSync(join(import.meta.dir, "..", "..", "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

function parseFlags(argv: string[], known: Record<string, "value" | "repeat" | "bool">): { flags: Map<string, string[]>; positional: string[] } {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const kind = known[a];
    if (!kind) throw new Usage("noloss does not take " + JSON.stringify(a) + " here; gstack-evals noloss --help lists the flags");
    if (kind === "bool") {
      flags.set(a, ["true"]);
      continue;
    }
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) throw new Usage(a + " needs a value");
    if (kind === "value" && flags.has(a)) throw new Usage(a + " is given twice");
    flags.set(a, [...(flags.get(a) ?? []), v]);
  }
  return { flags, positional };
}

function report(io: NolossIo, code: ReasonCode, operation: string, message: string, extra: { correlation_id?: string; trace?: string } = {}): number {
  const context = { resource_ids: {}, gstack_evals_version: version(), host: null, host_version: null, image_digest: null, policy_sha256: null, ledger: null, ledger_record: null, env_names: [] };
  io.err(errorLines(errorRecord({ code, operation, message, context, ...extra })).join("\n"));
  return 2;
}

function suiteCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--check": "bool", "--suite": "value", "--prereg": "value", "--from-catalog": "repeat", "--id": "value", "--released": "value", "--with": "value", "--out": "value" });
  if (positional.length) throw new Usage("noloss suite takes no positional arguments");
  if (flags.has("--from-catalog")) {
    const id = flags.get("--id")?.[0] ?? (() => { throw new Usage("suite --from-catalog needs --id"); })();
    const released = flags.get("--released")?.[0] ?? null;
    const base = flags.get("--with")?.[0];
    const suite = suiteFromCatalog({ id, catalogs: flags.get("--from-catalog")!, released, base: base ? loadSuite(base).suite : undefined });
    const text = JSON.stringify(suite, null, 2) + "\n";
    const out = flags.get("--out")?.[0];
    if (out) writeFileSync(out, text);
    else io.out(text.trimEnd());
    io.err("suite " + id + ": " + suite.units.length + " units, " + new Set(suite.units.map((u) => u.cluster)).size + " clusters, " + blockerCount(suite, "blocking") + " blocking, " + blockerCount(suite, "over-blocking") + " over-blocking, " + blockerCount(suite, "detection") + " detection-only, " + suite.ineligible.length + " ineligible");
    return 0;
  }
  if (!flags.has("--check")) throw new Usage("noloss suite needs --check or --from-catalog");
  const { suite, sha256 } = loadSuite(flags.get("--suite")?.[0] ?? "gsta167-14pr");
  const preregPath = flags.get("--prereg")?.[0];
  const problems = checkSuite(suite, { prereg: preregPath ? readFileSync(preregPath) : undefined });
  if (problems.length) throw new SuiteError(problems.join("\n"));
  io.out("suite " + suite.id + " ok: " + suite.units.length + " units, " + blockerCount(suite) + " blockers, sha256 " + sha256 + (preregPath ? ", " + suite.prereg_freezes.length + " prereg freezes hold" : ""));
  return 0;
}

function ingestCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--check": "bool", "--root": "value", "--digest-only": "repeat", "--replace": "value" });
  if (positional.length !== 1) throw new Usage("noloss ingest takes one arm directory");
  const suiteArg = flags.get("--suite")?.[0] ?? (() => { throw new Usage("noloss ingest needs --suite <id|path>"); })();
  const { suite, sha256 } = loadSuite(suiteArg);
  const files = snapshot(resolve(positional[0]!));
  const p = prepare(files, suite, sha256, flags.get("--digest-only") ?? []);
  const what = "arm " + p.arm.arm.id + " (" + p.arm.provenance + ", " + p.arm.state + ", " + p.arm.arm.passes + " pass" + (p.arm.arm.passes > 1 ? "es" : "") + ")" + (p.digestOnly.length ? ", digest-only: " + p.digestOnly.join(" ") : "");
  if (flags.has("--check")) {
    io.out("ingest --check ok: " + what + " fits contract v1 and suite " + suite.id + "; nothing written");
    return 0;
  }
  const r = publish(p, suite, flags.get("--root")?.[0] ?? ARMS_ROOT, flags.get("--replace")?.[0] ?? null);
  io.out("ingest " + r.status + ": " + what + " at " + r.dest);
  return 0;
}

export async function nolossCli(argv: string[], io: NolossIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || rest.includes("--help") || rest.includes("-h")) {
    io.out(HELP);
    return cmd === undefined ? 2 : 0;
  }
  try {
    if (cmd === "suite") return suiteCmd(rest, io);
    if (cmd === "ingest") return ingestCmd(rest, io);
    throw new Usage("unknown noloss command " + JSON.stringify(cmd) + "; gstack-evals noloss --help lists them");
  } catch (error) {
    if (error instanceof Usage) return report(io, "E_USAGE", "noloss " + cmd, error.message);
    if (error instanceof SuiteError) return report(io, "E_NOLOSS_SUITE", "noloss " + cmd, error.message);
    if (error instanceof ContractError) return report(io, error.code, "noloss " + cmd, error.message);
    const id = randomUUID();
    const dir = join(tmpdir(), "gstack-evals-traces");
    let trace: string | undefined;
    try {
      mkdirSync(dir, { recursive: true });
      trace = join(dir, "noloss-" + id + ".txt");
      writeFileSync(trace, scrubSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)) + "\n");
    } catch {
      trace = undefined;
    }
    return report(io, "E_INTERNAL", "noloss " + cmd, "unexpected failure in lanes/review-noloss: " + (error instanceof Error ? error.message : String(error)) + "; this is a defect, not your input. File an issue with these lines and the trace file.", { correlation_id: id, trace });
  }
}

export async function main(argv: string[]): Promise<number> {
  return nolossCli(argv, { out: (t) => console.log(t), err: (t) => console.error(t) });
}
