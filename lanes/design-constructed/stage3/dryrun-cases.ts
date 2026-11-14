// Copyright (c) 2026 Garry Tan. MIT License.
// The recipes and stage 3 area's dry-run cases (build plan section 15; addendum R2-1, R2-2, R2-7, R2-19; the Captain's A1
// and B1 rulings; PD-10). Each drives the lane's real functions on invented fixtures in a fake Ubicloud and names its rule.
import { DcError } from "../errors.ts";
import { fixtureScreen, LOGIN, page, RECIPE, type AppKind, type FixtureApp } from "../recipes/fixtures.ts";
import { readLoad } from "../recipes/qualify.ts";
import { funnelLine, runScreen, supply } from "../recipes/sessions.ts";
import type { DryRunCase } from "../types.ts";
import { fakeBackend, fakeHosts, fakeMoney, fakeSpec, fakeWorld, bytes, type FakeFaults, type FakeVm } from "./fake.ts";
import { armReads, authored, fixtureStage3, reads, unit } from "./fixtures.ts";
import { instrument, type PairRow } from "./measures.ts";
import { runStage3 } from "./run.ts";
import { mirrorConfig, preamble, sandboxed, specFor, specProblems } from "./sandbox.ts";
import { controllerMirrors } from "./ubicloud-real.ts";
import { accepted, countValidation, selectUnits } from "./units.ts";
import { runVmAgent } from "./agent.ts";
import { agentRig } from "./agent-fake.ts";
import { BUILD_PROMPT, RECIPES, STAGE3 } from "../frozen.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function agentCase(reply: string, o: { spentMicros?: number; unknownMicros?: number; build?: boolean }) {
  const out = mkdtempSync(join(tmpdir(), "dc-dry-agent-"));
  const r = agentRig({ reply: () => reply, out, ...o });
  try {
    const run = o.build ? await runVmAgent(r.deps, r.vm, { prompt: BUILD_PROMPT, limits: STAGE3.build, sub: { item: "dc-stage3-builds", id: "sub-b" }, env: { DC_ROUTE: "/r" } }) : await runVmAgent(r.deps, r.vm, { prompt: "write the recipe", limits: RECIPES.session, sub: { item: "dc-base-apps", id: "sub-r" } });
    return { run, r };
  } finally {
    r.close();
    rmSync(out, { recursive: true, force: true });
  }
}

const eq = (got: unknown, want: unknown, what: string): string | null => (JSON.stringify(got) === JSON.stringify(want) ? null : what + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
const first = (...xs: Array<string | null>) => xs.find((x) => x !== null) ?? null;

async function auditOf(o: { faults?: FakeFaults; plant?: (vm: FakeVm) => void } = {}) {
  const w = fakeWorld(o);
  const r = await sandboxed({ backend: fakeBackend(w), hosts: fakeHosts(), now: () => 0 }, fakeSpec(), async () => 1);
  return { a: r.audit, deleted: w.deleted.length === 1 };
}

const auditCase = (name: string, o: Parameters<typeof auditOf>[0], kind: "uncollected" | "breach", reason: string): DryRunCase => ({
  rule: "C5",
  name,
  check: async () => {
    const { a, deleted } = await auditOf(o);
    if (a.ok) return "the audit passed";
    return first(eq(a.kind, kind, "kind"), a.reasons.some((x) => x.includes(reason)) ? null : "no reason names " + JSON.stringify(reason) + ": " + a.reasons.join("; "), deleted ? null : "the VM was not deleted");
  },
});

async function screenOf(apps: FixtureApp[], o: Parameters<typeof fixtureScreen>[1] = {}) {
  const f = fixtureScreen(apps, o);
  return { s: await runScreen(f.candidates, f.deps), money: f.money };
}

const readingCase = (name: string, app: FixtureApp, strict: boolean, http200: boolean, o: Parameters<typeof fixtureScreen>[1] = {}): DryRunCase => ({
  rule: "PD-10",
  name,
  check: async () => {
    const { s } = await screenOf([app], o);
    const r = s.records[0]!;
    return eq([r.strict, r.http200], [strict, http200], "strict and HTTP 200 readings (" + (r.why ?? "no reason") + ")");
  },
});

const supplyCase = (q: number): DryRunCase => ({
  rule: "E_DC_SUPPLY_SHORT",
  name: "supply at " + q + " qualified",
  check: async () => {
    const { s } = await screenOf(Array.from({ length: 30 }, (_, i) => ({ app: (i < q ? "content" : "blank") as AppKind, spentUsd: 1 })));
    try {
      const r = supply(s);
      return q >= 16 ? eq([r.status, r.baseApps.length], ["ok", q], "supply") : "no E_DC_SUPPLY_SHORT at " + q;
    } catch (e) {
      if (!(e instanceof DcError) || e.code !== "E_DC_SUPPLY_SHORT") throw e;
      return q < 16 && e.message.includes(q + " base apps qualify under the strict reading of renders (30 under the HTTP 200 reading)") ? null : "unexpected stop: " + e.message;
    }
  },
});

async function stage3Of(s: Parameters<typeof fixtureStage3>[0], n = 8) {
  const f = fixtureStage3({ reads: (l) => armReads(l), ...s });
  const units = Array.from({ length: n }, (_, i) => unit(i + 1));
  const sel = await selectUnits(units.map(f.candidate), f.select);
  return { f, sel, r: sel.runs ? await runStage3(sel, f.deps(units)) : null };
}

const ok = (o: Parameters<typeof reads>[0] = {}) => ({ serves: true, failedStep: null, reads: reads(o) });
const acc = () => accepted(authored(), { fixtures: true, keyChecks: { k1: true, k2: true, k3: true }, scenarios: { s1: true, s2: true, s3: true } });
const users = (done: string[]) => ["s1", "s2", "s3"].map((s) => ({ scenario: s, completed: done.includes(s), steps: 5, failedActions: 0, consoleErrors: 0, deadEnds: 0 }));

export function cases(): DryRunCase[] {
  return [
    {
      rule: "B1",
      name: "the controller host's mirrors name npm, PyPI, Ubuntu apt and the Docker Hub cache on its private IPv4, and a sandbox spec on them passes",
      check: () => {
        const mirrors = controllerMirrors("10.9.0.4", { npm: "npm terms (fixture)", pypi: "pypi terms (fixture)", apt: "apt terms (fixture)", dockerhub: "dockerhub terms (fixture)" });
        const spec = specFor("build", "build u01 none", { proxy: { host: "10.9.0.4", port: 8080 }, mirrors, env: { UBI_OWNER: "dry-owner" } });
        return first(eq(mirrors.map((m) => m.name + " " + m.host + ":" + m.port), ["npm 10.9.0.4:4873", "pypi 10.9.0.4:3141", "apt 10.9.0.4:3142", "dockerhub 10.9.0.4:5000"], "mirror endpoints"), eq(specProblems(spec), [], "spec problems"), eq(mirrorConfig(spec).length, 4, "mirror config lines"));
      },
    },
    {
      rule: "C5",
      name: "a clean VM run passes its audit and is deleted",
      check: async () => {
        const { a, deleted } = await auditOf();
        return first(a.ok ? null : "the audit failed: " + a.reasons.join("; "), deleted ? null : "the VM was not deleted");
      },
    },
    {
      rule: "C5",
      name: "apt timers stop and unattended-upgrades is masked before the egress filter",
      check: () => {
        const p = preamble(fakeSpec());
        return first(eq([p[0]!.startsWith("systemctl stop apt-daily"), p[2]!.includes("mask --now unattended-upgrades")], [true, true], "preamble order"), p.findIndex((s) => s.includes("policy drop")) > 3 ? null : "the filter comes first");
      },
    },
    auditCase("a failed SSH command stops like a breach", { faults: { exit: { processes: 255 } } }, "uncollected", "exited 255"),
    auditCase("an empty file list stops like a breach", { faults: { empty: ["files"] } }, "uncollected", "files command returned nothing"),
    auditCase("a missing process list stops like a breach", { faults: { empty: ["processes"] } }, "uncollected", "processes command returned nothing"),
    auditCase("a cut egress log stops like a breach", { faults: { cut: ["egress"] } }, "uncollected", "egress log is cut"),
    auditCase("a key pattern in a written file is a breach", { plant: (vm) => { vm.written.push({ path: "/tmp/x.log", size: 9, mode: 0o644, mtime: "t", type: "f" }); vm.files.set("/tmp/x.log", bytes("sk-ant-api03-" + "k".repeat(30))); } }, "breach", "/tmp/x.log"),
    auditCase("a key pattern in process arguments is a breach", { plant: (vm) => void vm.processes.push({ pid: 70, user: "run", args: "curl -H x:sk-proj-" + "k".repeat(40) }) }, "breach", "a key in the arguments of pid 70"),
    auditCase("a drive path in process arguments is a breach", { plant: (vm) => void vm.processes.push({ pid: 71, user: "run", args: "cat /root/.capy/drive/a" }) }, "breach", "a drive path in the arguments of pid 71"),
    auditCase("egress to an unnamed host is a breach", { plant: (vm) => void vm.egress.push({ host: "203.0.113.9", port: 443 }) }, "breach", "egress to 203.0.113.9:443"),
    {
      rule: "C5",
      name: "an audit hit in a recipe VM stops the base-app screen",
      check: async () => {
        const f = fixtureScreen([{ app: "content" }]);
        f.world.plant = (vm) => void vm.egress.push({ host: "198.51.100.3", port: 80 });
        try {
          await runScreen(f.candidates, f.deps);
          return "the screen ran on";
        } catch (e) {
          return e instanceof DcError && e.code === "E_DC_SANDBOX_AUDIT" && e.message.includes("base-app screen stops") ? null : "wrong stop: " + (e as Error).message;
        }
      },
    },
    readingCase("a page with content qualifies under both readings", { app: "content" }, true, true),
    readingCase("a blank page fails strict and passes HTTP 200", { app: "blank" }, false, true),
    readingCase("a redirect to a login page fails strict and passes HTTP 200", { app: "login-redirect" }, false, true),
    readingCase("a redirect to a login page passes both with the seeded user", { app: "login-redirect", recipe: RECIPE({ login: LOGIN }) }, true, true),
    readingCase("a login-only page fails strict without a seeded user", { app: "login-only" }, false, true),
    readingCase("a login-only page passes both with the seeded user", { app: "login-only", recipe: RECIPE({ login: LOGIN }) }, true, true),
    readingCase("an outside-auth app fails both readings", { app: "outside-auth" }, false, false),
    readingCase("a framework fallback page fails strict and passes HTTP 200", { app: "fallback" }, false, true),
    {
      rule: "B1",
      name: "a recipe that signs in is refused when the run allows no seeded login",
      check: async () => {
        const { s } = await screenOf([{ app: "login-only", recipe: RECIPE({ login: LOGIN }) }], { seededLogin: false });
        return eq([s.records[0]!.end, s.records[0]!.http200], ["bad-recipe", false], "end");
      },
    },
    {
      rule: "PD-10",
      name: "a login form alone fails one load, a settings page with a password field does not",
      check: () => {
        const login = readLoad(page("login-only", "http://localhost:3000/settings", [375, 812], false)).strict;
        const settings = readLoad({ ...page("content", "http://localhost:3000/settings", [375, 812], false), probe: { root: "#root", textChars: 900, media: 2, passwordInputs: 1, textOutsideLoginForm: 800, markers: [] } }).strict;
        return eq([login, settings], ["a login form alone", null], "reads");
      },
    },
    {
      rule: "R2-7",
      name: "an own-limit recipe session leaves its candidate unqualified with no retry",
      check: async () => {
        const { s, money } = await screenOf([{ end: "own-limit" }]);
        return first(eq([s.records[0]!.end, s.funnel.sessions], ["own-limit", 1], "end and sessions"), money.log.some((l) => l.startsWith("reconcile")) ? "a reconcile ran" : null);
      },
    },
    {
      rule: "R2-7",
      name: "a failure outside the agent gets one J1 retry after reconcile",
      check: async () => {
        const { s, money } = await screenOf([{ end: "infra-once" }, { end: "infra" }]);
        const i = money.log.indexOf("reconcile s1");
        return first(eq(s.records.map((r) => [r.end, r.sessions]), [["qualified", 2], ["infra", 2]], "ends"), money.log[i + 1] === "admit recipe session c01 retry" ? null : "the retry was not admitted on its own after reconcile");
      },
    },
    {
      rule: "R2-7",
      name: "at $3 a session the $95 item admits all 30",
      check: async () => {
        const { s } = await screenOf(Array.from({ length: 30 }, () => ({ app: "blank" as const, spentUsd: 3 })));
        return eq([s.funnel.sessions, s.capStop], [30, null], "sessions and cap stop");
      },
    },
    {
      rule: "R2-7",
      name: "at $3.20 a session the $95 item admits 29, then a cap stop",
      check: async () => {
        const { s } = await screenOf(Array.from({ length: 30 }, () => ({ app: "blank" as const, spentUsd: 3.2 })));
        return eq([s.funnel.sessions, s.capStop?.item], [29, "dc-base-apps"], "sessions and cap stop");
      },
    },
    {
      rule: "A1",
      name: "at most 30 candidates get a recipe session and the first 20 qualified are the base apps",
      check: async () => {
        const thirty = await screenOf(Array.from({ length: 35 }, () => ({ app: "blank" as const, spentUsd: 1 })));
        const twenty = await screenOf(Array.from({ length: 25 }, () => ({ app: "content" as const, spentUsd: 1 })));
        return eq([thirty.s.funnel.candidates, twenty.s.baseApps.length, twenty.s.baseApps[0]!.id], [30, 20, "c01"], "limits");
      },
    },
    {
      rule: "R2-1",
      name: "the funnel prints clone attempts, clones, file-check passes, sessions and both qualified counts",
      check: async () => {
        const { s } = await screenOf([{ app: "content" }, { app: "blank" }, { end: "infra-once", app: "content" }]);
        return eq(funnelLine(s.funnel), "funnel: clone attempts 61, clones 60, file-check passes 3, candidates with a recipe session 3, recipe sessions 4, qualified 2 under the strict reading and 3 under the HTTP 200 reading", "funnel");
      },
    },
    supplyCase(15),
    supplyCase(16),
    {
      rule: "R2-7",
      name: "a dc-base-apps cap stop with 16 qualified goes to the Captain at that count",
      check: async () => {
        const { s } = await screenOf(Array.from({ length: 30 }, () => ({ app: "content" as const, spentUsd: 1 })), { money: fakeMoney({ "dc-base-apps": 20.5 }) });
        const r = supply(s);
        return eq([s.capStop?.item, r.status, r.baseApps.length], ["dc-base-apps", "captain", 16], "status");
      },
    },
    {
      rule: "S3-keycheck",
      name: "a key check counts only when it passes on both oracle builds",
      check: () => eq(countValidation("u01", acc(), [ok({ keyChecks: { k1: true, k2: true, k3: false } }), ok({ keyChecks: { k1: true, k2: false, k3: true } })]).validated.map((k) => k.id), ["k1"], "validated"),
    },
    {
      rule: "S3-scenario",
      name: "a scenario counts when the agent user completes it on one oracle build",
      check: () => {
        const v = countValidation("u01", acc(), [ok({ agentUser: users(["s1", "s2"]) }), ok({ agentUser: users(["s3"]) })]);
        const short = countValidation("u01", acc(), [ok({ agentUser: users(["s1"]) }), ok({ agentUser: users(["s1", "s2"]) })]);
        return eq([v.qualifies, short.qualifies], [true, false], "qualifies");
      },
    },
    {
      rule: "S3-units",
      name: "fewer than 8 qualifying units release the stage 3 caps; 8 run",
      check: async () => {
        const seven = await stage3Of({ reads: (l) => (/u08/.test(l) ? reads({ keyChecks: { k1: false, k2: false, k3: false } }) : armReads(l)) });
        const eight = await stage3Of({});
        return first(eq([seven.sel.runs, seven.f.money.log.filter((l) => l.startsWith("release")).length], [false, 3], "seven"), eq([eight.sel.runs, eight.r!.builds.length], [true, 48], "eight"));
      },
    },
    {
      rule: "S3-units",
      name: "oracle builds run one at a time against the $30 reserve",
      check: async () => {
        const f = fixtureStage3();
        await selectUnits([f.candidate(unit(1))], f.select);
        return eq(f.money.log.slice(0, 4), ["admit oracle build 1 u01", "settle s1 1.50", "admit oracle build 2 u01", "settle s2 1.50"], "ledger");
      },
    },
    {
      rule: "S3-builds",
      name: "six build arms per unit in rounds of 2 admitted at $60",
      check: async () => {
        const { f, r } = await stage3Of({});
        return eq([r!.builds.filter((b) => b.state === "measured").length, f.money.log.filter((l) => l.startsWith("admit stage 3 builds")).length], [48, 24], "builds and rounds");
      },
    },
    {
      rule: "S3-builds",
      name: "a review arm with no Opus block doesn't build and pairs only where both builds exist",
      check: async () => {
        const { r } = await stage3Of({ opusBlock: (u, arm) => (u === "u02" && arm === "lens" ? null : "1. x") });
        return eq(r!.paired.find((p) => p.comparator === "none" && p.arm === "lens" && p.measure === "serves")!.units, 7, "paired units");
      },
    },
    {
      rule: "S3-failures",
      name: "render reads of a build that never serves print unavailable and completion scores 0",
      check: async () => {
        const { r } = await stage3Of({ serves: (l) => l !== "build u01 none" });
        const v = r!.values.get("u01")!.none!;
        return eq([v.serves, v.completion, v.axe, v.keyCheckRecurrence, v.des4], [0, 0, null, null, null], "values");
      },
    },
    {
      rule: "S3-failures",
      name: "an own-limit build gets one fresh retry measured as it stands; infra twice is missing",
      check: async () => {
        const { r } = await stage3Of({ end: (l) => (l === "build u01 none" ? "own-limit" : l === "build u01 lens" ? "infra" : "completed") });
        const b = (arm: string) => r!.builds.find((x) => x.unit === "u01" && x.arm === arm)!;
        return eq([b("none").state, b("none").ownLimit, b("lens").state], ["measured", true, "missing"], "states");
      },
    },
    {
      rule: "S3-failures",
      name: "forced-state reads are unavailable when the screen doesn't read the data source",
      check: async () => {
        const { r } = await stage3Of({ reads: (l) => armReads(l, l === "build u03 autoplan" ? { readsDataSource: false } : {}) });
        return eq(r!.values.get("u03")!.autoplan!.forcedMechanical, null, "forced");
      },
    },
    {
      rule: "S3-measure5",
      name: "key-check recurrence and the KEEP flag on fewer key checks than the none block",
      check: async () => {
        const { r } = await stage3Of({ reads: (l) => armReads(l, { keyChecks: l.endsWith("autoplan") ? { k1: false, k2: false, k3: false } : { k1: true, k2: true, k3: true } }) });
        return eq(r!.keep.map((k) => [k.arm, k.flagged]), [["plan-design-review", false], ["autoplan", true]], "KEEP flags");
      },
    },
    {
      rule: "S3-DES-4",
      name: "the instrument check passes at 0.7 and flags below",
      check: () => {
        const rows = (wins: number, of: number): PairRow[] => Array.from({ length: of }, (_, i) => ({ unit: "u" + i, arm: "no-review", judge: "argon", armFirst: false, result: i < wins ? "win" : "tie" }));
        return eq([instrument(rows(7, 10)).flagged, instrument(rows(69, 100)).flagged], [false, true], "flags");
      },
    },
    {
      rule: "WIRING-15",
      name: "a recipe agent session runs the CLI on its slot under the controller's env file and ends completed at the proxy's spend",
      check: async () => {
        const { run, r } = await agentCase("recipe written", { spentMicros: 1_250_000 });
        return first(eq(run, { end: "completed", spentUsd: 1.25 }, "run"), eq(r.upstream.map((u) => u.path + " " + u.auth), ["/slot1/anthropic/v1/messages Bearer run-token-1"], "upstream"), eq(r.ended, ["recipe session c001"], "ended"));
      },
    },
    {
      rule: "WIRING-15",
      name: "a build agent session that hits its turn cap reads as its own limit, with unknown spend held as null",
      check: async () => {
        const { run, r } = await agentCase("LIMIT", { unknownMicros: 5, build: true });
        return first(eq(run, { end: "own-limit", spentUsd: null }, "run"), eq(r.spawned[0]?.DC_ROUTE, "/r", "env"));
      },
    },
    {
      rule: "S3-audit",
      name: "an audit hit in a build VM stops stage 3",
      check: async () => {
        const f = fixtureStage3({ reads: (l) => armReads(l) });
        const units = Array.from({ length: 8 }, (_, i) => unit(i + 1));
        const sel = await selectUnits(units.map(f.candidate), f.select);
        f.world.plant = (vm) => void (vm.spec!.label === "check u04 none" && vm.egress.push({ host: "192.0.2.4", port: 443 }));
        try {
          await runStage3(sel, f.deps(units));
          return "stage 3 ran on";
        } catch (e) {
          return e instanceof DcError && e.code === "E_DC_SANDBOX_AUDIT" && e.message.includes("Stage 3 stops") ? null : "wrong stop: " + (e as Error).message;
        }
      },
    },
  ];
}
