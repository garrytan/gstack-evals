// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals outcome sm <sub>: the state machines family's commands. P1 builds source, screen, convert, draw, oracle,
// size and sample; later packages add their own.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, docAnchor, isReasonCode } from "../../../src/errors/codes.ts";
import { draw, readPrereg, type Draw, type DrawUnit } from "./draw.ts";
import { hiddenMarkdown, hiddenUnit, inSourceUnits, staticCounts, type HiddenRecord } from "./hidden.ts";
import { oracleUnit, oracleWalk, Pacer, treeVolume } from "./oracle.ts";
import { sample } from "./sample.ts";
import { screen } from "./screen.ts";
import { fetchMultiLang, manifestSize, pinCandidates, readRows, splitCandidates, type Candidate } from "./source.ts";
import { readUnit, writeUnit } from "./unit.ts";
import { rebenchCandidates, rebenchRowById } from "./rebench.ts";
import { runSession } from "./run.ts";
import { computeStart, firstInfo, scoreFollowon, treeCounts, treeScores, TREES, type FollowonRecord, type StartSet, type Tree } from "./followon.ts";
import { scoreFirst, type OutcomeRecord, type ScoreInput } from "./score.ts";
import { planPart, refuseUnscored, replicateOf, type PlannedSession, type SessionRecord } from "./session.ts";
import { LANGS, type Lang } from "./langs.ts";
import { dryrun, type DryrunConfig } from "./dryrun.ts";
import { assertContained, containImage, type ContainCheck } from "./contain.ts";
import { buildSessionImage } from "./image.ts";
import { docker } from "../../real-outcome/task/docker.ts";
import { loadRegistry, REGISTRY_PATH } from "../arms/registry.ts";
import { assertBlind, AXES, buildStock, judgeFor, judgeKey, judgePacket, LABELLERS, labelledQueue, labelledSet, labelPacket, r78Check, r78Price, readJudgeAnswer, readLabelAnswer, stockDiffs, type JudgePacket, type R78Labelled, type R78Row } from "./packets.ts";
import { foundIt, laterFix, whatChanged } from "./secondary.ts";
import { sendPackets } from "./send.ts";

export const HELP = `gstack-evals outcome sm <command>
  source fetch --cache <dir>                         download the pinned MultiLang parquet files and check their sha256
  source pin --cache <dir> --out <candidates.json>   every row to a candidate, images pinned by linux/amd64 digest
  source split <candidates.json> --cache <dir> --out <file>   the in-source test split (base files from GitHub raw)
  source rebench --export <dir> --out <candidates.json>   the pinned SWE-rebench pool's window from its Harbor packages
  screen <candidates.json> --out <file>              keyless eligibility, each drop with E_SM_INELIGIBLE and its rule
  convert <candidates.json> (--cache <dir> | --export <dir>) --id <id> --out <unit dir>
  draw <units.json> --prereg <prereg.json> --out <file>   seeded orders; units.json is [{id, repo, month, stratum}]
  oracle <draw.json> --units <dir> --candidates <file> --cache <dir> [--export <dir>] --pull-log <file> [--pulls-per-hour 60] [--retry]
  oracle hidden <candidates.json> --cache <dir> --units <dir> --pull-log <file> --out <hidden.jsonl> --md <hidden.md>
              [--ids <a,b>] [--pulls-per-hour 25] [--static-only]
                                                     the hidden-test count: each eligible in-source unit's commands on its
                                                     base tree with test.patch, then with fix-tests.patch too; ids that
                                                     passed and went missing, doctests apart; no-fail-fast in the frozen
                                                     test command; resumes past ids already in --out
  size <candidates.json> --ids <a,b> --pull-log <file>    compressed image sizes by manifest GET (paced)
  sample <candidates.json> --cache <dir> [--export <dir>] --units <dir> --ids <a,b> --pull-log <file> --out <file>
  session plan --units <a,b> --models <m,n> --prereg <prereg.json> --part <n> [--lines sm,qa] --out <plan.json>
                                                     one part's sessions in order (cells shuffled by the frozen order seed)
  session run --unit <dir> --plan <plan.json> --index <n> --control <url> --proxy <url> --out <run dir>
              [--attempt 2] [--first <session.json>] [--qa-home <dir> --qa-sha <sha>] [--harbor <bin>]
              [--scope folder|file] [--issue full|cut]
                                                     one session: its image, a Harbor run of real_agent in SM mode on the
                                                     driver at --control (gstack-evals outcome serve), and session.json;
                                                     --scope file names every file the fix patch touches (a first
                                                     stage), --issue cut sends the issue's title and first paragraph
                                                     in the cell <cell>-cut (a follow-on), section 12's two branches
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
  contain --unit <dir> --out <file> [--record <run record>] [--qa-home <dir>] [--tree-patch <file>]
                                                     the containment check before sm-admit: builds the unit's first-stage
                                                     image (with --qa-home, A3's too, at registry.json's /qa pin; with
                                                     --tree-patch, a follow-on) and checks refs, objects, object stores and
                                                     the files outside the repo; one record line per image and check;
                                                     any failure exits with E_SM_CONTAIN and the unit halts
  dryrun --config <config.json> --out-dir <dir> [--from <case>]
                                                     section 18's scorer cases on real units, one PASS or FAIL line each,
                                                     stopping at the first miss; ends DRYRUN: ok
  packets label --unit <dir> --out <packet.json> --key <key.json>
                                                     section 3's labeller packet: issue, fix and the fix's tests, no unit id
  packets judge --diff <file> --files <list> --unit <id> --model <m> --cell <name> --out <packet.json> --key <key.json>
                                                     section 10's judge packet: the folder's file list and the diff cut at
                                                     1,500 lines; arm, model and session go only in the key
  packets stock --lang <lang> --tree <dir> --file <path> --files <list> --unit <id> --unit-dir <dir> --model <m> --out-dir <dir>
                                                     the three stock diffs from one file of the unit's own tree, each
                                                     built in the unit's runtime image first; one that fails is none
                                                     (stock-build-<unit>.json)
  packets read label|judge --answer <file> [--packet <packet.json>]
                                                     reads one reply strictly; a malformed one exits 1 (E_SM_JUDGE_ANSWER)
  packets labelled --spec <spec.json> --out-dir <dir>  the R78 labelled set from [{unit, unit_dir, lang, tree, file, files}] in
                                                     draw order, each unit's stock diffs built first (stock-build.json)
  packets queue --labelled <dir> --real <ids.txt> --out-dir <dir>  each judge's labelled queue (queue-<judge>.json), its seed
                                                     minted once and reused on a rerun; ids are the labelled packets and the real ones
  packets r78 --real <rows.json> --labelled <rows.json> --out <file>  the R78 check (a Astra, b Opus); labelled rows add kind, axis
  packets r78-price                                   the sm-judges calls priced at the per-call bound, against the item cap
  packets send --item sm-labels|sm-judges --run <id> --packets <dir> --out <dir> [--record <dir>] [--ledger <file>] [--lift-halt <meter,...>]
                                                     the paid step: each packet to its readers (labels: Astra and Opus;
                                                     judges: the key's judge, and both on queued items), one call at a
                                                     time on the item's own lease, each reserving its packet's byte worst
                                                     case; a call past 20,000 input or 1,500 output tokens halts the item
                                                     until --lift-halt records the Captain's ruling; replies.jsonl in --out
  secondary --unit <dir> --patch <arm.patch> [--outcome <outcome.json>] [--tree <base dir>] [--clone <dir>] --out <file>
                                                     section 10's keyless secondaries: found it, what it changed and, with
                                                     a local clone, later-fix overlap
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
      refuseUnscored(s);
      treePatch = readFileSync(s.tree_patch.path, "utf8");
      if (createHash("sha256").update(treePatch).digest("hex") !== s.tree_patch.sha256) throw new Error("E_SM_ARM " + s.tree_patch.path + " is not the patch the first-stage record pins");
    } else treePatch = readFileSync(f.get("--tree-patch")!, "utf8");
  } else if (f.has("--first") || f.has("--tree-patch")) throw new Error("E_USAGE S0 takes no first-stage patch");
  const fo = f.has("--first-outcome") ? readJson<OutcomeRecord>(f.get("--first-outcome")!) : null;
  if (fo && (fo.schema !== "sm-outcome.v1" || fo.stage !== "first")) throw new Error("E_SM_ARM " + f.get("--first-outcome") + " is not a first-stage sm-outcome.v1 record");
  let followon: SessionRecord | null = null, patchFile: string, patchSha: string | undefined, cell: string;
  if (f.has("--session")) {
    followon = readJson<SessionRecord>(f.get("--session")!);
    if (followon.schema !== "sm-session.v1" || followon.stage !== "followon" || followon.unit !== u.id || followon.tree_ref?.tree !== tree) throw new Error("E_SM_ARM " + f.get("--session") + " is not a follow-on sm-session.v1 record on " + u.id + " tree " + tree);
    cell = followon.cell;
    patchFile = followon.tree_patch?.path ?? "";
    patchSha = followon.tree_patch?.sha256;
    if (!patchFile && followon.end !== "upstream" && followon.end !== "infra") throw new Error("E_SM_ARM the follow-on session has no tree patch to score");
  } else {
    patchFile = f.get("--patch")!;
    cell = need(f, "--cell");
  }
  const startFile = need(f, "--start");
  const model = followon?.model ?? fo?.model ?? null;
  let start: StartSet;
  if (existsSync(startFile)) start = readJson<StartSet>(startFile);
  else {
    start = computeStart({ unitDir, tree, treePatch, model, mode });
    writeNew(startFile, start);
  }
  const replicate = replicateOf(cell);
  const rec = scoreFollowon({ unitDir, tree, treePatch, start, patchFile, ...(patchSha ? { patchSha } : {}), cell, replicate, model, session: followon, first: fo ? firstInfo(fo) : null, mode });
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
/** A candidate's row: MultiLang's from the parquet cache, a rebench task's from its Harbor package in the export. */
const rowFor = (c: Candidate, f: Map<string, string>) => (c.source === "rebench-r3a4" ? rebenchRowById(need(f, "--export"), c.id) : rowOf(need(f, "--cache"), c.id));
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
      if (what === "rebench") {
        const { f } = flags(r, ["--export", "--out"]);
        const c = await rebenchCandidates(need(f, "--export"));
        writeNew(need(f, "--out"), { schema: "sm-candidates.v1", rows: c.length, candidates: c });
        console.log("candidates=" + c.length + " pinned=" + c.filter((x) => x.image_digest).length);
        return 0;
      }
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
      const { pos, f } = flags(rest, ["--cache", "--export", "--id", "--out"]);
      const id = need(f, "--id");
      const c = loadCands(pos[0]!).find((x) => x.id === id);
      if (!c) throw new Error("E_USAGE no candidate " + id);
      const u = writeUnit(need(f, "--out"), c, rowFor(c, f));
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
      const { pos, f } = flags(rest, ["--units", "--candidates", "--cache", "--export", "--pull-log", "--pulls-per-hour"], ["--retry"]);
      const d = readJson<Draw>(pos[0]!);
      const units = need(f, "--units"), cands = loadCands(need(f, "--candidates"));
      const pacer = new Pacer(need(f, "--pull-log"), Number(f.get("--pulls-per-hour") ?? 60));
      mkdirSync(units, { recursive: true });
      const w = await oracleWalk(d, async (id) => {
        const dir = join(units, id);
        const c = cands.find((x) => x.id === id)!;
        if (!existsSync(dir)) writeUnit(dir, c, rowFor(c, f));
        const prior = readUnit(dir).oracle?.verdict;
        const v = prior && prior !== "running" && prior !== "E_SM_INFRA_GAP" ? { id, verdict: prior, detail: "recorded" } : await oracleUnit(dir, pacer);
        console.log("ORACLE " + id + " " + v.verdict + " " + v.detail.replace(/\n/g, " ").slice(0, 300));
        return { verdict: v.verdict, lang: c.lang, reason: readUnit(dir).oracle?.reason };
      }, { retry: f.has("--retry") });
      const res = w.fill;
      writeFileSync(join(units, "fill.json"), JSON.stringify(res, null, 1) + "\n");
      console.log("admission=" + res.admission.length + " state=" + res.state.length + " other=" + res.other.length + " reserve=" + res.reserve.length + " retry=" + res.retry.length + " drops=" + JSON.stringify(w.drops));
      for (const [lang, n] of Object.entries(w.infra)) console.log("infra_errors " + lang + "=" + n + " (neither kept nor dropped; rerun resumes them)");
      if (w.final) return 0;
      console.error("E_SM_INFRA_GAP the fill is not final: " + res.infra.join(", ") + " hit an infra error, neither kept nor dropped; rerun sm oracle to resume them");
      return 2;
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
      const { pos, f } = flags(rest, ["--cache", "--export", "--units", "--ids", "--pull-log", "--out"]);
      const cands = loadCands(pos[0]!);
      await sample({ candidates: cands, cache: f.get("--cache") ?? "", units: need(f, "--units"), ids: need(f, "--ids").split(","), pacer: new Pacer(need(f, "--pull-log")), out: need(f, "--out"), row: (id) => rowFor(cands.find((x) => x.id === id)!, f) });
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
      const { f } = flags(r, ["--unit", "--plan", "--index", "--control", "--proxy", "--out", "--attempt", "--first", "--qa-home", "--qa-sha", "--harbor", "--scope", "--issue"]);
      const scope = f.get("--scope"), issue = f.get("--issue");
      if (scope !== undefined && scope !== "folder" && scope !== "file") throw new Error("E_USAGE --scope is folder or file");
      if (issue !== undefined && issue !== "full" && issue !== "cut") throw new Error("E_USAGE --issue is full or cut");
      const index = Number(need(f, "--index"));
      const session = readJson<{ sessions: PlannedSession[] }>(need(f, "--plan")).sessions.find((x) => x.index === index);
      if (!session) throw new Error("E_USAGE the plan has no session " + index);
      const attempt = Number(f.get("--attempt") ?? 1);
      if (attempt !== 1 && attempt !== 2) throw new Error("E_USAGE --attempt is 1 or 2");
      const res = runSession({ unitDir: need(f, "--unit"), session, control: need(f, "--control"), proxy: need(f, "--proxy"), out: need(f, "--out"), attempt, ...(f.has("--first") ? { first: f.get("--first")! } : {}), ...(f.has("--qa-home") ? { qaHome: f.get("--qa-home")! } : {}), ...(f.has("--qa-sha") ? { qaSha: f.get("--qa-sha")! } : {}), ...(f.has("--harbor") ? { harbor: f.get("--harbor")! } : {}), ...(scope ? { scope } : {}), ...(issue ? { issue } : {}) });
      console.log("session=" + res.record.cell + " end=" + res.record.end + " image=" + res.image.image_id + " lease=" + res.record.lease_id + " harbor_exit=" + res.harbor_exit + " record=" + join(need(f, "--out"), "session.json"));
      return 0;
    }
    if (sub === "contain") {
      const { f } = flags(rest, ["--unit", "--out", "--record", "--qa-home", "--tree-patch"]);
      const dir = need(f, "--unit");
      const u = readUnit(dir);
      const qaPin = f.has("--qa-home") ? (loadRegistry(REGISTRY_PATH).sm?.pins?.qa?.sha ?? (() => { throw new Error("E_SM_ARM A3's image needs the /qa pin recorded in registry.json sm.pins.qa"); })()) : undefined;
      const builds: Array<{ image: "first" | "qa" | "followon"; o: Parameters<typeof buildSessionImage>[1] }> = [
        { image: "first", o: { volume: treeVolume(u.id), stage: "first" } },
        ...(f.has("--qa-home") ? [{ image: "qa" as const, o: { volume: treeVolume(u.id), stage: "first" as const, qaHome: f.get("--qa-home")! } }] : []),
        ...(f.has("--tree-patch") ? [{ image: "followon" as const, o: { volume: treeVolume(u.id), stage: "followon" as const, treePatch: readFileSync(f.get("--tree-patch")!, "utf8") } }] : []),
      ];
      const images = builds.map((b) => {
        const img = buildSessionImage(u, b.o);
        try {
          return { image: b.image, head: img.head, ...containImage(img, u, dir, b.image === "qa" ? qaPin : undefined) };
        } finally {
          docker(["image", "rm", "-f", img.tag], { timeoutMs: 120_000 });
        }
      });
      const ok = images.every((i) => i.ok);
      writeNew(need(f, "--out"), { schema: "sm-contain.v1", unit: u.id, ok, images });
      for (const i of images) {
        for (const check of ["refs", "objects", "stores", "scan"] as ContainCheck[]) {
          const c = i.checks[check];
          const line = { event: "sm_contain", unit: u.id, image: i.image, head: i.head, check, ok: c.ok, findings: c.findings, ...(check === "scan" ? { archives: i.archives.length, archive_paths: i.archives } : {}) };
          if (f.has("--record")) appendFileSync(f.get("--record")!, JSON.stringify(line) + "\n");
          console.log("contain unit=" + u.id + " image=" + i.image + " check=" + check + " " + (c.ok ? "ok" : "fail findings=" + c.findings.length) + (check === "scan" ? " archives=" + i.archives.length : ""));
        }
      }
      for (const i of images) assertContained(u.id + " (" + i.image + " image)", i);
      return 0;
    }
    if (sub === "dryrun") {
      const { f } = flags(rest, ["--config", "--out-dir", "--from"]);
      return dryrun(readJson<DryrunConfig>(need(f, "--config")), need(f, "--out-dir"), f.has("--from") ? { from: f.get("--from")! } : {});
    }
    if (sub === "packets") {
      const [what, ...r] = rest;
      if (what === "label") {
        const { f } = flags(r, ["--unit", "--out", "--key"]);
        const { packet, key } = labelPacket(need(f, "--unit"));
        assertBlind(packet, [key.unit]);
        writeNew(need(f, "--out"), packet);
        writeNew(need(f, "--key"), key);
        console.log("packet=" + packet.packet + " issue_chars=" + packet.issue.length + " record=" + need(f, "--out"));
        return 0;
      }
      if (what === "judge") {
        const { f } = flags(r, ["--diff", "--files", "--unit", "--model", "--cell", "--out", "--key"]);
        const model = need(f, "--model");
        judgeFor(model);
        const files = readFileSync(need(f, "--files"), "utf8").split("\n").filter(Boolean);
        const { packet, lines_total } = judgePacket({ diff: readFileSync(need(f, "--diff"), "utf8"), files });
        assertBlind(packet, [model, need(f, "--unit")]);
        writeNew(need(f, "--out"), packet);
        writeNew(need(f, "--key"), judgeKey(packet, { unit: need(f, "--unit"), model, cell: need(f, "--cell"), lines_total, stock: null }));
        console.log("packet=" + packet.packet + " lines=" + lines_total + " cut=" + packet.cut + " hunks=" + packet.hunks.length + " judge=" + judgeFor(model));
        return 0;
      }
      if (what === "stock") {
        const { f } = flags(r, ["--lang", "--tree", "--file", "--files", "--unit", "--unit-dir", "--model", "--out-dir"]);
        const lang = need(f, "--lang") as Lang;
        if (!LANGS.includes(lang)) throw new Error("E_USAGE --lang is one of " + LANGS.join(", "));
        const path = need(f, "--file"), out = need(f, "--out-dir"), model = need(f, "--model"), unitDir = need(f, "--unit-dir");
        const held = readUnit(unitDir).id;
        if (held !== need(f, "--unit")) throw new Error("E_USAGE --unit " + need(f, "--unit") + " is not the unit in --unit-dir, which holds " + held);
        const files = readFileSync(need(f, "--files"), "utf8").split("\n").filter(Boolean);
        const built = buildStock(unitDir, path, stockDiffs({ lang, path, text: readFileSync(join(need(f, "--tree"), path), "utf8") }));
        mkdirSync(out, { recursive: true });
        writeNew(join(out, "stock-build-" + need(f, "--unit") + ".json"), { schema: "sm-stock-build.v1", unit: need(f, "--unit"), file: path, commands: built.commands, control: built.control, kinds: built.kinds.map((s) => ({ kind: s.kind, build: s.build })) });
        const made: string[] = [];
        for (const s of built.kinds) {
          if (s.diff === null) { made.push(s.kind + ":none(" + s.build + ")"); continue; }
          const { packet, lines_total } = judgePacket({ diff: s.diff, files });
          writeNew(join(out, packet.packet + ".json"), packet);
          writeNew(join(out, packet.packet + ".key.json"), judgeKey(packet, { unit: need(f, "--unit"), model, cell: "stock", lines_total, stock: s.kind }));
          made.push(s.kind + ":" + packet.packet);
        }
        console.log("stock " + made.join(" "));
        return 0;
      }
      if (what === "read") {
        const [kind, ...rr] = r;
        const { f } = flags(rr, ["--answer", "--packet"]);
        const reply = readFileSync(need(f, "--answer"), "utf8");
        const res = kind === "label" ? readLabelAnswer(reply) : kind === "judge" ? readJudgeAnswer(reply, readJson<JudgePacket>(need(f, "--packet"))) : (() => { throw new Error("E_USAGE sm packets read takes label or judge"); })();
        if (!res.ok) {
          console.error(res.code + " " + res.why);
          return 1;
        }
        console.log(JSON.stringify(res.answer));
        return 0;
      }
      if (what === "labelled") {
        const { f } = flags(r, ["--spec", "--out-dir"]);
        const out = need(f, "--out-dir");
        const spec = readJson<Array<{ unit: string; unit_dir: string; lang: Lang; tree: string; file: string; files: string }>>(need(f, "--spec"));
        const missing = spec.filter((u) => !u.unit_dir).map((u) => u.unit);
        if (missing.length) throw new Error("E_USAGE spec entries " + missing.join(", ") + " have no unit_dir, the unit dir their stock diffs build in");
        const twice = [...new Set(spec.map((u) => u.unit).filter((u, i, a) => a.indexOf(u) !== i))];
        if (twice.length) throw new Error("E_USAGE spec lists " + twice.join(", ") + " more than once");
        for (const u of spec) {
          const held = readUnit(u.unit_dir).id;
          if (held !== u.unit) throw new Error("E_USAGE spec entry " + u.unit + " is not the unit in its unit_dir, which holds " + held);
        }
        const dirs = new Map(spec.map((u) => [u.unit, u.unit_dir]));
        const set = labelledSet(spec.map((u) => ({ unit: u.unit, lang: u.lang, path: u.file, text: readFileSync(join(u.tree, u.file), "utf8"), files: readFileSync(u.files, "utf8").split("\n").filter(Boolean) })), (u, stock) => buildStock(dirs.get(u.unit)!, u.path, stock).kinds);
        mkdirSync(out, { recursive: true });
        writeNew(join(out, "stock-build.json"), { schema: "sm-stock-build.v1", units: set.built });
        for (const it of set.items) {
          writeNew(join(out, it.packet.packet + ".json"), it.packet);
          writeNew(join(out, it.packet.packet + ".key.json"), it.key);
        }
        console.log("labelled items=" + set.items.length + " bad=" + set.items.filter((x) => x.key.kind === "bad").length + " neutral=" + set.items.filter((x) => x.key.kind === "neutral").length + " skipped=" + (set.skipped.join(",") || "none"));
        return 0;
      }
      if (what === "queue") {
        const { f } = flags(r, ["--labelled", "--real", "--out-dir"]);
        const lab = need(f, "--labelled");
        const out = need(f, "--out-dir");
        const ids = [...readdirSync(lab).filter((n) => n.endsWith(".key.json")).map((n) => readJson<{ packet: string }>(join(lab, n)).packet), ...readFileSync(need(f, "--real"), "utf8").split("\n").filter(Boolean)];
        mkdirSync(out, { recursive: true });
        for (const judge of Object.keys(LABELLERS)) {
          const q = labelledQueue(join(out, "queue-" + judge + ".json"), ids);
          console.log("queue judge=" + judge + " items=" + q.order.length + " seed=" + q.seed);
        }
        return 0;
      }
      if (what === "r78") {
        const { f } = flags(r, ["--real", "--labelled", "--out"]);
        const res = r78Check({ real: readJson<R78Row[]>(need(f, "--real")), labelled: readJson<R78Labelled[]>(need(f, "--labelled")) });
        writeNew(need(f, "--out"), { schema: "sm-r78.v2", ...res });
        const k = AXES.map((a) => a + "=" + res.axes[a].kappa).join(",");
        for (const [j, v] of Object.entries(res.judges)) console.log(j + " catch=" + v.catch.caught + "/" + v.catch.n + " false_fail=" + v.false_fail.failed + "/" + v.false_fail.n + " stock_above=" + v.stock_above.above + " malformed=" + v.malformed + " kappa " + k);
        console.log(AXES.map((a) => a + ":kappa=" + res.axes[a].kappa + ",n=" + res.axes[a].n + "," + res.axes[a].reading).join(" "));
        console.log(res.agreement);
        return 0;
      }
      if (what === "r78-price") {
        const p = r78Price();
        console.log("sm-judges calls " + Object.entries(p.calls).map(([k, v]) => k + "=" + v).join(" ") + " bound in=" + p.bound.input_tokens + " out=" + p.bound.output_tokens + " per_call astra=" + p.per_call_usd.astra.toFixed(4) + " opus=" + p.per_call_usd.opus.toFixed(4));
        console.log("sm-judges usd=" + p.usd.toFixed(2) + " cap=" + p.cap_usd + " fits=" + p.fits);
        return p.fits ? 0 : 1;
      }
      if (what === "send") {
        const { f } = flags(r, ["--item", "--run", "--packets", "--out", "--record", "--ledger", "--lift-halt"]);
        const s = await sendPackets({ item: need(f, "--item"), run_id: need(f, "--run"), packets: need(f, "--packets"), out: need(f, "--out"), record: f.get("--record"), ledger: f.get("--ledger"), lift_halts: f.get("--lift-halt")?.split(",").filter(Boolean) });
        console.log("send item=" + s.item + " run=" + s.run_id + " lease=" + (s.lease_id ?? "none") + " sent=" + s.sent + " " + Object.entries(s.counts).map(([k, v]) => k + "=" + v).join(" ") + " spent_micros=" + s.spent_micros + " unknown_micros=" + s.unknown_micros + " replies=" + s.replies);
        return 0;
      }
      console.log(HELP.split("\n").filter((l, k, a) => /^  packets/.test(l) || (/^ {14}/.test(l) && a.slice(0, k).reverse().find((x) => /^  \S/.test(x))?.startsWith("  packets"))).join("\n"));
      return what === undefined || what === "--help" ? (what ? 0 : 2) : 2;
    }
    if (sub === "secondary") {
      const { f } = flags(rest, ["--unit", "--patch", "--outcome", "--tree", "--clone", "--out"]);
      const unitDir = need(f, "--unit");
      const u = readUnit(unitDir);
      const arm = readFileSync(need(f, "--patch"), "utf8");
      const fix = readFileSync(join(unitDir, "fix.patch"), "utf8");
      const o = f.has("--outcome") ? readJson<{ strict?: { outcome?: string | null } }>(f.get("--outcome")!) : null;
      const fixed = o?.strict?.outcome ? o.strict.outcome === "clean_fix" || o.strict.outcome === "fix_broke" : null;
      const tree = f.get("--tree");
      const readBase = (p: string) => (tree && existsSync(join(tree, p)) ? readFileSync(join(tree, p), "utf8") : null);
      const found = foundIt(arm, fix, fixed);
      const changed = whatChanged(arm, { lang: u.lang, scopeDir: u.scope?.dir ?? null, testFiles: u.test_patch.files, readBase });
      const later = f.has("--clone") ? laterFix(arm, fix, f.get("--clone")!, { base: u.base_commit, pull: u.pull_number }) : null;
      writeNew(need(f, "--out"), { schema: "sm-secondary.v1", unit: u.id, patch_sha256: createHash("sha256").update(arm).digest("hex"), found, changed, later_fix: later, later_fix_skipped: later ? null : "no --clone" });
      console.log("found=" + found.found + " nearest=" + found.nearest + " files=" + changed.files + " lines=+" + changed.lines.added + "/-" + changed.lines.removed + " generated=" + changed.generated.length + " constructs=" + JSON.stringify(changed.state_constructs) + (later ? " later_outside=" + later.outside + " later_overlapping=" + later.overlapping + " candidates=" + later.candidates + " excluded=" + later.excluded.length : " later=skipped"));
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
        refuseUnscored(s);
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
