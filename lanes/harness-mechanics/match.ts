// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6's frozen match regex through gstack's own contract checker at the pin (dry-run step 3). match.txt's 72 cases
// and probes.txt's 189 probes, with REGEX and BEFORE, run under Bun through the vendored checkContract and under Node 24
// through node-probe.mjs with the checker's own quote transform and flag i. gstack's built-in classifier runs beside them,
// the timing cases run with REGEX in process and with BEFORE in a child killed at a limit, and the Stop hook at the pin
// must call checkContract once with no loadLine. The dry-run steps for all of it are at the end.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkContract, parseTranscript, validateContract } from "./vendor/gstack/lib/skill-contract.ts";
import { GSTACK_BLOBS, GSTACK_VENDOR, HM, loadBundle, MATCHER, REPO, type Bundle } from "./pins.ts";
import { quoteSource } from "./quotes.ts" with { type: "macro" };

const input = (m: string): never => { throw new Error("E_HM_INPUT " + m); };
const pinErr = (m: string): never => { throw new Error("E_HM_PIN " + m); };
const VENDOR = join(REPO, GSTACK_VENDOR);
const NODE_PROBE = join(import.meta.dir, "node-probe.mjs");
const HOOK = "hosts/claude/hooks/skill-contract-stop-hook.ts";

export const gitBlob = (b: Buffer) => createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
export const vendorFile = (f: string, root = VENDOR) => join(root, f.startsWith("hosts/") ? f + ".txt" : f);

// Every vendored file at its pinned upstream blob.
export function checkVendored(root = VENDOR): void {
  for (const [f, want] of Object.entries(GSTACK_BLOBS)) {
    const p = vendorFile(f, root);
    if (!existsSync(p)) pinErr(GSTACK_VENDOR + "/" + f + " is missing");
    const got = gitBlob(readFileSync(p));
    if (got !== want) pinErr(GSTACK_VENDOR + "/" + f + " is blob " + got + ", not the pin's " + want);
  }
}

// The dry run's pin check: HM_GSTACK names a gstack checkout holding the pin, each pinned file there is the blob pins.ts
// records, and the vendored bytes are that blob.
export function checkCheckout(dir = process.env.HM_GSTACK ?? ""): string {
  if (!dir) pinErr("set HM_GSTACK to a gstack checkout that holds the pin " + HM.gstackPin);
  for (const [f, want] of Object.entries(GSTACK_BLOBS)) {
    const r = spawnSync("git", ["-C", dir, "rev-parse", HM.gstackPin + ":" + f], { encoding: "utf8" });
    const got = r.status === 0 ? r.stdout.trim() : "missing";
    if (got !== want) pinErr(f + " at the pin in HM_GSTACK is " + got + ", not " + want);
  }
  checkVendored();
  return dir;
}

// gstack's quote transform, read from the vendored checker when Bun transpiles or bundles this file (quotes.ts): every
// quoted string becomes a pair of empty quotes.
const QUOTE = quoteSource();
export const QUOTES = new RegExp(QUOTE.source, QUOTE.flags);

export type Label = "COUNT" | "NO" | "FLIP";
export type Case = { label: Label; cmd: string; line: number };
export type Timing = { n: number; unit: string; cmd: string; line: number };
export type MatchFile = { regex: string; cases: Case[] };
export type ProbeFile = { before: string; probes: Case[]; time: Timing[] };
export const HEREDOC = "cat > x <<EOF\n";
const ESC: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
const unescape = (s: string, keep: string) => s.replace(/\\([nrt])/g, (x, c: string) => (keep.includes(c) ? ESC[c]! : x));

// A file's labelled lines. A case's text is the rest of its line after the label and one space, leading spaces included.
function labelled(text: string, name: string, labels: string[]) {
  const out: { label: string; rest: string; line: number }[] = [];
  text.split("\n").forEach((l, i) => {
    if (!l || l.startsWith("#")) return;
    const sp = l.indexOf(" ");
    if (sp < 0 || !labels.includes(l.slice(0, sp))) input(name + " line " + (i + 1) + " is not '<" + labels.join("|") + "> <text>'");
    out.push({ label: l.slice(0, sp), rest: l.slice(sp + 1), line: i + 1 });
  });
  return out;
}
function only(xs: { label: string; rest: string }[], label: string, name: string): string {
  const f = xs.filter((x) => x.label === label);
  if (f.length !== 1) input(name + " has " + f.length + " " + label + " lines, not 1");
  return f[0]!.rest;
}

export function parseMatch(text: string): MatchFile {
  const ls = labelled(text, "match.txt", ["REGEX", "COUNT", "NO"]);
  return { regex: only(ls, "REGEX", "match.txt"), cases: ls.filter((l) => l.label !== "REGEX").map((l) => ({ label: l.label as Label, cmd: unescape(l.rest, "n"), line: l.line })) };
}

// TIME n u: "cat > x <<EOF", a newline, then u repeated to n characters.
export function parseProbes(text: string): ProbeFile {
  const ls = labelled(text, "probes.txt", ["BEFORE", "COUNT", "NO", "FLIP", "TIME"]);
  const time = ls.filter((l) => l.label === "TIME").map((l) => {
    const m = /^(\d+) (.+)$/.exec(l.rest) ?? input("probes.txt line " + l.line + " is not 'TIME <n> <unit>'");
    const n = Number(m[1]), unit = unescape(m[2]!, "nrt");
    return { n, unit, cmd: HEREDOC + unit.repeat(Math.ceil(n / unit.length)).slice(0, n), line: l.line };
  });
  const probes = ls.filter((l) => l.label !== "BEFORE" && l.label !== "TIME").map((l) => ({ label: l.label as Label, cmd: unescape(l.rest, "nrt"), line: l.line }));
  return { before: only(ls, "BEFORE", "probes.txt"), probes, time };
}

// match.txt and probes.txt from the bundle at their front-matter sha256, with section 6's counts.
export function loadMatcher(b: Bundle = loadBundle()): { match: MatchFile; probes: ProbeFile } {
  const match = parseMatch(b.text("match.txt")), probes = parseProbes(b.text("probes.txt"));
  const n = (l: Label) => match.cases.filter((c) => c.label === l).length;
  if (n("COUNT") !== MATCHER.count || n("NO") !== MATCHER.no) input("match.txt holds " + n("COUNT") + " COUNT and " + n("NO") + " NO cases, not " + MATCHER.count + " and " + MATCHER.no);
  if (probes.probes.length !== MATCHER.probes || probes.time.length !== MATCHER.time) input("probes.txt holds " + probes.probes.length + " probes and " + probes.time.length + " timing cases, not " + MATCHER.probes + " and " + MATCHER.time);
  return { match, probes };
}

const rec = (type: "user" | "assistant", content: unknown) => JSON.stringify({ type, sessionId: "hm-match", cwd: "/testbed", message: { role: type, content } });
const use = (id: string, name: string, input: object) => [rec("assistant", [{ type: "tool_use", id, name, input }]), rec("user", [{ type: "tool_result", tool_use_id: id, content: "ok" }])];
// A Claude Code transcript that loads /verify, edits a file, runs cmd in Bash and stops.
export const session = (cmd: string) => [
  rec("user", "Fix the failing test."),
  ...use("t1", "Skill", { skill: "verify" }),
  ...use("t2", "Edit", { file_path: "/testbed/src/app.py", old_string: "a", new_string: "b" }),
  ...use("t3", "Bash", { command: cmd }),
  rec("assistant", [{ type: "text", text: "Done." }]),
].join("\n") + "\n";

// gstack's checkContract on that session with one check_after_last_edit item: with match, the item's regex replaces the
// built-in classifier; without it, gstack's isCheckCommand decides.
export function checkerMet(cmd: string, match?: string): boolean {
  const v = validateContract({ version: 1, items: [{ id: "check-after-edit", kind: "check_after_last_edit", ...(match === undefined ? {} : { match }) }] });
  if (!("contract" in v)) throw new Error("gstack refuses the contract: " + v.error);
  const r = checkContract(parseTranscript(session(cmd)), "verify", v.contract);
  if (!r.loaded) throw new Error("gstack's checker finds no /verify load in the session");
  return r.met;
}

export type Sides = { version: string; met: boolean[]; before?: boolean[] };
export const bunVersion = () => "bun " + Bun.version;
export const checkerSides = (cmds: string[], regex: string, before?: string): Sides =>
  ({ version: bunVersion(), met: cmds.map((c) => checkerMet(c, regex)), ...(before === undefined ? {} : { before: cmds.map((c) => checkerMet(c, before)) }) });
export const builtinSides = (cmds: string[]): Sides => ({ version: bunVersion() + " built-in classifier", met: cmds.map((c) => checkerMet(c)) });

const show = (c: Case) => "line " + c.line + " " + c.label + " " + JSON.stringify(c.cmd);
// Cases off their side: COUNT counts and NO doesn't, under REGEX; with BEFORE, COUNT and FLIP count and NO doesn't.
export function misplaced(cases: Case[], s: Sides): string[] {
  return cases.flatMap((c, i) => {
    const ok = s.met[i] === (c.label === "COUNT") && (s.before === undefined || s.before[i] === (c.label !== "NO"));
    return ok ? [] : [show(c) + " (" + s.version + ": counts " + s.met[i] + (s.before ? ", BEFORE counts " + s.before[i] : "") + ")"];
  });
}
// The FLIP lines are exactly the probes where REGEX and BEFORE differ.
export function flipRule(cases: Case[], s: Sides): string[] {
  const before = s.before ?? input("the FLIP rule needs BEFORE's sides");
  return cases.flatMap((c, i) => ((s.met[i] !== before[i]) === (c.label === "FLIP") ? [] : [show(c) + (c.label === "FLIP" ? " is FLIP but REGEX and BEFORE agree" : " differs between REGEX and BEFORE but is not FLIP") + " (" + s.version + ")"]));
}

export function nodeVersion(): string {
  const r = spawnSync("node", ["--version"], { encoding: "utf8" });
  return r.status === 0 ? "node " + r.stdout.trim() : "node missing";
}
export const nodeMajor = () => Number(/^node v(\d+)/.exec(nodeVersion())?.[1] ?? 0);

function withInput<T>(x: object, f: (file: string, dir: string) => T): T {
  const d = mkdtempSync(join(tmpdir(), "hm-match-"));
  try {
    writeFileSync(join(d, "in.json"), JSON.stringify(x));
    return f(join(d, "in.json"), d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
const quotes = { source: QUOTES.source, flags: QUOTES.flags };

// The same cases under Node with gstack's transform and flag i, and REGEX's time on each of time's commands.
export function nodeSides(cmds: string[], regex: string, before?: string, time: string[] = []): Sides & { timeMs: number[] } {
  const d = mkdtempSync(join(tmpdir(), "hm-node-"));
  try {
    const out = join(d, "out.json");
    writeFileSync(join(d, "in.json"), JSON.stringify({ regex, before, quotes, cmds, time, out }));
    const r = spawnSync("node", [NODE_PROBE, "sides", join(d, "in.json")], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error("node-probe.mjs fails under " + nodeVersion() + ": " + String(r.stderr || r.error?.message || r.signal).trim().split("\n")[0]);
    const o = JSON.parse(readFileSync(out, "utf8"));
    return { version: o.version, met: o.regex, ...(before === undefined ? {} : { before: o.before }), timeMs: o.timeMs };
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

// REGEX's time on each command under Bun, in process: the transform, then one test.
export function regexTimesMs(cmds: string[], pattern: string): number[] {
  const re = new RegExp(pattern, "i");
  return cmds.map((c) => { const b = c.replace(QUOTES, '""'); const t = performance.now(); re.test(b); return performance.now() - t; });
}

// One pattern on one command in a child process killed at limitMs, so a slow pattern can't hang the caller. A killed
// child's time is how long its test had run when it died.
export function childTimeMs(engine: "bun" | "node", pattern: string, cmd: string, limitMs: number): { ms: number; killed: boolean } {
  return withInput({ pattern, quotes, cmd }, (file) => {
    const r = spawnSync(engine === "bun" ? process.execPath : "node", [NODE_PROBE, "time", file], { encoding: "utf8", timeout: limitMs, killSignal: "SIGKILL" });
    const end = Date.now(), so = r.stdout ?? "";
    const done = /^ms ([\d.]+)$/m.exec(so), start = Number(/^start (\d+)$/m.exec(so)?.[1] ?? 0);
    if (done) return { ms: Number(done[1]), killed: false };
    if (!start || r.signal !== "SIGKILL") throw new Error(engine + " timing child failed: " + String(r.stderr || r.error?.message || r.signal).trim().split("\n")[0]);
    return { ms: end - start, killed: true };
  });
}

// gstack's Stop hook must check from the session's last skill load: one checkContract call with three arguments, and no
// loadLine in its code. Returns the problem, or null.
export function stopHookProblem(src: string): string | null {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (/\bloadLine\b/.test(code)) return "the hook names loadLine";
  const calls = [...code.matchAll(/\bcheckContract\s*\(/g)];
  if (calls.length !== 1) return "the hook makes " + calls.length + " calls to checkContract, not 1";
  let depth = 0, args = 1;
  for (let i = calls[0]!.index! + calls[0]![0].length; i < code.length; i++) {
    const ch = code[i]!;
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) { if (depth === 0) break; depth--; }
    else if (ch === "," && depth === 0) args++;
  }
  return args === 3 ? null : "the hook passes checkContract " + args + " arguments, not 3";
}

type StepResult = { pass: boolean; detail: string };
const versions = () => bunVersion() + ", " + nodeVersion();
const side = (s: Sides, n: number, wrong: string[]) => n - new Set(wrong.map((w) => w.split(" (")[0])).size + "/" + n + " under " + s.version;

// Dry-run 3-matcher-probes: the vendored checker and Stop hook are the pin's bytes in HM_GSTACK, and Node is the prereg's major.
export function stepPin(out: string): StepResult {
  checkCheckout();
  writeFileSync(join(out, "matcher-pin.txt"), Object.entries(GSTACK_BLOBS).map(([f, b]) => b + "  " + f).join("\n") + "\n");
  const ok = nodeMajor() >= MATCHER.nodeMajor;
  return { pass: ok, detail: Object.keys(GSTACK_BLOBS).length + " vendored gstack files are their blobs at " + HM.gstackPin.slice(0, 12) + (ok ? "" : "; node is older than " + MATCHER.nodeMajor) + "; " + versions() };
}

// Dry-run matcher-72: match.txt's cases through checkContract with the frozen regex under Bun, under Node, and the
// built-in classifier beside them.
export function stepMatcher72(out: string): StepResult {
  checkCheckout();
  const { match } = loadMatcher();
  const cmds = match.cases.map((c) => c.cmd);
  const bun = checkerSides(cmds, match.regex), node = nodeSides(cmds, match.regex), builtin = builtinSides(cmds);
  const wb = misplaced(match.cases, bun), wn = misplaced(match.cases, node), wc = misplaced(match.cases, builtin);
  const rows = match.cases.map((c, i) => [c.line, c.label, "checker=" + bun.met[i], "node=" + node.met[i], "builtin=" + builtin.met[i], JSON.stringify(c.cmd)].join(" "));
  writeFileSync(join(out, "matcher-72.txt"), [...rows, "", "wrong side:", ...wb, ...wn, "", "built-in classifier wrong on " + wc.length + ":", ...wc].join("\n") + "\n");
  const n = match.cases.length;
  const detail = side(bun, n, wb) + " through checkContract (" + bun.met.filter(Boolean).length + " counted), " + side(node, n, wn) + "; built-in classifier wrong on " + wc.length + " (prereg " + MATCHER.builtinWrong + ")";
  const wrong = [...wb, ...wn];
  return { pass: !wrong.length && wc.length === MATCHER.builtinWrong, detail: detail + (wrong.length ? "; wrong side: " + wrong.join("; ") : "") + "; " + versions() };
}

// Dry-run probes-189: every probe on its side with REGEX and BEFORE under Bun (checkContract) and Node, the FLIP lines
// the only differences, each timing case under the bound with REGEX, and BEFORE past 5 s on at least one.
export function stepProbes189(out: string): StepResult {
  checkCheckout();
  const { match, probes } = loadMatcher();
  const cmds = probes.probes.map((p) => p.cmd), tcmds = probes.time.map((t) => t.cmd);
  const bun = checkerSides(cmds, match.regex, probes.before), node = nodeSides(cmds, match.regex, probes.before, tcmds);
  const wb = misplaced(probes.probes, bun), wn = misplaced(probes.probes, node);
  const flip = [...flipRule(probes.probes, bun), ...flipRule(probes.probes, node)];
  const bunMs = regexTimesMs(tcmds, match.regex);
  const checkerMs = tcmds.map((c) => { const t = performance.now(); checkerMet(c, match.regex); return performance.now() - t; });
  const before = probes.time.flatMap((t) => (["bun", "node"] as const).map((e) => ({ e, t, ...childTimeMs(e, probes.before, t.cmd, MATCHER.beforeLimitMs) })));
  const slow = [...bunMs.map((ms, i) => ["bun", i, ms] as const), ...node.timeMs.map((ms, i) => ["node", i, ms] as const)].filter(([, , ms]) => ms >= MATCHER.timeBoundMs);
  const past = before.filter((b) => b.ms > MATCHER.beforePastMs);
  const fmt = (ms: number) => (ms / 1000).toFixed(3) + " s";
  const tline = (t: Timing, i: number) => "line " + t.line + " " + JSON.stringify(t.unit) + ": REGEX bun " + fmt(bunMs[i]!) + ", node " + fmt(node.timeMs[i]!) + ", checkContract " + fmt(checkerMs[i]!) + "; BEFORE " + before.filter((b) => b.t === t).map((b) => b.e + " " + (b.killed ? "killed at " : "") + fmt(b.ms)).join(", ");
  const rows = probes.probes.map((p, i) => [p.line, p.label, "bun=" + bun.met[i] + "/" + bun.before![i], "node=" + node.met[i] + "/" + node.before![i], JSON.stringify(p.cmd)].join(" "));
  writeFileSync(join(out, "probes-189.txt"), [...rows, "", ...probes.time.map(tline), "", "wrong side:", ...wb, ...wn, "", "FLIP rule:", ...flip].join("\n") + "\n");
  const flips = probes.probes.filter((p) => p.label === "FLIP").length, n = probes.probes.length;
  const detail = side(bun, n, wb) + " and " + side(node, n, wn) + " with REGEX and BEFORE; FLIP " + flips + " lines, " + (flip.length ? flip.length + " FLIP rule breaks" : "the only differences") +
    "; TIME " + probes.time.length + " with REGEX max bun " + fmt(Math.max(...bunMs)) + ", node " + fmt(Math.max(...node.timeMs)) + " (bound " + fmt(MATCHER.timeBoundMs) + "), checkContract max " + fmt(Math.max(...checkerMs)) +
    "; BEFORE past " + fmt(MATCHER.beforePastMs) + " on " + past.length + " of " + before.length + " runs (" + past.map((b) => b.e + " line " + b.t.line).join(", ") + ")";
  const problems = [...wb, ...wn, ...flip, ...slow.map(([e, i, ms]) => e + " TIME line " + probes.time[i]!.line + " took " + fmt(ms))];
  return { pass: !problems.length && past.length > 0, detail: detail + (problems.length ? "; " + problems.join("; ") : "") + "; " + versions() };
}

// Dry-run stop-hook-loadline: the Stop hook at the pin calls checkContract once with no loadLine; a copy passing one fails.
export function stepStopHook(out: string): StepResult {
  const dir = checkCheckout();
  const r = spawnSync("git", ["-C", dir, "show", HM.gstackPin + ":" + HOOK]);
  const src = r.stdout as Buffer;
  if (r.status !== 0 || gitBlob(src) !== GSTACK_BLOBS[HOOK]) return { pass: false, detail: HOOK + " at the pin is not blob " + GSTACK_BLOBS[HOOK] };
  const text = src.toString("utf8");
  const real = stopHookProblem(text);
  const doctored = stopHookProblem(text.replace("checkContract(transcript, t.skill, t.contract)", "checkContract(transcript, t.skill, t.contract, { loadLine: 1 })"));
  writeFileSync(join(out, "stop-hook.txt"), "pin: " + (real ?? "one checkContract call, 3 arguments, no loadLine") + "\ncopy passing a loadLine: " + (doctored ?? "passed") + "\n");
  const detail = HOOK + " at blob " + GSTACK_BLOBS[HOOK].slice(0, 12) + ": " + (real ?? "checkContract called once with 3 arguments and no loadLine") + "; a copy passing a loadLine " + (doctored ? "fails" : "passes") + "; " + versions();
  return { pass: real === null && doctored !== null, detail };
}
