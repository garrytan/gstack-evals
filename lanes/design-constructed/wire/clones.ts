// Copyright (c) 2026 Garry Tan. MIT License.
// dc clones (PD-15): the kept base-app clones live only as a sealed record of each clone's frame position, repository,
// commit and tree. This keyless row re-fetches each one by its commit through the frame's own clone seam and fetchAt
// (depth 1, hooks off, no filters, no LFS smudge, no repository code run), checks HEAD^{tree} against the record and
// drops a base app whose commit can't be fetched or whose tree differs, printing its frame position and the reason. A
// dropped app is never swapped for another: only the record's entries are fetched, once each. A record that holds every
// frame clone marks the file-check passes with kept: true; then only those entries are fetched, and the rest print as a
// count of entries not kept, never fetched and never dropped. A record with no kept flags fetches every entry. An
// entry's source is not read. The output folder takes
// the layout the frame left, so the readers point at it unchanged: clones/c<NNN> (the recipe candidate id) at the
// commit, clones.json as CloneRecord rows, filecheck.json from the file check on each matched clone, and run.json. The
// recipes row reads the folder as --frame, apps.json's dir and exports.json's source.clone name clones/c<NNN>, and
// exports.json's base is the record's commit and tree. Nothing printed or thrown carries a repository name, a URL, a
// commit, a tree or a path segment taken from the record; lines carry counts, frame positions and sha256 digests only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fail } from "../errors.ts";
import { fileCheck, type FileCheck } from "../frame/filecheck.ts";
import { git } from "../frame/git.ts";
import { realSeams, type CloneRecord, type FrameSeams } from "../frame/run.ts";
import { need, type Row } from "./start.ts";

/** One sealed record entry: the frame's CloneRecord position, repository and commit, and the clone's tree. */
export interface KeptClone {
  position: number;
  nameWithOwner: string;
  /** The commit the frame fetched (CloneRecord.oid); an entry's `commit` is read when it has no oid. */
  oid: string;
  tree: string;
  /** False when the record holds the entry but the file check didn't keep it; such an entry is never fetched. */
  kept: boolean;
}

export const REFETCH_REASONS = {
  unfetchable: "the commit can't be fetched",
  tree: "the tree differs from the record",
} as const;

const OID = /^[0-9a-f]{40}$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const REPO_ROOT = resolve(import.meta.dir, "../../..");

/** The record's entries in frame order. Refuses with E_USAGE naming only an entry's index, never its contents. */
export function readRecord(path: string): { entries: KeptClone[]; digest: string; flagged: boolean } {
  if (!existsSync(path)) fail("E_USAGE", "--record " + path + " does not exist");
  const text = readFileSync(path, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("E_USAGE", "--record is not JSON");
  }
  if (!Array.isArray(raw) || !raw.length) fail("E_USAGE", "--record holds no clone entries; it is a JSON array of { position, nameWithOwner, oid, tree }");
  const seen = new Set<number>();
  const flagged = (raw as any[]).some((e) => e != null && typeof e === "object" && "kept" in e);
  const entries = (raw as any[]).map((e, i): KeptClone => {
    const oid = e?.oid ?? e?.commit;
    const ok = Number.isInteger(e?.position) && e.position > 0 && e.position < 1000 && typeof e.nameWithOwner === "string" && e.nameWithOwner !== "" && typeof oid === "string" && OID.test(oid) && typeof e.tree === "string" && OID.test(e.tree);
    if (!ok) fail("E_USAGE", "--record entry " + i + " needs a frame position, a repository, a 40-hex commit and a 40-hex tree");
    if (flagged && typeof e.kept !== "boolean") fail("E_USAGE", "--record entry " + i + " has no true or false kept flag, while other entries carry one");
    if (seen.has(e.position)) fail("E_USAGE", "--record entry " + i + " repeats frame position " + e.position);
    seen.add(e.position);
    return { position: e.position, nameWithOwner: e.nameWithOwner, oid, tree: e.tree, kept: flagged ? e.kept : true };
  });
  return { entries: entries.sort((a, b) => a.position - b.position), digest: sha(text), flagged };
}

/** Re-fetches every record entry into out, which must not exist and must sit outside the repository. */
export function refetchClones(recordPath: string, outDir: string, clone: FrameSeams["clone"], check: (dir: string) => FileCheck = fileCheck): { lines: string[]; files: Record<string, string> } {
  const out = resolve(outDir);
  const rel = relative(REPO_ROOT, out);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail("E_USAGE", "--out must be a sealed folder outside the repository");
  if (existsSync(out)) fail("E_USAGE", "--out " + out + " exists already; the clones are fetched into a new folder");
  const record = readRecord(resolve(recordPath));
  const entries = record.entries.filter((e) => e.kept);
  const notKept = record.entries.length - entries.length;
  mkdirSync(join(out, "clones"), { recursive: true });
  const clones: CloneRecord[] = [];
  const checks: { position: number; nameWithOwner: string; check: FileCheck }[] = [];
  const drops: { position: number; reason: string }[] = [];
  for (const e of entries) {
    const path = join("clones", "c" + String(e.position).padStart(3, "0"));
    const dest = join(out, path);
    let reason: string | null = null;
    try {
      clone(e.nameWithOwner, e.oid, dest);
    } catch {
      reason = REFETCH_REASONS.unfetchable;
    }
    if (reason === null) {
      let tree = "";
      try {
        tree = git(dest, ["rev-parse", "HEAD^{tree}"]).trim();
      } catch {}
      if (tree !== e.tree) reason = REFETCH_REASONS.tree;
    }
    if (reason !== null) {
      rmSync(dest, { recursive: true, force: true });
      drops.push({ position: e.position, reason });
      clones.push({ position: e.position, nameWithOwner: e.nameWithOwner, oid: e.oid, fetched: false, reason, path: null });
      continue;
    }
    clones.push({ position: e.position, nameWithOwner: e.nameWithOwner, oid: e.oid, fetched: true, reason: null, path });
    checks.push({ position: e.position, nameWithOwner: e.nameWithOwner, check: check(dest) });
  }
  const files: Record<string, string> = {};
  const write = (name: string, value: unknown) => {
    const text = JSON.stringify(value, null, 2) + "\n";
    writeFileSync(join(out, name), text);
    files[name] = sha(text);
  };
  write("clones.json", clones);
  write("filecheck.json", checks);
  const passes = checks.filter((c) => c.check.pass).length;
  write("run.json", { kind: "dc clones", record_sha256: record.digest, counts: { records: entries.length, ...(record.flagged ? { not_kept: notKept } : {}), matched: checks.length, dropped: drops, filecheck_passes: passes }, files: { ...files } });
  const lines = [
    "clones: record sha256 " + record.digest,
    "clones: " + entries.length + " records, " + checks.length + " matched, " + drops.length + " dropped",
    ...(record.flagged ? ["not kept: " + notKept + " records the file check didn't keep; never fetched, never dropped"] : []),
    ...drops.map((d) => "dropped: frame position " + d.position + ": " + d.reason + "; the base app drops and is never swapped for another"),
    "file check passes: " + passes + " of " + checks.length + " matched",
    ...Object.entries(files).map(([n, h]) => "sha256 " + n + " " + h),
  ];
  return { lines, files };
}

/** The dc clones row; the command line fetches from GitHub over HTTPS through the frame's own clone seam. */
export const clonesRow = (clone?: FrameSeams["clone"]): Row => (a, io) => {
  const usage = "clones --record <sealed clone record JSON> --out <new sealed folder outside the repo>";
  const record = need(a, "--record", usage);
  const out = need(a, "--out", usage);
  for (const l of refetchClones(record, out, clone ?? realSeams().clone).lines) io.out(l);
  return 0;
};
