// Copyright (c) 2026 Garry Tan. MIT License.
// noloss derive (stacks round 1, GST-452 and GST-454): re-derives a suite and every arm ingested on it for a secondary
// or sensitivity reading, so that noloss score scores the reading unchanged. It drops units for every arm alike (units
// named on the command line, units a file lists, or every unit with a coverage gap), marks blockers detection-only, or
// re-maps severity (a map per arm, or one judge's impact ratings). It never changes a finding's text, a judge's match or
// a ruling. A dropped unit takes its findings, judgments, adjudication and cost rows with it. A re-map recomputes each
// judgment's outcome from the findings the judges matched, the way judge-join applies severity, and drops adjudication
// rows of findings that no longer map to CRITICAL. A stopped arm whose every coverage gap names a dropped unit (as
// review-units writes them, "<unit> pass <n>: ..."), and that left no session unrun, is complete in the derived suite; a
// gap that names no unit is never cleared. The derived suite gets its own id and digest, each derived arm
// is published through ingest under <out>/arms/<id>/, and the comparisons file is copied with its suite set to that id,
// so score --suite <out>/<id>.json --root <out>/arms --prereg <out>/comparisons.<id>.json runs as written.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { mapSeverity, parseTsv, rawLabel, type ArmJson, type Mapped } from "./contract.ts";
import { loadComparisons } from "./export.ts";
import { prepare, publish, readIngested } from "./ingest.ts";
import { ScoreError } from "./score.ts";
import { loadSuite, resolveUnit, sha256, type Suite, type Unit } from "./suite.ts";

const ID = /^[a-z0-9][a-z0-9-]*$/;
/** The labels an impact re-map writes, and the severity each maps to. */
export const IMPACT_MAP = { "IMPACT-BLOCKING": "CRITICAL", "IMPACT-NONBLOCKING": "INFORMATIONAL", "IMPACT-UNRATED": "INFORMATIONAL" } as const;
type SeverityMap = NonNullable<ArmJson["severity_map"]>;

export interface DeriveOptions {
  suite: string;
  comparisons: string;
  root: string;
  id: string;
  out: string;
  drop?: string[];
  dropFile?: string | null;
  dropGaps?: boolean;
  detectionOnly?: string[];
  severityMap?: string | null;
  impact?: { tsv: string; key: string; judge: string } | null;
}

export interface DeriveResult {
  suite: { id: string; path: string; sha256: string; units: number; blocking: number; clusters: number };
  comparisons: { path: string; sha256: string };
  dropped: Array<{ unit: string; reasons: string[] }>;
  arms: Array<{ id: string; status_before: string; status: string; coverage_gaps: number; tree_sha256: string; dest: string; cost_rows_dropped: number }>;
  operations: string[];
}

const usage = (message: string): never => {
  throw new ScoreError("E_USAGE", "noloss derive: " + message);
};
const bad = (message: string): never => {
  throw new ScoreError("E_NOLOSS_ARM", "noloss derive: " + message);
};
const tsv = (header: string[], rows: Array<Record<string, string>>) => [header.join("\t"), ...rows.map((r) => header.map((h) => r[h] ?? "").join("\t"))].join("\n") + "\n";
const readerOf = (f: Record<string, unknown>) => (f.reader ?? f.specialist ?? f.voice ?? null) as string | null;

interface Line {
  index: number;
  id: string;
  pass: number;
  fields: Record<string, unknown>;
}

/** A findings file's lines as parseArm reads them: one JSON object per line, an empty file holding none. */
function findingLines(bytes: Buffer): Line[] {
  const lines = bytes.toString("utf8").replace(/\n$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.map((l, index) => {
    const fields = JSON.parse(l) as Record<string, unknown>;
    return { index, id: String(fields.id ?? fields.fingerprint ?? "#" + index), pass: (fields.pass as number | undefined) ?? 1, fields };
  });
}

const findingFor = (list: Line[], ref: string) => list.find((f) => f.id === ref) ?? (/^#\d+$/.test(ref) ? list.find((f) => f.index === Number(ref.slice(1))) : undefined);

export function derive(o: DeriveOptions): DeriveResult {
  if (!ID.test(o.id)) usage("--id " + JSON.stringify(o.id) + " must match " + ID);
  const base = loadSuite(o.suite);
  const suite = base.suite;
  if (o.id === suite.id) usage("--id must differ from the base suite's id " + suite.id);
  const comp = loadComparisons(resolve(o.comparisons));
  if (comp.file.suite !== suite.id) usage("--comparisons is for suite " + comp.file.suite + ", not " + suite.id);
  if (o.severityMap && o.impact) usage("give --severity-map or --impact, not both");
  const out = resolve(o.out);
  if (existsSync(out) && readdirSync(out).length) usage("--out " + o.out + " is not empty; derive each reading into a new directory");
  const dir = join(resolve(o.root), suite.id);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".") && lstatSync(join(dir, n)).isDirectory()).sort() : [];
  if (!names.length) usage("no arm is ingested for suite " + suite.id + " under " + o.root);
  const arms = names.map((n) => readIngested(join(dir, n), suite, base.sha256));
  const unitOf = (ref: string, where: string): Unit => {
    const r = resolveUnit(suite, ref);
    return r.unit ?? usage(where + ": " + r.problem);
  };
  const gapUnit = (gap: string): Unit | null => resolveUnit(suite, gap.split(" pass ")[0]!.trim()).unit;

  const dropped = new Map<string, string[]>();
  const drop = (u: Unit, why: string) => dropped.set(u.id, [...new Set([...(dropped.get(u.id) ?? []), why])]);
  const operations: string[] = [];
  for (const ref of o.drop ?? []) drop(unitOf(ref, "--drop"), "named by --drop");
  if (o.drop?.length) operations.push("drop " + o.drop.length + " named units");
  if (o.dropFile) {
    const text = readFileSync(o.dropFile, "utf8");
    const t = parseTsv(text);
    if (!t.header.includes("unit")) usage("--drop-file " + o.dropFile + " needs a unit column");
    const why = "listed in " + basename(o.dropFile) + " (sha256 " + sha256(text) + ")";
    for (const r of t.rows) drop(unitOf(r.cells.unit!, "--drop-file line " + r.line), why);
    operations.push("drop every unit " + why);
  }
  if (o.dropGaps) {
    for (const { arm } of arms) {
      for (const g of arm.arm.coverage_gaps ?? []) {
        const u = gapUnit(g);
        if (u) drop(u, "a coverage gap in arm " + arm.arm.id);
      }
      for (const j of arm.judgments ?? []) if (j.coverage === "incomplete") drop(j.unit, "a judgment with coverage incomplete in arm " + arm.arm.id);
    }
    operations.push("drop every unit with a coverage gap or a judgment with coverage incomplete in any arm");
  }
  const detection = new Set<string>();
  for (const spec of o.detectionOnly ?? []) {
    const at = spec.lastIndexOf(":");
    if (at < 1) usage("--detection-only takes <unit ref>:<blocker id>, not " + JSON.stringify(spec));
    const u = unitOf(spec.slice(0, at), "--detection-only " + spec);
    const b = u.blockers.find((x) => x.id === spec.slice(at + 1));
    if (!b || b.counts !== "blocking") usage("--detection-only " + spec + ": " + u.id + " has no blocking blocker " + spec.slice(at + 1));
    if (dropped.has(u.id)) usage("--detection-only " + spec + " names a unit this reading drops");
    detection.add(u.id + " " + b!.id);
  }
  if (detection.size) operations.push("count " + [...detection].join(", ") + " as detection-only");

  let maps: Record<string, SeverityMap> | null = null;
  if (o.severityMap) {
    try {
      maps = JSON.parse(readFileSync(o.severityMap, "utf8"));
    } catch (e) {
      usage("--severity-map " + o.severityMap + " is not readable JSON: " + (e as Error).message);
    }
    for (const k of Object.keys(maps!)) if (!arms.some((a) => a.arm.arm.id === k || a.arm.arm.id.startsWith(k + "-"))) usage("--severity-map key " + k + " names no arm ingested on suite " + suite.id);
    operations.push("re-map severity with " + basename(o.severityMap) + " (sha256 " + sha256(readFileSync(o.severityMap)) + ")");
  }
  const mapFor = (id: string): SeverityMap | null => {
    if (o.impact) return { default: { ...IMPACT_MAP } };
    if (!maps) return null;
    const k = maps[id] ? id : Object.keys(maps).filter((x) => id.startsWith(x + "-")).sort((a, b) => b.length - a.length)[0];
    return k ? maps[k]! : null;
  };
  let impact: Map<string, keyof typeof IMPACT_MAP> | null = null;
  if (o.impact) {
    const key = JSON.parse(readFileSync(o.impact.key, "utf8")) as { kind?: string; suite?: { id: string; sha256: string }; arms: Array<{ id: string }>; entries: Array<{ packet: string; opaque: string; arm: string; pass: number; finding: string }> };
    if (key.kind === "adjudicate") usage("--key is an adjudication batch's key; impact ratings come from the matching batch");
    if (key.suite?.id !== suite.id || key.suite.sha256 !== base.sha256) usage("--key was built on suite " + key.suite?.id + " at " + key.suite?.sha256 + ", not " + suite.id + " at " + base.sha256);
    for (const a of arms) if (!key.arms.some((k) => k.id === a.arm.arm.id)) usage("arm " + a.arm.arm.id + " is not in the batch --key names, so its findings have no impact rating");
    const entries = new Map(key.entries.map((e) => [e.packet + " " + e.opaque, e]));
    const text = readFileSync(o.impact.tsv, "utf8");
    const t = parseTsv(text);
    for (const c of ["packet", "opaque", "judge", "impact"]) if (!t.header.includes(c)) usage("--impact " + o.impact.tsv + " needs a " + c + " column");
    impact = new Map();
    for (const { line, cells } of t.rows) {
      if (cells.judge !== o.impact.judge) continue;
      const e = entries.get(cells.packet + " " + cells.opaque) ?? usage("--impact line " + line + " rates " + cells.packet + " " + cells.opaque + ", which --key does not hold");
      if (cells.impact !== "blocking" && cells.impact !== "non-blocking") usage("--impact line " + line + ": impact is blocking or non-blocking, not " + JSON.stringify(cells.impact));
      impact.set(e.arm + "\0" + e.pass + "\0" + e.finding, cells.impact === "blocking" ? "IMPACT-BLOCKING" : "IMPACT-NONBLOCKING");
    }
    if (!impact.size) usage("--impact " + o.impact.tsv + " holds no rating from judge " + o.impact.judge);
    operations.push("re-map severity by judge " + o.impact.judge + "'s impact ratings in " + basename(o.impact.tsv) + " (sha256 " + sha256(text) + "); an unrated finding counts as non-blocking");
  }

  const units = suite.units.filter((u) => !dropped.has(u.id)).map((u) => ({ ...u, blockers: u.blockers.map((b) => (detection.has(u.id + " " + b.id) ? { ...b, counts: "detection" as const } : b)) }));
  if (!units.some((u) => u.blockers.some((b) => b.counts === "blocking"))) usage("the derived suite would hold no blocking blocker");
  if (!operations.length) operations.push("no change");
  const derived: Suite = {
    ...suite,
    id: o.id,
    title: suite.title + " [derived: " + operations.join("; ") + "]",
    purpose: suite.purpose + " Derived by noloss derive from suite " + suite.id + " (sha256 " + base.sha256 + ").",
    units,
    excluded: [...suite.excluded, ...[...dropped].map(([ref, why]) => ({ ref, reason: "dropped by noloss derive: " + why.join("; ") }))],
  };
  mkdirSync(out, { recursive: true });
  const suitePath = join(out, o.id + ".json");
  writeFileSync(suitePath, JSON.stringify(derived, null, 2) + "\n");
  const d = loadSuite(suitePath);

  const results: DeriveResult["arms"] = [];
  for (const { arm, files, treeSha256 } of arms) {
    const id = arm.arm.id;
    const keep = (ref: string) => !dropped.has(unitOf(ref, "arm " + id).id);
    const a = JSON.parse(files.get("arm.json")!.toString("utf8")) as ArmJson;
    const remap = mapFor(id);
    const next = new Map<string, Buffer>();
    const findings = new Map<string, Line[]>();
    for (const [name, bytes] of files) {
      if (!name.startsWith("findings/")) continue;
      const u = unitOf(name.slice("findings/".length).replace(/\.jsonl$/, ""), "arm " + id + " " + name);
      if (dropped.has(u.id)) continue;
      const list = findingLines(bytes);
      findings.set(u.id, list);
      if (!impact) {
        next.set(name, bytes);
        continue;
      }
      for (const f of list) {
        if (typeof f.fields.label === "string") f.fields.label_before_derive = f.fields.label;
        f.fields.label = impact.get(id + "\0" + f.pass + "\0" + f.id) ?? "IMPACT-UNRATED";
      }
      next.set(name, Buffer.from(list.map((f) => JSON.stringify(f.fields) + "\n").join("")));
    }
    const mapped = (f: Line) => mapSeverity(remap ? { ...a, severity_map: remap } : a, rawLabel(f.fields), readerOf(f.fields));
    const before = a.status ?? "complete";
    const gaps = a.coverage_gaps ?? [];
    const left = gaps.filter((g) => !dropped.has(gapUnit(g)?.id ?? ""));
    if (before === "stopped") a.status = gaps.length && !left.length && Number((a.parse_outcomes as { not_run?: number } | undefined)?.not_run ?? 0) === 0 ? "complete" : "stopped";
    if (left.length) a.coverage_gaps = left;
    else delete a.coverage_gaps;
    a.suite = o.id;
    a.suite_sha256 = d.sha256;
    if (remap) a.severity_map = remap;
    a.derived = { from_suite: suite.id, from_suite_sha256: base.sha256, from_tree_sha256: treeSha256, status_before: before, operations };
    next.set("arm.json", Buffer.from(JSON.stringify(a, null, 2) + "\n"));

    const judgments = files.get("judgments.tsv");
    if (judgments) {
      const t = parseTsv(judgments.toString("utf8"));
      const rows = t.rows.filter((r) => keep(r.cells.pr!)).map((r) => r.cells);
      if (remap)
        for (const c of rows) {
          const refs = (c.matched_finding ?? "").split(";").map((s) => s.trim()).filter((s) => s && s !== "-" && s !== "none");
          if (!refs.length) continue;
          const u = unitOf(c.pr!, "arm " + id + " judgments.tsv");
          const list = (findings.get(u.id) ?? []).filter((f) => f.pass === (c.pass ? Number(c.pass) : 1));
          const matched = refs.map((ref) => findingFor(list, ref) ?? bad("arm " + id + " judgments.tsv names finding " + ref + " that " + u.id + " does not hold"));
          const maps = matched.map(mapped);
          const m: Mapped | null = maps.includes("CRITICAL") ? "CRITICAL" : maps.includes("INFORMATIONAL") ? "INFORMATIONAL" : null;
          if (!m) bad("arm " + id + ": the new severity map leaves a matched finding of " + u.id + " unmapped; give every raw label an entry");
          c.outcome = m === "CRITICAL" ? "F" : "D";
          c.mapped_severity = m!;
          c.raw_severity = rawLabel(matched[maps.indexOf(m)]!.fields);
        }
      next.set("judgments.tsv", Buffer.from(tsv(t.header, rows)));
    }
    const adjudication = files.get("adjudication.tsv");
    if (adjudication) {
      const t = parseTsv(adjudication.toString("utf8"));
      const rows = t.rows.filter((r) => {
        if (!keep(r.cells.pr!)) return false;
        if (!remap) return true;
        const list = (findings.get(unitOf(r.cells.pr!, "arm " + id + " adjudication.tsv").id) ?? []).filter((f) => f.pass === (r.cells.pass ? Number(r.cells.pass) : 1));
        const f = findingFor(list, r.cells.finding ?? "");
        return f !== undefined && mapped(f) === "CRITICAL";
      });
      next.set("adjudication.tsv", Buffer.from(tsv(t.header, rows.map((r) => r.cells))));
    }
    let costDropped = 0;
    const cost = files.get("cost.tsv");
    if (cost) {
      const t = parseTsv(cost.toString("utf8"));
      const rows = t.rows.filter((r) => (r.cells.pr === "*" ? (r.cells.covers ?? "").split(/[\s,]+/).filter(Boolean).every(keep) : keep(r.cells.pr!)));
      costDropped = t.rows.length - rows.length;
      next.set("cost.tsv", Buffer.from(tsv(t.header, rows.map((r) => r.cells))));
    }
    const p = prepare(next, d.suite, d.sha256, []);
    const r = publish(p, d.suite, join(out, "arms"), null);
    results.push({ id, status_before: before, status: a.status ?? "complete", coverage_gaps: left.length, tree_sha256: p.treeSha256, dest: r.dest, cost_rows_dropped: costDropped });
  }

  const compPath = join(out, "comparisons." + o.id + ".json");
  writeFileSync(compPath, JSON.stringify({ ...comp.file, suite: o.id, derived: { from_suite: suite.id, from_suite_sha256: base.sha256, from_comparisons: basename(o.comparisons), from_comparisons_sha256: comp.sha256, suite_sha256: d.sha256, operations } }, null, 2) + "\n");
  const c = loadComparisons(compPath);
  const result: DeriveResult = {
    suite: { id: o.id, path: suitePath, sha256: d.sha256, units: units.length, blocking: units.reduce((n, u) => n + u.blockers.filter((b) => b.counts === "blocking").length, 0), clusters: new Set(units.filter((u) => u.blockers.some((b) => b.counts === "blocking")).map((u) => u.cluster)).size },
    comparisons: { path: compPath, sha256: c.sha256 },
    dropped: [...dropped].map(([unit, reasons]) => ({ unit, reasons })),
    arms: results,
    operations,
  };
  writeFileSync(join(out, "derive.json"), JSON.stringify({ version: 1, from: { suite: suite.id, suite_sha256: base.sha256, comparisons_sha256: comp.sha256 }, ...result, suite: { ...result.suite, path: basename(suitePath) }, comparisons: { ...result.comparisons, path: basename(compPath) }, arms: results.map(({ dest: _, ...x }) => x) }, null, 2) + "\n");
  return result;
}
