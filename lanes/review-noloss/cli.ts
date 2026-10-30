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
import { judgeJoin, judgePacket } from "./judge.ts";
import { powerTable, renderPowerTable, spreadValue, suiteClusters } from "./power.ts";
import { DEFAULT_DRAWS, DEFAULT_SEED, renderRecord, scoreComparisons, ScoreError, type Comparison } from "./score.ts";
import { blockerCount, checkSuite, insideRepo, loadSuite, SuiteError, suiteFromCatalog } from "./suite.ts";

export const HELP = `Usage: gstack-evals noloss <command> [options]

Scores review variants on the blockers a reference review catches. No command calls a model.

  suite --check [--suite <id|path>] [--prereg <file>]
      Check a suite: every blocker's case loads with a confirmed answer-key audit and matches its unit's range,
      file and line. --prereg checks each recorded freeze digest on its byte prefix. Default suite: gsta167-14pr.
  suite --from-catalog <dir> [--from-catalog <dir>]... --id <id> --released <YYYY-MM-DD> [--with <suite>] [--out <path>]
      Build a suite from catalog dirs: one unit and one blocker per case with a confirmed audit. --released is the
      newest release date among the arm's models (from its prereg); short-shelf-life cases whose fix appeared on or
      before it are listed as ineligible. --with merges into a suite and skips the cases it already names.
      Prints the suite JSON, or writes it to --out.
  ingest <arm dir> --suite <id|path> [--check] [--root <dir>] [--digest-only <finding id>|all]... [--replace <reason>]
      Validate an arm against contract v1 (lanes/review-noloss/arm.schema.json), scan it, and publish it to
      <root>/<suite>/<arm id>/ (root: lanes/review-noloss/arms). --check validates and scans and writes nothing.
      A finding that breaks the scan is refused unless --digest-only names it; then only its digest is published.
      A destination holding different bytes is refused unless --replace gives a reason, recorded in ingest.json.

  score --suite <id|path> --variant <id> --reference <id> (--margin <points> --margin-reason <text> | --prereg <file>)
        [--frozen-bar <round>] [--reference-repeat <id>] [--power <share> --power-source <text> | --power-sims <n> [--spread <s>]]
        [--root <dir>] [--seed <n>] [--draws <n>] [--json] [--out <file>]
      Compare a variant with a reference on blocking recall, paired by blocker, with PRs as clusters. A margin and its
      reason are required; there is no default. --margin names a post hoc comparison; --prereg reads the comparison
      with this variant and reference from a comparisons file (lanes/review-noloss/comparisons/<suite>.json), with its
      margin, frozen bar and size rule, and scores the file's whole Holm family. The frozen bar prints first, then the verdict, delta, its PR-clustered bootstrap
      interval, losses, gains, both p-values and the minimum reachable p, the size rule, cost and claim eligibility.
      Lines from labelled judging open with "labelled judging". --json prints the versioned record instead; --out also
      writes it to a file. Defaults: --root lanes/review-noloss/arms, --seed ${DEFAULT_SEED}, --draws ${DEFAULT_DRAWS}.
  export [--comparisons <file>] [--root <dir>] [--table <path>] [--check]
      Score every ingested arm of the comparisons file's suite and every comparison in it as one Holm family,
      regenerate its power table, write the table (default tables/review-noloss.json) and print a markdown render.
      --check recomputes the table and fails with E_NOLOSS_STALE when the file differs; it writes nothing.
      Default comparisons: lanes/review-noloss/comparisons/gsta167-14pr.json.
  power (--suite <id|path> [--from-catalog <dir>... --released <YYYY-MM-DD>] [--extra-prs <n>] | --clusters <n,n,...>)
        --passes <n> --recall <share> --margin <points>... [--loss <points>] [--spread <s>] [--sims <n>] [--seed <n>] [--json]
      Simulate the decision rule at a suite's PR cluster sizes: the share of runs in which an arm as good as the
      reference gets NO_LOSS at each margin, the false NO_LOSS rate when the variant is worse by the first margin, and
      with --loss the share of LOSS for that loss. --spread is wide (beta concentration 2, the plan's), narrow (8) or a
      number. Defaults: --sims 2000, --seed 1, --spread wide.
  judge-packet --suite <id|path> --arm <dir>... --seed <n> --out <dir> --key <file>
      Build blinded judge packets, one per unit, from arm directories with findings (ingested or source): every arm's
      findings pooled in a seeded shuffle under opaque ids, with path, line and text only, severity words masked. A
      text naming an arm id or label, "arm <id>", a model id or a hyphenated reader is refused. --key, which maps ids
      back to arms, must sit outside --out.
  judge-join --suite <id|path> --key <file> --reply <file> [--second <file>] [--third <file>] --arm <dir>... --out <dir>
        [--replace <reason>]
      Check each reply against the key's batch and packet digests, apply severity mechanically (the highest mapped
      severity among a blocker's matches wins), and write <out>/<arm id>/ with judgments.tsv (saw_label no) for every
      arm at once, ready for noloss ingest. It names and waits for the second judge (every blocker where the arms
      differ, plus a seeded 20% sample) and a third read (every blocker where the judges differ).

Exit codes. score: 0 NO_LOSS with the size rule met, 1 LOSS, 2 otherwise (NOT_DISTINGUISHED, a NO_LOSS below or
without the size rule, which warns NOLOSS_UNDERPOWERED, no verdict, or a refusal). Other commands: 0 on success, 2 on
any refusal. Reason codes: E_NOLOSS_SUITE, E_NOLOSS_ARM, E_NOLOSS_JUDGMENT, E_NOLOSS_COST, E_NOLOSS_BLIND,
E_NOLOSS_STALE, LOSS, NOT_DISTINGUISHED, NOLOSS_UNDERPOWERED (docs/errors.md).`;

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

function suiteCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--check": "bool", "--suite": "value", "--prereg": "value", "--from-catalog": "repeat", "--id": "value", "--released": "value", "--with": "value", "--out": "value" });
  if (positional.length) throw new Usage("noloss suite takes no positional arguments");
  if (flags.has("--from-catalog")) {
    const id = flags.get("--id")?.[0] ?? (() => { throw new Usage("suite --from-catalog needs --id"); })();
    const released = flags.get("--released")?.[0] ?? null;
    const base = flags.get("--with")?.[0];
    const suite = suiteFromCatalog({ id, catalogs: flags.get("--from-catalog")!, released, base: base ? loadSuite(base).suite : undefined });
    const text = JSON.stringify(suite, null, 2) + "\n";
    const out = flags.get("--out")?.[0];
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
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--variant": "value", "--reference": "value", "--margin": "value", "--margin-reason": "value", "--prereg": "value", "--frozen-bar": "value", "--reference-repeat": "value", "--power": "value", "--power-source": "value", "--power-sims": "value", "--spread": "value", "--root": "value", "--seed": "value", "--draws": "value", "--json": "bool", "--out": "value" });
  if (positional.length) throw new Usage("noloss score takes no positional arguments");
  const need = (name: string): string => {
    const v = flags.get(name)?.[0];
    if (v === undefined) throw new Usage("noloss score needs " + name);
    return v;
  };
  const { suite, sha256 } = loadSuite(need("--suite"));
  const variant = need("--variant");
  const reference = need("--reference");
  let c: Comparison;
  let family: Comparison[] = [];
  let seed = DEFAULT_SEED;
  let draws = DEFAULT_DRAWS;
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
  } else {
    if (!flags.has("--margin")) throw new Usage("noloss score needs --margin <points> with --margin-reason, or --prereg <file>; there is no default margin");
    const margin = num(flags, "--margin", null, points, "a margin in points with at most one decimal");
    c = { id: variant + "-vs-" + reference, variant, reference, margin_points: margin, margin_reason: need("--margin-reason"), post_hoc: true, frozen_bar: flags.get("--frozen-bar")?.[0] ?? null, reference_repeat: flags.get("--reference-repeat")?.[0] };
  }
  if (flags.has("--power") && flags.has("--power-sims")) throw new Usage("give --power or --power-sims, not both");
  if (flags.has("--power")) c = { ...c, size_rule: { power: num(flags, "--power", null, (n) => n >= 0 && n <= 1, "a share from 0 to 1"), source: need("--power-source") } };
  if (flags.has("--power-sims")) c = { ...c, size_rule: { power_sims: num(flags, "--power-sims", null, (n) => int(n) && n > 0, "a positive integer"), spread: flags.get("--spread")?.[0] ?? "wide" } };
  seed = num(flags, "--seed", seed, int, "a non-negative integer");
  draws = num(flags, "--draws", draws, (n) => int(n) && n >= 1000, "an integer of at least 1000");
  const out = flags.get("--out")?.[0];
  if (out && suite.sealed && insideRepo(resolve(out))) throw new Usage("suite " + suite.id + " is sealed, and --out " + out + " is inside the repo; write sealed records outside it");
  const arms = loadArms(resolve(flags.get("--root")?.[0] ?? ARMS_ROOT), suite, sha256);
  const rec = scoreComparisons(suite, sha256, arms, family.length ? family.map((x) => (x.id === c.id ? c : x)) : [c], { seed, draws }).find((x) => x.id === c.id)!;
  const json = JSON.stringify(rec, null, 2);
  if (out) writeFileSync(out, json + "\n");
  io.out(flags.has("--json") ? json : renderRecord(rec).join("\n"));
  for (const w of rec.warnings) io.err(w + " " + rec.id + ": NO_LOSS " + (rec.size_rule.met === null ? "with the size rule unchecked" : "below the size rule (power " + rec.size_rule.power + ")") + "; it is not a no-loss claim. Check it with --power-sims or the prereg's --power.");
  return rec.exit;
}

function exportCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--comparisons": "value", "--root": "value", "--table": "value", "--check": "bool" });
  if (positional.length) throw new Usage("noloss export takes no positional arguments");
  const table = resolve(flags.get("--table")?.[0] ?? TABLE_PATH);
  const t = buildExport({ comparisons: resolve(flags.get("--comparisons")?.[0] ?? join(COMPARISONS_DIR, "gsta167-14pr.json")), root: resolve(flags.get("--root")?.[0] ?? ARMS_ROOT) });
  if (t.suite.sealed && insideRepo(table)) throw new ScoreError("E_NOLOSS_SUITE", "suite " + t.suite.id + " is sealed, and --table " + table + " is inside the repo; write sealed tables outside it");
  const text = tableText(t);
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
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--from-catalog": "repeat", "--released": "value", "--extra-prs": "value", "--clusters": "value", "--passes": "value", "--recall": "value", "--margin": "repeat", "--loss": "value", "--spread": "value", "--sims": "value", "--seed": "value", "--json": "bool" });
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
  const o = { recall: num(flags, "--recall", null, (n) => n > 0 && n < 1, "the reference's blocking recall, a share strictly between 0 and 1"), spread: spreadValue(spread), margins, loss_points: flags.has("--loss") ? num(flags, "--loss", null, (n) => n > 0, "a loss in points") : null, sims: num(flags, "--sims", 2000, (n) => int(n) && n > 0, "a positive integer"), seed: num(flags, "--seed", 1, int, "a non-negative integer") };
  const rows = powerTable([{ label, clusters, passes }], o);
  io.out(flags.has("--json") ? JSON.stringify({ inputs: { ...o, spread, clusters }, rows }, null, 2) : renderPowerTable(rows, margins, o.loss_points).join("\n"));
  return 0;
}

function judgePacketCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--arm": "repeat", "--seed": "value", "--out": "value", "--key": "value" });
  if (positional.length) throw new Usage("noloss judge-packet takes arms with --arm <dir>");
  for (const f of ["--suite", "--out", "--key", "--seed"]) if (!flags.has(f)) throw new Usage("noloss judge-packet needs " + f);
  const { suite, sha256 } = loadSuite(flags.get("--suite")![0]!);
  const arms = (flags.get("--arm") ?? []).map((d) => readArmDir(resolve(d), suite, sha256));
  const r = judgePacket({ suite, suiteSha256: sha256, arms, seed: num(flags, "--seed", null, int, "a non-negative integer"), out: resolve(flags.get("--out")![0]!), key: resolve(flags.get("--key")![0]!) });
  io.out("judge-packet: batch " + r.batch + ", " + r.packets + " packets, " + r.findings + " findings from " + arms.length + " arms; the key is outside the packets");
  return 0;
}

function judgeJoinCmd(argv: string[], io: NolossIo): number {
  const { flags, positional } = parseFlags(argv, { "--suite": "value", "--key": "value", "--reply": "value", "--second": "value", "--third": "value", "--arm": "repeat", "--out": "value", "--replace": "value" });
  if (positional.length) throw new Usage("noloss judge-join takes arms with --arm <dir>");
  for (const f of ["--suite", "--key", "--reply", "--out"]) if (!flags.has(f)) throw new Usage("noloss judge-join needs " + f);
  const { suite, sha256 } = loadSuite(flags.get("--suite")![0]!);
  const arms = (flags.get("--arm") ?? []).map((d) => readArmDir(resolve(d), suite, sha256));
  const opt = (f: string) => (flags.has(f) ? resolve(flags.get(f)![0]!) : null);
  const r = judgeJoin({ suite, suiteSha256: sha256, key: resolve(flags.get("--key")![0]!), primary: resolve(flags.get("--reply")![0]!), second: opt("--second"), third: opt("--third"), arms, out: resolve(flags.get("--out")![0]!), replace: flags.get("--replace")?.[0] ?? null });
  io.out("judge-join: batch " + r.batch + ", wrote judgments for " + r.arms.join(", ") + " under " + r.out + "; second judge on " + r.second_required + " blockers (kappa " + (r.kappa_primary_second ?? "n/a") + "), third read on " + r.third_required + ". Ingest each arm with noloss ingest.");
  return 0;
}

export async function nolossCli(argv: string[], io: NolossIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "--help" || cmd === "-h" || rest.includes("--help") || rest.includes("-h")) {
    io.out(HELP);
    return cmd === undefined ? 2 : 0;
  }
  try {
    if (cmd === "suite") return suiteCmd(rest, io);
    if (cmd === "ingest") return ingestCmd(rest, io);
    if (cmd === "score") return scoreCmd(rest, io);
    if (cmd === "export") return exportCmd(rest, io);
    if (cmd === "power") return powerCmd(rest, io);
    if (cmd === "judge-packet") return judgePacketCmd(rest, io);
    if (cmd === "judge-join") return judgeJoinCmd(rest, io);
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
  }
}

export async function main(argv: string[]): Promise<number> {
  return nolossCli(argv, { out: (t) => console.log(t), err: (t) => console.error(t) });
}
