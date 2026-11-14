// Copyright (c) 2026 Garry Tan. MIT License.
// dc recipes: the base-app screen (plan section 8, R2-1, R2-7, PD-10) from the frame's sealed folder. Down the frame
// order, each candidate that passed the file check gets one recipe session and a qualification, on dc-base-apps and
// dc-hosts, through the ledger and VM providers. The frame's route sets reach the recipes area's matcher as discovered
// routes keyed by the frame's route key, so "three distinct routes" means three distinct route keys.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../errors.ts";
import type { FileCheck } from "../frame/filecheck.ts";
import { SAFE_ENV, safeArgs } from "../frame/git.ts";
import { routeKey } from "../frame/routes.ts";
import type { CloneRecord } from "../frame/run.ts";
import type { Candidate, DiscoveredRoute } from "../recipes/seams.ts";
import { runScreen, supply } from "../recipes/sessions.ts";
import { build, hostsSeam, moneySeam, routeMatcher } from "../wire.ts";
import { readJson, writeJson } from "./json.ts";
import { closeAll, need, start, underStops, type Row } from "./start.ts";

/** The frame's file-check passes in frame order as recipe candidates, with the funnel's frame counts. */
export function candidatesFromFrame(frame: string): { candidates: Candidate[]; counts: { cloneAttempts: number; clones: number; fileCheckPasses: number } } {
  const checks = readJson<Array<{ position: number; check: FileCheck }>>(join(frame, "filecheck.json"), "the frame's filecheck.json");
  const clones = readJson<CloneRecord[]>(join(frame, "clones.json"), "the frame's clones.json");
  const byPos = new Map(clones.map((c) => [c.position, c]));
  const passes = checks.filter((c) => c.check.pass).sort((x, y) => x.position - y.position);
  const candidates = passes.map(({ position, check }): Candidate => {
    const clone = byPos.get(position);
    if (!clone?.fetched || !clone.path || !clone.oid) return fail("E_USAGE", "frame position " + position + " passed the file check with no fetched clone");
    const dir = join(frame, clone.path);
    const oid = clone.oid;
    const routes: DiscoveredRoute[] = check.routeSets.flatMap((s) => s.patterns.map((p) => ({ id: routeKey(p), pattern: p, hash: s.hash, basePath: s.basePath })));
    return {
      id: "c" + String(position).padStart(3, "0"),
      pin: oid,
      routes,
      tree: async () => {
        const r = spawnSync("git", safeArgs(["archive", "--format=tar", oid], []), { cwd: dir, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", ...SAFE_ENV }, maxBuffer: 1 << 30 });
        if (r.status !== 0) throw new Error("git archive failed at frame position " + position);
        return new Uint8Array(r.stdout);
      },
    };
  });
  return { candidates, counts: { cloneAttempts: clones.length, clones: clones.filter((c) => c.fetched).length, fileCheckPasses: passes.length } };
}

export const recipesRow: Row = async (a, io, env) => {
  const usage = "recipes --frame <the frame's sealed folder> --out <new sink folder>";
  const frame = resolve(need(a, "--frame", usage));
  const sink = need(a, "--out", usage);
  const finished = existsSync(join(frame, "run.json"));
  const { candidates, counts } = finished ? candidatesFromFrame(frame) : { candidates: [], counts: { cloneAttempts: 0, clones: 0, fileCheckPasses: 0 } };
  const launch = await start({ row: "recipes", sink, items: ["dc-base-apps", "dc-hosts"], models: ["opus"], terms: [], rules: [() => (finished ? null : ["7", "--frame holds no finished frame run (run.json); the base-app screen follows the frame and the file check"])], record: { candidates: candidates.length } }, env);
  for (const l of launch.lines) io.out(l);
  const vm = build(env.providers, "vm", "recipes");
  try {
    const screen = await underStops(launch.ledger, { inRecipeVm: true }, () =>
      runScreen(candidates, {
        sandbox: { backend: vm.backend, hosts: hostsSeam(launch.ledger, vm.priceMicrosPerHour, "recipes"), now: vm.now },
        money: moneySeam(launch.ledger),
        agent: vm.recipeAgent,
        browser: vm.browser,
        match: routeMatcher,
        recipeSpec: (l) => vm.spec("recipe", l),
        qualifySpec: (l) => vm.spec("qualify", l),
        seededLogin: true,
        frame: counts,
      }),
    );
    writeJson(join(launch.sink, "screen.json"), screen);
    const s = await underStops(launch.ledger, {}, async () => supply(screen));
    for (const l of s.lines) io.out(l);
    writeJson(join(launch.sink, "base-apps.json"), s.baseApps);
    await launch.ledger.controller.settleItem("dc-base-apps");
    io.out(s.status === "ok" ? "recipes: " + s.baseApps.length + " base apps" : "recipes: " + s.baseApps.length + " base apps; to the Captain: " + s.why);
    return s.status === "ok" ? 0 : 2;
  } finally {
    await closeAll(vm, launch.ledger);
  }
};
