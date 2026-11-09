// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals outcome pf: the pstack-checks scoring core's commands. Every refusal prints its reason code first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, isReasonCode } from "../../../src/errors/codes.ts";
import type { Candidate } from "../statemachines/source.ts";
import { readUnit } from "../statemachines/unit.ts";
import { treeVolume as smTreeVolume } from "../statemachines/oracle.ts";
import { analyse, report } from "./analysis.ts";
import * as adm from "./admission.ts";
import { labelsGate, neutralGate, oracleGate, poolOf, readLabels, toldGate, walkDraw } from "./draw.ts";
import { itemsTable } from "./items.ts";
import { dockerNeutralRun, neutralFiles, validateNeutral, volumeTexts } from "./neutral.ts";
import { PfError, readPrereg } from "./prereg.ts";
import { dockerExecutor, treeVolume } from "./runner.ts";
import { dockerBreaks, rowOf, scoreSession, type CatchRecord } from "./score.ts";
import { toldScreen } from "./told.ts";

export const HELP = `Usage: gstack-evals outcome pf <command>
  dryrun [--out <dir>] [--python <python with claude_agent_sdk>] [--pstack-source <cursor/plugins clone>]
  draw --prereg <prereg.json> --candidates <candidates.json> --units <dir> --neutral <dir> [--labels <file>]... [--raise] [--n <n>] --out <draw.json>
  told --unit <dir> [--unit <dir>]...
  neutral --unit <dir> --out <dir> [--image <id>] [--volume <name>] [--mode hardened|root]
  score --s <repo> [--ref HEAD] --unit <dir> --neutral <record.json> --checks <CHECKS.json> --session <session.json> --out <catch.json>
        [--transcript <sdk-messages.jsonl>] [--claude-session <claude-session.jsonl>] [--image <id>] [--mode hardened|root] [--mount <spec>]... [--env K=V]... [--breaks]
  analyze --prereg <prereg.json> --out <analysis.json> <catch.json>...
  admission --in <admission.json> [--out <file>]
  reprice --in <reprice.json> [--out <file>]
  items
Plan sections 2, 6 to 10, 12 and 13 (README.md in this lane). Codes E_PF_* in docs/errors.md.`;

type Args = { _: string[]; [k: string]: string | string[] | boolean | undefined } & { _: string[] };
const MULTI = new Set(["labels", "unit", "mount", "env"]);
const FLAGS = new Set(["raise", "breaks"]);
function parse(argv: string[]): Args {
  const a: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (!x.startsWith("--")) { a._.push(x); continue; }
    const k = x.slice(2);
    if (FLAGS.has(k)) { a[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new PfError("E_USAGE", "--" + k + " needs a value");
    if (MULTI.has(k)) a[k] = [...((a[k] as string[] | undefined) ?? []), v];
    else a[k] = v;
  }
  return a;
}
const need = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== "string") throw new PfError("E_USAGE", "--" + k + " is required (gstack-evals outcome pf --help)");
  return v;
};
const list = (a: Args, k: string): string[] => (a[k] as string[] | undefined) ?? [];
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const write = (p: string | undefined, v: unknown) => { if (p) writeFileSync(p, JSON.stringify(v, null, 1) + "\n"); else console.log(JSON.stringify(v, null, 1)); };
const mode = (a: Args) => { const m = (a.mode as string | undefined) ?? "hardened"; if (m !== "hardened" && m !== "root") throw new PfError("E_USAGE", "--mode is hardened or root"); return m; };

async function run(cmd: string, a: Args): Promise<number> {
  if (cmd === "items") { for (const l of itemsTable()) console.log(l); return 0; }
  if (cmd === "draw") {
    const seeds = readPrereg(need(a, "prereg"));
    const cj = readJson(need(a, "candidates"));
    const cands: Candidate[] = Array.isArray(cj) ? cj : cj.candidates;
    const units = need(a, "units");
    const d = walkDraw(poolOf(cands), seeds.draw_seed, [labelsGate(readLabels(list(a, "labels"))), oracleGate(units), toldGate(units), neutralGate(need(a, "neutral"))], { raise: !!a.raise, n: a.n === undefined ? undefined : Number(a.n) });
    write(need(a, "out"), d);
    console.log("admission " + d.admission.length + " raise " + d.raise.length + " test " + d.test.length + " reserve " + d.reserve.length + " capped " + d.capped.length);
    for (const [code, reasons] of Object.entries(d.by_code)) for (const [reason, n] of Object.entries(reasons)) console.log("drop " + code + " " + reason + " " + n);
    for (const s of d.short) console.log("short " + s.phase + " " + s.got + " of " + s.wanted);
    if (d.pending) { console.error("E_PF_PENDING " + d.pending.phase + " waits on " + d.pending.id + " at the " + d.pending.gate + " gate (" + d.pending.why + ")"); return 2; }
    return 0;
  }
  if (cmd === "told") {
    let bad = 0;
    for (const dir of list(a, "unit")) {
      let issue: string | null = null;
      try { issue = readFileSync(join(dir, "issue.md"), "utf8"); } catch { issue = null; }
      const r = toldScreen(issue, readFileSync(join(dir, "fix.patch"), "utf8"));
      console.log(r ? "E_PF_TOLD " + dir + " " + r.rule + " " + r.value : "ok " + dir);
      if (r) bad++;
    }
    return bad ? 1 : 0;
  }
  if (cmd === "neutral") {
    const dir = need(a, "unit");
    const u = readUnit(dir);
    const image = (a.image as string | undefined) ?? u.image.runtime_id ?? u.image.image_id;
    if (!image || !u.oracle) throw new PfError("E_PF_INPUT", u.id + ": the unit has no runtime image or oracle record; run the state machines oracle first");
    const volume = (a.volume as string | undefined) ?? smTreeVolume(u.id);
    const texts = volumeTexts(image, volume, u.repo_dir, neutralFiles(dir, u.lang));
    const { record, patch } = validateNeutral(u.id, u.lang, texts, u.oracle.f2p ?? [], u.oracle.stable, dockerNeutralRun(dir, u, image, volume, mode(a)));
    const out = need(a, "out");
    mkdirSync(out, { recursive: true });
    write(join(out, u.id + ".json"), record);
    if (patch) writeFileSync(join(out, u.id + ".patch"), patch, "latin1");
    console.log(record.verdict === "kept" ? "kept " + u.id + " mode " + record.mode : "E_PF_NEUTRAL_INVALID " + u.id + " " + record.tried.map((t) => t.mode + ": " + t.reason).join("; "));
    return record.verdict === "kept" ? 0 : 1;
  }
  if (cmd === "score") {
    const md = mode(a);
    const env = Object.fromEntries(list(a, "env").map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
    const mounts = list(a, "mount").flatMap((m) => ["--mount", m]);
    const unitDir = need(a, "unit");
    const u0 = readUnit(unitDir);
    const image = (a.image as string | undefined) ?? u0.image.runtime_id ?? u0.image.image_id ?? "";
    const rec = await scoreSession({
      s: need(a, "s"), ref: a.ref as string | undefined, unitDir, neutral: need(a, "neutral"), checks: need(a, "checks"), session: need(a, "session"), transcript: (a.transcript as string | undefined) ?? null, claudeSession: (a["claude-session"] as string | undefined) ?? null,
      exec: (repo, u) => dockerExecutor({ repo, image, repoDir: u.repo_dir, workDir: u.work_dir, mode: md, mounts, env, rebuild: u.commands.rebuild }),
      breaks: a.breaks ? dockerBreaks(unitDir, image, md, (repo, t, vol) => treeVolume(repo, t, image, vol)) : undefined,
    });
    write(need(a, "out"), rec);
    console.log(rec.unit + " score " + rec.score + (rec.gap ? " gap " + rec.gap : ""));
    return 0;
  }
  if (cmd === "analyze") {
    const seeds = readPrereg(need(a, "prereg"));
    const an = analyse(a._.map((p) => rowOf(readJson(p) as CatchRecord)), seeds.bootstrap_seed);
    write(need(a, "out"), an);
    for (const l of report(an)) (l.startsWith("E_PF_") ? console.error : console.log)(l);
    return an.incomplete.length ? 1 : 0;
  }
  if (cmd === "admission") {
    const x = readJson(need(a, "in"));
    write(a.out as string | undefined, {
      floor: adm.floorReading(x.counts, x.raise), contrast_floor: adm.contrastFloor(x.counts), ceiling: adm.ceilingReading(x.counts.N, x.cut),
      exposure: adm.exposureReading(x.p_sessions ?? []), infra: adm.infraReading(x.cells ?? [], x.broken ?? []), cost: adm.costReading(x.opus_costs ?? { P: [], C: [], N: [] }),
    });
    return 0;
  }
  if (cmd === "reprice") {
    const x = readJson(need(a, "in"));
    const prices = adm.reprice(x.measured ?? {});
    const n = adm.nRule(prices, { supply: x.supply, spent_usd: x.spent_usd, crew_held_usd: x.crew_held_usd });
    write(a.out as string | undefined, { prices, ...n, mid: x.mid ? adm.midRunCheck(x.mid.model, x.mid) : null, blind_fits: x.blind_spent_usd === undefined ? null : adm.blindFits(x.blind_spent_usd) });
    if (n.captain) console.error("captain: n = " + n.n + " is under 30; the Captain decides before any test session");
    return 0;
  }
  throw new PfError("E_USAGE", "unknown pf command " + JSON.stringify(cmd) + "; gstack-evals outcome pf --help lists them");
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return cmd === undefined ? 2 : 0;
  }
  if (cmd === "dryrun") return await (await import("./dryrun.ts")).main(rest);
  try {
    return await run(cmd, parse(rest));
  } catch (e) {
    const msg = (e as Error).message;
    const code = e instanceof PfError ? e.code : msg.split(" ")[0]!;
    console.error(isReasonCode(code) ? msg : "E_PF_INPUT " + msg);
    const exit = isReasonCode(code) ? (CODES[code] as { exit: number | null }).exit : 2;
    return exit === null || exit === undefined ? 2 : exit;
  }
}
