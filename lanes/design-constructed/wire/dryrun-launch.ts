// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless launch, end to end (the Captain's fix for a dry run that passed because nothing drove a launch). It drives
// the real launch path, gstack-evals dc host launch, then rows in sequence through dc host next, then teardown, on
// stage3/fake.ts's simulated Ubicloud with every SSH command run on this machine, one controller host and one ledger:
//   1 modelprobe on the launch, its region in launch.json and the work folder's regions.json (PD-42)
//   2 preflight: one sandbox VM on a simulated Ubicloud through the preamble, the controller's install, the fixture
//     app's qualification steps, one page in a scripted browser and the audit, with no model key in its environment
//   3 clones from an invented sealed record over file://, 4 apps writing apps.json from the clones row's output
//   5 planted writing planted.json and its apps.json from an invented opened tar
//   6 gatecheck reading them, which refuses the invented units at their planted-case check, before any key read
//   7 author reading apps.json, which refuses at start rule 6 because the gate check did not pass
//   8 a second modelprobe after the host's recorded region changes, which refuses (PD-42)
// The wiring's vm section names "controller" for the proxy and the mirrors. Every returned file must be sealed or hold
// no unit text, and no plaintext input or sink may land on this machine's disk outside its tmpfs twin (PD-41).
// This file is also the host's stage module for the run: runOnHost runs each row through wire/host.ts runRowOnHost with
// the lowest seams faked (the proxies' upstream, the frame's clone seam, the planted digests table, the dry run, and the
// sandbox VMs' Ubicloud and browser).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tableOf, type PlantedUnit } from "../author/gatecheck.ts";
import { STAND_IN_VOCABULARY } from "../author/scripted.ts";
import { commitAll } from "../money/dryrun-fixture.ts";
import { fetchAt } from "../frame/git.ts";
import { AGE_HEADER, layout } from "../money/controller-host.ts";
import type { HostStage, RowRecord } from "../money/host-main.ts";
import { DIRECT_MODELS } from "../money/price.ts";
import { endpointsFixture } from "../paid/dryrun-cases.ts";
import { pinRecord, termsRecordsOf } from "../paid/pin.ts";
import { scripted } from "../paid/scripted.ts";
import { fixtureBrowser } from "../recipes/fixtures.ts";
import { fakeBackend, fakeWorld, serveMirrors } from "../stage3/fake.ts";
import { runProcess } from "../stage3/ubicloud-real.ts";
import type { DryRunCase } from "../types.ts";
import { plantedRow, viewAt } from "./apps.ts";
import { clonesRow } from "./clones.ts";
import { cloneFixture } from "./dryrun-clones.ts";
import { FAKE_KEYS, host, hostFixture, hostWorkOf, localSeams, localWorld, openSealed, rowEnv, shmOf, withTemp } from "./dryrun-host.ts";
import { runRowOnHost } from "./host.ts";
import { nodePinPath, realProviders, type HostContext } from "./real.ts";
import type { Args, RowEnv } from "./start.ts";

/** The text every scripted reply carries; it may sit only in the host's tmpfs and the sealed archive. */
export const REPLY_MARK = "invented-reply-7f3c";
/** A line in every planted plan; it may sit only on tmpfs and in the sealed archive. */
export const PLAN_MARK = "invented-planted-plan-51d2";
const SETTINGS = "dryrun-launch.json";

const argsOf = (argv: string[]): Args => {
  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) flags.set(argv[i]!, argv[i + 1]!);
  return { flags, bools: new Set(), rest: [] };
};

/** The host's stage module for this run: the real row path with the upstream, clone seams and dry run faked. */
export const runOnHost: HostStage["runOnHost"] = async (service, args, row) => {
  const { realEnv } = await import("../cli.ts");
  const s = JSON.parse(readFileSync(join(row.work, SETTINGS), "utf8")) as { src: string; table: string };
  const served = Object.fromEntries((JSON.parse(readFileSync(join(row.work, "terms.json"), "utf8")) as Array<{ model: string; provider: string }>).map((t) => [t.model, t.provider]));
  const up = scripted((_url, body) => {
    const model = Object.entries(DIRECT_MODELS).find(([, d]) => d.id === body?.model)?.[0] ?? "";
    return { kind: "ok", text: REPLY_MARK, provider: served[model] ?? "OpenAI" };
  });
  const clone = (name: string, oid: string, dest: string) => fetchAt("file://" + join(s.src, name), oid, dest, ["file"]);
  return runRowOnHost(service, args, row, {
    env: (ctx): RowEnv => ({ ...realEnv(ctx), dryRun: async () => true, vocabulary: () => STAND_IN_VOCABULARY, providers: realProviders(ctx, { fetch: up.fetch, sleep: async () => {}, vm: { backend: fakeBackend(fakeWorld()), browser: fixtureBrowser(() => "content") } }) }),
    run: async (argv, io, env) => {
      if (argv[0] === "clones") return clonesRow(clone)(argsOf(argv), io, env);
      if (argv[0] === "planted") return plantedRow({ clone, table: () => JSON.parse(readFileSync(s.table, "utf8")) })(argsOf(argv), io, env);
      const { main } = await import("../cli.ts");
      return main(argv, io, () => env);
    },
  });
};

const NAMES = ["G1", "G2", "B1", "B2", "B3", "B4", "B5", "B6"] as const;

/** An invented opened planted tar: pin.json for the planted app at its commit and eight invented units, plus their table. */
function plantedTar(dir: string, app: { name: string; oid: string; tree: string }, view: { designFiles: string[]; routeFiles: string[]; files: number }): string {
  const units: PlantedUnit[] = [];
  const pinUnits = NAMES.map((name, i) => {
    const u = { name, unitId: "planted-" + name.toLowerCase(), author: i % 2 ? "argon" : "sol", kind: "k" + ((i % 6) + 1), plantedClass: i < 2 ? null : "S" };
    const d = join(dir, "units", name);
    mkdirSync(join(d, "context"), { recursive: true });
    mkdirSync(join(d, "evidence"), { recursive: true });
    const plan = "# Plan " + name + "\n\n" + PLAN_MARK + "\n";
    const context = "# Project\n\nAn invented orders app.\n";
    const evidence = [{ path: "evidence/notes.md", text: "Customers asked for an orders view (" + name + ").\n" }];
    const key = { items: [], wrongWay: [], decoy: null };
    writeFileSync(join(d, "plan.md"), plan);
    writeFileSync(join(d, "context", "project.md"), context);
    writeFileSync(join(d, "evidence", "notes.md"), evidence[0]!.text);
    writeFileSync(join(d, "key.json"), JSON.stringify(key));
    writeFileSync(join(d, "unit.json"), JSON.stringify({ ...u, evidence: evidence.map((e) => e.path) }));
    units.push({ name, files: { plan, context, evidence, key } } as unknown as PlantedUnit);
    return u;
  });
  writeFileSync(join(dir, "pin.json"), JSON.stringify({ commit: app.oid, tree: app.tree, repository: app.name, base_app_view: view, units: pinUnits }));
  return JSON.stringify(tableOf(units));
}

/** The whole launch; returns its problems, an empty list when every check holds. */
export async function launchScenario(): Promise<string[]> {
  const problems: string[] = [];
  const fx = cloneFixture();
  try {
    await withTemp(async (dir) => {
      const shm = shmOf(dir);
      const f = hostFixture(dir, ["modelprobe", "--terms", "terms.json", "--out", "sinks/modelprobe"]);
      writeFileSync(f.planPath, JSON.stringify({ ...f.plan, mirrors: true }, null, 2) + "\n");
      const work = f.plan.work;
      const lane = join(dir, "lane");
      const tgz = new TextEncoder().encode("invented claude code tarball\n");
      mkdirSync(join(lane, "docker"), { recursive: true });
      writeFileSync(join(lane, "docker", "host-cli.json"), JSON.stringify({ claude: "9.9.9" }));
      writeFileSync(join(lane, "docker", "trial.Dockerfile"), "ADD --checksum=sha256:" + createHash("sha256").update(tgz).digest("hex") + " https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-9.9.9.tgz /opt/claude.tgz\n");
      const nodeTar = new TextEncoder().encode("invented node build\n");
      mkdirSync(dirname(nodePinPath(lane)), { recursive: true });
      writeFileSync(nodePinPath(lane), JSON.stringify({ version: "24.0.0", sha256: createHash("sha256").update(nodeTar).digest("hex") }));
      writeFileSync(join(work, "node.tar.xz"), nodeTar);
      const laneCommit = commitAll(lane, dir);
      writeFileSync(join(work, "claude.tgz"), tgz);
      mkdirSync(join(work, "chromium", "chrome-linux"), { recursive: true });
      writeFileSync(join(work, "chromium", "chrome-linux", "chrome"), "invented browser\n", { mode: 0o755 });
      mkdirSync(join(work, "gstack"), { recursive: true });
      const pin = pinRecord({ runId: f.plan.runId, commit: "0".repeat(40), dated: "2026-11-13T00:00:00Z", reads: { sol: endpointsFixture("sol"), particle: endpointsFixture("particle"), argon: endpointsFixture("argon") } });
      writeFileSync(join(work, "pins.json"), JSON.stringify(pin));
      writeFileSync(join(work, "terms.json"), JSON.stringify(termsRecordsOf(pin)));
      const vm = { project: "dry", location: "eu-central-h1", size: "standard-4", image: "ubuntu-noble", privateSubnet: null, keyPath: "ssh/id_ed25519", knownHosts: "ssh/known_hosts", chromiumBuild: { dir: "chromium", bin: "chrome-linux/chrome" }, claudeTarball: "claude.tgz", nodeTarball: "node.tar.xz", priceMicrosPerHour: 57_400, proxy: { host: "controller", port: 8790 }, mirrors: { host: "controller", terms: { npm: "npm terms", pypi: "pypi terms", apt: "apt terms", dockerhub: "dockerhub terms" } } };
      writeFileSync(join(work, "wiring.json"), JSON.stringify({ retry: { attempts: 3, elapsed_ms: 900_000 }, pinRecord: "pins.json", cacheDir: "cache", scanMs: 10_000, sessions: null, vm }));
      const app = fx.repos.bait;
      const view = (() => {
        const probe = join(shm, "planted-view");
        fetchAt("file://" + join(fx.src, app.name), app.first.oid, probe, ["file"]);
        const v = viewAt(probe, app.first.oid, "planted");
        rmSync(probe, { recursive: true, force: true });
        return { designFiles: v.designFiles, routeFiles: v.routeFiles, files: v.files };
      })();
      const table = plantedTar(join(shm, "planted-in", "planted-in"), { name: app.name, oid: app.first.oid, tree: app.first.tree }, view);
      writeFileSync(join(work, SETTINGS), JSON.stringify({ src: fx.src, table: join(hostWorkOf(dir), "planted-table.json") }));
      writeFileSync(join(work, "planted-table.json"), table);
      const plan = { ...JSON.parse(readFileSync(f.planPath, "utf8")), ubicloud: { ...f.plan.ubicloud, location: "eu-central-h1" } };
      const env = { ...rowEnv(), lane: () => ({ commit: laneCommit, dirty: false, root: lane }) };
      const s = localSeams(dir, localWorld((vm) => vm.spec?.label.startsWith("dc controller host") && serveMirrors(vm)), FAKE_KEYS, (p) => ({ ...p, stage: p.stage ? { ...p.stage, module: import.meta.path } : null }));
      const b = await s.backend!(plan, FAKE_KEYS);
      b.privateAddress = () => "127.0.0.1";
      const l = layout(plan.runId, join(dir, "host"), hostWorkOf(dir));
      const rows = () => (existsSync(l.rows) ? (JSON.parse(readFileSync(l.rows, "utf8")) as RowRecord[]) : []);
      const ended = async (n: number) => {
        for (const until = Date.now() + 60_000; Date.now() < until; await Bun.sleep(100)) if (rows()[n - 1] && rows()[n - 1]!.state !== "running") return rows()[n - 1]!;
        return rows()[n - 1] ?? null;
      };
      const step = async (n: number, stage: string[], inputs: Record<string, string> | null, want: { state: string; code?: string }) => {
        const inDir = inputs ? join(shm, "inputs-" + n) : null;
        if (inDir) for (const [p, text] of Object.entries(inputs!)) (mkdirSync(join(inDir, p, ".."), { recursive: true }), writeFileSync(join(inDir, p), text));
        writeFileSync(f.planPath, JSON.stringify({ ...plan, stage, inputs: inDir }));
        const r = n === 1 ? await host("launch", f, s, env) : await host("next", f, s, env);
        if (r.code !== 0) return problems.push("row " + n + " " + stage[0] + " was not sent: " + r.out.concat(r.err).join(" | ").slice(0, 600));
        const got = await ended(n);
        const log = existsSync(join(l.work, ".rows", n + ".log")) ? readFileSync(join(l.work, ".rows", n + ".log"), "utf8") : "";
        if (got?.state !== want.state || (want.code && got.code !== want.code)) problems.push("row " + n + " " + stage[0] + " ended " + JSON.stringify(got) + ", not " + JSON.stringify(want) + ": " + log.slice(-600));
        return log;
      };
      const rec = clonesRecord(fx);
      const probeLog = String(await step(1, ["modelprobe", "--terms", "terms.json", "--out", "sinks/modelprobe"], null, { state: "done" }));
      if (!/region/i.test(probeLog)) problems.push("the modelprobe row printed no region");
      const launchJson = join(l.work, "sinks", "modelprobe", "launch.json");
      if (!existsSync(launchJson) || !readFileSync(launchJson, "utf8").includes("eu-central-h1")) problems.push("the modelprobe row's launch.json holds no region");
      if (!existsSync(join(l.work, "regions.json"))) problems.push("the work folder holds no regions.json");
      const facts = existsSync(l.controller) ? JSON.parse(readFileSync(l.controller, "utf8")) : null;
      if (facts?.privateIp !== "127.0.0.1") problems.push("the launch recorded no private IPv4 for the controller: " + JSON.stringify(facts));
      const preflightLog = String(await step(2, ["preflight", "--out", "sinks/preflight"], null, { state: "done" }));
      for (const want of ["preflight: preamble: ok", "preflight: install: ok", "preflight: page / at 375x812 in the pinned Chromium: HTTP 200", "preflight: audit: ok", "preflight: passed"]) if (!preflightLog.includes(want)) problems.push("the preflight row printed no " + JSON.stringify(want) + ": " + preflightLog.slice(-600));
      if (/API_KEY|test-not-a-key/.test(preflightLog)) problems.push("the preflight row printed a key name or key");
      await step(3, ["clones", "--record", "inputs/record.json", "--out", "frame"], { "inputs/record.json": rec }, { state: "done" });
      await step(4, ["apps", "--clones", "frame", "--base-apps", "inputs/base-apps.json", "--out", "apps.json"], { "inputs/base-apps.json": JSON.stringify([{ id: "c003", pin: fx.repos.match.second.oid }]) }, { state: "done" });
      const plantedIn = Object.fromEntries(filesOf(join(shm, "planted-in")).map((p) => [p, readFileSync(join(shm, "planted-in", p), "utf8")]));
      await step(5, ["planted", "--in", "planted-in", "--out", "planted"], plantedIn, { state: "done" });
      await step(6, ["gatecheck", "--units", "planted/planted.json", "--apps", "planted/apps.json", "--gstack", "gstack", "--terms", "terms.json", "--screen", "inputs/screen", "--out", "sinks/gatecheck"], { "inputs/screen/node-drops.json": JSON.stringify({ pinned: "24.22.3", count: 0, labels: [] }) }, { state: "failed", code: "E_USAGE" });
      await step(7, ["author", "--step", "pilot", "--item", "dc-authoring-1", "--apps", "apps.json", "--gstack", "gstack", "--terms", "terms.json", "--gate", "sinks/gatecheck", "--screen", "inputs/screen", "--out", "sinks/pilot"], null, { state: "failed", code: "E_DCW_START_RULE" });
      writeFileSync(l.controller, JSON.stringify({ ...facts, location: "us-east-a2" }));
      await step(8, ["modelprobe", "--terms", "terms.json", "--out", "sinks/modelprobe-2"], null, { state: "failed", code: "E_DCW_REGION" });
      const status = await host("status", f, s, env);
      if (status.out.filter((x) => x.startsWith("row ")).length !== 8) problems.push("status does not name the eight rows: " + status.out.join(" | "));
      if (!status.out.some((x) => x.startsWith("log: E_DCW_REGION"))) problems.push("status printed no tail for the last modelprobe row: " + status.out.join(" | "));
      if (status.out.filter((x) => /^tmpfs: row \d+: the work folder's tmpfs holds .* with a peak of /.test(x)).length !== 8) problems.push("status does not print each row's tmpfs use and peak: " + status.out.join(" | "));
      if (!rows().every((r) => r.tmpfs && r.tmpfs.sizeBytes > 0 && r.tmpfs.peakBytes >= r.tmpfs.usedBytes)) problems.push("rows.json lacks a row's tmpfs use and peak: " + JSON.stringify(rows()));
      writeFileSync(f.planPath, JSON.stringify({ ...plan, stage: ["gatecheck"], inputs: null }));
      const quiet = JSON.parse(readFileSync(l.rows, "utf8"));
      writeFileSync(l.rows, JSON.stringify(quiet.slice(0, 6)));
      const loud = await host("status", f, s, env);
      writeFileSync(l.rows, JSON.stringify(quiet));
      if (!loud.out.some((x) => /^log: row 6 holds \d+ lines; gatecheck can print unit or item text/.test(x)) || loud.out.some((x) => x.includes(PLAN_MARK) || x.startsWith("log: gate "))) problems.push("status printed the gate check's lines: " + loud.out.join(" | "));
      const archive = join(dir, "archive");
      const down = await host("teardown", f, s, env, { "--archive": archive });
      if (down.code !== 0) return (problems.push("teardown: " + down.out.concat(down.err).join(" | ")), null);
      const sealed = join(archive, "work.tar.age");
      if (!existsSync(sealed) || readFileSync(sealed).subarray(0, AGE_HEADER.length).toString() !== AGE_HEADER) problems.push("the archive's work folder is not an age file");
      const opened = existsSync(sealed) ? openSealed(sealed, f.identity, join(shm, "opened")) : [];
      for (const want of ["./sinks/modelprobe/probe.json", "./sinks/modelprobe/launch.json", "./frame/clones.json", "./apps.json", "./planted/planted.json", "./planted/apps.json", "./regions.json", "./sinks/preflight/preflight.json", "./.rows/8.log", "./inputs/record.json"]) if (!opened.includes(want)) problems.push("the sealed archive lacks " + want);
      const back = readdirSync(archive).filter((n) => n !== "work.tar.age");
      const marks = [REPLY_MARK, PLAN_MARK, "An invented app for the clone re-fetch fixture", ...fx.secrets];
      const grep = await runProcess(["grep", "-rlF", ...marks.flatMap((m) => ["-e", m]), dir]);
      const leaked = new TextDecoder().decode(grep.stdout).trim();
      if (leaked) problems.push("plaintext outside tmpfs: " + leaked.split("\n").join(", ") + " (the archive holds " + back.join(", ") + ")");
      if (existsSync(l.work) && readdirSync(l.work).length) problems.push("the host's work folder kept plaintext after the teardown");
      const keys = await runProcess(["grep", "-rl", "test-not-a-key", dir, shm]);
      if (new TextDecoder().decode(keys.stdout).trim()) problems.push("a key reached a file");
      return null;
    });
  } finally {
    fx.dispose();
  }
  return problems;
}

/** The invented sealed clone record: position 3 is the fixture's matching repository at its second commit. */
const clonesRecord = (fx: ReturnType<typeof cloneFixture>) => JSON.stringify([{ position: 3, nameWithOwner: fx.repos.match.name, oid: fx.repos.match.second.oid, tree: fx.repos.match.second.tree }]);

const filesOf = (dir: string, rel = ""): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesOf(dir, rel ? rel + "/" + e.name : e.name) : [rel ? rel + "/" + e.name : e.name]));

export function launchCases(): DryRunCase[] {
  return [
    {
      rule: "W-launch",
      name: "the keyless launch end to end: launch, eight rows in sequence (the preflight second) through dc host next on one host and one ledger, teardown; every returned file sealed or free of unit text, and no plaintext on disk outside tmpfs",
      check: async () => {
        const p = await launchScenario();
        return p.length ? p.join("; ") : null;
      },
    },
  ];
}
