// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's stage module and its launcher row.
//
// runOnHost (money/host-main.ts imports this file and calls it in the ledger service's own process) runs one paid row
// on the real providers bound to that service, so its money, its proxies and its sessions live on the host that stays
// awake, never on a Capy machine. Its arguments are the wiring file, then the row's own arguments as gstack-evals dc
// takes them. Relative paths in both resolve against the host's work folder, a tmpfs mount that holds the uploaded
// inputs, the sinks, the wiring's session folders and the row's log (PD-41); a reply cache outside tmpfs refuses. A row
// that exits non-zero throws with the reason code it printed, so host-main records it in rows.json and stage.json. The
// checkout is the commit the host was launched at, unpacked from git archive under the host's root beside its commit file.
//
// gstack-evals dc host launch|next|relaunch|recover|teardown|status --plan <host plan> --record <host record> [--archive
// <new dir>] [--force] drives money/controller-host.ts from the attaching agent's machine. launch uploads the plan's
// work folder and runs its stage; next sends the plan's stage, with the plan's inputs folder, to the running host once
// its last row has ended; status prints each row and the last lines of the last row's log. Every key is read by name,
// only after the start rules the launch can check off the host pass: the commit pin and a clean checkout (rule 2), the
// keyless dry run (rule 5), a complete wiring file, a plan the launcher accepts and, for a sessions row, a recorded image
// digest with its image tar and a gstack source that holds the pin. The row's own start rules run on the host. The
// launcher builds every upload in memory from a tmpfs folder and refuses one on disk, and the teardown's archive holds
// the work folder only as the age file the host sealed (PD-41).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DcError, fail } from "../errors.ts";
import { GSTACK_PIN } from "../frozen.ts";
import { AGE_HEADER, controllerProvision, gstackPack, hostStatus, HOST_GSTACK_SOURCE, launch, planProblems, recoverHost, relaunch, sendRow, serviceEnv, teardown, type ControllerPlan, type HostBackend, type HostRecord } from "../money/controller-host.ts";
import type { HostRow, HostStage } from "../money/host-main.ts";
import { recordTar, type LedgerService } from "../money/ledger-service.ts";
import { ownerFromEnv } from "../stage3/sandbox.ts";
import { keyedUbicloud } from "../stage3/ubicloud-real.ts";
import { claudeTarball, hostAddresses, readControllerFacts, readWiring, type HostContext, type HostWiring } from "./real.ts";
import { readJson } from "./json.ts";
import { refuse, type Args, type Io, type Row, type RowEnv } from "./start.ts";

export const HOST_STAGE_MODULE = "lanes/design-constructed/wire/host.ts";

/** The plan's stage field for one paid row (money/controller-host.ts ControllerPlan.stage). */
export const hostStage = (wiring: string, row: readonly string[], module = HOST_STAGE_MODULE): { module: string; args: string[] } => ({ module, args: [wiring, ...row] });

/** The host's checkout: the unpacked archive at the commit the launcher wrote; an archive has no working tree to dirty. */
export function hostLane(root: string): () => { commit: string; dirty: boolean; root: string } {
  return () => ({ commit: readFileSync(join(root, "commit"), "utf8").trim(), dirty: false, root: join(root, "repo") });
}

/**
 * The real providers' context on a service: the wiring file, the service's own environment, its host root, and the
 * launch's record of the host in the state folder (its region and private IPv4), read when a row needs it, and the
 * work folder on tmpfs, which holds the wiring's own folder (PD-41).
 */
export function hostContext(service: LedgerService, wiringPath: string, env: Readonly<Record<string, string | undefined>> = process.env, addresses: () => string[] = hostAddresses, work = join(dirname(service.cfg.stateDir), "work")): HostContext {
  const root = dirname(service.cfg.stateDir);
  const w = readWiring(wiringPath);
  const at = (p: string) => (typeof p === "string" ? resolve(work, p) : p);
  const vm = w.vm && { ...w.vm, ...(w.vm.chromiumBuild ? { chromiumBuild: { ...w.vm.chromiumBuild, dir: at(w.vm.chromiumBuild.dir) } } : {}), claudeTarball: at(w.vm.claudeTarball) };
  return { service, wiring: { ...w, vm }, env, dir: join(work, ".wire"), lane: hostLane(root), controller: () => readControllerFacts(join(service.cfg.stateDir, "controller.json")), addresses };
}

/** The region a row on this host runs in, from the launch's record, and the work folder's regions.json (PD-42). */
export function hostRegion(h: HostContext): { region: string; record: string } {
  const region = h.controller?.()?.location;
  if (!region) throw new DcError("E_DCW_REGION", "the controller host holds no launch record of its Ubicloud region, so no paid row starts on it (PD-42)");
  return { region, record: join(dirname(h.dir), "regions.json") };
}

/**
 * The vm section's browser build and Claude Code tarball ship in the work folder (relaunch uploads nothing), so the
 * wiring names both relative to it; the launch checks they are there and that the tarball is the pinned one.
 */
function vmFilesProblems(vm: NonNullable<HostWiring["vm"]>, work: string, root: string): string | null {
  const inside = (p: string) => typeof p === "string" && !isAbsolute(p) && !relative(work, resolve(work, p)).startsWith("..");
  if (!inside(vm.chromiumBuild?.dir) || !inside(vm.claudeTarball)) return "the wiring's vm section must name chromiumBuild.dir and claudeTarball relative to the work folder, which ships them";
  if (!existsSync(join(resolve(work, vm.chromiumBuild.dir), vm.chromiumBuild.bin))) return "the work folder holds no Chromium binary at the wiring's chromiumBuild";
  try {
    claudeTarball(resolve(work, vm.claudeTarball), root);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

/** The file system type of path, or of its nearest folder that exists (stat -f, as the host's own check reads it). */
export function fsTypeOf(path: string): string {
  let at = resolve(path);
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  const r = Bun.spawnSync(["stat", "-f", "-c", "%T", at], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? new TextDecoder().decode(r.stdout).trim() : "unknown";
}

/** Refuses unless path sits on tmpfs (PD-41). */
export function needTmpfs(path: string, what: string): void {
  const kind = fsTypeOf(path);
  if (kind !== "tmpfs") throw new DcError("E_DCH_NOT_TMPFS", what + " " + path + " is on " + kind + ", not tmpfs; no plaintext sealed input or sink may sit on a disk (PD-41)");
}

/** The seams a keyless launch passes to a row on the host: the row's environment and how the row runs. */
export interface RowSeams {
  env?: (ctx: HostContext) => RowEnv;
  run?: (argv: string[], io: Io, env: RowEnv) => Promise<number>;
}

export const runOnHost: HostStage["runOnHost"] = (service, args, row) => runRowOnHost(service, args, row);

/** Runs one row in the work folder, its lines appended to the row's log; a non-zero exit throws with the code it printed. */
export async function runRowOnHost(service: LedgerService, args: string[], row: HostRow, s: RowSeams = {}): Promise<void> {
  const [wiring, ...argv] = args;
  if (!wiring || !argv.length) fail("E_USAGE", "runOnHost takes the wiring file, then one gstack-evals dc row and its arguments");
  mkdirSync(row.work, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(row.log), { recursive: true, mode: 0o700 });
  const before = process.cwd();
  process.chdir(row.work);
  try {
    const ctx = hostContext(service, resolve(wiring!), undefined, undefined, row.work);
    needTmpfs(ctx.wiring.cacheDir, "the wiring's reply cache, which holds model output,");
    const { main, realEnv } = await import("../cli.ts");
    let code: string | null = null;
    const out = (t: string) => appendLine(row.log, t);
    const err = (t: string) => {
      code = /^(E_[A-Z0-9_]+)\b/.exec(t)?.[1] ?? code;
      appendLine(row.log, t);
    };
    const exit = await (s.run ?? ((a, io, e) => main(a, io, () => e)))(argv, { out, err }, (s.env ?? realEnv)(ctx));
    if (exit !== 0) throw Object.assign(new Error("gstack-evals dc " + argv[0] + " exited " + exit + "; " + row.log + " holds its lines"), { code });
  } finally {
    process.chdir(before);
  }
}

const appendLine = (file: string, t: string) => writeFileSync(file, t + "\n", { flag: "a" });

// ---- The launcher row

/** The Captain's host plan for one launch, kept beside the host record on the attaching agent's machine. */
export interface HostPlanFile {
  runId: string;
  longestStageHours: number;
  ttlHours: number;
  sizes?: { controller?: string; wal?: string };
  /** Ubicloud's list price per hour for each host's size, in micros, read on the day (dc-hosts). */
  priceMicrosPerHour: { controller: number; wal: number };
  bunVersion: string;
  mirrors: boolean;
  /** Ubicloud's project, location, default size and image for the two hosts, and the launcher's own SSH key. */
  ubicloud: { project: string; location: string; size: string; image: string; privateSubnet?: string | null; keyPath: string; knownHosts: string };
  /** The local folder uploaded as the host's work folder: the wiring file and every input the row names, by relative path. */
  work: string;
  /** The wiring file, relative to work. */
  wiring: string;
  /** The Captain's approval record folder. The teardown writes the host's copy back here, keeping the old one beside it. */
  record: string;
  /** The run's age recipient file, one age1 public key; the launcher uploads it and the teardown seals the work folder to it. */
  recipient: string;
  /** A tmpfs folder of the next row's own inputs, unpacked into the host's work folder by next or relaunch; none when unset. */
  inputs?: string | null;
  /** A sessions row's trial image as a docker save tar: the image whose digest the wiring's sessions section records. */
  imageTar?: string | null;
  /** A sessions row's local gstack repository holding the pinned commit. */
  gstackSource?: string | null;
  /** The row the host runs, as gstack-evals dc takes it. */
  stage: string[];
}

export interface HostSeams {
  /** Where keys and UBI_OWNER are read from, by name. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The two hosts' backend, built after the start rules pass; keyedUbicloud with the token read by name when unset. */
  backend?: (plan: HostPlanFile, env: Readonly<Record<string, string | undefined>>) => Promise<HostBackend>;
  /** The repository at the commit as a tar; git archive when unset. */
  archive?: (root: string, commit: string) => Uint8Array;
  /** Changes to the launcher plan, for keyless runs on this machine (paths, the entry, the provisioning, the WAL target). */
  tune?: (p: ControllerPlan) => ControllerPlan;
}

const VERBS = ["launch", "next", "relaunch", "recover", "teardown", "status"] as const;
/** How many of the last row's log lines dc host status prints. */
const STATUS_TAIL = 10;
const mib = (bytes: number) => (bytes / 2 ** 20).toFixed(1);
type Verb = (typeof VERBS)[number];
const USAGE = "host " + VERBS.join("|") + " --plan <host plan JSON> --record <host record JSON> [--archive <new folder>] [--force]";

const tarOf = (dir: string): Uint8Array => {
  const r = Bun.spawnSync(["tar", "-C", dir, "-cf", "-", "."], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) fail("E_USAGE", "could not read " + dir + " as a tar");
  return new Uint8Array(r.stdout);
};

const gitArchive = (root: string, commit: string): Uint8Array => {
  const r = Bun.spawnSync(["git", "-C", root, "archive", "--format=tar", commit], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0 || !r.stdout.length) fail("E_USAGE", "git archive of " + commit + " failed");
  return new Uint8Array(r.stdout);
};

const isSha = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);

/** Reads and checks the host plan; the rules here read no key. */
export async function readHostPlan(path: string): Promise<HostPlanFile> {
  const { SUBCOMMANDS } = await import("../cli.ts");
  const p = readJson<HostPlanFile>(resolve(path), "--plan");
  const no = (why: string): never => fail("E_USAGE", "the host plan " + path + " " + why);
  if (!Array.isArray(p.stage) || !p.stage.length || p.stage.some((s) => typeof s !== "string")) no("names no stage row");
  if (!SUBCOMMANDS[p.stage[0]!] || p.stage[0] === "host" || p.stage[0] === "dryrun") no("names " + JSON.stringify(p.stage[0]) + ", which is not a row the host runs");
  for (const k of ["work", "wiring", "record", "bunVersion"] as const) if (typeof p[k] !== "string" || !p[k]) no("names no " + k);
  if (!existsSync(p.work)) no("names a work folder that doesn't exist: " + p.work);
  const wiring = resolve(p.work, p.wiring);
  const rel = relative(resolve(p.work), wiring);
  if (rel.startsWith("..") || rel === "") no("names a wiring file outside its work folder");
  if (!existsSync(p.record)) no("names an approval record that doesn't exist: " + p.record);
  if (typeof p.recipient !== "string" || !existsSync(p.recipient)) no("names no age recipient file");
  if (p.inputs != null && (typeof p.inputs !== "string" || !existsSync(p.inputs))) no("names an inputs folder that doesn't exist: " + p.inputs);
  if (!p.ubicloud || typeof p.ubicloud.project !== "string") no("has no ubicloud section");
  return p;
}

/** The start rules a launch checks off the host, before any key is read. */
async function hostRules(p: HostPlanFile, env: RowEnv): Promise<{ commit: string; root: string }> {
  const lane = env.lane();
  if (!lane.commit) refuse("2", "the lane's commit can't be read, so the host can't be pinned to it");
  if (lane.dirty) refuse("2", "the checkout is dirty; the controller host runs an exact commit, so commit first");
  const wiring = readWiring(resolve(p.work, p.wiring));
  const vmFiles = wiring.vm && vmFilesProblems(wiring.vm, resolve(p.work), lane.root);
  if (vmFiles) fail("E_USAGE", vmFiles);
  if (p.stage[0] === "sessions") {
    const s = wiring.sessions;
    if (!s) refuse("sessions", "the wiring file has no sessions section");
    if (!isSha(s!.imageDigest)) refuse("sessions", "the wiring's sessions section records no image digest; the host loads that image, so the Captain records it first");
    if (!s!.gstackSources.includes(HOST_GSTACK_SOURCE)) refuse("sessions", "the wiring's gstack sources don't name the host's pin source " + HOST_GSTACK_SOURCE);
    if (!p.imageTar || !existsSync(p.imageTar)) refuse("sessions", "the host plan names no image tar for the recorded digest");
    if (!p.gstackSource || !existsSync(p.gstackSource)) refuse("sessions", "the host plan names no local gstack repository holding " + GSTACK_PIN.commit);
  }
  if (!(await env.dryRun())) refuse("5", "the keyless dry run has a FAIL line; gstack-evals dc dryrun names it");
  return { commit: lane.commit, root: lane.root };
}

/** The launcher's plan for this host plan; owner is UBI_OWNER, which is not a key. */
function controllerPlanOf(p: HostPlanFile, lane: { commit: string; root: string }, owner: string, s: HostSeams, uploads: boolean): ControllerPlan {
  const sessions = p.stage[0] === "sessions";
  const plan: ControllerPlan = {
    runId: p.runId,
    owner,
    longestStageHours: p.longestStageHours,
    ttlHours: p.ttlHours,
    sizes: p.sizes,
    location: p.ubicloud.location,
    priceMicrosPerHour: p.priceMicrosPerHour,
    commit: lane.commit,
    repoTar: uploads ? (s.archive ?? gitArchive)(lane.root, lane.commit) : new Uint8Array([0]),
    recordTar: uploads ? recordTar(resolve(p.record)) : new Uint8Array([0]),
    workTar: uploads ? (needTmpfs(p.work, "the plan's work folder"), tarOf(resolve(p.work))) : null,
    recipient: readFileSync(p.recipient, "utf8").trim(),
    provision: controllerProvision({ bunVersion: p.bunVersion, mirrors: p.mirrors }),
    bun: "/opt/bun/bin/bun",
    stage: hostStage(p.wiring, p.stage),
    image: sessions ? { tar: uploads ? new Uint8Array(readFileSync(p.imageTar!)) : null, expectDigest: readWiring(resolve(p.work, p.wiring)).sessions!.imageDigest } : null,
    gstack: sessions && uploads ? gstackPack(resolve(p.gstackSource!), GSTACK_PIN.commit) : null,
  };
  const tuned = s.tune ? s.tune(plan) : plan;
  const problems = planProblems(tuned);
  if (problems.length) fail("E_USAGE", "the controller host plan can't run: " + problems.join("; "));
  return tuned;
}

const saveRecord = (file: string, rec: HostRecord) => {
  writeFileSync(file + ".tmp", JSON.stringify(rec, null, 2) + "\n", { mode: 0o600 });
  renameSync(file + ".tmp", file);
};

/**
 * Writes the teardown archive into a new folder: the work folder only as the age file the host sealed, beside the books
 * that hold no sealed text (the off-host lines, the snapshot and rows.json), and puts the host's approval record back
 * in the Captain's place.
 */
function writeArchive(dir: string, p: HostPlanFile, a: Extract<Awaited<ReturnType<typeof teardown>>, { kind: "deleted" }>["archive"], io: Io, now: () => Date): void {
  if (new TextDecoder().decode(a.sealed.subarray(0, AGE_HEADER.length)) !== AGE_HEADER) fail("E_DCH_SEAL", "the work archive is not an age file, so nothing of it is written here");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "work.tar.age"), a.sealed);
  writeFileSync(join(dir, "wal-lines.ndjson"), a.lines);
  if (a.snapshot) writeFileSync(join(dir, a.snapshot.name + ".json"), a.snapshot.bytes);
  if (a.rows) writeFileSync(join(dir, "rows.json"), a.rows);
  io.out("archive: " + dir + " holds the host's work folder sealed to the run's recipient (work.tar.age), the off-host lines" + (a.snapshot ? ", " + a.snapshot.name : "") + (a.rows ? " and rows.json" : ""));
  if (!a.record) return io.out("archive: the off-host copy held no approval record; the Captain's record at " + p.record + " is unchanged");
  writeFileSync(join(dir, "record.tar"), a.record);
  const unpack = join(dir, "record");
  mkdirSync(unpack);
  if (Bun.spawnSync(["tar", "-C", unpack, "-xf", join(dir, "record.tar")]).exitCode !== 0) return io.err("E_DC_INFRA_MISSING the approval record did not unpack; record.tar holds it and " + p.record + " is unchanged");
  const record = resolve(p.record);
  const top = join(unpack, record.split("/").pop()!);
  if (!existsSync(top)) return io.err("E_DC_INFRA_MISSING the archived approval record has no folder named like " + record + "; record.tar holds it");
  const before = record + ".before-teardown-" + now().toISOString().replace(/[:.]/g, "-");
  renameSync(record, before);
  renameSync(top, record);
  rmSync(unpack, { recursive: true, force: true });
  io.out("record: the host's approval record is written back to " + record + "; the record from before the run is kept at " + before);
}

/** The host row: launch, relaunch, recovery, teardown and status of the controller host for one host plan. */
export function hostRow(s: HostSeams = {}): Row {
  return async (a: Args, io: Io, env: RowEnv): Promise<number> => {
    const verb = a.rest[0] as Verb;
    if (a.rest.length !== 1 || !VERBS.includes(verb)) fail("E_USAGE", "usage: gstack-evals dc " + USAGE);
    const planPath = a.flags.get("--plan") ?? fail("E_USAGE", "usage: gstack-evals dc " + USAGE);
    const recordPath = resolve(a.flags.get("--record") ?? fail("E_USAGE", "usage: gstack-evals dc " + USAGE));
    const p = await readHostPlan(planPath);
    const vars = s.env ?? process.env;
    if (verb === "launch" && existsSync(recordPath)) fail("E_USAGE", "the host record " + recordPath + " exists already; each launch writes a new one");
    if (verb !== "launch" && !existsSync(recordPath)) fail("E_USAGE", "no host record at " + recordPath + "; launch writes it");
    const archive = a.flags.get("--archive");
    if (verb === "teardown" && (!archive || existsSync(archive))) fail("E_USAGE", "teardown needs --archive <a folder that doesn't exist yet>");
    const keyed = verb === "launch" || verb === "relaunch" || verb === "recover";
    const lane = keyed || verb === "next" ? await hostRules(p, env) : { commit: env.lane().commit, root: env.lane().root };
    const owner = ownerFromEnv(vars);
    const plan = controllerPlanOf(p, lane, owner, s, verb === "launch" || verb === "recover");
    const inputs = (verb === "next" || verb === "relaunch") && p.inputs ? (needTmpfs(p.inputs, "the plan's inputs folder"), tarOf(resolve(p.inputs))) : null;
    const keys = keyed ? serviceEnv(vars, owner) : null;
    const b = await (s.backend ?? realBackend)(p, vars);
    const rec: HostRecord | null = verb === "launch" ? null : readJson<HostRecord>(recordPath, "--record");
    if (rec && rec.runId !== p.runId) fail("E_USAGE", "the host record is for run " + rec.runId + ", the plan for " + p.runId);
    if (verb === "launch") {
      const made = await launch(b, plan, keys!);
      saveRecord(recordPath, made);
      io.out("host: launched " + made.controller.vm + " with WAL host " + made.wal.vm + " in Ubicloud " + p.ubicloud.location + " at " + made.commit + (made.image ? " on trial image " + made.image : "") + "; stage " + p.stage.join(" "));
      if (made.tmpfs) io.out("host: the work folder is a tmpfs of " + mib(made.tmpfs.sizeBytes) + " MiB, sized from the controller host's " + mib(made.tmpfs.memBytes) + " MiB of memory");
      return 0;
    }
    try {
      if (verb === "status") {
        const st = await hostStatus(b, plan, rec!, { tail: STATUS_TAIL });
        io.out(st === null ? "host: the controller host " + rec!.controller.vm + " is gone; recover it" : "host: " + rec!.controller.vm + (st.running ? " runs" : " is up with no service running") + (st.status ? ", " + st.status.items.length + " open item(s), last snapshot " + (st.status.lastSnapshot ?? "none") + (st.status.captain ? ", Captain stop: " + st.status.captain.why : "") : ""));
        for (const r of st?.rows ?? []) io.out("row " + r.n + " " + r.row + ": " + r.state + (r.state === "running" ? " since " + r.startedAt : ", " + r.startedAt + " to " + r.endedAt) + (r.code ? " (" + r.code + ")" : ""));
        if (st && !st.rows.length) io.out("rows: none yet");
        for (const t of st?.tail ?? []) io.out("log: " + t);
        return 0;
      }
      if (verb === "next") {
        if (lane.commit !== rec!.commit) refuse("2", "the host runs " + rec!.commit + " and this checkout is at " + lane.commit + "; check out the host's commit to send it a row");
        const r = await sendRow(b, plan, rec!, inputs);
        if (r.kind === "busy") throw new DcError("E_DCH_ROW_RUNNING", "row " + r.row.n + " (" + r.row.row + ") still runs on " + rec!.controller.vm + " since " + r.row.startedAt + "; nothing was uploaded or sent");
        io.out("host: " + (r.kind === "sent" ? "row " + r.row.n + " started: " + p.stage.join(" ") : r.kind === "lost" ? "the controller host is gone; recover it" : r.kind === "down" ? "the service isn't running; relaunch it with this stage" : "the service refused the row: " + r.why));
        return r.kind === "sent" ? 0 : 3;
      }
      if (verb === "relaunch") {
        const r = await relaunch(b, plan, rec!, keys!, inputs);
        io.out("host: " + (r.kind === "relaunched" ? "relaunched (" + r.status.boot + ")" : r.kind === "captain" ? "stopped for the Captain: " + r.why : r.kind === "lost" ? "the controller host is gone; recover it" : "the service still runs; nothing to relaunch"));
        return r.kind === "relaunched" || r.kind === "running" ? 0 : 3;
      }
      if (verb === "recover") {
        const r = await recoverHost(b, plan, rec!, keys!);
        io.out("host: " + (r.kind === "recovered" ? "recovered on " + rec!.controller.vm + " (" + r.status.boot + ")" : "stopped for the Captain: " + r.why));
        return r.kind === "recovered" ? 0 : 3;
      }
      const t = await teardown(b, plan, rec!, { force: a.bools.has("--force") });
      if (t.kind === "refused") {
        io.out("host: teardown refused: " + t.why);
        return 3;
      }
      writeArchive(resolve(archive!), p, t.archive, io, env.now);
      io.out("host: torn down; both VMs are deleted");
      return 0;
    } finally {
      saveRecord(recordPath, rec!);
    }
  };
}

/** The two hosts on Ubicloud's API, with the launcher's own key and the token read by name. */
async function realBackend(p: HostPlanFile, env: Readonly<Record<string, string | undefined>>): Promise<HostBackend> {
  const u = p.ubicloud;
  return keyedUbicloud({ project: u.project, location: u.location, size: u.size, image: u.image, privateSubnet: u.privateSubnet ?? undefined, env, keyPath: u.keyPath, knownHosts: u.knownHosts });
}

export const hostCommand: Row = (a, io, env) => hostRow()(a, io, env);
