// Copyright (c) 2026 Garry Tan. MIT License.
// The handoff check and the leak check over real inputs (prereg section 11 items 4 and 7; amendment 1 section 2 rule 7
// and item 15), and the org-rules scan over every history (section 11 item 7's last sentence). The verdicts are rule.ts's;
// this module gathers text and names from histories, keys and a gstack checkout and hands them over in memory.
//   tbv check handoff --artifact <file> --dev <dir> --held <dir> [--held-keys <dir>] [--held-b <dir>] [--held-b-keys <dir>] [--names <file>]
//   tbv check leak --gstack <checkout> --c <sha> --p <sha> --wording <file> --dev <dir> --held <dir> [--dev-keys <dir>] [--held-keys <dir>] [--held-b <dir>] [--held-b-keys <dir>] [--names <file>]
//   tbv check rules --wording <file> --histories <dir>
// A history directory holds tbv-history.v1 files, a key directory tbv-key.v1 files (drops.json is skipped). --held takes
// held-out source A only and --held-b held-out source B only, so the second mode is explicit (amendment 1 section 2 rule
// 7). Exit 0 on CLEAR or CLEAN, 1 on BLOCK or HIT, 2 on a refusal.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.ts";
import { extract } from "./extract.ts";
import { parseFlags } from "./judge.ts";
import { check, grams } from "./rule.ts";
import type { History, Io, Key, Source } from "./types.ts";

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fail("E_TBV_INPUT", "cannot read " + path + " as JSON");
  }
}
function jsonFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return fail("E_TBV_INPUT", "cannot read the directory " + dir);
  }
  return names.filter((n) => n.endsWith(".json") && n !== "drops.json").sort().map((n) => join(dir, n));
}

/** Every tbv-history.v1 file in a directory; source, when given, must be every history's source. */
export function readHistories(dir: string, source?: Source): History[] {
  return jsonFiles(dir).map((f) => {
    const h = readJson<History>(f);
    if (h?.schema !== "tbv-history.v1" || !Array.isArray(h.events) || typeof h.task !== "string") fail("E_TBV_INPUT", f + " is not a tbv-history.v1 file");
    if (source && h.source !== source) fail("E_TBV_INPUT", f + " is a source " + h.source + " history where source " + source + " is required");
    return h;
  });
}
/** Every tbv-key.v1 file in a directory. */
export function readKeys(dir: string): Key[] {
  return jsonFiles(dir).map((f) => {
    const k = readJson<Key>(f);
    if (k?.schema !== "tbv-key.v1" || !Array.isArray(k.facts) || typeof k.digest !== "string") fail("E_TBV_INPUT", f + " is not a tbv-key.v1 file");
    return k;
  });
}

/** A history's text as a model would read it: every event's text, tool name and input, and tool result. */
export function historyText(h: History): string {
  return h.events.map((e) => (e.kind === "tool-use" ? e.name + "\n" + JSON.stringify(e.input) : e.kind === "tool-result" ? e.content : e.text)).join("\n");
}
/** A key's text: the digest, the facts, the traps and the list. */
export function keyText(k: Key): string {
  return [k.digest, ...k.facts.map((f) => f.statement), ...k.traps.flatMap((t) => [t.claim, t.why_false]), ...(k.list ?? []).map((i) => i.name + " " + i.state)].join("\n");
}
/** A SWE-rebench instance id (owner__repo-123) names its repository: owner/repo, repo and owner. */
export function repoNames(task: string): string[] {
  const m = /^([A-Za-z0-9_.-]+?)__([A-Za-z0-9_.-]+)-\d+$/.exec(task);
  return m ? [m[1] + "/" + m[2], m[2]!, m[1]!] : [];
}
/** The identifiers a task carries: its id, its repository (source A), its changed files, every name the extractor gives a candidate or a list item, and the key's list names. Only names with a letter or digit count. */
export function namesOf(h: History, k?: Key): string[] {
  const x = extract(h);
  const all = [h.task, ...(h.source === "A" ? repoNames(h.task) : []), ...h.side.files, ...x.candidates.flatMap((c) => [c.name, ...c.names]), ...x.lists.flat().map((i) => i.name), ...(k?.list ?? []).map((i) => i.name)];
  return all.map((n) => n.trim()).filter((n) => /[\p{L}\p{N}]/u.test(n));
}
const unique = (xs: string[]) => [...new Set(xs)];
function extraNames(path: string | undefined): string[] {
  if (!path) return [];
  const xs = readJson<unknown>(path);
  if (!Array.isArray(xs) || !xs.every((x) => typeof x === "string")) fail("E_TBV_INPUT", path + " must be a JSON array of names");
  return (xs as string[]).map((n) => n.trim()).filter((n) => /[\p{L}\p{N}]/u.test(n));
}

/** The held-out side of both checks: source A from --held, source B from --held-b, and their keys. */
function heldSide(a: Record<string, string>) {
  const histories = [...readHistories(a.held!, "A"), ...(a["held-b"] ? readHistories(a["held-b"], "B") : [])];
  const keys = [...(a["held-keys"] ? readKeys(a["held-keys"]) : []), ...(a["held-b-keys"] ? readKeys(a["held-b-keys"]) : [])];
  return { histories, keys, mode: a["held-b"] ? "held-out source A and B" : "held-out source A only" };
}
function namesFor(histories: History[], keys: Key[]): string[] {
  const byTask = new Map(keys.map((k) => [k.task, k]));
  return [...histories.flatMap((h) => namesOf(h, byTask.get(h.task))), ...keys.filter((k) => !histories.some((h) => h.task === k.task)).flatMap((k) => [k.task, ...(k.list ?? []).map((i) => i.name)])];
}
const verdict = (code: number, printed: string[], hit: RegExp) => (code !== 0 ? code : printed.some((l) => hit.test(l)) ? 1 : 0);

export function handoffCheck(argv: string[], io: Io): number {
  const a = parseFlags(argv, ["artifact", "dev", "held"], ["held-keys", "held-b", "held-b-keys", "names"]);
  let artifact: string;
  try {
    artifact = readFileSync(a.artifact!, "utf8");
  } catch {
    return fail("E_TBV_INPUT", "cannot read the artifact " + a.artifact);
  }
  const dev = readHistories(a.dev!);
  const held = heldSide(a);
  const heldIds = unique([...namesFor(held.histories, held.keys), ...extraNames(a.names)]);
  io.out("check handoff: " + held.mode + "; " + dev.length + " dev histories, " + held.histories.length + " held-out histories, " + held.keys.length + " held-out keys");
  const printed: string[] = [];
  const code = check({ cmd: "handoff", data: { artifact, heldIds, devText: dev.map(historyText).join("\n"), heldText: [...held.histories.map(historyText), ...held.keys.map(keyText)].join("\n") } }, { out: (t) => { printed.push(...t.split("\n")); io.out(t); }, err: io.err });
  return verdict(code, printed, /^Verdict: BLOCK/);
}

/** The added lines of git diff C..P, without their leading "+". */
export function addedLines(checkout: string, c: string, p: string): string[] {
  const diff = git(checkout, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--unified=0", c, p]);
  return diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++ ")).map((l) => l.slice(1));
}
/** Every text file in gstack's tree at C, joined (binary blobs, which hold a NUL byte, are left out). */
export function treeText(checkout: string, c: string): string {
  const entries = git(checkout, ["ls-tree", "-r", "-z", c]).split("\0").filter(Boolean).map((l) => /^\d+ (\w+) ([0-9a-f]+)\t/.exec(l)).filter((m): m is RegExpExecArray => !!m && m[1] === "blob").map((m) => m[2]!);
  if (!entries.length) return "";
  const raw = execFileSync("git", ["-C", checkout, "cat-file", "--batch"], { input: entries.join("\n") + "\n", maxBuffer: 1 << 30 });
  const texts: string[] = [];
  let at = 0;
  while (at < raw.length) {
    const nl = raw.indexOf(10, at);
    const size = Number(raw.subarray(at, nl).toString("latin1").split(" ")[2]);
    const body = raw.subarray(nl + 1, nl + 1 + size);
    if (!body.includes(0)) texts.push(body.toString("utf8"));
    at = nl + 1 + size + 1;
  }
  return texts.join("\n");
}
function git(checkout: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return fail("E_TBV_INPUT", "git " + args.slice(0, 2).join(" ") + " failed in " + checkout + "; check the checkout and the commits");
  }
}
function commit(checkout: string, ref: string, flag: string): string {
  if (!/^[0-9a-f]{7,40}$/.test(ref)) fail("E_TBV_INPUT", flag + " takes a commit sha, not " + JSON.stringify(ref));
  return git(checkout, ["rev-parse", "--verify", "--quiet", ref + "^{commit}"]).trim();
}

/** The org-rules scan: each history that shares an 8-word run (the leak check's word tokens) with the org rules' trust-but-verify wording. Prints the history's source and sha256 prefix, never its text or task. */
export function rulesScan(histories: History[], wording: string, io: Io): number {
  const w = grams(wording);
  if (!w.size) fail("E_TBV_INPUT", "the org rules' wording has fewer than 8 words");
  const hits = histories.map((h) => ({ h, runs: [...grams(historyText(h))].filter((g) => w.has(g)) })).filter((x) => x.runs.length);
  io.out("rules: " + histories.length + " histories scanned for the org rules' trust-but-verify wording (" + w.size + " 8-word runs); " + hits.length + " hold a run");
  for (const x of hits) io.out("  history source " + x.h.source + " sha256 " + x.h.sha256.slice(0, 12) + ": " + x.runs.length + " runs, first " + JSON.stringify(x.runs[0]));
  io.out("Verdict: " + (hits.length ? "HIT (to the Captain)" : "CLEAN"));
  return hits.length ? 1 : 0;
}
function wordingOf(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fail("E_TBV_INPUT", "cannot read the org rules' wording " + path);
  }
}

export function leakCheck(argv: string[], io: Io): number {
  const a = parseFlags(argv, ["gstack", "c", "p", "wording", "dev", "held"], ["dev-keys", "held-keys", "held-b", "held-b-keys", "names"]);
  const c = commit(a.gstack!, a.c!, "--c"), p = commit(a.gstack!, a.p!, "--p");
  const dev = readHistories(a.dev!), devKeys = a["dev-keys"] ? readKeys(a["dev-keys"]) : [];
  const held = heldSide(a);
  const histories = [...dev, ...held.histories], keys = [...devKeys, ...held.keys];
  const names = unique([...namesFor(dev, devKeys), ...namesFor(held.histories, held.keys), ...extraNames(a.names)]);
  io.out("check leak: C " + c.slice(0, 12) + ", P " + p.slice(0, 12) + "; dev and " + held.mode + "; " + histories.length + " histories, " + keys.length + " keys, " + names.length + " task names");
  const printed: string[] = [];
  const code = check({ cmd: "leak", data: { addedLines: addedLines(a.gstack!, c, p), gstackAtC: treeText(a.gstack!, c), material: [...histories.map(historyText), ...keys.map(keyText)].join("\n"), names } }, { out: (t) => { printed.push(...t.split("\n")); io.out(t); }, err: io.err });
  const leakCode = verdict(code, printed, /^Verdict: HIT/);
  if (leakCode === 2) return 2;
  return Math.max(leakCode, rulesScan(histories, wordingOf(a.wording!), io));
}

export function run(argv: string[], io: Io): number {
  const [, mode, ...rest] = argv;
  if (mode === "handoff") return handoffCheck(rest, io);
  if (mode === "leak") return leakCheck(rest, io);
  if (mode === "rules") {
    const a = parseFlags(rest, ["wording", "histories"]);
    return rulesScan(readHistories(a.histories!), wordingOf(a.wording!), io);
  }
  return fail("E_TBV_INPUT", "tbv check takes handoff, leak or rules");
}
