// gstack-evals rm-supply: the review-models eval's unit supply (plan 2026-11-24-geva-590-review-models-prereg, section 2
// and section 10 item 3; pre-run change 1, item 1). Every subcommand but vis-send is keyless. Gate records name fix
// commits and BICs beside their advisories, so they are answer keys: write them outside the repository and commit only
// what counts prints.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CODES, docAnchor, isReasonCode } from "../../../errors/codes.ts";
import { removeTree } from "../../cleanup.ts";
import { bNeedles, bOrder, bUnitRef, buildChecked, checkB, rawAdvisory, type BRecord } from "./b-units.ts";
import { draw, type Draw } from "./draw.ts";
import { passed, type InstructionFlags } from "./gates.ts";
import { NON_SOURCE } from "./szz.ts";
import { cloneDir, ghPr, gitOut, SupplyError, supplyFail } from "./git.ts";
import { requireOpen } from "../../../../lanes/review-models/score/opening.ts";
import { checkP, readSuite, SUITE_NAME, type PRecord } from "./p-units.ts";
import { readVisibility, sendVisibility, visRequests, type VisReply, type VisRequest, type VisResult } from "./visibility.ts";

const HELP = [
  "gstack-evals rm-supply <subcommand> [options]: the review-models eval's P and B unit supply (GEVA-590).",
  "",
  "  p-gates --suite <json> --stage1 <json> --work <dir> --out <jsonl> [--only <id,...>]",
  "  b-gates --frame <b2-frame.json> --work <dir> --out <jsonl> [--limit <n>] [--shard <i>/<n>] [--only <ghsa,...>]",
  "          (deletes each clone whose unit does not await the visibility read)",
  "  vis-requests --b <jsonl> --frame <b2-frame.json> --work <dir> --out <jsonl>",
  "  vis-send --requests <jsonl> --out <dir> --run-id <id> --item <ledger item>     (paid: Opus 5.5 and GPT-6.2 Astra)",
  "  vis-read --requests <jsonl> --replies <jsonl> --out <json>",
  "  draw --p <jsonl> --b <jsonl> --visibility <json> --out <json>",
  "  counts --p <jsonl> --b <jsonl> [--visibility <json>] [--draw <json>] --out <json>",
  "  build --draw <json> --p <jsonl> --b <jsonl> --sources <dir> --out <dir>",
  "",
  "Gate records, requests, replies and draws name fixes and BICs: keep them outside the repository.",
].join("\n");

const VALUED = ["--suite", "--stage1", "--work", "--out", "--only", "--frame", "--limit", "--shard", "--b", "--p", "--requests", "--run-id", "--item", "--replies", "--visibility", "--draw", "--sources"];

function flags(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!, v = argv[i + 1];
    if (!VALUED.includes(k) || v === undefined) supplyFail("E_RMS_INPUT", "unknown or empty option " + JSON.stringify(k) + "; gstack-evals rm-supply --help lists them");
    m.set(k, v!);
  }
  return m;
}
const need = (f: Map<string, string>, k: string): string => f.get(k) ?? supplyFail("E_RMS_INPUT", "pass " + k);
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
export const readJsonl = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : []);
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const write = (path: string, v: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 2) + "\n");
};
const append = (path: string, v: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(v) + "\n");
};

function pGates(f: Map<string, string>): number {
  const units = readSuite(readJson(need(f, "--suite")), readJson(need(f, "--stage1")));
  const out = need(f, "--out"), only = f.get("--only")?.split(",");
  const done = new Set(readJsonl<PRecord>(out).map((r) => r.id));
  for (const u of units) {
    if (done.has(u.id) || (only && !only.includes(u.id))) continue;
    const r = checkP(u, { work: need(f, "--work"), github: ghPr });
    append(out, r);
    console.log(u.id + " g1 " + JSON.stringify(r.gates.g1 ?? null) + " g4 " + JSON.stringify(r.gates.g4 ?? null) + (r.error ? " error " + r.error : ""));
  }
  return 0;
}

function bGates(f: Map<string, string>): number {
  const frame = readJson(need(f, "--frame"));
  const order = bOrder(frame).slice(0, f.has("--limit") ? Number(f.get("--limit")) : undefined);
  const [i, n] = (f.get("--shard") ?? "0/1").split("/").map(Number) as [number, number];
  const out = need(f, "--out"), only = f.get("--only")?.split(",");
  const done = new Set(readJsonl<BRecord>(out).map((r) => r.ghsa));
  const advisory = rawAdvisory(frame.source.commit);
  order.forEach((a, position) => {
    if (position % n !== i || done.has(a.ghsa) || (only && !only.includes(a.ghsa))) return;
    const r = checkB(a, position, { work: need(f, "--work"), github: ghPr, advisory });
    append(out, r);
    if (!r.error && !awaitingRead([r]).length) removeTree(cloneDir(need(f, "--work"), a.repo, "b"));
    console.log(position + " " + a.repo + " g1 " + JSON.stringify(r.gates.g1 ?? null) + " g2 " + JSON.stringify(r.gates.g2 ?? null) + " g4 " + JSON.stringify(r.gates.g4 ?? null) + (r.error ? " error " + r.error : ""));
  });
  return 0;
}

/** B records ready for the visibility read: no error, gates 1, 2 and 4 passed. */
export const awaitingRead = (b: readonly BRecord[]): BRecord[] => b.filter((r) => !r.error && passed(r.gates.g1) && passed(r.gates.g2) && passed(r.gates.g4)).sort((x, y) => x.position - y.position);

const BUILT = /(^|\/)(dist|build)\/|\.min\.(js|css)$|\.map$/;

/** A commit range's diff over source files only: no tests, docs, data or lockfiles (szz.ts NON_SOURCE) and no built or
 *  minified files, so the visibility prompt holds the code the defect lives in. */
function sourceDiff(clone: string, from: string, to: string): string {
  const paths = gitOut(clone, ["diff", "--name-only", from, to], "list the changed files").split("\n").filter((p) => p && !NON_SOURCE.test(p) && !BUILT.test(p));
  return paths.length ? gitOut(clone, ["diff", from, to, "--", ...paths], "diff " + from + " to " + to) : "";
}

function visRequestsCmd(f: Map<string, string>): number {
  const frame = readJson(need(f, "--frame"));
  const advisory = rawAdvisory(frame.source.commit);
  const paths = new Map<string, string>(frame.advisories.map((a: any) => [a.ghsa, a.advisory_path]));
  const lines: string[] = [];
  for (const r of awaitingRead(readJsonl<BRecord>(need(f, "--b")))) {
    const clone = cloneDir(need(f, "--work"), r.repo, "b");
    const osv = advisory(paths.get(r.ghsa) ?? supplyFail("E_RMS_INPUT", r.ghsa + " is not in the frame")) ?? supplyFail("E_RMS_GIT", r.ghsa + ": the advisory record could not be read");
    const bic = r.szz!.bic!;
    const material = { ghsa: r.ghsa, summary: String(osv.summary ?? ""), details: String(osv.details ?? ""), fix_diff: sourceDiff(clone, r.fix.parent, r.fix.commit), bic_diff: sourceDiff(clone, bic + "^", bic) };
    for (const q of visRequests(bUnitRef(r).id, material)) lines.push(JSON.stringify(q));
  }
  writeFileSync(need(f, "--out"), lines.map((l) => l + "\n").join(""));
  console.log("visibility requests: " + lines.length / 2 + " B units awaiting the read, " + lines.length + " requests");
  return 0;
}

async function visSend(f: Map<string, string>): Promise<number> {
  requireOpen("pilot", "rm-supply vis-send");
  const { openJudgeMeter } = await import("../../../../lanes/outcome-skills/cso/judge/meter.ts");
  const requests = readJsonl<VisRequest>(need(f, "--requests"));
  const out = need(f, "--out");
  mkdirSync(out, { recursive: true });
  const replies = join(out, "replies.jsonl");
  const meter = await openJudgeMeter({ run_id: need(f, "--run-id"), out, item: need(f, "--item") });
  try {
    const sent = await sendVisibility(requests, readJsonl<VisReply>(replies), meter.transport, (r) => appendFileSync(replies, JSON.stringify(r) + "\n"));
    console.log("visibility send: " + sent + " calls sent; replies in " + replies);
  } finally {
    const c = await meter.close();
    console.log("settled: " + (c.spent_micros / 1e6).toFixed(2) + " USD spent, " + (c.unknown_micros / 1e6).toFixed(2) + " USD unknown");
  }
  return 0;
}

function visRead(f: Map<string, string>): number {
  const res = readVisibility(readJsonl<VisRequest>(need(f, "--requests")), readJsonl<VisReply>(need(f, "--replies")));
  write(need(f, "--out"), res);
  const all = Object.values(res);
  console.log("visibility: " + all.filter((r) => r.g3 === "ok").length + " pass, " + all.filter((r) => r.g3 && r.g3 !== "ok").length + " fail, " + all.filter((r) => !r.g3).length + " pending");
  return 0;
}

function drawCmd(f: Map<string, string>): number {
  const d = draw(readJsonl<PRecord>(need(f, "--p")), readJsonl<BRecord>(need(f, "--b")), readJson(need(f, "--visibility")));
  write(need(f, "--out"), d);
  console.log("draw: pilot " + d.pilot.p.length + " P, " + d.pilot.b.length + " B and 1 decoy; validation " + d.validation.length + "; counted " + d.counted.length + " (" + d.counted.filter((u) => u.pool === "P").length + " P, " + d.counted.filter((u) => u.pool === "B").length + " B) and " + d.decoys.length + " decoys");
  return 0;
}

/** Per-gate counts and the sha256 of every input: public-safe, the only supply output the repository keeps. */
export function supplyCounts(p: readonly PRecord[], b: readonly BRecord[], vis: Record<string, VisResult> | null, d: Draw | null) {
  const n = (xs: readonly unknown[]) => xs.length;
  const bugs = p.filter((r) => !r.decoy), decoys = p.filter((r) => r.decoy);
  const pCount = (rs: readonly PRecord[]) => ({ units: n(rs), errors: n(rs.filter((r) => r.error)), g1: n(rs.filter((r) => passed(r.gates.g1))), g4: n(rs.filter((r) => passed(r.gates.g4))), g1_and_g4: n(rs.filter((r) => !r.error && passed(r.gates.g1) && passed(r.gates.g4))) });
  const blamed = b.filter((r) => r.szz?.bic), single = blamed.filter((r) => r.shape?.parents === 1);
  const half = single.filter((r) => r.szz!.bic_lines * 2 >= r.szz!.blamed_lines), small = half.filter((r) => r.shape!.lines <= 2000 && r.shape!.source_lines >= 1);
  const g1 = b.filter((r) => passed(r.gates.g1)), g12 = g1.filter((r) => passed(r.gates.g2)), g124 = g12.filter((r) => passed(r.gates.g4));
  const FLAGS = ["claude_md", "root_claude_md", "agents_md", "claude_dir", "settings", "mcp_json"] as const;
  const types = (rs: readonly { flags?: InstructionFlags | null }[]) => ({ units: n(rs), ...Object.fromEntries(FLAGS.map((k) => [k, n(rs.filter((r) => r.flags?.[k]))])) });
  const gated = (rs: readonly (PRecord | BRecord)[]) => {
    const kept = rs.filter((r) => !r.error && passed(r.gates.g4));
    return { ...types(kept.map((r) => ({ flags: r.instructions?.flags }))), stripped_settings: n(kept.filter((r) => r.instructions?.strip.some((s) => s.action === "keys"))), unit_diff_changes_one: n(kept.filter((r) => r.instructions?.changed_by_unit.length)) };
  };
  return {
    schema: "rm-supply-counts.v1",
    instruction_files_after_gate4: { p_bug_units: gated(bugs), decoys: gated(decoys), b: gated(g12) },
    p: { bug_units: pCount(bugs), never_ran: n(bugs.filter((r) => !r.ran)), decoys: pCount(decoys) },
    b: {
      repositories: n(b),
      errors: n(b.filter((r) => r.error)),
      prototype_funnel: { blamed: n(blamed), single_parent: n(single), half_blamed: n(half), at_most_2000_lines: n(small), fix_dated: n(small.filter((r) => passed(r.gates.g1))) },
      gates_in_order: { g1: n(g1), g1_g2: n(g12), g1_g2_g4: n(g124), g1_g2_g4_g3: vis ? n(g124.filter((r) => vis[r.ghsa]?.g3 === "ok")) : null, awaiting_read: vis ? n(g124.filter((r) => !vis[r.ghsa]?.g3)) : n(g124) },
    },
    draw_instruction_files: d ? types([...d.pilot.p, ...d.pilot.b, d.pilot.decoy, ...d.validation, ...d.counted, ...d.decoys].filter((u, i, all) => all.findIndex((x) => x.id === u.id) === i)) : null,
    draw: d ? { pilot_p: n(d.pilot.p), pilot_b: n(d.pilot.b), pilot_decoy: 1, validation: n(d.validation), counted: n(d.counted), counted_p: n(d.counted.filter((u) => u.pool === "P")), counted_b: n(d.counted.filter((u) => u.pool === "B")), decoys: n(d.decoys), capped: n(d.capped) } : null,
  };
}

function countsCmd(f: Map<string, string>): number {
  const inputs = ["--p", "--b", "--visibility", "--draw"].filter((k) => f.has(k));
  const c = supplyCounts(readJsonl<PRecord>(need(f, "--p")), readJsonl<BRecord>(need(f, "--b")), f.has("--visibility") ? readJson(f.get("--visibility")!) : null, f.has("--draw") ? readJson(f.get("--draw")!) : null);
  write(need(f, "--out"), { ...c, sha256: Object.fromEntries(inputs.map((k) => [k.slice(2), sha(f.get(k)!)])) });
  console.log(JSON.stringify(c));
  return 0;
}

function buildCmd(f: Map<string, string>): number {
  const d: Draw = readJson(need(f, "--draw"));
  const p = new Map(readJsonl<PRecord>(need(f, "--p")).map((r) => [r.id, r]));
  const b = new Map(readJsonl<BRecord>(need(f, "--b")).filter((r) => r.szz?.bic).map((r) => [bUnitRef(r).id, r]));
  const out = need(f, "--out");
  const units = [...d.pilot.p, ...d.pilot.b, ...d.validation, ...d.counted, ...d.decoys];
  const rows = [...new Map(units.map((u) => [u.id, u])).values()].map((u) => {
    const pr = p.get(u.id), br = b.get(u.id);
    const repo = (pr ?? br ?? supplyFail("E_RMS_INPUT", u.id + " has no gate record")).repo;
    const unit = pr ? { id: pr.id, repo, pr: pr.pr, head: pr.head, base: pr.base } : bUnitRef(br!);
    const needles = pr ? { strings: [SUITE_NAME, ...pr.cases], fix: pr.fix?.commit ?? null } : bNeedles(br!);
    const built = buildChecked({ unit, source: join(need(f, "--sources"), repo.replace("/", "__")), dest: join(out, unit.id.replace(/[^A-Za-z0-9._-]/g, "_")), needles });
    return { id: u.id, repo: built.repo, instructions: built.instructions, problems: built.problems };
  });
  write(join(out, "units.json"), rows);
  const bad = rows.filter((r) => r.problems.length);
  console.log("built " + rows.length + " units; " + bad.length + " fail the history check or gate 4" + bad.map((r) => "\n  " + r.id + ": " + r.problems.join("; ")).join(""));
  return bad.length ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return sub ? 0 : 2;
  }
  try {
    const f = flags(rest);
    if (sub === "p-gates") return pGates(f);
    if (sub === "b-gates") return bGates(f);
    if (sub === "vis-requests") return visRequestsCmd(f);
    if (sub === "vis-send") return await visSend(f);
    if (sub === "vis-read") return visRead(f);
    if (sub === "draw") return drawCmd(f);
    if (sub === "counts") return countsCmd(f);
    if (sub === "build") return buildCmd(f);
    return supplyFail("E_RMS_INPUT", "unknown subcommand " + JSON.stringify(sub) + "; gstack-evals rm-supply --help lists them");
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code !== "string" || !isReasonCode(code)) throw e;
    const detail = e instanceof SupplyError ? e.detail : (e as Error).message;
    console.error(code + " " + detail + "\n" + code + " fix: " + CODES[code].fix + "\n" + code + " docs: " + docAnchor(code));
    return 2;
  }
}
