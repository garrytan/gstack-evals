// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ar: the autoplan record audit's commands (prereg 2026-11-09-geva-419). Each writes only into a named sink
// that must not exist before (smoke creates the paid sink; project and stage2 continue it), prints counts only and never
// prints record text. Every error line starts with its reason code.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, type ReasonCode } from "../../src/errors/codes.ts";
import { ArError } from "./errors.ts";
import { checkFrame } from "./frame.ts";
import { Matrix } from "./matrix.ts";
import { openSink, printLines, stage1, writeJson, type Stage1Out, type UnitRow } from "./stage1.ts";
import { blockOnRefusals, gate2Export, gate2Reading, prepare, stage2, type Phase2 } from "./stage2.ts";
import type { CheckResult } from "./panel.ts";
import { custody, readTold } from "./told.ts";

type Io = { out: (t: string) => void; err: (t: string) => void };

const USAGE = [
  "gstack-evals ar <command>",
  "",
  "  frame    --frame DIR                                   check the snapshot's digests and id list",
  "  stage1   --frame DIR --gstack CLONE --repo DIR --commit SHA --sink NEW [--withheld-ids FILE]",
  "  told     --sums FILE --custody CUSTODY.md --sink NEW --trial JOB=EV:GATES... FILE.age... (identity on stdin)",
  "  dryrun   [--no-custody]                                the keyless dry run, one line per 13.5 clause",
  "  smoke    --frame DIR --repo DIR --stage1 DIR --sink NEW --item ITEM [--run-id ID --record DIR --ledger FILE --withheld-ids FILE]",
  "  project  --frame DIR --repo DIR --stage1 DIR --sink DIR --item ITEM [...]   re-projection from the smoke, no call",
  "  stage2   --frame DIR --repo DIR --stage1 DIR --sink DIR --item ITEM [--phases gold,check,production] [...]",
  "  report   --frame DIR --repo DIR --stage1 DIR [--stage2 DIR] [--withheld-ids FILE]",
].join("\n");

const lines = (code: ReasonCode, message: string) => [message, "fix: " + CODES[code].fix, "docs: " + docAnchor(code)].flatMap((t) => t.split(/\r\n|\r|\n/)).map((l) => code + " " + l).join("\n");

function flags(argv: string[]): { one: Map<string, string>; many: Map<string, string[]>; rest: string[]; has: Set<string> } {
  const one = new Map<string, string>(), many = new Map<string, string[]>(), has = new Set<string>(), rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      has.add(k);
      continue;
    }
    one.set(k, v);
    many.set(k, [...(many.get(k) ?? []), v]);
    i++;
  }
  return { one, many, rest, has };
}

const need = (f: Map<string, string>, k: string): string => f.get(k) ?? (() => {
  throw new ArError("E_USAGE", "--" + k + " is required\n" + USAGE);
})();

const withheld = (f: Map<string, string>) => (f.get("withheld-ids") ? readFileSync(f.get("withheld-ids")!, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : []);

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    io.out(USAGE);
    return sub ? 0 : 2;
  }
  const { one: f, many, rest: files, has } = flags(rest);
  try {
    switch (sub) {
      case "frame": {
        const r = checkFrame(need(f, "frame"));
        io.out("frame pass: " + r.ids.length + " runs, " + r.records + " record files, " + r.approvals + " approvals files");
        return 0;
      }
      case "stage1": {
        const sink = openSink(need(f, "sink"), "stage1");
        const out = stage1({ frame: need(f, "frame"), repo: need(f, "repo"), commit: need(f, "commit"), matrix: new Matrix(need(f, "gstack")), withheld: withheld(f), sink });
        for (const l of printLines(out)) io.out(l);
        rmSync(join(sink, "INCOMPLETE"), { force: true });
        return out.smoke.pass ? 0 : (io.err(lines("E_AR_SMOKE_FAIL", "the parser smoke failed on a gstack minor version")), 2);
      }
      case "told": {
        const sink = openSink(need(f, "sink"), "told");
        const identity = await readStdin();
        const rows = custody({ files, sums: need(f, "sums"), log: need(f, "custody"), identity }, (dir) => readTold(dir, many.get("trial") ?? []));
        identity.fill(0);
        writeJson(join(sink, "told.json"), rows);
        const read = rows.filter((r) => !r.missing);
        io.out("told sessions " + rows.length + " read " + read.length + " missing " + (rows.length - read.length) + " accepted " + read.reduce((a, r) => a + r.accepted, 0) + " hits " + read.reduce((a, r) => a + r.hits, 0) + " question_before_gate " + rows.filter((r) => r.questionBeforeGate === true).length + " no_gate_question " + rows.filter((r) => r.questionBeforeGate === null).length);
        rmSync(join(sink, "INCOMPLETE"), { force: true });
        return 0;
      }
      case "dryrun":
        return await (await import("./dryrun.ts")).run(rest, io);
      case "smoke":
      case "project":
      case "stage2": {
        const sink = need(f, "sink");
        blockOnRefusals(JSON.parse(readFileSync(join(need(f, "stage1"), "stage1.json"), "utf8")));
        if (sub === "smoke") openSink(sink, "stage2");
        else if (!existsSync(join(sink, "SINK.json"))) throw new ArError("E_USAGE", "the paid sink must be the one smoke created");
        const phases: Phase2[] = sub === "smoke" ? ["smoke"] : sub === "project" ? ["project"] : ((f.get("phases") ?? "gold,check,production").split(",") as Phase2[]);
        const out = await stage2({ frame: need(f, "frame"), repo: need(f, "repo"), stage1: need(f, "stage1"), sink, item: need(f, "item"), runId: f.get("run-id") ?? need(f, "item"), phases, record: f.get("record"), ledger: f.get("ledger"), withheld: withheld(f) });
        io.out(sub + " done: " + JSON.stringify(out));
        return 0;
      }
      case "report": {
        const s1 = JSON.parse(readFileSync(join(need(f, "stage1"), "stage1.json"), "utf8")) as Stage1Out;
        for (const l of printLines(s1)) io.out(l);
        const s2 = f.get("stage2");
        if (s2) {
          const pp = prepare({ frame: need(f, "frame"), repo: need(f, "repo"), stage1: need(f, "stage1"), withheld: withheld(f) });
          const units = JSON.parse(readFileSync(join(need(f, "stage1"), "units.json"), "utf8")) as UnitRow[];
          const labels = new Map(existsSync(join(s2, "labels.json")) ? (JSON.parse(readFileSync(join(s2, "labels.json"), "utf8")) as Array<[string, any]>) : []);
          const check = existsSync(join(s2, "check.json")) ? (JSON.parse(readFileSync(join(s2, "check.json"), "utf8")) as CheckResult) : null;
          for (const stage of ["lean-primary", "lean-desc", "full"] as const) io.out("AP-GATE-2 " + stage + " " + gate2Export(gate2Reading(units, labels, check, stage, stage === "full" ? new Set(pp.draws.full) : undefined), pp.id));
        } else io.out("AP-GATE-2 NO READ until stage 2 runs (mechanical hit share in the counts above)");
        if (has.has("strict")) return 0;
        return 0;
      }
      default:
        io.err(lines("E_USAGE", "gstack-evals ar: unknown command " + JSON.stringify(sub) + "\n" + USAGE));
        return 2;
    }
  } catch (e) {
    if (!(e instanceof ArError) && !(typeof (e as { code?: unknown })?.code === "string" && (e as { code: string }).code in CODES)) throw e;
    const code = (e as { code: ReasonCode }).code;
    io.err(lines(code, "gstack-evals ar " + sub + ": " + (e as Error).message.replace(/^E_[A-Z_]+ /, "")));
    return CODES[code].exit ?? 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
