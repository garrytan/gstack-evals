// gstack-evals outcome: the outcome-skills lane's commands. serve runs the session driver (driver/stage.ts) for one
// admission batch on the program's envelope host; images pins, checks, publishes and binds T-G's task images
// (images/manifest.ts).
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { LedgerError } from "../../src/runner/ledger/record.ts";
import { serveStages, type StageSpec } from "./driver/stage.ts";
import { loadRegistry } from "./arms/registry.ts";
import { TaskError } from "../real-outcome/task/format.ts";
import { bind, check, pin, publicForm, readManifest } from "./images/manifest.ts";
import { readFileSync } from "node:fs";

export const HELP = `Usage: gstack-evals outcome serve --run <id> --envelope-host <machine id> --stage <item>=<arm> [--stage ...]
           --host <ip> --dir <run dir> [--planned 24] [--reruns 2] [--control-port <n>] [--ttl-hours 72]
           [--ledger <path>] [--ledger-record <dir>] [--registry <arms file>] [--lift-halt <session id>[,<session id>]]
A family SM stage is --stage <item>=<model>@<arm>,<arm>: one lease on the item for that model, serving each named SM arm
at its per-model allowance, with a proxy that refuses provider-side tools.

Opens one U4 lease per stage at its line item's cap through O6's envelope, one metering proxy per lease on --host, and a
control plane on 127.0.0.1 that real_agent's U4 mode opens and closes sessions on. It prints control=<url> and one
stage= line per stage, serves until POST /stop, SIGTERM or SIGINT, and settles every lease on every exit path.
--registry names the arms file the driver reads each arm's limits from (default: arms/registry.json); real_agent's
arms_path must name the same file. Provider keys come from its environment as the proxy reads them. Guide: wiki/plans/2026-11-04-geva-286-u4-session-driver.
A family SM session that closes with its proxy finalize failed halts its item (E_SM_FINALIZE_HALT); --lift-halt names the
sessions whose halt the Captain ruled on, after reading the proxy journal, so the launch serves the item again.

Usage: gstack-evals outcome images pin --out <manifest.json> --set <name> --commit <sha> <task dir>...
       gstack-evals outcome images check <manifest.json> --sha256 <hex>
       gstack-evals outcome sm <command>   the state machines family (gstack-evals outcome sm --help)
       gstack-evals outcome images public <manifest.json>
       gstack-evals outcome images bind <manifest.json> --task <task dir> --label <label> --out <run copy>

pin builds each task's image with quick/laneb's runtime layer on top, on a keyless build host, checks there that gold
passes every required test and the empty change fails one, and writes the manifest.
check runs before any session or lease, on the manifest whose sha256 the readiness post records (--sha256): every row's
image present with its pinned id and clean by cleanRoomPreflight. public prints the committed form, digests only. bind
writes a task's run copy whose image is the pinned one and prints image_id=, which real_agent's image_id takes beside the
manifest and its sha256.
Guide: lanes/outcome-skills/driver/README.md, "Trial images".`;

function lines(code: ReasonCode, message: string): string {
  return [...message.split("\n"), "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].map((l) => code + " " + l).join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return sub === undefined ? 2 : 0;
  }
  if (sub === "images") return await images(rest);
  if (sub === "sm") return await (await import("./statemachines/cli.ts")).main(rest);
  if (sub !== "serve") {
    console.error(lines("E_USAGE", "unknown subcommand " + JSON.stringify(sub) + "; gstack-evals outcome --help lists them"));
    return 2;
  }
  const flags = new Map<string, string>();
  const stages: StageSpec[] = [];
  const allowed = new Set(["--run", "--envelope-host", "--stage", "--host", "--dir", "--planned", "--reruns", "--control-port", "--ttl-hours", "--ledger", "--ledger-record", "--registry", "--lift-halt"]);
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = [rest[i]!, rest[i + 1]];
    if (!allowed.has(k) || v === undefined) {
      console.error(lines("E_USAGE", (allowed.has(k) ? k + " needs a value" : "unknown flag " + k) + "; gstack-evals outcome --help lists the flags"));
      return 2;
    }
    if (k === "--stage") {
      const m = v.match(/^([^=]+)=(.+)$/);
      if (!m) {
        console.error(lines("E_USAGE", "--stage takes <item>=<arm> or, for family SM, <item>=<model>@<arm>,<arm>, not " + v));
        return 2;
      }
      const sm = m[2]!.match(/^([^@]+)@(.+)$/);
      stages.push(sm ? { item: m[1]!, arm: m[1]!, model: sm[1]!, arms: sm[2]!.split(",") } : { item: m[1]!, arm: m[2]! });
    } else flags.set(k, v);
  }
  const missing = ["--run", "--envelope-host", "--host", "--dir"].filter((k) => !flags.has(k));
  if (missing.length || !stages.length) {
    console.error(lines("E_USAGE", "serve needs " + [...missing, ...(stages.length ? [] : ["--stage"])].join(", ")));
    return 2;
  }
  const bad = ["--planned", "--reruns", "--control-port", "--ttl-hours"].find((k) => flags.has(k) && !/^\d+(\.\d+)?$/.test(flags.get(k)!));
  if (bad) {
    console.error(lines("E_USAGE", bad + " takes a number, not " + flags.get(bad)));
    return 2;
  }
  const num = (k: string) => (flags.has(k) ? Number(flags.get(k)) : undefined);
  const ttlHours = num("--ttl-hours");
  let local: ReturnType<typeof openLocalLedger> | null = null;
  try {
    const registry = flags.has("--registry") ? loadRegistry(flags.get("--registry")!) : undefined;
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
      registry,
      ...(flags.has("--lift-halt") ? { lift_halts: flags.get("--lift-halt")!.split(",") } : {}),
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

async function images(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const flags = new Map<string, string>();
  const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i]!.startsWith("--")) {
      if (rest[i + 1] === undefined) return usage(rest[i] + " needs a value");
      flags.set(rest[i]!, rest[++i]!);
    } else pos.push(rest[i]!);
  }
  try {
    if (cmd === "pin") {
      const [out, set, commit] = ["--out", "--set", "--commit"].map((k) => flags.get(k));
      if (!out || !set || !commit || !pos.length) return usage("images pin needs --out, --set, --commit and at least one task dir");
      const m = await pin(pos, out, set, commit);
      console.log("TG_PIN rows=" + m.rows.length + " out=" + out);
      return 0;
    }
    if (cmd === "check" && pos.length === 1) {
      const want = flags.get("--sha256");
      if (!want || !/^[0-9a-f]{64}$/.test(want)) return usage("images check needs --sha256 <64 hex>, the manifest's sha256 the readiness post records (images public prints it)");
      const m = readManifest(pos[0]!, want);
      check(m, process.env.DOCKER ?? "docker", (r, n) => console.log("TG_IMAGE ok row=" + n + " image=" + r.image_id));
      console.log("TG_IMAGES: ok rows=" + m.rows.length);
      return 0;
    }
    if (cmd === "public" && pos.length === 1) {
      console.log(JSON.stringify(publicForm(readManifest(pos[0]!), readFileSync(pos[0]!)), null, 1));
      return 0;
    }
    if (cmd === "bind" && pos.length === 1) {
      const [task, label, out] = ["--task", "--label", "--out"].map((k) => flags.get(k));
      if (!task || !label || !out) return usage("images bind needs --task, --label and --out");
      const b = bind(task, readManifest(pos[0]!), label, out, process.env.DOCKER ?? "docker");
      console.log("TG_BIND out=" + b.out + " tag=" + b.tag + "\nimage_id=" + b.image_id);
      return 0;
    }
    return usage("images takes pin, check <manifest> --sha256 <hex>, public <manifest> or bind <manifest>; gstack-evals outcome --help lists them");
  } catch (e) {
    if (e instanceof TaskError) {
      console.error(lines(e.code, e.message));
      return 2;
    }
    const m = /^(E_[A-Z_]+):? (.*)$/s.exec((e as Error).message);
    if (m && m[1]! in CODES) {
      console.error(lines(m[1] as ReasonCode, m[2]!));
      return 2;
    }
    throw e;
  }
}

function usage(message: string): number {
  console.error(lines("E_USAGE", message));
  return 2;
}
