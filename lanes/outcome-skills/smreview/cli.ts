// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals sr: the State Machines review specialist eval's commands (plan wiki/plans/2026-11-24-geva-588-...).
// Every refusal prints its reason code first. The oracle is the state machines eval's (oracleUnit) and the harmless edit
// is pstack-checks' command, run on SR's unit dirs: gstack-evals outcome pf neutral.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, isReasonCode } from "../../../src/errors/codes.ts";
import { oracleUnit, Pacer, treeVolume as smTreeVolume } from "../statemachines/oracle.ts";
import { readUnit } from "../statemachines/unit.ts";
import { labelsGate, neutralGate, oracleGate, readLabels } from "../pfchecks/draw.ts";
import { dockerExecutor } from "../pfchecks/runner.ts";
import { EFFORT_KEYS, effortProblem } from "../pfchecks/session.ts";
import { analyse, complete, look, type UnitFacts } from "./analysis.ts";
import { SR_MODELS, type SrArm } from "./arms.ts";
import type { BicRecord } from "./bic.ts";
import { srDraw } from "./draw.ts";
import { SrError } from "./errors.ts";
import { itemsTable } from "./items.ts";
import { labelsFromPublished, labelsFromReplies, labelsFromSmUnits, readJsonl } from "./labels.ts";
import { readSrPrereg } from "./prereg.ts";
import { sessionOf, srScoreSession, type SrCatch } from "./score.ts";
import { runSrSession, srPlan, type SrPlanned, type Part } from "./session.ts";
import { bicPool, buildPool, convertUnit, type Pool, type Sources } from "./units.ts";
import { fetchV21 } from "./v21.ts";

export const HELP = `Usage: gstack-evals sr <command>
  pool --cache <MultiLang cache> --v21 <V2.1 cache> --tool <tool checkout> [--export <Harbor export>] --out <pool.json>
  bic --pool <pool.json> --cache <dir> --v21 <dir> --tool <dir> --clones <dir> --out <bic.jsonl> [--prune yes]
  convert --pool <pool.json> --id <id> --cache <dir> --v21 <dir> --tool <dir> --clones <dir> --out <units dir>
  oracle --unit <dir> --pull-log <file> [--pulls-per-hour 60]   the state machines oracle at the fix base (kept, or its E_SM_ code)
  labels sm --units <GEVA-520 units dir> --bic <bic.jsonl> --out <pf-labels.json>
  labels published --tsv <a results post's units.tsv> --bic <bic.jsonl> --out <pf-labels.json>
  labels replies --keys <dir of *.key.json> --replies <replies.jsonl> --out <pf-labels.json>
  draw --prereg <prereg.json> --bic <bic.jsonl> --units <dir> --neutral <dir> --labels <file>... --out <draw.json>
  plan --prereg <prereg.json> --draw <draw.json> --part pilot|test --out <plan.json>
  session --unit <dir> --plan <plan.json> --index <n> --control <url> --proxy <host:port> --names short|plugin --effort <effort.json>
          --home-gplus <dir> --home-g0 <dir> --out <dir> [--volume <tree volume>] [--harbor <bin>] [--claude <bin>]
  score --s <repo> --unit <dir> --neutral <record.json> --checks <CHECKS.json> --session <session.json> [--arm <arm>] --out <catch.json>
        [--transcript <sdk-messages.jsonl>] [--claude-session <claude-session.jsonl>] [--image <id>] [--volume <name>]
  analyze --prereg <prereg.json> --bic <bic.jsonl> --plan <plan.json> --out <analysis.json> <catch.json>...
  look --prereg <prereg.json> --bic <bic.jsonl> --plan <plan.json> <catch.json>...
  items
  fetch --v21 <dir>   SWE-rebench-V2.1's pinned parquet files, checked by sha256, with their row files
Codes E_SR_* in docs/errors.md.`;

type Args = { _: string[]; [k: string]: string | string[] | undefined };
const MULTI = new Set(["labels"]);
function parse(argv: string[]): Args {
  const a: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]!;
    if (!x.startsWith("--")) { a._.push(x); continue; }
    const k = x.slice(2), v = argv[++i];
    if (v === undefined) throw new SrError("E_USAGE", "--" + k + " needs a value");
    if (MULTI.has(k)) a[k] = [...((a[k] as string[] | undefined) ?? []), v];
    else a[k] = v;
  }
  return a;
}
const need = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== "string") throw new SrError("E_USAGE", "--" + k + " is required (gstack-evals sr --help)");
  return v;
};
const opt = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const write = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1) + "\n");
const sources = (a: Args): Sources => ({ cache: need(a, "cache"), v21: need(a, "v21"), tool: need(a, "tool"), ...(opt(a, "export") ? { export: opt(a, "export") } : {}) });
const bics = (p: string) => readJsonl(p) as unknown as BicRecord[];
const facts = (bs: BicRecord[]): UnitFacts[] => bs.filter((b) => !b.drop).map((b) => ({ id: b.id, repo: b.repo, detected: !!(b.detector as { detected?: boolean } | null)?.detected, pr_lines: (b.pr_added ?? 0) + (b.pr_deleted ?? 0) }));
/** Catch records, each read once: a record with no session index, or a second record for the same session, is refused. */
function catches(ps: string[]): Array<SrCatch & { arm: SrArm; index: number }> {
  const seen = new Set<string>();
  return ps.map((p) => {
    const c = readJson(p) as SrCatch & { arm: SrArm; index: number };
    if (!Number.isSafeInteger(c.index)) throw new SrError("E_SR_INPUT", p + " names no session index; score it again with sr score");
    const key = [c.unit, c.model, c.arm, c.index].join("|");
    if (seen.has(key)) throw new SrError("E_SR_INPUT", p + " repeats session " + key);
    seen.add(key);
    return c;
  });
}

async function run(cmd: string, a: Args): Promise<number> {
  if (cmd === "items") { for (const l of itemsTable()) console.log(l); return 0; }
  if (cmd === "fetch") { await fetchV21(need(a, "v21")); console.log("v21 fetched to " + need(a, "v21")); return 0; }
  if (cmd === "pool") {
    const p = buildPool(sources(a));
    write(need(a, "out"), p);
    console.log("rows=" + p.rows.length);
    return 0;
  }
  if (cmd === "bic") {
    const rs = bicPool(readJson(need(a, "pool")) as Pool, sources(a), need(a, "clones"), need(a, "out"), console.log, a.prune === "yes");
    const by: Record<string, number> = {};
    for (const r of rs) by[r.drop ?? "ok"] = (by[r.drop ?? "ok"] ?? 0) + 1;
    console.log("BICS " + JSON.stringify(by));
    return 0;
  }
  if (cmd === "convert") {
    const pool = readJson(need(a, "pool")) as Pool;
    const id = need(a, "id");
    const row = pool.rows.find((r) => r.id === id) ?? (() => { throw new SrError("E_SR_INPUT", "the pool has no row " + id); })();
    const dir = join(need(a, "out"), id);
    mkdirSync(need(a, "out"), { recursive: true });
    await convertUnit(dir, row, sources(a), need(a, "clones"));
    console.log("unit " + dir);
    return 0;
  }
  if (cmd === "oracle") {
    const v = await oracleUnit(need(a, "unit"), new Pacer(need(a, "pull-log"), Number(opt(a, "pulls-per-hour") ?? 60)));
    console.log(v.verdict + " " + v.id + " " + v.detail);
    return v.verdict === "kept" ? 0 : 1;
  }
  if (cmd === "labels") {
    const what = a._[0];
    const out = need(a, "out");
    if (what === "sm") {
      const dir = need(a, "units");
      const want = new Set(bics(need(a, "bic")).filter((b) => !b.drop).map((b) => b.id));
      const f = labelsFromSmUnits(readdirSync(dir).map((d) => readJson(join(dir, d, "unit.json"))), want, "state machines eval (GEVA-520) unit.json labels");
      write(out, f);
      console.log("labels=" + Object.keys(f.labels).length);
      return 0;
    }
    if (what === "published") {
      const want = new Set(bics(need(a, "bic")).filter((b) => !b.drop).map((b) => b.id));
      const f = labelsFromPublished(readFileSync(need(a, "tsv"), "utf8"), want, need(a, "tsv"));
      write(out, f);
      console.log("labels=" + Object.keys(f.labels).length);
      return 0;
    }
    if (what !== "replies") throw new SrError("E_USAGE", "sr labels takes sm, published or replies");
    const dir = need(a, "keys");
    const f = labelsFromReplies(readdirSync(dir).filter((n) => n.endsWith(".key.json")).map((n) => readJson(join(dir, n))), readJsonl(need(a, "replies")), "sr-labels replies");
    write(out, f);
    console.log("labels=" + Object.keys(f.labels).length + " null_astra=" + Object.values(f.labels).filter((l) => !l.astra).length + " null_opus=" + Object.values(f.labels).filter((l) => !l.opus).length);
    return 0;
  }
  if (cmd === "draw") {
    const units = need(a, "units");
    const d = srDraw(bics(need(a, "bic")), readSrPrereg(need(a, "prereg")).draw_seed, [labelsGate(readLabels((a.labels as string[] | undefined) ?? [])), oracleGate(units), neutralGate(need(a, "neutral"))]);
    write(need(a, "out"), d);
    console.log("pilot " + d.pilot.length + " test " + d.test.length + " drops " + d.drops.length + " capped " + d.capped.length);
    if (d.pending) { console.error("E_SR_INPUT the draw waits on " + d.pending.id + " at the " + d.pending.gate + " gate (" + d.pending.why + ")"); return 2; }
    return 0;
  }
  if (cmd === "plan") {
    const part = need(a, "part");
    if (part !== "pilot" && part !== "test") throw new SrError("E_USAGE", "--part is pilot or test");
    const d = readJson(need(a, "draw"));
    const sessions = srPlan(d[part] as string[], readSrPrereg(need(a, "prereg")).order_seed, part as Part);
    writeFileSync(need(a, "out"), JSON.stringify({ schema: "sr-plan.v1", part, sessions }, null, 1) + "\n", { flag: "wx" });
    console.log("sessions=" + sessions.length + " units=" + new Set(sessions.map((s) => s.unit)).size);
    return 0;
  }
  if (cmd === "session") {
    const index = Number(need(a, "index"));
    const session = (readJson(need(a, "plan")).sessions as SrPlanned[]).find((x) => x.index === index);
    if (!session) throw new SrError("E_USAGE", "the plan has no session " + need(a, "index"));
    const effort = readJson(need(a, "effort"));
    const bad = effortProblem(effort);
    if (bad) throw new SrError("E_USAGE", "--effort holds one record per model with exactly the keys " + EFFORT_KEYS.join(", ") + ": " + bad);
    const names = need(a, "names");
    if (names !== "short" && names !== "plugin") throw new SrError("E_USAGE", "--names is short or plugin");
    const unitDir = need(a, "unit");
    const res = await runSrSession({
      unitDir, session, names, effort, control: need(a, "control"), proxy: need(a, "proxy"), out: need(a, "out"), volume: opt(a, "volume") ?? smTreeVolume(readUnit(unitDir).id),
      homes: { ...(opt(a, "home-gplus") ? { "G+": opt(a, "home-gplus")! } : {}), ...(opt(a, "home-g0") ? { G0: opt(a, "home-g0")! } : {}) },
      ...(opt(a, "harbor") ? { harbor: opt(a, "harbor") } : {}), ...(opt(a, "claude") ? { claude: opt(a, "claude") } : {}),
    });
    console.log("session=" + [session.unit, session.model, session.arm, session.index].join("/") + " gap=" + res.record.gap + " record=" + res.file);
    return 0;
  }
  if (cmd === "score") {
    const sj = readJson(need(a, "session")) as { arm?: string; index?: number };
    const arm = sj.arm as SrArm;
    if (!["N", "C", "P", "G+", "G0"].includes(arm) || !Number.isSafeInteger(sj.index)) throw new SrError("E_SR_INPUT", need(a, "session") + " names no SR arm or session index");
    if (opt(a, "arm") !== undefined && opt(a, "arm") !== arm) throw new SrError("E_SR_INPUT", "--arm " + opt(a, "arm") + " differs from the session record's arm " + arm);
    const unitDir = need(a, "unit");
    const u0 = readUnit(unitDir);
    const image = opt(a, "image") ?? u0.image.runtime_id ?? u0.image.image_id ?? "";
    const base = opt(a, "volume") ?? smTreeVolume(u0.id);
    const rec = await srScoreSession({
      s: need(a, "s"), unitDir, neutral: need(a, "neutral"), checks: need(a, "checks"), session: need(a, "session"), arm,
      transcript: opt(a, "transcript") ?? null, claudeSession: opt(a, "claude-session") ?? null,
      exec: (repo, u) => dockerExecutor({ repo, image, base, repoDir: u.repo_dir, workDir: u.work_dir, mode: "hardened", mounts: [], env: {}, rebuild: u.commands.rebuild }),
    });
    write(need(a, "out"), { ...rec, arm, index: sj.index });
    console.log(rec.unit + " score " + rec.score + (rec.gap ? " gap " + rec.gap : "") + " checks " + rec.sr.checks + " false_alarms " + rec.sr.false_alarms);
    return 0;
  }
  if (cmd === "analyze" || cmd === "look") {
    const seeds = readSrPrereg(need(a, "prereg"));
    const ss = catches(a._).map((c) => sessionOf(c, c.arm));
    const fs = facts(bics(need(a, "bic")));
    const plan = readJson(need(a, "plan")).sessions as SrPlanned[];
    const order = [...new Set(plan.map((s) => s.unit))];
    const reps = Math.max(...plan.map((s) => s.rep));
    if (cmd === "look") {
      const l = look(ss, fs, order, reps, seeds.bootstrap_seed, SR_MODELS);
      console.log(JSON.stringify(l));
      return 0;
    }
    const an = analyse(ss, fs, seeds.bootstrap_seed, SR_MODELS, !complete(ss, order, reps, SR_MODELS));
    write(need(a, "out"), an);
    console.log("decision " + an.decision + " units " + an.units + " sessions " + an.sessions);
    return 0;
  }
  throw new SrError("E_USAGE", "unknown sr command " + JSON.stringify(cmd) + "; gstack-evals sr --help lists them");
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return cmd === undefined ? 2 : 0;
  }
  try {
    return await run(cmd, parse(rest));
  } catch (e) {
    const msg = (e as Error).message;
    const code = e instanceof SrError ? e.code : msg.split(" ")[0]!;
    console.error(isReasonCode(code) ? msg : "E_SR_INPUT " + msg);
    const exit = isReasonCode(code) ? (CODES[code] as { exit: number | null }).exit : 2;
    return exit === null || exit === undefined ? 2 : exit;
  }
}
