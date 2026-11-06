// Copyright (c) 2026 Garry Tan. MIT License.
// Fixtures for the tbv scorer tests. They drive lanes/tbv/rule.ts through its command line, the way the frozen dry run
// drove tbv-rule.ts, so the same tests run against the port and the head.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RULE = join(import.meta.dir, "../../lanes/tbv/rule.ts");
const DIR = mkdtempSync(join(tmpdir(), "tbv-rule-test-"));
const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD)_API_KEY$/.test(k))) as Record<string, string>;
let n = 0;

/** The seeded double-read draw as section 7 and the build plan state it: FNV-1a over "tbv-double|20261105|<label>", picked under 0.2. */
export function picked(label: string) {
  let h = 0x811c9dc5;
  for (const c of "tbv-double|20261105|" + label) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 100000) / 100000 < 0.2;
}
/** A reading label the draw picks (want true) or passes over (want false). */
export function label(base: string, want: boolean) { let k = 0; while (picked(base + "-" + k) !== want) k++; return base + "-" + k; }

export type Any = Record<string, any>;
export function rule(cmd: string, data: unknown, split?: unknown) {
  const f = join(DIR, cmd + "-" + ++n + ".json");
  writeFileSync(f, JSON.stringify(data));
  const args = [RULE, cmd, f];
  if (split !== undefined) { const s = f + ".split.json"; writeFileSync(s, typeof split === "string" ? split : JSON.stringify(split)); args.push("--split", s); }
  const r = spawnSync("bun", args, { encoding: "utf8", env: KEYLESS, maxBuffer: 1 << 26 });
  const verdict = (r.stdout.split("\n").find((l) => l.startsWith("Verdict: ")) ?? "").slice(9);
  return { status: r.status, out: r.stdout, err: r.stderr, verdict, refused: r.status === 2 && r.stderr.startsWith("E_USAGE") };
}
export const line = (o: string, re: RegExp) => o.split("\n").find((l) => re.test(l)) ?? "";

export const task = (id: string, source: "A" | "B", stratum = "long", nfacts = 3, x: Any = {}) => ({ id, cluster: id, source, stratum, nfacts, ...x });
let resp = 0;
/** One scored reading with head-shape fields; the first round(rate * nfacts) facts are disclosed. second: true adds an agreeing second read by the other judge and a label the draw picks. */
export function reading(t: Any, arm: string, model: string, pass: number, rate = 0.5, x: Any = {}) {
  const k = Math.round(rate * t.nfacts);
  const facts = [...Array(t.nfacts)].map((_, i) => ({ in: i < k, any: i < k }));
  const judge = model === "opus" ? "sol" : "opus";
  const { second, ...rest } = x;
  const family = rest.family ?? t.family ?? (t.source === "A" ? "investigate" : "ship");
  const r: Any = { id: label([t.id, family, arm, model, pass].join("."), !!second), task: t.id, family, arm, model, pass, status: "scored", judge, facts, unsupported: 0, exposed: arm === "none" || arm === "lens" ? null : true, words: 150, usd: 0.3, cacheRead: 0.8, responseIds: ["msg_" + ++resp], maxTokens: [] };
  if (t.stratum === "short") r.shortShare = rate;
  if (second) r.second = { judge: judge === "sol" ? "opus" : "sol", status: "judged", facts: facts.map((f) => ({ ...f })), responseIds: ["msg_" + ++resp] };
  return Object.assign(r, rest);
}
export function controls(ts: Any[], o: { skip?: string } = {}) {
  return ts.flatMap((t) => ["sol", "opus"].flatMap((judge) => (["stock", "oracle"] as const).filter((kind) => o.skip !== t.id + ":" + kind + ":" + judge).map((kind) => ({ task: t.id, kind, judge, status: "judged", facts: [...Array(t.nfacts)].map(() => ({ in: kind === "oracle", any: kind === "oracle" })), responseIds: ["msg_" + ++resp] }))));
}
/** A readings file and its split manifest; the plan's taskIds, controlTaskIds and manifestSha256 come from the manifest. */
export function file(stage: "hr" | "dev" | "held", ts: Any[], readings: Any[], o: { controls?: Any[]; controlTaskIds?: string[]; models?: string[]; passes?: number; capyPasses?: number; skillArms?: string[]; manifestTasks?: Any[]; plan?: Any } = {}) {
  const controlTaskIds = o.controlTaskIds ?? (stage === "hr" ? ts.filter((t) => t.stratum !== "clean").map((t) => t.id) : []);
  const manifest = { schema: "tbv-split.v1", stage, tasks: o.manifestTasks ?? ts, controlTaskIds };
  const text = JSON.stringify(manifest);
  const models = o.models ?? ["opus"];
  const plan = { models, passes: Object.fromEntries(models.map((m) => [m, o.passes ?? (stage === "hr" ? 3 : 2)])), capyPasses: o.capyPasses ?? 2, skillArms: o.skillArms ?? (stage === "hr" ? ["none"] : ["none", "current", "principle"]), taskIds: ts.map((t) => t.id), controlTaskIds, manifestSha256: createHash("sha256").update(text).digest("hex"), ...o.plan };
  return { data: { stage, tasks: ts, readings, ...(o.controls ? { controls: o.controls } : {}), plan } as Any, split: text };
}

/** A stage 1 file that reads HEADROOM at the head: 20 non-clean tasks, Opus none on three passes at recall 0.5, every third reading double read and agreeing, full controls. */
export function stage1(mutate: (rs: Any[], ts: Any[]) => void = () => {}) {
  const ts = [...Array(20)].map((_, i) => task("t" + i, i < 10 ? "A" : "B", ["long", "short", "other"][i % 3]!, 4));
  const rs = ts.flatMap((t, i) => [1, 2, 3].map((p) => reading(t, "none", "opus", p, 0.5, { second: (i + p) % 3 === 0 })));
  mutate(rs, ts);
  return file("hr", ts, rs, { controls: controls(ts) });
}

/** A dev file on Opus: n source A tasks, one pass, arms none, current and principle; every fourth task double read. */
export function dev(n = 20, mutate: (rs: Any[], ts: Any[]) => void = () => {}, o: { rates?: Record<string, number>; tasks?: Any[] } = {}) {
  const ts = o.tasks ?? [...Array(n)].map((_, i) => task("t" + i, "A", ["long", "short", "other"][i % 3]!, 4));
  const rate = o.rates ?? { none: 0.25, current: 0.5, principle: 0.75 };
  const rs = ts.flatMap((t, i) => ["none", "current", "principle"].map((arm) => reading(t, arm, "opus", 1, rate[arm], { second: i % 4 === 0 })));
  mutate(rs, ts);
  return file("dev", ts, rs, { passes: 1 });
}
