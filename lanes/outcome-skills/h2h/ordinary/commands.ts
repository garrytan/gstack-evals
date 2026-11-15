// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's O commands for the h2h dispatcher: o-frame (the frozen O frame) and draw (the seeded order and the gate walk
// for O, B1 and B2).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MULTILANG, pinDigest, readRows, splitCandidates, toCandidate } from "../../statemachines/source.ts";
import { readUnit } from "../../statemachines/unit.ts";
import { parseFlags } from "../cli.ts";
import { h2hFail, POST_ID, PREREG_PATH, readPrereg } from "../prereg.ts";
import type { UnitKind } from "../types.ts";
import { drawB, planFor, replaceDropped, seededOrder, walk, type DrawUnit, type Gate, type GateResult } from "./draw.ts";
import { finishFrame, readLicences, screenFrame, type RowText } from "./frame.ts";
import { readHfHead, readLicencesGraphQl } from "./licences.ts";

export const BUNDLE = join(PREREG_PATH, "..");
export const FREEZE_DATE = POST_ID.slice(0, 10);
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const writeNew = (path: string, text: string) => writeFileSync(path, text, { flag: "wx" });
const json = (v: unknown) => JSON.stringify(v, null, 1) + "\n";

const O_FRAME_HELP = `Usage: gstack-evals h2h o-frame --cache <MultiLang cache dir> [--out <dir>] [--read-licences] [--digests <file>]
Builds the O frame (plan section 5) at the MultiLang revision the state machines harness pins, after checking that it is
still the dataset's Hugging Face head. --read-licences reads every candidate repository's licence once by GraphQL and
writes o-licences.json; without it the frame reads the frozen o-licences.json. Image digests are pinned by registry HEAD
for the candidates that pass every other gate, cached in --digests (default <cache>/h2h-o-digests.json). Writes
o-frame.json to --out (default: the post bundle).`;

async function oFrame(argv: string[]): Promise<number> {
  const f = parseFlags(argv, ["--cache", "--out", "--digests"], ["--read-licences"], O_FRAME_HELP);
  if (!f) return 0;
  const p = readPrereg();
  const cache = f.need("--cache");
  const out = f.one("--out") ?? BUNDLE;
  const head = await readHfHead(MULTILANG.dataset);
  if (head.sha !== MULTILANG.revision) h2hFail("E_H2H_O_SOURCE", MULTILANG.dataset + " moved: its head is " + head.sha + " (" + head.last_modified + "), the harness pins " + MULTILANG.revision + "; the frame stays at the pin until the Captain rules");
  const rows = readRows(cache);
  const cands = rows.map(({ lang, row }) => toCandidate(lang, row));
  const text = new Map<string, RowText>(rows.map(({ row }) => [row.instance_id, { problem_statement: row.problem_statement ?? "", patch: row.patch }]));
  const licPath = join(out, "o-licences.json");
  if (f.has("--read-licences")) {
    const from = p.classes.O.walk_back_to;
    const repos = cands.filter((c) => c.created_at.slice(0, 10) >= from).map((c) => c.repo);
    const read = readLicencesGraphQl(repos);
    writeNew(licPath, json(read));
    console.log("o-licences.json: " + Object.keys(read.repos).length + " repositories read at " + read.read_at);
  }
  if (!existsSync(licPath)) h2hFail("E_H2H_O_LICENCE", licPath + " does not exist; run once with --read-licences on the freeze date");
  const licText = readFileSync(licPath, "utf8");
  const licences = readLicences(licPath);
  const split = await splitCandidates(cache, cands.filter((c) => c.created_at.slice(0, 10) >= p.classes.O.walk_back_to && licences.repos[c.repo]?.spdx && p.licences.includes(licences.repos[c.repo]!.spdx!)));
  const splitById = new Map(split.map((c) => [c.id, c]));
  const merged = cands.map((c) => splitById.get(c.id) ?? c);
  const screened = screenFrame(p, merged, text, licences);
  const digestsPath = f.one("--digests") ?? join(cache, "h2h-o-digests.json");
  const pins: Record<string, string | null> = existsSync(digestsPath) ? JSON.parse(readFileSync(digestsPath, "utf8")) : {};
  const todo = screened.survivors.filter((c) => !(c.id in pins));
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < todo.length) {
      const c = todo[next++]!;
      try {
        pins[c.id] = await pinDigest(c.docker_image);
      } catch {
        pins[c.id] = null;
      }
    }
  }));
  writeFileSync(digestsPath, json(pins));
  const frame = finishFrame(p, { cands: merged, screened, digests: new Map(Object.entries(pins)), licences, licencesText: licText, head, dataset: MULTILANG.dataset, revision: MULTILANG.revision, freezeDate: FREEZE_DATE });
  mkdirSync(out, { recursive: true });
  writeNew(join(out, "o-frame.json"), json(frame));
  console.log("o-frame.json: " + frame.units.length + " eligible units (" + frame.counts.eligible_from_window_start + " from " + frame.window.from + "), drops by gate " + JSON.stringify(frame.counts.drops_by_gate) + ", excluded by pattern " + JSON.stringify(Object.fromEntries(Object.entries(frame.counts.excluded_by_pattern).filter(([, v]) => v))));
  return 0;
}

interface FrameFile { schema?: string; units?: (DrawUnit & Record<string, unknown>)[] }
export function readFrame(path: string, kind: UnitKind): (DrawUnit & Record<string, unknown>)[] {
  let j: FrameFile;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return h2hFail("E_H2H_DRAW_INPUT", path + " is not readable JSON: " + (e as Error).message);
  }
  if (!Array.isArray(j.units)) h2hFail("E_H2H_DRAW_INPUT", path + " has no units list");
  if (kind === "O" && j.schema !== "h2h-o-frame.v1") h2hFail("E_H2H_DRAW_INPUT", path + " is not an h2h-o-frame.v1 file");
  if (kind === "O") for (const u of j.units!) if (u.entry !== "bug" && u.entry !== "feature") h2hFail("E_H2H_DRAW_INPUT", u.id + " has no bug or feature tag");
  return j.units!;
}

/** The seeded order of one frame, as committed beside the frame. */
export function orderFile(kind: UnitKind, framePath: string, seed: number) {
  const units = readFrame(framePath, kind);
  const order = seededOrder(units, seed);
  return { schema: "h2h-order.v1", kind, draw_seed: seed, frame_sha256: sha(readFileSync(framePath)), months: [...new Set(order.map((u) => u.month))], order: order.map((u) => u.id) };
}

/** Gate results assembled from the VM outputs (h2h-gates.v1): the gate names in walk order and, per unit, "ok" or the
 *  drop's code and reason. A unit with no entry for a gate is pending. */
export interface GatesFile { schema: "h2h-gates.v1"; gates: string[]; results: Record<string, Record<string, "ok" | { code: string; reason: string }>> }
export function gatesFrom(file: GatesFile): Gate[] {
  if (file.schema !== "h2h-gates.v1" || !Array.isArray(file.gates) || !file.results) h2hFail("E_H2H_DRAW_INPUT", "the gate results are not an h2h-gates.v1 file");
  return file.gates.map((name) => ({
    name,
    check: (id: string): GateResult => {
      const r = file.results[id]?.[name];
      if (r === undefined) return { pending: true, why: "no " + name + " result" };
      if (r === "ok") return { ok: true };
      if (!r || typeof r.code !== "string") h2hFail("E_H2H_DRAW_INPUT", id + ": gate " + name + " has a malformed result");
      return { ok: false, code: r.code, reason: String(r.reason ?? "") };
    },
  }));
}

/** O's oracle gate from the state machines unit dirs: kept passes, any other verdict drops (E_H2H_DRAW_ORACLE). */
export const oracleGate = (unitsDir: string): Gate => ({
  name: "oracle",
  check: (id) => {
    if (!existsSync(join(unitsDir, id, "unit.json"))) return { pending: true, why: "no unit dir" };
    const u = readUnit(join(unitsDir, id));
    if (!u.oracle || u.oracle.verdict === "running") return { pending: true, why: "no oracle record" };
    return u.oracle.verdict === "kept" ? { ok: true } : { ok: false, code: "E_H2H_DRAW_ORACLE", reason: u.oracle.verdict };
  },
});

const DRAW_HELP = `Usage: gstack-evals h2h draw --class O --frame <o-frame.json> --order-out <file>
       gstack-evals h2h draw --class O --frame <o-frame.json> --gates <h2h-gates.v1 file> [--units-dir <sm unit dirs>] [--n <n>] [--dropped <ids>] --out <file>
       gstack-evals h2h draw --class B --b1-frame <file> --b2-frame <file> --b1-gates <file> --b2-gates <file> [--n <n>] [--dropped <ids>] --out <file>
--order-out writes the frame's seeded order (draw_seed) and touches no gate. Otherwise the gate walk runs over the seeded
order with the gate results (and, for O, the oracle gate read from --units-dir first) and writes the drawn units with
their positions and stages. --dropped lists units that dropped after the draw, which reserves replace. A pending gate
exits 2 with E_H2H_DRAW_PENDING naming the unit; a frame that runs out exits 2 with E_H2H_DRAW_SHORT after writing.`;

async function draw(argv: string[]): Promise<number> {
  const f = parseFlags(argv, ["--class", "--frame", "--order-out", "--gates", "--units-dir", "--n", "--dropped", "--out", "--b1-frame", "--b2-frame", "--b1-gates", "--b2-gates"], [], DRAW_HELP);
  if (!f) return 0;
  const p = readPrereg();
  const cls = f.need("--class");
  const n = f.one("--n") === undefined ? undefined : Number(f.one("--n"));
  if (n !== undefined && !(Number.isInteger(n) && n >= 0)) h2hFail("E_H2H_DRAW_INPUT", "--n must be a whole number");
  const dropped = new Set((f.one("--dropped") ?? "").split(",").filter(Boolean));
  const readGates = (path: string) => gatesFrom(JSON.parse(readFileSync(path, "utf8")) as GatesFile);
  if (cls === "O") {
    const frame = f.need("--frame");
    if (f.has("--order-out")) {
      const o = orderFile("O", frame, p.draw_seed);
      writeNew(f.need("--order-out"), json(o));
      console.log("O order: " + o.order.length + " units, months " + o.months.join(" ") + ", draw_seed " + o.draw_seed);
      return 0;
    }
    const gates = [...(f.one("--units-dir") ? [oracleGate(f.need("--units-dir"))] : []), ...readGates(f.need("--gates"))];
    const w = walk("O", p.draw_seed, seededOrder(readFrame(frame, "O"), p.draw_seed), gates, planFor(p, "O", n), p.classes.O.repo_cap);
    const r = replaceDropped(w, dropped);
    writeFileSync(f.need("--out"), json({ ...w, units: r.units, unreplaced: r.unreplaced, frame_sha256: sha(readFileSync(frame)) }));
    return report(w);
  }
  if (cls !== "B") h2hFail("E_H2H_DRAW_INPUT", "--class is O or B, not " + JSON.stringify(cls));
  const b1 = readFrame(f.need("--b1-frame"), "B1"), b2 = readFrame(f.need("--b2-frame"), "B2");
  const d = drawB(p, p.draw_seed, seededOrder(b1, p.draw_seed), seededOrder(b2, p.draw_seed), readGates(f.need("--b1-gates")), readGates(f.need("--b2-gates")), n);
  const out = { ...d, b1: { ...d.b1, ...replaceDropped(d.b1, dropped) }, b2: d.b2 ? { ...d.b2, ...replaceDropped(d.b2, dropped) } : null };
  writeFileSync(f.need("--out"), json(out));
  return Math.max(report(d.b1), d.b2 ? report(d.b2) : 0);
}

function report(w: ReturnType<typeof walk>): number {
  const by = (s: string) => w.units.filter((u) => u.stage === s).length;
  console.log(w.kind + ": usable " + w.usable + ", stage 1 " + by("stage1") + ", stage 2 " + by("stage2") + ", reserves " + by("reserve") + ", stage 0 " + by("stage0") + ", dropped " + w.drops.length + ", capped " + w.capped.length);
  if (w.pending) {
    console.error("E_H2H_DRAW_PENDING " + w.kind + " waits on " + w.pending.id + " at gate " + w.pending.gate + " (" + w.pending.why + ")");
    return 2;
  }
  if (w.short) {
    console.error("E_H2H_DRAW_SHORT " + w.kind + " ran out of units: filled " + JSON.stringify(w.short));
    return 2;
  }
  return 0;
}

export const commands: Record<string, (argv: string[]) => Promise<number>> = { "o-frame": oFrame, draw };
