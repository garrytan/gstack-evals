// Copyright (c) 2026 Garry Tan. MIT License.
// The stages commands' refusals before spend: the paid flags, the authoring and judge routes, the grading seam, the run
// folder; the ledger lines; and the no-model preflight rows on fixtures.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { codeOf } from "../../../lanes/eng-planted/stages/cases.ts";
import { AUTHOR_ROUTES, authorRouteProblems, JUDGE_ROUTES, meterLauncher, plantedPaid, preflightRows, REAL, routeProblems, stagesCommands } from "../../../lanes/eng-planted/stages/commands.ts";
import { AUTHOR_MODELS, type AuthorRole } from "../../../lanes/eng-planted/stages/local.ts";
import { ITEMS } from "../../../lanes/eng-planted/stages/ledger.ts";
import { ROLE_MODEL } from "../../../lanes/eng-planted/readings/judge.ts";
import { plantedUnits } from "./fixture.ts";

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) } };
};
const args = (flags: Record<string, string>, bools: string[] = []) => ({ flags: new Map(Object.entries(flags)), bools: new Set(bools), rest: [] });

describe("paid flags", () => {
  const ok = { "--item": "ep-stock", "--cap-usd": "190", "--ledger-record": "/r", "--ledger": "/l", "--crew-usd": "450", "--hosts-usd": "0" };
  test("every flag is needed, the item must be the stage's, the amount at most the plan's cap, the figures in dollars", async () => {
    expect(plantedPaid("builds", args(ok), "/run").allIn).toEqual({ stateDir: "/run/state", crewUsd: 450, hostsUsd: 0 });
    for (const f of Object.keys(ok)) {
      const { [f]: _, ...rest } = ok as Record<string, string>;
      expect(await codeOf(() => plantedPaid("builds", args(rest), "/run"))).toBe("E_USAGE");
    }
    expect(await codeOf(() => plantedPaid("smoke", args(ok), "/run"))).toBe("E_USAGE");
    expect(await codeOf(() => plantedPaid("builds", args({ ...ok, "--cap-usd": "190.01" }), "/run"))).toBe("E_USAGE");
    expect(await codeOf(() => plantedPaid("builds", args({ ...ok, "--crew-usd": "-1" }), "/run"))).toBe("E_USAGE");
  });
});

describe("routes", () => {
  test("every authoring and judge role has its meter route at its model", () => {
    expect(authorRouteProblems()).toEqual([]);
    expect(routeProblems(ROLE_MODEL, JUDGE_ROUTES, ["judge", "gold-opus", "gold-gemini"])).toEqual([]);
    expect(authorRouteProblems({ ...AUTHOR_ROUTES, raterCarbon: null })).toEqual(["raterCarbon: the product-value meter has no route for google/gemini-4-carbon"]);
    expect(authorRouteProblems({ ...AUTHOR_ROUTES, raterCarbon: "gemini" })).toEqual(["raterCarbon: meter route gemini calls google/gemini-4-argon, not google/gemini-4-carbon"]);
  });
  test("a meter launcher refuses before any lease opens while a route is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep-routes-"));
    const record = join(dir, "record");
    recordApproval(record, { action: "init", item: "ep-authoring", cap_micros: 680_000_000, quotes: [{ words: "test", by: "test", source: "test" }], admission: "warn" });
    const launch = meterLauncher({ out: join(dir, "meter"), cacheDir: join(dir, "cache"), maxTokens: 100, effort: null, label: "ep-author", models: AUTHOR_MODELS, routes: { ...AUTHOR_ROUTES, raterCarbon: null }, roles: Object.keys(AUTHOR_MODELS) as AuthorRole[] });
    expect(await codeOf(() => launch({ item: "ep-authoring", capUsd: 10, record, ledger: join(dir, "l.sqlite") }))).toBe("E_EP_NOT_BUILT");
    expect(readItem(record, "ep-authoring").leases).toHaveLength(0);
  });
  test("the real grading seam is the construct part's planted grader", async () => {
    const g = await REAL.grader({ work: "/tmp", log: () => {} });
    expect(typeof g.grade).toBe("function");
    expect(typeof g.catchOf).toBe("function");
  });
});

describe("commands", () => {
  const t = stagesCommands();
  test("ledger prints the program, one init line per item and the reserve, hosts and crew notes", async () => {
    const o = io();
    expect(await t.ledger!.run(args({}), o.io)).toBe(0);
    expect(o.out.filter((l) => l.startsWith("gstack-evals ledger init --item "))).toHaveLength(ITEMS.length);
    expect(o.out[0]).toContain("--program geva-537-ep --cap " + ITEMS.reduce((s, i) => s + i.capUsd, 0));
  });
  test("ledger --projection prints the all-in projection and stops past $5,000", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ep-proj-"));
    const o = io();
    expect(await t.ledger!.run(args({ "--run": dir, "--crew-usd": "450", "--hosts-usd": "90" }, ["--projection"]), o.io)).toBe(0);
    expect(o.out.at(-1)).toBe("all-in projection $4321.00 against the $5000 stop");
    expect(await codeOf(() => t.ledger!.run(args({ "--run": dir, "--crew-usd": "1200", "--hosts-usd": "90" }, ["--projection"]), io().io))).toBe("E_EP_PROJECTION");
  });
  test("a run folder inside the repository is refused", async () => {
    expect(await codeOf(() => t.ledger!.run(args({ "--run": join(import.meta.dir, "run"), "--crew-usd": "0", "--hosts-usd": "0" }, ["--projection"]), io().io))).toBe("E_USAGE");
  });
});

describe("preflight", () => {
  test("each row runs on its own and names what is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ep-pre-"));
    const fx = plantedUnits(dir, 2);
    const record = join(dir, "record");
    mkdirSync(record);
    const rows = preflightRows({ run: join(dir, "run"), units: fx.units, repos: fx.repos, gstack: join(dir, "no-gstack"), record, harbor: join(dir, "no-harbor"), docker: join(dir, "no-docker") });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(rows.map((r) => r.name)).toEqual(["docker", "harbor", "claude pin", "restore pin", "gstack checkout", "plain arm", "authoring routes", "ledger items", "units", "run dir"]);
    expect([by.docker!.ok, by.harbor!.ok, by["gstack checkout"]!.ok, by["ledger items"]!.ok]).toEqual([false, false, false, false]);
    expect([by["restore pin"]!.ok, by["plain arm"]!.ok, by["authoring routes"]!.ok, by.units!.ok, by["run dir"]!.ok]).toEqual([true, true, true, true, true]);
    expect(by["ledger items"]!.detail).toContain("ep-comparison has no recorded cap");
  });
});
