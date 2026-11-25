// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's commands on stub launchers: the ledger lines, the paid flags, the pilot's reviews, builds and readout, the
// comparison's first half, C and P's second half held for the look, the look's refusals and write-once, and the readings.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLease, reconcileLease, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { e1Commands, E1_RUN, e1StubLauncher, lookPath, type E1Seams, type LookFile } from "../../../lanes/eng-planted/e1/commands.ts";
import { RUNS_ON, type E1Arm } from "../../../lanes/eng-planted/e1/frozen.ts";
import type { E1ReviewSession } from "../../../lanes/eng-planted/e1/launch.ts";
import { E1_ITEMS, itemName } from "../../../lanes/eng-planted/e1/pipeline.ts";
import { codeOf, scriptedCalls } from "../../../lanes/eng-planted/stages/cases.ts";
import type { PlantedSession } from "../../../lanes/eng-planted/stages/build.ts";
import type { PlantedUnit } from "../../../lanes/eng-planted/types.ts";
import type { E1Draw, SupplyRole } from "../../../lanes/eng-planted/e1/supply.ts";

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) } };
};
const args = (flags: Record<string, string>, bools: string[] = []) => ({ flags: new Map(Object.entries(flags)), bools: new Set(bools), rest: [] });
const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" });
const unit = (id: string, repo: string): PlantedUnit => ({ id, repo, set: "comparison", ecosystem: "node", stars: "1k-9.9k", publicMonth: "2026-06", strictWindow: true, regionLines: 10, planted: ["t1", "t2"], plantedClass: { t1: "assert", t2: "crash" }, functional: [], foresee: null, winnable: null, hard: null, pilot: false });
const MARKER = "Model the states before the code.";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "e1-cmd-"));
  const run = join(dir, "run");
  const units = join(dir, "units");
  const repos = join(dir, "repos");
  const ids = { calibration: ["c1"], comparison: ["k1", "k2"] };
  for (const [i, id] of [...ids.calibration, ...ids.comparison].entries()) {
    mkdirSync(join(units, id), { recursive: true });
    writeFileSync(join(units, id, "ep-unit.json"), JSON.stringify(unit(id, "r" + i)));
    mkdirSync(join(repos, id), { recursive: true });
    writeFileSync(join(repos, id, "a.ts"), "export const a = 1;\n");
    git(join(repos, id), "init", "-q");
    git(join(repos, id), "add", "-A");
    git(join(repos, id), "commit", "-q", "-m", "B");
    mkdirSync(join(run, "author", id), { recursive: true });
    writeFileSync(join(run, "author", id, "plan.md"), "# Plan\nAdd a state.\n");
  }
  mkdirSync(join(run, "e1"), { recursive: true });
  writeFileSync(join(run, "e1", "draw.json"), JSON.stringify({ seed: "s1", ...ids, reserve: [], skipped: [], waiting: null }));
  const record = join(dir, "record");
  const quote = { words: "test", by: "test", source: "test" };
  for (const i of E1_ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: Math.round(i.capUsd * 1_000_000), quotes: [quote], admission: "warn" });
  const tree = join(dir, "tree");
  mkdirSync(tree);
  writeFileSync(join(tree, "final.patch"), "");
  writeFileSync(join(tree, "sdk-messages.jsonl"), JSON.stringify({ type: "tool_use", input: { file_path: "/work/review/plan.md" } }) + "\n");
  const calls = { reviews: [] as string[], builds: [] as string[], markers: [] as string[], supply: [] as string[] };
  const review: E1ReviewSession = async (s) => {
    calls.reviews.push(s.cell);
    const plan = "# Plan\nAdd a state.\nidle -> running\nrunning -> done\ndone -> idle\n";
    return { end: "completed", costUsd: 0.1, result: { dir: s.dir, host: "claude", plan, transcript: JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: MARKER }] } }) + "\n", stateRoot: null, written: { files: [], binary: 0, large: 0 }, repoEdits: 0 } };
  };
  const build: PlantedSession = async (s) => {
    calls.builds.push(s.cell);
    return { outcome: "completed", tree, costUsd: 0.2 };
  };
  const seams: E1Seams = {
    review: () => e1StubLauncher(review),
    build: () => e1StubLauncher(build),
    grader: async () => ({ grade: async () => ({ planted: [{ id: "t1", runs: ["pass", "pass", "pass"] }, { id: "t2", runs: ["assert", "crash", "assert"] }], functional: [] }), catchOf: async () => ({ catch: true, drop: null }) }),
    marker: (h) => {
      calls.markers.push(h);
      return MARKER;
    },
    author: () => e1StubLauncher(scriptedCalls({ conditions: [] })),
    supply: () => e1StubLauncher(async (role: SupplyRole, prompt: string) => {
      calls.supply.push(role);
      const odd = /odd-unit/.test(prompt);
      return { text: role.startsWith("state") ? JSON.stringify({ defect: "yes", state_shaped: odd ? "no" : "yes", reason: "r" }) : "REACH: yes", costUsd: 0.01 };
    }),
  };
  const paid = (item: string, extra: Record<string, string> = {}) => ({ "--run": run, "--units": units, "--repos": repos, "--item": item, "--cap-usd": String(E1_ITEMS.find((i) => i.item === item)!.capUsd), "--ledger-record": record, "--ledger": join(dir, "l.sqlite"), "--crew-usd": "0", "--hosts-usd": "0", "--cache": join(dir, "cache"), "--pstack": join(dir, "pstack"), "--work": join(dir, "work"), ...extra });
  return { dir, run, units, repos, record, calls, cmds: e1Commands(seams), paid };
}

const PAIRS = (Object.keys(RUNS_ON) as E1Arm[]).flatMap((arm) => RUNS_ON[arm].map((model) => ({ arm, model })));

describe("ledger", () => {
  test("e1-ledger prints the envelope, one init line per item and the not-item figures", async () => {
    const f = fixture();
    const o = io();
    expect(await f.cmds["e1-ledger"]!.run(args({}), o.io)).toBe(0);
    expect(o.out.filter((l) => l.startsWith("gstack-evals ledger init --item "))).toHaveLength(E1_ITEMS.length);
    expect(o.out[0]).toStartWith("gstack-evals ledger envelope --program geva-587-e1 ");
    expect(o.out.some((l) => l.includes("--item e1-supply --cap 220 "))).toBe(true);
    const p = io();
    expect(await f.cmds["e1-ledger"]!.run(args({ "--run": f.run, "--crew-usd": "0", "--hosts-usd": "0" }, ["--projection"]), p.io)).toBe(0);
    expect(p.out.at(-1)).toContain("against the $5000 stop");
    expect(await codeOf(() => f.cmds["e1-ledger"]!.run(args({ "--run": f.run, "--crew-usd": "1900", "--hosts-usd": "0" }, ["--projection"]), io().io))).toBe("E_EP_PROJECTION");
  });
});

describe("leases", () => {
  test("one lease opens and settles on every eval 1 item, on a temporary ledger, and a name outside them refuses", async () => {
    const f = fixture();
    for (const i of E1_ITEMS) {
      const h = await e1StubLauncher("x")({ item: i.item, capUsd: i.capUsd, record: f.record, ledger: join(f.dir, "l.sqlite") });
      await h.close();
      expect(readItem(f.record, i.item).leases).toHaveLength(1);
    }
    expect(await codeOf(() => e1StubLauncher("x")({ item: "ep-comparison", capUsd: 1, record: f.record, ledger: join(f.dir, "l.sqlite") }))).toBe("E_USAGE");
  });

  test("a stage group's lease asks for what its item has left, so the pilot's pairs share e1-pilot", async () => {
    const f = fixture();
    const local = openLocalLedger(ledgerPath(join(f.dir, "l.sqlite")));
    const spent = openLease(f.record, local, { item: "e1-pilot", run_id: E1_RUN, amount_micros: 100_000_000, requireAdmission: () => null });
    local.close();
    writeFileSync(join(f.dir, "usage.csv"), "spent,100\n");
    reconcileLease(f.record, { lease_id: spent.lease_id, spent_micros: 100_000_000, quotes: [{ words: "test", by: "test", source: "test" }], source: join(f.dir, "usage.csv"), now: new Date(Date.now() + 8 * 86_400_000) });
    expect(await f.cmds["e1-reviews"]!.run(args({ ...f.paid("e1-pilot"), "--phase": "pilot" }), io().io)).toBe(0);
    const asked = readItem(f.record, "e1-pilot").leases.slice(1).map((l) => l.lease.reserved_micros);
    expect(asked).toHaveLength(PAIRS.length);
    expect(asked.every((m) => m === 65_000_000)).toBe(true);
  });
});

describe("paid flags", () => {
  test("a missing flag, a counted item in the pilot, a cap past the plan's and a run inside the repository refuse before any lease", async () => {
    const f = fixture();
    const base = { ...f.paid("e1-pilot"), "--phase": "pilot" };
    const { ["--hosts-usd"]: _, ...noSupply } = base;
    expect(await codeOf(() => f.cmds["e1-reviews"]!.run(args(noSupply), io().io))).toBe("E_USAGE");
    expect(await codeOf(() => f.cmds["e1-reviews"]!.run(args({ ...base, "--item": "e1-n-opus" }), io().io))).toBe("E_USAGE");
    expect(await codeOf(() => f.cmds["e1-reviews"]!.run(args({ ...base, "--cap-usd": "165.01" }), io().io))).toBe("E_USAGE");
    expect(await codeOf(() => f.cmds["e1-reviews"]!.run(args({ ...f.paid("e1-n-opus"), "--phase": "comparison", "--half": "1", "--item": "e1-p-sol" }), io().io))).toBe("E_USAGE");
    expect(await codeOf(() => f.cmds["e1-reviews"]!.run(args({ ...base, "--run": join(import.meta.dir, "run") }), io().io))).toBe("E_USAGE");
    expect(f.calls.reviews).toEqual([]);
    expect(readItem(f.record, "e1-pilot").leases).toHaveLength(0);
  });
});

describe("pilot", () => {
  test("one review and one build per arm and model on the calibration unit, then the readout and power.py's input", async () => {
    const f = fixture();
    const o = io();
    expect(await f.cmds["e1-reviews"]!.run(args({ ...f.paid("e1-pilot"), "--phase": "pilot" }), o.io)).toBe(0);
    expect(f.calls.reviews).toHaveLength(PAIRS.length);
    expect(f.calls.reviews.every((c) => c.startsWith("c1_"))).toBe(true);
    expect(f.calls.markers).toHaveLength(RUNS_ON.P.length);
    expect(o.out).toHaveLength(PAIRS.length);
    const leases = readItem(f.record, "e1-pilot").leases;
    expect(leases).toHaveLength(PAIRS.length);
    expect(await f.cmds["e1-builds"]!.run(args({ ...f.paid("e1-pilot"), "--phase": "pilot" }), io().io)).toBe(0);
    expect(f.calls.builds).toHaveLength(PAIRS.length);
    expect(readItem(f.record, "e1-pilot").leases).toHaveLength(PAIRS.length + 1);
    const r = io();
    expect(await f.cmds["e1-pilot"]!.run(args({ "--run": f.run, "--units": f.units, "--repos": f.repos }), r.io)).toBe(3);
    expect(r.out.filter((l) => /^(PASS|FAIL) [NDCPG] on /.test(l))).toHaveLength(PAIRS.length);
    expect(r.out.some((l) => l.includes("N's composite over 3 builds"))).toBe(true);
    const pj = JSON.parse(readFileSync(join(f.run, "e1", "pilot.json"), "utf8"));
    expect(pj.builds).toHaveLength(3);
    expect(existsSync(join(f.run, "e1", "seeds.json"))).toBe(true);
  });
});

describe("comparison", () => {
  test("half 1 per item, C and P's half 2 held for the look, the look once over terminal cells, then the readings", async () => {
    const f = fixture();
    const half = (item: string, h: string) => args({ ...f.paid(item), "--phase": "comparison", "--half": h });
    expect(await f.cmds["e1-reviews"]!.run(half("e1-c-opus", "1"), io().io)).toBe(0);
    expect([...f.calls.reviews].sort()).toEqual(["k1_C_opus_0", "k1_C_opus_1"]);
    expect(await codeOf(() => f.cmds["e1-reviews"]!.run(half("e1-c-opus", "2"), io().io))).toBe("E_USAGE");
    expect(await codeOf(() => f.cmds["e1-builds"]!.run(half("e1-p-opus", "2"), io().io))).toBe("E_USAGE");
    expect(await codeOf(() => f.cmds["e1-look"]!.run(args({ "--run": f.run, "--units": f.units, "--repos": f.repos }), io().io))).toBe("E_USAGE");
    expect(existsSync(lookPath(f.run))).toBe(false);
    for (const p of PAIRS) {
      const item = itemName(p.arm, p.model);
      if (item !== "e1-c-opus") expect(await f.cmds["e1-reviews"]!.run(half(item, "1"), io().io)).toBe(0);
      expect(await f.cmds["e1-builds"]!.run(half(item, "1"), io().io)).toBe(0);
    }
    expect(f.calls.reviews).toHaveLength(PAIRS.length * 2);
    expect(f.calls.builds).toHaveLength(PAIRS.length * 2);
    expect(f.calls.reviews.every((c) => c.startsWith("k1_"))).toBe(true);
    const lk = io();
    expect(await f.cmds["e1-look"]!.run(args({ "--run": f.run, "--units": f.units, "--repos": f.repos, "--draws": "200" }), lk.io)).toBe(0);
    expect(lk.out[0]).toStartWith("look on 1 units: ");
    const look = JSON.parse(readFileSync(lookPath(f.run), "utf8")) as LookFile;
    expect([look.stop, look.exposedOn]).toEqual([false, { C: [], P: [] }]);
    expect(look.units).toEqual(["k1"]);
    expect(await codeOf(() => f.cmds["e1-look"]!.run(args({ "--run": f.run, "--units": f.units, "--repos": f.repos }), io().io))).toBe("E_USAGE");
    const before = f.calls.reviews.length;
    expect(await f.cmds["e1-reviews"]!.run(half("e1-c-opus", "2"), io().io)).toBe(0);
    expect(f.calls.reviews.length - before).toBe(2);
    expect(await f.cmds["e1-reviews"]!.run(half("e1-n-opus", "2"), io().io)).toBe(0);
    expect(f.calls.reviews.slice(-2).sort()).toEqual(["k2_N_opus_0", "k2_N_opus_1"]);
    const rd = io();
    expect(await f.cmds["e1-read"]!.run(args({ "--run": f.run, "--units": f.units, "--repos": f.repos, "--draws": "200" }), rd.io)).toBe(0);
    expect(rd.out.filter((l) => l.startsWith("arm "))).toHaveLength(PAIRS.length);
    expect(rd.out.some((l) => l.startsWith("ROW "))).toBe(true);
    expect(rd.out.at(-1)).toStartWith("eval 4: ");
  });
  test("a look that stopped C and P refuses their second half and leaves the other arms running", async () => {
    const f = fixture();
    writeFileSync(lookPath(f.run), JSON.stringify({ stop: true, units: ["k1"], CN: null, PN: null, exposedOn: { C: ["opus"], P: [] }, at: "2026-11-28T00:00:00Z" }));
    const half = (item: string) => args({ ...f.paid(item), "--phase": "comparison", "--half": "2" });
    expect(await codeOf(() => f.cmds["e1-reviews"]!.run(half("e1-c-sol"), io().io))).toBe("E_USAGE");
    expect(await codeOf(() => f.cmds["e1-builds"]!.run(half("e1-p-particle"), io().io))).toBe("E_USAGE");
    expect(f.calls.reviews).toEqual([]);
    expect(await f.cmds["e1-reviews"]!.run(half("e1-g-sol"), io().io)).toBe(0);
    expect([...f.calls.reviews].sort()).toEqual(["k2_G_sol_0", "k2_G_sol_1"]);
  });
});

describe("supply", () => {
  test("screens walk the draw's order under the supply item; the draw only grows and waits on owed authoring", async () => {
    const f = fixture();
    const units = join(f.dir, "units2");
    const ids = Array.from({ length: 10 }, (_, i) => "s" + i);
    for (const [i, id] of ids.entries()) {
      mkdirSync(join(units, id), { recursive: true });
      writeFileSync(join(units, id, "ep-unit.json"), JSON.stringify(unit(id, "q" + i)));
      writeFileSync(join(units, id, "ep-author.json"), JSON.stringify({ stubbed: [], implementation: [], tests: [], callers: [], fix: { message: i % 2 ? "odd-unit" : "even-unit", diff: "--- a\n+++ b" } }));
      const a = join(f.run, "author", id);
      mkdirSync(a, { recursive: true });
      if (i === 9) continue;
      writeFileSync(join(a, "calls.json"), JSON.stringify({ drop: i === 8 ? "plan-audit" : null, foresee: ["yes", "yes"] }));
      if (i === 8) continue;
      writeFileSync(join(a, "hinted.json"), JSON.stringify({ drop: null }));
      writeFileSync(join(a, "hint.txt"), "The flag must reset.\n");
      writeFileSync(join(a, "plan.md"), "# Plan\n");
    }
    const run = (cmd: string, extra: Record<string, string> = {}) => f.cmds[cmd]!.run(args({ ...f.paid("e1-supply"), "--units": units, ...extra }), io().io);
    expect(await run("e1-screen", { "--limit": "3" })).toBe(0);
    expect(f.calls.supply.filter((r) => r === "stateAstra")).toHaveLength(3);
    expect(readItem(f.record, "e1-supply").leases).toHaveLength(1);
    const o = io();
    expect(await f.cmds["e1-screen"]!.run(args({ ...f.paid("e1-supply"), "--units": units }), o.io)).toBe(0);
    expect(o.out[0]).toContain("8 in all: 4 state-shaped, 4 passing both screens");
    expect(f.calls.supply.filter((r) => r === "stateAstra")).toHaveLength(8);
    expect(f.calls.supply.filter((r) => r === "reachCarbon")).toHaveLength(4);
    expect(await run("e1-screen")).toBe(0);
    expect(f.calls.supply.filter((r) => r === "stateAstra")).toHaveLength(8);
    const seg = JSON.parse(readFileSync(join(f.run, "e1", "segments.json"), "utf8"));
    expect(seg.attempt3.sort()).toEqual(ids.slice(0, 9));
    rmSync(join(f.run, "e1", "draw.json"));
    const dr = io();
    expect(await f.cmds["e1-draw"]!.run(args({ "--run": f.run, "--units": units, "--repos": f.repos }), dr.io)).toBe(0);
    const d = JSON.parse(readFileSync(join(f.run, "e1", "draw.json"), "utf8")) as E1Draw;
    expect([d.calibration.length, d.comparison.length, d.waiting]).toEqual([4, 0, "s9"]);
    expect(d.calibration.every((id) => Number(id.slice(1)) % 2 === 0)).toBe(true);
    expect(dr.out[0]).toContain("the walk waits");
    writeFileSync(join(f.run, "e1", "screen", d.calibration[0] + ".json"), JSON.stringify({ state: { astra: null, opus: null, eligible: false, packet: "" }, reach: null, drop: "state", bothYes: false, costUsd: 0 }));
    expect(await codeOf(() => f.cmds["e1-draw"]!.run(args({ "--run": f.run, "--units": units, "--repos": f.repos }), io().io))).toBe("E_USAGE");
    expect(await run("e1-author", { "--step": "hinted" })).toBe(0);
    expect(f.calls.builds).toEqual([]);
    expect(await run("e1-author", { "--step": "calls" })).toBe(0);
    const calls = JSON.parse(readFileSync(join(f.run, "author", "s9", "calls.json"), "utf8"));
    expect([calls.drop, calls.writer]).toEqual([null, "openai/gpt-6.2-sol"]);
    expect(existsSync(join(f.run, "author", "s8", "plan.md"))).toBe(false);
    expect(await run("e1-author", { "--step": "hinted" })).toBe(0);
    expect(f.calls.builds.length === 1 && f.calls.builds[0]!.startsWith("s9")).toBe(true);
    expect(existsSync(join(f.run, "author", "s9", "hinted.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(f.run, "e1", "segments.json"), "utf8")).attempt3).not.toContain("s9");
  });
});
