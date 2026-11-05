// L1 Amendment C's two read-audit procedures for the none arm (garrytan/gstack-evals#218, wiki/plans/
// 2026-11-05-geva-294-l1-amendment-c), run on the pulled trial dirs before anyone reads a score. Neither reads result.json,
// the verifier's output or a reward: only config.json's agent and arm and evaluator/sdk-messages.jsonl.
//
// xargs, procedure (a). For every tool call of every none session it runs the read audit on that call alone (the init record,
// the call, its result and the user text that follows up to the next assistant message) twice: under the merged rule
// (probes.ts) and under main's line-wide xargs rule from before #218 (probes-8e6795a.ts, byte-identical to 8e6795a's
// quick/laneb/l1/probes.ts and pinned below). It prints each call whose two hit lists differ, both ways, for a person to read,
// then the counts.
//
// contamination, procedure (b). One decision per none session, from the transcript: did gstack file content come back. A call
// is flagged when either rule hits it alone. A flagged call is a real read when its result is not an error and holds a gstack
// line: a line of at least 32 characters, whitespace collapsed, from a text file under .claude/skills, .local/share/gstack or
// .gstack in the before or after arm tar (outside any node_modules or .git dir), that appears in no file of the none arm tar. Read's line numbers are stripped, and the
// line may sit anywhere inside a result line. A flagged call that hits a Capy drive path is a real read when its result is not
// an error and not empty, since drive files are in no tar. Decisions (other sessions print nothing):
//   stands      the merged rule drops the session and a flagged call is a real read, or the merged rule hits the whole
//               session with a hit no single call carries, so no call can be checked (fails closed);
//   overturned  the merged rule drops the session and no flagged call is a real read: a mention, a failed read or an empty one;
//   added       the merged rule keeps the session and a call only the line-wide rule flags is a real read: it is dropped too.
// apply rewrites the session table from the decisions: an overturned contaminated row goes back to graded, and an added graded
// row becomes contaminated, each with the pass table.ts sets for that outcome. Other rows stay as they are.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { L1SessionRow } from "../../../src/types.ts";
import { collapse, parseLog, resultText, runProbes, type Block, type ProbeOptions, type Rec } from "./probes.ts";
import { runProbes as runLineWide } from "./probes-8e6795a.ts";
import { UsageError } from "./table.ts";

export const LINEWIDE_SHA256 = "637e605fbb3af7ea7195c07169e606b1ee719d6e7a1969b78ee63529b6a19b5a";
export const MIN_LINE = 32;
export const AUDIT_DIRS = [".claude/skills", ".local/share/gstack", ".gstack"];
const DRIVE = /\/\.capy\/drive\//;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
function checkLineWide() {
  const got = sha256(readFileSync(join(import.meta.dir, "probes-8e6795a.ts")));
  if (got !== LINEWIDE_SHA256) throw new UsageError("E_USAGE l1 audit: probes-8e6795a.ts hashes to " + got + ", not the pinned " + LINEWIDE_SHA256);
}
const readJson = (path: string): any => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
};
const blocksOf = (r: Rec): Block[] => (Array.isArray(r.content) ? r.content.filter((b): b is Block => !!b && typeof b === "object") : []);

export type Call = { name: string; input: any; error: boolean; text: string; scoped: string[]; lineWide: string[] };

/** Every tool call in one session's log, with the read-audit hits of each rule on that call alone. */
export function sessionCalls(recs: Rec[], home = "/root"): Call[] {
  const init = recs.filter((r) => r.subtype === "init");
  const opts: ProbeOptions = { gstackRoots: [], investigatePrefix: null, home };
  const out: Call[] = [];
  recs.forEach((r, i) => {
    if (r.type !== "AssistantMessage") return;
    for (const b of blocksOf(r)) {
      if (typeof b.id !== "string" || typeof b.name !== "string") continue;
      const mini: Rec[] = [...init, { ...r, content: [b] }];
      let error = false;
      let text = "";
      let found = false;
      for (const next of recs.slice(i + 1)) {
        if (found && next.type === "AssistantMessage") break;
        if (next.type !== "UserMessage") continue;
        if (!found) {
          const m = blocksOf(next).find((x) => x.tool_use_id === b.id);
          if (!m) continue;
          found = true;
          error = m.is_error === true;
          text = resultText(m.content);
          mini.push({ ...next, content: [m] });
          continue;
        }
        const t = blocksOf(next).filter((x) => typeof x.text === "string" && x.tool_use_id === undefined);
        if (!t.length) continue;
        mini.push({ ...next, content: t });
        text += "\n" + t.map((x) => String(x.text)).join("\n");
      }
      out.push({ name: b.name, input: b.input, error, text, scoped: runProbes(mini, opts).audit_hits, lineWide: runLineWide(mini, opts).audit_hits });
    }
  });
  return out;
}

export type Trial = { trial: string; recs: Rec[] };

/** The none-arm Lane B trials under the given dirs (a trial dir, whose config.json names an agent, or any dir above trial dirs), in path order. */
export function noneTrials(dirs: string[]): Trial[] {
  const found: string[] = [];
  const walk = (d: string, depth: number) => {
    if (readJson(join(d, "config.json"))?.agent) return void found.push(d);
    if (depth > 4 || !existsSync(d) || !lstatSync(d).isDirectory()) return;
    for (const e of readdirSync(d).sort()) if (lstatSync(join(d, e)).isDirectory()) walk(join(d, e), depth + 1);
  };
  for (const d of dirs) {
    if (!existsSync(d)) throw new UsageError("E_USAGE l1 audit: no such directory " + d);
    walk(d, 0);
  }
  const out: Trial[] = [];
  for (const d of found) {
    const config = readJson(join(d, "config.json"));
    if (config?.agent?.name !== "laneb-claude-code" || config.agent.kwargs?.arm !== "none") continue;
    const msgs = join(d, "evaluator", "sdk-messages.jsonl");
    out.push({ trial: d.split("/").filter(Boolean).at(-1)!, recs: existsSync(msgs) ? parseLog(readFileSync(msgs, "utf8")) : [] });
  }
  return out;
}

const shown = (c: Call) => collapse(c.name === "Bash" ? String(c.input?.command ?? "") : c.name === "Read" ? String(c.input?.file_path ?? "") : JSON.stringify(c.input ?? null)).slice(0, 400);

/** Procedure (a): one tab-separated line per call whose hits differ between the two rules, then a summary line. */
export function xargsAudit(dirs: string[], home = "/root"): string[] {
  checkLineWide();
  const out: string[] = [];
  const sessions = { lw: new Set<string>(), sc: new Set<string>() };
  let n = 0, calls = 0, lw = 0, sc = 0;
  for (const t of noneTrials(dirs)) {
    n++;
    for (const c of sessionCalls(t.recs, home)) {
      calls++;
      if (JSON.stringify(c.lineWide) === JSON.stringify(c.scoped)) continue;
      const label = !c.scoped.length ? "line-wide only" : !c.lineWide.length ? "scoped only" : "both, different hits";
      if (!c.scoped.length) { lw++; sessions.lw.add(t.trial); }
      if (!c.lineWide.length) { sc++; sessions.sc.add(t.trial); }
      out.push([label, t.trial, c.name, (c.lineWide[0] ?? c.scoped[0])!.slice(0, 200), shown(c)].join("\t"));
    }
  }
  out.push("xargs-audit: " + n + " none sessions, " + calls + " tool calls; line-wide only " + lw + " calls in " + sessions.lw.size + " sessions; scoped only " + sc + " calls in " + sessions.sc.size + " sessions; " + (out.length - lw - sc) + " calls hit by both with different hits");
  return out;
}

export type Corpus = { index: Map<string, { line: string; file: string }[]>; lines: number };

function files(dir: string): string[] {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return [];
  return readdirSync(dir).sort().flatMap((e) => {
    const p = join(dir, e);
    const s = lstatSync(p);
    return s.isDirectory() ? (SKIP_DIRS.has(e) ? [] : files(p)) : s.isFile() ? [p] : [];
  });
}
function textLines(path: string): string[] {
  const b = readFileSync(path);
  return b.includes(0) ? [] : b.toString("utf8").split("\n").map(collapse).filter(Boolean);
}

/** The gstack lines: from the gstack arms' audit dirs (each root is an extracted arm tar), less every line of the none arm. */
export function buildCorpus(gstackRoots: string[], noneRoot: string): Corpus {
  const none = new Set(files(noneRoot).flatMap(textLines));
  const index = new Map<string, { line: string; file: string }[]>();
  const seen = new Set<string>();
  for (const root of gstackRoots) for (const d of AUDIT_DIRS) for (const f of files(join(root, d))) for (const line of textLines(f)) {
    if (line.length < MIN_LINE || none.has(line) || seen.has(line)) continue;
    seen.add(line);
    const k = line.slice(0, MIN_LINE);
    if (!index.has(k)) index.set(k, []);
    index.get(k)!.push({ line, file: relative(root, f) });
  }
  return { index, lines: seen.size };
}

/** The first gstack line inside a result, or null. */
export function gstackLine(text: string, corpus: Corpus): { line: string; file: string } | null {
  for (const raw of text.split("\n")) {
    const s = collapse(raw.replace(/^\s*\d+(\t|\u2192)/, ""));
    for (let p = 0; p + MIN_LINE <= s.length; p++) {
      const m = corpus.index.get(s.slice(p, p + MIN_LINE))?.find((c) => s.startsWith(c.line, p));
      if (m) return m;
    }
  }
  return null;
}

export type Decision = { trial: string; decision: "stands" | "overturned" | "added"; evidence: string };

function realRead(c: Call, corpus: Corpus): string | null {
  if (c.error) return null;
  const hit = [...c.scoped, ...c.lineWide].find((h) => DRIVE.test(h));
  if (hit && c.text.trim()) return c.name + " " + shown(c) + " -> drive content from " + hit.slice(0, 200);
  const m = gstackLine(c.text, corpus);
  return m ? c.name + " " + shown(c) + " -> " + m.file + ": " + m.line.slice(0, 120) : null;
}

/** Procedure (b): the decision for each none session the merged rule drops or the line-wide rule flags with a real read. */
export function decide(dirs: string[], corpus: Corpus, home = "/root"): { decisions: Decision[]; summary: string } {
  checkLineWide();
  const opts: ProbeOptions = { gstackRoots: [], investigatePrefix: null, home };
  const decisions: Decision[] = [];
  let n = 0;
  for (const t of noneTrials(dirs)) {
    n++;
    const whole = runProbes(t.recs, opts).audit_hits;
    const flagged = sessionCalls(t.recs, home).filter((c) => c.scoped.length || c.lineWide.length);
    const real = flagged.flatMap((c) => {
      const e = realRead(c, corpus);
      return e ? [{ c, e }] : [];
    });
    if (whole.length) {
      const callHits = new Set(flagged.flatMap((c) => c.scoped));
      const loose = whole.find((h) => !callHits.has(h));
      if (real.length) decisions.push({ trial: t.trial, decision: "stands", evidence: real[0]!.e });
      else if (loose) decisions.push({ trial: t.trial, decision: "stands", evidence: "the merged rule's hit " + loose.slice(0, 200) + " is on no single call, so no call can be checked" });
      else decisions.push({ trial: t.trial, decision: "overturned", evidence: flagged.length + " flagged calls, no gstack file content came back; first: " + flagged[0]!.name + " " + shown(flagged[0]!) });
      continue;
    }
    const added = real.find((x) => !x.c.scoped.length);
    if (added) decisions.push({ trial: t.trial, decision: "added", evidence: added.e });
  }
  const count = (d: Decision["decision"]) => decisions.filter((x) => x.decision === d).length;
  return { decisions, summary: "contamination: " + n + " none sessions, " + corpus.lines + " gstack lines; the merged rule drops " + (count("stands") + count("overturned")) + ": stands " + count("stands") + ", overturned " + count("overturned") + "; added " + count("added") };
}

/** Applies the decisions to the session table. A decision whose trial matches no none row, or more than one row, refuses. */
export function applyDecisions(rows: L1SessionRow[], decisions: Decision[]): { rows: L1SessionRow[]; summary: string } {
  const out = rows.map((r) => ({ ...r }));
  let back = 0, dropped = 0, kept = 0;
  for (const d of decisions) {
    const match = out.filter((r) => r.trial === d.trial);
    if (match.length !== 1 || match[0]!.arm !== "none") throw new UsageError("E_USAGE l1 audit apply: the decision for " + d.trial + " matches " + match.length + " rows" + (match.length === 1 ? " of arm " + match[0]!.arm : "") + ", not one none row");
    const r = match[0]!;
    if (d.decision === "overturned" && r.outcome === "contaminated") { r.outcome = "graded"; r.pass = !r.allowance_stop && !r.turn_cap && r.reward !== null && r.reward >= 1; r.reason = "graded; read audit overturned (Amendment C): " + d.evidence.slice(0, 200); back++; }
    else if (d.decision === "added" && r.outcome === "graded") { r.outcome = "contaminated"; r.pass = false; r.reason = "read audit (Amendment C, line-wide rule): " + d.evidence.slice(0, 200); dropped++; }
    else kept++;
  }
  return { rows: out, summary: "apply: " + back + " rows back to graded, " + dropped + " rows now contaminated, " + kept + " decisions left their row as it was" };
}

const ARM_TARS = ["before", "after", "none"] as const;

/** Extracts the before, after and none arm tars from an arms dir, each checked against its committed manifest, and builds the corpus. */
export function armCorpus(armsDir: string): Corpus {
  const tmp = mkdtempSync(join(tmpdir(), "l1-audit-"));
  try {
    for (const arm of ARM_TARS) {
      const gz = join(armsDir, arm + ".tar.gz");
      const want = readJson(join(import.meta.dir, "../arms/manifests/l1", arm + ".json"))?.tar_gz_sha256;
      const got = existsSync(gz) ? sha256(readFileSync(gz)) : "missing";
      if (got !== want) throw new UsageError("E_USAGE l1 audit: " + gz + " is " + got + ", the committed manifest says " + want);
      mkdirSync(join(tmp, arm));
      const x = Bun.spawnSync(["tar", "-xzf", gz, "-C", join(tmp, arm)]);
      if (x.exitCode !== 0) throw new UsageError("E_USAGE l1 audit: tar could not extract " + gz + ": " + x.stderr.toString().trim());
    }
    return buildCorpus([join(tmp, "before"), join(tmp, "after")], join(tmp, "none"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function readDecisions(text: string): Decision[] {
  return text.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("trial\t")).map((l) => {
    const [trial, decision, ...rest] = l.split("\t");
    if (!trial || !["stands", "overturned", "added"].includes(decision ?? "")) throw new UsageError("E_USAGE l1 audit apply: bad decision line " + JSON.stringify(l.slice(0, 200)));
    return { trial, decision: decision as Decision["decision"], evidence: rest.join("\t") };
  });
}

if (import.meta.main) {
  const [cmd, ...args] = Bun.argv.slice(2);
  try {
    if (cmd === "xargs" && args.length) console.log(xargsAudit(args).join("\n"));
    else if (cmd === "contamination" && args.length > 1) {
      const { decisions, summary } = decide(args.slice(1), armCorpus(args[0]!));
      console.log(["trial\tdecision\tevidence", ...decisions.map((d) => [d.trial, d.decision, d.evidence.replace(/[\t\n]/g, " ")].join("\t")), "# " + summary].join("\n"));
    } else if (cmd === "apply" && args.length === 3) {
      const rows = readFileSync(args[1]!, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as L1SessionRow);
      const res = applyDecisions(rows, readDecisions(readFileSync(args[0]!, "utf8")));
      writeFileSync(args[2]!, res.rows.map((r) => JSON.stringify(r)).join("\n") + (res.rows.length ? "\n" : ""));
      console.log(res.summary);
    } else throw new UsageError("E_USAGE usage: bun quick/laneb/l1/audit.ts xargs <trial or job dir>... | contamination <arms dir> <trial or job dir>... | apply <decisions.tsv> <sessions.jsonl> <out.jsonl>");
  } catch (e) {
    console.error(e instanceof UsageError ? e.message : "E_USAGE l1 audit: " + String(e));
    process.exit(2);
  }
}
