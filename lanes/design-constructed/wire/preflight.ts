// Copyright (c) 2026 Garry Tan. MIT License.
// dc preflight: the no-model check each launch of this lane runs after the model probe and before the clones row. It
// builds the VM provider the recipes row uses (wire/real.ts: the same wiring, mirrors and sizes) and runs one offline
// qualification VM through sandboxed(): the full preamble, the controller's install, then a job that touches the session
// marker, reads the kernel log's DCNET count, copies the fixture app in wire/preflight/app in as qualification copies a
// candidate's tree, and runs qualification's own steps on the fixture recipe (recipes/qualify.ts setupSteps): its Redis
// service pulled through the dockerhub mirror and started with docker run, pnpm through corepack and the npm mirror. It
// loads the recipe's first route once in the pinned Chromium and requires HTTP 200; the page answers 200 only when the
// service answers. The audit must pass and must show at least one accepted connection to a mirror endpoint. Nothing is
// scored and no model is called; the VM settles on dc-hosts. The lines carry step names, exit codes, counts and the
// audit's reasons, never key or unit text. Any failure exits with E_DCW_PREFLIGHT, and the host refuses the clones row
// and every later row until a preflight passes (wire/host.ts preflightRule).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { RECIPES } from "../frozen.ts";
import { routeUrl, setupSteps } from "../recipes/qualify.ts";
import { parseRecipe, type Recipe } from "../recipes/recipe.ts";
import type { BrowserSeam } from "../recipes/seams.ts";
import { tarOf } from "../stage3/install.ts";
import { NET_PREFIX, sandboxed, SESSION_MARK, stepStderr, type SandboxDeps, type VmSpec } from "../stage3/sandbox.ts";
import { CapStopSignal } from "../stage3/seams.ts";
import { build, hostsSeam } from "../wire.ts";
import { writeJson } from "./json.ts";
import { closeAll, need, start, type Row } from "./start.ts";

/** The fixture: app/ is the tiny JS app the VM qualifies, recipe.json its recipe in the lane's format. */
export const PREFLIGHT_DIR = join(import.meta.dir, "preflight");

/** The fixture recipe, read the way a recipe session's recipe.json is read. */
export function preflightRecipe(dir = PREFLIGHT_DIR): Recipe {
  const r = parseRecipe(readFileSync(join(dir, "recipe.json"), "utf8"), { seededLogin: false });
  if (!r.ok) return fail("E_INTERNAL", "the preflight recipe does not read: " + r.problems.join("; "));
  return r.recipe;
}

export interface PreflightDeps {
  sandbox: SandboxDeps;
  /** An offline qualification spec: no proxy, the named mirrors only. */
  spec: VmSpec;
  browser: BrowserSeam;
  recipe: Recipe;
  /** The fixture app as a tar, copied in as qualification copies a candidate's tree. */
  app: () => Promise<Uint8Array>;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");

/** One preflight VM: its lines in step order, and every problem; no problem means it passed. */
export async function runPreflight(d: PreflightDeps): Promise<{ lines: string[]; problems: string[] }> {
  const job: string[] = [];
  const problems: string[] = [];
  const seen: { vm: string | null; hours: number | null } = { vm: null, hours: null };
  const hosts = {
    admit: d.sandbox.hosts.admit,
    settle: async (id: string, hours: number) => {
      seen.hours = hours;
      await d.sandbox.hosts.settle(id, hours);
    },
  };
  const dcnet = NET_PREFIX.trim();
  const run = await sandboxed({ ...d.sandbox, hosts }, d.spec, async (vm) => {
    seen.vm = vm.id;
    const b = d.sandbox.backend;
    const failed = (what: string, r: { exit: number; stderr: string }) => {
      const line = what + ": failed (exit " + r.exit + ")" + (r.stderr.trim() ? ": " + stepStderr(r.stderr) : "");
      job.push(line);
      problems.push(line);
    };
    const mark = await b.exec(vm, "touch " + SESSION_MARK, { user: "root" });
    if (mark.exit !== 0) return failed("the session marker", mark);
    const count = await b.exec(vm, "journalctl -k -o cat --no-pager | grep -c " + dcnet, { user: "root" });
    if (count.exit > 1 || !/^\d+$/.test(count.stdout.trim())) return failed("the egress self-check count", count);
    job.push("egress self-check: " + dcnet + " count " + count.stdout.trim() + " in the kernel log after the install");
    await b.write(vm, "/work/app.tar", await d.app());
    let service = 0;
    for (const s of setupSteps(d.recipe)) {
      const r = await b.exec(vm, s.command, { user: s.user, timeoutMs: s.minutes * 60_000 });
      const svc = s.step === "services" ? d.recipe.services[service++]! : null;
      const what = "qualify " + s.step + (svc ? " " + svc.name : "");
      if (r.exit !== 0) return failed(what, r);
      job.push(what + ": ok" + (svc ? ", " + svc.image + " pulled through the dockerhub mirror and started with docker run" : ""));
    }
    const path = d.recipe.routes[0]!;
    const viewport = RECIPES.viewports[0];
    let status: number | null;
    try {
      const session = await d.browser.open(vm, d.recipe.baseUrl);
      try {
        status = (await session.load(routeUrl(d.recipe.baseUrl, path), viewport)).status;
      } finally {
        await session.close();
      }
    } catch (e) {
      const line = "page " + path + ": the pinned Chromium failed: " + stepStderr((e as Error).message);
      job.push(line);
      problems.push(line);
      return;
    }
    const line = "page " + path + " at " + viewport[0] + "x" + viewport[1] + " in the pinned Chromium: " + (status === null ? "no response" : "HTTP " + status);
    job.push(line);
    if (status !== 200) problems.push(line + ", not HTTP 200");
  });
  const lines: string[] = [];
  if (seen.vm !== null) {
    lines.push("preamble: ok", "install: ok", ...job);
    if (run.error) {
      lines.push("job: failed: " + oneLine(stepStderr(run.error)));
      problems.push("the job failed");
    }
  } else if (run.error?.startsWith("preamble step failed")) {
    lines.push("preamble: " + oneLine(run.error), "install: not run");
    problems.push("the preamble failed");
  } else if (run.error?.startsWith("the controller's install failed")) {
    lines.push("preamble: ok", "install: " + oneLine(run.error));
    problems.push("the install failed");
  } else {
    lines.push("vm: " + oneLine(run.error ?? "the job never ran"));
    problems.push("no VM ran the job");
  }
  const a = run.audit;
  lines.push("audit: " + (a.ok ? "ok" : a.kind + ": " + a.reasons.map(oneLine).join("; ")));
  if (!a.ok) problems.push("the audit is " + a.kind);
  const egress = a.evidence.egress;
  const toMirror = (egress ?? []).filter((c) => d.spec.mirrors.some((m) => m.host === c.host && m.port === c.port)).length;
  lines.push("egress: " + (egress ? egress.length + " accepted (" + toMirror + " to a mirror endpoint), " + (a.evidence.blocked?.length ?? 0) + " blocked" : "not read"));
  if (egress && !toMirror) problems.push("the audit saw no accepted " + dcnet + " connection to a mirror endpoint");
  const minutes = seen.hours === null ? "no measured time" : (seen.hours * 60).toFixed(1) + " measured minutes";
  lines.push("vm: " + (seen.vm ?? "the VM") + (run.destroyError ? " was not deleted (" + oneLine(stepStderr(run.destroyError)) + "); the runner's reaper deletes it past its time to live" : " deleted") + ", " + minutes);
  if (run.destroyError) problems.push("the VM was not deleted");
  return { lines, problems };
}

export const preflightRow: Row = async (a, io, env) => {
  const sink = need(a, "--out", "preflight --out <new sink folder>");
  const recipe = preflightRecipe();
  const launch = await start({ row: "preflight", sink, items: ["dc-hosts"], models: [], terms: [], record: { fixture: "lanes/design-constructed/wire/preflight" } }, env);
  for (const l of launch.lines) io.out(l);
  const vm = await build(env.providers, "vm", "preflight");
  try {
    let r: Awaited<ReturnType<typeof runPreflight>>;
    try {
      r = await runPreflight({ sandbox: { backend: vm.backend, hosts: hostsSeam(launch.ledger, vm.priceMicrosPerHour, "preflight"), now: vm.now }, spec: vm.spec("qualify", "preflight qualification"), browser: vm.browser, recipe, app: () => tarOf(join(PREFLIGHT_DIR, "app")) });
    } catch (e) {
      if (e instanceof CapStopSignal) return fail("E_DCW_PREFLIGHT", e.message + "; no preflight VM was made");
      throw e;
    }
    writeJson(join(launch.sink, "preflight.json"), r);
    for (const l of r.lines) io.out("preflight: " + l);
    if (r.problems.length) fail("E_DCW_PREFLIGHT", "the preflight failed: " + r.problems.join("; ") + "; the clones row and every later row refuse until a preflight passes");
    io.out("preflight: passed; the clones row may follow");
    return 0;
  } finally {
    await closeAll(vm, launch.ledger);
  }
};
