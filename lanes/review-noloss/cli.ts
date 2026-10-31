// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals noloss: the review no-loss category's commands (wiki/plans/2026-10-30-gsta-40-review-noloss-plan). No
// command here calls a model or spends. Every error line on stderr starts with its reason code; an unexpected failure
// writes a scrubbed trace file and prints its path with a correlation id.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { errorLines, errorRecord, scrubSecrets } from "../../src/skill-eval/verdict/error-record.ts";
import { ContractError } from "./contract.ts";
import { buildExport, COMPARISONS_DIR, loadArms, loadComparisons, renderExport, TABLE_PATH, tableText } from "./export.ts";
import { ARMS_ROOT, prepare, publish, readArmDir, snapshot } from "./ingest.ts";
import { derive } from "./derive.ts";
import { flagScan, flagsTsv } from "./flag-scan.ts";
import { judgeJoin, judgePacket } from "./judge.ts";
import { judgeRunCmd } from "./judge-run.ts";
import { powerTable, renderPowerTable, spreadValue, suiteClusters } from "./power.ts";
import { ideaWins, newBlockers } from "./secondary.ts";
import { armMetrics, DEFAULT_DRAWS, DEFAULT_SEED, falseBlockerTable, renderRecord, scoreComparisons, ScoreError, type Comparison, type LossFamily } from "./score.ts";
import { OUTCOMES, readScoreRun, verdictLine } from "./verdict.ts";
import type { PlanStratum } from "../review-replay/catalog/catalog.ts";
import { blockerCount, checkSealedRoot, checkSuite, insideRepo, loadSuite, sealedLeaks, setSealedRoot, SuiteError, suiteFromCatalog, suiteStub } from "./suite.ts";

export const HELP = `Usage: gstack-evals noloss <command> [options]

Scores review variants on the blockers a reference review catches. No command calls a model.

Every command takes --sealed-root <dir>: an absolute directory outside the repo holding a sealed suite
(suites/<id>.json) and its catalogs. A sealed suite's stub in lanes/review-noloss/suites/ holds counts and digests
only, and loads only with --sealed-root, where its digests and counts must hold.

  suite --check [--suite <id|path>] [--prereg <file>]
      Check a suite: every blocker's case loads with a confirmed answer-key audit and matches its unit's range,
      file and line. --prereg checks each recorded freeze digest on its byte prefix. Default suite: gsta167-14pr.
  suite --from-catalog <dir> [--from-catalog <dir>]... --id <id> --released <YYYY-MM-DD> [--with <suite>] [--out <path>]
        [--stratum <stratum>]...
      Build a suite from catalog dirs: one unit and one blocker per case with a confirmed audit. --released is the
      newest release date among the arm's models (from its prereg); short-shelf-life cases whose fix appeared on or
      before it are listed as ineligible. --with merges into a suite and skips the cases it already names.
      Plan cases build a plan suite: one unit per plan, its group the plan's stratum; --stratum picks the strata
      (default every stratum but pilot). With --sealed-root, the catalog dirs resolve against it. A sealed suite is
      never written inside the repo. Prints the suite JSON, or writes it to --out.
  suite --stub --suite <path> --sealed-root <dir> --custody <text> [--out <path>]
      Print the stub to commit for a sealed suite held under the sealed root: id, kind, counts by blocker kind and
      group, the suite's sha256 and the sha256 over its catalogs' case files. The suite must pass suite --check.
  ingest <arm dir> --suite <id|path> [--check] [--root <dir>] [--digest-only <finding id>|all]... [--replace <reason>]
      Validate an arm against contract v1 (lanes/review-noloss/arm.schema.json), scan it, and publish it to
      <root>/<suite>/<arm id>/ (root: lanes/review-noloss/arms). --check validates and scans and writes nothing.
      A finding that breaks the scan is refused unless --digest-only names it; then only its digest is published.
      A destination holding different bytes is refused unless --replace gives a reason, recorded in ingest.json.

  score --suite <id|path> --variant <id> --reference <id> (--margin <points> --margin-reason <text> | --prereg <file>)
        [--frozen-bar <round>] [--reference-repeat <id>] [--power <share> --power-source <text> | --power-sims <n> [--spread <s>]]
        [--false-blocker-drop <n>] [--false-alarm-gate <n>] [--root <dir>] [--seed <n>] [--draws <n>] [--json] [--out <file>] [--expect <outcome>[,<outcome>]...]
      Compare a variant with a reference on blocking recall, paired by blocker, with PRs as clusters. A margin and its
      reason are required; there is no default. --margin names a post hoc comparison; --prereg reads the comparison
      with this variant and reference from a comparisons file (lanes/review-noloss/comparisons/<suite>.json), with its
      margin, frozen bar and size rule, and scores the file's whole Holm family. The frozen bar prints first, then the verdict, delta, its PR-clustered bootstrap
      interval, losses, gains, both p-values and the minimum reachable p, the size rule, cost and claim eligibility.
      Lines from labelled judging open with "labelled judging". --json prints the versioned record instead; --out also
      writes it to a file. Defaults: --root lanes/review-noloss/arms, --seed ${DEFAULT_SEED}, --draws ${DEFAULT_DRAWS}.
      A comparisons file's loss_family Holm-adjusts its comparisons' LOSS p in the declared order under its null, and
      LOSS is decided on the adjusted p. The false-blocker reading pairs false blockers per pass by PR (exact two-sided
      sign-flip, PR-clustered interval, per-PR table); --false-blocker-drop is the smallest per-PR drop that counts.
      --false-alarm-gate (or a comparison's false_alarm_gate) reads must-fix false alarms on decoy units only (units
      whose every blocker is a bait) and gates the reference: a LOSS whose reference's excess false alarms per decoy has
      a 95% interval reaching past the margin warns FALSE_ALARM_GATE_FAIL, and its claim may not be made. With --prereg,
      a --false-alarm-gate that is not the comparison's preregistered gate scores the comparison post hoc.
      The text output ends with "verdict: <LOSS|NOT_DISTINGUISHED|NO_LOSS|none> [NOLOSS_UNDERPOWERED]". --expect reads
      the run from that line (or the JSON record) and the first reason code, and exits 0 only when the outcome is one
      it lists: LOSS, NOT_DISTINGUISHED, NO_LOSS (a claim), NOLOSS_UNDERPOWERED, NO_VERDICT or a reason code such as
      E_NOLOSS_ARM; otherwise E_NOLOSS_EXPECT.
  export [--comparisons <file>] [--root <dir>] [--table <path>] [--check]
      Score every ingested arm of the comparisons file's suite and every comparison in it as one Holm family,
      regenerate its power table, write the table (default tables/review-noloss.json) and print a markdown render.
      --check recomputes the table and fails with E_NOLOSS_STALE when the file differs; it writes nothing.
      Default comparisons: lanes/review-noloss/comparisons/gsta167-14pr.json.
  power (--suite <id|path> [--from-catalog <dir>... --released <YYYY-MM-DD>] [--extra-prs <n>] | --clusters <n,n,...>)
        --passes <n> --recall <share> --margin <points>... [--loss <points>] [--spread <s>] [--sims <n>] [--seed <n>]
        [--alpha <a>] [--dependence <share>] [--json]
      Simulate the decision rule at a suite's PR cluster sizes: the share of runs in which an arm as good as the
      reference gets NO_LOSS at each margin, the false NO_LOSS rate when the variant is worse by the first margin, and
      with --loss the share of LOSS for that loss. --spread is wide (beta concentration 2, the plan's), narrow (8) or a
      number. --alpha sets both tests' alpha (a Holm family's strictest step is 0.05 over its size); --dependence is
      the share of a blocker's detection-rate concentration its PR cluster shares (the flaws of one plan move together).
      Defaults: --sims 2000, --seed 1, --spread wide, --alpha 0.05, --dependence 0.
  judge-packet --suite <id|path> --arm <dir>... --seed <n> --out <dir> --key <file> [--adjudicate] [--source <owner/repo>=<clone>]...
      --adjudicate packs only the blocking findings judgments.tsv leaves unmatched, with each unit's known informational
      case; judge-join on that key writes adjudication.tsv (defect, not-defect or known-informational per finding).
      Build blinded judge packets, one per unit, from arm directories with findings (ingested or source): every arm's
      findings pooled in a seeded shuffle under opaque ids, with path, line and text only, severity words masked. A
      text naming an arm id or label, "arm <id>", a model id or a hyphenated reader is refused. --key, which maps ids
      back to arms, must sit outside --out. A plan suite's packets show each finding's section, claim, evidence and fix,
      with gstack's plan review heading words stripped, give each blocker its section, line and cause, and carry the
      unit's tree at its head from the --source clone, whose plan.md must hash to every case's plan digest.
  derive --suite <id|path> --comparisons <file> --id <id> --out <dir> [--root <dir>] [--drop <unit ref>]... [--drop-file <tsv>]
        [--drop-gaps] [--detection-only <unit ref>:<blocker>]... [--severity-map <file> | --impact <impact.tsv> --key <file> --impact-judge <judge> | --first-k <k>]
      Re-derive a suite and every arm ingested on it for a secondary or sensitivity reading, so score runs on it unchanged:
      drop units for every arm alike (named, listed in a TSV's unit column, or every unit with a coverage gap or a judgment
      with coverage incomplete), count blockers as detection-only, or re-map severity (a map per arm id or arm name, or one
      judge's impact ratings from judge-run's impact.tsv with the matching batch's key), or keep each unit-pass's first k
      must-fix findings as must-fix (--first-k, the volume-matched reading, which refuses a transcribed arm: it has no
      findings to cut). Findings, matches and rulings never
      change: a re-map recomputes outcomes from the judges' matches. A stopped arm whose every coverage gap is dropped, and
      that left no session unrun, is complete in the derived suite. Writes <out>/<id>.json, <out>/arms/<id>/<arm>/ (ingested),
      <out>/comparisons.<id>.json (the comparisons file with its suite set to <id>) and <out>/derive.json.
  flag-scan --suite <id|path> --run <review-units out>... --audit <contamination.tsv> [--out <flags.tsv>] [--home <dir>]
      Flag each stack-arm unit-pass whose session touched, in that arm's install roots, a file the contamination audit lists
      for the unit, or searched there for the unit's PR number or fix commit (rules in lanes/review-noloss/flag-scan.ts).
      Writes one row per flag (unit, arm, model, pass, rule, tool, call, path, audit_path); derive --drop-file reads it.
  secondary --suite <id|path> --variant <id> --reference <id> --seed <n> [--root <dir>] [--draws <n>] [--permutations <n>] [--json]
      The secondaries score does not compute: each arm's recall at any severity beside its blocking recall (per blocker,
      PR-clustered interval); new blockers (unmatched blocking findings adjudicated a defect) per pass per
      PR, paired by PR with the clustered interval and exact two-sided sign-flip; and idea-card wins (blocking blockers the
      variant found in every pass and the reference in none) beside a null from random within-unit label swaps, its mean
      and 95th percentile. Defaults: --draws 10000, --permutations 10000.
  judge-join --suite <id|path> --key <file> --reply <file> [--second <file>] [--third <file>] --arm <dir>... --out <dir>
        [--replace <reason>] [--unjudged <file>]
      Check each reply against the key's batch and packet digests, apply severity mechanically (the highest mapped
      severity among a blocker's matches wins), and write <out>/<arm id>/ with judgments.tsv (saw_label no) for every
      arm at once, ready for noloss ingest. It names and waits for the second judge (every blocker where the arms
      differ, plus a seeded 20% sample) and a third read (every blocker where the judges differ).
      --unjudged takes judge-run's unjudged.json for the same batch: the blockers of a packet a judge's reply was refused
      twice for are written with coverage incomplete (outcome M) and its findings get no adjudication row.
  judge-run --suite <id|path> --packets <dir> --key <file> --arm <dir>... --brief <file> --primary <provider/model>
        --second <provider/model> --third <provider/model> --item <ledger item> --out <dir> [--source <owner/repo>=<clone>]...
        [--concurrency <n>] [--ledger <path>] [--record <dir>] [--policy <file>] [--dry-run]
      Send each judge the brief, the batch's batch.json and one packet per request (no tools, no system prompt, at most
      16000 output tokens, reasoning effort medium on the OpenAI route) through an in-process metering proxy on a lease
      of the ledger item. The primary reads every packet, the second and third every packet holding a blocker or finding
      of the sets judge-join names. A reply judge-join would refuse is asked again once; a second refusal goes to
      unjudged.json. Writes primary.json, second.json and third.json for judge-join, impact.tsv or verifiable.tsv,
      raw answers under raw/, and run.json with every file's sha256, then prints the judge-join command. Adjudication
      packets go out with an evidence sheet (the finding's masked evidence and the unit head's code from the --source
      clone of its repo) and the run writes unverifiable.tsv. --dry-run checks everything, prints each request's worst
      case and spends and writes nothing. Defaults: --concurrency 4, the default model policy.

Exit codes. Verification reads the verdict line and the first reason code, never exit 2 alone. score: 0 NO_LOSS with the size rule met, 1 LOSS, 2 otherwise (NOT_DISTINGUISHED, a NO_LOSS below or
without the size rule, which warns NOLOSS_UNDERPOWERED, no verdict, or a refusal). Other commands: 0 on success, 2 on
any refusal. Reason codes: E_NOLOSS_SUITE, E_NOLOSS_ARM, E_NOLOSS_JUDGMENT, E_NOLOSS_COST, E_NOLOSS_BLIND,
E_NOLOSS_STALE, E_NOLOSS_ADJUDICATION, E_NOLOSS_EXPECT, LOSS, NOT_DISTINGUISHED, NOLOSS_UNDERPOWERED, FALSE_ALARM_GATE_FAIL (docs/errors.md).`;

export interface NolossIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

class Usage extends Error {}

function version(): string {
  try {
    return readFileSync(join(import.meta.dir, "..", "..", "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

function parseFlags(argv: string[], known: Record<string, "value" | "repeat" | "bool">): { flags: Map<string, string[]>; positional: string[] } {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const kind = known[a];
    if (!kind) throw new Usage("noloss does not take " + JSON.stringify(a) + " here; gstack-evals noloss --help lists the flags");
    if (kind === "bool") {
      flags.set(a, ["true"]);
      continue;
    }
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) throw new Usage(a + " needs a value");
    if (kind === "value" && flags.has(a)) throw new Usage(a + " is given twice");
    flags.set(a, [...(flags.get(a) ?? []), v]);
  }
  return { flags, positional };
}

function report(io: NolossIo, code: ReasonCode, operation: string, message: string, extra: { correlation_id?: string; trace?: string } = {}): number {
  const context = { resource_ids: {}, gstack_evals_version: version(), host: null, host_version: null, image_digest: null, policy_sha256: null, ledger: null, ledger_record: null, env_names: [] };
  io.err(errorLines(errorRecord({ code, operation, message, context, ...extra })).join("\n"));
  return 2;
}

const STRATA: readonly PlanStratum[] = ["seeded", "real-neutral", "home-field", "decoy", "pilot"];

function suiteCmd(argv: string[], io: NolossIo, sealedRoot: string | null): number {
  const { flags, positional } = parseFlags(argv, { "--check": "bool", "--suite": "value", "--prereg": "value", "--from-catalog": "repeat", "--id": "value", "--released": "value", "--with": "value", "--out": "value", "--stratum": "repeat", "--stub": "bool", "--custody": "value" });
  if (positional.length) throw new Usage("noloss suite takes no positional arguments");
  if (flags.has("--stub")) {
    const path = flags.get("--suite")?.[0] ?? (() => { throw new Usage("suite --stub needs --suite <path>, the sealed suite under the sealed root"); })();
    if (sealedRoot === null) throw new Usage("suite --stub needs --sealed-root <dir>");
    const custody = flags.get("--custody")?.[0] ?? (() => { throw new Usage("suite --stub needs --custody <text>: how the sealed copy is held"); })();
    const loaded = loadSuite(path);
    const problems = checkSuite(loaded.suite);
    if (problems.length) throw new SuiteError(problems.join("\n"));
    const text = JSON.stringify(suiteStub(loaded.suite, readFileSync(loaded.path, "utf8"), sealedRoot, custody), null, 2) + "\n";
    const out = flags.get("--out")?.[0];
    if (out) writeFileSync(out, text);
    else io.out(text.trimEnd());
    return 0;
  }
  if (flags.has("--from-catalog")) {
    const id = flags.get("--id")?.[0] ?? (() => { throw new Usage("suite --from-catalog needs --id"); })();
    const released = flags.get("--released")?.[0] ?? null;
    const base = flags.get("--with")?.[0];
    const strata = flags.get("--stratum")?.map((x) => (STRATA.includes(x as PlanStratum) ? (x as PlanStratum) : (() => { throw new Usage("--stratum is one of " + STRATA.join(", ") + ", not " + JSON.stringify(x)); })()));
    const suite = suiteFromCatalog({ id, catalogs: flags.get("--from-catalog")!, released, base: base ? loadSuite(base).suite : undefined, ...(sealedRoot && !base ? { root: sealedRoot } : {}), ...(strata ? { strata } : {}) });
    const text = JSON.stringify(suite, null, 2) + "\n";
    const out = flags.get("--out")?.[0];
    if (out && suite.sealed && insideRepo(resolve(out))) throw new Usage("suite " + id + " is sealed, and --out " + out + " is inside the repo; write it under the sealed root and commit its stub (suite --stub)");
    if (out) writeFileSync(out, text);
    else io.out(text.trimEnd());
    io.err("suite " + id + ": " + suite.units.length + " units, " + new Set(suite.units.map((u) => u.cluster)).size + " clusters, " + blockerCount(suite, "blocking") + " blocking, " + blockerCount(suite, "over-blocking") + " over-blocking, " + blockerCount(suite, "detection") + " detection-only, " + suite.ineligible.length + " ineligible");
    return 0;
  }
  if (!flags.has("--check")) throw new Usage("noloss suite needs --check or --from-catalog");
  const { suite, sha256 } = loadSuite(flags.get("--suite")?.[0] ?? "gsta167-14pr");
  const preregPath = flags.get("--prereg")?.[0];
  const problems = checkSuite(suite, { prereg: preregPath ? readFileSync(preregPath) : undefined });
  if (problems.length) throw new SuiteError(problems.join("\n"));
  io.out("suite " + suite.id + " ok: " + suite.units.length + " units, " + blockerCount(suite) + " blockers, sha256 " + sha256 + (preregPath ? ", " + suite.prereg_freezes.length + " prereg freezes hold" : ""));
  return 0;
}

function ingestCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--check": "bool", "--root": "value", "--digest-only": "repeat", "--replace": "value" });
  if (positional.length !== 1) throw new Usage("noloss ingest takes one arm directory");
  const suiteArg = flags.get("--suite")?.[0] ?? (() => { throw new Usage("noloss ingest needs --suite <id|path>"); })();
  const { suite, sha256 } = loadSuite(suiteArg);
  const files = snapshot(resolve(positional[0]!));
  const p = prepare(files, suite, sha256, flags.get("--digest-only") ?? []);
  const what = "arm " + p.arm.arm.id + " (" + p.arm.provenance + ", " + p.arm.state + ", " + p.arm.arm.passes + " pass" + (p.arm.arm.passes > 1 ? "es" : "") + ")" + (p.digestOnly.length ? ", digest-only: " + p.digestOnly.join(" ") : "");
  if (flags.has("--check")) {
    io.out("ingest --check ok: " + what + " fits contract v1 and suite " + suite.id + "; nothing written");
    return 0;
  }
  const r = publish(p, suite, flags.get("--root")?.[0] ?? ARMS_ROOT, flags.get("--replace")?.[0] ?? null);
  io.out("ingest " + r.status + ": " + what + " at " + r.dest);
  return 0;
}

const num = (flags: Map<string, string[]>, name: string, fallback: number | null, check: (n: number) => boolean, what: string): number => {
  const raw = flags.get(name)?.[0];
  if (raw === undefined) {
    if (fallback === null) throw new Usage(name + " is required (" + what + ")");
    return fallback;
  }
  const n = Number(raw);
  if (!check(n)) throw new Usage(name + " is " + what + ", not " + JSON.stringify(raw));
  return n;
};
const int = (n: number) => Number.isSafeInteger(n) && n >= 0;
const points = (n: number) => n >= 0 && Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;

function scoreCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--variant": "value", "--reference": "value", "--margin": "value", "--margin-reason": "value", "--prereg": "value", "--frozen-bar": "value", "--reference-repeat": "value", "--power": "value", "--power-source": "value", "--power-sims": "value", "--spread": "value", "--root": "value", "--seed": "value", "--draws": "value", "--json": "bool", "--out": "value", "--false-blocker-drop": "value", "--false-alarm-gate": "value" });
  if (positional.length) throw new Usage("noloss score takes no positional arguments");
  const need = (name: string): string => {
    const v = flags.get(name)?.[0];
    if (v === undefined) throw new Usage("noloss score needs " + name);
    return v;
  };
  const { suite, sha256, stub } = loadSuite(need("--suite"));
  const variant = need("--variant");
  const reference = need("--reference");
  let c: Comparison;
  let family: Comparison[] = [];
  let seed = DEFAULT_SEED;
  let draws = DEFAULT_DRAWS;
  let lossFamily: LossFamily | undefined;
  if (flags.has("--prereg")) {
    if (flags.has("--margin") || flags.has("--margin-reason")) throw new Usage("give --margin or --prereg, not both");
    const { file } = loadComparisons(resolve(need("--prereg")));
    if (file.suite !== suite.id) throw new Usage("--prereg is for suite " + file.suite + ", not " + suite.id);
    const found = file.comparisons.find((x) => x.variant === variant && x.reference === reference);
    if (!found) throw new Usage("--prereg has no comparison of " + variant + " against " + reference);
    c = found;
    family = file.comparisons;
    seed = file.seed;
    draws = file.draws;
    lossFamily = file.loss_family;
  } else {
    if (!flags.has("--margin")) throw new Usage("noloss score needs --margin <points> with --margin-reason, or --prereg <file>; there is no default margin");
    const margin = num(flags, "--margin", null, points, "a margin in points with at most one decimal");
    c = { id: variant + "-vs-" + reference, variant, reference, margin_points: margin, margin_reason: need("--margin-reason"), post_hoc: true, frozen_bar: flags.get("--frozen-bar")?.[0] ?? null, reference_repeat: flags.get("--reference-repeat")?.[0] };
  }
  if (flags.has("--power") && flags.has("--power-sims")) throw new Usage("give --power or --power-sims, not both");
  if (flags.has("--power")) c = { ...c, size_rule: { power: num(flags, "--power", null, (n) => n >= 0 && n <= 1, "a share from 0 to 1"), source: need("--power-source") } };
  if (flags.has("--power-sims")) c = { ...c, size_rule: { power_sims: num(flags, "--power-sims", null, (n) => int(n) && n > 0, "a positive integer"), spread: flags.get("--spread")?.[0] ?? "wide" } };
  if (flags.has("--false-blocker-drop")) c = { ...c, false_blocker_drop: num(flags, "--false-blocker-drop", null, (n) => Number.isFinite(n) && n >= 0, "a non-negative number of false blockers per PR") };
  if (flags.has("--false-alarm-gate")) {
    const margin = num(flags, "--false-alarm-gate", null, (n) => Number.isFinite(n) && n >= 0, "a non-negative number of must-fix false alarms per decoy");
    c = { ...c, false_alarm_gate: { margin_per_decoy: margin }, post_hoc: c.post_hoc || c.false_alarm_gate?.margin_per_decoy !== margin };
  }
  seed = num(flags, "--seed", seed, int, "a non-negative integer");
  draws = num(flags, "--draws", draws, (n) => int(n) && n >= 1000, "an integer of at least 1000");
  const out = flags.get("--out")?.[0];
  if (out && suite.sealed && insideRepo(resolve(out))) throw new Usage("suite " + suite.id + " is sealed, and --out " + out + " is inside the repo; write sealed records outside it");
  const arms = loadArms(resolve(flags.get("--root")?.[0] ?? ARMS_ROOT), suite, sha256);
  const rec = scoreComparisons(suite, sha256, arms, family.length ? family.map((x) => (x.id === c.id ? c : x)) : [c], { seed, draws, lossFamily }).find((x) => x.id === c.id)!;
  const json = JSON.stringify(rec, null, 2);
  if (out) writeFileSync(out, json + "\n");
  io.out(flags.has("--json") ? json : [...(stub ? ["sealed suite " + suite.id + ", read through its stub " + stub.sha256.slice(0, 12) + " under " + stub.custody + "."] : []), ...renderRecord(rec), ...falseBlockerTable(rec), verdictLine(rec)].join("\n"));
  for (const w of rec.warnings.filter((x) => x === "FALSE_ALARM_GATE_FAIL")) io.err(w + " " + rec.id + ": LOSS, but the false-alarm gate is " + (rec.false_alarm_gate?.result ?? "not read") + ", so the claim that " + rec.reference.id + " catches more of these blockers may not be made.");
  for (const w of rec.warnings.filter((x) => x !== "FALSE_ALARM_GATE_FAIL")) io.err(w + " " + rec.id + ": NO_LOSS " + (rec.size_rule.met === null ? "with the size rule unchecked" : "below the size rule (power " + rec.size_rule.power + ")") + "; it is not a no-loss claim. Check it with --power-sims or the prereg's --power.");
  return rec.exit;
}

function exportCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--comparisons": "value", "--root": "value", "--table": "value", "--check": "bool", "--publish-sealed-table": "bool" });
  if (positional.length) throw new Usage("noloss export takes no positional arguments");
  const table = resolve(flags.get("--table")?.[0] ?? TABLE_PATH);
  const comparisons = resolve(flags.get("--comparisons")?.[0] ?? join(COMPARISONS_DIR, "gsta167-14pr.json"));
  const t = buildExport({ comparisons, root: resolve(flags.get("--root")?.[0] ?? ARMS_ROOT) });
  const text = tableText(t);
  if (t.suite.sealed && insideRepo(table)) {
    if (!flags.has("--publish-sealed-table")) throw new ScoreError("E_NOLOSS_SUITE", "suite " + t.suite.id + " is sealed, and --table " + table + " is inside the repo; write sealed tables outside it, or pass --publish-sealed-table to publish one that names no sealed unit, cluster, commit or case");
    const leaks = sealedLeaks(loadSuite(loadComparisons(comparisons).file.suite).suite, text);
    if (leaks.length) throw new ScoreError("E_NOLOSS_SUITE", "the table of sealed suite " + t.suite.id + " names what the seal hides, so it is not published: " + leaks.slice(0, 5).join(", ") + (leaks.length > 5 ? " and " + (leaks.length - 5) + " more" : ""));
  }
  if (flags.has("--check")) {
    let committed: string | null;
    try {
      committed = readFileSync(table, "utf8");
    } catch {
      committed = null;
    }
    if (committed !== text) return report(io, "E_NOLOSS_STALE", "noloss export --check", table + (committed === null ? " cannot be read" : " differs from what noloss export computes") + "; run gstack-evals noloss export, review the diff and commit it if intended");
    io.out("export --check ok: " + table + " matches " + t.comparisons.length + " comparisons on " + t.arms.length + " arms");
    return 0;
  }
  mkdirSync(join(table, ".."), { recursive: true });
  writeFileSync(table, text);
  io.out(renderExport(t).trimEnd());
  io.err("export: wrote " + table);
  return 0;
}

function powerCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--from-catalog": "repeat", "--released": "value", "--extra-prs": "value", "--clusters": "value", "--passes": "value", "--recall": "value", "--margin": "repeat", "--loss": "value", "--spread": "value", "--sims": "value", "--seed": "value", "--alpha": "value", "--dependence": "value", "--json": "bool" });
  if (positional.length) throw new Usage("noloss power takes no positional arguments");
  if (flags.has("--suite") === flags.has("--clusters")) throw new Usage("noloss power needs one of --suite or --clusters");
  let clusters: number[];
  let label: string;
  if (flags.has("--clusters")) {
    clusters = flags.get("--clusters")![0]!.split(",").map(Number);
    if (!clusters.every((n) => Number.isSafeInteger(n) && n > 0)) throw new Usage("--clusters is a comma-separated list of blocking blockers per PR");
    label = clusters.length + " PRs";
  } else {
    const base = loadSuite(flags.get("--suite")![0]!).suite;
    const suite = flags.has("--from-catalog") ? suiteFromCatalog({ id: base.id + "-power", catalogs: flags.get("--from-catalog")!, released: flags.get("--released")?.[0] ?? null, base }) : base;
    clusters = [...suiteClusters(suite), ...Array.from({ length: num(flags, "--extra-prs", 0, int, "a non-negative integer") }, () => 1)];
    label = suite.id;
  }
  const margins = (flags.get("--margin") ?? []).map((m) => {
    if (!points(Number(m))) throw new Usage("--margin is points with at most one decimal, not " + JSON.stringify(m));
    return Number(m);
  });
  if (!margins.length) throw new Usage("noloss power needs at least one --margin <points>; there is no default margin");
  const passes = num(flags, "--passes", null, (n) => int(n) && n > 0, "passes per arm, a positive integer");
  const spread = flags.get("--spread")?.[0] ?? "wide";
  const o = { recall: num(flags, "--recall", null, (n) => n > 0 && n < 1, "the reference's blocking recall, a share strictly between 0 and 1"), spread: spreadValue(spread), margins, loss_points: flags.has("--loss") ? num(flags, "--loss", null, (n) => n > 0, "a loss in points") : null, sims: num(flags, "--sims", 2000, (n) => int(n) && n > 0, "a positive integer"), seed: num(flags, "--seed", 1, int, "a non-negative integer"), alpha: num(flags, "--alpha", 0.05, (n) => n > 0 && n < 1, "a share strictly between 0 and 1"), dependence: num(flags, "--dependence", 0, (n) => n >= 0 && n <= 1, "a share from 0 to 1") };
  const rows = powerTable([{ label, clusters, passes }], o);
  io.out(flags.has("--json") ? JSON.stringify({ inputs: { ...o, spread, clusters }, rows }, null, 2) : renderPowerTable(rows, margins, o.loss_points).join("\n"));
  return 0;
}

function judgePacketCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--arm": "repeat", "--seed": "value", "--out": "value", "--key": "value", "--adjudicate": "bool", "--source": "repeat" });
  if (positional.length) throw new Usage("noloss judge-packet takes arms with --arm <dir>");
  for (const f of ["--suite", "--out", "--key", "--seed"]) if (!flags.has(f)) throw new Usage("noloss judge-packet needs " + f);
  const { suite, sha256 } = loadSuite(flags.get("--suite")![0]!);
  const arms = (flags.get("--arm") ?? []).map((d) => readArmDir(resolve(d), suite, sha256));
  const sources = new Map((flags.get("--source") ?? []).map((s) => (s.indexOf("=") > 0 ? [s.slice(0, s.indexOf("=")), resolve(s.slice(s.indexOf("=") + 1))] as const : (() => { throw new Usage("--source takes <owner/repo>=<clone>, not " + JSON.stringify(s)); })())));
  const r = judgePacket({ suite, suiteSha256: sha256, arms, seed: num(flags, "--seed", null, int, "a non-negative integer"), out: resolve(flags.get("--out")![0]!), key: resolve(flags.get("--key")![0]!), adjudicate: flags.has("--adjudicate"), sources });
  io.out("judge-packet: batch " + r.batch + ", " + r.packets + " packets, " + r.findings + " findings from " + arms.length + " arms; the key is outside the packets");
  return 0;
}

function judgeJoinCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--key": "value", "--reply": "value", "--second": "value", "--third": "value", "--arm": "repeat", "--out": "value", "--replace": "value", "--unjudged": "value" });
  if (positional.length) throw new Usage("noloss judge-join takes arms with --arm <dir>");
  for (const f of ["--suite", "--key", "--reply", "--out"]) if (!flags.has(f)) throw new Usage("noloss judge-join needs " + f);
  const { suite, sha256 } = loadSuite(flags.get("--suite")![0]!);
  const arms = (flags.get("--arm") ?? []).map((d) => readArmDir(resolve(d), suite, sha256));
  const opt = (f: string) => (flags.has(f) ? resolve(flags.get(f)![0]!) : null);
  const r = judgeJoin({ suite, suiteSha256: sha256, key: resolve(flags.get("--key")![0]!), primary: resolve(flags.get("--reply")![0]!), second: opt("--second"), third: opt("--third"), unjudged: opt("--unjudged"), arms, out: resolve(flags.get("--out")![0]!), replace: flags.get("--replace")?.[0] ?? null });
  io.out("judge-join: batch " + r.batch + ", wrote " + (r.kind === "adjudication" ? "adjudication.tsv" : "judgments") + " for " + r.arms.join(", ") + " under " + r.out + "; second judge on " + r.second_required + " blockers (kappa " + (r.kappa_primary_second ?? "n/a") + "), third read on " + r.third_required + ". Ingest each arm with noloss ingest.");
  return 0;
}

function deriveCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--comparisons": "value", "--root": "value", "--id": "value", "--out": "value", "--drop": "repeat", "--drop-file": "value", "--drop-gaps": "bool", "--detection-only": "repeat", "--severity-map": "value", "--impact": "value", "--key": "value", "--impact-judge": "value", "--first-k": "value" });
  if (positional.length) throw new Usage("noloss derive takes no positional arguments");
  for (const f of ["--suite", "--comparisons", "--id", "--out"]) if (!flags.has(f)) throw new Usage("noloss derive needs " + f);
  const impact = flags.get("--impact")?.[0];
  if (impact && (!flags.has("--key") || !flags.has("--impact-judge"))) throw new Usage("--impact needs --key <matching batch key> and --impact-judge <judge>");
  const r = derive({ suite: flags.get("--suite")![0]!, comparisons: flags.get("--comparisons")![0]!, root: flags.get("--root")?.[0] ?? ARMS_ROOT, id: flags.get("--id")![0]!, out: flags.get("--out")![0]!, drop: flags.get("--drop") ?? [], dropFile: flags.get("--drop-file")?.[0] ?? null, dropGaps: flags.has("--drop-gaps"), detectionOnly: flags.get("--detection-only") ?? [], severityMap: flags.get("--severity-map")?.[0] ?? null, impact: impact ? { tsv: impact, key: flags.get("--key")![0]!, judge: flags.get("--impact-judge")![0]! } : null, firstK: flags.has("--first-k") ? num(flags, "--first-k", null, (n) => int(n) && n >= 1, "a whole number from 1") : null });
  io.out("derive " + r.suite.id + ": " + r.operations.join("; "));
  io.out("suite " + r.suite.path + " sha256 " + r.suite.sha256 + ": " + r.suite.units + " units, " + r.suite.blocking + " blocking blockers on " + r.suite.clusters + " PRs; " + r.dropped.length + " units dropped" + (r.dropped.length ? " (" + r.dropped.map((d) => d.unit).join(", ") + ")" : ""));
  io.out("comparisons " + r.comparisons.path + " sha256 " + r.comparisons.sha256);
  for (const a of r.arms) io.out("arm " + a.id + ": " + (a.status_before === a.status ? a.status : a.status_before + " -> " + a.status) + (a.coverage_gaps ? ", " + a.coverage_gaps + " coverage gaps left" : "") + (a.cost_rows_dropped ? ", " + a.cost_rows_dropped + " cost rows dropped" : "") + ", tree " + a.tree_sha256);
  io.out("score with: gstack-evals noloss score --suite " + r.suite.path + " --root " + join(resolve(flags.get("--out")![0]!), "arms") + " --prereg " + r.comparisons.path + " --variant <id> --reference <id>");
  return 0;
}

function flagScanCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--run": "repeat", "--audit": "value", "--out": "value", "--home": "value" });
  if (positional.length) throw new Usage("noloss flag-scan takes no positional arguments");
  for (const f of ["--suite", "--run", "--audit"]) if (!flags.has(f)) throw new Usage("noloss flag-scan needs " + f);
  const { suite } = loadSuite(flags.get("--suite")![0]!);
  const all = flags.get("--run")!.map((run) => flagScan({ suite, run: resolve(run), audit: flags.get("--audit")![0]!, home: flags.get("--home")?.[0] }));
  const text = flagsTsv(all.flatMap((r) => r.flags));
  const out = flags.get("--out")?.[0];
  if (out) writeFileSync(out, text);
  const arms = [...new Set(all.flatMap((r) => Object.keys(r.sessions)))].sort();
  for (const arm of arms) {
    const units = [...new Set(all.flatMap((r) => r.flagged[arm]?.units ?? []))];
    io.out("flag-scan " + arm + ": " + all.reduce((n, r) => n + (r.sessions[arm] ?? 0), 0) + " sessions, " + all.reduce((n, r) => n + (r.flagged[arm]?.passes ?? 0), 0) + " unit-passes flagged on " + units.length + " units" + (units.length ? " (" + units.join(", ") + ")" : ""));
  }
  if (!out) io.out(text.trimEnd());
  return 0;
}

function secondaryCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--variant": "value", "--reference": "value", "--seed": "value", "--root": "value", "--draws": "value", "--permutations": "value", "--json": "bool" });
  if (positional.length) throw new Usage("noloss secondary takes no positional arguments");
  for (const f of ["--suite", "--variant", "--reference", "--seed"]) if (!flags.has(f)) throw new Usage("noloss secondary needs " + f);
  const int = (f: string, d: number) => {
    const v = Number(flags.get(f)?.[0] ?? d);
    if (!Number.isInteger(v) || v < 1) throw new Usage(f + " takes a whole number above 0");
    return v;
  };
  const { suite, sha256 } = loadSuite(flags.get("--suite")![0]!);
  const arms = loadArms(resolve(flags.get("--root")?.[0] ?? ARMS_ROOT), suite, sha256);
  const scored = (f: string) => arms.get(flags.get(f)![0]!) ?? (() => { throw new ScoreError("E_NOLOSS_ARM", "noloss secondary: no arm " + flags.get(f)![0] + " is ingested on suite " + suite.id); })();
  const sv = scored("--variant");
  const sr = scored("--reference");
  const v = sv.arm;
  const r = sr.arm;
  const seed = int("--seed", 0);
  const draws = int("--draws", DEFAULT_DRAWS);
  if (draws < 1000) throw new Usage("--draws takes an integer of at least 1000");
  const recall = [sv, sr].map((s) => {
    const m = armMetrics(suite, s, { seed, draws });
    return { arm: s.arm.arm.id, blocking: m.blocking, any_severity: m.detection };
  });
  const nb = newBlockers(suite, v, r, { seed, draws });
  const wins = ideaWins(suite, v, r, { seed, permutations: int("--permutations", 10000) });
  if (flags.has("--json")) {
    io.out(JSON.stringify({ suite: { id: suite.id, sha256 }, variant: v.arm.id, reference: r.arm.id, seed, recall, new_blockers: nb, idea_wins: wins }, null, 2));
    return 0;
  }
  io.out("noloss secondary: " + v.arm.id + " vs " + r.arm.id + " on " + suite.id + " (sha256 " + sha256 + "), seed " + seed);
  const rate = (x: (typeof recall)[number]["blocking"]) => (x ? x.found + "/" + x.n + " = " + x.recall + " [" + (x.ci95?.join(", ") ?? "n/a") + "]" : "n/a");
  for (const x of recall) io.out("recall, " + x.arm + ": blocking " + rate(x.blocking) + "; at any severity " + rate(x.any_severity));
  if (!nb.complete) io.out("new blockers: no reading: " + nb.reasons.join("; "));
  else io.out("new blockers per pass per PR: variant " + nb.per_pr!.variant + ", reference " + nb.per_pr!.reference + " (" + nb.totals!.variant + " and " + nb.totals!.reference + " in all, " + nb.prs + " PRs); difference " + nb.difference + " [" + (nb.ci95?.join(", ") ?? "n/a") + "], exact two-sided sign-flip p " + (nb.p_two_sided ?? "n/a") + " (min p " + (nb.min_p ?? "n/a") + ")");
  io.out("idea-card wins: " + wins.wins + " of " + wins.blockers + " blocking blockers (found by " + v.arm.id + " in every pass and by " + r.arm.id + " in none; " + wins.left_out + " left out); null from " + int("--permutations", 10000) + " within-unit label swaps: mean " + wins.null_mean + ", 95th percentile " + wins.null_p95 + "; above the null: " + (wins.above_null ? "yes" : "no"));
  for (const w of wins.won) io.out("  won: " + w);
  return 0;
}

/** score --expect: runs score, reads its outcome from the verdict line or record and the first reason code, and checks it. */
async function expectScore(rest: string[], io: NolossIo, sealed: string[]): Promise<number> {
  const i = rest.indexOf("--expect");
  const list = rest[i + 1];
  if (list === undefined || list.startsWith("--") || rest.indexOf("--expect", i + 1) !== -1) throw new Usage("--expect needs one comma-separated list of outcomes");
  const keys = list.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = keys.filter((k) => !OUTCOMES.includes(k) && !/^E_[A-Z0-9_]+$/.test(k));
  if (!keys.length || bad.length) throw new Usage("--expect takes " + OUTCOMES.join(", ") + " or reason codes such as E_NOLOSS_ARM, not " + JSON.stringify(bad.join(",") || list));
  const out: string[] = [];
  const err: string[] = [];
  const exit = await nolossCli(["score", ...rest.slice(0, i), ...rest.slice(i + 2), ...sealed], { out: (t) => out.push(t), err: (t) => err.push(t) });
  out.forEach((t) => io.out(t));
  err.forEach((t) => io.err(t));
  const reading = readScoreRun({ exit, stdout: out.join("\n"), stderr: err.join("\n") });
  if (keys.includes(reading.key)) return 0;
  return report(io, "E_NOLOSS_EXPECT", "noloss score --expect", "the run's outcome is " + reading.key + " (exit " + exit + "), and --expect allows " + keys.join(", "));
}

export async function nolossCli(argv: string[], io: NolossIo): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || args.includes("--help") || args.includes("-h")) {
    io.out(HELP);
    return cmd === undefined ? 2 : 0;
  }
  const at = args.indexOf("--sealed-root");
  const rest = at < 0 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
  try {
    if (at >= 0 && (args[at + 1] === undefined || args[at + 1]!.startsWith("--"))) throw new Usage("--sealed-root needs a directory");
    if (rest.includes("--sealed-root")) throw new Usage("--sealed-root is given twice");
    const sealedRoot = at < 0 ? null : checkSealedRoot(args[at + 1]!);
    setSealedRoot(sealedRoot);
    if (cmd === "score" && rest.includes("--expect")) return await expectScore(rest, io, sealedRoot === null ? [] : ["--sealed-root", sealedRoot]);
    if (cmd === "suite") return suiteCmd(rest, io, sealedRoot);
    if (cmd === "ingest") return ingestCmd(rest, io);
    if (cmd === "score") return scoreCmd(rest, io);
    if (cmd === "export") return exportCmd(rest, io);
    if (cmd === "power") return powerCmd(rest, io);
    if (cmd === "judge-packet") return judgePacketCmd(rest, io);
    if (cmd === "judge-join") return judgeJoinCmd(rest, io);
    if (cmd === "judge-run") return await judgeRunCmd(rest, io);
    if (cmd === "derive") return deriveCmd(rest, io);
    if (cmd === "flag-scan") return flagScanCmd(rest, io);
    if (cmd === "secondary") return secondaryCmd(rest, io);
    throw new Usage("unknown noloss command " + JSON.stringify(cmd) + "; gstack-evals noloss --help lists them");
  } catch (error) {
    if (error instanceof Usage) return report(io, "E_USAGE", "noloss " + cmd, error.message);
    if (error instanceof SuiteError) return report(io, "E_NOLOSS_SUITE", "noloss " + cmd, error.message);
    if (error instanceof ContractError) return report(io, error.code, "noloss " + cmd, error.message);
    if (error instanceof ScoreError) return report(io, error.code, "noloss " + cmd, error.message);
    const id = randomUUID();
    const dir = join(tmpdir(), "gstack-evals-traces");
    let trace: string | undefined;
    try {
      mkdirSync(dir, { recursive: true });
      trace = join(dir, "noloss-" + id + ".txt");
      writeFileSync(trace, scrubSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)) + "\n");
    } catch {
      trace = undefined;
    }
    return report(io, "E_INTERNAL", "noloss " + cmd, "unexpected failure in lanes/review-noloss: " + (error instanceof Error ? error.message : String(error)) + "; this is a defect, not your input. File an issue with these lines and the trace file.", { correlation_id: id, trace });
  } finally {
    setSealedRoot(null);
  }
}

export async function main(argv: string[]): Promise<number> {
  return nolossCli(argv, { out: (t) => console.log(t), err: (t) => console.error(t) });
}
