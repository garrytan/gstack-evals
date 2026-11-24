#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit read's driven launch (prereg 2026-11-15-geva-537 section 13; the CREW "pin needs a driven launch"
// rule), keyless: one Go fixture unit built by eng-build's unit builder, then its three review arms through the real
// review launcher (eng-build launch.ts reviewLauncher on the Docker rig, both skill arms installed at RESTORE_PIN and
// checked by digest, the eng phase opening rendered at the pin, the Stop hook live) and one standalone-reviewed build
// through the real build launcher (Harbor at its pin, real_agent's non-SM path, the real-outcome sandbox sidecar, the
// session image) with the review's final plan.md and review files mounted. A stub Anthropic upstream in this process
// stands in for the model: in a review it rewrites /work/plan.md once, then ends its turn; in the build it reads
// /work/review/review.md, writes the fixed Mul and a test, then ends its turn. Every lease opens on a temporary ledger
// whose items are inited in the program as the run's are, and settles. Every key variable is removed before anything
// starts; the upstream key is a placeholder only the stub sees. It prints one PASS or FAIL line per check, counts and
// outcome words only, and removes the images it made.
// Usage: bun lanes/eng-planted/stages/e2e.ts --harbor <harbor bin> --gstack <gstack checkout at RESTORE_PIN> [--keep]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sse } from "../../../quick/laneb/runner/fake_upstream.ts";
import { recordProgram } from "../../../src/runner/ledger/envelope.ts";
import { machineId, recordApproval } from "../../../src/runner/ledger/ledger.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { goRepo, GO_CALC, GO_FIXED } from "../../../tests/eng-build/fixture.ts";
import { removeCoverageImages } from "../../eng-build/coverage.ts";
import { buildLauncher, reviewLauncher } from "../../eng-build/launch.ts";
import { underLease, unitGrader } from "../../eng-build/pipeline.ts";
import { removeLabelled } from "../../eng-build/screen.ts";
import { removeSessionImages } from "../../eng-build/session-image.ts";
import { buildUnit } from "../../eng-build/unit.ts";
import { startSidecar } from "../../real-outcome/sandbox/sidecar.ts";
import type { PlantedGrader, PlantedUnit, ReviewArm, ReviewRecord } from "../types.ts";
import { EB_ARM, plantedOpening, skillPin } from "./arms.ts";
import { buildKey, ebSession, runPlantedBuild, type MountTable } from "./build.ts";
import { ITEMS, itemOf, ItemGate, runGated } from "./ledger.ts";
import { EP_PROGRAM, EP_RUN, EP_SKILL } from "./local.ts";
import { reviewKey, runPlantedReviews } from "./pipeline.ts";
import { dropKeyEnv } from "../../../src/trial/env.ts";

export interface Check {
  check: string;
  ok: boolean;
  detail: string;
}

const D = 1_000_000;
const REVIEWED = "# Plan\n\nAdd Mul(a, b int) int to the calculator, with tests. Mul returns the product of a and b.\n\n## Review\n\nTest Mul with a zero on either side.\n";
const AUTHORED = "# Plan\n\nAdd Mul(a, b int) int to the calculator, with tests.\n";
const REPLY = "Review done: the plan now says how to test Mul.";
const ARMS: ReviewArm[] = ["plain", "standalone", "engphase"];
const b64 = (s: string) => Buffer.from(s).toString("base64");

/** One build through its item's gate, the way the stages run every build: the build's cost, or the spend its error
 * carries, settles on the gate's journal. */
export async function gatedBuild<T extends { costUsd: number }>(gate: ItemGate, cell: string, build: () => Promise<T>): Promise<T> {
  let built = null as T | null;
  await runGated([cell], {
    gate,
    kind: () => "build",
    key: (c) => c,
    run: async () => {
      built = await build();
      return { costUsd: built.costUsd };
    },
  });
  return built!;
}

/** Runs the driven launch and returns its checks; the dry run reads ok and one line from it. */
export async function drivenLaunch(o: { harbor?: string; gstack?: string; keep?: boolean; log?: (l: string) => void } = {}): Promise<{ ok: boolean; detail: string; checks: Check[] }> {
  dropKeyEnv();
  const log = o.log ?? ((l: string) => console.error(l));
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => {
    checks.push({ check: name, ok, detail });
    log((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  const harbor = o.harbor ?? process.env.GSTACK_EVALS_HARBOR ?? "harbor";
  const gstack = o.gstack ?? process.env.GSTACK_EVALS_RESTORE_CHECKOUT ?? join(homedir(), ".capy", "work", "wt-restore");
  const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 300_000 });
  const pin = skillPin();
  mkdirSync(join(homedir(), ".capy", "work"), { recursive: true });
  const W = mkdtempSync(join(homedir(), ".capy", "work", "ep-e2e-"));
  const stubSeen: Array<{ main: boolean; tools: string[]; first: boolean }> = [];
  let buildRead = "";
  const stub = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return Response.json({});
      const body = (await req.json()) as Record<string, any>;
      if (path.endsWith("/count_tokens")) return Response.json({ input_tokens: 10 });
      const tools: string[] = Array.isArray(body.tools) ? body.tools.map((t: any) => t.name ?? t.type) : [];
      const main = tools.includes("Bash");
      const text = JSON.stringify(body.messages ?? []);
      const first = main && !text.includes("tool_result");
      stubSeen.push({ main, tools, first });
      const building = text.includes("Implement the plan in plan.md");
      if (main && building && !first && !buildRead) buildRead = text.includes(REPLY) ? "read" : "not read";
      const command = building
        ? "cat /work/review/review.md && cd /work/repo && echo " + b64(GO_CALC + GO_FIXED) + " | base64 -d > calc.go && echo " + b64('package calc\n\nimport "testing"\n\nfunc TestMulBuild(t *testing.T) {\n\tif Mul(0, 5) != 0 || Mul(2, 3) != 6 {\n\t\tt.Fatal("mul")\n\t}\n}\n') + " | base64 -d > calc_mul_test.go"
        : "echo " + b64(REVIEWED) + " | base64 -d > /work/plan.md";
      const reply = first ? [{ type: "tool_use", id: "toolu_ep_e2e_" + stubSeen.length, name: "Bash", input: { command, description: building ? "Read the review, write Mul and its test" : "Rewrite the plan" } }] : [{ type: "text", text: building ? "Done." : REPLY }];
      if (body.stream) return new Response(sse(body.model, reply as any), { headers: { "content-type": "text/event-stream" } });
      return Response.json({ id: "msg_ep_e2e", type: "message", role: "assistant", model: body.model, content: reply, stop_reason: first ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    },
  });
  const gw = docker(["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"]).stdout.trim();
  const sidecar = startSidecar({ root: join(W, "sidecar"), agentHost: gw, agentPort: 0, controlPort: 0 });
  const record = join(W, "record");
  const ledger = join(W, "ledger.sqlite");
  const quote = { words: "keyless driven launch on a temporary ledger, not an approval", by: "ep e2e", source: "lanes/eng-planted/stages/e2e.ts" };
  const total = ITEMS.reduce((s, i) => s + i.capUsd, 0);
  let unitImage = "";
  try {
    recordProgram(record, { program: EP_PROGRAM, cap_micros: total * D, skill_cap_micros: total * D, skills: [EP_SKILL], credit_rate_micros: D, quotes: [quote] });
    for (const i of ITEMS) recordApproval(record, { action: "init", item: i.item, cap_micros: i.capUsd * D, quotes: [quote], admission: "warn", program: EP_PROGRAM, skills: [EP_SKILL] });

    const fx = goRepo(join(W, "fixture"));
    const id = fx.spec.id;
    const unitDir = join(W, "units", id);
    const built = buildUnit(fx.spec, fx.repo, unitDir, { work: join(W, "work"), labels: join(W, "labels.json"), seed: 7 });
    unitImage = built.eb.image.id;
    check("fixture unit qualifies", built.qualifies, built.eb.unit.functional.length + " functional, " + built.eb.unit.aftermath.reduce((s, a) => s + a.cases.length, 0) + " planted cases");
    const base = join(W, "repos", id);
    mkdirSync(base, { recursive: true });
    const git = (args: string[]) => spawnSync("git", ["-C", base, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
    spawnSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", fx.repo, fx.sha.base!, base]);
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    const plan = join(W, "author", id, "plan.md");
    mkdirSync(join(W, "author", id), { recursive: true });
    writeFileSync(plan, AUTHORED);
    const planted = built.eb.unit.aftermath.flatMap((a) => a.cases);
    const unit: PlantedUnit = { id, repo: "fixture", set: "comparison", ecosystem: "go", stars: "300-999", publicMonth: "2026-10", strictWindow: true, regionLines: 3, planted, plantedClass: Object.fromEntries(planted.map((c) => [c, "assert"])), functional: built.eb.unit.functional, foresee: null, winnable: null, hard: null, pilot: false };
    const opening = plantedOpening({ gstack, plan: AUTHORED, out: join(W, "opening"), pin });

    const reviewsOut = join(W, "reviews");
    const reviewItem = itemOf("ep-comparison");
    const rp = { item: reviewItem.item, capUsd: 40, record, ledger };
    const records: ReviewRecord[] = await underLease(rp, reviewLauncher({ arms: ARMS.map((a) => EB_ARM[a]), reviewer: "opus", out: join(reviewsOut, "rig"), env: { ...process.env, ANTHROPIC_API_KEY: "stub-not-a-key" }, log, pins: { precut: pin, engphase: pin }, runId: EP_RUN, upstream: "http://host.docker.internal:" + stub.port }), async (session) => {
      check("the review lease is open while sessions run", readItem(record, reviewItem.item).open !== null, "1 lease open on " + reviewItem.item);
      return runPlantedReviews({ cells: ARMS.map((arm) => ({ unit: id, arm, rep: 1 })), units: new Map([[id, { unit, base, plan, opening }]]), reviewer: "opus", out: reviewsOut, session, gate: new ItemGate(reviewItem, { capUsd: 40, planned: { "review:plain": 1, "review:standalone": 1, "review:engphase": 1, build: 0 } }), interim: false, log });
    });
    const rec = (arm: ReviewArm) => records.find((r) => r.arm === arm);
    check("three reviews complete", ARMS.every((a) => rec(a)?.outcome === "completed"), ARMS.map((a) => a + " " + (rec(a)?.outcome ?? "none")).join(", "));
    check("the Stop hook blocks each unexposed skill arm twice and never plain", rec("plain")?.blocks === 0 && rec("standalone")?.blocks === 2 && rec("engphase")?.blocks === 2, ARMS.map((a) => a + " " + (rec(a)?.blocks ?? "?")).join(", ") + " blocks");
    const mountDir = join(reviewsOut, "mounts", reviewKey(id, "standalone", "opus", 1));
    const mounted = existsSync(join(mountDir, "plan.md")) ? readFileSync(join(mountDir, "plan.md"), "utf8") : "";
    check("the standalone build mounts the review's final plan.md", mounted === REVIEWED && existsSync(join(mountDir, "review", "review.md")), mounted === REVIEWED ? "the reviewed plan, with review.md under review/" : "plan.md holds other bytes");

    const table: MountTable = new Map();
    const buildItem = itemOf("ep-stock");
    const bp = { item: buildItem.item, capUsd: 20, record, ledger };
    const machine = machineId();
    const inner = buildLauncher({ arm: "plain", units: new Map([[id, { dir: unitDir }]]), repos: join(W, "repos"), plans: join(W, "author"), bundles: null, out: join(W, "build"), host: gw, envelopeHost: machine, sidecar: sidecar.controlUrl, forbidden: [join(W, "units"), join(homedir(), ".capy", "drive")], planned: 1, harbor, planFor: (cell) => table.get(cell)!.plan, reviewFor: (cell) => table.get(cell)!.review, runId: EP_RUN, skill: EP_SKILL, serve: { machine, fetch: (url, init) => fetch(url.replace("https://api.anthropic.com", "http://127.0.0.1:" + stub.port), init), env: { ANTHROPIC_API_KEY: "stub-not-a-key" }, requireAdmission: () => null, log } });
    const g = unitGrader({ dirs: new Map([[id, unitDir]]), work: join(W, "work"), log });
    const grader: PlantedGrader = {
      grade: async (_u, _dir, tree) => {
        const r = await g({ unit: built.eb.unit, tree });
        return { planted: Object.values(r.aftermath).flat(), functional: r.functional };
      },
      catchOf: async () => ({ catch: null, drop: "the driven launch grades avoid only; the catch rule is the construct part's" }),
    };
    const buildGate = new ItemGate(buildItem, { capUsd: 20, planned: { build: 1 } });
    const b = await underLease(bp, async (p) => {
      const h = await inner(p);
      return { ...h, backend: ebSession(h.backend, table) };
    }, (session) => gatedBuild(buildGate, buildKey(id, "standalone", "opus", 1), () => runPlantedBuild({ unit, unitDir, arm: "standalone", reviewer: "opus", rep: 1, note: "The change adds Mul(a, b int) int, which returns the product of a and b.", mount: { plan: join(mountDir, "plan.md"), review: join(mountDir, "review") }, review: rec("standalone") ?? null, session, grader, log })));
    check("the build's session settled on the item gate", buildGate.sessions() === 1 && buildGate.settled() === b.costUsd, buildGate.sessions() + " session settled at $" + buildGate.settled().toFixed(4) + ", the build's cost $" + b.costUsd.toFixed(4));
    const passing = (c: { runs: string[] }[]) => c.filter((x) => x.runs.filter((r) => r === "pass").length >= 2).length;
    check("the build completes and reads the review", b.outcome === "completed" && b.readReview === true && buildRead === "read", "outcome " + b.outcome + ", readReview " + b.readReview + ", the builder's tool result " + (buildRead || "missing"));
    check("the grader scores the built tree", passing(b.planted) === planted.length && passing(b.functional) === b.functional.length, "planted " + passing(b.planted) + " of " + b.planted.length + " pass, functional " + passing(b.functional) + " of " + b.functional.length + ", cell " + buildKey(id, "standalone", "opus", 1));
  } catch (e) {
    check("the driven launch ran", false, (e as Error).message.slice(0, 800));
  } finally {
    for (const item of ["ep-comparison", "ep-stock"]) {
      const it = readItem(record, item);
      check("one lease opened and settled on " + item, it.open === null && it.leases.length === 1 && it.leases[0]!.close !== null, it.leases.length + " opened, " + it.leases.filter((l) => l.close !== null).length + " settled");
    }
    stub.stop(true);
    sidecar.stop();
    writeFileSync(join(W, "e2e.json"), JSON.stringify({ checks, stub: stubSeen.length }, null, 1) + "\n");
    if (!o.keep) {
      removeSessionImages();
      removeCoverageImages();
      removeLabelled();
      if (unitImage) {
        docker(["run", "--rm", "--network", "none", "--user", "0:0", "-v", W + ":/x", "--entrypoint", "sh", unitImage, "-c", "rm -rf /x/* /x/.[!.]* 2>/dev/null; true"]);
        docker(["rmi", "-f", "--no-prune", unitImage]);
      }
      rmSync(W, { recursive: true, force: true });
    }
  }
  const failed = checks.filter((c) => !c.ok);
  return { ok: checks.length > 0 && failed.length === 0, detail: checks.length + " checks, " + failed.length + " failed" + (failed.length ? ": " + failed.map((c) => c.check).join("; ") : "") + (o.keep ? "; kept " + W : ""), checks };
}

if (import.meta.main) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const r = await drivenLaunch({ harbor: arg("--harbor"), gstack: arg("--gstack"), keep: process.argv.includes("--keep"), log: (l) => console.log(l) });
  console.log((r.ok ? "PASS" : "FAIL") + " driven launch: " + r.detail);
  process.exit(r.ok ? 0 : 1);
}
