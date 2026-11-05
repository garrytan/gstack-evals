// gstack-evals outcome: the outcome-skills lane's commands. serve runs the session driver (driver/stage.ts) for one
// admission batch on the program's envelope host.
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { LedgerError } from "../../src/runner/ledger/record.ts";
import { serveStages, type StageSpec } from "./driver/stage.ts";

export const HELP = `Usage: gstack-evals outcome serve --run <id> --envelope-host <machine id> --stage <item>=<arm> [--stage ...]
           --host <ip> --dir <run dir> [--planned 24] [--reruns 2] [--control-port <n>] [--ttl-hours 72]
           [--ledger <path>] [--ledger-record <dir>]

Opens one U4 lease per stage at its line item's cap through O6's envelope, one metering proxy per lease on --host, and a
control plane on 127.0.0.1 that real_agent's U4 mode opens and closes sessions on. It prints control=<url> and one
stage= line per stage, serves until POST /stop, SIGTERM or SIGINT, and settles every lease on every exit path.
Provider keys come from its environment as the proxy reads them. Guide: wiki/plans/2026-11-04-geva-286-u4-session-driver.`;

function lines(code: ReasonCode, message: string): string {
  return [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].map((l) => code + " " + l).join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return sub === undefined ? 2 : 0;
  }
  if (sub !== "serve") {
    console.error(lines("E_USAGE", "unknown subcommand " + JSON.stringify(sub) + "; gstack-evals outcome --help lists them"));
    return 2;
  }
  const flags = new Map<string, string>();
  const stages: StageSpec[] = [];
  const allowed = new Set(["--run", "--envelope-host", "--stage", "--host", "--dir", "--planned", "--reruns", "--control-port", "--ttl-hours", "--ledger", "--ledger-record"]);
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = [rest[i]!, rest[i + 1]];
    if (!allowed.has(k) || v === undefined) {
      console.error(lines("E_USAGE", (allowed.has(k) ? k + " needs a value" : "unknown flag " + k) + "; gstack-evals outcome --help lists the flags"));
      return 2;
    }
    if (k === "--stage") {
      const m = v.match(/^([^=]+)=(.+)$/);
      if (!m) {
        console.error(lines("E_USAGE", "--stage takes <item>=<arm>, not " + v));
        return 2;
      }
      stages.push({ item: m[1]!, arm: m[2]! });
    } else flags.set(k, v);
  }
  const missing = ["--run", "--envelope-host", "--host", "--dir"].filter((k) => !flags.has(k));
  if (missing.length || !stages.length) {
    console.error(lines("E_USAGE", "serve needs " + [...missing, ...(stages.length ? [] : ["--stage"])].join(", ")));
    return 2;
  }
  const num = (k: string) => (flags.has(k) ? Number(flags.get(k)) : undefined);
  const ttlHours = num("--ttl-hours");
  let local: ReturnType<typeof openLocalLedger> | null = null;
  try {
    local = openLocalLedger(ledgerPath(flags.get("--ledger")));
    const served = await serveStages({
      record: recordPath(flags.get("--ledger-record")).path,
      local,
      run_id: flags.get("--run")!,
      envelope_host: flags.get("--envelope-host")!,
      stages,
      host: flags.get("--host")!,
      dir: flags.get("--dir")!,
      planned: num("--planned"),
      reruns: num("--reruns"),
      control_port: num("--control-port"),
      ttl_ms: ttlHours === undefined ? undefined : Math.round(ttlHours * 3_600_000),
    });
    console.log("control=" + served.control);
    for (const s of served.stages) console.log("stage=" + s.item + " arm=" + s.arm + " lease=" + s.lease_id + " reserved=" + s.reserved_micros + " proxy=" + s.proxy);
    const onSignal = () => void served.stop();
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    const onFault = (e: unknown) => {
      console.error("E_INTERNAL outcome driver: " + (e instanceof Error ? e.message : String(e)) + "; stopping every stage");
      void served.stop("failed");
    };
    process.on("uncaughtException", onFault);
    process.on("unhandledRejection", onFault);
    return await served.done;
  } catch (e) {
    if (e instanceof LedgerError) {
      console.error(lines(e.code as ReasonCode, e.message));
      return 2;
    }
    const m = /^(E_[A-Z_]+):? (.*)$/s.exec((e as Error).message);
    if (m && m[1]! in CODES) {
      console.error(lines(m[1] as ReasonCode, m[2]!));
      return 2;
    }
    throw e;
  } finally {
    local?.close();
  }
}
