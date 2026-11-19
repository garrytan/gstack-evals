// Copyright (c) 2026 Garry Tan. MIT License.
// The stages part's keyless dry-run cases (prereg 2026-11-15-geva-537 section 13): each drives one frozen rule on
// synthetic fixtures and prints what it saw. The driven launch needs Docker, so it prints SKIP without
// GSTACK_EVALS_DOCKER=1, which is never a pass.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { underLease } from "../../eng-build/pipeline.ts";
import { reviewArmSpec } from "../../eng-build/review-stage.ts";
import { detectorPinProblems, detectorStringProblems, ER_DETECTOR_FILES, ER_DETECTOR_STRINGS, type ErEvidence } from "../../eng-review/exposure.ts";
import { openLease, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import { FROZEN, RESTORE_PIN } from "../frozen.ts";
import type { CaseRuns, DryCase, ReviewRecord } from "../types.ts";
import { plantedArmSpec, plantedStopHook, skillPin } from "./arms.ts";
import { authorCalls, BATCH_2, countWords, drawSets, hintedVerdict, supplyLine, type AuthorCall, type AuthorMaterial, type Authored, type Candidate } from "./author.ts";
import { capParts, reviewMount, stockMount, writeMount } from "./build.ts";
import { checkAllIn, ITEMS, ItemGate, stubLauncher, type ItemPlan, type ItemState } from "./ledger.ts";
import { EP_RUN } from "./local.ts";
import { interimStop } from "./pipeline.ts";

/** The refusal's reason code, or "no refusal". */
export async function codeOf(f: () => unknown): Promise<string> {
  try {
    await f();
    return "no refusal";
  } catch (e) {
    return (e as { code?: string }).code ?? "error: " + (e as Error).message;
  }
}

async function withTmp<T>(f: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ep-dry-"));
  try {
    return await f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const words = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const usd = (n: number) => "$" + n.toFixed(2);

/** The leases each item's stages open, one after another on run EP_RUN: authoring's calls, hinted and no-review
 * steps for each batch; the smoke; the comparison's pilot reviews and builds, then its reviews and builds; the stock
 * builds; the judge. */
export const LEASES_PER_ITEM: Readonly<Record<string, number>> = { "ep-authoring": 6, "ep-smoke": 1, "ep-comparison": 4, "ep-stock": 1, "ep-judge": 1 };

/** A fixture unit's authoring material: a stubbed parser, its implementation and a fix. */
export const MATERIAL: AuthorMaterial = {
  stubbed: [{ path: "src/range.ts", text: "/** Parses a range written as a-b. */\nexport function parseRange(text: string): [number, number] {\n  throw new Error(\"stub\");\n}\n" }],
  implementation: [{ path: "src/range.ts", text: "export function parseRange(text: string): [number, number] {\n  const [a, b] = text.split(\"-\").map(Number);\n  return [a!, b!];\n}\n" }],
  tests: [{ path: "test/range.test.ts", text: "expect(parseRange(\"1-3\")).toEqual([1, 3]);\n" }],
  callers: [{ path: "src/cli.ts", text: "console.log(parseRange(process.argv[2]!));\n" }],
  fix: { message: "Accept ranges written high to low", diff: "-  return [a!, b!];\n+  return a! <= b! ? [a!, b!] : [b!, a!];\n" },
};

/** Model calls that answer each role from a script: the audit's conditions in order, the raters' answers, and one
 * hint. */
export function scriptedCalls(o: { conditions: string[]; hint?: string; hintAudit?: string; ratings?: string[]; planWords?: number }): AuthorCall {
  let audits = 0;
  let ratings = 0;
  return async (role) => {
    if (role === "writer") return { text: "# Plan\n\n" + words(o.planWords ?? 250, "plan"), costUsd: 0.1 };
    if (role === "audit") return { text: "CONDITION: " + (o.conditions[audits++] ?? "SILENT") + "\nCODE: SIGNATURES", costUsd: 0.1 };
    if (role === "hint") return { text: o.hint ?? "The parser must accept the two bounds of a range in either order.", costUsd: 0.05 };
    if (role === "hintAudit") return { text: "HINT: " + (o.hintAudit ?? "CLEAN"), costUsd: 0.05 };
    return { text: "FORESEE: " + (o.ratings?.[ratings++] ?? "maybe"), costUsd: 0.05 };
  };
}

export const runsOf = (passes: number, of = FROZEN.runs): CaseRuns[] => [{ id: "planted-1", runs: Array.from({ length: of }, (_, i) => (i < passes ? "pass" : "assert")) }];

export const record = (unit: string, exposed: boolean | null, arm: "engphase" | "standalone" = "standalone"): ReviewRecord => ({ unit, arm, reviewer: "opus", rep: 1, outcome: exposed === null ? "upstream_gap" : "completed", exposed, exposedBeforeBlock: exposed, blocks: 0, bundleWords: 0, truncated: false, repoEditsDiscarded: 0, costUsd: 0 });

/** A gstack tree holding every detector string in its file, with a review-sections.md that also ends in a VERDICT line. */
export function detectorFixture(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const s of ER_DETECTOR_STRINGS) files[s.file] = (files[s.file] ?? "# " + s.file + "\n") + s.needle + "\n";
  for (const f of new Set(Object.values(ER_DETECTOR_FILES).flat())) files[f] ??= "# " + f + "\n";
  files["plan-eng-review/sections/review-sections.md"] += "End with exactly VERDICT: CLEAN or VERDICT: FINDINGS as the last line.\n";
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return files;
}

export const CASES: DryCase[] = [
  {
    name: "Stop hook blocks",
    run: () => {
      const ev = (t: string): ErEvidence => ({ transcript: t, stateRoot: null, coverage: null, opening: null });
      const h = plantedStopHook("standalone", ev)!;
      const said = [h.onStop(""), h.onStop(""), h.onStop("")];
      const plain = plantedStopHook("plain", ev);
      const ok = said[0] !== null && said[1] !== null && said[2] === null && h.blocks() === FROZEN.stopHook.maxBlocks && plain === null;
      return { ok, detail: "standalone with nothing exposed: blocked " + h.blocks() + " times, then released; plain: " + (plain === null ? "no hook" : "a hook") };
    },
  },
  {
    name: "bundle cap",
    run: () => {
      const max = FROZEN.bundle.maxWords;
      const c = capParts([{ name: "plan.md", text: words(7000, "p") }, { name: "review.md", text: words(4000, "r") }, { name: "test-plan.md", text: words(3000, "t") }, { name: "late.md", text: words(10, "x") }]);
      const under = capParts([{ name: "plan.md", text: words(max - 1, "p") }]);
      const third = c.kept[2];
      const ok = c.kept.length === 3 && third?.name === "test-plan.md" && third.text.endsWith(" [cut]") && countWords(third.text) === max - 11000 + 1 && c.truncated && c.words === max && c.fullWords === 14010 && !under.truncated && under.kept.length === 1;
      return { ok, detail: "14,010 words cut to " + c.words + ": the third part kept " + (third ? countWords(third.text) - 1 : 0) + " words and \" [cut]\", the fourth left out; " + (max - 1) + " words kept whole" };
    },
  },
  {
    name: "reviewed-plan mount",
    run: () =>
      withTmp(async (dir) => {
        const authored = "# Authored plan\n\n" + words(220, "a");
        const transcript = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Final review reply." }] } }) + "\n";
        const m = reviewMount("engphase", { plan: "# Reviewed plan\n\nThe review's final plan.", transcript, stateRoot: null, coverage: null }, authored);
        const missing = reviewMount("plain", { plan: null, transcript, stateRoot: null, coverage: null }, authored);
        const stock = stockMount(authored);
        const paths = writeMount(join(dir, "cell"), m);
        const stale = await codeOf(() => writeMount(join(dir, "cell"), { ...m, plan: "other bytes" }));
        const ok = m.plan.startsWith("# Reviewed plan") && !m.planMissing && m.files.map((f) => f.name).join() === "review.md" && missing.plan === authored && missing.planMissing && stock.plan === authored && stock.files[0]?.name === "review.md" && paths.plan.endsWith("/plan.md") && stale === "E_EB_CACHE_STALE";
        return { ok, detail: "reviewed arm mounts the review's final plan.md and review.md; a review with no plan.md mounts the authored plan (planMissing); stock mounts the authored plan and the fixed review; a resume with other bytes: " + stale };
      }),
  },
  {
    name: "one ledger lease per item",
    run: () =>
      withTmp(async (dir) => {
        const record = join(dir, "record");
        const ledger = join(dir, "ledger.sqlite");
        const quote = { words: "dry run on a temporary ledger", by: "ep dryrun", source: "section 12" };
        for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * 1_000_000, quotes: [quote], admission: "warn" });
        let sessions = 0;
        for (const i of ITEMS) for (let k = 0; k < LEASES_PER_ITEM[i.item]!; k++) await underLease({ item: i.item, capUsd: i.capUsd, record, ledger }, stubLauncher(null), async () => void sessions++);
        const local = openLocalLedger(ledgerPath(ledger));
        let bound: string;
        try {
          bound = await codeOf(() => openLease(record, local, { item: ITEMS[0]!.item, run_id: "another-run", requireAdmission: () => null }));
        } finally {
          local.close();
        }
        const want = ITEMS.reduce((s, i) => s + LEASES_PER_ITEM[i.item]!, 0);
        return { ok: sessions === want && bound !== "no refusal", detail: ITEMS.length + " items, " + sessions + " leases opened and settled in turn on run " + EP_RUN + " (" + ITEMS.map((i) => i.item + " " + LEASES_PER_ITEM[i.item]).join(", ") + "); another run on " + ITEMS[0]!.item + ": " + bound };
      }),
  },
  {
    name: "first session alone",
    run: async () => {
      const plan: ItemPlan = { item: "ep-smoke", row: "fixture", projectionUsd: 37, capUsd: 50, kinds: { "review:standalone": { planned: 6, usd: 2.74 }, "review:engphase": { planned: 6, usd: 3.51 } } };
      const dear = new ItemGate(plan);
      await dear.acquire("review:standalone");
      const waits = dear.admit("review:engphase");
      const stop = await codeOf(() => dear.settle("review:standalone", 9));
      const cheap = new ItemGate(plan);
      await cheap.acquire("review:standalone");
      cheap.settle("review:standalone", 2.5);
      const next = cheap.admit("review:engphase");
      const ok = waits === "wait" && stop === "E_EP_REPROJECT" && next === "go";
      return { ok, detail: "a second session waits while the first runs alone (" + waits + "); a first session at $9 re-projects to " + usd(9 + 5 * 9 + 6 * 3.51) + ": " + stop + "; at $2.50 the next starts (" + next + ")" };
    },
  },
  {
    name: "halt after 10 sessions",
    run: async () => {
      const plan: ItemPlan = { item: "ep-stock", row: "fixture", projectionUsd: 40, capUsd: 100, kinds: { build: { planned: 20, usd: 2 } } };
      const g = new ItemGate(plan);
      const costs = [2, 9, 9, 9, 9, 9, 9, 9, 9];
      for (const c of costs) {
        await g.acquire("build");
        g.settle("build", c);
      }
      const at9 = g.reprojection();
      await g.acquire("build");
      const at10 = await codeOf(() => g.settle("build", 9));
      const ok = g.sessions() === 10 && at9 > plan.capUsd && at10 === "E_EP_REPROJECT";
      return { ok, detail: "9 settled re-project to " + usd(at9) + ", past the $100 cap, and the item goes on; the 10th settle halts it: " + at10 };
    },
  },
  {
    name: "all-in stop at $4,999 and $5,001",
    run: () =>
      withTmp(async (dir) => {
        const set = (comparison: number) => {
          for (const i of ITEMS) {
            const s: ItemState = { item: i.item, capUsd: i.capUsd, settledUsd: i.item === "ep-comparison" ? comparison : 0, sessions: 1, reprojectionUsd: 0, finished: true };
            writeFileSync(join(dir, i.item + ".json"), JSON.stringify(s));
          }
        };
        const allIn = { stateDir: dir, crewUsd: 450, hostsUsd: 90 };
        set(4999 - 540);
        const below = await codeOf(() => checkAllIn(allIn));
        set(5001 - 540);
        const above = await codeOf(() => checkAllIn(allIn));
        const gate = new ItemGate(ITEMS.find((i) => i.item === "ep-stock")!, { allIn });
        const admit = await codeOf(() => gate.admit("build"));
        const ok = below === "no refusal" && above === "E_EP_PROJECTION" && admit === "E_EP_PROJECTION";
        return { ok, detail: "all-in $4,999: " + below + "; $5,001: " + above + "; a gate admitting a session past it: " + admit };
      }),
  },
  {
    name: "two-way plan audit",
    run: async () => {
      const fixed = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["FIXED", "FIXED"] }));
      const buggy = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["BUGGY", "BUGGY"] }));
      const rewritten = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["BUGGY", "SILENT"] }));
      const silent = await authorCalls(MATERIAL, scriptedCalls({ conditions: ["SILENT"] }));
      const ok = fixed.record.drop === "plan-audit" && fixed.record.plan.firstDraftStatedBug === false && buggy.record.drop === "plan-audit" && buggy.record.plan.firstDraftStatedBug === true && rewritten.record.drop === null && rewritten.record.plan.drafts === 2 && rewritten.record.plan.firstDraftStatedBug === true && silent.record.drop === null && silent.record.plan.drafts === 1;
      return { ok, detail: "fix-stating plan twice: " + fixed.record.drop + "; bug-stating twice: " + buggy.record.drop + " (first draft stated the bug: " + buggy.record.plan.firstDraftStatedBug + "); bug then silent: passes after " + rewritten.record.plan.drafts + " drafts; silent: passes" };
    },
  },
  {
    name: "hinted drop at 1 and 2 of 3",
    run: () => {
      const one = hintedVerdict("completed", runsOf(1));
      const two = hintedVerdict("completed", runsOf(2));
      const gap = hintedVerdict("infra_gap", runsOf(3));
      const ok = one.drop === "unwinnable" && two.drop === null && two.winnable === true && gap.drop === "hinted-gap";
      return { ok, detail: "1 of 3 passing runs: " + one.drop + "; 2 of 3: winnable; a gap: " + gap.drop };
    },
  },
  {
    name: "foreseeability drop",
    run: () => {
      const order: Candidate[] = ["u1", "u2", "u3", "u4"].map((id, i) => ({ id, repo: "r" + i }));
      const a = (unforeseeable: boolean): Authored => ({ admitted: true, reason: null, unforeseeable });
      const d = drawSets(order, new Map([["u1", a(true)], ["u2", a(true)], ["u3", a(false)], ["u4", a(false)]]), { calibration: 1, comparison: 2, reserve: 0 });
      const ok = d.calibration.join() === "u1" && d.comparison.join() === "u3,u4" && d.skipped.some((s) => s.id === "u2" && s.reason === "unforeseeable");
      return { ok, detail: "both raters no: u1 serves calibration, u2 leaves the comparison draw (" + d.skipped.map((s) => s.id + " " + s.reason).join(", ") + ")" };
    },
  },
  {
    name: "set draws with the per-repo cap",
    run: () => {
      const order: Candidate[] = [...Array.from({ length: 5 }, (_, i) => ({ id: "same" + i, repo: "one" })), { id: "other", repo: "two" }];
      const authored = new Map(order.map((c): [string, Authored] => [c.id, { admitted: true, reason: null, unforeseeable: false }]));
      const d = drawSets(order, authored, { calibration: 1, comparison: 4, reserve: 0 });
      const capped = d.skipped.filter((s) => s.reason === "repo-cap").map((s) => s.id);
      const ok = [...d.calibration, ...d.comparison].filter((id) => id.startsWith("same")).length === FROZEN.frame.perRepo && capped.join() === "same3,same4" && d.comparison.includes("other");
      return { ok, detail: "5 units from one repository: " + FROZEN.frame.perRepo + " drawn, " + capped.join(" and ") + " skipped at the cap; the next repository's unit drawn" };
    },
  },
  {
    name: "short supply at 39 and 40 units",
    run: async () => {
      const draw = (n: number) => {
        const order: Candidate[] = Array.from({ length: 6 + n }, (_, i) => ({ id: "u" + i, repo: "r" + i }));
        return drawSets(order, new Map(order.map((c): [string, Authored] => [c.id, { admitted: true, reason: null, unforeseeable: false }])), BATCH_2);
      };
      const at39 = await codeOf(() => supplyLine(draw(39), BATCH_2));
      const line40 = supplyLine(draw(40), BATCH_2);
      const ok = at39 === "E_EP_SUPPLY_SHORT" && /runs at 40 units/.test(line40);
      return { ok, detail: "39 admitted comparison units: " + at39 + "; 40: " + line40 };
    },
  },
  {
    name: "interim exposure stop",
    run: () => {
      const recs = (exposed: number) => [record("gap", null), ...Array.from({ length: 24 }, (_, i) => record("u" + i, i < exposed))];
      const at16 = interimStop("standalone", recs(16));
      const at17 = interimStop("standalone", recs(17));
      const early = interimStop("standalone", [...recs(0).slice(0, 10), null, ...recs(0).slice(10)]);
      const ok = at16 !== null && at16.startsWith("E_EP_EXPOSURE_STOP") && at17 === null && early === null;
      return { ok, detail: "16 of the first 24 non-gap sessions exposed (0.667, under 0.70): stops; 17 (0.708): goes on; a gap is not counted; an unrecorded earlier cell defers the count" };
    },
  },
  {
    name: "empty pin refused",
    run: async () => {
      const empty = await codeOf(() => skillPin({ sha: "", version: "", digests: {} }));
      const noDigests = await codeOf(() => skillPin({ sha: "a".repeat(40), version: "9.9.9.9", digests: {} }));
      const fixturePin = Object.fromEntries([...new Set(Object.values(ER_DETECTOR_FILES).flat())].map((f) => [f, sha(f)]));
      const fixture = await codeOf(() => skillPin({ sha: "b".repeat(40), version: "9.9.9.9", digests: fixturePin }));
      const spec = await codeOf(() => reviewArmSpec("precut", { sha: "" }));
      const arm = await codeOf(() => plantedArmSpec("standalone", null));
      const restore = await codeOf(() => skillPin(RESTORE_PIN));
      const ok = empty === "E_USAGE" && noDigests === "E_USAGE" && fixture === "no refusal" && spec === "E_USAGE" && arm === "E_USAGE" && restore === "no refusal";
      return { ok, detail: "empty pin: " + empty + "; a commit with no digests: " + noDigests + "; a fixture pin with every digest: accepted; the review install at an empty pin: " + spec + "; a skill arm with no pin: " + arm + "; RESTORE_PIN: accepted" };
    },
  },
  {
    name: "detector strings on fixtures",
    run: () =>
      withTmp((dir) => {
        const files = detectorFixture(dir);
        const read = (f: string) => files[f] ?? null;
        const clean = detectorStringProblems(read);
        const verdict = detectorStringProblems((f) => (f.endsWith("review-sections.md") ? files[f]!.replace("VERDICT: CLEAN or VERDICT: FINDINGS", "VERDICT: CLEARED") : read(f)));
        const dropped = detectorStringProblems((f) => (f.endsWith("review-sections.md") ? files[f]!.replaceAll("### 3. Test review", "### 3. Tests") : read(f)));
        const pin = { sha: "c".repeat(40), digests: Object.fromEntries(Object.entries(files).map(([f, t]) => [f, sha(t)])) };
        const pinned = detectorPinProblems("precut", pin, (f) => (files[f] === undefined ? null : Buffer.from(files[f]!)));
        const moved = detectorPinProblems("precut", pin, (f) => (files[f] === undefined ? null : Buffer.from(files[f]! + " ")));
        const ok = clean.length === 0 && verdict.length === 0 && dropped.length === 2 && dropped.every((p) => p.includes("sections_in_order")) && pinned.length === 0 && moved.length === 2;
        return { ok, detail: "every string present: clean; a changed VERDICT line: clean (no detector reads it); a renamed test section: " + dropped.length + " problems (both arms); the pinned digests: clean; a changed byte: " + moved.length + " problems" };
      }),
  },
  {
    name: "paid commands refuse without the ledger flags",
    run: () =>
      withTmp(async (dir) => {
        const { stagesCommands } = await import("./commands.ts");
        const t = stagesCommands();
        const io = { out: () => {}, err: () => {} };
        const args = (extra: Array<[string, string]>) => ({ flags: new Map<string, string>([["--run", join(dir, "run")], ["--units", join(dir, "units")], ["--repos", join(dir, "repos")], ["--gstack", dir], ...extra]), bools: new Set<string>(), rest: [] });
        const bare = await codeOf(() => t.smoke!.run(args([]), io));
        const over = await codeOf(() => t.smoke!.run(args([["--item", "ep-smoke"], ["--cap-usd", "51"], ["--ledger-record", join(dir, "rec")], ["--ledger", join(dir, "l.sqlite")], ["--crew-usd", "0"], ["--hosts-usd", "0"]]), io));
        const wrong = await codeOf(() => t.smoke!.run(args([["--item", "ep-comparison"], ["--cap-usd", "1"], ["--ledger-record", join(dir, "rec")], ["--ledger", join(dir, "l.sqlite")], ["--crew-usd", "0"], ["--hosts-usd", "0"]]), io));
        const ok = bare === "E_USAGE" && over === "E_USAGE" && wrong === "E_USAGE";
        return { ok, detail: "no ledger flags: " + bare + "; a cap above the item's plan cap: " + over + "; another stage's item: " + wrong + "; no lease opened" };
      }),
  },
  {
    name: "driven launch of a review and a build",
    docker: true,
    run: async () => {
      const { drivenLaunch } = await import("./e2e.ts");
      return drivenLaunch();
    },
  },
];
