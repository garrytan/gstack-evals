// Copyright (c) 2026 Garry Tan. MIT License.
// noloss judge-packet and judge-join (plan section 7): blinded judging of arms that have findings. A packet per unit
// pools every arm's findings from every pass in a seeded shuffle under opaque ids, keeping only path, line and text with
// severity words masked; the key that maps ids back to arms is written outside the packet directory. The batch digest
// binds the suite, each arm's tree digest, the seed and the key's mapping, and every reply must name that batch and each
// packet's digest. judge-join applies severity mechanically (the highest mapped severity among a blocker's matches
// wins), requires the second judge on every blocker where the arms disagree plus a seeded 20% sample, and a third read
// wherever the two judges disagree, before it writes judgments.tsv (saw_label no) for every arm at once. No model is
// called here; the judges are paid work under their own preregistration.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { JUDGMENT_COLUMNS, mapSeverity, parseArm, type Arm, type Finding, type Mapped, type Outcome } from "./contract.ts";
import { ScoreError } from "./score.ts";
import { sha256, suiteCases, unitRef, type Suite, type Unit } from "./suite.ts";

export const JUDGE_VERSION = 1;
export const SECOND_SAMPLE = 0.2;
const SEVERITY_WORDS = ["CRITICAL", "INFORMATIONAL", "HIGH", "MEDIUM", "LOW", "BLOCKER", "BLOCKING", "FIXABLE", "INVESTIGATE", "NIT", "MAJOR", "MINOR", "SEVERE", "P0", "P1", "P2", "P3"];

const blind = (message: string): never => {
  throw new ScoreError("E_NOLOSS_BLIND", message);
};

export interface LoadedArm {
  arm: Arm;
  files: Map<string, Buffer>;
  treeSha256: string;
}

export interface KeyEntry {
  packet: string;
  opaque: string;
  arm: string;
  pass: number;
  finding: string;
}

export interface JudgeKey {
  version: number;
  batch: string;
  suite: { id: string; sha256: string };
  arms: Array<{ id: string; tree_sha256: string }>;
  seed: number;
  mapping_sha256: string;
  packets: Array<{ file: string; unit: string; sha256: string }>;
  entries: KeyEntry[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (s: string, flags = "i") => new RegExp("(?<![A-Za-z0-9_])" + escape(s) + "(?![A-Za-z0-9_])", flags);
const fileName = (suite: Suite, u: Unit) => "packets/" + unitRef(suite, u).replace(/\//g, "__") + ".json";
const batchDigest = (k: Pick<JudgeKey, "suite" | "arms" | "seed" | "mapping_sha256">) => sha256(JSON.stringify({ version: JUDGE_VERSION, suite: k.suite, arms: k.arms, seed: k.seed, mapping_sha256: k.mapping_sha256 }));
const inside = (child: string, dir: string) => resolve(child) === resolve(dir) || resolve(child).startsWith(resolve(dir) + sep);

/** Texts a packet must never carry: arm ids and labels (3 or more characters), "arm <id>", model ids, and reader names with a hyphen or digit. */
function leakRules(arms: LoadedArm[]): Array<{ rule: string; re: RegExp }> {
  const rules = new Map<string, { rule: string; re: RegExp }>();
  const add = (rule: string, re: RegExp) => rules.set(re.source, { rule, re });
  for (const { arm } of arms) {
    for (const s of [arm.arm.id, arm.arm.label]) if (s.length >= 3) add("an arm id or label", wholeWord(s));
    add("arm <id>", new RegExp("(?<![A-Za-z0-9_])arm\\s+" + escape(arm.arm.id) + "(?![A-Za-z0-9_-])", "i"));
    for (const m of arm.arm.models ?? []) for (const s of new Set([m.model, m.model.split("/").pop()!])) add("a model id", new RegExp(escape(s), "i"));
    for (const list of arm.findings?.values() ?? []) for (const f of list) if (f.reader && /[-0-9]/.test(f.reader)) add("a reader name", wholeWord(f.reader));
  }
  return [...rules.values()];
}

/** Severity words, the standard ones and every raw label the arms use, masked as whole words. */
function masker(arms: LoadedArm[]): (text: string) => string {
  const words = new Set(SEVERITY_WORDS);
  for (const { arm } of arms) {
    const maps = [arm.arm.severity_map?.default ?? {}, ...Object.values(arm.arm.severity_map?.by_reader ?? {})];
    for (const m of maps) for (const k of Object.keys(m)) words.add(k);
    for (const list of arm.findings?.values() ?? []) for (const f of list) if (f.raw) words.add(f.raw);
  }
  const res = [...words].filter(Boolean).sort((a, b) => b.length - a.length).map((w) => wholeWord(w, "gi"));
  return (text) => res.reduce((t, re) => t.replace(re, "[severity]"), text);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Writes one packet per unit and batch.json under out, and the key file at key, which must sit outside out. */
export function judgePacket(o: { suite: Suite; suiteSha256: string; arms: LoadedArm[]; seed: number; out: string; key: string }): { batch: string; packets: number; findings: number } {
  const { suite, arms } = o;
  if (inside(o.key, o.out)) blind("--key " + o.key + " is inside --out " + o.out + "; the key maps opaque ids back to arms and must never travel with the packets");
  if (existsSync(o.key)) blind("--key " + o.key + " already exists; give each batch a new key path");
  if (existsSync(o.out) && readdirSync(o.out).length) blind("--out " + o.out + " is not empty; write each batch to a new directory");
  if (!arms.length) blind("judge-packet needs at least one arm");
  const ids = arms.map((a) => a.arm.arm.id);
  if (new Set(ids).size !== ids.length) blind("an arm is given twice: " + ids.join(", "));
  for (const a of arms) if (!a.arm.findings) blind("arm " + a.arm.arm.id + " is transcribed: it has no findings to judge");
  const rng = seededRandom(o.seed);
  const mask = masker(arms);
  const leaks = leakRules(arms);
  const cases = suiteCases(suite).cases;
  const problems: string[] = [];
  const entries: KeyEntry[] = [];
  const bodies: Array<{ file: string; unit: Unit; findings: Array<{ id: string; path: string | null; line: number | null; text: string }> }> = [];
  for (const u of suite.units) {
    const file = fileName(suite, u);
    const pooled = shuffle(
      arms.flatMap((a) => (a.arm.findings!.get(u.id) ?? []).map((f) => ({ arm: a.arm.arm.id, f }))),
      rng,
    );
    const width = String(pooled.length).length;
    const findings = pooled.map(({ arm, f }, i) => {
      const opaque = "F" + String(i + 1).padStart(width, "0");
      entries.push({ packet: file, opaque, arm, pass: f.pass, finding: f.id });
      const text = mask(f.summary + (f.fix ? "\nFix: " + f.fix : ""));
      for (const { rule, re } of leaks) if (re.test(text) || (f.path && re.test(f.path))) problems.push(unitRef(suite, u) + ", arm " + arm + ", finding " + JSON.stringify(f.id) + ": its text names " + rule);
      return { id: opaque, path: f.path, line: f.line, text };
    });
    bodies.push({ file, unit: u, findings });
  }
  if (problems.length) blind("the packets would leak what blinding hides:\n" + problems.join("\n") + "\nremove it from the source arm's findings and ingest it again");
  const head = { suite: { id: suite.id, sha256: o.suiteSha256 }, arms: arms.map((a) => ({ id: a.arm.arm.id, tree_sha256: a.treeSha256 })).sort((x, y) => (x.id < y.id ? -1 : 1)), seed: o.seed, mapping_sha256: sha256(JSON.stringify(entries)) };
  const batch = batchDigest(head);
  const staging = resolve(o.out) + ".staging-" + process.pid;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "packets"), { recursive: true });
  const packets: JudgeKey["packets"] = [];
  for (const b of bodies) {
    const packet = {
      version: JUDGE_VERSION,
      batch,
      unit: { repo: b.unit.repo, pr: b.unit.pr, head: b.unit.head, base: b.unit.base },
      blockers: b.unit.blockers.map((x) => ({ id: x.id, paths: x.paths, file: x.file, line: x.line, cause: cases.get(x.case)?.defect.summary ?? "" })),
      findings: b.findings,
    };
    const bytes = Buffer.from(JSON.stringify(packet, null, 2) + "\n");
    writeFileSync(join(staging, b.file), bytes);
    packets.push({ file: b.file, unit: b.unit.id, sha256: sha256(bytes) });
  }
  const reply = { batch, judge: "<judge name and model>", packets: packets.slice(0, 1).map((p) => ({ file: p.file, sha256: p.sha256, blockers: [{ id: "B1", matches: bodies[0]!.findings.slice(0, 1).map((f) => f.id) }] })) };
  writeFileSync(
    join(staging, "batch.json"),
    JSON.stringify({ version: JUDGE_VERSION, batch, suite: head.suite, judging_rule: suite.judging_rule, packets, adjudication: "A second judge answers every blocker where the arms' outcomes differ plus a seeded " + SECOND_SAMPLE * 100 + "% sample of the rest; a third read answers every blocker where the two judges differ. judge-join names each set.", reply_format: reply, reply_rules: "One JSON reply per judge: batch, judge, and for each packet its file, its sha256 and every blocker you answer with the ids of the findings that name the same defect (an empty list when none does). Judge the defect, not the severity: severity is applied mechanically." }, null, 2) + "\n",
  );
  mkdirSync(resolve(o.out, ".."), { recursive: true });
  rmSync(o.out, { recursive: true, force: true });
  renameSync(staging, o.out);
  writeFileSync(o.key, JSON.stringify({ version: JUDGE_VERSION, batch, ...head, packets, entries } satisfies JudgeKey, null, 2) + "\n", { mode: 0o600 });
  return { batch, packets: packets.length, findings: entries.length };
}

interface Reply {
  judge: string;
  answers: Map<string, Set<string>>;
  digest: string;
}

/** Validates a reply against the key: its batch, each packet's digest, known blockers and opaque ids. */
function readReply(path: string, key: JudgeKey, suite: Suite, role: string): Reply {
  let bytes: Buffer;
  let r: { batch?: unknown; judge?: unknown; packets?: unknown };
  try {
    bytes = readFileSync(path);
    r = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return blind("the " + role + " reply " + path + " is not readable JSON: " + (e as Error).message);
  }
  if (r.batch !== key.batch) blind("the " + role + " reply names batch " + JSON.stringify(r.batch) + ", not this key's batch " + key.batch + "; a reply only joins the batch whose packets it judged");
  if (typeof r.judge !== "string" || !r.judge.trim() || /[\t\r\n]/.test(r.judge)) blind("the " + role + " reply needs a judge name on one line");
  if (!Array.isArray(r.packets)) blind("the " + role + " reply needs a packets list");
  const answers = new Map<string, Set<string>>();
  for (const p of r.packets as Array<{ file?: unknown; sha256?: unknown; blockers?: unknown }>) {
    const known = key.packets.find((k) => k.file === p.file);
    if (!known) blind("the " + role + " reply answers packet " + JSON.stringify(p.file) + ", which this batch does not have");
    if (p.sha256 !== known!.sha256) blind("the " + role + " reply's " + known!.file + " has digest " + JSON.stringify(p.sha256) + ", not " + known!.sha256 + "; it judged a stale or swapped packet");
    const unit = suite.units.find((u) => u.id === known!.unit)!;
    const opaques = new Set(key.entries.filter((e) => e.packet === known!.file).map((e) => e.opaque));
    for (const b of (Array.isArray(p.blockers) ? p.blockers : []) as Array<{ id?: unknown; matches?: unknown }>) {
      const blocker = unit.blockers.find((x) => x.id === b.id);
      if (!blocker) blind("the " + role + " reply answers blocker " + JSON.stringify(b.id) + " in " + known!.file + ", which has " + unit.blockers.map((x) => x.id).join(", "));
      const k = unit.id + " " + blocker!.id;
      if (answers.has(k)) blind("the " + role + " reply answers " + known!.file + " " + blocker!.id + " twice");
      if (!Array.isArray(b.matches) || !b.matches.every((m) => typeof m === "string" && opaques.has(m))) blind("the " + role + " reply's matches for " + known!.file + " " + blocker!.id + " must be finding ids from that packet");
      answers.set(k, new Set(b.matches as string[]));
    }
  }
  return { judge: (r.judge as string).trim(), answers, digest: sha256(bytes!) };
}

interface Cell {
  outcome: Outcome;
  matched: Finding[];
  mapped: Mapped | null;
}

/** Outcome per arm and pass for one blocker: the highest mapped severity among the matched findings wins. */
function cellsFor(key: JudgeKey, arms: Map<string, Arm>, unit: Unit, matches: Set<string>, packet: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const [id, arm] of arms)
    for (let p = 1; p <= arm.arm.passes; p++) {
      const findings = key.entries.filter((e) => e.packet === packet && e.arm === id && e.pass === p && matches.has(e.opaque)).map((e) => arm.findings!.get(unit.id)!.find((f) => f.id === e.finding && f.pass === p)!);
      const maps = findings.map((f) => mapSeverity(arm.arm, f.raw, f.reader));
      const mapped: Mapped | null = maps.includes("CRITICAL") ? "CRITICAL" : maps.includes("INFORMATIONAL") ? "INFORMATIONAL" : null;
      cells.set(id + " " + p, { outcome: mapped === "CRITICAL" ? "F" : mapped === "INFORMATIONAL" ? "D" : "M", matched: findings, mapped });
    }
  return cells;
}

const sameOutcomes = (a: Map<string, Cell>, b: Map<string, Cell>) => [...a].every(([k, c]) => b.get(k)?.outcome === c.outcome);

function kappa(pairs: Array<[Outcome, Outcome]>): number | null {
  if (!pairs.length) return null;
  const po = pairs.filter(([x, y]) => x === y).length / pairs.length;
  const pe = (["F", "D", "M"] as Outcome[]).reduce((s, o) => s + (pairs.filter(([x]) => x === o).length / pairs.length) * (pairs.filter(([, y]) => y === o).length / pairs.length), 0);
  return pe < 1 ? Math.round(((po - pe) / (1 - pe)) * 1e4) / 1e4 : null;
}

export interface JoinResult {
  batch: string;
  arms: string[];
  second_required: number;
  third_required: number;
  kappa_primary_second: number | null;
  out: string;
}

/**
 * Joins the judges' replies into judgments.tsv for every arm of the batch, written under out/<arm id>/ with the arm's
 * other contract files, ready for noloss ingest. Refuses until the second and third reads the batch requires are given.
 */
export function judgeJoin(o: { suite: Suite; suiteSha256: string; key: string; primary: string; second: string | null; third: string | null; arms: LoadedArm[]; out: string; replace: string | null }): JoinResult {
  const { suite } = o;
  let key: JudgeKey;
  try {
    key = JSON.parse(readFileSync(o.key, "utf8"));
  } catch (e) {
    return blind("--key " + o.key + " is not readable JSON: " + (e as Error).message);
  }
  if (key.version !== JUDGE_VERSION || !Array.isArray(key.entries) || !Array.isArray(key.packets) || !Array.isArray(key.arms)) blind("--key " + o.key + " is not a judge key of version " + JUDGE_VERSION);
  if (sha256(JSON.stringify(key.entries)) !== key.mapping_sha256 || batchDigest(key) !== key.batch) blind("--key " + o.key + " does not hash to its own batch digest; it was edited or swapped");
  if (key.suite.id !== suite.id || key.suite.sha256 !== o.suiteSha256) blind("the batch was built on suite " + key.suite.id + " at " + key.suite.sha256 + ", not " + suite.id + " at " + o.suiteSha256);
  const given = o.arms.map((a) => a.arm.arm.id).sort();
  const bound = key.arms.map((a) => a.id);
  if (given.join(",") !== bound.join(",")) blind("the batch judged arms " + bound.join(", ") + "; --arm gave " + given.join(", "));
  for (const a of o.arms) {
    const t = key.arms.find((x) => x.id === a.arm.arm.id)!.tree_sha256;
    if (t !== a.treeSha256) blind("arm " + a.arm.arm.id + " changed since the packets were built (tree " + t + ", now " + a.treeSha256 + "); build a new batch");
  }
  const arms = new Map(o.arms.map((a) => [a.arm.arm.id, a.arm]));
  const cellKeys = suite.units.flatMap((u) => u.blockers.map((b) => ({ u, b, k: u.id + " " + b.id, packet: fileName(suite, u) })));
  const primary = readReply(o.primary, key, suite, "primary");
  const missing = cellKeys.filter((c) => !primary.answers.has(c.k));
  if (missing.length) blind("the primary reply leaves " + missing.length + " blockers unanswered: " + missing.map((c) => unitRef(suite, c.u) + " " + c.b.id).join(", "));
  const first = new Map(cellKeys.map((c) => [c.k, cellsFor(key, arms, c.u, primary.answers.get(c.k)!, c.packet)]));
  const disagree = cellKeys.filter((c) => new Set([...first.get(c.k)!.values()].map((x) => x.outcome)).size > 1);
  const rest = cellKeys.filter((c) => !disagree.includes(c));
  const sample = shuffle(rest, seededRandom(key.seed + 1)).slice(0, Math.ceil(SECOND_SAMPLE * rest.length));
  const secondSet = new Set([...disagree, ...sample].map((c) => c.k));
  const list = (ks: Set<string>) => cellKeys.filter((c) => ks.has(c.k)).map((c) => fileName(suite, c.u) + " " + c.b.id).join(", ");
  if (!o.second) blind("scoring waits for the second judge: send these " + secondSet.size + " blockers (every one where the arms differ, plus a seeded " + SECOND_SAMPLE * 100 + "% sample) with the same packets, then pass --second: " + list(secondSet));
  const second = readReply(o.second!, key, suite, "second");
  const extra = [...second.answers.keys()].filter((k) => !secondSet.has(k)).length;
  const short = [...secondSet].filter((k) => !second.answers.has(k)).length;
  if (extra || short) blind("the second reply must answer exactly the " + secondSet.size + " blockers judge-join named (" + short + " missing, " + extra + " extra): " + list(secondSet));
  const secondCells = new Map([...secondSet].map((k) => { const c = cellKeys.find((x) => x.k === k)!; return [k, cellsFor(key, arms, c.u, second.answers.get(k)!, c.packet)]; }));
  const thirdSet = new Set([...secondSet].filter((k) => !sameOutcomes(first.get(k)!, secondCells.get(k)!)));
  let third: Reply | null = null;
  if (thirdSet.size) {
    if (!o.third) blind("scoring waits for a third read: the two judges differ on these " + thirdSet.size + " blockers; send them with the same packets, then pass --third: " + list(thirdSet));
    third = readReply(o.third!, key, suite, "third");
    const x = [...third.answers.keys()].filter((k) => !thirdSet.has(k)).length;
    const s = [...thirdSet].filter((k) => !third!.answers.has(k)).length;
    if (x || s) blind("the third reply must answer exactly the " + thirdSet.size + " blockers judge-join named (" + s + " missing, " + x + " extra): " + list(thirdSet));
  } else if (o.third) blind("the two judges agree on every blocker, so there is no third read to join; drop --third");
  for (const a of o.arms) if (a.arm.judgments && o.replace === null) blind("arm " + a.arm.arm.id + " already has judgments; pass --replace \"<reason>\" to replace them");
  for (const id of arms.keys()) if (existsSync(join(o.out, id)) && o.replace === null) blind(join(o.out, id) + " already exists; pass --replace \"<reason>\" to overwrite it");
  const written = new Map<string, Map<string, Buffer>>();
  for (const a of o.arms) {
    const arm = a.arm;
    const rows = [[...JUDGMENT_COLUMNS, "pass"].join("\t")];
    for (const c of cellKeys)
      for (let p = 1; p <= arm.arm.passes; p++) {
        const adjudicated = thirdSet.has(c.k);
        const cell = adjudicated ? cellsFor(key, arms, c.u, third!.answers.get(c.k)!, c.packet).get(arm.arm.id + " " + p)! : first.get(c.k)!.get(arm.arm.id + " " + p)!;
        const ref = (f: Finding) => (/[;\s]/.test(f.id) ? "#" + f.index : f.id);
        const raw = cell.matched.find((f) => mapSeverity(arm.arm, f.raw, f.reader) === cell.mapped)?.raw ?? "";
        rows.push([unitRef(suite, c.u), c.b.id, cell.outcome, cell.matched.map(ref).join(";"), raw, cell.mapped ?? "", adjudicated ? third!.judge + " (third read)" : primary.judge, "no", adjudicated ? "the primary and second judges differed; the third read decides" : "", String(p)].join("\t"));
      }
    const files = new Map(a.files);
    files.delete("ingest.json");
    files.set("judgments.tsv", Buffer.from(rows.join("\n") + "\n"));
    parseArm(files, suite, o.suiteSha256);
    written.set(arm.arm.id, files);
  }
  const k = kappa([...secondSet].flatMap((s) => [...first.get(s)!].map(([ck, c]) => [c.outcome, secondCells.get(s)!.get(ck)!.outcome] as [Outcome, Outcome])));
  const record = { version: JUDGE_VERSION, batch: key.batch, suite: key.suite, arms: key.arms, judges: { primary: primary.judge, second: second.judge, third: third?.judge ?? null }, replies_sha256: { primary: primary.digest, second: second.digest, third: third?.digest ?? null }, second_required: secondSet.size, arms_differed: disagree.length, third_required: thirdSet.size, kappa_primary_second: k, replaced: o.replace };
  const staging = resolve(o.out) + ".join-" + process.pid;
  rmSync(staging, { recursive: true, force: true });
  for (const [id, files] of written) for (const [name, bytes] of files) {
    mkdirSync(join(staging, id, name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : ""), { recursive: true });
    writeFileSync(join(staging, id, name), bytes);
  }
  writeFileSync(join(staging, "join-" + key.batch.slice(0, 12) + ".json"), JSON.stringify(record, null, 2) + "\n");
  mkdirSync(o.out, { recursive: true });
  for (const name of readdirSync(staging)) {
    const dest = join(o.out, name);
    const old = join(o.out, "." + name + ".old-" + process.pid);
    if (existsSync(dest)) renameSync(dest, old);
    renameSync(join(staging, name), dest);
    rmSync(old, { recursive: true, force: true });
  }
  rmSync(staging, { recursive: true, force: true });
  return { batch: key.batch, arms: [...arms.keys()], second_required: secondSet.size, third_required: thirdSet.size, kappa_primary_second: k, out: o.out };
}
