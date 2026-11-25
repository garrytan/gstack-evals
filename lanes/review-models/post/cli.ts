// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals rm-post: the review-models pilot's steps after its review sessions finish, up to the readout the Captain
// gets before any counted unit (GEVA-590; README.md beside this file lists the order). key, contamination and readout are
// keyless. judge-send and second-read-send are paid: each opens one lease on the ledger item the Captain recorded for it
// and needs the provider keys by name, a rig admission record and the item's cap. desk-package and labels-import are
// keyless: people make the judge check's labels through the labelling desk (pre-run changes 5 and 6), and label-send,
// the retired model labeller, refuses.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { CODES, docAnchor, isReasonCode } from "../../../src/errors/codes.ts";
import { readContamination, writeContamination, type ReviewInput } from "../../../src/trial/review/contamination.ts";
import { rawAdvisory, type BRecord } from "../../../src/trial/review/supply/b-units.ts";
import type { Draw } from "../../../src/trial/review/supply/draw.ts";
import type { PRecord } from "../../../src/trial/review/supply/p-units.ts";
import { rmFail } from "../score/frozen.ts";
import { buildKey, type KeySources } from "./key.ts";
import { BATCHES, loadPilot, readKey, type Batch, type Pilot } from "./pilot.ts";
import { pilotReadout, renderReadout } from "./readout.ts";
import type { FinalRow } from "../score/labels.ts";
import { deskPackage, finalPath, importFirst, importThird, pilotBatch, SHAPES, type Shape } from "./desk.ts";
import { judgeSend, secondReadSend, type SendOptions } from "./send.ts";

const HELP = [
  "gstack-evals rm-post <subcommand> [options]: the review-models pilot after its review sessions (GEVA-590).",
  "",
  "  key --draw <json> --p <jsonl> --b <jsonl> --frame <b2-frame.json> --sources <dir> --out <key.json>",
  "  contamination --run <out dir> --key <key.json> --post <dir> [--batch pilot|validation] [--journal <proxy journal>]...",
  "  second-read-send --post <dir> --run-id <id> --item <ledger item>                     (paid: Astra and Opus)",
  "  judge-send --run <dir> --key <key.json> --post <dir> [--batch pilot|validation] --run-id <id> --item <ledger item>  (paid: Gemini 4 Carbon)",
  "  desk-package --run <dir> --key <key.json> --post <dir> --desk <labelling root> [--batch pilot|validation] [--shape review|finding]",
  "      writes seat A's and seat B's packages, <desk>/geva590-review-labels-<batch>-a/ and -b/, and the code task; the",
  "      screen key and seat B's subset stay in <post>/labels/people/",
  "  labels-import --run <dir> --key <key.json> --post <dir> [--batch pilot|validation] --file <seat A's file> --file <seat B's file>",
  "      reads seat A's and seat B's labels files; subset reviews they read differently go to seat C's package,",
  "      <desk>/geva590-review-labels-<batch>-c/, and with no disagreement the final labels land in <post>/labels/",
  "  labels-import --run <dir> --key <key.json> --post <dir> [--batch pilot|validation] --file <seat C's file> --round third",
  "      reads seat C's file; each review it holds takes the majority of three, and the final labels land",
  "      in <post>/labels/ (final.json for the pilot, final-validation.json for the validation batch)",
  "  label-send                                                    (retired: people make the labels; it refuses)",
  "  readout --run <dir> --key <key.json> --post <dir> --history <stage1 per-pass csv> --md <file>",
  "",
  "The key, the post dir and the history CSV name fixes and labels: keep them outside the repository. The readout's",
  "Markdown names units by opaque label only.",
].join("\n");

const VALUED = ["--draw", "--p", "--b", "--frame", "--sources", "--out", "--run", "--key", "--post", "--journal", "--run-id", "--item", "--history", "--md", "--desk", "--shape", "--file", "--round", "--batch"];

function flags(argv: readonly string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!, v = argv[i + 1];
    if (!VALUED.includes(k) || v === undefined) rmFail("E_RM_POST_INPUT", "unknown or empty option " + JSON.stringify(k) + "; gstack-evals rm-post --help lists them");
    m.set(k, [...(m.get(k) ?? []), v!]);
  }
  return m;
}
const need = (f: Map<string, string[]>, k: string): string => f.get(k)?.at(-1) ?? rmFail("E_RM_POST_INPUT", "pass " + k);
const jsonl = <T>(path: string): T[] => readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const LOCKS = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|composer\.lock|Gemfile\.lock|Pipfile\.lock)$/;
const BUILT = /(^|\/)(dist|build)\/|\.min\.(js|css)$|\.map$/;

function git(clone: string, args: string[]): string {
  const r = spawnSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) rmFail("E_RM_POST_INPUT", "git " + args[0] + " failed in " + clone + ": " + (r.stderr ?? "").trim().slice(0, 300));
  return r.stdout;
}

/** The key's readers over full local clones under sources (owner__repo, as rm-supply build reads them). */
export function gitSources(sources: string, frameCommit: string, advisories: Map<string, string>): KeySources {
  const clone = (repo: string) => join(sources, repo.replace("/", "__"));
  const read = rawAdvisory(frameCommit);
  return {
    diff: (repo, from, to) => {
      const paths = git(clone(repo), ["diff", "--name-only", from, to]).split("\n").filter((p) => p && !LOCKS.test(p) && !BUILT.test(p));
      return paths.length ? git(clone(repo), ["diff", from, to, "--", ...paths]) : "";
    },
    diffLines: (repo, base, head) => git(clone(repo), ["diff", "--numstat", base + "..." + head]).split("\n").filter(Boolean).reduce((s, l) => {
      const [a, d] = l.split("\t");
      return s + (Number(a) || 0) + (Number(d) || 0);
    }, 0),
    advisory: (ghsa) => {
      const path = advisories.get(ghsa);
      const osv = path ? read(path) : null;
      return osv ? { summary: String(osv.summary ?? ""), details: String(osv.details ?? "") } : null;
    },
  };
}

function keyCmd(f: Map<string, string[]>): number {
  const frame = JSON.parse(readFileSync(need(f, "--frame"), "utf8"));
  const draw = JSON.parse(readFileSync(need(f, "--draw"), "utf8")) as Draw;
  const k = buildKey(draw, jsonl<PRecord>(need(f, "--p")), jsonl<BRecord>(need(f, "--b")), gitSources(need(f, "--sources"), frame.source.commit, new Map(frame.advisories.map((a: any) => [a.ghsa, a.advisory_path]))));
  write(need(f, "--out"), JSON.stringify(k, null, 2) + "\n");
  console.log("post key: " + k.pilot.length + " pilot units (" + k.pilot.filter((u) => u.pool === "P").length + " P, " + k.pilot.filter((u) => u.pool === "B").length + " B, " + k.pilot.filter((u) => u.pool === "decoy").length + " decoy); " + k.validation!.length + " validation units; counted set " + k.counted.p + " P, " + k.counted.b + " B, " + k.counted.decoys + " decoys");
  return 0;
}

function batchOf(f: Map<string, string[]>): Batch {
  const b = f.get("--batch")?.at(-1) ?? "pilot";
  if (!BATCHES.includes(b as Batch)) rmFail("E_RM_POST_INPUT", "--batch is pilot or validation, not " + JSON.stringify(b));
  return b as Batch;
}

const pilotOf = (f: Map<string, string[]>): Pilot => loadPilot(need(f, "--run"), readKey(need(f, "--key")), need(f, "--post"), batchOf(f));

/** Every review whose session ran and left a transcript, as contamination.ts reads it. */
export const contaminationInputs = (pilot: Pilot): ReviewInput[] =>
  pilot.reviews.filter((r) => r.termination !== "not run" && existsSync(join(r.host, "transcript.ndjson"))).map((r) => ({ review: r.id, arm: r.arm, unit: r.unit, transcript: join(r.host, "transcript.ndjson"), voice: r.arm !== "N", voice_sessions: r.host, meter_ids: r.meter_ids }));

function contaminationCmd(f: Map<string, string[]>): number {
  const pilot = pilotOf(f);
  const journals = (f.get("--journal") ?? []).map((p) => readFileSync(p, "utf8"));
  const report = readContamination(contaminationInputs(pilot), pilot.markers, journals);
  const { cases } = writeContamination(join(need(f, "--post"), "contamination"), report, pilot.markers);
  console.log("contamination: " + report.reviews.length + " sessions read, " + report.contaminated.length + " contaminated, " + cases + " doubtful cases for the second read" + (journals.length ? "" : "; no proxy journal given, so removed web_search tools count 0"));
  for (const a of report.arms) console.log("  " + a.arm + ": " + a.attempted_searches + " attempted searches, " + a.removed_web_search_tools + " removed web_search tools, " + a.contaminated_reviews + " contaminated, " + a.doubtful_reviews + " doubtful");
  return 0;
}

const sendOptions = (f: Map<string, string[]>): SendOptions => ({ run_id: need(f, "--run-id"), item: need(f, "--item") });
const settled = (r: { sent: number; spent_usd: number; unknown_usd: number }) => r.sent + " calls sent; settled " + r.spent_usd.toFixed(2) + " USD spent, " + r.unknown_usd.toFixed(2) + " USD unknown";

async function judgeCmd(f: Map<string, string[]>): Promise<number> {
  const r = await judgeSend(pilotOf(f), need(f, "--post"), sendOptions(f));
  console.log("judge: " + r.judged + " reviews judged, " + r.failed + " failed twice (ruled can't tell); " + settled(r));
  return 0;
}

async function secondReadCmd(f: Map<string, string[]>): Promise<number> {
  const r = await secondReadSend(need(f, "--post"), sendOptions(f));
  console.log("second read: " + r.cases + " cases, " + r.contaminated + " contaminated, " + r.clean + " clean, " + r.failed + " unread after the retry; " + settled(r));
  return 0;
}

function deskCmd(f: Map<string, string[]>): number {
  const shape = f.get("--shape")?.at(-1);
  if (shape !== undefined && !SHAPES.includes(shape as Shape)) rmFail("E_RM_POST_INPUT", "--shape is review or finding, not " + JSON.stringify(shape));
  const post = need(f, "--post");
  const batch = batchOf(f);
  const r = deskPackage({ reviews: pilotBatch(pilotOf(f)), batch, desk: need(f, "--desk"), post, shape: shape as Shape | undefined });
  console.log("desk packages (" + r.key.shape + " question, on hold): seat A " + r.dirs.A + ", " + r.labelled + " reviews on " + r.screens.A + " screens; seat B " + r.dirs.B + ", a subset of " + r.subset + " on " + r.screens.B + " screens; " + r.key.auto_no.length + " with no findings labelled no; privacy checks passed");
  console.log("  code task for every labeller: " + r.code_task + "; the screen key stays in " + join(post, "labels", "people", batch) + " and never goes with the packages");
  return 0;
}

function importCmd(f: Map<string, string[]>): number {
  const round = f.get("--round")?.at(-1) ?? "first";
  if (round !== "first" && round !== "third") rmFail("E_RM_POST_INPUT", "--round is first or third, not " + JSON.stringify(round));
  const files = (f.get("--file") ?? []).map((p) => ({ name: p, text: readFileSync(p, "utf8") }));
  const post = need(f, "--post");
  const batch = batchOf(f);
  if (round === "third" && files.length !== 1) rmFail("E_RM_POST_LABELS", "the third round takes exactly one labels file, seat C's, not " + files.length);
  const r = round === "first" ? importFirst({ post, batch, files, reviews: pilotBatch(pilotOf(f)) }) : importThird({ post, batch, file: files[0]! });
  console.log("labels-import (" + batch + ", " + round + "): " + r.reviews + " reviews; on the subset of " + r.subset + ", seats A and B read " + r.agreed + " alike and " + r.disagreements + " differently" + (r.final ? "; " + r.unresolved + " unresolved; wrote " + finalPath(post, batch) : "; seat C's package is at " + r.third));
  return 0;
}

function readoutCmd(f: Map<string, string[]>): number {
  if (batchOf(f) !== "pilot") rmFail("E_RM_POST_INPUT", "readout reads the pilot batch only; the validation batch's labels join the kappa gate's rows instead");
  const pilot = pilotOf(f);
  const post = need(f, "--post");
  const finalFile = finalPath(post);
  const final: FinalRow[] | null = existsSync(finalFile) ? JSON.parse(readFileSync(finalFile, "utf8")) : null;
  const r = pilotReadout(pilot, final, need(f, "--history"));
  const md = renderReadout(r, pilot);
  write(need(f, "--md"), md);
  write(join(post, "labels", "check-rows.jsonl"), r.check_rows.map((row) => JSON.stringify(row) + "\n").join(""));
  console.log(md);
  return r.proceed.set === "stop" ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return sub ? 0 : 2;
  }
  try {
    const f = flags(rest);
    if (sub === "key") return keyCmd(f);
    if (sub === "contamination") return contaminationCmd(f);
    if (sub === "judge-send") return await judgeCmd(f);
    if (sub === "second-read-send") return await secondReadCmd(f);
    if (sub === "desk-package") return deskCmd(f);
    if (sub === "labels-import") return importCmd(f);
    if (sub === "label-send") return rmFail("E_RM_POST_RETIRED", "label-send is retired: engineers make the judge-check labels through the labelling desk (pre-run changes 5 to 7, R125); run rm-post desk-package, then rm-post labels-import");
    if (sub === "readout") return readoutCmd(f);
    return rmFail("E_RM_POST_INPUT", "unknown subcommand " + JSON.stringify(sub) + "; gstack-evals rm-post --help lists them");
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code !== "string" || !isReasonCode(code)) throw e;
    console.error((e as Error).message + "\n" + code + " fix: " + CODES[code].fix + "\n" + code + " docs: " + docAnchor(code));
    return 2;
  }
}
