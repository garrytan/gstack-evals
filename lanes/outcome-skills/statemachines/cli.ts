// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals outcome sm <sub>: the state machines family's commands. P1 builds source, screen, convert, draw, oracle,
// size and sample; later packages add their own.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode } from "../../../src/errors/codes.ts";
import { draw, fill, readPrereg, type Draw, type DrawUnit } from "./draw.ts";
import { hiddenMarkdown, hiddenUnit, inSourceUnits, staticCounts, type HiddenRecord } from "./hidden.ts";
import { oracleUnit, Pacer } from "./oracle.ts";
import { sample } from "./sample.ts";
import { screen } from "./screen.ts";
import { fetchMultiLang, manifestSize, pinCandidates, readRows, splitCandidates, type Candidate } from "./source.ts";
import { readUnit, writeUnit } from "./unit.ts";
import { runSession } from "./run.ts";
import { computeStart, firstInfo, scoreFollowon, treeCounts, treeScores, TREES, type FollowonRecord, type StartSet, type Tree } from "./followon.ts";
import { scoreFirst, type OutcomeRecord, type ScoreInput } from "./score.ts";
import { planPart, type PlannedSession, type SessionRecord } from "./session.ts";

export const HELP = `gstack-evals outcome sm <command>
  source fetch --cache <dir>                         download the pinned MultiLang parquet files and check their sha256
  source pin --cache <dir> --out <candidates.json>   every row to a candidate, images pinned by linux/amd64 digest
  source split <candidates.json> --cache <dir> --out <file>   the in-source test split (base files from GitHub raw)
  screen <candidates.json> --out <file>              keyless eligibility, each drop with E_SM_INELIGIBLE and its rule
  convert <candidates.json> --cache <dir> --id <id> --out <unit dir>
  draw <units.json> --prereg <prereg.json> --out <file>   seeded orders; units.json is [{id, repo, month, stratum}]
  oracle <draw.json> --units <dir> --candidates <file> --cache <dir> --pull-log <file> [--pulls-per-hour 60] [--retry]
  oracle hidden <candidates.json> --cache <dir> --units <dir> --pull-log <file> --out <hidden.jsonl> --md <hidden.md>
              [--ids <a,b>] [--pulls-per-hour 25] [--static-only]
                                                     the hidden-test count: each eligible in-source unit's commands on its
                                                     base tree with test.patch, then with fix-tests.patch too; ids that
                                                     passed and went missing, doctests apart; no-fail-fast in the frozen
                                                     test command; resumes past ids already in --out
  size <candidates.json> --ids <a,b> --pull-log <file>    compressed image sizes by manifest GET (paced)
  sample <candidates.json> --cache <dir> --units <dir> --ids <a,b> --pull-log <file> --out <file>
  session plan --units <a,b> --models <m,n> --prereg <prereg.json> --part <n> [--lines sm,qa] --out <plan.json>
                                                     one part's sessions in order (cells shuffled by the frozen order seed)
  session run --unit <dir> --plan <plan.json> --index <n> --control <url> --proxy <url> --out <run dir>
              [--attempt 2] [--first <session.json>] [--qa-home <dir> --qa-sha <sha>] [--harbor <bin>]
                                                     one session: its image, a Harbor run of real_agent in SM mode on the
                                                     driver at --control (gstack-evals outcome serve), and session.json
  score first --unit <dir> (--session <session.json> | --patch <file> --cell <name>) --out <outcome.json>
              [--mode hardened|root] [--run-empty]
                                                     section 7's first-stage score: strict and adapted readings, the fix's
                                                     tests by git apply --3way, the unit's own runs, sm-outcome.v1
  score followon --unit <dir> --tree S0|A1|S2 [--first <session.json> | --tree-patch <file>] [--first-outcome <outcome.json>]
              --start <start.json> (--session <session.json> | --patch <file> --cell <name>) --out <followon.json>
              [--mode hardened|root]
                                                     section 8's follow-on score on one replicate: the tree's start set (read
                                                     from --start, or computed in three runs and written there), the change
                                                     on its tree, the fix's tests by git apply --3way, incremental and end to
                                                     end, drift, secondaries; sm-followon.v1
  score followon --summary --records <dir> [--firsts <dir>] --out <trees.json>
                                                     per unit, model and tree: replicate means, the 2-of-3 keep rule,
                                                     first-stage gaps (sm-outcome.v1 records in --firsts), inherited fixes
                                                     and drift counts
Guide: lanes/outcome-skills/statemachines/README.md`;

function scoreFollowonCli(r: string[]): number {
  const { f } = flags(r, ["--unit", "--tree", "--first", "--tree-patch", "--first-outcome", "--start", "--session", "--patch", "--cell", "--out", "--mode", "--records", "--firsts"], ["--summary"]);
  const jsons = (dir: string, schema: string) => readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => readJson<{ schema?: string }>(join(dir, n))).filter((x) => x.schema === schema);
  if (f.has("--summary")) {
    const recs = jsons(need(f, "--records"), "sm-followon.v1") as FollowonRecord[];
    const firsts = f.has("--firsts") ? (jsons(f.get("--firsts")!, "sm-outcome.v1") as OutcomeRecord[]).filter((x) => x.stage === "first").map((x) => firstInfo(x)) : [];
    const trees = treeScores(recs, firsts);
    const counts = treeCounts(trees);
    writeNew(need(f, "--out"), { schema: "sm-followon-trees.v1", records: recs.length, trees, counts });
    console.log(TREES.map((t) => t + " kept=" + (counts[t]?.kept ?? 0) + " inherited=" + (counts[t]?.inherited_fix ?? 0) + " drift_units=" + (counts[t]?.drift_units ?? 0) + " first_conflict=" + (counts[t]?.removed_first_test_patch_conflict ?? 0) + " start_conflict=" + (counts[t]?.removed_start_set_conflict ?? 0)).join(" ") + " record=" + need(f, "--out"));
    return 0;
  }
  const mode = f.get("--mode") ?? "hardened";
  if (mode !== "hardened" && mode !== "root") throw new Error("E_USAGE --mode is hardened or root");
  const tree = need(f, "--tree") as Tree;
  if (!TREES.includes(tree)) throw new Error("E_USAGE --tree is S0, A1 or S2");
  if (f.has("--session") === f.has("--patch")) throw new Error("E_USAGE give --session or --patch, not both");
  const unitDir = need(f, "--unit");
  const u = readUnit(unitDir);
  let treePatch = "";
  if (tree !== "S0") {
    if (f.has("--first") === f.has("--tree-patch")) throw new Error("E_USAGE " + tree + " takes --first or --tree-patch, not both");
    if (f.has("--first")) {
      const s = readJson<SessionRecord>(f.get("--first")!);
      if (s.schema !== "sm-session.v1" || s.stage !== "first" || s.unit !== u.id || s.cell !== tree || !s.tree_patch) throw new Error("E_SM_ARM " + f.get("--first") + " is not " + tree + "'s first-stage record on " + u.id + " with a tree patch");
      treePatch = readFileSync(s.tree_patch.path, "utf8");
      if (createHash("sha256").update(treePatch).digest("hex") !== s.tree_patch.sha256) throw new Error("E_SM_ARM " + s.tree_patch.path + " is not the patch the first-stage record pins");
    } else treePatch = readFileSync(f.get("--tree-patch")!, "utf8");
  } else if (f.has("--first") || f.has("--tree-patch")) throw new Error("E_USAGE S0 takes no first-stage patch");
  const fo = f.has("--first-outcome") ? readJson<OutcomeRecord>(f.get("--first-outcome")!) : null;
  if (fo && (fo.schema !== "sm-outcome.v1" || fo.stage !== "first")) throw new Error("E_SM_ARM " + f.get("--first-outcome") + " is not a first-stage sm-outcome.v1 record");
  let session: SessionRecord | null = null, patchFile: string, patchSha: string | undefined, cell: string;
  if (f.has("--session")) {
    session = readJson<SessionRecord>(f.get("--session")!);
    if (session.schema !== "sm-session.v1" || session.stage !== "followon" || session.unit !== u.id || session.tree_ref?.tree !== tree) throw new Error("E_SM_ARM " + f.get("--session") + " is not a follow-on sm-session.v1 record on " + u.id + " tree " + tree);
    cell = session.cell;
    patchFile = session.tree_patch?.path ?? "";
    patchSha = session.tree_patch?.sha256;
    if (!patchFile && session.end !== "upstream" && session.end !== "infra") throw new Error("E_SM_ARM the follow-on session has no tree patch to score");
  } else {
    patchFile = f.get("--patch")!;
    cell = need(f, "--cell");
  }
  const startFile = need(f, "--start");
  const model = session?.model ?? fo?.model ?? null;
  let start: StartSet;
  if (existsSync(startFile)) start = readJson<StartSet>(startFile);
  else {
    start = computeStart({ unitDir, tree, treePatch, model, mode });
    writeNew(startFile, start);
  }
  const replicate = Number((cell.match(/^F-(?:S0|A1|S2)-(\d+)$/) ?? [])[1]) || null;
  const rec = scoreFollowon({ unitDir, tree, treePatch, start, patchFile, ...(patchSha ? { patchSha } : {}), cell, replicate, model, session, first: fo ? firstInfo(fo) : null, mode });
  writeNew(need(f, "--out"), rec);
  console.log("tree=" + tree + " start=" + (start.gap ?? start.ids.length) + " incremental=" + (rec.incremental ?? rec.gap) + " end_to_end=" + (rec.end_to_end ?? rec.gap) + " whole=" + (rec.whole ? rec.whole.incremental + "/" + rec.whole.end_to_end : "none") + (rec.whole_note ? " (" + rec.whole_note + ")" : "") + " drift=" + rec.drift.drift + (rec.drift.ids.length ? " (" + rec.drift.ids.join(",") + ")" : "") + " record=" + need(f, "--out"));
  return 0;
}

function say(e: unknown): number {
  const m = (e as Error).message;
  const code = m.split(" ")[0]!;
  if (isReasonCode(code)) {
    console.error(m.split("\n").map((l) => (l.startsWith(code) ? l : code + " " + l)).join("\n"));
    console.error(code + " fix: " + CODES[code].fix + "\n" + code + " docs: " + docAnchor(code));
    return CODES[code].exit ?? 1;
  }
  console.error("E_USAGE " + m);
  return 2;
}

function flags(argv: string[], allowed: string[], bools: string[] = []): { pos: string[]; f: Map<string, string> } {
  const f = new Map<string, string>(), pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (bools.includes(a)) f.set(a, "1");
    else if (a.startsWith("--")) {
      if (!allowed.includes(a) || argv[i + 1] === undefined) throw new Error("E_USAGE " + a + (allowed.includes(a) ? " needs a value" : " is not a flag of this command"));
      f.set(a, argv[++i]!);
    } else pos.push(a);
  }
  return { pos, f };
}
const need = (f: Map<string, string>, k: string) => f.get(k) ?? (() => { throw new Error("E_USAGE " + k + " is required"); })();
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeNew = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1) + "\n", { flag: "wx" });
const loadCands = (p: string) => readJson<{ schema: string; candidates: Candidate[] }>(p).candidates;
function rowOf(cache: string, id: string) {
  const r = readRows(cache).find((x) => x.row.instance_id === id);
  if (!r) throw new Error("E_SM_SOURCE no row " + id + " in the cached revision");
  return r.row;
}

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  try {
    if (sub === undefined || sub === "--help" || sub === "-h") {
      console.log(HELP);
      return sub === undefined ? 2 : 0;
    }
    if (sub === "source") {
      const [what, ...r] = rest;
      if (what === "split") {
        const { pos, f } = flags(r, ["--cache", "--out"]);
        const c = await splitCandidates(need(f, "--cache"), loadCands(pos[0] ?? need(f, "<candidates>")));
        writeNew(need(f, "--out"), { schema: "sm-candidates.v1", rows: c.length, candidates: c });
        const sp = c.filter((x) => x.split);
        console.log("split=" + sp.length + " in_source=" + sp.filter((x) => x.split && "test_hunks" in x.split && x.split.test_hunks > 0).length + " mixed=" + sp.filter((x) => x.split && "mixed" in x.split && x.split.mixed > 0).length + " errors=" + sp.filter((x) => x.split && "error" in x.split).length);
        return 0;
      }
      const { f } = flags(r, ["--cache", "--out"]);
      await fetchMultiLang(need(f, "--cache"));
      if (what === "fetch") return 0;
      if (what !== "pin") throw new Error("E_USAGE sm source takes fetch, pin or split");
      const c = await pinCandidates(need(f, "--cache"));
      writeNew(need(f, "--out"), { schema: "sm-candidates.v1", rows: c.length, candidates: c });
      console.log("candidates=" + c.length + " pinned=" + c.filter((x) => x.image_digest).length);
      return 0;
    }
    if (sub === "screen") {
      const { pos, f } = flags(rest, ["--out"]);
      const s = screen(loadCands(pos[0] ?? need(f, "<candidates>")));
      writeNew(need(f, "--out"), s);
      console.log("eligible=" + s.eligible.length + " " + Object.entries(s.by_rule).map(([k, v]) => k + "=" + v).join(" ") + " mixed_by_lang=" + JSON.stringify(s.mixed_by_lang));
      return 0;
    }
    if (sub === "convert") {
      const { pos, f } = flags(rest, ["--cache", "--id", "--out"]);
      const id = need(f, "--id");
      const c = loadCands(pos[0]!).find((x) => x.id === id);
      if (!c) throw new Error("E_USAGE no candidate " + id);
      const u = writeUnit(need(f, "--out"), c, rowOf(need(f, "--cache"), id));
      console.log("unit=" + u.id + " image=" + u.image.ref);
      return 0;
    }
    if (sub === "draw") {
      const { pos, f } = flags(rest, ["--prereg", "--out"]);
      const { draw_seed } = readPrereg(need(f, "--prereg"));
      const d = draw(readJson<DrawUnit[]>(pos[0]!), draw_seed);
      writeNew(need(f, "--out"), d);
      console.log("admission=" + d.admission.length + " state=" + d.state.length + " other=" + d.other.length);
      return 0;
    }
    if (sub === "oracle" && rest[0] === "hidden") {
      const { pos, f } = flags(rest.slice(1), ["--cache", "--units", "--pull-log", "--out", "--md", "--ids", "--pulls-per-hour"], ["--static-only"]);
      const cands = loadCands(pos[0] ?? need(f, "<candidates>")), cache = need(f, "--cache"), out = need(f, "--out");
      const rows = new Map(readRows(cache).map((x) => [x.row.instance_id, x.row]));
      const row = (id: string) => rows.get(id) ?? (() => { throw new Error("E_SM_SOURCE no row " + id + " in the cached revision"); })();
      const st = staticCounts(cands, (id) => row(id).test_cmds);
      const ids = f.has("--ids") ? new Set(f.get("--ids")!.split(",")) : null;
      const todo = inSourceUnits(cands).filter((x) => !ids || ids.has(x.id));
      const read = () => (existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as HiddenRecord) : []);
      if (!f.has("--static-only")) {
        const units = need(f, "--units"), pacer = new Pacer(need(f, "--pull-log"), Number(f.get("--pulls-per-hour") ?? 25));
        mkdirSync(units, { recursive: true });
        for (const cand of todo) {
          if (read().some((x) => x.id === cand.id)) continue;
          const free = Number(spawnSync("df", ["--output=avail", "-B1", "/var/lib/docker"], { encoding: "utf8" }).stdout.split("\n")[1] ?? 0);
          if (free < 16e9) throw new Error("E_SM_INFRA_GAP " + Math.round(free / 1e9) + " GB free under /var/lib/docker; the hidden count stops under 16 GB (rerun resumes)");
          const rec = await hiddenUnit({ cand, row: () => row(cand.id), units, pacer });
          appendFileSync(out, JSON.stringify(rec) + "\n");
          console.log("HIDDEN " + cand.id + " " + (rec.drop ? "drop " + rec.drop.code : "doctests=" + rec.hidden_doctests + " other=" + rec.hidden_other) + " no_fail_fast=" + (rec.how ?? "no"));
        }
      }
      const recs = read().filter((x) => todo.some((t) => t.id === x.id));
      writeFileSync(need(f, "--md"), hiddenMarkdown(recs, st));
      console.log("units=" + todo.length + " recorded=" + recs.length + " static_in_source_no_fail_fast=" + st.in_source.overall.no_fail_fast + " md=" + f.get("--md"));
      return 0;
    }
    if (sub === "oracle") {
      const { pos, f } = flags(rest, ["--units", "--candidates", "--cache", "--pull-log", "--pulls-per-hour"], ["--retry"]);
      const d = readJson<Draw>(pos[0]!);
      const units = need(f, "--units"), cands = loadCands(need(f, "--candidates")), cache = need(f, "--cache");
      const pacer = new Pacer(need(f, "--pull-log"), Number(f.get("--pulls-per-hour") ?? 60));
      mkdirSync(units, { recursive: true });
      const res = await fill(d, async (id) => {
        const dir = join(units, id);
        if (!existsSync(dir)) writeUnit(dir, cands.find((c) => c.id === id)!, rowOf(cache, id));
        const prior = readUnit(dir).oracle?.verdict;
        const v = prior && prior !== "running" ? { id, verdict: prior, detail: "recorded" } : await oracleUnit(dir, pacer);
        console.log("ORACLE " + id + " " + v.verdict + " " + v.detail.replace(/\n/g, " ").slice(0, 300));
        return v.verdict === "kept";
      }, { retry: f.has("--retry") });
      writeFileSync(join(units, "fill.json"), JSON.stringify(res, null, 1) + "\n");
      console.log("admission=" + res.admission.length + " state=" + res.state.length + " other=" + res.other.length + " reserve=" + res.reserve.length + " retry=" + res.retry.length);
      return 0;
    }
    if (sub === "size") {
      const { pos, f } = flags(rest, ["--ids", "--pull-log"]);
      const cands = loadCands(pos[0]!), pacer = new Pacer(need(f, "--pull-log"));
      for (const id of need(f, "--ids").split(",")) {
        const c = cands.find((x) => x.id === id);
        if (!c?.image_digest) continue;
        console.log("SIZE " + id + " " + (await manifestSize(c.docker_image, c.image_digest, fetch, () => pacer.take())));
      }
      return 0;
    }
    if (sub === "sample") {
      const { pos, f } = flags(rest, ["--cache", "--units", "--ids", "--pull-log", "--out"]);
      await sample({ candidates: loadCands(pos[0]!), cache: need(f, "--cache"), units: need(f, "--units"), ids: need(f, "--ids").split(","), pacer: new Pacer(need(f, "--pull-log")), out: need(f, "--out"), row: (id) => rowOf(need(f, "--cache"), id) });
      return 0;
    }
    if (sub === "session") {
      const [what, ...r] = rest;
      if (what === "--help" || what === undefined) {
        console.log(HELP.split("\n").filter((l) => /^  session|^ {14}|^ {50}/.test(l)).join("\n"));
        return what === undefined ? 2 : 0;
      }
      if (what === "plan") {
        const { f } = flags(r, ["--units", "--models", "--prereg", "--part", "--lines", "--out"]);
        const lines = (f.get("--lines") ?? "sm").split(",");
        if (lines.some((l) => l !== "sm" && l !== "qa")) throw new Error("E_USAGE --lines takes sm, qa or sm,qa");
        const plan = planPart(need(f, "--units").split(","), need(f, "--models").split(","), readPrereg(need(f, "--prereg")).order_seed, Number(need(f, "--part")), lines as Array<"sm" | "qa">);
        writeNew(need(f, "--out"), { schema: "sm-plan.v1", sessions: plan });
        console.log("sessions=" + plan.length + " first=" + plan.filter((x) => x.stage === "first").length + " followon=" + plan.filter((x) => x.stage === "followon").length);
        return 0;
      }
      if (what !== "run") throw new Error("E_USAGE sm session takes plan or run");
      const { f } = flags(r, ["--unit", "--plan", "--index", "--control", "--proxy", "--out", "--attempt", "--first", "--qa-home", "--qa-sha", "--harbor"]);
      const index = Number(need(f, "--index"));
      const session = readJson<{ sessions: PlannedSession[] }>(need(f, "--plan")).sessions.find((x) => x.index === index);
      if (!session) throw new Error("E_USAGE the plan has no session " + index);
      const attempt = Number(f.get("--attempt") ?? 1);
      if (attempt !== 1 && attempt !== 2) throw new Error("E_USAGE --attempt is 1 or 2");
      const res = runSession({ unitDir: need(f, "--unit"), session, control: need(f, "--control"), proxy: need(f, "--proxy"), out: need(f, "--out"), attempt, ...(f.has("--first") ? { first: f.get("--first")! } : {}), ...(f.has("--qa-home") ? { qaHome: f.get("--qa-home")! } : {}), ...(f.has("--qa-sha") ? { qaSha: f.get("--qa-sha")! } : {}), ...(f.has("--harbor") ? { harbor: f.get("--harbor")! } : {}) });
      console.log("session=" + session.cell + " end=" + res.record.end + " image=" + res.image.image_id + " lease=" + res.record.lease_id + " harbor_exit=" + res.harbor_exit + " record=" + join(need(f, "--out"), "session.json"));
      return 0;
    }
    if (sub === "score") {
      const [what, ...r] = rest;
      if (what === "--help" || what === undefined || r.includes("--help")) {
        console.log(HELP.split("\n").filter((l, k, a) => /^  score/.test(l) || (/^ {14}/.test(l) && a.slice(0, k).reverse().find((x) => /^  \S/.test(x))?.startsWith("  score"))).join("\n"));
        return what === undefined ? 2 : 0;
      }
      if (what === "followon") return scoreFollowonCli(r);
      if (what !== "first") throw new Error("E_USAGE sm score takes first or followon");
      const { f } = flags(r, ["--unit", "--session", "--patch", "--cell", "--out", "--mode"], ["--run-empty"]);
      const mode = f.get("--mode") ?? "hardened";
      if (mode !== "hardened" && mode !== "root") throw new Error("E_USAGE --mode is hardened or root");
      if (f.has("--session") === f.has("--patch")) throw new Error("E_USAGE give --session or --patch, not both");
      const unitDir = need(f, "--unit");
      let input: ScoreInput;
      if (f.has("--session")) {
        const s = readJson<SessionRecord>(f.get("--session")!);
        if (s.schema !== "sm-session.v1" || s.stage !== "first") throw new Error("E_SM_ARM " + f.get("--session") + " is not a first-stage sm-session.v1 record");
        if (s.unit !== readUnit(unitDir).id) throw new Error("E_SM_ARM the session is on " + s.unit + ", not this unit");
        if (!s.tree_patch) throw new Error("E_SM_ARM the session has no tree patch to score");
        input = { unitDir, patchFile: s.tree_patch.path, patchSha: s.tree_patch.sha256, cell: s.cell, model: s.model, session: s.lease_id + "/" + s.cell };
      } else input = { unitDir, patchFile: f.get("--patch")!, cell: need(f, "--cell") };
      const rec = scoreFirst({ ...input, mode, runEmpty: f.has("--run-empty") });
      writeNew(need(f, "--out"), rec);
      console.log("strict=" + (rec.strict.outcome ?? rec.codes.strict) + " adapted=" + (rec.adapted.outcome ?? rec.codes.adapted) + (rec.adapted.fell_back_to_strict ? " (strict: " + rec.adapted.fell_back_to_strict + ")" : "") + " runs=" + rec.strict.runs.length + "/" + (rec.adapted.same_tree ? "same" : rec.adapted.runs.length) + " excluded=" + rec.excluded.length + " reruns=" + (["strict", "adapted"] as const).map((k) => k + ":fix" + rec[k].reruns.fix.length + ",no_fix" + rec[k].reruns.no_fix.length + ",break" + rec[k].reruns.break.length).join("/") + " fallbacks=" + (rec.fallbacks.map((x) => x.reason + ":" + x.reading).join(",") || "none") + " record=" + need(f, "--out"));
      return 0;
    }
    throw new Error("E_USAGE unknown sm command " + JSON.stringify(sub) + "; gstack-evals outcome sm --help lists them");
  } catch (e) {
    return say(e);
  }
}
