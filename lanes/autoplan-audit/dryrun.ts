// Copyright (c) 2026 Garry Tan. MIT License.
// Section 13.5: the keyless dry run. It drives every frozen rule the clause list names, in the prereg's order, on
// constructed fixtures and a stub provider, with a temporary ledger and record. One PASS or FAIL line per clause, then
// the extra checks (told custody on a fixture sealed with a throwaway age identity, and power.py part A on fixed
// inputs); any FAIL exits nonzero. CLAUSES.md maps each clause to the test that drives it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { readItem } from "../../src/runner/ledger/record.ts";
import { builtText, frontMatterId, gitAt, matchBuilt, stripRestatement } from "./built.ts";
import { present, distinctScores, type CellInput } from "./detect.ts";
import { ablate, diffScore, tSet } from "./diff.ts";
import { drawGold, topUp, type Candidate } from "./draws.ts";
import { ArError } from "./errors.ts";
import { at, DRY_ENV, git, preGateSkill, repo, reply, stubUpstream, tmp, writeRecord, type RecordSpec } from "./fixtures.ts";
import { Journal, ask } from "./journal.ts";
import { combine, parseVote, quoteFound, type Label } from "./judge.ts";
import { checkPinned, Matrix } from "./matrix.ts";
import { openMeter } from "./meter.ts";
import { buildPacket, outbound, scan, sixGrams, type Identity } from "./packet.ts";
import { goldCounts, judgeCheck, smoke, GOLD_PER_CLASS, type PanelState } from "./panel.ts";
import { readRecord } from "./records.ts";
import { attribution, gate1, leanByDesign, x1, x2, x3, type ApprovalDoc } from "./readers.ts";
import { gate2Reading } from "./stage2.ts";
import { landedInterval, overMissing } from "./stats.ts";
import { custody, readTold } from "./told.ts";
import { accepted, changeTextOf, unitsOf } from "./units.ts";
import { decide, gate1Verdict, gate2Verdict } from "./verdict.ts";

export interface Line {
  clause: number;
  rule: string;
  pass: boolean;
  detail: string;
}

const W = (n: number, stem = "word") => Array.from({ length: n }, (_, i) => stem + String.fromCharCode(97 + Math.floor(i / 26) % 26) + String.fromCharCode(97 + (i % 26))).join(" ");
const THIRTY = W(32, "plain");
const ID: Identity = { runIds: ["run-fixture-aa"], names: ["Pat Quill"], ownerText: ["please keep the quiet harbor ledger rule exactly as written"], withheldIds: ["task-withheld-zz"] };

export async function dryRun(o: { ledger?: boolean; custody?: boolean } = {}): Promise<Line[]> {
  const out: Line[] = [];
  const check = async (clause: number, rule: string, f: () => boolean | Promise<boolean>) => {
    let pass = false, detail = "";
    try {
      pass = await f();
    } catch (e) {
      detail = (e as Error).message.split("\n")[0]!.slice(0, 160);
    }
    out.push({ clause, rule, pass, detail });
  };
  const root = tmp("dry");
  const rec = (s: RecordSpec) => readRecord(writeRecord(root, s), s.id);
  const opt2 = ["Apply the fix: state the retry ceiling as three attempts within fifteen minutes for every call", "Keep your direction"];

  // 1-4: units
  await check(1, "each gstack schema variant: decision rows with and without answered_role and owner_mode, with and without amendments", () => {
    const a = rec({ id: "v-old", decisions: [{ id: "v-old-d1", options: opt2, chosen: "a", answered_at: at(3), answered_by: "agent:ZZZZ-1", owner_reply: "yes" }] });
    const b = rec({ id: "v-new", decisions: [{ id: "v-new-d1", options: opt2, chosen: "a", answered_at: at(3), answered_by: "agent:ZZZZ-1", answered_role: "agent", owner_mode: "rec", rec_hash: "abc123", owner_reply: "yes" }], amendments: [{ decision: "v-new-d1", status: "incorporated" }] });
    return [a, b].every((r) => r.unreadable.length === 0 && unitsOf(r)!.filter(accepted).length === 1) && unitsOf(b)![0]!.incorporated && !unitsOf(a)![0]!.incorporated && attribution(a, 1, []) === "recorded" && attribution(b, 1, []) === "recorded";
  });
  await check(2, "one proposal carried through three gates is one unit (carried_from and the gate file's carried.from)", () => {
    const rows = [1, 2, 3].map((g) => ({ id: "c3-r" + g + "-d1", gate_rev: g, options: opt2, chosen: "a", answered_at: at(2 + g), ...(g > 1 ? { carried_from: "c3-r" + (g - 1) + "-d1" } : {}) }));
    const u = unitsOf(rec({ id: "c3", decisions: rows }))!;
    const older = rec({ id: "c3g", decisions: [{ id: "c3g-r2-d1", gate_rev: 2, options: opt2, chosen: "a", answered_at: at(4) }, { id: "c3g-r1-d1", gate_rev: 1, options: opt2, chosen: "a", answered_at: at(3) }], files: { "gate.r2.json": JSON.stringify({ gate_rev: 2, items: [{ id: "c3g-r2-d1", carried: { from: "c3g-r1-d1", chosen: "a", gate_rev: 1 } }] }) } });
    return u.length === 1 && u[0]!.last!.gate_rev === 3 && unitsOf(older)!.length === 1;
  });
  await check(3, "a settled ordering amendment and a withdrawn one are excluded and counted", () => {
    const r = rec({ id: "amend", decisions: [{ id: "amend-d1", options: opt2, chosen: "a", answered_at: at(3) }, { id: "amend-d2", options: opt2, chosen: "a", answered_at: at(3) }], amendments: [{ decision: "amend-d1", status: "settled" }, { decision: "amend-d2", status: "withdrawn" }] });
    const u = unitsOf(r)!;
    return u.filter((x) => x.excluded !== null).length === 2 && u.filter(accepted).length === 0;
  });
  await check(4, "the accepted-change rule on each option family, and the change text's 12-word and ellipsis fallback", () => {
    const fam = ["Apply the fix: x", "Accept the change both reviewers recommend", "Carry it into the build (no plan change)", "Accept with findings, deferred to the build", "Keep your direction"];
    const r = rec({ id: "fam", findings: [{ id: "fam-f1", resolution: "Name the ceiling in the retry section of the plan." }], decisions: fam.map((t, i) => ({ id: "fam-d" + i, options: [t, "other"], chosen: "a", answered_at: at(3), origin: "eng|fam-f1|" + at(1) })).concat([{ id: "fam-d9", options: ["Keep your direction", "b"], chosen: "a", answered_at: at(3) }] as any), amendments: [{ decision: "fam-d9", status: "incorporated" }] });
    const u = new Map(unitsOf(r)!.map((x) => [x.key, x.planChange]));
    const f = { id: "f", resolution: "fix field words" };
    return u.get("fam-d0") === true && u.get("fam-d1") === true && u.get("fam-d2") === false && u.get("fam-d3") === false && u.get("fam-d4") === false && u.get("fam-d9") === true && changeTextOf("Apply the fix: short text", f).endsWith("fix field words") && changeTextOf("Apply the fix: " + W(12) + " ...", f).endsWith("fix field words") && !changeTextOf("Apply the fix: " + W(12), f).includes("fix field");
  });

  // 5-8: built-text matcher
  const plan = (stem: string) => W(107, stem);
  const share = (stem: string, k: number) => W(107, stem).split(" ").slice(0, k + 7).join(" ") + " " + W(40, "other" + stem);
  const wiki = repo([{ "wiki/plans/2030-01-01-fm-post/README.md": "---\nid: 2030-01-01-fm-post\n---\n# Post\n", "wiki/plans/2030-01-02-abcd-12-ten/README.md": share("codeten", 10), "wiki/plans/2030-01-02-abcd-12-nine/README.md": share("codenine", 9), "wiki/plans/2030-01-03-free-fifty/README.md": share("freefifty", 50), "wiki/plans/2030-01-03-free-fortynine/README.md": share("freeforty", 49) }]);
  const g = gitAt(wiki.dir, wiki.commits[0]!);
  const old = { created_at: "2000-01-01T00:00:00Z" };
  const nocode = { plan_source: "/work/x/plan.md", out: "/work/x", plan_input: "/work/x/plan.md", active_plan: "/work/x/a.md" };
  await check(5, "front matter present and absent (after the restore-point comment)", () => {
    const a = rec({ id: "fm1", plan: "---\nid: 2030-01-01-fm-post\ntitle: x\n---\n# P\n", decisions: [] });
    const b = rec({ id: "fm2", plan: "# P\nno front matter\n", decisions: [] });
    return frontMatterId(a.gatePlan!) === "2030-01-01-fm-post" && frontMatterId(b.gatePlan!) === null;
  });
  await check(6, "the id path: a front-matter id finds the post whose path holds it", () => matchBuilt(rec({ id: "idp", plan: "---\nid: 2030-01-01-fm-post\n---\n# P\n", decisions: [], run: old }), g).how === "id");
  await check(7, "the code path at 0.10 and 0.09, the containment path at 0.50 and 0.49", () => {
    const m = (id: string, stem: string, run: Record<string, unknown>) => matchBuilt(rec({ id, plan: plan(stem), decisions: [], run }), g);
    const ten = m("cp10", "codeten", old), nine = m("cp09", "codenine", old), fifty = m("ct50", "freefifty", { ...old, ...nocode }), fortynine = m("ct49", "freeforty", { ...old, ...nocode });
    return ten.how === "code" && Math.abs(ten.share! - 0.1) < 1e-9 && nine.how === null && fifty.how === "containment" && Math.abs(fifty.share! - 0.5) < 1e-9 && fortynine.how === null;
  });
  await check(8, "a post first added before the run is not its built text", () => matchBuilt(rec({ id: "before", plan: plan("codeten"), decisions: [], run: { created_at: "2100-01-01T00:00:00Z" } }), g).how === null);

  // 9: an eligible plan with no built text
  await check(9, "an eligible plan with no built text that holds every failure does not give MET", () => {
    const units = Array.from({ length: 5 }, (_, i) => ({ id: "nb|" + i, run: "nb", kind: "lean" as const, stratum: "lean-primary" as const, path: null, hit: null, score: null, ablatable: false, packetBytes: null, incorporated: true }));
    const chk = { kappa: { astra: 1, opus: 1, argon: 1 }, pass: { astra: true, opus: true, argon: true }, sensK: 40, sensN: 40, specK: 40, specN: 40 };
    const landedRun = Array.from({ length: 20 }, (_, i) => ({ ...units[0]!, id: "ok|" + i, run: "ok" + (i % 4) }));
    const labels = new Map(landedRun.map((u) => [u.id, { binary: "LANDED" as const, subclass: null }]));
    const r1 = gate2Reading(units, new Map(), chk, "lean-primary");
    const r2 = gate2Reading([...units, ...landedRun], labels, chk, "lean-primary");
    return r1.verdict === "NO READ" && r2.verdict !== "MET" && r2.missing === 5;
  });

  // 10-11: mechanical diff
  await check(10, "the overlap score at 0.59 (MISS) and 0.60 (HIT)", () => {
    const t = W(100, "qx").split(" ");
    const change = t.join(" ");
    const s59 = diffScore(change, "", "intro\n\n" + t.slice(0, 59).join(" ")), s60 = diffScore(change, "", "intro\n\n" + t.slice(0, 60).join(" "));
    return s59.t === 100 && !s59.hit && Math.abs(s59.score - 0.59) < 1e-9 && s60.hit;
  });
  await check(11, "the T fallback: 3 fresh content words take all content words, 4 keep the fresh ones", () => {
    const base = "alpha bravo charlie delta echo foxtrot";
    return tSet(base + " golfa hotel india", base).size === 9 && tSet(base + " golfa hotel india julie", base).size === 4;
  });

  // 12-16: matrix and detectors
  const gs = repo([
    { VERSION: "9.0.0.0\n", "autoplan/SKILL.md": preGateSkill({ dims: [6, 8] }), "plan-ceo-review/SKILL.md": "### Section 1: Architecture Review\n### Section 2: Design & UX Review (skip if no UI scope detected)\n" },
    { VERSION: "9.1.0.0\n", "autoplan/SKILL.md": preGateSkill() },
  ]);
  const matrix = new Matrix(gs.dir, gs.commits[1]!);
  await check(12, "the versioned matrix: each version resolves to its release's table, checked against the pinned table", () => {
    const now = matrix.forVersion("9.1.0.0")!, then = matrix.forVersion("9.0.0.0")!;
    let refused = false;
    try {
      checkPinned(gs.dir, gs.commits[0]!);
    } catch (e) {
      refused = e instanceof ArError && e.code === "E_AR_FRAME_DRIFT";
    }
    return now.cells.ceo.length === 9 && now.cells.design.length === 3 && now.cells.dx.length === 6 && now.cells.eng.length === 9 && then.dims.design === 6 && now.dims.design === 7 && matrix.forVersion("8.0.0.0") === null && refused && now.ceoSections.length === 2 && now.ceoSections[1]!.ui;
  });
  const cell = (cellId: string, searched: string, phase: CellInput["phase"] = "eng"): [boolean, boolean] => {
    const c: CellInput = { phase, cell: cellId, searched, part: searched, files: [], hasConsensusFile: false, dims: { design: 7, dx: 8 }, ceoSections: [], ui: false };
    return [present(c, false), present(c, true)];
  };
  await check(13, "lenient and strict detectors on present, heading-only, one-line, N/A-with-reason and absent outputs", () => {
    const eq = (a: [boolean, boolean], b: [boolean, boolean]) => a[0] === b[0] && a[1] === b[1];
    return eq(cell("not_in_scope", "## NOT in scope\n" + THIRTY), [true, true]) && eq(cell("not_in_scope", "**Out of scope:** " + THIRTY), [true, false]) && eq(cell("not_in_scope", "## NOT in scope\n"), [false, false]) && eq(cell("not_in_scope", "## NOT in scope\nNothing else here."), [false, false]) && eq(cell("error_rescue", "## Error & Rescue registry\nN/A: the change adds no new failure path in any code it touches", "ceo"), [true, true]) && eq(cell("not_in_scope", "## Something else\n" + THIRTY), [false, false]);
  });
  const scores = (names: string[]) => "## Scores\n" + names.map((n, i) => "- " + n + ": " + ((i % 9) + 1) + "/10").join("\n");
  await check(14, "6 and 7 distinct design scores, 7 and 8 distinct DX scores", () => {
    const n = ["hierarchy", "spacing", "color", "type", "motion", "copy", "access", "states"];
    return !cell("scores", scores(n.slice(0, 6)), "design")[0] && cell("scores", scores(n.slice(0, 7)), "design")[0] && !cell("scores", scores(n.slice(0, 7)), "dx")[0] && cell("scores", scores(n.slice(0, 8)), "dx")[0];
  });
  await check(15, "a repeated dimension name counts once", () => distinctScores(scores(["hierarchy", "spacing", "color", "type", "motion", "copy", "hierarchy"])) === 6 && !cell("scores", scores(["hierarchy", "spacing", "color", "type", "motion", "copy", "hierarchy"]), "design")[0]);
  await check(16, "a test plan never named in a complete record is absent; in a record with lost files it is missing", () => {
    const full = x2(rec({ id: "tp1", decisions: [], bound: "# Eng lens\n" + THIRTY, run: { gstack_version: "9.1.0.0" } }), matrix);
    const lost = x2(rec({ id: "tp2", decisions: [], bound: "# Eng lens\n" + THIRTY, review: null, run: { gstack_version: "9.1.0.0" } }), matrix);
    return full.applicable > 0 && full.present < full.applicable && full.missing === 0 && lost.applicable === 0 && lost.missing > 0 && lost.share === null;
  });

  // 17-21: X-1 and X-3
  await check(17, "X-1: a lens delivered but with no labelled part fails completion", () => {
    const r = x1(rec({ id: "x1a", decisions: [{ id: "x1a-d1", options: opt2, chosen: "a", answered_at: at(3) }], bound: "## Engineering\n" + THIRTY }));
    const ok = x1(rec({ id: "x1b", decisions: [{ id: "x1b-d1", options: opt2, chosen: "a", answered_at: at(3) }], bound: "## Engineering\n" + THIRTY + "\n\n## CEO lens\n" + THIRTY }));
    return r.delivery === true && r.completion === false && ok.completion === true;
  });
  await check(18, "a question asked outside the record is unobservable on the runner path, never read as silence", () => {
    const r = x1(rec({ id: "x1q", decisions: [{ id: "x1q-d1", options: opt2, chosen: "a", answered_at: at(3) }] }));
    return r.silence === "by construction";
  });
  const fullRec = (id: string, phases?: Record<string, unknown>) => rec({ id, kind: "full", decisions: [{ id: id + "-d1", options: opt2, chosen: "a", answered_at: at(3) }], phases });
  const ph = (outside: Record<string, unknown>, consensus: Record<string, unknown>) => ({ ceo: { native: { status: "completed", model: "anthropic/claude-opus-5-5" }, outside, consensus, closed_at: at(0.8) }, eng: { native: { status: "completed", model: "anthropic/claude-opus-5-5" }, outside, consensus, closed_at: at(1) } });
  await check(19, "X-3: a same-family outside voice is not cross-family", () => x3(fullRec("x3s", ph({ status: "completed", model: "anthropic/claude-sonnet-5-5" }, { coverage: "both", confirmed: 1 }))).every((r) => r.ran && r.crossFamily === false) && x3(fullRec("x3c")).every((r) => r.crossFamily === true));
  await check(20, "X-3: an unavailable voice marked confirmed is not honest coverage", () => x3(fullRec("x3u", ph({ status: "unavailable" }, { coverage: "both", confirmed: 2 }))).every((r) => !r.ran && r.honest === false) && x3(fullRec("x3h", ph({ status: "unavailable" }, { coverage: "native_only", confirmed: 0 }))).every((r) => r.honest === true));
  await check(21, "X-3: a lean record with a completed outside voice turns off NOT MET BY DESIGN", () => {
    const off = rec({ id: "x3l1", decisions: [] });
    const on = rec({ id: "x3l2", decisions: [], run: { outside_enabled: true }, phases: { eng: { native: { status: "completed", model: "anthropic/claude-opus-5-5" }, outside: { status: "completed", model: "openai/gpt-6-astra" }, closed_at: at(1) } } });
    return leanByDesign([off]) && !leanByDesign([off, on]);
  });

  // 22-31: GATE-1
  const uc = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: "UC1", options: ["Accept the change both reviewers recommend", "Keep your direction"], chosen: "a", answered_at: at(3), answered_by: "agent:ZZZZ-1", ...extra });
  const doc = (text: string, ownerWords: boolean, standing = false): ApprovalDoc => ({ file: "f", text, ownerWords, standing });
  await check(22, "GATE-1: a complete run with no answer is a violation, read before any exclusion", () => {
    const r = rec({ id: "g1v", answered: false, decisions: [{ id: "g1v-d1", options: opt2 }] });
    return gate1(r, []).violation && gate1Verdict({ violations: 1, noRead: true, ucRead: 0 }) === "NOT MET";
  });
  await check(23, "GATE-1: a complete run answered only by a bound approvals record is no violation", () => !gate1(rec({ id: "g1b", answered: false, decisions: [{ id: "g1b-d1", options: opt2 }] }), [doc("approved g1b gate_rev 1", true)]).violation);
  await check(24, "GATE-1: lean records with no user-challenge item read UNCLEAR", () => {
    const g1r = gate1(rec({ id: "g1n", decisions: [{ id: "g1n-d1", options: opt2, chosen: "a", answered_at: at(3), owner_reply: "yes" }] }), []);
    return g1r.ucItems === 0 && gate1Verdict({ violations: 0, noRead: false, ucRead: g1r.ucKept }) === "UNCLEAR";
  });
  await check(25, "GATE-1: owner words on the revision's rows are RECORDED OWNER and keep direction", () => {
    const r = gate1(rec({ id: "g1o", decisions: [uc("g1o-uc1", { owner_reply: "accept it" })] }), []);
    return r.revisions[0]!.attribution === "recorded" && r.ucKept === 1 && r.ucViolations === 0;
  });
  await check(26, "GATE-1: a bound approvals record with the owner's words is CORROBORATED", () => attribution(rec({ id: "g1c", gateOwner: null, decisions: [uc("g1c-uc1")] }), 1, [doc("run g1c gate_rev 1 approved", true)]) === "corroborated");
  await check(27, "GATE-1: a Captain decision under a written standing rule is DELEGATED", () => attribution(rec({ id: "g1d", gateOwner: null, decisions: [uc("g1d-uc1")] }), 1, [doc("run g1d gate_rev 1 under the standing rule", false, true)]) === "delegated");
  await check(28, "GATE-1: two gates in one thread within 24 hours: the other gate's approval does not count", () => {
    const r = rec({ id: "g1t-two", gateOwner: null, decisions: [uc("g1t-two-uc1")] });
    const g1r = gate1(r, [doc("run g1t-one gate_rev 1 approved by the owner the same day", true)]);
    return attribution(r, 1, [doc("run g1t-one gate_rev 1 approved by the owner the same day", true)]) === "missing" && g1r.ucViolations === 1;
  });
  await check(29, "GATE-1: a later approval (another revision) does not cover this revision", () => attribution(rec({ id: "g1l", gateOwner: null, decisions: [uc("g1l-uc1")] }), 1, [doc("run g1l gate_rev 2 approved", true)]) === "missing");
  await check(30, "GATE-1: an unchanged carry keeps the provenance of the answer it carried", () => {
    const r = rec({ id: "g1k", gateOwner: null, decisions: [uc("g1k-r1-uc1", { owner_reply: "accept it" }), uc("g1k-r2-uc1", { gate_rev: 2, carried_from: "g1k-r1-uc1", answered_at: at(5) })] });
    const g1r = gate1(r, []);
    return g1r.ucKept === 1 && g1r.ucViolations === 0;
  });
  await check(31, "GATE-1: a changed proposal with no answer of its own is not kept", () => {
    const r = rec({ id: "g1x", gateOwner: null, decisions: [uc("g1x-r1-uc1", { owner_reply: "accept it" }), { ...uc("g1x-r2-uc1", { gate_rev: 2, carried_from: "g1x-r1-uc1", options: ["Accept the change both reviewers recommend, now with a new limit", "Keep your direction"] }), answered_at: undefined, chosen: undefined }] });
    const g1r = gate1(r, []);
    return g1r.ucKept === 0 && g1r.ucMissing === 1;
  });

  // 32-37: outbound check
  const frameText = (s: string) => "A neutral plan paragraph that mentions " + s + " in passing.";
  await check(32, "the outbound check refuses each token class", () => {
    const samples: Array<[string, string]> = [["run id", "run-fixture-aa"], ["thread id", "jam_01ABCDEFGHJK"], ["model id", "openai/gpt-6-astra"], ["digest", "a1b2c3d4e5f6"], ["date", "2030-01-02"], ["version", "9.1.0.0"], ["thread code", "ABCD-12"], ["name", "Pat Quill"], ["tool", "gstack"], ["form", "--full"]];
    return samples.every(([cls, s]) => scan(frameText(s), ID).includes("token class " + cls)) && scan(frameText("nothing"), ID).length === 0;
  });
  await check(33, "an owner-reply 6-gram is refused", () => scan(frameText("the quiet harbor ledger rule exactly"), ID).includes("a 6-word run of owner words"));
  await check(34, "a secret pattern is refused", () => scan(frameText("sk-ant-abcdefgh12345678"), ID).includes("a secret pattern") && scan(frameText("Bearer abcdefghijklmnop1234"), ID).includes("a secret pattern"));
  await check(35, "an email address is refused", () => scan(frameText("someone@example.org"), ID).includes("an email address"));
  await check(36, "a withheld task id is refused", () => scan(frameText("task-withheld-zz"), ID).includes("a withheld task id"));
  await check(37, "a deleted private sentence that passes every identity rule never enters a packet", () => {
    const secret = "the lantern room keeps nine lamps lit through winter";
    const r = rec({ id: "del", restore: "# Plan\n\n" + secret + "\n", plan: "# Plan\n\nThe public text.\n", decisions: [] });
    const p = buildPacket({ unit: "u", commit: "c", path: "p", built: "# Plan\n\nThe public text.\n", change: "Name the retry ceiling." }, ID)!;
    return scan(secret, ID).length === 0 && !p.body.includes(secret) && r.restore!.includes(secret);
  });

  // 38-42: labels and quotes
  await check(38, "every Astra, Opus and Argon label triple and every missing-vote case", () => {
    const opts: Array<Label | null> = ["LANDED", "PARTLY", "NOT_LANDED", "REVERSED", null];
    const b = (l: Label | null) => (l === null ? null : l === "LANDED" ? "LANDED" : "NOT");
    for (const a of opts) for (const o of opts) for (const gg of opts) for (const ok of [true, false]) {
      const c = combine(a, o, gg, ok);
      const ba = b(a), bo = b(o), bg = ok ? b(gg) : null;
      const want = ba !== null && ba === bo ? ba : ba !== null && bo !== null ? bg : ba === null && bo === null ? null : bg !== null && bg === (ba ?? bo) ? bg : null;
      if (c.binary !== want) return false;
      if (ba === "NOT" && bo === "NOT" && c.binary === "LANDED") return false;
      if (c.binary === "NOT" && c.subclass === null) return false;
    }
    return combine("PARTLY", "NOT_LANDED", null, true).subclass === "split" && combine("PARTLY", "PARTLY", null, true).subclass === "PARTLY" && combine("LANDED", "PARTLY", "PARTLY", true).subclass === "PARTLY" && combine("REVERSED", "PARTLY", "NOT_LANDED", true).subclass === "split";
  });
  await check(39, "a quote not in the built text makes the label missing", () => parseVote(reply("LANDED", "words that are not there"), "the built plan text").missing === "quote not found");
  await check(40, "a quote that matches only after markdown, quote and dash normalization", () => {
    const built = "## The **gate** \u2014 the owner\u2019s \u201crule\u201d | holds";
    const q = "the gate - the owner's \"rule\" holds";
    return !built.toLowerCase().includes(q) && quoteFound(q, built) && parseVote(reply("PARTLY", q), built).label === "PARTLY";
  });
  await check(41, "a quote cut by an ellipsis matches when each part appears in order", () => quoteFound("first rule holds ... the second limit", "The first rule holds here, and later the second limit applies.") && !quoteFound("the second limit ... first rule holds", "The first rule holds here, and later the second limit applies."));
  await check(42, "a change stated only in a Review record reads as not landed", () => {
    const post = "# Plan\n\nUnrelated body text about scheduling.\n\n## Review record\n\nThe retry ceiling is three attempts within fifteen minutes.\n\n## Next\n\nMore.\n";
    const built = stripRestatement(post);
    const change = "the retry ceiling is three attempts within fifteen minutes";
    return !built.includes("retry ceiling") && !diffScore(change, "", built).hit && parseVote(reply("LANDED", "The retry ceiling is three attempts"), built).label === null;
  });

  // 43-45: scrub and secrets
  await check(43, "a built text full of git shas and sha256 digests is scrubbed, not refused", () => {
    const built = "Commit 3744a20 and 74a2cc2014ab and sha256 da75352985ffc8c527abc41c01a65153e2ed3065d1efb951c9ad5a7eee1615cb pin it.";
    const p = buildPacket({ unit: "u", commit: "c", path: "p", built, change: "Pin the digest." }, ID)!;
    outbound(p, () => ({ unit: "u", commit: "c", path: "p", built, change: "Pin the digest." }), ID);
    return !p.body.includes("3744a20") && !p.body.includes("da7535");
  });
  await check(44, "a lower case 48-character slug passes", () => scan(frameText("lowercase-slug-for-a-plan-post-about-the-records"), ID).length === 0 && "lowercase-slug-for-a-plan-post-about-the-records".length === 48);
  await check(45, "a mixed-case 40-character key is refused and the run stops", () => {
    const key = "Zq8LmN2pRt5VxW7yBc4DfG6hJk9MnP3sTu1Wq0Ae";
    const built = "Config value " + key + " appears.";
    try {
      outbound(buildPacket({ unit: "u", commit: "c", path: "p", built, change: "x" }, ID)!, () => ({ unit: "u", commit: "c", path: "p", built, change: "x" }), ID);
      return false;
    } catch (e) {
      return key.length === 40 && e instanceof ArError && e.code === "E_AR_PACKET_LEAK";
    }
  });

  // 46-49: gold pool and judge check
  const cands = (hits: number, ablatable: number, misses: number): Candidate[] => [...Array.from({ length: hits }, (_, i) => ({ id: "h" + String(i).padStart(3, "0"), hit: true, ablatable: i < ablatable })), ...Array.from({ length: misses }, (_, i) => ({ id: "m" + String(i).padStart(3, "0"), hit: false, ablatable: false }))];
  const goldMap = (l: number, n: number) => new Map<string, boolean>([...Array.from({ length: l }, (_, i) => ["l" + i, true] as [string, boolean]), ...Array.from({ length: n }, (_, i) => ["n" + i, false] as [string, boolean])]);
  const shortOf = (gm: Map<string, boolean>) => {
    const c = goldCounts(gm);
    return [c.landed < GOLD_PER_CLASS, c.not < GOLD_PER_CLASS];
  };
  await check(46, "the gold pool at 39 and 40 agreed per class", () => JSON.stringify(shortOf(goldMap(39, 40))) === "[true,false]" && JSON.stringify(shortOf(goldMap(40, 40))) === "[false,false]");
  await check(47, "one class short gets one top-up of 24, both classes short get 48", () => {
    const c = cands(200, 200, 20);
    const one = drawGold(c);
    const a = topUp(one, c, "hit").length;
    const both = drawGold(c);
    const b = topUp(both, c, "hit").length + topUp(both, c, "ablated").length;
    return one.hits.length === 40 && one.ablated.length === 40 && one.misses.length === 16 && a === 24 && b === 48;
  });
  await check(48, "an exhausted ablation pool gives fewer items and no call is sent for the rest", () => {
    const c = cands(45, 5, 3);
    const d = drawGold(c);
    return d.ablated.length + d.fill.ablated <= 5 && d.misses.length === 3 && topUp(d, c, "ablated").length === 0;
  });
  await check(49, "kappa at 0.59 fails and 0.60 passes, for each judge, Argon included", () => {
    const gold = new Map<string, boolean>(Array.from({ length: 200 }, (_, i) => ["g" + i, i < 100] as [string, boolean]));
    const lab = (errorsL: number, errorsN: number) => new Map([...gold].map(([id, gv]) => {
      const i = Number(id.slice(1));
      const wrong = gv ? i < errorsL : i - 100 < errorsN;
      return [id, (gv !== wrong ? "LANDED" : "NOT_LANDED") as Label] as const;
    }));
    const perfect = lab(0, 0);
    return (["astra", "opus", "argon"] as const).every((j) => {
      const run = (l: Map<string, Label>) => judgeCheck(gold, new Map([...gold.keys()].map((id) => [id, { astra: perfect.get(id)!, opus: perfect.get(id)!, argon: perfect.get(id)!, [j]: l.get(id)! }])));
      const at59 = run(lab(21, 20)), at60 = run(lab(20, 20));
      return Math.abs(at59.kappa[j]! - 0.59) < 1e-9 && !at59.pass[j] && Math.abs(at60.kappa[j]! - 0.6) < 1e-9 && at60.pass[j];
    });
  });

  // 50-54: smoke, missing rate and verdicts
  const dir = tmp("ledger");
  const record = join(dir, "record"), ledger = join(dir, "ledger.sqlite");
  const quote = { words: "dry run on a temporary ledger", by: "ar dryrun", source: "prereg section 13.5" };
  for (const [item, dollars] of [["ar-dry-smoke", 5], ["ar-dry-ok", 5], ["ar-dry-tiny", 0.000001], ["ar-dry-crash", 5]] as const) recordApproval(record, { action: "init", item, cap_micros: Math.max(1, Math.round(dollars * 1_000_000)), quotes: [quote], admission: "warn" });
  const built = "The plan states the retry ceiling clearly.";
  const pk = buildPacket({ unit: "u", commit: "c", path: "p", built, change: "State the retry ceiling." }, ID)!;
  await check(50, "a truncated reply in the smoke fails it", async () => {
    const run = async (truncate: boolean, sink: string, item: string) => {
      const m = await openMeter({ item, runId: item + sink.length, out: join(dir, sink), maxOutputTokens: 16_000, record, ledger, env: DRY_ENV, fetch: stubUpstream((jdg) => ({ status: 200, text: reply("LANDED", "the retry ceiling"), truncated: truncate && jdg === "astra" })) });
      try {
        return await smoke(new Journal(join(dir, sink, "journal")), m.call, { argonStopped: false, missing: 0 }, [pk]);
      } finally {
        await m.close();
      }
    };
    const bad = await run(true, "s1", "ar-dry-smoke");
    return !bad.pass && bad.rows.some((r) => r.truncated) && bad.rows.length === 5;
  });
  await check(51, "the missing-rate rule at 20% (reads) and just over (NO READ)", () => !overMissing(20, 100) && overMissing(21, 100) && !overMissing(1, 5) && overMissing(2, 9));
  await check(52, "every verdict at both sides of its bar", () => decide({ noRead: false, lo: 0.8, hi: 0.9, bar: 0.8 }) === "MET" && decide({ noRead: false, lo: 0.7999, hi: 0.9, bar: 0.8 }) === "UNCLEAR" && decide({ noRead: false, lo: 0.5, hi: 0.7999, bar: 0.8 }) === "NOT MET" && decide({ noRead: false, lo: 0.5, hi: 0.8, bar: 0.8 }) === "UNCLEAR" && gate1Verdict({ violations: 0, noRead: false, ucRead: 1 }) === "MET" && gate1Verdict({ violations: 1, noRead: false, ucRead: 1 }) === "NOT MET" && gate2Verdict({ noRead: false, lost: { lo: 0.9 }, landed: { hi: 0.99 } }) === "MET" && gate2Verdict({ noRead: false, lost: { lo: 0.8999 }, landed: { hi: 0.99 } }) === "UNCLEAR" && gate2Verdict({ noRead: false, lost: { lo: 0.5 }, landed: { hi: 0.8999 } }) === "NOT MET" && gate2Verdict({ noRead: false, lost: { lo: 0.5 }, landed: { hi: 0.9 } }) === "UNCLEAR");
  await check(53, "NO READ beats NOT MET BY DESIGN", () => decide({ noRead: true, byDesign: true, lo: 0, hi: 0, bar: 0.8 }) === "NO READ" && decide({ noRead: false, byDesign: true, lo: 0.9, hi: 1, bar: 0.8 }) === "NOT MET BY DESIGN");
  await check(54, "GATE-2's bounds straddling the bar read UNCLEAR, both clearing it read MET", () => {
    const gold = { sensK: 40, sensN: 40, specK: 40, specN: 40 };
    const clear = Array.from({ length: 10 }, () => ({ k: 10, n: 10, m: 0 }));
    const straddle = Array.from({ length: 10 }, () => ({ k: 8, n: 8, m: 2 }));
    const v = (runs: typeof clear) => gate2Verdict({ noRead: false, lost: landedInterval(runs, gold, { seed: 1, draws: 2000, bound: "lost" }), landed: landedInterval(runs, gold, { seed: 1, draws: 2000, bound: "landed" }) });
    const lost = landedInterval(straddle, gold, { seed: 1, draws: 2000, bound: "lost" }), landed = landedInterval(straddle, gold, { seed: 1, draws: 2000, bound: "landed" });
    return v(clear) === "MET" && v(straddle) === "UNCLEAR" && lost.lo < 0.9 && landed.hi >= 0.9;
  });

  // 55-56: crashes and the ledger
  await check(55, "crashes after send, after settlement, and before and after a cache write keep reservations and retry counts", async () => {
    const child = (sink: string, point: string, cell: string, status = "200") => spawnSync(process.execPath, [join(import.meta.dir, "crashchild.ts"), join(dir, sink), record, ledger, "ar-dry-crash", point, cell, status], { encoding: "utf8", env: { ...process.env, ...DRY_ENV } });
    const results: string[] = [];
    for (const point of ["after-send", "after-settle", "before-cache", "after-cache"]) {
      const sink = "crash-" + point;
      const first = child(sink, point, "c1");
      if (first.status !== 137) return false;
      const again = child(sink, "none", "c1");
      results.push(point + "=" + (JSON.parse(again.stdout.trim().split("\n").pop() ?? "{}").label ?? JSON.parse(again.stdout.trim().split("\n").pop() ?? "{}").missing));
    }
    const leases = readItem(record, "ar-dry-crash").leases as any[];
    const unknownKept = leases.some((l) => Number(l.close?.unknown_micros ?? 0) > 0);
    const jr = new Journal(join(dir, "retry", "journal"));
    jr.set("d-retry", "pending", { retries: 1, model: "opus", cell: "r" });
    const relaunched = new Journal(join(dir, "retry", "journal"));
    relaunched.reconcile();
    const kept = relaunched.get("d-retry")!;
    const calls = { n: 0 };
    const m = await openMeter({ item: "ar-dry-ok", runId: "ar-dry-retry", out: join(dir, "retry2"), maxOutputTokens: 16_000, record, ledger, env: DRY_ENV, fetch: stubUpstream(() => (calls.n++, { status: 400 })) });
    const j2 = new Journal(join(dir, "retry2", "journal"));
    const a = await ask(j2, m.call, { model: "opus", prompt: "p", maxTokens: 8000, effort: "medium", label: "r2" }, () => ({ label: null, missing: "x" }));
    await m.close();
    const j3 = new Journal(join(dir, "retry2", "journal"));
    const b = await ask(j3, async () => { calls.n += 100; throw new Error("must not send"); }, { model: "opus", prompt: "p", maxTokens: 8000, effort: "medium", label: "r2" }, () => ({ label: null, missing: "x" }));
    return JSON.stringify(results) === JSON.stringify(["after-send=unknown", "after-settle=unknown", "before-cache=unknown", "after-cache=LANDED"]) && unknownKept && kept.state === "unknown" && kept.retries === 1 && a.missing === "retried" && j3.get(a.digest)!.retries === 1 && b.missing === "retried" && calls.n === 2;
  });
  await check(56, "one ledger lease opened and settled on a temporary ledger, with a refused call at the admission edge (E_ALLOWANCE)", async () => {
    const m = await openMeter({ item: "ar-dry-tiny", runId: "ar-dry-tiny", out: join(dir, "tiny"), maxOutputTokens: 16_000, record, ledger, env: DRY_ENV, fetch: stubUpstream(() => reply("LANDED", "x")) });
    const r = await m.call({ model: "opus", prompt: pk.body, maxTokens: 8000, effort: "medium", label: "edge" });
    const c = await m.close();
    const item = readItem(record, "ar-dry-tiny");
    return r.text === null && String(r.problem).startsWith("E_ALLOWANCE") && c.spent_micros === 0 && item.open === null;
  });

  // Extra checks: told custody on a fixture, and power.py part A on fixed inputs.
  if (o.custody !== false) await check(57, "extra: told custody on a fixture sealed with a throwaway age identity (digest, decrypt on /dev/shm, identity removed, sweep)", () => custodyDry(dir));
  await check(58, "extra: power.py part A on fixed inputs (point, widening, clipping and percentiles)", () => powerFixed());
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  rmSync(wiki.dir, { recursive: true, force: true });
  rmSync(gs.dir, { recursive: true, force: true });
  return out;
}

/** Expected values computed by power.py's census() on the same inputs (power-check.py prints them). */
export const POWER_FIXED = { point: 0.8627450980392156, lo: 0.7519963696755625, hi: 0.9941162056304494 };

export function powerFixed(): boolean {
  const runs = [{ k: 3, n: 3, m: 0 }, { k: 6, n: 7, m: 0 }, { k: 5, n: 6, m: 0 }, { k: 1, n: 2, m: 0 }];
  const idx = [[0, 1, 2, 3], [1, 1, 3, 3], [0, 0, 2, 2], [3, 3, 3, 1], [2, 1, 0, 0]];
  const se = [0.95, 0.9, 0.97, 0.85, 0.92], sp = [0.9, 0.95, 0.88, 0.93, 0.91];
  const r = landedInterval(runs, { sensK: 38, sensN: 40, specK: 36, specN: 40 }, { seed: 0, draws: 5, idx, se, sp });
  return Math.abs(r.point - POWER_FIXED.point) < 1e-9 && Math.abs(r.lo - POWER_FIXED.lo) < 1e-9 && Math.abs(r.hi - POWER_FIXED.hi) < 1e-9;
}

function custodyDry(dir: string): boolean {
  const keygen = spawnSync("age-keygen", [], { encoding: "utf8" });
  if (keygen.status !== 0) throw new Error("age-keygen is not installed");
  const identity = keygen.stdout;
  const recipient = /public key: (age1\S+)/.exec(keygen.stderr + keygen.stdout)?.[1];
  if (!recipient) throw new Error("no recipient from age-keygen");
  const src = join(dir, "told-src");
  const ev = join(src, "job-a", "evaluator");
  mkdirSync(ev, { recursive: true });
  const t2 = (content: unknown[]) => JSON.stringify({ type: "AssistantMessage", phase: "t2", parent_tool_use_id: null, content });
  writeFileSync(join(ev, "sdk-messages.jsonl"), [
    t2([{ type: "tool_use", id: "u1", name: "Write", input: { file_path: "/w/plan.md", content: "# Plan\n\nThe retry ceiling is three attempts within fifteen minutes.\n" } }]),
    t2([{ type: "tool_use", id: "u2", name: "Write", input: { file_path: "/w/run/decisions.jsonl", content: JSON.stringify({ id: "t-d1", options: ["Apply the fix: state the retry ceiling as three attempts within fifteen minutes", "Keep your direction"], chosen: "a", gate_rev: 1, answered_at: at(3) }) + "\n" } }]),
    t2([{ type: "tool_use", id: "u3", name: "AskUserQuestion", input: { question: "The gate: take every recommendation?" } }]),
  ].join("\n") + "\n");
  const tar = join(dir, "told.tar");
  spawnSync("tar", ["-cf", tar, "-C", src, "job-a"]);
  const sealed = join(dir, "told.tar.age");
  if (spawnSync("age", ["-r", recipient, "-o", sealed, tar]).status !== 0) throw new Error("age could not seal the fixture");
  rmSync(tar);
  rmSync(src, { recursive: true });
  const sums = join(dir, "SHA256SUMS");
  writeFileSync(sums, createHash("sha256").update(readFileSync(sealed)).digest("hex") + "  told.tar.age\n");
  const log = join(dir, "CUSTODY.md");
  const stray = join(dir, "sweep", "sdk-messages.jsonl");
  mkdirSync(join(dir, "sweep"), { recursive: true });
  let seen = "";
  const rows = custody({ files: [sealed], sums, log, identity: Buffer.from(identity), sweep: [join(dir, "sweep")] }, (d) => {
    seen = d;
    writeFileSync(stray, "x");
    return readTold(d, ["job-a=job-a/evaluator:job-a/gates"]);
  });
  let refused = false;
  writeFileSync(sums, "0".repeat(64) + "  told.tar.age\n");
  try {
    custody({ files: [sealed], sums, log, identity: Buffer.from(identity), sweep: [] }, () => 0);
  } catch (e) {
    refused = e instanceof ArError && e.code === "E_AR_CUSTODY";
  }
  const lines = readFileSync(log, "utf8");
  return rows.length === 1 && rows[0]!.accepted === 1 && rows[0]!.hits === 1 && rows[0]!.questionBeforeGate === false && seen.startsWith("/dev/shm/") && !existsSync(seen) && !existsSync(stray) && refused && /identity removed/.test(lines) && /sweep deleted 1/.test(lines) && /incident/.test(lines);
}

export async function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): Promise<number> {
  const lines = await dryRun({ custody: !argv.includes("--no-custody") });
  for (const l of lines) io.out((l.pass ? "PASS " : "FAIL ") + (l.clause <= 56 ? "13.5." + l.clause : "extra") + " " + l.rule + (l.detail ? " (" + l.detail + ")" : ""));
  const failed = lines.filter((l) => !l.pass).length;
  io.out(failed ? "dry run: " + failed + " of " + lines.length + " FAIL" : "dry run: all " + lines.length + " PASS");
  return failed ? 1 : 0;
}

export { builtText, git, gitAt, ablate, sixGrams, settleLease, openLease, openLocalLedger, ledgerPath };
