// gstack-evals ledger: record approved caps with the owner's words, lease line items, settle and reconcile leases.
// docs/budget-ledger.md is the guide; every error line on stderr starts with its reason code.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { CODES, docAnchor, type ReasonCode } from "../../errors/codes.ts";
import { approvalsBin, mirrorApproval } from "./approvals.ts";
import { exportLease, importSettlement, ledgerStatus, openLease, reconcileLease, recordApproval, settleLease } from "./ledger.ts";
import { openLocalLedger } from "./local.ts";
import { parseUsd, usd } from "./money.ts";
import { ledgerPath, recordPath } from "./paths.ts";
import { isRecordFile, LedgerError, type Admission, type Quote } from "./record.ts";

export const HELP = `Usage: gstack-evals ledger <command> [options]

  init      --cap <usd> --item <name> --admission required|warn --words <text> --by <who> --source <ref> [--branch <name>]
            Record a line item's first approved cap with the owner's exact words, mirrored through gstack-approvals.
            Repeat --words for several quotes; give --by and --source once for all of them, or once per --words.
            --admission required makes every lease wait for a rig admission record; warn only warns. It never changes.
  raise     (the same flags but --admission) Record a higher cap for a line item.
  lease     --item <name> --run <id> [--amount <usd>] [--ttl <hours>] [--machine <id> --export <file>]
            Lease a line item for a run. The first lease binds the item to that run. --ttl is 24 by default, at most
            168. --export writes the lease for a sealed workflow instead of holding it here.
  lease     --lease <id> --export <file> Write an open lease's export again.
  lease     --from <lease file>          In the sealed workflow: hold an exported lease in this machine's ledger.
  settle    --lease <id> [--artifact <file>]
            Close a lease into the approval record. In the sealed workflow, --artifact writes the settle artifact.
  settle    --from <settle artifact>     Copy a sealed workflow's settle artifact into the approval record.
  reconcile --lease <id> --spent <usd> --words <text> --by <who> --source <provider usage export>
            The owner's settlement of a lease whose machine or local ledger is gone.
  status    [--item <name>]              Caps, committed spend, open leases and the approval words per line item.

Every command takes --ledger <path> (GSTACK_EVALS_LEDGER), --ledger-record <dir> (GSTACK_EVALS_LEDGER_RECORD)
and --json. Amounts are dollars with up to six decimals. Guide: docs/budget-ledger.md`;

const ALLOWED: Record<string, string[]> = {
  init: ["--cap", "--item", "--admission", "--words", "--by", "--source", "--branch"],
  raise: ["--cap", "--item", "--words", "--by", "--source", "--branch"],
  lease: ["--item", "--run", "--amount", "--ttl", "--machine", "--export", "--from", "--lease"],
  settle: ["--lease", "--artifact", "--from"],
  reconcile: ["--lease", "--spent", "--words", "--by", "--source"],
  status: ["--item"],
};
const REPEATABLE = new Set(["--words", "--by", "--source"]);
const FLAGS = new Set([...Object.values(ALLOWED).flat(), "--ledger", "--ledger-record", "--json"]);

export interface LedgerIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

class Usage extends Error {}

function errorLines(code: ReasonCode, message: string): string {
  return [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)]
    .flatMap((text) => text.split(/\r\n|\r|\n/))
    .map((line) => code + " " + line)
    .join("\n");
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Usage("cannot read " + path + ": " + (error as Error).message);
  }
}

export async function ledgerCli(argv: string[], io: LedgerIo, env: Record<string, string | undefined> = process.env): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || rest.includes("--help")) {
    io.out(HELP);
    return cmd === undefined ? 2 : 0;
  }
  try {
    const allowed = ALLOWED[cmd];
    if (!allowed) throw new Usage("unknown ledger command " + JSON.stringify(cmd) + "; gstack-evals ledger --help lists them");
    const flags = new Map<string, string[]>();
    let json = false;
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]!;
      if (flag === "--json") {
        json = true;
        continue;
      }
      if (![...allowed, "--ledger", "--ledger-record"].includes(flag)) throw new Usage("gstack-evals ledger " + cmd + " does not take " + flag);
      const value = rest[++i];
      if (value === undefined || FLAGS.has(value)) throw new Usage(flag + " needs a value");
      if (flags.has(flag) && !REPEATABLE.has(flag)) throw new Usage(flag + " is given twice");
      flags.set(flag, [...(flags.get(flag) ?? []), value]);
    }
    const one = (flag: string) => flags.get(flag)?.[0];
    const need = (flag: string) => one(flag) ?? fail("gstack-evals ledger " + cmd + " needs " + flag);
    const dollars = (flag: string) => parseUsd(need(flag)) ?? fail(flag + " must be dollars with up to six decimals, not " + JSON.stringify(one(flag)));
    const record = recordPath(one("--ledger-record"), env).path;
    const local = () => openLocalLedger(ledgerPath(one("--ledger"), env));
    const print = (value: unknown, line: string) => io.out(json ? JSON.stringify(value, null, 2) : line);

    if (cmd === "init" || cmd === "raise") {
      const admission = one("--admission");
      if (admission !== undefined && admission !== "required" && admission !== "warn") throw new Usage("--admission is required or warn, not " + JSON.stringify(admission));
      const a = { action: cmd as "init" | "raise", item: need("--item"), cap_micros: dollars("--cap"), quotes: quotes(flags), admission: admission as Admission | undefined };
      const mirror = { bin: approvalsBin(env), ...a, record, branch: one("--branch") };
      const file = recordApproval(record, a, () => mirrorApproval(mirror));
      print(file, "APPROVED: item=" + file.item + " cap=" + usd(file.cap_micros) + (file.admission ? " admission=" + file.admission : "") + " approval=" + file.seq + " record=" + record);
    } else if (cmd === "lease" && flags.has("--from")) {
      const file = readJson(need("--from"));
      if (!isRecordFile(file) || file.kind !== "lease") throw new Usage(one("--from") + " is not a lease export");
      const held = local();
      const prior = held.getLease(file.lease_id);
      if (prior && prior.state !== "open") throw new LedgerError("E_LEASE_CLOSED", "lease " + file.lease_id + " is already " + prior.state + " in the local ledger " + held.path + "; a settled lease is never held again");
      held.addLease(file);
      print(file, "LEASE_HELD: " + file.lease_id + " amount=" + usd(file.reserved_micros) + " expires=" + file.expires_at + " ledger=" + held.path);
    } else if (cmd === "lease" && flags.has("--lease")) {
      const file = exportLease(record, need("--lease"));
      writeNew("--export", need("--export"), JSON.stringify(file, null, 2) + "\n", "run it again with another --export file");
      print(file, "LEASE_EXPORTED: " + file.lease_id + " amount=" + usd(file.reserved_micros) + " machine=" + file.machine_id + " export=" + one("--export"));
    } else if (cmd === "lease") {
      const exportTo = one("--export");
      if (flags.has("--machine") && !exportTo) throw new Usage("--machine names the holder of an exported lease; add --export <file>");
      const ttl = one("--ttl") === undefined ? undefined : Math.round(Number(one("--ttl")) * 3_600_000);
      if (ttl !== undefined && !(ttl > 0)) throw new Usage("--ttl must be a positive number of hours");
      const amount = one("--amount") === undefined ? undefined : dollars("--amount");
      const warnings: string[] = [];
      const warn = (code: ReasonCode, message: string) => warnings.push(code + " " + message);
      const request = { item: need("--item"), run_id: need("--run"), machine_id: one("--machine"), amount_micros: amount, ttl_ms: ttl, warn };
      if (exportTo) {
        try {
          writeFileSync(exportTo, "", { flag: "wx" });
        } catch (error) {
          throw new Usage("cannot write --export " + exportTo + " (it must be a new file): " + (error as Error).message);
        }
      }
      let lease;
      try {
        lease = openLease(record, exportTo ? null : local(), request);
      } catch (error) {
        if (exportTo) rmSync(exportTo, { force: true });
        throw error;
      }
      if (exportTo) writeNew("--export", exportTo, JSON.stringify(exportLease(record, lease.lease_id), null, 2) + "\n", "lease " + lease.lease_id + " is recorded; write its export with gstack-evals ledger lease --lease " + lease.lease_id + " --export <file>");
      if (warnings.length) io.err(warnings.join("\n"));
      print({ ...lease, warnings }, "LEASE: " + lease.lease_id + " item=" + lease.line_item + " run=" + lease.run_id + " amount=" + usd(lease.reserved_micros) + " machine=" + lease.machine_id + " expires=" + lease.expires_at + (exportTo ? " export=" + exportTo : ""));
    } else if (cmd === "settle") {
      const artifact = one("--artifact");
      const close = flags.has("--from") ? importSettlement(record, readJson(need("--from"))) : settleLease(artifact ? null : record, local(), need("--lease"));
      if (artifact) writeNew("--artifact", artifact, JSON.stringify(close, null, 2) + "\n", "the lease is staged to close in this ledger; run the same settle again with another --artifact file");
      print(close, "SETTLED: " + close.lease_id + " spent=" + usd(close.spent_micros) + " unknown=" + usd(close.unknown_micros) + " (" + close.unknown_calls + " calls)" + (artifact ? " artifact=" + artifact : " record=" + record));
    } else if (cmd === "reconcile") {
      const source = need("--source");
      if (flags.get("--source")!.length > 1) throw new Usage("reconcile takes one --source, the provider usage export");
      const close = reconcileLease(record, { lease_id: need("--lease"), spent_micros: dollars("--spent"), quotes: quotes(flags), source });
      print(close, "RECONCILED: " + close.lease_id + " spent=" + usd(close.spent_micros) + " source=" + source + (close.source_sha256 ? " sha256=" + close.source_sha256 : ""));
    } else {
      const items = ledgerStatus(record, one("--item"));
      const paths = { record: recordPath(one("--ledger-record"), env), ledger: ledgerPath(one("--ledger"), env) };
      const lines = ["RECORD: " + paths.record.path + " (" + paths.record.rule + ")", "LEDGER: " + paths.ledger.path + " (" + paths.ledger.rule + ")"];
      for (const s of items) {
        lines.push("ITEM: " + s.item + " cap=" + usd(s.cap_micros ?? 0) + " admission=" + (s.admission ?? "-") + " committed=" + usd(s.committed_micros) + " left=" + usd(Math.max(s.left_micros, 0)) + " run=" + (s.run_id ?? "-") + " leases=" + s.leases + " open=" + (s.open_lease?.lease_id ?? "-"));
        for (const q of s.approval?.quotes ?? []) lines.push("  words: " + JSON.stringify(q.words) + " by " + q.by + " (" + q.source + ")");
      }
      print({ ...paths, items }, lines.join("\n"));
    }
    return 0;
  } catch (error) {
    if (error instanceof Usage) {
      io.err(errorLines("E_USAGE", error.message));
      return 2;
    }
    if (!(error instanceof LedgerError)) throw error;
    io.err(errorLines(error.code, error.message));
    return CODES[error.code].exit ?? 2;
  }
}

function fail(message: string): never {
  throw new Usage(message);
}

/** Writes a file the operator named without replacing another file: an existing file must be empty or already hold these bytes. */
function writeNew(flag: string, path: string, text: string, retry: string): void {
  try {
    if (!existsSync(path)) return writeFileSync(path, text, { flag: "wx" });
    const held = readFileSync(path, "utf8");
    if (held === text) return;
    if (held !== "") throw new Error("it already holds something else");
    writeFileSync(path, text);
  } catch (error) {
    throw new Usage("cannot write " + flag + " " + path + ": " + (error as Error).message + "; " + retry);
  }
}

/** Pairs each --words with its --by and --source. A --by or --source given once applies to every quote. */
function quotes(flags: Map<string, string[]>): Quote[] {
  const words = flags.get("--words") ?? [];
  const pick = (flag: string, i: number) => {
    const values = flags.get(flag) ?? [];
    if (values.length !== 1 && values.length !== words.length) fail("give " + flag + " once, or once per --words (" + words.length + ")");
    return values.length === 1 ? values[0]! : values[i]!;
  };
  if (words.length === 0) fail("an approval needs the owner's exact words: --words <text> --by <who> --source <ref>");
  return words.map((w, i) => ({ words: w, by: pick("--by", i), source: pick("--source", i) }));
}

export async function main(argv: string[]): Promise<number> {
  return ledgerCli(argv, { out: (t) => console.log(t), err: (t) => console.error(t) });
}
