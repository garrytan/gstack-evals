// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals rm-post: the review-models pilot's steps after its review sessions finish, up to the readout the Captain
// gets before any counted unit (GEVA-590; README.md beside this file lists the order). key, contamination and readout are
// keyless. judge-send and second-read-send are paid: each opens one lease on the ledger item the Captain recorded for it
// and needs the provider keys by name, a rig admission record and the item's cap. label-send is paid too: Grok 4.7 labels
// the judge check, with Kimi K3.1 Pro as its fallback (pre-run change 9). desk-package and labels-import, the retired
// person-label path, refuse.
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
import { finalPath, judgeSend, labelSend, pilotBatch, secondReadSend, type SendOptions } from "./send.ts";

const HELP = [
  "gstack-evals rm-post <subcommand> [options]: the review-models pilot after its review sessions (GEVA-590).",
  "",
  "  key --draw <json> --p <jsonl> --b <jsonl> --frame <b2-frame.json> --sources <dir> --out <key.json>",
  "  contamination --run <out dir> --key <key.json> --post <dir> [--batch pilot|validation] [--journal <proxy journal>]...",
  "  second-read-send --post <dir> --run-id <id> --item <ledger item>                     (paid: Astra and Opus)",
  "  judge-send --run <dir> --key <key.json> --post <dir> [--batch pilot|validation] --run-id <id> --item <ledger item>  (paid: Gemini 4 Carbon)",
  "  label-send --run <dir> --key <key.json> --post <dir> [--batch pilot|validation] --run-id <id> --item <ledger item>  (paid: Grok 4.7, Kimi K3.1 Pro)",
  "      labels every bug-unit review the judge check takes; the labels land in <post>/labels/ (final.json for the",
  "      pilot, final-validation.json for the validation batch)",
  "  desk-package, labels-import                                   (retired: no people label; they refuse)",
  "  readout --run <dir> --key <key.json> --post <dir> --history <stage1 per-pass csv> --md <file> [--validation-run <dir>]",
  "      with --validation-run and final-validation.json in the post dir, it adds the R78 gate on both batches' labels",
  "",
  "The key, the post dir and the history CSV name fixes and labels: keep them outside the repository. The readout's",
  "Markdown names units by opaque label only.",
].join("\n");

const VALUED = ["--draw", "--p", "--b", "--frame", "--sources", "--out", "--run", "--key", "--post", "--journal", "--run-id", "--item", "--history", "--md", "--batch", "--validation-run"];

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

async function labelCmd(f: Map<string, string[]>): Promise<number> {
  const batch = batchOf(f);
  const r = await labelSend(pilotBatch(pilotOf(f)), need(f, "--post"), batch, sendOptions(f));
  const arms = Object.entries(r.per_arm).map(([a, t]) => a + " " + t.reviews + " (" + t.kimi + " Kimi, " + t.cant_tell + " can't tell, " + t.unlabelled + " unlabelled)");
  console.log("labels (" + batch + "): " + r.reviews + " reviews, " + r.by.grok + " by Grok, " + r.by.kimi + " by Kimi, " + r.by.none + " by neither (no findings or unlabelled), " + r.cant_tell + " can't tell; " + arms.join("; ") + "; wrote " + finalPath(need(f, "--post"), batch) + "; " + settled(r));
  return 0;
}

function readoutCmd(f: Map<string, string[]>): number {
  if (batchOf(f) !== "pilot") rmFail("E_RM_POST_INPUT", "readout reads the pilot batch only; the validation batch's labels join the kappa gate's rows instead");
  const pilot = pilotOf(f);
  const post = need(f, "--post");
  const finalFile = finalPath(post);
  const final: FinalRow[] | null = existsSync(finalFile) ? JSON.parse(readFileSync(finalFile, "utf8")) : null;
  const vrun = f.get("--validation-run")?.at(-1);
  const vfile = finalPath(post, "validation");
  const validation = vrun && existsSync(vfile) ? { pilot: loadPilot(vrun, readKey(need(f, "--key")), post, "validation"), final: JSON.parse(readFileSync(vfile, "utf8")) as FinalRow[] } : null;
  const r = pilotReadout(pilot, final, need(f, "--history"), undefined, validation);
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
    if (sub === "desk-package" || sub === "labels-import") return rmFail("E_RM_POST_DESK_RETIRED", sub + " is retired: no people label the judge check (pre-run change 9, R126); run rm-post label-send, which has Grok 4.7 label it");
    const f = flags(rest);
    if (sub === "key") return keyCmd(f);
    if (sub === "contamination") return contaminationCmd(f);
    if (sub === "judge-send") return await judgeCmd(f);
    if (sub === "second-read-send") return await secondReadCmd(f);
    if (sub === "label-send") return await labelCmd(f);
    if (sub === "readout") return readoutCmd(f);
    return rmFail("E_RM_POST_INPUT", "unknown subcommand " + JSON.stringify(sub) + "; gstack-evals rm-post --help lists them");
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code !== "string" || !isReasonCode(code)) throw e;
    console.error((e as Error).message + "\n" + code + " fix: " + CODES[code].fix + "\n" + code + " docs: " + docAnchor(code));
    return 2;
  }
}
