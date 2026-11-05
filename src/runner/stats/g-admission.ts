// G's admission check (outcome-per-skill plan v3 section 6, build step O4), as the G family's admission prereg freezes
// it (wiki/plans/2026-11-04-geva-262-g-family-admission-prereg, section 6). Per skill, on the 12-task slice, Opus 5.5
// only, with 2 trials per arm per task. Each item reads the frozen data and the first that fails decides the route:
//
//   1. headroom: none's solved share over its valid trials is in [0.20, 0.80], ends included (5 to 19 of 24). The none
//      arm is shared, so a failure stops both skills: below as FIX-METHOD (floor), above as FIX-METHOD (saturation);
//   2. exposure: of 8 sampled told trials, one on each of 8 tasks, at least 7 exposed, or FIX-METHOD (exposure);
//   3. instruments: the mutation tool scores at least 90% of the trees in the skill's comparison (its told trees and
//      the none trees) without a tool error, and the verifier returns a run for every tree, or FIX-METHOD (instrument);
//   4. rig: at most 1 gap per arm after reruns (5% of the planned trials, rounded down), and every arm stop explained
//      by the lane's frozen termination taxonomy, or FIX-METHOD (rig);
//   5. price and power: resize.py's re-size (g-resize.ts) at the metered inputs, under M1 and the Captain's pick C, or
//      FIX-METHOD (price).
//
// Valid trials are the scored ones: gaps and contaminated trials stay out. The metered means are each arm's mean
// session cost over its scored trials, arm stops included at their metered cost; told's are intention to treat, with
// exposed and unexposed sessions printed apart. A session's cost is its settled spend at the session's close, the figure
// real_agent passes on as cost_usd: a call with no recorded cost at that close, one still in flight or priced only in
// the proxy journal included, is left out of the means and never priced. It is counted from the same close, the run
// directory's close lines (unknownFromRun), beside the reservation O6 held for it then. AUTH_PAID comes from the slice's
// settled U4 leases (authPaidFromLedger).
// The exposure sample is drawn as prereg section 5 says (Python's random.Random(20261105), with its replacement rule)
// and passed in; admitG checks its shape.
// Beside exposure it prints, report only, how many told trials wrote outside PLAN.md in t1 (t1WritesOutsidePlan, G
// ruling A on red-team #1). The count decides no item.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { usd } from "../ledger/money.ts";
import { listItems, readItem, type CloseFile } from "../ledger/record.ts";
import { shareAtLeast, shareAtMost, taskRepos, type OutcomeTrial } from "./outcome-decision.ts";
import { G_SKILLS, m1Decide, meteredPricer, renderResizeMetered, type GMetered, type GSkill, type M1Decision, type Run } from "./g-resize.ts";

export interface SliceTrial extends OutcomeTrial {
  /** The mutation tool's reading of the trial's tree; null on a gap, which has no tree. */
  mutation: "scored" | "no_tests" | "tool_error" | null;
  /** Whether the verifier returned a run for the tree. */
  verifier_ran: boolean;
  /** On an arm stop, whether the lane's frozen termination taxonomy explains it; null otherwise. */
  stop_explained: boolean | null;
  /** Told trials only, report only: whether t1WritesOutsidePlan found a write in t1; null or absent when not read. */
  t1_outside_plan?: boolean | null;
}

export interface AdmissionInput {
  arms: { none: string; told: Record<GSkill, string> };
  trials: SliceTrial[];
  /** Trials planned per arm: 12 tasks x 2. */
  planned_trials: number;
  /** Item 2's sample per skill, drawn as prereg section 5 says, replacements applied. */
  exposure_sample: Record<GSkill, Array<{ task: string; trial: number }>>;
  /** The slice's paid author and audit dollars per valid task (authPaidFromLedger). */
  auth_paid_usd: number;
  /** The slice's crew dollars per valid task over the second six valid tasks. */
  auth_extra_usd: number;
  /** Per arm, the calls of unknown cost at its sessions' closes (unknownFromRun), which the metered means leave out. */
  unknown_calls: Record<"none" | GSkill, UnknownCalls>;
}

/** Calls with no recorded cost on an arm's U4 leases, and the micro-dollars O6 holds for them at their full reservation. */
export interface UnknownCalls {
  calls: number;
  micros: number;
}

export interface AdmissionItem {
  item: 1 | 2 | 3 | 4 | 5;
  name: "headroom" | "exposure" | "instruments" | "rig" | "price and power";
  /** null when an earlier item stopped the skill, so this one was not read. */
  pass: boolean | null;
  reading: string;
}

export interface SkillAdmission {
  skill: GSkill;
  failed: 1 | 2 | 3 | 4 | 5 | null;
  route: string;
  items: AdmissionItem[];
  /** The design item 5 prints for stage 4; null when the skill stops. */
  design: Run | null;
  /** All scored told trials the detector read, as a description. */
  exposure_all: { exposed: number; trials: number };
  /** Report only: of the scored told trials with a t1 reading, how many wrote outside PLAN.md in t1. */
  t1_outside_plan: { wrote: number; read: number };
}

export interface ToldMeter {
  trials: number;
  /** null when the arm has no scored trial, which admitG refuses: item 5 needs its multiple. */
  all_usd: number | null;
  exposed_usd: number | null;
  unexposed_usd: number | null;
}

export interface Admission {
  headroom: { solved: number; valid: number; share: number };
  skills: Record<GSkill, SkillAdmission>;
  metered: { inputs: GMetered; none_usd: number; told: Record<GSkill, ToldMeter>; unknown_calls: Record<"none" | GSkill, UnknownCalls> };
  m1: M1Decision;
  resize_text: string;
}

const V_SESSION = 0.191;
const ROUTES = { 2: "FIX-METHOD (exposure)", 3: "FIX-METHOD (instrument)", 4: "FIX-METHOD (rig)", 5: "FIX-METHOD (price)" } as const;
const pct = (x: number, of: number) => (of ? ((100 * x) / of).toFixed(1) + "%" : "n/a");
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

export function admitG(input: AdmissionInput): Admission {
  const { arms, trials, planned_trials: planned } = input;
  if (!Number.isSafeInteger(planned) || planned < 1) throw new Error("planned_trials must be a whole number of trials per arm");
  const armOf = new Set([arms.none, arms.told["plan-eng-review"], arms.told.autoplan]);
  if (armOf.size !== 3) throw new Error("the none arm and the two told arms need three different names");
  taskRepos(trials);
  for (const t of trials) {
    if (!armOf.has(t.arm)) throw new Error("trial " + t.trial + " on task " + t.task + " is on arm " + t.arm + ", which admission does not read");
    if (t.status !== "scored") continue;
    if (t.cost_usd === null || !Number.isFinite(t.cost_usd) || t.cost_usd < 0) throw new Error("trial " + t.trial + " of arm " + t.arm + " on task " + t.task + " has no meter record; item 5 reads every session's U4 lease spend");
    if (t.mutation === null) throw new Error("trial " + t.trial + " of arm " + t.arm + " on task " + t.task + " is scored but has no mutation reading");
  }
  for (const [name, v] of [["auth_paid_usd", input.auth_paid_usd], ["auth_extra_usd", input.auth_extra_usd]] as const) if (!(v > 0 && v < 1000)) throw new Error(name + " must be dollars per valid task, above 0 and under 1000, the range resize.py reads its metered inputs in");
  const unknown = input.unknown_calls;
  const count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  if (!(["none", ...G_SKILLS] as const).every((arm) => count(unknown?.[arm]?.calls) && count(unknown?.[arm]?.micros))) throw new Error("unknown_calls must give each arm's calls of unknown cost and the micro-dollars O6 holds for them, as whole numbers from 0 (unknownFromRun); item 5 reports them beside the metered means");
  const of = (arm: string) => trials.filter((t) => t.arm === arm);
  const scored = (arm: string) => of(arm).filter((t) => t.status === "scored");

  const none = scored(arms.none);
  if (!none.length) throw new Error("the none arm has no valid trial, so headroom can't be read");
  const solved = none.filter((t) => t.solved).length;
  const headroom = shareAtLeast(solved, none.length, 0.2) && shareAtMost(solved, none.length, 0.8);
  const headroomRoute = headroom ? null : shareAtLeast(solved, none.length, 0.2) ? "FIX-METHOD (saturation)" : "FIX-METHOD (floor)";
  const headroomItem: AdmissionItem = { item: 1, name: "headroom", pass: headroom, reading: "none solved " + solved + " of " + none.length + " valid trials (" + pct(solved, none.length) + "); the band is 20% to 80%, ends included" };

  const maxGaps = Math.floor((planned * 5) / 100);
  const rig = (arm: string) => {
    const present = of(arm).filter((t) => t.status !== "gap").length;
    if (present > planned) throw new Error("arm " + arm + " has " + present + " trials, more than the " + planned + " planned");
    const unexplained = of(arm).filter((t) => t.status !== "gap" && t.truncated && t.stop_explained !== true).length;
    return { gaps: planned - present, unexplained };
  };
  const noneRig = rig(arms.none);

  const items = {} as Record<GSkill, AdmissionItem[]>;
  const told = {} as Record<GSkill, ToldMeter>;
  const exposureAll = {} as Record<GSkill, { exposed: number; trials: number }>;
  const outsidePlan = {} as Record<GSkill, { wrote: number; read: number }>;
  for (const s of G_SKILLS) {
    const arm = arms.told[s];
    const mine = scored(arm);
    const read = mine.filter((t) => t.exposed !== null);
    exposureAll[s] = { exposed: read.filter((t) => t.exposed).length, trials: read.length };
    const t1Read = mine.filter((t) => typeof t.t1_outside_plan === "boolean");
    outsidePlan[s] = { wrote: t1Read.filter((t) => t.t1_outside_plan).length, read: t1Read.length };
    const trees = [...none, ...mine];
    const errors = trees.filter((t) => t.mutation === "tool_error").length;
    const noRun = trees.filter((t) => !t.verifier_ran).length;
    const toldRig = rig(arm);
    const exposure = (): AdmissionItem => {
      const sample = input.exposure_sample[s];
      if (!Array.isArray(sample) || sample.length !== 8) throw new Error("item 2 reads 8 sampled told trials of " + s + ", one on each of 8 tasks, not " + (Array.isArray(sample) ? sample.length : "none"));
      const tasks = new Set<string>();
      let exposed = 0;
      for (const x of sample) {
        if (tasks.has(x.task)) throw new Error("task " + x.task + " is sampled twice for " + s + "; item 2 takes one trial on each of 8 tasks");
        tasks.add(x.task);
        const t = of(arm).find((y) => y.task === x.task && y.trial === x.trial);
        if (!t || t.status !== "scored" || t.exposed === null) throw new Error("sampled trial " + x.trial + " on task " + x.task + " is not a scored " + s + " trial read by the detector; replace it as prereg section 5 says");
        if (t.exposed) exposed++;
      }
      const unread = mine.length - outsidePlan[s].read;
      const t1 = "; report only: " + outsidePlan[s].wrote + " of " + outsidePlan[s].read + " told trials wrote outside PLAN.md in t1" + (unread ? " (" + unread + " not read)" : "");
      return { item: 2, name: "exposure", pass: exposed >= 7, reading: exposed + " of 8 sampled told trials exposed (7 needed); " + exposureAll[s].exposed + " of " + exposureAll[s].trials + " told trials read exposed" + t1 };
    };
    const reads: [AdmissionItem["item"], AdmissionItem["name"], () => AdmissionItem][] = [
      [2, "exposure", exposure],
      [3, "instruments", () => ({ item: 3, name: "instruments", pass: shareAtLeast(trees.length - errors, trees.length, 0.9) && noRun === 0, reading: "mutation tool scored " + (trees.length - errors) + " of " + trees.length + " trees without a tool error (" + pct(trees.length - errors, trees.length) + ", 90% needed); the verifier returned no run for " + noRun })],
      [4, "rig", () => ({ item: 4, name: "rig", pass: noneRig.gaps <= maxGaps && toldRig.gaps <= maxGaps && noneRig.unexplained + toldRig.unexplained === 0, reading: "gaps after reruns: none " + noneRig.gaps + ", told " + toldRig.gaps + " (at most " + maxGaps + " an arm); unexplained arm stops: none " + noneRig.unexplained + ", told " + toldRig.unexplained })],
    ];
    items[s] = [headroomItem];
    for (const [item, name, readItem] of reads) {
      const by = items[s].find((x) => x.pass === false)?.item;
      items[s].push(by === undefined ? readItem() : { item, name, pass: null, reading: "not read: item " + by + " stopped the skill" });
    }
    const cost = (xs: SliceTrial[]) => (xs.length ? mean(xs.map((t) => t.cost_usd!)) : null);
    told[s] = { trials: mine.length, all_usd: cost(mine), exposed_usd: cost(mine.filter((t) => t.exposed === true)), unexposed_usd: cost(mine.filter((t) => t.exposed === false)) };
  }

  const noneUsd = mean(none.map((t) => t.cost_usd!));
  for (const [s, key] of [["plan-eng-review", "M_PER"], ["autoplan", "M_AP"]] as const) {
    if (told[s].all_usd === null) throw new Error(s + ": the told arm " + arms.told[s] + " has no scored trial, so " + key + " can't be metered; item 5 needs every told arm's metered multiple (G prereg section 6, item 5), and a value set by hand would set a frozen admission rule");
  }
  const inputs: GMetered = { MULT: noneUsd / V_SESSION, M_PER: told["plan-eng-review"].all_usd! / noneUsd, M_AP: told.autoplan.all_usd! / noneUsd, AUTH_PAID: input.auth_paid_usd, AUTH_EXTRA: input.auth_extra_usd };
  const firstFail = (s: GSkill) => items[s].find((x) => x.pass === false)?.item ?? null;
  const stopped = G_SKILLS.filter((s) => firstFail(s) !== null);
  const m1 = m1Decide(meteredPricer(inputs), stopped);
  const resizeText = renderResizeMetered(inputs);

  const skills = {} as Record<GSkill, SkillAdmission>;
  for (const s of G_SKILLS) {
    const early = firstFail(s);
    const design = early === null ? m1.runs[s] : null;
    const held = (arm: "none" | GSkill) => unknown[arm].calls + " (" + usd(unknown[arm].micros) + " held)";
    const unpriced = "; calls of unknown cost, left out of the metered means: none " + held("none") + ", told " + held(s);
    const price: AdmissionItem = { item: 5, name: "price and power", pass: early === null ? design !== null : null, reading: early === null ? (design ? "runs " + design.n + "x" + design.k + ", MDD " + design.mdd + ", $" + design.price + "; " + m1.reason : "stops: " + m1.reason) + unpriced : "not read: item " + early + " stopped the skill" };
    const failed = early ?? (design === null ? 5 : null);
    skills[s] = {
      skill: s, failed, design, exposure_all: exposureAll[s], t1_outside_plan: outsidePlan[s], items: [...items[s], price],
      route: failed === null ? "stage 4" : failed === 1 ? headroomRoute! : ROUTES[failed],
    };
  }
  return { headroom: { solved, valid: none.length, share: solved / none.length }, skills, metered: { inputs, none_usd: noneUsd, told, unknown_calls: unknown }, m1, resize_text: resizeText };
}

const EDIT_PATHS = new Map([["Write", "file_path"], ["Edit", "file_path"], ["MultiEdit", "file_path"], ["NotebookEdit", "notebook_path"]]);
const isPlan = (path: string) => path.split("/").pop() === "PLAN.md";

/**
 * Report only (G ruling A on red-team #1): what a told session wrote outside PLAN.md in t1, read from the phase-tagged
 * records real_agent keeps, a subagent's included. An edit tool's call (Write, Edit, MultiEdit, NotebookEdit) counts by
 * its path unless its result is an error. A Bash call counts, whatever its exit, when it sends stdout into a file (>, >>,
 * 1>, &>), tees into one, edits a file in place (sed -i, perl -i) or applies a patch (git apply, patch). Its words are
 * read as the shell splits them, so an operator inside quotes is text and a quoted file name is a file; heredoc bodies
 * are skipped, and a /dev/ target does not count. A call whose result carries a tool_use_error never ran. A file named
 * PLAN.md never counts. A command behind a shell keyword (do, then, {) or a wrapper (sudo, env, timeout, xargs) counts,
 * bash -c and sh -c read their script the same way, and sed -i under xargs counts, since its files come from stdin. A
 * wrapper's flag takes the next word only when it takes a value (sudo -u, env -u, timeout -s, xargs -I and the like).
 * sed's and perl's options read as GNU sed and perl read them: only -e and -f (sed's -l too, perl's -E) take a value,
 * attached or next; -i's attached suffix ends its cluster; and sed's '' or .bak right after a bare -i, before any
 * script, is a BSD-style suffix.
 */
export function t1WritesOutsidePlan(records: Record<string, any>[]): string[] {
  const results = new Map<string, Record<string, any>>();
  for (const r of records) if (r.type === "UserMessage" && Array.isArray(r.content)) for (const b of r.content) if (b?.type === "tool_result") results.set(b.tool_use_id, b);
  const found: string[] = [];
  for (const r of records) {
    if (r.type !== "AssistantMessage" || r.phase !== "t1" || !Array.isArray(r.content)) continue;
    for (const b of r.content) {
      if (b?.type !== "tool_use") continue;
      const res = results.get(b.id);
      if (res && (typeof res.content === "string" ? res.content : JSON.stringify(res.content ?? "")).includes("<tool_use_error>")) continue;
      const key = EDIT_PATHS.get(b.name);
      const path = key ? b.input?.[key] : undefined;
      if (typeof path === "string" && !isPlan(path) && res?.is_error !== true) found.push(b.name + " " + path);
      if (b.name === "Bash" && typeof b.input?.command === "string") found.push(...bashWrites(b.input.command));
    }
  }
  return [...new Set(found)];
}

const KEYWORDS = new Set(["!", "{", "do", "then", "else", "elif", "if", "while", "until"]);
const WRAPPERS = new Map<string, string[]>([
  ["sudo", ["-u", "-g", "-C", "-D", "-h", "-p", "-R", "-r", "-t", "-T", "-U", "--user", "--group", "--close-from", "--chdir", "--host", "--prompt", "--chroot", "--role", "--type", "--command-timeout", "--other-user"]],
  ["env", ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"]],
  ["xargs", ["-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s", "--arg-file", "--delimiter", "--eof", "--max-args", "--max-chars", "--max-lines", "--max-procs", "--process-slot-var"]],
  ["nohup", []],
  ["exec", ["-a"]],
  ["command", []],
  ["builtin", []],
  ["time", ["-f", "-o", "--format", "--output"]],
  ["timeout", ["-k", "-s", "--kill-after", "--signal"]],
  ["nice", ["-n", "--adjustment"]],
  ["stdbuf", ["-i", "-o", "-e", "--input", "--output", "--error"]],
]);
const base = (word?: string) => word?.split("/").pop() ?? "";

function bashWrites(command: string): string[] {
  const kept: string[] = [];
  let heredoc: string | null = null;
  for (const line of command.split("\n")) {
    if (heredoc !== null) {
      if (line.trim() === heredoc) heredoc = null;
      continue;
    }
    kept.push(line);
    heredoc = /<<-?\s*(["']?)(\w+)\1/.exec(line)?.[2] ?? null;
  }
  const edit = "Bash edit: " + command.split("\n")[0]!.slice(0, 120);
  const keep = (path: string) => !isPlan(path) && !path.startsWith("/dev/");
  const found: string[] = [];
  let words: string[] = [];
  const run = () => {
    let at = words.findIndex((w) => !/^\w+=/.test(w) && !KEYWORDS.has(w));
    let xargs = false;
    while (at >= 0 && WRAPPERS.has(base(words[at]))) {
      const valued = WRAPPERS.get(base(words[at]))!;
      xargs ||= base(words[at]) === "xargs";
      do at++;
      while (at < words.length && (/^-|^\w+=|^\d/.test(words[at]!) || valued.includes(words[at - 1]!)));
    }
    const [cmd, ...args] = at < 0 ? [] : words.slice(at);
    const name = base(cmd);
    words = [];
    const dashC = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if ((name === "bash" || name === "sh") && dashC >= 0 && args[dashC + 1] !== undefined) found.push(...bashWrites(args[dashC + 1]!));
    if (name === "tee") found.push(...args.filter((a) => !a.startsWith("-") && keep(a)).map((a) => "Bash tee " + a));
    if ((name === "git" && args[0] === "apply") || name === "patch") found.push(edit);
    if ((name !== "sed" && name !== "perl") || !args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) return;
    const files: string[] = [];
    const takes = name === "sed" ? "efl" : "eE";
    let script = false;
    for (let j = 0; j < args.length; j++) {
      const a = args[j]!;
      if (name === "sed" && /^--(?:expression|file|line-length)(?:=|$)/.test(a)) {
        script ||= !a.startsWith("--line-length");
        if (!a.includes("=")) j++;
      } else if (/^-[^-]/.test(a)) {
        const k = [...a.slice(1)].findIndex((c) => c === "i" || takes.includes(c)) + 1;
        if (k > 0 && a[k] !== "i") {
          script ||= a[k] !== "l";
          if (k === a.length - 1) j++;
        } else if (name === "sed" && !script && a.endsWith("i") && /^(?:\.|$)/.test(args[j + 1] ?? "-")) j++;
      } else if (!a.startsWith("-")) {
        if (script) files.push(a);
        script = true;
      }
    }
    if (xargs || files.some(keep)) found.push(edit);
  };
  const tokens = shellTokens(kept.join("\n"));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if ("word" in t) words.push(t.word);
    else if (/^(?:1?>>?|&>>?|>\|)$/.test(t.op) && next && "word" in next) {
      if (keep(next.word)) found.push("Bash > " + next.word);
      i++;
    } else if (/[<>]/.test(t.op)) {
      if (next && "word" in next) i++;
    } else run();
  }
  run();
  return found;
}

/** Shell words and operators. Quotes and backslashes are honoured, so an operator inside quotes stays in its word, and a
 * digit word glued to ">" is that redirect's file descriptor. A newline ends a command. */
function shellTokens(shell: string): Array<{ word: string } | { op: string }> {
  const tokens: Array<{ word: string } | { op: string }> = [];
  let word = "";
  let open = false;
  const end = () => {
    if (open) tokens.push({ word });
    word = "";
    open = false;
  };
  for (let i = 0; i < shell.length; i++) {
    const c = shell[i]!;
    if (c === "'") {
      const close = shell.indexOf("'", i + 1);
      const stop = close < 0 ? shell.length : close;
      word += shell.slice(i + 1, stop);
      open = true;
      i = stop;
    } else if (c === '"') {
      open = true;
      for (i++; i < shell.length && shell[i] !== '"'; i++) word += shell[i] === "\\" && i + 1 < shell.length ? shell[++i] : shell[i];
    } else if (c === "\\") {
      open = true;
      word += shell[++i] ?? "";
    } else if (/\s/.test(c)) {
      end();
      if (c === "\n") tokens.push({ op: ";" });
    } else if ("|&;<>()".includes(c)) {
      let op = c;
      if (c === ">" && open && /^\d+$/.test(word)) {
        op = word + c;
        open = false;
      }
      end();
      while (op.length < 4 && i + 1 < shell.length && "|&<>".includes(shell[i + 1]!)) op += shell[++i];
      tokens.push({ op });
    } else {
      word += c;
      open = true;
    }
  }
  end();
  return tokens;
}

/** Every close on the named line items; each item must hold a lease and every lease must be closed. */
function closesOf(record: string, items: readonly string[], what: string): CloseFile[] {
  if (!items.length) throw new Error("name the line items admission reads " + what + " from");
  const known = new Set(listItems(record));
  return items.flatMap((item) => {
    const s = known.has(item) ? readItem(record, item) : null;
    if (!s || !s.leases.length) throw new Error("line item " + item + " has no lease in " + record + ", so its " + what + " can't be read");
    return s.leases.map(({ lease, close }) => close ?? fail("line item " + item + " still has lease " + lease.lease_id + " open; settle it before admission reads " + what));
  });
}

const fail = (message: string): never => {
  throw new Error(message);
};

/** AUTH_PAID: the settled spend of the slice's author and audit line items, over its valid tasks. Every lease must be closed. */
export function authPaidFromLedger(record: string, items: readonly string[], validTasks: number): number {
  if (!Number.isSafeInteger(validTasks) || validTasks < 1) throw new Error("the slice's valid task count must be a whole number, 1 or more");
  return closesOf(record, items, "AUTH_PAID").reduce((n, c) => n + c.spent_micros + c.unknown_micros, 0) / 1_000_000 / validTasks;
}

/**
 * An arm's calls of unknown cost, counted when each of its sessions closed: the unknown calls and the reservations O6
 * held for them in the close lines of the run directory's sessions.jsonl on the arm's stage line items. Every session
 * opened on those items must have a close line. A line that does not parse, as a writer killed in the middle of a line
 * leaves, is skipped, as the driver and the ledger's settle paths skip it.
 */
export function unknownFromRun(dir: string, items: readonly string[]): UnknownCalls {
  if (!items.length) throw new Error("name the line items admission reads calls of unknown cost from");
  const file = join(dir, "sessions.jsonl");
  const on = new Set(items);
  const lines = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l) as { event?: string; id?: string; item?: string; unknown_calls?: unknown; unknown_micros?: unknown }] : [];
    } catch {
      return [];
    }
  });
  const opens = lines.filter((e) => e.event === "open" && on.has(e.item ?? ""));
  if (!opens.length) throw new Error("no session on line item " + items.join(", ") + " in " + file + ", so its calls of unknown cost can't be read");
  const closes = new Map(lines.filter((e) => e.event === "close" && on.has(e.item ?? "")).map((e) => [e.id, e]));
  const open = opens.find((e) => !closes.has(e.id));
  if (open) throw new Error("session " + open.id + " on line item " + open.item + " is still open in " + file + ": it has no close line, so its calls of unknown cost can't be read");
  return [...closes.values()].reduce((n, c) => {
    if (!Number.isSafeInteger(c.unknown_calls) || (c.unknown_calls as number) < 0 || !Number.isSafeInteger(c.unknown_micros) || (c.unknown_micros as number) < 0) throw new Error("session " + c.id + "'s close line in " + file + " does not give its unknown_calls and unknown_micros as whole numbers from 0");
    return { calls: n.calls + (c.unknown_calls as number), micros: n.micros + (c.unknown_micros as number) };
  }, { calls: 0, micros: 0 });
}
