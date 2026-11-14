// Copyright (c) 2026 Garry Tan. MIT License.
// dc recipes: the base-app screen (plan section 8, R2-1, R2-7, PD-10) from the frame's sealed folder. Down the frame
// order, each candidate that passed the file check gets one recipe session and a qualification, on dc-base-apps and
// dc-hosts, through the ledger and VM providers. The frame's route sets reach the recipes area's matcher as discovered
// routes keyed by the frame's route key, so "three distinct routes" means three distinct route keys.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DcError, fail } from "../errors.ts";
import type { FileCheck } from "../frame/filecheck.ts";
import { SAFE_ENV, safeArgs } from "../frame/git.ts";
import { routeKey } from "../frame/routes.ts";
import type { CloneRecord } from "../frame/run.ts";
import type { BrowserSeam, Candidate, DiscoveredRoute } from "../recipes/seams.ts";
import { runScreen, supply, type CandidateRecord } from "../recipes/sessions.ts";
import { NODE } from "../stage3/install.ts";
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

/**
 * Probe 1D (PD-42): stage 0's first qualification is the first time the VM's browser launches. When that launch fails
 * (the browser itself, as opposed to an app that fails to render), the row stops with E_DCW_BROWSER_LAUNCH before any
 * further recipe session; the sandbox still audits and deletes the VM first. Once one launch has passed, later launches
 * fail the way a qualification run fails outside the app.
 */
export function probe1D(browser: BrowserSeam, log: (line: string) => void): BrowserSeam {
  let launched = false;
  return {
    async open(vm, baseUrl) {
      if (launched) return browser.open(vm, baseUrl);
      try {
        const session = await browser.open(vm, baseUrl);
        launched = true;
        log("probe 1D: the VM's browser launched in " + vm.spec.label);
        return session;
      } catch (e) {
        throw new DcError("E_DCW_BROWSER_LAUNCH", "probe 1D: the VM's browser did not launch in " + vm.spec.label + ", the first qualification: " + (e as Error).message + "; the screen stops before any further recipe session");
      }
    },
  };
}

/** The Captain's Node ruling: this many Node-version drops stop the lane before the gate check and authoring. */
export const NODE_DROP_STOP = 3;

/** node-drops.json in the recipes sink: the pinned Node and the labels of the candidates that dropped for a Node-version cause. */
export interface NodeDrops {
  pinned: string;
  count: number;
  labels: string[];
}

/** The candidates that did not qualify and either declare a range the pinned Node falls outside or failed on an engine-mismatch error. */
export function nodeDrops(records: readonly CandidateRecord[]): NodeDrops {
  const labels = records.filter((r) => !r.strict && (r.node?.pinnedFits === "no" || r.qualification?.engineError === true)).map((r) => r.id);
  return { pinned: NODE.version, count: labels.length, labels };
}

export const nodeDropsLine = (n: NodeDrops) =>
  "node-version drops: " + n.count + (n.count ? " (" + n.labels.join(", ") + ")" : "") + " at pinned Node " + n.pinned + (n.count >= NODE_DROP_STOP ? "; " + NODE_DROP_STOP + " or more, so gatecheck and author refuse until the Captain clears the list" : "");

/**
 * The Captain's Node ruling as a start rule for the gate check and authoring: --screen names the recipes sink, whose
 * node-drops.json must exist (rule 7). 3 or more drops refuse with E_DCW_NODE_DROPS naming the labels, until the Captain
 * clears that exact list with node-cleared.json in the same sink: {"labels": [the same labels]}.
 */
export const nodeDropRule = (screen: string | undefined) => (): [string, string] | null => {
  const what = "the gate check and authoring follow stage 0's Node-version count";
  if (!screen) return ["7", what + ", and --screen names no recipes sink"];
  const p = join(resolve(screen), "node-drops.json");
  if (!existsSync(p)) return ["7", what + ", and " + p + " is missing"];
  const d = readJson<Partial<NodeDrops>>(p, "--screen's node-drops.json");
  if (!Array.isArray(d.labels) || !d.labels.every((l) => typeof l === "string")) return ["7", what + ", and " + p + " records no labels"];
  if (d.labels.length < NODE_DROP_STOP) return null;
  const c = join(resolve(screen), "node-cleared.json");
  const cleared = existsSync(c) ? readJson<{ labels?: unknown }>(c, "--screen's node-cleared.json").labels : undefined;
  const key = (l: readonly unknown[]) => JSON.stringify([...l].sort());
  if (Array.isArray(cleared) && key(cleared) === key(d.labels)) return null;
  return fail("E_DCW_NODE_DROPS", d.labels.length + " stage 0 candidates dropped for a Node-version cause at pinned Node " + (d.pinned ?? NODE.version) + ": " + d.labels.join(", ") + ". " + NODE_DROP_STOP + " or more stop the gate check and authoring until the Captain clears this list" + (cleared === undefined ? "" : "; node-cleared.json names another list"));
};

export const recipesRow: Row = async (a, io, env) => {
  const usage = "recipes --frame <the frame's sealed folder> --out <new sink folder>";
  const frame = resolve(need(a, "--frame", usage));
  const sink = need(a, "--out", usage);
  const finished = existsSync(join(frame, "run.json"));
  const { candidates, counts } = finished ? candidatesFromFrame(frame) : { candidates: [], counts: { cloneAttempts: 0, clones: 0, fileCheckPasses: 0 } };
  const launch = await start({ row: "recipes", sink, items: ["dc-base-apps", "dc-hosts"], models: ["opus"], terms: [], rules: [() => (finished ? null : ["7", "--frame holds no finished frame run (run.json); the base-app screen follows the frame and the file check"])], record: { candidates: candidates.length } }, env);
  for (const l of launch.lines) io.out(l);
  const vm = await build(env.providers, "vm", "recipes");
  try {
    const screen = await underStops(launch.ledger, { inRecipeVm: true }, () =>
      runScreen(candidates, {
        sandbox: { backend: vm.backend, hosts: hostsSeam(launch.ledger, vm.priceMicrosPerHour, "recipes"), now: vm.now },
        money: moneySeam(launch.ledger),
        agent: vm.recipeAgent,
        browser: probe1D(vm.browser, io.out),
        match: routeMatcher,
        recipeSpec: (l) => vm.spec("recipe", l),
        qualifySpec: (l) => vm.spec("qualify", l),
        seededLogin: true,
        frame: counts,
      }),
    );
    writeJson(join(launch.sink, "screen.json"), screen);
    const drops = nodeDrops(screen.records);
    writeJson(join(launch.sink, "node-drops.json"), drops);
    io.out(nodeDropsLine(drops));
    const s = await underStops(launch.ledger, {}, async () => supply(screen));
    for (const l of s.lines) io.out(l);
    writeJson(join(launch.sink, "base-apps.json"), s.baseApps);
    await launch.ledger.controller.settleItem("dc-base-apps");
    io.out("recipes: " + s.baseApps.length + " base apps, " + drops.count + " node-version drops" + (s.status === "ok" ? "" : "; to the Captain: " + s.why));
    return s.status === "ok" ? 0 : 2;
  } finally {
    await closeAll(vm, launch.ledger);
  }
};
