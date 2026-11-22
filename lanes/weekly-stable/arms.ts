// Copyright (c) 2026 Garry Tan. MIT License.
// Steps 2 and 3 of a week (lanes/weekly-stable/README.md): each gstack arm's manifest and checks, and the contamination search
// for the 133 task ids in every built gstack tree. The manifests are written per week to a gitignored folder
// (quick/laneb/arms/manifests/weekly) and copied into the run record; none's manifest is B1's byte for byte.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manifest } from "../../quick/laneb/arms/tree.ts";
import { TAR_ARGS } from "../delivery-route/arms.ts";
import { settingsHooks } from "../delivery-route/b1d.ts";
import { sha256 } from "../delivery-route/pins.ts";
import { GSTACK, GSTACK_ARMS, NONE_TAR_SHA256, REPO, WEEKLY, WEEKLY_ARMS, type GstackArm } from "./pins.ts";

const pinErr = (m: string): never => { throw new Error("E_WEEKLY_PIN " + m); };
export const ARMS_DIR = () => process.env[WEEKLY.armsDirEnv] ?? join(process.env.HOME ?? "", ".capy/work/weekly/arms");
export const manifestDir = () => join(REPO, "quick/laneb", WEEKLY.armManifests);
export const B1_NONE = () => join(REPO, "quick/laneb/arms/manifests/b1/none.json");
const MARKERS = [".activated", ".completeness-intro-seen", ".feature-prompted-model-overlay", ".first-loop-tip-shown", ".proactive-prompted", ".telemetry-prompted"];
const gitDir = (tree: string) => join(tree, ".claude/skills/gstack/.git");
const git = (tree: string, args: string[]) => spawnSync("git", ["--git-dir", gitDir(tree), ...args], { encoding: "utf8" });

export type FetchPin = { arm: string; repo: string; sha: string; head: string; version: string; rev_list_all: number; remotes: number; method: string; git_archive_sha256: string };
export const readTsv = (f: string) => Object.fromEntries(readFileSync(f, "utf8").trim().split("\n").map((l) => l.split("\t")));

/** What a built gstack tree must hold: the checkout at the arm's sha with one commit, no remote and no FETCH_HEAD; gstack's own
 *  hook registrations (any, as shipped); the seeded user; update checks off; telemetry off as the tree's gstack-config reads it. */
export function treeProblems(tree: string, sha: string, config: Record<string, string>): string[] {
  const p: string[] = [];
  const head = git(tree, ["rev-parse", "HEAD"]).stdout.trim(), count = git(tree, ["rev-list", "--all", "--count"]).stdout.trim(), remotes = git(tree, ["remote"]).stdout.trim();
  if (head !== sha) p.push("the gstack checkout is at " + (head || "nothing") + ", not " + sha);
  if (count !== "1") p.push("the gstack checkout holds " + (count || "no") + " commits, not 1");
  if (remotes) p.push("the gstack checkout has a remote (" + remotes.split("\n").join(", ") + ")");
  if (existsSync(join(gitDir(tree), "FETCH_HEAD"))) p.push("the gstack checkout keeps a FETCH_HEAD");
  if (!existsSync(join(tree, ".claude/settings.json"))) p.push("no .claude/settings.json");
  else if (!settingsHooks(tree).length) p.push("settings.json registers no gstack hook");
  const cfg = existsSync(join(tree, ".gstack/config.yaml")) ? readFileSync(join(tree, ".gstack/config.yaml"), "utf8") : "";
  for (const l of ["update_check: false", "routing_declined: true"]) if (!new RegExp("^" + l + "$", "m").test(cfg)) p.push(".gstack/config.yaml does not set " + l);
  for (const m of MARKERS) if (!existsSync(join(tree, ".gstack", m))) p.push("the seeded user's marker .gstack/" + m + " is missing");
  if (config.telemetry !== "off") p.push("gstack-config reads telemetry " + JSON.stringify(config.telemetry) + ", not off");
  return p;
}

export function armManifestOf(out: string, a: GstackArm, sha: string) {
  const tree = join(out, "trees", a), fetch = JSON.parse(readFileSync(join(out, a + ".fetch-pin.json"), "utf8")) as FetchPin;
  if (fetch.sha !== sha || fetch.head !== sha) pinErr(a + ".fetch-pin.json is not " + sha);
  const config = readTsv(join(out, a + ".gstack-config.tsv"));
  const meta = {
    claude_code: "2.1.312", typed: false, spec: WEEKLY_ARMS[a].spec, tar_gz_sha256: sha256(readFileSync(join(out, a + ".tar.gz"))),
    gstack: { repo: GSTACK.repo, sha, version: fetch.version, setup: GSTACK.setup, git_archive_sha256: fetch.git_archive_sha256, fetch: fetch.method, rev_list_all: fetch.rev_list_all, remotes: fetch.remotes },
    update_check: "false", routing_declined: "true", onboarding_markers: MARKERS.map((m) => ".gstack/" + m).join(" "), gstack_config: config,
    loadout_lock_sha256: sha256(readFileSync(join(out, a + ".loadout.lock.json"))), hooks: settingsHooks(tree),
    tar_command: "tar " + TAR_ARGS.join(" ") + " -cf <arm>.tar .claude .gstack (in quick/laneb/arms/Dockerfile's builder image)",
  };
  return manifest(a, tree, join(out, a + ".tar"), meta);
}

/** Writes every arm's manifest: none's copied from B1, each gstack arm's from its built tree. */
export function writeManifests(out: string, shas: Record<GstackArm, string>): string[] {
  mkdirSync(manifestDir(), { recursive: true });
  cpSync(B1_NONE(), join(manifestDir(), "none.json"));
  return GSTACK_ARMS.map((a) => {
    const m = armManifestOf(out, a, shas[a]);
    writeFileSync(join(manifestDir(), a + ".json"), JSON.stringify({ ...m.summary, inventory_sha256: sha256(m.list) }, null, 2) + "\n");
    writeFileSync(join(out, a + ".files.tsv"), m.list);
    return a + " manifest: gstack " + shas[a].slice(0, 12) + ", files " + m.summary.tree.files + ", tar " + m.summary.tar.sha256;
  });
}

/** none's manifest B1's byte for byte at B1's tar digest; each gstack arm's tar.gz unpacking to its manifest's tar, at the
 *  week's sha, with its tree's checks passing. */
export function armsCheck(out: string, shas: Record<GstackArm, string>): { pass: boolean; lines: string[] } {
  const lines: string[] = [], problems: string[] = [], m = (a: string) => join(manifestDir(), a + ".json");
  if (!existsSync(m("none")) || !readFileSync(m("none")).equals(readFileSync(B1_NONE()))) problems.push(WEEKLY.armManifests + "/none.json is not arms/manifests/b1/none.json byte for byte");
  else if (JSON.parse(readFileSync(m("none"), "utf8")).tar?.sha256 !== NONE_TAR_SHA256) problems.push("none's manifest does not pin B1's tar " + NONE_TAR_SHA256);
  else lines.push("none: B1's manifest byte for byte, tar " + NONE_TAR_SHA256);
  for (const a of GSTACK_ARMS) {
    if (!existsSync(m(a))) { problems.push("no manifest " + m(a)); continue; }
    const want = JSON.parse(readFileSync(m(a), "utf8")), gz = join(out, a + ".tar.gz");
    if (want.spec !== WEEKLY_ARMS[a].spec) problems.push(a + ": the manifest's spec is not " + WEEKLY_ARMS[a].spec);
    if (want.gstack?.sha !== shas[a]) problems.push(a + ": the manifest pins gstack " + want.gstack?.sha + ", not this week's " + shas[a]);
    const got = existsSync(gz) ? spawnSync("sh", ["-c", 'gzip -dc "$1" | sha256sum', "sh", gz], { encoding: "utf8" }).stdout.split(" ")[0] : "missing";
    if (got !== want.tar?.sha256) problems.push(a + ": " + gz + " unpacks to sha256 " + got + ", not the manifest's " + want.tar?.sha256);
    else if (sha256(readFileSync(gz)) !== want.tar_gz_sha256) problems.push(a + ": the tar.gz is not the manifest's tar_gz_sha256");
    else lines.push(a + ": tar.gz " + want.tar_gz_sha256 + " unpacks to the manifest's tar " + want.tar.sha256);
    const tree = join(out, "trees", a);
    if (!existsSync(tree)) { problems.push(a + ": no tree at " + tree); continue; }
    const p = treeProblems(tree, shas[a], readTsv(join(out, a + ".gstack-config.tsv")));
    problems.push(...p.map((x) => a + ": " + x));
    if (!p.length) lines.push(a + ": gstack " + shas[a].slice(0, 12) + " (" + want.gstack.version + "), one commit, no remote, " + want.hooks.length + " hook registrations, the seeded user, telemetry off, skill_routing " + want.gstack_config.skill_routing);
  }
  if (shas.candidate === shas.stable) problems.push("candidate and stable are the same sha " + shas.stable);
  for (const p of problems) lines.push("PROBLEM " + p);
  return { pass: !problems.length, lines };
}

// ---- The contamination search (preregistration section 6 step 3, pre-run change 1 section 10): each task id as
// owner__repo-N (case-sensitive), and owner/repo#N, owner/repo/pull/N and owner/repo/issues/N (case-insensitive), each
// followed by a non-digit or the end of the text.
export function formsOf(id: string) {
  const m = /^(.+?)__(.+)-(\d+)$/.exec(id);
  if (!m) return pinErr("task id " + id + " is not owner__repo-N");
  const [, owner, repo, n] = m as unknown as [string, string, string, string];
  return { id, owner, repo, n, others: [owner + "/" + repo + "#" + n, owner + "/" + repo + "/pull/" + n, owner + "/" + repo + "/issues/" + n] };
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/#-]/g, "\\$&");
export const idPattern = (ids: string[]) => "(?:" + ids.map((i) => esc(i)).join("|") + ")(?![0-9])";
export const otherPattern = (ids: string[]) => "(?:" + ids.flatMap((i) => formsOf(i).others.map(esc)).join("|") + ")(?![0-9])";
/** The ids a text names, in any form. */
export function scanText(text: string, ids: string[]): string[] {
  const hit = new Set<string>(), lower = text.toLowerCase();
  for (const id of ids) {
    if (new RegExp(esc(id) + "(?![0-9])").test(text)) { hit.add(id); continue; }
    if (formsOf(id).others.some((f) => new RegExp(esc(f.toLowerCase()) + "(?![0-9])").test(lower))) hit.add(id);
  }
  return [...hit].sort();
}
/** Every file under a built tree (the gstack checkout and everything ./setup wrote), binary files read as text. */
export function contaminationSearch(tree: string, ids: string[]): { hits: Record<string, string[]>; error: string | null } {
  const hits: Record<string, string[]> = {};
  for (const [flags, pattern] of [[["-P"], idPattern(ids)], [["-P", "-i"], otherPattern(ids)]] as const) {
    const r = spawnSync("grep", ["-r", "-a", "-o", "-H", ...flags, pattern, "."], { cwd: tree, encoding: "utf8", maxBuffer: 256 << 20 });
    if (r.status !== 0 && r.status !== 1) return { hits, error: "grep exited " + r.status + ": " + (r.stderr ?? "").trim().slice(0, 300) };
    for (const line of (r.stdout ?? "").split("\n").filter(Boolean)) {
      const at = line.lastIndexOf(":"), file = line.slice(0, at), found = scanText(line.slice(at + 1), ids);
      for (const id of found) hits[id] = [...new Set([...(hits[id] ?? []), file])].sort();
    }
  }
  return { hits, error: null };
}
