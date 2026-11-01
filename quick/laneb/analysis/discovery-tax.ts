// Readings for GEVA-106's preregistration (sections 5 to 7): Run D, untold skill discovery, and Run T,
// the told-text tax. Reuses analyze.ts: loadTrial (task, arm, model, reward, cost, budget stops),
// skillOpensFromMessages (the open rule, applied one tool call at a time), rng and bootstrap.
//   bun analysis/discovery-tax.ts <config.json>
// config: { run: "D" | "T", models: [...], jobs: [Harbor job dirs], sessions?: [proxy-sessions.jsonl],
//   cells?: { role: label }, dropped_tasks?: [...], fit?: [...], listing_check?: { arm: true|false },
//   bodies?: { arm: { folder: SKILL.md body } }, arm_tars?: { arm: tar path } }
// Cells are keyed by a label: the arm name today. A later per-batch setting appends "@setting"; armOf strips it.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bootstrap, loadTrial, rng, skillOpensFromMessages } from "./analyze.ts";
import { entryBytes, tarEntries } from "../arms/variants.ts";
import { splitSkill } from "../arms/placebo/placebo.ts";

export const SEED = 20261101;
export const RESAMPLES = 10_000;
export const DRAWS = 100_000;
export const FIT = ["custom-memory-heap-crash", "overfull-hbox", "fix-code-vulnerability", "fix-git", "db-wal-recovery"];
const MARKERS: Record<string, RegExp> = { debug_report: /DEBUG REPORT/, phase: /Phase [1-5]\b/, iron_law: /Iron Law/i, root_cause: /root cause/i, hypothesis: /hypothes[ie]s/i };
const D_CELLS = { none: "none", gstack: "gstack", rewritten: "gstack-rewritten", placebo: "placebo" };
const T_CELLS = { none: "none", short: "placebo-short", placebo: "placebo" };

export const armOf = (label: string) => label.split("@")[0]!;

export type Rec = {
  trial: string; task: string; label: string; model: string; status: "graded" | "missing"; pass: number;
  responded: boolean; refused: boolean; eligible: boolean; opens: string[]; pluginOpens: number; browses: number;
  loaded: string[]; markers: Record<string, boolean>; bodyLoad: boolean; firstTokens: number | null; requests: number;
  costUsd: number; budgetStop: boolean; agentTimeout: boolean; retried: boolean;
};
export type Ctx = { installed: (arm: string) => string[]; bodies: Record<string, Record<string, string>>; sessions: Map<string, any[]> };

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const flat = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : flat(b?.content))).join("\n") : "");

// A trial's record. A model response reached the agent when an assistant message has a content block that
// the CLI did not write itself: its refusal and API errors arrive as one "API Error" text block with zero usage.
export function loadRec(dir: string, ctx: Ctx): Rec | null {
  const t = loadTrial(dir);
  if (!t) return null;
  const msgsPath = join(dir, "agent", "sdk-messages.jsonl");
  const msgs = (existsSync(msgsPath) ? readFileSync(msgsPath, "utf8").split("\n") : []).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const results = new Map<string, { content: unknown; is_error: boolean }>();
  for (const m of msgs) if (m.type === "UserMessage" && Array.isArray(m.content)) for (const b of m.content) if (b?.tool_use_id) results.set(b.tool_use_id, { content: b.content, is_error: b.is_error === true });
  let responded = false;
  let refused = msgs.some((m) => m.type === "SystemMessage" && String(m.subtype ?? "").startsWith("model_refusal"));
  const calls: any[] = [];
  const texts: string[] = [];
  for (const m of msgs) {
    if (m.type !== "AssistantMessage" || !Array.isArray(m.content) || !m.content.length) continue;
    const synthetic = m.content.every((b: any) => typeof b?.text === "string" && b.text.startsWith("API Error")) && !(m.usage?.input_tokens || m.usage?.output_tokens);
    if (synthetic) { if (m.content.some((b: any) => /safeguards|refus/i.test(b.text))) refused = true; continue; }
    responded = true;
    for (const b of m.content) {
      if (b && typeof b === "object" && "name" in b) calls.push(b);
      else if (typeof b?.text === "string") texts.push(b.text);
    }
  }
  const arm = armOf(t.arm);
  const installed = ctx.installed(arm);
  const opens: string[] = [];
  const loaded: string[] = [];
  let pluginOpens = 0;
  let browses = 0;
  for (const b of calls) {
    const name = skillOpensFromMessages([JSON.stringify({ type: "AssistantMessage", content: [b] })])[0];
    if (name === "plugin-authoring") { pluginOpens++; continue; }
    if (name !== undefined && installed.includes(name)) {
      opens.push(name);
      const r = results.get(b.id);
      const text = b.name === "Read" ? flat(r?.content).replace(/^\s*\d+(\t|\u2192)/gm, "") : flat(r?.content);
      const head = ctx.bodies[arm]?.[name]?.slice(0, 200);
      if (r && !r.is_error && (b.name === "Skill" || (head && text.includes(head)))) loaded.push(name);
      continue;
    }
    if (JSON.stringify(b.input ?? {}).includes("/.claude/skills/")) browses++;
  }
  const session = readJson(join(dir, "agent", "laneb-summary.json"))?.session ?? {};
  const attempts = ctx.sessions.get(t.trialName) ?? [];
  const graded = responded || refused;
  return {
    trial: t.trialName, task: t.task, label: t.arm, model: t.model, status: graded ? "graded" : "missing", pass: t.outcome === "pass" ? 1 : 0,
    responded, refused, eligible: graded && responded, opens, pluginOpens, browses, loaded,
    markers: Object.fromEntries(Object.entries(MARKERS).map(([k, re]) => [k, texts.some((x) => re.test(x))])),
    bodyLoad: session.cmd_expanded === true, firstTokens: session.first_req_prompt_tokens ?? null, requests: t.requests, costUsd: t.costUsd,
    budgetStop: t.budgetStop, agentTimeout: t.agentTimeout, retried: attempts.slice(0, -1).some((s) => (s.ok_responses ?? 0) > 0),
  };
}

// The first 200 characters of every top-level SKILL.md body in an arm tar.
export function tarBodies(tar: string): Record<string, string> {
  const fd = openSync(tar, "r");
  try {
    return Object.fromEntries(tarEntries(fd).entries.flatMap((e) => {
      const m = /^(?:\.\/)?\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(e.name);
      return m ? [[m[1]!, splitSkill(entryBytes(fd, e).toString("utf8")).body.slice(0, 200)]] : [];
    }));
  } finally { closeSync(fd); }
}

export function loadRun(cfg: any): { recs: Rec[]; dropped: { task: string; trials: number; usd: number }[] } {
  const sessions = new Map<string, any[]>();
  for (const f of cfg.sessions ?? []) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const s = JSON.parse(l);
    const key = String(s.trial ?? "").split("__").slice(0, 2).join("__");
    sessions.set(key, [...(sessions.get(key) ?? []), s].sort((a, b) => String(a.opened_at).localeCompare(String(b.opened_at))));
  }
  const bodies: Record<string, Record<string, string>> = { ...(cfg.bodies ?? {}) };
  for (const [arm, tar] of Object.entries(cfg.arm_tars ?? {})) bodies[arm] = tarBodies(tar as string);
  const manifests = join(import.meta.dir, "../arms/manifests");
  const installed = (arm: string) => (bodies[arm] ? Object.keys(bodies[arm]!) : readJson(join(manifests, arm + ".json"))?.skills?.names ?? []);
  const all: Rec[] = [];
  for (const job of cfg.jobs) for (const name of readdirSync(job)) {
    const d = join(job, name);
    if (!statSync(d).isDirectory()) continue;
    const r = loadRec(d, { installed, bodies, sessions });
    if (r) all.push(r);
  }
  const drop = new Set<string>(cfg.dropped_tasks ?? []);
  const dropped = [...drop].map((task) => { const xs = all.filter((r) => r.task === task); return { task, trials: xs.length, usd: xs.reduce((s, r) => s + r.costUsd, 0) }; });
  return { recs: all.filter((r) => !drop.has(r.task)), dropped };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : NaN; };
export function perTask(recs: Rec[], value: (r: Rec) => number): Map<string, number> {
  const acc = new Map<string, number[]>();
  for (const r of recs) acc.set(r.task, [...(acc.get(r.task) ?? []), value(r)]);
  return new Map([...acc].map(([k, xs]) => [k, mean(xs)]));
}
const bopts = { b: RESAMPLES, seed: SEED };
export const rate = (map: Map<string, number>) => ({ tasks: map.size, ...bootstrap([...map.keys()].sort(), (s) => mean(s.map((k) => map.get(k)!)), bopts) });

// Two-sided Monte Carlo sign-flip test of the mean per-task difference: p = (1 + hits) / (1 + draws).
export function signFlip(diffs: number[], draws = DRAWS, seed = SEED): number {
  if (!diffs.length) return NaN;
  const r = rng(seed);
  const obs = Math.abs(mean(diffs)) - 1e-12;
  let hits = 0;
  for (let i = 0; i < draws; i++) {
    let s = 0;
    for (const d of diffs) s += r() < 0.5 ? -d : d;
    if (Math.abs(s / diffs.length) >= obs) hits++;
  }
  return (1 + hits) / (1 + draws);
}
export function contrast(a: Map<string, number>, b: Map<string, number>, test = true) {
  const tasks = [...a.keys()].filter((k) => b.has(k)).sort();
  const ci = bootstrap(tasks, (s) => mean(s.map((k) => a.get(k)! - b.get(k)!)), bopts);
  return { tasks: tasks.length, ...ci, p: test ? signFlip(tasks.map((k) => a.get(k)! - b.get(k)!)) : NaN };
}
export function holm(ps: number[]): number[] {
  const order = ps.map((p, i) => [p, i] as const).filter(([p]) => Number.isFinite(p)).sort((x, y) => x[0] - y[0]);
  const out = ps.map(() => NaN);
  let run = 0;
  order.forEach(([p, i], k) => { run = Math.max(run, Math.min(1, (order.length - k) * p)); out[i] = run; });
  return out;
}
// Equal weight per model: the mean of each model's per-task mean over one shared resample of tasks.
function pooled(maps: Map<string, number>[]) {
  const tasks = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
  return bootstrap(tasks, (s) => mean(maps.map((m) => mean(s.filter((k) => m.has(k)).map((k) => m.get(k)!)))), bopts);
}
export const zeroBound = (tasks: number) => 1 - Math.pow(0.05, 1 / tasks);
export function t1Verdict(ci: { lo: number; hi: number }) {
  const verdict = ci.hi < 0 ? "confirmed" : ci.lo > 0 ? "reversed" : "not confirmed";
  return { verdict, smallerThanLead: ci.lo > -0.1 };
}

const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "n/a" : (100 * x).toFixed(1) + "%");
const pp = (x: number | null) => (x !== null && Number.isFinite(x) ? (x >= 0 ? "+" : "") + (100 * x).toFixed(1) : "n/a");
const ci = (c: { point: number; lo: number; hi: number }, f = pct) => `${f(c.point)} [${f(c.lo)}, ${f(c.hi)}]`;
const pv = (p: number) => (Number.isFinite(p) ? p.toPrecision(3) : "n/a");

function cellLine(recs: Rec[], model: string, label: string, told: boolean) {
  const all = recs.filter((r) => r.model === model && r.label === label);
  const g = all.filter((r) => r.status === "graded");
  const passes = g.reduce((s, r) => s + r.pass, 0);
  const cost = g.reduce((s, r) => s + r.costUsd, 0);
  const share = (n: number) => (g.length ? n / g.length : NaN);
  return {
    graded: g, eligibleShare: share(g.filter((r) => r.eligible).length), bodyLoadShare: share(g.filter((r) => r.bodyLoad).length),
    text: `${model} ${label}: graded ${g.length}, missing ${all.length - g.length}, refused ${g.filter((r) => r.refused).length}, retried after a response ${g.filter((r) => r.retried).length}; ` +
      (told ? `body load ${pct(share(g.filter((r) => r.bodyLoad).length))}; ` : `eligible ${pct(share(g.filter((r) => r.eligible).length))}; `) +
      `pass ${ci(rate(perTask(g, (r) => r.pass)))}; session-cap stops ${g.filter((r) => r.budgetStop).length} (${pct(share(g.filter((r) => r.budgetStop).length))}), agent timeouts ${g.filter((r) => r.agentTimeout).length}; ` +
      `median requests ${median(g.map((r) => r.requests))}, median first-request tokens ${median(g.flatMap((r) => (r.firstTokens === null ? [] : [r.firstTokens])))}; ` +
      `cost per trial $${(g.length ? cost / g.length : 0).toFixed(3)}, per success ${passes ? "$" + (cost / passes).toFixed(3) : "n/a"}`,
  };
}

export function runD(recs: Rec[], cfg: any): string[] {
  const c = { ...D_CELLS, ...(cfg.cells ?? {}) };
  const out: string[] = ["# Run D: untold discovery"];
  const failed = Object.entries(cfg.listing_check ?? {}).filter(([, ok]) => ok !== true).map(([a]) => a);
  out.push(failed.length ? `Listing check FAILED for ${failed.join(", ")}: the run stops before any batch.` : `Listing check: ${Object.keys(cfg.listing_check ?? {}).length ? "passed for every arm" : "not supplied"}.`);
  const per = cfg.models.map((m: string) => {
    const cells = [c.none, c.gstack, c.rewritten, c.placebo].map((l) => cellLine(recs, m, l, false));
    const elig = (l: string) => recs.filter((r) => r.model === m && r.label === l && r.eligible);
    const opened = (r: Rec) => (r.opens.length ? 1 : 0);
    const pool = [...elig(c.gstack), ...elig(c.placebo)];
    const fitOnly = (xs: Rec[]) => xs.filter((r) => (cfg.fit ?? FIT).includes(r.task));
    const d1Map = perTask(pool, opened);
    const d1 = rate(d1Map);
    const d2 = contrast(perTask(elig(c.rewritten), opened), d1Map);
    return { m, cells, pool, elig, opened, d1, d1Count: pool.filter((r) => r.opens.length).length, d2, flagged: cells.some((x) => !(x.eligibleShare >= 0.9)),
      fit: { d1: rate(perTask(fitOnly(pool), opened)), d2: contrast(perTask(fitOnly(elig(c.rewritten)), opened), perTask(fitOnly(pool), opened), false) },
      d1MapRaw: d1Map, rwMap: perTask(elig(c.rewritten), opened) };
  });
  const adj = holm(per.map((x: any) => x.d2.p));
  per.forEach((x: any, i: number) => {
    out.push("", `## ${x.m}`, ...x.cells.map((cl: any) => cl.text));
    if (x.flagged) out.push("Gate: a cell is under 90% eligible; flagged, no D1 or D2 claim for this model.");
    const bound = zeroBound(x.d1.tasks);
    out.push(`D1 (gstack and placebo pooled, eligible): ${x.d1Count} opened of ${x.pool.length} trials, rate ${ci(x.d1)} over ${x.d1.tasks} tasks` + (x.d1Count === 0 ? `, exact one-sided 95% upper bound ${pct(bound)}` : ""));
    const d1Claim = x.flagged ? "no claim (gate)" : x.d1.lo > 0 ? `claim: opened an untold gstack skill in ${pct(x.d1.point)} of eligible trials` : `claim: fewer than ${pct(x.d1Count === 0 ? bound : x.d1.hi)} (95% upper bound)`;
    out.push(`D1 ${d1Claim}`);
    out.push(`D2 (rewritten minus pooled): ${ci(x.d2, pp)} pp over ${x.d2.tasks} tasks, p ${pv(x.d2.p)}, Holm ${pv(adj[i]!)}`);
    const sig = adj[i]! < 0.05 && (x.d2.lo > 0 || x.d2.hi < 0);
    out.push(`D2 ${x.flagged ? "no claim (gate)" : sig ? `claim: the rewritten description ${x.d2.lo > 0 ? "raised" : "lowered"} opens by ${pp(x.d2.point)} points` : "no claim"}`);
    out.push(`Fit stratum (${x.fit.d1.tasks} tasks, no verdict): D1 ${ci(x.fit.d1)}, D2 ${ci(x.fit.d2, pp)} pp`);
    for (const l of [c.none, c.gstack, c.rewritten, c.placebo]) {
      const e = x.elig(l) as Rec[];
      const op = e.filter((r) => r.opens.length);
      const inv = e.filter((r) => r.loaded.includes("investigate"));
      const counts: Record<string, number> = {};
      for (const r of op) for (const s of new Set(r.opens)) counts[s] = (counts[s] ?? 0) + 1;
      out.push(`${l}: browse ${pct(e.length ? e.filter((r) => r.browses).length / e.length : NaN)}, opened ${op.length}, loaded among opened ${op.length ? pct(op.filter((r) => r.loaded.length).length / op.length) : "n/a"}, ` +
        `plugin-authoring opens ${e.reduce((s, r) => s + r.pluginOpens, 0)}, loaded /investigate ${inv.length} (DEBUG REPORT ${inv.filter((r) => r.markers.debug_report).length}; ` +
        Object.keys(MARKERS).filter((k) => k !== "debug_report").map((k) => `${k} ${inv.filter((r) => r.markers[k]).length}`).join(", ") + `), skills opened ${JSON.stringify(counts)}`);
    }
    const passMap = (l: string, f: (r: Rec) => number = (r) => r.pass) => perTask(recs.filter((r) => r.model === x.m && r.label === l && r.status === "graded"), f);
    for (const l of [c.gstack, c.rewritten, c.placebo]) {
      out.push(`${l} minus none, pass: ${ci(contrast(passMap(l), passMap(c.none), false), pp)} pp; retried-after-response scored 0: ${ci(contrast(passMap(l, (r) => (r.retried ? 0 : r.pass)), passMap(c.none, (r) => (r.retried ? 0 : r.pass)), false), pp)} pp`);
    }
  });
  out.push("", `Pooled across models, equal weight (secondary): D1 ${ci(pooled(per.map((x: any) => x.d1MapRaw)))}; rewritten ${ci(pooled(per.map((x: any) => x.rwMap)))}`);
  out.push("Retried-trial open sensitivity: at Harbor f3a5a923 a retry deletes the first attempt's trial folder, so no first-attempt messages exist and the reading equals the primary one.");
  return out;
}

export const PRIOR = "Prior readings, never pooled: #109 particle-1 -10 [-18, -2], Haiku -5 [-13, +3]; quick look 3 particle-1 +6 [-2, +15], Haiku +0 [-7, +8], DeepSeek -2 [-9, +6].";

export function runT(recs: Rec[], cfg: any): string[] {
  const c = { ...T_CELLS, ...(cfg.cells ?? {}) };
  const out: string[] = ["# Run T: told-text tax", PRIOR];
  const graded = (m: string, l: string, keep: (r: Rec) => boolean = () => true) => recs.filter((r) => r.model === m && r.label === l && r.status === "graded" && keep(r));
  const passMap = (m: string, l: string, keep?: (r: Rec) => boolean, f: (r: Rec) => number = (r) => r.pass) => perTask(graded(m, l, keep), f);
  const lead = cfg.lead ?? "particle-1";
  const per = cfg.models.map((m: string) => {
    const cells = [c.none, c.short, c.placebo].map((l) => ({ l, ...cellLine(recs, m, l, l !== c.none) }));
    const flaggedCells = cells.filter((x) => x.l !== c.none && !(x.bodyLoadShare >= 0.95)).map((x) => x.l);
    return { m, cells, flaggedCells, t2: contrast(passMap(m, c.placebo), passMap(m, c.short)) };
  });
  const adj = holm(per.map((x: any) => x.t2.p));
  per.forEach((x: any, i: number) => {
    out.push("", `## ${x.m}`, ...x.cells.map((cl: any) => cl.text));
    if (x.flaggedCells.length) out.push(`Gate: body load under 95% in ${x.flaggedCells.join(", ")}; flagged, no T1 or T2 claim from it.`);
    if (x.m === lead) {
      const t1 = contrast(passMap(x.m, c.placebo), passMap(x.m, c.none), false);
      const v = t1Verdict(t1);
      out.push(`T1 (placebo minus none): ${ci(t1, pp)} pp over ${t1.tasks} tasks; ${x.flaggedCells.includes(c.placebo) ? "no verdict (gate)" : `verdict ${v.verdict}${v.smallerThanLead ? ", smaller than the lead" : ""}`}`);
    }
    const t2 = x.t2;
    const sig = adj[i]! < 0.05;
    const claim = x.flaggedCells.length ? "no claim (gate)" : sig && t2.hi < 0 ? "claim: longer told text cost passes" : sig && t2.lo > 0 ? "claim: longer told text raised passes" : "no claim";
    out.push(`T2 (placebo minus placebo-short): ${ci(t2, pp)} pp, p ${pv(t2.p)}, Holm ${pv(adj[i]!)}; ${claim}`);
    for (const [a, b] of [[c.placebo, c.none], [c.short, c.none]] as const) {
      const all = contrast(passMap(x.m, a), passMap(x.m, b), false);
      const cc = contrast(passMap(x.m, a, (r) => !r.budgetStop), passMap(x.m, b, (r) => !r.budgetStop), false);
      const stops = contrast(passMap(x.m, a, undefined, (r) => (r.budgetStop ? 1 : 0)), passMap(x.m, b, undefined, (r) => (r.budgetStop ? 1 : 0)), false);
      const rs = contrast(passMap(x.m, a, undefined, (r) => (r.retried ? 0 : r.pass)), passMap(x.m, b, undefined, (r) => (r.retried ? 0 : r.pass)), false);
      out.push(`${a} minus ${b}: pass ${ci(all, pp)} pp; session-cap stop rate ${ci(stops, pp)} pp; complete case (descriptive) ${ci(cc, pp)} pp; retried-after-response scored 0 ${ci(rs, pp)} pp`);
    }
  });
  for (const [a, b] of [[c.placebo, c.none], [c.short, c.none], [c.placebo, c.short]] as const) {
    const diffs = cfg.models.map((m: string) => { const A = passMap(m, a), Bm = passMap(m, b); return new Map([...A].filter(([k]) => Bm.has(k)).map(([k, v]) => [k, v - Bm.get(k)!])); });
    out.push(`Pooled across models, equal weight (secondary): ${a} minus ${b} ${ci(pooled(diffs), pp)} pp`);
  }
  return out;
}

if (import.meta.main) {
  const cfg = JSON.parse(readFileSync(Bun.argv[2]!, "utf8"));
  const { recs, dropped } = loadRun(cfg);
  const lines = cfg.run === "D" ? runD(recs, cfg) : runT(recs, cfg);
  if (dropped.length) lines.push("", `Dropped by the oracle rule: ${dropped.map((d) => `${d.task} (${d.trials} trials, $${d.usd.toFixed(2)})`).join(", ")}`);
  console.log(lines.join("\n"));
}
