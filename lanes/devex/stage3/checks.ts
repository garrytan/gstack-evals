// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's dry-run lines (prereg 2026-11-09-geva-417, section 15 rule 4): each line names one frozen rule of section 12,
// section 6's stage 3 row or section 15 rule 3 and passes only when that rule was driven on both sides of its edge,
// keyless, on fixtures. Every VM is the fake backend; no line creates a VM, calls a model or reads a key.
import type { AliasMap, Row, UnitMeta } from "../types.ts";
import { armBlock, BUILD_LIMITS, BUILD_PROMPT, buildPrompt, drawBuildUnits } from "./build.ts";
import { FakeBackend, fakeSpec, res, type FakeVm } from "./fake.ts";
import { mechanical, type BuildMeasures, type ProbeRun } from "./firstsuccess.ts";
import { audit, type GoalRecord } from "./goal.ts";
import { readout } from "./readout.ts";
import { runStage3, type BuildUnit, type Stage3Deps } from "./run.ts";
import { preamble, sandboxed } from "./sandbox.ts";
import type { DryCheck } from "../types.ts";

const line = (rule: string, sides: Array<[boolean, string]>): DryCheck => ({ rule, pass: sides.every(([ok]) => ok), detail: sides.map(([ok, d]) => (ok ? "ok: " : "FAIL: ") + d).join("; ") });

export const meta = (id: string, rank: number, dev_class: UnitMeta["dev_class"] = "CLI", repo = "r" + id): UnitMeta => ({ id, set: "comparison", rank, draw_digest: "d" + id, repo_digest: repo, dev_class, breaking: false, language: "ts", merged_at: "2026-09-01T00:00:00Z", earliest_exposure: "2026-08-15T00:00:00Z", release: { kind: "release", published_at: "2026-09-02T00:00:00Z", prerelease: false }, window: { from: "2026-09-02", to: "2026-11-01" }, licence: { spdx: "MIT", tier: "permissive" }, stripped: [], recognized: null });

export const ALIAS: AliasMap = { entries: [{ original: "fixturetool", alias: "zorblat", kind: "binary" }], kept: [] };

export const goalRecord = (unit: string): GoalRecord => ({
  unit,
  surface: "fixturetool init",
  goal: "use the new fixturetool init command to create a project",
  checker: "check-goal",
  recipe: { build: "make-artifact", install: "install-artifact", help: "fixturetool --help" },
  probes: [
    { id: "p1", kind: "cli", misuse: "a required argument missing", command: "fixturetool init", error_path: "missing --name" },
    { id: "p2", kind: "cli", misuse: "a bad config value", command: "fixturetool init --name x --mode bogus", error_path: "unknown mode" },
    { id: "p3", kind: "cli", misuse: "a missing credential", command: "fixturetool push", error_path: "no credential" },
  ],
});

export const passRow = (unit: string, arm: Row["arm"], list: string[]): Row => ({ unit, arm, model: "opus", stage: 2, pass: 1, smoke: false, end: "block", code: null, list, words: 0, items: list.length, cut: 0, exposed: null, markers: {}, session_kind: null, lean: null, dx_lens: null, gstack_read: null, retried: false, judged: false, limit_stops: 0, spend_micros: null, session: "s-" + unit + "-" + arm });

const PROBE_OUT: Record<string, string> = { "fixturetool init": "error: missing --name; fix: pass --name", "fixturetool init --name x --mode bogus": "error: unknown mode bogus; fix: use fast or safe", "fixturetool push": "error: no credential; fix: run fixturetool login" };

/** A fixture world: the handler answers the recipe, the checker and the probes; baseFails makes the base install fail. */
export function world(o: { baseFails?: Set<string>; breachOn?: number } = {}) {
  let unit = "";
  const backend = new FakeBackend((vm, cmd) => {
    if (cmd.includes("/work/base-check") && cmd.includes("make-artifact")) return o.baseFails?.has(unit) ? res(1, "", { stderr: "build failed" }) : res(0, "/work/base-check/dist/a.tgz");
    if (cmd.includes("make-artifact")) return res(0, "/work/repo/dist/a.tgz");
    if (cmd.startsWith("cat /work/repo/README.md")) return res(0, "# fixturetool\n\n\u0060\u0060\u0060sh\n$ fixturetool init --name demo\n\u0060\u0060\u0060\n");
    if (cmd.includes("find docs")) return res(0, "docs/start.md\n");
    for (const [probe, out] of Object.entries(PROBE_OUT)) if (cmd.endsWith(" " + probe)) return res(2, "", { stderr: out, elapsed_ms: 120 });
    return undefined;
  });
  const prompts: string[] = [];
  let settled = 0, builds = 0;
  const deps: Stage3Deps = {
    backend,
    spec: (kind) => fakeSpec({ session_minutes: kind === "build" ? 120 : 30 }),
    buildAgent: async (vm, x) => {
      prompts.push(x.prompt);
      builds++;
      if (o.breachOn === builds) (vm as FakeVm).net.push({ host: "203.0.113.9", port: 443 });
      (vm as FakeVm).net.push({ host: "10.0.0.2", port: 8080 });
      await backend.write(vm, "/work/repo/dist/a.tgz", "artifact");
      await backend.write(vm, "/work/repo/docs/start.md", "Run fixturetool init --name demo.");
      return { spend_micros: 1 };
    },
    docsAgent: async () => ({ commands: [{ command: "fixturetool init --name demo", exit: 0, turn: 1 }, { command: "fixturetool init", exit: 2, turn: 1 }], turns: 3, minutes: 2 }),
    judge: async () => ({ names_failure: true, names_fix: true }),
    settle: async () => void settled++,
    canary: () => "canary-0123456789",
  };
  const unitOf = (id: string): BuildUnit => ({ meta: meta(id, 1), goal: goalRecord(id), plan: "Add zorblat init.", alias: ALIAS, base: new TextEncoder().encode("tar") });
  const run = async (ids: string[], rows: Row[] = []) => {
    const units = ids.map(unitOf);
    const out = { builds: [] as BuildMeasures[], stop: null as Awaited<ReturnType<typeof runStage3>>["stop"] };
    for (const u of units) {
      unit = u.meta.id;
      const r = await runStage3([u], rows, deps);
      out.builds.push(...r.builds);
      if (r.stop) {
        out.stop = r.stop;
        break;
      }
    }
    return out;
  };
  return { backend, deps, prompts, run, settled: () => settled };
}

const probe = (o: Partial<ProbeRun>): ProbeRun => ({ kind: "cli", exit: 2, stdout: "", stderr: "error: missing --name", elapsed_ms: 100, stdin_closed: true, content_type: null, ...o });

function contract(): DryCheck[] {
  const m = (o: Partial<ProbeRun>, secrets: string[] = []) => mechanical(probe(o), secrets);
  return [
    line("probe contract, signal: a CLI probe exits non-zero, an API probe returns a problem-details body", [[m({ exit: 2 }).signals, "a CLI exit 2 meets it"], [!m({ exit: 0 }).signals, "a CLI exit 0 does not"], [m({ kind: "api", exit: 0, content_type: "application/problem+json", stdout: "{\"title\":\"bad mode\"}" }).signals, "an API application/problem+json object meets it"], [!m({ kind: "api", exit: 0, content_type: "application/json", stdout: "{\"title\":\"bad mode\"}" }).signals, "an API application/json body does not"]]),
    line("probe contract, time: a probe returns within 10 seconds with stdin closed", [[m({ elapsed_ms: 9_900 }).in_time, "9.9 s meets it"], [!m({ elapsed_ms: 10_100 }).in_time, "10.1 s does not"], [!m({ elapsed_ms: 100, stdin_closed: false }).in_time, "a probe run with stdin open does not"]]),
    line("probe contract, secrets: a probe's output carries no secret value", [[m({ stderr: "error: no credential" }, ["canary-0123456789"]).no_secret, "output without the canary meets it"], [!m({ stderr: "error: token canary-0123456789 rejected" }, ["canary-0123456789"]).no_secret, "output that echoes the canary does not"]]),
  ];
}

async function sandbox(): Promise<DryCheck[]> {
  const clean = world();
  const a = await clean.run(["u1"]);
  const vms = clean.backend.vms;
  const first = preamble(fakeSpec())[0]!;
  const bad = world({ breachOn: 2 });
  const b = await bad.run(["u1", "u2"]);
  const hit = b.builds.find((x) => x.contaminated);
  let refused = false;
  try {
    await sandboxed(new FakeBackend(), fakeSpec({ owner: "", mounts: ["/mnt/drive"], env: { ANTHROPIC_API_KEY: "x" }, ttl_minutes: 60 }), "/work", async () => 0);
  } catch (e) {
    refused = /UBI_OWNER/.test((e as Error).message) && /mounts/.test((e as Error).message) && /key names/.test((e as Error).message) && /TTL/.test((e as Error).message);
  }
  return [
    line("sandbox: a clean run passes; a connection anywhere but the proxy and the mirror marks the build contaminated and missing and stops stage 3 with E_DX_SANDBOX_BREACH", [
      [a.stop === null && a.builds.length === 4 && a.builds.every((x) => x.first_success === 1 && !x.missing) && clean.settled() === 0, "a clean unit runs all 4 arms to first success and settles nothing"],
      [vms.length === 8 && vms.every((v) => v.calls[0]?.command === first && clean.backend.destroyed.has(v.id)), "each of the 8 VMs ran the preamble first and was destroyed"],
      [b.stop?.code === "E_DX_SANDBOX_BREACH" && b.stop.arm === "lens" && b.stop.breach.length === 1 && hit?.missing === true && b.builds.length === 2, "the breach on the second build stops stage 3 there, contaminated and missing"],
      [bad.settled() === 1 && bad.backend.vms.length === 3 && bad.backend.vms.every((v) => bad.backend.destroyed.has(v.id)), "the lease settles once, no later VM starts and the breached VM is destroyed"],
    ]),
    line("sandbox spec: no UBI_OWNER, a drive mount, a key in the VM or a TTL short of the session refuses to start; the fixture spec starts", [[refused, "the bad spec is refused before any VM"], [a.stop === null, "the fixture spec ran"]]),
  ];
}

async function instrument(): Promise<DryCheck[]> {
  const w = world({ baseFails: new Set(["u2"]) });
  const r = await w.run(["u1", "u2"]);
  const u2 = r.builds.filter((b) => b.unit === "u2"), u1 = r.builds.filter((b) => b.unit === "u1");
  const counts = readout(r.builds, (u) => u).counts;
  return [line("a unit whose base fails to install scores first success 0 under E_DX_BUILD_INSTRUMENT, counted and printed; a base that installs goes on", [[u2.length === 4 && u2.every((b) => b.first_success === 0 && b.code === "E_DX_BUILD_INSTRUMENT" && !b.missing) && counts.instrument === 4, "u2's 4 builds score 0 and the readout counts 4"], [u1.every((b) => b.first_success === 1 && b.code === null), "u1's base installs and its builds reach first success"], [w.prompts.length === 4, "no build session starts on u2"]])];
}

async function block(): Promise<DryCheck[]> {
  const rows = [passRow("u1", "lens", ["Make zorblat init print the next step."]), { ...passRow("u1", "autoplan", ["x"]), pass: 2 }];
  const w = world();
  await w.run(["u1"], rows);
  const lens = w.prompts[1]!, none = w.prompts[0]!;
  const planText = new TextDecoder().decode(w.backend.vms[0]!.files.get("/work/repo/plan.md"));
  return [line("build arms: the block from the stage 2 Opus pass 1 is normalized and mapped back from aliases before building, under the frozen prompt and limits", [
    [lens === BUILD_PROMPT + "\n\n1. Make fixturetool init print the next step." && !lens.includes("zorblat"), "the lens block reaches the build with the real name"],
    [armBlock(rows, "u1", "lens", { entries: [], kept: [] }).includes("zorblat"), "without the map the alias would stay"],
    [none === BUILD_PROMPT && w.prompts[3] === BUILD_PROMPT && buildPrompt("") === BUILD_PROMPT, "an arm with no pass 1 block gets the prompt alone (autoplan's pass 2 block is not used)"],
    [planText === "Add fixturetool init.", "plan.md is mapped back too"],
    [BUILD_LIMITS.dollars === 8 && BUILD_LIMITS.turns === 300 && BUILD_LIMITS.minutes === 120, "limits $8, 300 turns, 2 hours"],
  ])];
}

async function auditDraw(): Promise<DryCheck[]> {
  const ok = { pass: true, goal: true, probes: [true, true, true], problems: [] };
  const no = { pass: false, goal: false, probes: [], problems: ["fixture failure"] };
  const units = [meta("c1", 1), meta("c2", 2), meta("c3", 3), meta("c4", 4), meta("c5", 5), meta("c6", 6), meta("a1", 7, "API"), meta("s1", 8, "SDK"), meta("g1", 9, "CONFIG")];
  const tries: string[] = [];
  const d = await drawBuildUnits(units, { buildable: async (u) => u.id !== "c3", audit: async (u, n) => (tries.push(u.id + ":" + n), u.id === "c1" || (u.id === "c2" && n === 1) ? no : ok) });
  const fx = (out: string) => async (c: string) => res(c === "check-goal" ? 0 : 2, "", { stderr: out });
  const good = await audit(goalRecord("u1"), async (c) => res(c === "check-goal" ? 0 : 2, "", { stderr: PROBE_OUT[c] ?? "" }));
  const off = await audit(goalRecord("u1"), fx("error: something else"));
  return [
    line("audit: the goal must pass and each probe must reach the new surface's error path on the merged tree", [[good.pass, "a passing checker and three probes that print their error paths pass"], [!off.pass && off.goal && off.probes.every((p) => !p), "probes that miss their error paths fail"]]),
    line("build draw: a unit failing its audit twice is replaced in seeded order; one failing once stays; 4 per class where supply allows", [
      [d.replaced.length === 1 && d.replaced[0]!.unit === "c1" && tries.includes("c1:2") && !tries.includes("c1:3"), "c1 fails twice and is replaced"],
      [JSON.stringify(d.units.filter((u) => u.startsWith("c"))) === JSON.stringify(["c2", "c4", "c5", "c6"]) && tries.includes("c2:2"), "c2 passes on its second try; c3 does not build; c4 to c6 fill CLI in rank order"],
      [d.not_buildable.join() === "c3" && d.by_class.API === 1 && d.short.join() === "API,SDK,CONFIG" && d.units.length === 7, "short classes are named and nothing else is left to fill"],
    ]),
  ];
}

function pairing(): DryCheck[] {
  const b = (unit: string, arm: BuildMeasures["arm"], fs: 0 | 1, o: Partial<BuildMeasures> = {}): BuildMeasures => ({ unit, arm, first_success: fs, turns: fs ? 5 : null, minutes: fs ? 3 : null, failed_commands: fs ? 1 : null, probe_share: 1, readme_share: 0.5, code: null, instrument: null, contaminated: false, missing: false, ...o });
  const builds = [b("u1", "none", 1), b("u1", "lens", 0), b("u2", "none", 0), b("u2", "lens", 1), b("u3", "none", 0), b("u3", "lens", 1), b("u4", "none", 1, { contaminated: true, missing: true }), b("u4", "lens", 0)];
  const r = readout(builds, (u) => u);
  const fs = r.measures.find((m) => m.arm === "lens" && m.measure === "first_success")!;
  const turns = r.measures.find((m) => m.arm === "lens" && m.measure === "turns")!;
  return [line("readout: each measure paired by unit against the none block, with a 95% cluster-bootstrap interval and the worse count", [
    [fs.units === 3 && Math.abs(fs.delta! - 1 / 3) < 1e-4 && fs.worse === 1 && fs.ci95 !== null && fs.ci95[0] <= fs.delta! && fs.delta! <= fs.ci95[1], "u1 to u3 pair; delta 1/3 inside its interval; 1 unit worse"],
    [turns.units === 0 && turns.delta === null, "turns pair only where both reached first success"],
    [r.counts.contaminated === 1 && r.counts.missing === 1, "u4's contaminated none build drops u4 from the pairs and is counted"],
  ])];
}

/** Every stage 3 line of the dry run. */
export async function checks(): Promise<DryCheck[]> {
  return [...contract(), ...(await sandbox()), ...(await instrument()), ...(await block()), ...(await auditDraw()), ...pairing()];
}
