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
//
// It then runs one recipe VM, the kind a recipe session runs in, with the VM proxy endpoint in its spec: the preamble
// and the controller's whole install, Claude Code from the pinned tarball included, then Claude Code's check as the run
// user and one request from the run user through the egress filter to the proxy endpoint for a slot nothing bound, which
// the VM front answers 404 "no such slot" without reaching any proxy or model (stage3/front.ts). The audit must pass and
// show an accepted connection to the proxy endpoint. Last, one stage 1 review container on this host runs the sessions
// row's own steps with no model call (wire/preflight-container.ts). No model is called, and only dc-hosts admits anything.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { RECIPES } from "../frozen.ts";
import { routeUrl, setupSteps } from "../recipes/qualify.ts";
import { parseRecipe, type Recipe } from "../recipes/recipe.ts";
import type { BrowserSeam } from "../recipes/seams.ts";
import { tarOf } from "../stage3/install.ts";
import { AGENT_CLAUDE } from "../stage3/install.ts";
import { causeText, NET_PREFIX, sandboxed, SESSION_MARK, stepStderr, type SandboxDeps, type VmSpec } from "../stage3/sandbox.ts";
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

/** BT: the slot the recipe VM's request names; nothing binds it, so the VM front answers 404 and reaches no proxy. */
export const PREFLIGHT_SLOT = "dc-preflight-unbound";

/**
 * One recipe VM with the proxy endpoint in its spec: the preamble, the controller's install (Claude Code included),
 * Claude Code's check as the run user, and one no-model request from the run user to the proxy endpoint. The audit must
 * pass and show an accepted connection to the proxy endpoint. Its lines in step order and every problem.
 */
export async function runRecipePreflight(d: { sandbox: SandboxDeps; spec: VmSpec }): Promise<{ lines: string[]; problems: string[] }> {
  const proxy = d.spec.proxy ?? fail("E_INTERNAL", "the preflight's recipe VM spec names no proxy endpoint");
  const job: string[] = [];
  const problems: string[] = [];
  const seen: { vm: string | null; hours: number | null } = { vm: null, hours: null };
  const hosts = { admit: d.sandbox.hosts.admit, settle: async (id: string, hours: number) => ((seen.hours = hours), d.sandbox.hosts.settle(id, hours)) };
  const run = await sandboxed({ ...d.sandbox, hosts }, d.spec, async (vm) => {
    seen.vm = vm.id;
    const b = d.sandbox.backend;
    const failed = (what: string, r: { exit: number; stderr: string }) => {
      const line = what + ": failed (exit " + r.exit + ")" + (r.stderr.trim() ? ": " + causeText(r.stderr) : "");
      job.push(line);
      problems.push(line);
    };
    const claude = await b.exec(vm, "'" + AGENT_CLAUDE + "' --version", { user: "run" });
    if (claude.exit !== 0) return failed("Claude Code's check as the run user", claude);
    job.push("Claude Code's check as the run user: ok" + (claude.stdout.trim() ? ", " + oneLine(claude.stdout.trim()).slice(0, 80) : ""));
    const reach = await b.exec(vm, "curl -sS --max-time 20 -w '\\n%{http_code}' 'http://" + proxy.host + ":" + proxy.port + "/" + PREFLIGHT_SLOT + "'", { user: "run", timeoutMs: 60_000 });
    if (reach.exit !== 0) return failed("the proxy endpoint from the run user", reach);
    const answer = reach.stdout.trim().split("\n");
    const line = "the proxy endpoint from the run user: HTTP " + (answer.at(-1) ?? "none") + " for an unbound slot";
    job.push(line + ", no model called");
    if (answer.at(-1) !== "404" || answer[0] !== "no such slot") problems.push(line + ", not the VM front's 404 \"no such slot\"");
  });
  const lines: string[] = [];
  if (seen.vm !== null) {
    lines.push("preamble: ok", "install: ok, Claude Code included", ...job);
    if (run.error) {
      lines.push("job: failed: " + causeText(run.error));
      problems.push("the job failed");
    }
  } else if (run.error?.startsWith("preamble step failed")) {
    lines.push("preamble: " + causeText(run.error), "install: not run");
    problems.push("the preamble failed");
  } else if (run.error?.startsWith("the controller's install failed")) {
    lines.push("preamble: ok", "install: " + causeText(run.error));
    problems.push("the install failed");
  } else {
    lines.push("vm: " + causeText(run.error ?? "the job never ran"));
    problems.push("no VM ran the job");
  }
  const a = run.audit;
  lines.push("audit: " + (a.ok ? "ok" : a.kind + ": " + a.reasons.map(oneLine).join("; ")));
  if (!a.ok) problems.push("the audit is " + a.kind);
  const egress = a.evidence.egress;
  const toProxy = (egress ?? []).filter((c) => c.host === proxy.host && c.port === proxy.port).length;
  lines.push("egress: " + (egress ? egress.length + " accepted (" + toProxy + " to the proxy endpoint), " + (a.evidence.blocked?.length ?? 0) + " blocked" : "not read"));
  if (egress && !toProxy) problems.push("the audit saw no accepted " + NET_PREFIX.trim() + " connection to the proxy endpoint");
  lines.push("vm: " + (seen.vm ?? "the VM") + (run.destroyError ? " was not deleted (" + causeText(run.destroyError) + "); the runner's reaper deletes it past its time to live" : " deleted") + ", " + (seen.hours === null ? "no measured time" : (seen.hours * 60).toFixed(1) + " measured minutes"));
  if (run.destroyError) problems.push("the VM was not deleted");
  return { lines, problems };
}

export const preflightRow: Row = async (a, io, env) => {
  const sink = need(a, "--out", "preflight --out <new sink folder>");
  const recipe = preflightRecipe();
  const launch = await start({ row: "preflight", sink, items: ["dc-hosts"], models: [], terms: [], record: { fixture: "lanes/design-constructed/wire/preflight" } }, env);
  for (const l of launch.lines) io.out(l);
  const vm = await build(env.providers, "vm", "preflight");
  const review = await build(env.providers, "review", "preflight");
  try {
    const sandbox = { backend: vm.backend, hosts: hostsSeam(launch.ledger, vm.priceMicrosPerHour, "preflight"), now: vm.now };
    let r: Awaited<ReturnType<typeof runPreflight>>;
    let recipeVm: Awaited<ReturnType<typeof runRecipePreflight>>;
    try {
      r = await runPreflight({ sandbox, spec: vm.spec("qualify", "preflight qualification"), browser: vm.browser, recipe, app: () => tarOf(join(PREFLIGHT_DIR, "app")) });
      for (const l of r.lines) io.out("preflight: " + l);
      recipeVm = await runRecipePreflight({ sandbox, spec: vm.spec("recipe", "preflight recipe") });
      for (const l of recipeVm.lines) io.out("preflight recipe: " + l);
    } catch (e) {
      if (e instanceof CapStopSignal) return fail("E_DCW_PREFLIGHT", e.message + "; no preflight VM was made");
      throw e;
    }
    const container = await review.check(join(launch.sink, "review-container"));
    for (const l of container.lines) io.out("preflight container: " + l);
    writeJson(join(launch.sink, "preflight.json"), { ...r, recipe: recipeVm, container });
    const problems = [...r.problems, ...recipeVm.problems.map((p) => "recipe VM: " + p), ...container.problems.map((p) => "review container: " + p)];
    if (problems.length) fail("E_DCW_PREFLIGHT", "the preflight failed: " + problems.join("; ") + "; the clones row and every later row refuse until a preflight passes");
    io.out("preflight: passed; the clones row may follow");
    return 0;
  } finally {
    await closeAll(vm, review, launch.ledger);
  }
};
