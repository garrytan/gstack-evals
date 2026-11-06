#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless dry run at the head (build plan section 10). It runs three parts and prints one PASS or FAIL line per check:
//   1. the frozen bundle's own dry run (dryrun.ts.txt beside tbv-rule.ts.txt) with this checkout as the scorer: PASS 150;
//   2. the same 150 frozen checks against the head rule, through the one adapter (adapt.ts): every check passes except
//      the ordered changes listed in ORDERED, each of which part 3 drives at the head;
//   3. the amendment's and the build's own rules: the new end states, size drops against coverage, judge pricing by
//      model and packet kind, the all-in check before every paid item, the leak exemption, held-out source B accrual,
//      items 1 to 7 and 16, the underscore and fix-check 3 forms (the regression table), each family's history limit,
//      the skill-start check, the proxy's reservations beside the rule's worst cases, tbv-author's worst case per task,
//      the driver, judge and key items end to end on stub upstreams through the real proxy and ledger, and source A's
//      rebuild tier (amendment 1 sections 1 and 5) on fixtures.
//   env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENROUTER_API_KEY bun lanes/tbv/dryrun.ts <scratch dir>
// It calls no model and needs no key; it refuses to start when a key is set.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { admitsSize, historyLimit, OVERHEAD_641D622 } from "./extract.ts";
import { accrualClosed, devEligible, heldOutEligible, type PrRecord } from "./history/source-b.ts";
import { worstOf } from "./judge.ts";
import { AUDIT_MAX_TOKENS, KEY_MAX_TOKENS } from "./keys.ts";
import { table } from "./regress.ts";
import { armSend, auditorSend, keyWriterSend } from "./routes.ts";
import { capOf, doubleRead, endState, MAX_TOKENS, PAID_ITEMS, readingWorst, run as rule, type Attempt } from "./rule.ts";
import { skillStartProblem } from "./splice.ts";
import { PREREG_DIR, type Io } from "./types.ts";

const ROOT = resolve(import.meta.dir, "../..");
const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "UBICLOUD_API_KEY"];
const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k))) as Record<string, string>;
/** Frozen checks the build changes on purpose, with the reason and the part 3 check that drives the change at the head. */
export const ORDERED: Record<string, string> = {
  "the same copies relabelled to the other family are refused too: one Opus none reading per task and pass": "item 1 refuses the copy first, with E_USAGE (a reading's family must match its task); part 3 item 1",
};

type Any = Record<string, any>;
/** The scorer's planning prices per million tokens (prereg section 14), as rule.ts's readingWorst takes them. */
const PRICES: Record<"opus" | "sol" | "particle", { in: number; out: number; cacheWrite?: number }> = { opus: { in: 4, out: 20, cacheWrite: 5 }, sol: { in: 2, out: 10, cacheWrite: 2.5 }, particle: { in: 0.1, out: 1 } };
export async function dryrun(out: string, io: Io): Promise<{ pass: number; fail: number }> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let pass = 0, fail = 0, n = 0;
  const scrub = (t: string) => t.replaceAll(out, "$OUT").replaceAll(ROOT, "$ROOT").replaceAll(process.env.HOME ?? "~", "~");
  const say = (t: string) => io.out(scrub(t));
  const check = (label: string, ok: boolean) => { ok ? pass++ : fail++; say((ok ? "PASS " : "FAIL ") + label); };
  const section = async (title: string, fn: () => Promise<void> | void) => {
    say("\n## " + title);
    try { await fn(); } catch (e) { check(title + ": ran to the end (threw " + (e instanceof Error ? e.message.split("\n")[0] : String(e)) + ")", false); }
  };
  /** The head rule, in process: one command on a data file (and a split manifest), its output and exit code. */
  const head = (cmd: string, data: unknown, split?: string) => {
    const f = join(out, "rule-" + ++n + ".json");
    writeFileSync(f, JSON.stringify(data));
    const args = [cmd, f];
    if (split !== undefined) { writeFileSync(f + ".split.json", split); args.push("--split", f + ".split.json"); }
    const o: string[] = [], e: string[] = [];
    const code = rule(args, { out: (t) => o.push(t), err: (t) => e.push(t) });
    const text = o.join("\n");
    return { code, out: text, err: e.join("\n"), verdict: (text.split("\n").find((l) => l.startsWith("Verdict: ")) ?? "").slice(9), refused: code === 2 && e.join("\n").startsWith("E_USAGE") };
  };
  const line = (o: string, re: RegExp) => o.split("\n").find((l) => re.test(l)) ?? "";
  const bundle = (dir: string, rule: string | null) => {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(join(ROOT, PREREG_DIR))) copyFileSync(join(ROOT, PREREG_DIR, f), join(dir, f));
    renameSync(join(dir, "dryrun.ts.txt"), join(dir, "dryrun.ts"));
    if (rule === null) renameSync(join(dir, "tbv-rule.ts.txt"), join(dir, "tbv-rule.ts"));
    else { rmSync(join(dir, "tbv-rule.ts.txt")); writeFileSync(join(dir, "tbv-rule.ts"), rule); }
    const r = spawnSync("bun", [join(dir, "dryrun.ts"), ROOT, join(dir, "scratch")], { cwd: dir, encoding: "utf8", env: KEYLESS, maxBuffer: 1 << 28 });
    writeFileSync(join(dir, "dryrun.out"), r.stdout + r.stderr);
    return { status: r.status, text: r.stdout };
  };

  say("tbv dry run at the head: " + (spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim() || "unknown"));

  await section("1. The frozen bundle's own dry run, this checkout as the scorer", () => {
    const r = bundle(join(out, "frozen-own"), null);
    const last = r.text.trim().split("\n").at(-1) ?? "";
    say("    " + last);
    check("the frozen dry run exits 0 and prints PASS 150, FAIL 0", r.status === 0 && last === "PASS 150, FAIL 0");
    const strip = (t: string) => t.split("\n").filter((l) => !l.startsWith("scorer HEAD ")).join("\n").trim();
    check("its transcript matches the frozen dryrun.txt line for line, apart from the scorer HEAD line", strip(r.text) === strip(readFileSync(join(ROOT, PREREG_DIR, "dryrun.txt"), "utf8")));
  });

  await section("2. The 150 frozen checks against the head rule, through adapt.ts", () => {
    const shim = [
      "import { spawnSync } from 'node:child_process';",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { frozenToHead } from " + JSON.stringify(join(import.meta.dir, "adapt.ts")) + ";",
      "const [cmd, file] = process.argv.slice(2) as [string, string];",
      "let data: unknown;",
      "try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { data = undefined; }",
      "const a = data === undefined ? { data: undefined, split: undefined } : frozenToHead(cmd, data);",
      "const target = data === undefined ? file : file + '.head.json';",
      "if (data !== undefined) writeFileSync(target, JSON.stringify(a.data));",
      "if (a.split) writeFileSync(file + '.split.json', a.split.text);",
      "const r = spawnSync('bun', [" + JSON.stringify(join(import.meta.dir, "rule.ts")) + ", cmd, target, ...(a.split ? ['--split', file + '.split.json'] : [])], { stdio: 'inherit' });",
      "process.exit(r.status ?? 1);",
    ].join("\n");
    const r = bundle(join(out, "frozen-head"), shim);
    const rows = r.text.split("\n").filter((l) => /^(PASS|FAIL) /.test(l) && !/^PASS \d+, FAIL \d+$/.test(l));
    const fails = rows.filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5));
    say("    " + (r.text.trim().split("\n").at(-1) ?? ""));
    for (const f of fails) say("    ordered change: " + JSON.stringify(f) + (ORDERED[f] ? " (" + ORDERED[f] + ")" : " (NOT LISTED)"));
    check("all 150 frozen checks ran at the head", rows.length === 150);
    check("every frozen check passes at the head except the listed ordered changes (" + fails.length + " of " + Object.keys(ORDERED).length + " listed)", fails.every((f) => f in ORDERED));
    check("the ledger section ran at the head: one lease opened and settled per frozen item, and a second run refused", rows.filter((l) => /^PASS tbv-[a-z0-9-]+: one lease opened .* settled at/.test(l)).length === 8 && rows.filter((l) => /^PASS tbv-[a-z0-9-]+: a second run on the settled item is refused \(E_ITEM_BOUND\)/.test(l)).length === 8);
  });

  // ---------- part 3 fixtures: head-shaped readings files with their split manifests ----------
  let resp = 0;
  const task = (id: string, source: "A" | "B", stratum = "long", nfacts = 4, x: Any = {}) => ({ id, cluster: id, source, stratum, nfacts, ...x });
  const label = (base: string, want: boolean) => { let k = 0; while (doubleRead(base + "-" + k) !== want) k++; return base + "-" + k; };
  const reading = (t: Any, arm: string, model: string, pass: number, rate: number, x: Any = {}) => {
    const k = Math.round(rate * t.nfacts), facts = [...Array(t.nfacts)].map((_, i) => ({ in: i < k, any: i < k }));
    const judge = model === "opus" ? "sol" : "opus", { second, ...rest } = x;
    const family = rest.family ?? t.family ?? (t.source === "A" ? "investigate" : "ship");
    const r: Any = { id: label([t.id, family, arm, model, pass].join("."), !!second && t.nfacts > 0), task: t.id, family, arm, model, pass, status: "scored", judge, facts, unsupported: 0, exposed: arm === "none" || arm === "lens" ? null : true, words: 150, usd: 0.3, cacheRead: 0.8, responseIds: ["msg_" + ++resp], maxTokens: [] };
    if (t.stratum === "short") r.shortShare = rate;
    if (second && t.nfacts) r.second = { judge: judge === "sol" ? "opus" : "sol", status: "judged", facts: facts.map((f) => ({ ...f })), responseIds: ["msg_" + ++resp] };
    return Object.assign(r, rest);
  };
  const controls = (ts: Any[]) => ts.flatMap((t) => ["sol", "opus"].flatMap((judge) => (["stock", "oracle"] as const).map((kind) => ({ task: t.id, kind, judge, status: "judged", facts: [...Array(t.nfacts)].map(() => ({ in: kind === "oracle", any: kind === "oracle" })), responseIds: ["msg_" + ++resp] }))));
  const file = (stage: "hr" | "dev", ts: Any[], readings: Any[], o: { controls?: Any[]; manifestTasks?: Any[]; passes?: number } = {}) => {
    const controlTaskIds = stage === "hr" ? ts.filter((t) => t.stratum !== "clean").map((t) => t.id) : [];
    const text = JSON.stringify({ schema: "tbv-split.v1", stage, tasks: o.manifestTasks ?? ts, controlTaskIds });
    const plan = { models: ["opus"], passes: { opus: o.passes ?? (stage === "hr" ? 3 : 1) }, capyPasses: 2, skillArms: stage === "hr" ? ["none"] : ["none", "current", "principle"], taskIds: ts.map((t) => t.id), controlTaskIds, manifestSha256: createHash("sha256").update(text).digest("hex") };
    return { data: { stage, tasks: ts, readings, ...(o.controls ? { controls: o.controls } : {}), plan } as Any, split: text };
  };
  const stage1 = (mutate: (rs: Any[], ts: Any[]) => void = () => {}) => {
    const ts = [...Array(20)].map((_, i) => task("t" + i, i < 10 ? "A" : "B", ["long", "short", "other"][i % 3]!));
    const rs = ts.flatMap((t, i) => [1, 2, 3].map((p) => reading(t, "none", "opus", p, 0.5, { second: (i + p) % 3 === 0 })));
    mutate(rs, ts);
    return file("hr", ts, rs, { controls: controls(ts) });
  };
  const dev = (mutate: (rs: Any[], ts: Any[]) => void = () => {}, tasks?: Any[]) => {
    const ts = tasks ?? [...Array(20)].map((_, i) => task("t" + i, "A", ["long", "short", "other"][i % 3]!));
    const rate: Any = { none: 0.25, current: 0.5, principle: 0.75 };
    const rs = ts.flatMap((t, i) => ["none", "current", "principle"].map((arm) => reading(t, arm, "opus", 1, rate[arm], { second: i % 4 === 0 })));
    mutate(rs, ts);
    return file("dev", ts, rs);
  };
  const of = (rs: Any[], t: string, arm = "none", pass = 1) => rs.find((r) => r.task === t && r.arm === arm && r.pass === pass)!;
  const gap = (r: Any) => { r.status = "gap"; r.facts = []; r.responseIds = []; delete r.second; };
  const hr = (f: { data: Any; split: string }) => head("headroom", f.data, f.split);
  const cmp = (f: { data: Any; split: string }) => head("compare", f.data, f.split);

  await section("3a. End states the amendment adds (items 12, 13 and 17)", () => {
    const e = (kinds: Array<[Attempt["kind"], Attempt["turn"]]>) => endState(kinds.map(([kind, turn]) => ({ kind, turn })));
    const show = (what: string, x: ReturnType<typeof endState>) => say("    " + what + ": " + x.cls + ", sends " + x.sends + (x.drill && Object.keys(x.drill).length ? ", drill " + JSON.stringify(x.drill) : ""));
    const a = e([["max-tokens", "report"], ["max-tokens", "d1"], ["max-tokens", "d2"]]); show("max_tokens on the report, D1 and D2", a);
    check("a max_tokens reply with text on the report turn scores with one send and no follow-up; D1 and D2 are read as returned", a.cls === "scored" && a.sends === 3 && a.drill?.d1 === "ok" && a.drill?.d2 === "ok");
    const b = e([["empty", "report"], ["max-tokens", "followup"]]); show("an empty report, then max_tokens on the follow-up", b);
    check("an empty report takes the one follow-up, and a follow-up that stops at max_tokens scores", b.cls === "scored" && b.sends === 2);
    const c = e([["empty", "report"], ["empty", "followup"]]); show("an empty report and an empty follow-up", c);
    check("a max_tokens reply with no text is sent as empty: report and follow-up empty is no-report", c.cls === "no-report");
    const d = e([["truncated", "report"], ["truncated", "report"], ["truncated", "report"]]); show("three truncated streams", d);
    check("a stream with no final message is still a transport failure: two retries, then a gap", d.cls === "gap" && d.sends === 3);
    const s = e([["size", "report"]]); show("a size-only validator refusal", s);
    check("a size-only refusal is a size drop with no send (item 12)", s.cls === "size-drop" && s.sends === 0);
    check("any other validator failure is still a harness failure that stops the item", e([["validator", "report"]]).cls === "harness");
    const o = e([["5xx", "report"], ["5xx", "report"], ["outage", "report"]]); show("two 5xx, then the driver's outage stop", o);
    check("an outage stop is class outage, incomplete and never retried (item 13)", o.cls === "outage" && o.sends === 2);
  });

  await section("3b. Size drops and max_tokens replies against coverage (items 12 and 17)", () => {
    const base = hr(stage1());
    const sized = hr(stage1((rs) => { for (const r of rs.filter((r) => r.task === "t3")) { r.status = "size-drop"; r.facts = []; r.responseIds = []; delete r.second; } of(rs, "t4").maxTokens = ["report"]; of(rs, "t5", "none", 2).maxTokens = ["d1"]; }));
    say("    " + line(sized.out, /^Stage 1 headroom/));
    say("    " + line(sized.out, /^size drops/));
    check("the base stage 1 file reads HEADROOM", base.verdict.startsWith("HEADROOM"));
    check("a size-dropped task's 3 readings count as missing", /missing or unjudged 3$/.test(line(sized.out, /^Stage 1 headroom/)));
    check("the size drop and each max_tokens reply print per arm, model and turn", /size drops: 1 tasks; outage stops: 0 readings; max_tokens replies: none:opus:d1 1, none:opus:report 1/.test(sized.out));
  });

  await section("3c. Judge pricing by judge model and packet kind (item 14)", () => {
    const prices = PRICES;
    const judgeMeasured = { "sol:first": 0.04, "sol:d2": 0.01, "sol:control": 0.03, "opus:first": 0.08, "opus:control": 0.06 };
    const item = { item: "tbv-dev-base", readings: [{ model: "opus", arm: "none", n: 10 }], packets: [{ judge: "sol", kind: "first", n: 10 }, { judge: "sol", kind: "d2", n: 10 }, { judge: "opus", kind: "first", n: 2 }, { judge: "opus", kind: "d2", n: 2 }] };
    const r = head("projection", { items: [item], measured: { "none:opus": 0.4 }, judgeMeasured, prices });
    say("    " + line(r.out, /^tbv-dev-base/));
    const proj = 10 * 0.4 + 10 * 0.04 + 10 * 0.01 + 2 * 0.08 + 2 * 0.01;
    const worst = 4 * readingWorst({ inputTokens: 130_000, price: prices.opus });
    check("each packet takes its judge model and kind's measured cost, the double read at the other judge's, and opus:d2 (unmetered) the costliest metered d2 path: projected $" + proj.toFixed(2), r.code === 0 && line(r.out, /^tbv-dev-base/) === "tbv-dev-base: projected $" + proj.toFixed(2) + ", round worst case $" + worst.toFixed(2) + ", cap $" + capOf(proj, worst).toFixed(2));
    const none = head("projection", { items: [item], measured: { "none:opus": 0.4 }, judgeMeasured: { "sol:first": 0.04, "opus:first": 0.08 }, prices });
    check("a packet kind stage 1 never metered is refused", none.refused && none.err.includes("no measured judge cost for any d2 packet"));
  });

  await section("3d. The all-in check before every paid item, on the crew's actual credits (item 11)", () => {
    for (const item of PAID_ITEMS.filter((i) => i !== "tbv-held")) {
      const ok = head("allin", { item, crewCredits: 150_000, crewRest: 100, settled: 300, reserved: 0, unknown: 0, itemCap: 200 });
      const no = head("allin", { item, crewCredits: 150_000, crewRest: 100, settled: 1500, reserved: 0, unknown: 0, itemCap: 300 });
      check(item + ": starts at $750 all-in with the crew term printed against the $300 reserve, and does not start at $2,050", ok.verdict === "START " + item + " ($750.00)" && ok.out.includes("crew spent $150.00 (150000 credits; $150.00 of the $300.00 crew reserve)") && no.verdict.startsWith("NO START (to the Captain; $2050.00"));
    }
    check("an item that is not a paid item is refused", head("allin", { item: "tbv-other", crewCredits: 0, crewRest: 0, settled: 0, reserved: 0, unknown: 0, itemCap: 1 }).refused);
  });

  await section("3e. The leak check's exemption for names gstack holds at C (item 15)", () => {
    const L = (names: string[], added: string[], atC: string) => head("leak", { addedLines: added, gstackAtC: atC, material: "unrelated task text", names });
    const ex = L(["README.md", "held_only.py"], ["See README.md before you start."], "Read README.md first.");
    say("    " + line(ex.out, /^leak:/));
    check("a name gstack at C holds whole is exempt, and the diff reads CLEAN", ex.verdict === "CLEAN" && /0 task names \(1 exempt/.test(ex.out));
    check("a held name gstack at C does not hold still hits", L(["held_only.py"], ["edit held_only.py"], "Read README.md first.").verdict.startsWith("HIT"));
    check("gstack at C holding only a longer name exempts nothing", L(["README"], ["see README"], "Read README.md first.").verdict.startsWith("HIT"));
  });

  await section("3f. Held-out source B accrual (amendment section 2)", () => {
    const P = "2026-11-10T12:00:00Z";
    const at = (s: number) => new Date(Date.parse(P) + s * 1000).toISOString().replace(".000Z", "Z");
    const pr = (o: Partial<PrRecord> = {}): PrRecord => ({ number: 12, state: "MERGED", title: "x", createdAt: at(3600), mergedAt: at(7200), closedAt: at(7200), baseRefName: "main", headRefName: "x/y", closingIssues: [], files: [], commits: [{ oid: "1".repeat(40), message: "x", authoredDate: at(3700), committedDate: at(3700), checks: [] }], reviewThreads: [], reviews: [], ...o });
    const ok = pr();
    check("a pull request opened and merged after P with every commit after P qualifies", heldOutEligible(ok, [ok], P).ok);
    check("one opened one second before P, or at P, is excluded", !heldOutEligible(pr({ createdAt: at(-1) }), [], P).ok && !heldOutEligible(pr({ createdAt: P }), [], P).ok);
    check("a rebased commit with an old author date and a new committer date is excluded", !heldOutEligible(pr({ commits: [{ ...ok.commits[0]!, authoredDate: at(-86400), committedDate: at(3600) }] }), [], P).ok);
    const sib = pr({ number: 11, createdAt: at(-1), state: "CLOSED", mergedAt: null });
    check("a pull request whose lineage cluster holds one opened before P is excluded", !heldOutEligible(ok, [sib, ok], P).ok);
    check("accrual stays open at 49 qualifiers on day 20 and closes at the 50th", !accrualClosed({ qualifyingNonClean: 49, pPostMergedAt: P, now: at(20 * 86400) }).closed && accrualClosed({ qualifyingNonClean: 50, pPostMergedAt: P, now: at(3600) }).closed);
    check("accrual closes at day 21 (and so at day 22), not one second before", !accrualClosed({ qualifyingNonClean: 3, pPostMergedAt: P, now: at(21 * 86400 - 1) }).closed && accrualClosed({ qualifyingNonClean: 3, pPostMergedAt: P, now: at(21 * 86400) }).closed && accrualClosed({ qualifyingNonClean: 3, pPostMergedAt: P, now: at(22 * 86400) }).closed);
    check("dev source B is merged strictly before the scorer pin post", devEligible(pr({ mergedAt: at(-1) }), P) && !devEligible(pr({ mergedAt: P }), P));
  });

  await section("3g. Build fixes, items 1 to 7 and 16", () => {
    const flipped = hr(stage1((rs) => { const c: Any = { ...of(rs, "t0"), id: "copy-f", pass: 3, family: "ship", responseIds: ["msg_copy"] }; delete c.second; rs.splice(rs.indexOf(of(rs, "t0", "none", 3)), 1, c); }));
    check("item 1: a copy relabelled to the other family is refused (E_USAGE, family must match its task)", flipped.refused && flipped.err.includes("has family ship, but its task t0 is family investigate"));
    const exp = cmp(dev((rs) => { for (const t of ["t16", "t17", "t18"]) { of(rs, t, "current").exposed = false; gap(of(rs, t, "none")); } gap(of(rs, "t19", "current")); gap(of(rs, "t19", "none")); }));
    check("item 2: exposure counts every reading with report text, not only matched rows (current 16/19 = 0.842)", line(exp.out, /current - none:/).includes("exposure current 0.842"));
    const nd = hr(stage1((rs) => { const s = rs.find((r) => r.second)!; delete s.second; }));
    check("item 3: a sampled double read never attempted reads JUDGE FAIL", nd.verdict.startsWith("JUDGE FAIL") && nd.verdict.includes("never attempted"));
    const un = hr(stage1((rs) => { const s = rs.find((r) => r.second)!; s.second = { ...s.second, status: "unjudged", facts: [] }; }));
    say("    " + line(un.out, /^Agreement/));
    check("item 3 as ruled: a second read attempted and unjudged leaves the sample, prints as a count, and keeps the verdict", un.verdict.startsWith("HEADROOM") && /unjudged 1\)/.test(un.out));
    const s1 = stage1(), dropped = { ...s1.data, tasks: s1.data.tasks.filter((t: Any) => t.id !== "t19"), readings: s1.data.readings.filter((r: Any) => r.task !== "t19"), controls: s1.data.controls.filter((c: Any) => c.task !== "t19"), plan: { ...s1.data.plan, taskIds: s1.data.plan.taskIds.filter((t: string) => t !== "t19") } };
    check("item 4: a task dropped from the readings and the plan but held by the split manifest is refused", hr({ data: dropped, split: s1.split }).refused);
    const wrong = hr(stage1((rs) => { rs[1].judge = "opus"; }));
    check("item 5: a reading judged by the wrong judge is refused", wrong.refused && wrong.err.includes("arms are judged by sol"));
    const same = hr(stage1((rs) => { const s = rs.find((r) => r.second)!; s.second.judge = s.judge; }));
    check("item 5: a second read by the same judge is refused", same.refused);
    const copy = hr(stage1((rs) => { of(rs, "t1", "none", 2).responseIds = [...of(rs, "t1", "none", 1).responseIds]; }));
    check("item 6: a copy given another pass number is refused by its shared response id", copy.refused && copy.err.includes("shares response id"));
    const lists = cmp(dev((rs, ts) => { for (const r of rs) if (ts.find((t) => t.id === r.task)!.stratum === "long") r.list = { named: true, order: true, rest: true, offer: true }; of(rs, "t1", "current").list = { named: false, order: false, rest: false, offer: false }; }));
    check("item 7: list handling reads long-stratum tasks only (a short task's list answer moves nothing)", line(lists.out, /^secondary current:opus/).includes("list handling named 1.000 order 1.000"));
    const rv = cmp(dev(() => {}, [...Array(16)].map((_, i) => task("t" + i, "A", ["long", "short", "other"][i % 3]!, 4, i % 2 ? { family: "review" } : {}))));
    check("item 16: review-family readings enter the skill layer and print per family", rv.out.includes("per family review opus principle - none") && line(rv.out, /principle - none:/).includes("coverage 1.000"));
  });

  await section("3h. The underscore gap and fix-check 3's forms (the regression table)", () => {
    const t = table();
    writeFileSync(join(out, "regression-table.md"), t.text + "\n");
    say("    " + (t.text.split("\n").at(-1) ?? ""));
    check("the regression table reads SUPERSET_AND_EXPECTED ok over every case", t.failing === 0 && /SUPERSET_AND_EXPECTED: ok/.test(t.text));
  });

  await section("3i. Each family's history limit at 641d622 (amendment item 12)", () => {
    for (const [fam, o] of Object.entries(OVERHEAD_641D622)) say("    " + fam + ": overhead " + o + " tokens, history limit " + historyLimit(o) + " tokens");
    check("ship's overhead over 40,000 lowers its history limit to 79,546, and a ship history admits at the limit and not one token over", historyLimit(OVERHEAD_641D622.ship) === 79_546 && admitsSize(79_546, OVERHEAD_641D622.ship) && !admitsSize(79_547, OVERHEAD_641D622.ship));
    check("investigate and capy overheads are under 40,000, so their limit stays at 90,000", historyLimit(OVERHEAD_641D622.investigate) === 90_000 && historyLimit(OVERHEAD_641D622.capy) === 90_000 && admitsSize(90_000, OVERHEAD_641D622.investigate) && !admitsSize(90_001, OVERHEAD_641D622.capy));
  });

  await section("3j. Skill start at 641d622: gstack's own unattended block is kept, any other block or a degraded path is refused", () => {
    const start = "SKILL_START_PROTO: 1\nGSTACK_INSTRUCTION_BEGIN: unattended-session\nend at the first pending item\nGSTACK_INSTRUCTION_END: unattended-session\n";
    check("the unattended-session block gstack prints for an unattended session is part of the treatment and passes", skillStartProblem(start) === null);
    check("any other instruction block is refused", (skillStartProblem(start + "GSTACK_INSTRUCTION_BEGIN: crew-rules\n") ?? "").includes("crew-rules"));
    check("advice to run ./setup or /gstack-upgrade is a degraded path and is refused", skillStartProblem("SKILL_START_PROTO: 1\nrun ./setup first\n") !== null && skillStartProblem("SKILL_START_PROTO: 1\nUPGRADE_AVAILABLE 1.97\n") !== null);
    check("a stdout with no SKILL_START_PROTO: 1 line is degraded and refused", skillStartProblem("hello\n") !== null);
  });

  await section("3k. Worst cases the proxy reserves beside the rule's (FROZEN finding 1), and tbv-author's worst case per task", () => {
    const text = "x".repeat(3 * 130_000);
    for (const m of ["opus", "sol", "particle"] as const) {
      const req = armSend(m, { max_tokens: MAX_TOKENS, messages: [{ role: "user", content: [{ type: "text", text }] }] });
      const proxy = worstOf(req, MAX_TOKENS) / 1e6;
      const p = PRICES[m], rule1 = (130_000 * Math.max(p.in, p.cacheWrite ?? 0) + MAX_TOKENS * p.out) / 1e6;
      say("    " + m + ": a 130,000-token first send (390,000 characters) reserves $" + proxy.toFixed(2) + " at the proxy; the rule's readingWorst prices that send at $" + rule1.toFixed(2) + " and the whole reading at $" + readingWorst({ inputTokens: 130_000, price: p }).toFixed(2));
      check(m + ": the proxy's reservation for that send is at least the rule's price for it (admission stays the frozen roundAdmits on the rule's figures)", proxy >= rule1 - 1e-9);
    }
    const prompt = "x".repeat(3 * 130_000);
    const writer = worstOf(keyWriterSend(prompt, KEY_MAX_TOKENS), KEY_MAX_TOKENS) / 1e6;
    const audits = (["opus", "sol"] as const).map((j) => worstOf(auditorSend(j, prompt, AUDIT_MAX_TOKENS), AUDIT_MAX_TOKENS) / 1e6);
    const perTask = 2 * (writer + audits[0]! + audits[1]!);
    say("    tbv-author per task at a 130,000-token prompt: key writer $" + writer.toFixed(2) + " at " + KEY_MAX_TOKENS + " output tokens, auditors opus $" + audits[0]!.toFixed(2) + " and sol $" + audits[1]!.toFixed(2) + " at " + AUDIT_MAX_TOKENS + "; with one fresh retry each, $" + perTask.toFixed(2) + " a task");
    check("tbv-author's worst case prices the key writer at 16,000 output tokens and each auditor at 8,000 (each above the same request at half its maximum)", KEY_MAX_TOKENS === 16_000 && AUDIT_MAX_TOKENS === 8_000 && writer > worstOf(keyWriterSend(prompt, 8_000), 8_000) / 1e6 && (["opus", "sol"] as const).every((j, i) => audits[i]! > worstOf(auditorSend(j, prompt, 4_000), 4_000) / 1e6));
  });

  await section("3l. One driver item, one judge item and one key item end to end on stub upstreams through the real proxy and ledger", () => {
    const r = spawnSync("bun", ["test", "tests/tbv/drive.test.ts", "tests/tbv/judge.test.ts", "tests/tbv/keys.test.ts"], { cwd: ROOT, encoding: "utf8", env: KEYLESS, maxBuffer: 1 << 26 });
    const o = r.stdout + r.stderr;
    const count = (re: RegExp) => Number(re.exec(o)?.[1] ?? NaN);
    say("    drive, judge and keys tests: " + count(/^ (\d+) pass$/m) + " pass, " + count(/^ (\d+) fail$/m) + " fail");
    check("the driver's item runs (real sends, reservations and settlements on a temporary ledger) pass, release and the missing-record stop included", r.status === 0 && count(/^ (\d+) fail$/m) === 0 && o.includes("a send with no generation record (404) keeps its full reservation and stops the item"));
    check("the judge item and the key item run through the real openItemRun, routes, proxy and ledger", o.includes("(pass) runJudges over a fake item run > integration") && o.includes("(pass) keys run > integration"));
  });

  await section("3m. Source A's rebuild tier on fixtures: the probe, the digest gate, the counts, the refusals and the real pins (amendment 1 sections 1 and 5)", () => {
    const r = spawnSync("bun", ["test", "tests/tbv/rebuild.test.ts"], { cwd: ROOT, encoding: "utf8", env: KEYLESS, maxBuffer: 1 << 26 });
    const o = r.stdout + r.stderr;
    const passed = (name: string) => o.includes("(pass) " + name);
    say("    rebuild tests: " + (/^ (\d+) pass$/m.exec(o)?.[1] ?? "?") + " pass, " + (/^ (\d+) fail$/m.exec(o)?.[1] ?? "?") + " fail");
    check("a probe that rebuilds a held-tier task away from its digest, or finds no held-tier session at a commit, refuses before any other rebuild", r.status === 0 && passed("a probe that rebuilds a held-tier task away from its digest refuses before any other rebuild") && passed("the probe needs a held-tier session at every commit the rebuild tier uses"));
    check("a rebuilt task is kept only at its recorded digest and the rest drop with the reason, and stdout carries counts only", passed("the probe matches, then the digest gate keeps a rebuilt task only at its recorded digest and drops the rest with the reason") && passed("the counts output: pins, the probe, sessions by tier, tasks and sessions kept and dropped by reason; no task id"));
    check("a missing pin or input refuses, and the real pins are the merged posts' and load from this checkout's history", passed("a missing pin refuses: an unpinned bundle, a commit the checkout lacks, a pinned file missing, a pool off its pins, an export off the pool") && passed("a missing or misplaced input refuses before anything is rebuilt") && passed("the real pins are the merged posts' pins, and the pinned code materializes with the allowlist network") && passed("the real pins load from this checkout's history: both commits hold the four files and the pool at its pins"));
  });

  say("\n## Leak check");
  const all = readFileSync(join(out, "frozen-head", "dryrun.out"), "utf8") + readFileSync(join(out, "frozen-own", "dryrun.out"), "utf8");
  check("no part prints a key-shaped value", !/sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}/.test(all));
  say("\nPASS " + pass + ", FAIL " + fail);
  return { pass, fail };
}

export async function run(argv: string[], io: Io): Promise<number> {
  const target = argv[0] === "dryrun" ? argv[1] : argv[0];
  if (!target) { io.err("E_USAGE tbv dryrun <scratch dir>"); return 2; }
  const set = KEYS.filter((k) => process.env[k]);
  if (set.length) { io.err("E_USAGE the dry run is keyless: unset " + set.join(", ")); return 2; }
  const r = await dryrun(resolve(target), io);
  return r.fail ? 1 : 0;
}

if (import.meta.main) process.exit(await run(process.argv.slice(2), { out: (t) => console.log(t), err: (t) => console.error(t) }));
