// B7, the planning lane's keyless dry run (plan 2026-10-31-geva-79-planning-lane-plan, section 12 and open items 2, 4
// and 7). Fake sessions run through review-units' run loop on a synthetic sealed panel of the B5 panel's shape: 24 seeded
// plans with two flaws each, 2 real-neutral plans with one, 12 decoys (6 core and 6 extension) and 4 pilot units the
// suite leaves out. Their arms then go through blind judging, blind adjudication, ingest, derive and score --expect, for
// every frozen rule and fallback. Keyless; every plan, flaw, finding and ruling here is invented.
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";
import { REPO_ROOT } from "../../src/cli.ts";
import { removeTree } from "../../src/trial/cleanup.ts";
import type { AgentOutcome } from "../../src/trial/trial.ts";
import { PLAN_SEVERITY_MAP } from "../../src/trial/review/plan.ts";
import { armId, runReviewUnits, type PreparedUnit } from "../../src/trial/review/run.ts";
import { buildUnitRepo, buildUnitTree, unitTaskId } from "../../src/trial/review/unit.ts";
import { harness, localSandbox } from "../adapters/harness.ts";
import { cleanup, run, tmp } from "./helpers.ts";
import { PANEL_REPO, planPanel } from "./plan-panel.ts";

const OPUS = "claude-opus-5-5";
const P1 = "particle-ai/particle-1";
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const durable = mkdtempSync(join(REPO_ROOT, ".plan-dryrun-test-"));
afterAll(() => {
  cleanup();
  removeTree(durable);
});

const dir = tmp("noloss-plan-dryrun-");
const panel = planPanel(dir, { seeded: 24, "real-neutral": 2, decoy: 12, pilot: 4 }, { id: "planpanel-r1a-dryrun" });
const S = ["--sealed-root", panel.sealedRoot];
const units = panel.suite.units;
const decoy = (u: (typeof units)[number]) => u.blockers.every((b) => b.counts === "over-blocking");
/** The arms R1a runs (none, gstack, lens on Opus, placebo on particle-1) and a synthetic flag-everything arm. */
const ARMS = [{ name: "none", told: "none" }, { name: "gstack", told: "gstack" }, { name: "lens", told: "lens" }, { name: "placebo", told: "placebo" }, { name: "flagall", told: "none" }] as const;
const ARM_MODELS = { lens: [OPUS], placebo: [P1], flagall: [OPUS] };
/** Each cell's chance of flagging a seeded or real flaw Critical in one pass. */
const RATE: Record<string, number> = { ["none " + OPUS]: 0.3, ["gstack " + OPUS]: 0.65, ["lens " + OPUS]: 0.35, ["none " + P1]: 0.15, ["gstack " + P1]: 0.4, ["placebo " + P1]: 0.15 };
const SECTIONS = [["Problem", 3], ["Users", 6], ["Scope", 9], ["Success measure", 12]] as const;
const draw = (...parts: unknown[]) => parseInt(createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 8), 16) / 0x100000000;
const id = (arm: string, model: string) => armId(arm, model);
/** Item 2's failed passes: each scores as finding nothing with a note, and none stops its arm. */
const FAILED: Record<string, { arm: string; model: string; pass: number; kind: "malformed" | "timeout" | "missing" }> = {
  [units[4]!.id]: { arm: "gstack", model: OPUS, pass: 2, kind: "malformed" },
  [units[6]!.id]: { arm: "gstack", model: OPUS, pass: 3, kind: "timeout" },
  [units[8]!.id]: { arm: "lens", model: OPUS, pass: 1, kind: "missing" },
};
const fence = (items: unknown) => "```plan-findings\n" + JSON.stringify(items, null, 2) + "\n```";

/** One fake session's reply: a Critical finding for each flaw the cell catches this pass; flagall flags every section. */
function reply(arm: string, model: string, unitId: string, pass: number): { turns: string[]; timeout: boolean } {
  const u = units.find((x) => x.id === unitId)!;
  const failed = FAILED[unitId];
  if (failed && failed.arm === arm && failed.model === model && failed.pass === pass) {
    if (failed.kind === "missing") return { turns: ["I read the plan and found nothing to report."], timeout: false };
    if (failed.kind === "timeout") return { turns: ["Reading the plan."], timeout: true };
    return { turns: [fence([{ severity: "P0", section: "Problem", line: 3, claim: "x", evidence: "", fix: "" }])], timeout: false };
  }
  const finding = (section: string, line: number, k: number) => ({ severity: "Critical", section, line, claim: "The " + section.toLowerCase() + " part of this plan does not follow from its context (" + k + ").", evidence: "context/goals.md", fix: "Rewrite the " + section.toLowerCase() + " part from the context." });
  if (arm === "flagall") return { turns: [fence(SECTIONS.map(([s, l], k) => finding(s, l, k + 1)))], timeout: false };
  const named = (b: (typeof u.blockers)[number], k: number, severity: string) => ({ ...finding(SECTIONS.find(([, l]) => l === b.line)![0], b.line, k + 1), severity });
  const flaws = decoy(u) ? [] : u.blockers;
  const caught = flaws.filter((b) => draw(arm, model, u.pr, pass, b.id) < RATE[arm + " " + model]!);
  const noted = flaws.filter((b) => !caught.includes(b) && draw(arm, model, u.pr, pass, b.id, "medium") < 0.25);
  return { turns: ["Mode: HOLD SCOPE; approved decisions: none.", fence([...caught.map((b, k) => named(b, k, "Critical")), ...noted.map((b, k) => named(b, caught.length + k, "Medium"))])], timeout: false };
}

describe("B7: the R1a frozen rules, keyless, on the B5 panel's shape", () => {
  // Value: protects=every frozen R1a rule and fallback runs from fake sessions through the run loop, blind judging, adjudication, ingest, derive and score --expect on the panel's shape before the prereg freezes it; fails_when=a plan arm's output cannot reach a verdict, a failed pass stops its arm, a cell admits a second model, the gate passes a flag-everything arm, or a fallback (dropped units, 6 decoys, first-k, any severity, dropped rung, stopped arm) stops scoring; seam=runReviewUnits and the noloss CLI; no_claim=Claude Code, the Docker rig and real judges
  const out = join(durable, "run");
  const raw = join(dir, "raw");
  const judged = join(dir, "judged");
  const adjudicated = join(dir, "adjudicated");
  const root = join(dir, "arms");
  const bound: string[][] = [];
  const cells = [...ARMS.flatMap((a) => (ARM_MODELS[a.name as keyof typeof ARM_MODELS] ?? [OPUS, P1]).map((m) => id(a.name, m)))];
  const armDir = (r: string, a: string) => join(r, panel.suite.id, a);
  const save = (name: string, value: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(value));
    return p;
  };

  test("fake sessions run through the run loop: no second model, failed passes as misses, every arm complete", async () => {
    const h = harness(() => [{ type: "text", text: "ok" }]);
    const slots = new Map<string, { arm: string; model: string; task: string; pass: number }>();
    const prepared: PreparedUnit[] = units.map((u) => {
      const unit = { id: u.id, repo: PANEL_REPO, pr: u.pr, head: u.head, base: u.base };
      const repo = buildUnitRepo({ unit, source: panel.clone, dest: join(dir, "repos", String(u.pr)), baseBranch: "main" });
      const tree = buildUnitTree({ repo, task: unitTaskId(unit), dest: join(dir, "trees", String(u.pr)), image: "unused", test: null, install: null, scratch: join(dir, "scratch") });
      return { unit, task: unitTaskId(unit), base_branch: "main", merge_base: repo.merge_base, tree: tree.dir, tree_sha256: tree.tree_sha256, instructions: repo.instructions, check: null };
    });
    const unitOf = new Map(prepared.map((p) => [p.task, p.unit.id]));
    const home = join(dir, "gstack-home");
    for (const d of ["bin", "scripts"]) mkdirSync(join(home, ".claude", "skills", "gstack", d), { recursive: true });
    writeFileSync(join(home, ".claude", "skills", "gstack", "scripts", "question-registry.ts"), "  'plan-ceo-review-mode': { id: 'plan-ceo-review-mode' },\n");
    const bare = (name: string) => ({ tree_sha256: name + "-tree", skill: null, gstack: null, plugins: [] });
    const rig: HostRig = {
      baseUrl: h.baseUrl, network: null, imageDigest: null,
      bind: async (request) => {
        const b = h.proxy.bind(request);
        slots.set(b.slot, { arm: request.cell.arm, model: request.cell.model, task: request.cell.task, pass: request.cell.trial });
        bound.push(request.models);
        return b;
      },
      finalize: (m) => h.proxy.finalize(m),
      arms: { none: bare("none"), lens: bare("lens"), placebo: bare("placebo"), flagall: bare("flagall"), gstack: { tree_sha256: "gstack-tree", skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], layers: [{ src: home, dest: "" }] } },
      cells: { gstack: Object.fromEntries([OPUS, P1].map((m) => [m, { cell: { model: m, voice: null }, layer: null, gstack_config: { agent_model: "host", codex_reviews: "disabled" }, codex: null, tree_sha256: "gstack-" + m }])) },
      sandbox: () => localSandbox(() => {}),
      judgeSandbox: () => localSandbox(() => {}),
      egress: () => ({ open: false, detail: "test rig" }),
      close: async () => ({ committed: 0, unknown: 0, lease_id: null }),
      recovery: null,
      driver: (o) => ({
        async run(_session, task): Promise<AgentOutcome> {
          mkdirSync(o.out, { recursive: true });
          writeFileSync(join(o.out, "transcript.ndjson"), JSON.stringify({ type: "system", subtype: "init" }) + "\n");
          const s = slots.get(o.proxy.slot)!;
          const r = reply(s.arm, s.model, unitOf.get(task.id)!, s.pass);
          return { turns: r.turns, termination: { kind: r.timeout ? "timeout" : "completed" }, model_output: true, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: r.turns.length, loaded_bytes: null };
        },
      }),
    };
    try {
      const r = await runReviewUnits({ host: "claude", suite: { id: panel.suite.id, sha256: null }, units: prepared, arms: ARMS.map((a) => ({ ...a })), models: [OPUS, P1], armModels: ARM_MODELS, passes: 3, parallel: 8, timeoutS: 120, cap: 50_000_000, runId: "plan-dryrun", out, date: "2026-10-31", policy, keyBase: { image_digest: null, recipe: "test", host_version: null, adapter_sha256: "test", isolation: "process" }, journal: null, plan: { lens: "ceo" }, severityMap: Object.fromEntries(ARMS.map((a) => [a.name, PLAN_SEVERITY_MAP])), env: {} }, rig);
      expect(r.stops).toEqual([]);
    } finally {
      h.proxy.stop();
    }
    expect(bound.length).toBe(units.length * 3 * cells.length);
    expect(bound.every((m) => m.length === 1)).toBe(true);
    expect(readdirSync(join(out, "arms")).sort()).toEqual([...cells].sort());
    for (const c of cells) {
      const arm = JSON.parse(readFileSync(join(out, "arms", c, "arm.json"), "utf8"));
      expect([c, arm.status, arm.coverage_gaps, arm.models.map((m: { role: string }) => m.role)]).toEqual([c, "complete", undefined, ["driver"]]);
      expect((await run(["ingest", join(out, "arms", c), "--suite", panel.stubPath, "--root", raw, ...S])).code).toBe(0);
    }
    const diag = (c: string) => JSON.parse(readFileSync(join(out, "arms", c, "arm.json"), "utf8")).diagnostics;
    const [u5, u7, u9] = Object.keys(FAILED);
    expect(diag(id("gstack", OPUS))).toEqual([u5 + " pass 2: malformed, item 0: severity is not Critical, High, Medium or Low; scored as finding nothing", u7 + " pass 3: missing; ended timeout in turn 1, settled spend $0.000000, scored as finding nothing"]);
    expect(diag(id("lens", OPUS))).toEqual([u9 + " pass 1: missing; scored as finding nothing"]);
    expect(cells.filter((c) => diag(c))).toEqual([id("gstack", OPUS), id("lens", OPUS)]);
  }, 300_000);

  type Key = { batch: string; packets: Array<{ file: string; sha256: string }> };
  type Packet = { blockers?: Array<{ id: string; line: number }>; findings: Array<{ id: string; line: number }> };
  /** Joins one batch: the primary reply, then the second judge (and a third read, if named) on the set judge-join names. */
  async function joinBatch(keyPath: string, packets: string, arms: string[], outDir: string, answer: (p: Packet) => Array<{ id: string; [k: string]: unknown }>, item: "blockers" | "findings") {
    const key = JSON.parse(readFileSync(keyPath, "utf8")) as Key;
    const all = key.packets.map((p) => ({ p, items: answer(JSON.parse(readFileSync(join(packets, p.file), "utf8")) as Packet) }));
    const body = (judge: string, only?: Set<string>) => ({ batch: key.batch, judge, packets: all.map(({ p, items }) => ({ file: p.file, sha256: p.sha256, [item]: items.filter((x) => !only || only.has(p.file + " " + x.id)) })).filter((p) => (p[item] as unknown[]).length) });
    const named = (text: string) => new Set([...text.matchAll(/(packets\/\S+\.json) ([BF]\d+)/g)].map((m) => m[1] + " " + m[2]));
    const args = ["judge-join", "--suite", panel.stubPath, "--key", keyPath, "--out", outDir, ...arms.flatMap((a) => ["--arm", a]), ...S];
    const replies = ["--reply", save(item + "-primary.json", body("judge one"))];
    let r = await run([...args, ...replies]);
    for (const [flag, judge] of [["--second", "judge two"], ["--third", "judge three"]] as const) {
      if (r.code === 0) break;
      expect(r.err).toMatch(/E_NOLOSS_BLIND scoring waits for the (second judge|third read)/);
      replies.push(flag, save(item + flag + ".json", body(judge, named(r.err))));
      r = await run([...args, ...replies]);
    }
    expect([r.code, r.err]).toEqual([0, ""]);
    return r.out;
  }

  test("blind judging and blind adjudication join for every arm at once", async () => {
    const keyPath = join(dir, "key.json");
    const packets = join(dir, "packets");
    const p = await run(["judge-packet", "--suite", panel.stubPath, ...cells.flatMap((c) => ["--arm", armDir(raw, c)]), "--seed", "7", "--out", packets, "--key", keyPath, "--source", PANEL_REPO + "=" + panel.clone, ...S]);
    expect([p.code, p.err]).toEqual([0, ""]);
    const joined = await joinBatch(keyPath, packets, cells.map((c) => armDir(raw, c)), judged, (pk) => pk.blockers!.map((b) => ({ id: b.id, matches: pk.findings.filter((f) => f.line === b.line).map((f) => f.id) })), "blockers");
    expect(joined).toContain("wrote judgments for " + cells.join(", "));
    expect(joined).toContain("third read on 0");
    const adjKey = join(dir, "adj-key.json");
    const adjPackets = join(dir, "adj-packets");
    const a = await run(["judge-packet", "--suite", panel.stubPath, ...cells.flatMap((c) => ["--arm", join(judged, c)]), "--seed", "8", "--out", adjPackets, "--key", adjKey, "--adjudicate", "--source", PANEL_REPO + "=" + panel.clone, ...S]);
    expect([a.code, a.err]).toEqual([0, ""]);
    expect(await joinBatch(adjKey, adjPackets, cells.map((c) => join(judged, c)), adjudicated, (pk) => pk.findings.map((f) => ({ id: f.id, ruling: "not-defect" })), "findings")).toContain("wrote adjudication.tsv for " + cells.join(", "));
    for (const c of cells) expect((await run(["ingest", join(adjudicated, c), "--suite", panel.stubPath, "--root", root, ...S])).code).toBe(0);
  }, 300_000);

  const cmp = (variant: string, reference: string) => ({ id: variant + "-vs-" + reference, variant, reference, margin_points: 10, margin_reason: "dry run", post_hoc: false, frozen_bar: null, false_alarm_gate: { margin_per_decoy: 1 } });
  const family = (name: string, pairs: Array<[string, string]>, suite = panel.suite.id) => {
    const comparisons = pairs.map(([v, r]) => cmp(v, r));
    return save(name + ".json", { schema_version: 1, suite, decision_rule: "dry run", seed: 1, draws: 2000, comparisons, loss_family: { order: comparisons.map((c) => c.id), null: "zero", reason: "dry run" } });
  };
  const score = (file: string, v: string, r: string, extra: string[] = [], suite = panel.stubPath, armsRoot = root) => run(["score", "--suite", suite, "--root", armsRoot, "--prereg", file, "--variant", v, "--reference", r, ...S, ...extra]);

  const primary = () => family("primary", [[id("none", OPUS), id("gstack", OPUS)], [id("gstack", OPUS), id("none", OPUS)]]);
  const secondary = () => family("secondary", [[id("none", P1), id("gstack", P1)], [id("none", OPUS), id("lens", OPUS)], [id("none", P1), id("placebo", P1)]]);
  const gate = () => family("gate", [[id("none", OPUS), id("flagall", OPUS)]]);
  const expectRun = async (outcome: string, file: string, v: string, r: string, suite = panel.stubPath, armsRoot = root) => {
    const s = await score(file, v, r, [], suite, armsRoot);
    expect([v + " vs " + r, (await score(file, v, r, ["--expect", outcome], suite, armsRoot)).code]).toEqual([v + " vs " + r, 0]);
    return s.out;
  };
  const derive = async (name: string, file: string, extra: string[]) => {
    const out = join(dir, "derived", name);
    const d = await run(["derive", "--suite", panel.stubPath, "--comparisons", file, "--root", root, "--id", name, "--out", out, ...extra, ...S]);
    expect([d.code, d.err]).toEqual([0, ""]);
    return { out: d.out, suite: join(out, name + ".json"), root: join(out, "arms"), file: join(out, "comparisons." + name + ".json") };
  };

  test("the primary family (none and gstack on Opus, both directions) and the secondary family (each other arm vs none), Holm-adjusted", async () => {
    const one = await expectRun("LOSS", primary(), id("none", OPUS), id("gstack", OPUS));
    expect(one).toContain("on 50 blockers in 26 PRs");
    expect(one).toMatch(/\(Holm [0-9.e-]+, step 1 of 2 in the declared LOSS family\)/);
    expect(one).toContain("on 12 decoys; gstack-opus's excess 0.00 [95% CI 0.00, 0.00]: PASS.");
    expect(one).toContain('claim "gstack-opus catches more of these blockers than none-opus": may be made.');
    expect(await expectRun("NOLOSS_UNDERPOWERED", primary(), id("gstack", OPUS), id("none", OPUS))).toContain("step 2 of 2 in the declared LOSS family");
    expect(await expectRun("LOSS", secondary(), id("none", P1), id("gstack", P1))).toContain("step 1 of 3 in the declared LOSS family");
    expect(await expectRun("NOT_DISTINGUISHED", secondary(), id("none", OPUS), id("lens", OPUS))).toContain("over 3");
    expect(await expectRun("NOT_DISTINGUISHED", secondary(), id("none", P1), id("placebo", P1))).toContain("step 3 of 3 in the declared LOSS family");
  });

  test("a flag-everything arm wins on recall and fails the decoy-only gate, on all 12 decoys and on the core 6 (open item 7)", async () => {
    const all = await expectRun("FALSE_ALARM_GATE_FAIL", gate(), id("none", OPUS), id("flagall", OPUS));
    expect(all).toContain("Blocking recall ");
    expect(all).toContain("must-fix false alarms per decoy per pass flagall-opus 4.00, none-opus 0.00 on 12 decoys; flagall-opus's excess +4.00 [95% CI +4.00, +4.00]: FAIL.");
    const core = await derive("planpanel-r1a-d6", gate(), units.filter(decoy).slice(6).flatMap((u) => ["--drop", u.id]));
    expect(core.out).toContain("32 units, 50 blocking blockers on 26 PRs; 6 units dropped");
    expect(await expectRun("FALSE_ALARM_GATE_FAIL", core.file, id("none", OPUS), id("flagall", OPUS), core.suite, core.root)).toContain("flagall-opus 4.00, none-opus 0.00 on 6 decoys");
  });

  test("missing cells: failed passes scored as misses keep a verdict, derive drops their units for the sensitivity reading, and --prereg must name the scored suite", async () => {
    const x3 = await derive("planpanel-r1a-x3", primary(), Object.keys(FAILED).flatMap((u) => ["--drop", u]));
    expect(x3.out).toContain("35 units, 44 blocking blockers on 23 PRs; 3 units dropped");
    expect(await expectRun("LOSS", x3.file, id("none", OPUS), id("gstack", OPUS), x3.suite, x3.root)).toContain("on 44 blockers in 23 PRs");
    const wrong = await score(primary(), id("none", OPUS), id("gstack", OPUS), [], x3.suite, x3.root);
    expect([wrong.code, wrong.err.split("\n")[0]]).toEqual([2, "E_USAGE --prereg is for suite planpanel-r1a-dryrun, not planpanel-r1a-x3"]);
  });

  test("the volume-matched reading (first 1 must-fix finding) and the any-severity fallback agree in sign", async () => {
    const k1 = await derive("planpanel-r1a-k1", primary(), ["--first-k", "1"]);
    expect(await expectRun("LOSS", k1.file, id("none", OPUS), id("gstack", OPUS), k1.suite, k1.root)).toContain("on 50 blockers in 26 PRs");
    const any = save("any-severity.json", Object.fromEntries(ARMS.map((a) => [a.name, { default: { Critical: "CRITICAL", High: "CRITICAL", Medium: "CRITICAL", Low: "CRITICAL" } }])));
    const sev = await derive("planpanel-r1a-any", primary(), ["--severity-map", any]);
    expect(sev.out).toContain("re-map severity with any-severity.json");
    const plain = JSON.parse((await score(primary(), id("none", OPUS), id("gstack", OPUS), ["--json"])).out).result;
    const anySev = JSON.parse((await score(sev.file, id("none", OPUS), id("gstack", OPUS), ["--json"], sev.suite, sev.root)).out).result;
    expect([anySev.verdict, anySev.recall.variant > plain.recall.variant, anySev.recall.reference > plain.recall.reference]).toEqual(["LOSS", true, true]);
  });

  test("a dropped particle-1 rung refuses the full secondary file, and the Opus-only file's family of one turns lens's NOT_DISTINGUISHED into LOSS; a stopped arm gives no verdict and keeps its Holm step", async () => {
    const opus = join(dir, "arms-opus");
    for (const c of cells.filter((c) => !c.endsWith("particle-1"))) cpSync(armDir(root, c), armDir(opus, c), { recursive: true });
    expect((await score(secondary(), id("none", OPUS), id("lens", OPUS), ["--expect", "E_NOLOSS_ARM"], panel.stubPath, opus)).code).toBe(0);
    expect(await expectRun("LOSS", family("secondary-opus", [[id("none", OPUS), id("lens", OPUS)]]), id("none", OPUS), id("lens", OPUS), panel.stubPath, opus)).toContain("step 1 of 1 in the declared LOSS family");
    const r5 = join(dir, "arms-r5");
    for (const c of cells.filter((c) => c !== id("lens", OPUS))) cpSync(armDir(root, c), armDir(r5, c), { recursive: true });
    const lens = join(dir, "lens-stopped");
    cpSync(join(adjudicated, id("lens", OPUS)), lens, { recursive: true });
    writeFileSync(join(lens, "arm.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(lens, "arm.json"), "utf8")), status: "stopped", coverage_gaps: [units[10]!.id + " pass 3: not run (cap stop)"] }, null, 2) + "\n");
    expect((await run(["ingest", lens, "--suite", panel.stubPath, "--root", r5, ...S])).code).toBe(0);
    expect(await expectRun("NO_VERDICT", secondary(), id("none", OPUS), id("lens", OPUS), panel.stubPath, r5)).toContain("(Holm n/a, step 3 of 3 in the declared LOSS family)");
    expect(await expectRun("LOSS", secondary(), id("none", P1), id("gstack", P1), panel.stubPath, r5)).toContain("step 1 of 3 in the declared LOSS family");
  });

  test("power on the panel's shape at the primary family's strictest Holm step, with plan-shared dependence", async () => {
    const p = await run(["power", "--suite", panel.stubPath, "--passes", "3", "--recall", "0.35", "--margin", "10", "--loss", "20", "--alpha", "0.025", "--dependence", "0.3", "--sims", "400", ...S]);
    expect([p.code, p.out]).toEqual([0, expect.stringContaining("| planpanel-r1a-dryrun | 26 | 50 | 3 |")]);
  });
});
