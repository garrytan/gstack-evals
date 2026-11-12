// Value: protects=the readings' commands: each reads its inputs from sealed paths outside the repo, writes its reading once, and refuses with a reason code, so a paid stage reads the frozen rules and nothing else.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, recordApproval, reconcileLease } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import { ITEMS } from "../../../lanes/office-hours-founder/dryrun.ts";
import { MODELS } from "../../../lanes/office-hours-founder/frozen.ts";
import { freezeManifest } from "../../../lanes/office-hours-founder/run/manifest.ts";
import type { PacketMap, PacketMeta } from "../../../lanes/office-hours-founder/score/packets.ts";
import { PRODUCTION_LABEL } from "../../../lanes/office-hours-founder/score/score.ts";
import { itemCaps, makeCommands } from "../../../lanes/office-hours-founder/read/cli.ts";
import type { Python } from "../../../lanes/office-hours-founder/read/projection.ts";
import { COMPARISON, stage1Fixture, stage2Fixture, unitMeta } from "../../../lanes/office-hours-founder/read/seams.ts";
import { manifest } from "../../../lanes/office-hours-founder/read/stage2.ts";
import type { ModelId } from "../../../lanes/office-hours-founder/types.ts";

const root = mkdtempSync(join(tmpdir(), "of-read-cli-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let calls = 0;
const python: Python = (_p, stdin) => {
  calls++;
  return JSON.stringify((JSON.parse(stdin) as unknown[]).map(() => ({ w: 0.13, guard: 0.14 })));
};
const cmds = makeCommands({ python });
async function run(name: string, argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await cmds[name]!.run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, { GSTACK_EVALS_LEDGER_RECORD: join(root, "record") });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const file = (name: string, text: string) => {
  const p = join(root, name);
  writeFileSync(p, text);
  return p;
};
const lines = (xs: readonly unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";

const s1 = stage1Fixture();
const unitsDir = join(root, "units");
for (const u of [...s1.units, ...COMPARISON.map((id) => unitMeta(id)), unitMeta("r01", { stratum: "real", set: "real" })]) {
  mkdirSync(join(unitsDir, u.id), { recursive: true });
  writeFileSync(join(unitsDir, u.id, "unit.json"), JSON.stringify(u));
}
const scored1 = file("scored1.ndjson", lines([...s1.sessions, ...s1.smoke]));
const stock1 = file("stock1.ndjson", lines(s1.stock));
const ref = (model: ModelId, k: number) => ({ kind: "session" as const, unit: "c01", session: { stage: 1 as const, kind: "arm" as const, unit: "x" + k, model, arm: "none" as const, pass: 1 } });
const packet = (id: string, role: PacketMeta["role"], model: ModelId, blocks: PacketMeta["blocks"], gold?: PacketMeta["gold"]): PacketMeta => ({ id, role, stage: role === "gold" ? 2 : 1, unit: "c01", blocks_unit: "c01", model, judges: [], prompt: "brief", doubt: false, blocks, ...(gold ? { gold } : {}) });
const blocks = (prefix: string, model: ModelId) => Object.fromEntries(Array.from({ length: 40 }, (_, k) => [prefix + k, ref(model, k)]));
const near = (model: ModelId) => Object.fromEntries(Array.from({ length: 5 }, (_, k) => ["n" + model + k, { kind: "near-miss" as const, unit: "c01", near: "wedge-only" as const, expect: { customer: false, wedge: true } }]));
const prodMap: PacketMap = { version: 1, kind: "label", stage: 1, seed: 1, packets: Object.fromEntries(MODELS.flatMap((m) => [["p" + m, packet("p" + m, "label", m, blocks("b" + m, m))], ["a" + m, packet("a" + m, "anchor", m, near(m))]])) };
const checkMap: PacketMap = { version: 1, kind: "check", stage: 1, seed: 1, packets: Object.fromEntries(MODELS.map((m) => ["k" + m, packet("k" + m, "check", m, blocks("q" + m, m))])) };
const cells = (packet: string, block: string, judge: string, customer: boolean, wedge: boolean) => ({ packet, block, judge, customer, wedge, multi_target: false, next: null, alt: null, doubt: null });
const checkLabels = file("check-labels.ndjson", lines(MODELS.flatMap((m) => Object.keys(checkMap.packets["k" + m]!.blocks).flatMap((b) => ["astra", "opus"].map((j) => cells("k" + m, b, j, true, false))))));
const prodLabels = file("labels.ndjson", lines(MODELS.flatMap((m) => [...Object.keys(prodMap.packets["p" + m]!.blocks).map((b) => cells("p" + m, b, PRODUCTION_LABEL[m], true, false)), ...Object.keys(prodMap.packets["a" + m]!.blocks).map((b) => cells("a" + m, b, PRODUCTION_LABEL[m], false, true))])));
const prodMapFile = file("map.json", JSON.stringify(prodMap));
const checkMapFile = file("check-map.json", JSON.stringify(checkMap));
const stage1Args = (out: string, audit = file("audit-pass.json", JSON.stringify({ read: "pass" }))) => ["--units-dir", unitsDir, "--scored", scored1, "--stock", stock1, "--audit", audit, "--map", prodMapFile, "--labels", prodLabels, "--check-map", checkMapFile, "--check-labels", checkLabels, "--out", out];

describe("of stage1", () => {
  test("reads section 10 in order from the command's inputs and writes stage1.json once", async () => {
    const r = await run("stage1", stage1Args(join(root, "s1")));
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("band: HEADROOM");
    expect(r.out).toContain("judge check, Astra on Opus blocks: pass, kappa 1 overall and 1 on real blocks, near-miss 1, gold 40 credited and 40 not from 40 blocks");
    expect(r.out).toContain("stage 2 may start: yes");
    const written = JSON.parse(readFileSync(join(root, "s1", "stage1.json"), "utf8"));
    expect(written.reading.ready).toBe(true);
    const again = await run("stage1", stage1Args(join(root, "s1")));
    expect(again.code).toBe(2);
    expect(again.err).toStartWith("E_USAGE of stage1: ");
    expect(again.err).toContain("written once");
  });
  test("a re-smoke round is told apart by its repair, and an unlabelled gold cell counts as unlabelled", async () => {
    const opusSmoke = s1.smoke.filter((s) => s.model === "opus");
    const scored = file("scored-resmoke.ndjson", lines([...s1.sessions, ...s1.smoke.map((s) => (s.model === "opus" ? { ...s, end: "no-block", W: 0 } : s)), ...opusSmoke.map((s) => ({ ...s, repairs: ["forced-line"] }))]));
    const args = stage1Args(join(root, "s1-resmoke"));
    args[args.indexOf("--scored") + 1] = scored;
    const r = await run("stage1", args);
    expect(r.out).toContain("smoke, Opus: pass after repair (repairs: forced sentence)");
  });
  test("refuses an out dir inside the repo, a stage 2 audit outcome, and a duplicate session", async () => {
    const inside = await run("stage1", stage1Args("lanes/office-hours-founder/read/out"));
    expect(inside.err).toStartWith("E_USAGE of stage1: ");
    expect(inside.err).toContain("inside the repo");
    const voided = await run("stage1", stage1Args(join(root, "s1-void"), file("audit-void.json", JSON.stringify({ read: "void", code: "E_OF_SIM_AUDIT", detail: "x" }))));
    expect(voided.err).toContain("stage 2 outcome");
    const args = stage1Args(join(root, "s1-dup"));
    args.splice(args.indexOf("--scored") + 2, 0, "--scored", scored1);
    expect((await run("stage1", args)).err).toContain("two sessions for");
  });
});

const approvals = file("approvals.md", "# Caps\n\n## Item caps\n\n" + ITEMS.map((i) => "- " + i + " $1,000").join("\n") + "\n\n## Notes\nnone\n");
describe("of projection", () => {
  const record = join(root, "record");
  recordApproval(record, { action: "init", item: "of-s1-labels", cap_micros: 10_000_000, quotes: [{ words: "test ledger, not an approval", by: "test", source: "tests/of/read/cli.test.ts" }], admission: "warn" });
  const local = openLocalLedger(ledgerPath(join(root, "ledger.sqlite"), {}));
  const lease = openLease(record, local, { item: "of-s1-labels", run_id: "labels" }).lease_id;
  local.close();
  reconcileLease(record, { lease_id: lease, spent_micros: 6_000_000, quotes: [{ words: "test spend", by: "test", source: "tests/of/read/cli.test.ts" }], source: approvals, now: new Date(Date.now() + 365 * 864e5) });
  const args = (out: string, extra: string[] = []) => ["--units-dir", unitsDir, "--scored", scored1, "--map", prodMapFile, "--approvals", approvals, "--ceiling", "100000", "--out", out, ...extra];
  test("re-estimates, reruns power.py, projects every item and writes the allowances run --allowances reads", async () => {
    calls = 0;
    const r = await run("projection", args(join(root, "proj"), ["--extra", "of-s2-audit=40"]));
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(calls).toBe(1);
    expect(r.out).toContain("Opus: control 0.375");
    expect(r.out).toContain("guard-rule MDD 0.14");
    expect(r.out).toContain("item of-pitch-labels: spent 0");
    expect(r.out).toContain("item of-s1-labels: spent 6,");
    expect(r.out).toContain("item of-s2-audit: spent 0, projected 40, cap 1000");
    expect(r.out).toContain("stage 2 may start on the projection: yes");
    const p = JSON.parse(readFileSync(join(root, "proj", "projection.json"), "utf8"));
    expect(p.packet_usd).toBe(1);
    expect(p.money.cuts).toEqual([]);
    const a = JSON.parse(readFileSync(join(root, "proj", "allowances.json"), "utf8"));
    for (const arm of ["none", "lens", "office-hours"]) for (const m of MODELS) expect(a.arm[arm][m]).toBeGreaterThan(0);
    expect(a.sim).toBeGreaterThan(0);
  });
  test("a projection past the ceiling takes the cuts in order", async () => {
    const r = await run("projection", ["--units-dir", unitsDir, "--scored", scored1, "--map", prodMapFile, "--approvals", approvals, "--ceiling", "1", "--out", join(root, "proj-tight")]);
    expect(r.out).toContain("cuts sol lens, particle lens, real sol and particle, opus lens pass 2; to the Captain");
    expect(r.out).toContain("stage 2 may start on the projection: no");
  });
  test("the approvals must list every ledger item once in its Item caps section", () => {
    expect(itemCaps("## Item caps\n" + ITEMS.map((i) => "`" + i + "` $5").join("\n")).get("of-hosts")).toBe(5);
    expect(() => itemCaps("## Item caps\nof-hosts $5\n")).toThrow("lists no cap for");
    expect(() => itemCaps("## Item caps\nof-nothing $5\n")).toThrow("not one of the eval's ledger items");
    expect(() => itemCaps("## Other\n")).toThrow("no ## Item caps");
  });
});

describe("of stage2 and of headline", () => {
  const s2 = stage2Fixture({ w: (e) => (e.arm === "office-hours" ? 1 : 0) });
  const launch = (cell: "stage2" | "pitch", entries: typeof s2.manifest) => {
    const dir = join(root, "launch-" + cell);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "manifest.json");
    freezeManifest(path, { schema: 1, cell, models: [...MODELS], arms: ["none", "lens", "office-hours"], repairs: [], units: {}, entries: [...entries] });
    return path;
  };
  const primary = launch("stage2", s2.manifest);
  const pitch = launch("pitch", manifest(COMPARISON, { kind: "pitch", real: false, cuts: [] }));
  const scored2 = file("scored2.ndjson", lines(s2.sessions));
  const stock2 = file("stock2.ndjson", "");
  const goldMap: PacketMap = { version: 1, kind: "label", stage: 2, seed: 1, packets: Object.fromEntries(MODELS.map((m) => ["g" + m, packet("g" + m, "gold", m, blocks("g" + m, m), Array.from({ length: 40 }, (_, k) => ({ block: "g" + m + k, item: "customer" as const, gold: k < 20, oracle: false })))])) };
  const goldLabels = file("gold-labels.ndjson", lines(MODELS.flatMap((m) => Array.from({ length: 40 }, (_, k) => cells("g" + m, "g" + m + k, PRODUCTION_LABEL[m], k < 20, false)))));
  const est = Object.fromEntries(MODELS.map((m) => [m, { model: m, units: 16, sessions: 48, p0: 0.375, rho: 0.99, s: 0.01 }]));
  const projection = file("projection.json", JSON.stringify({ rerun: { estimates: est } }));
  const stage1 = file("stage1.json", JSON.stringify({ reading: { band: { reading: "HEADROOM" }, untested: { opus: [], sol: [], particle: [] }, smoke_drop: { opus: false, sol: false, particle: false }, repairs: [] } }));
  const args = (out: string, audit = "pass") => ["--units-dir", unitsDir, "--scored", scored2, "--stock", stock2, "--manifest", primary, "--manifest", pitch, "--stage1", stage1, "--projection", projection, "--map", file("gold-map.json", JSON.stringify(goldMap)), "--labels", goldLabels, "--audit", file("audit2-" + audit + ".json", JSON.stringify({ read: audit })), "--arm-guess", "22/30", "--out", out];
  test("reads every model against the frozen manifests and writes stage2.json", async () => {
    calls = 0;
    const r = await run("stage2", args(join(root, "s2")));
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Opus office-hours-none: W 1 (95% interval 1 to 1, p 0.002, 10 units, 0 worse); helps");
    expect(r.out).toContain("Opus: KEEP");
    expect(r.out).toContain("Sol none: 10 scheduled, missing 0");
    expect(r.out).toContain("arm guess: 0.7333, above 0.70, flagged");
    expect(calls).toBe(3);
    const h = await run("headline", ["--stage2", join(root, "s2", "stage2.json")]);
    expect(h.code).toBe(0);
    expect(h.out.split("\n\n").every((b) => b.startsWith("helps on "))).toBe(true);
  });
  test("a voided stage reads untested, and its headline needs what the next attempt changes", async () => {
    const r = await run("stage2", args(join(root, "s2-void"), "void"));
    expect(r.out).toContain("untested (simulator: the stage 2 fidelity audit voided the stage)");
    expect(r.err).toBe("E_OF_SIM_AUDIT of stage2: see the readings above");
    const path = join(root, "s2-void", "stage2.json");
    const bare = await run("headline", ["--stage2", path]);
    expect(bare.err).toStartWith("E_USAGE of headline: the Opus and Sol and particle-1 headline reads untested or not shown and needs --next opus=");
    const ok = await run("headline", ["--stage2", path, ...MODELS.flatMap((m) => ["--next", m + "=a stage 2 rerun under a repaired simulator"])]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("untested on Opus: simulator: the stage 2 fidelity audit voided the stage. The next attempt changes: a stage 2 rerun under a repaired simulator.");
    expect((await run("headline", ["--stage2", path, "--next", "haiku=x"])).err).toContain("--next takes <model>=");
  });
  test("refuses a stage 1 audit outcome and an unknown flag", async () => {
    expect((await run("stage2", args(join(root, "s2-bad"), "repair"))).err).toContain("stage 1 outcome");
    expect((await run("headline", ["--stage2", "x", "--bogus"])).err).toStartWith("E_USAGE of headline: unknown argument");
  });
});
