// Copyright (c) 2026 Garry Tan. MIT License.
// noloss ingest (plan section 3): reads an arm directory once into memory, validates exactly those bytes against arm
// contract v1, scans them for key shapes, sealed markers and machine paths, and publishes them to
// <root>/<suite>/<arm id>/ through a staging directory and a rename. It never edits the source directory. A destination
// that already holds different bytes is refused unless --replace gives a reason, which ingest.json records.
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARM_ID, ContractError, parseArm, type Arm, type Problem } from "./contract.ts";
import { scanText } from "./scan.ts";
import { insideRepo, LANE_DIR, sha256, type Suite } from "./suite.ts";

export const ARMS_ROOT = join(LANE_DIR, "arms");
const TOP = new Set(["arm.json", "judgments.tsv", "cost.tsv", "findings"]);
const KEEP_IN_DIGEST_ONLY = ["severity", "label", "path", "line", "category", "reader", "specialist", "voice", "pass", "id", "fingerprint", "confidence"];
export const INGEST_RECORD = "ingest.json";

const fail = (where: string, message: string, fix: string): never => {
  throw new ContractError([{ code: "E_NOLOSS_ARM", where, message, fix }]);
};

/**
 * The arm's files as bytes, read once. Only arm.json, judgments.tsv, cost.tsv and findings/*.jsonl are allowed; a
 * symlink, a non-regular file or any other file is refused.
 */
export function snapshot(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const kind = (p: string) => {
    try {
      return lstatSync(p);
    } catch (e) {
      return fail(p, "cannot read: " + (e as Error).message, "pass the arm directory that holds arm.json");
    }
  };
  if (!kind(dir).isDirectory()) fail(dir, "not a directory (a symlink is refused too)", "pass the arm directory itself");
  const extra: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const st = kind(join(dir, name));
    if (st.isSymbolicLink()) fail(name, "is a symlink", "copy the real file into the arm directory");
    if (!TOP.has(name)) {
      extra.push(name);
      continue;
    }
    if (name === "findings") {
      if (!st.isDirectory()) fail(name, "is not a directory", "make findings/ a directory of <unit>.jsonl files");
      for (const f of readdirSync(join(dir, name)).sort()) {
        const fst = kind(join(dir, name, f));
        if (fst.isSymbolicLink()) fail("findings/" + f, "is a symlink", "copy the real file into findings/");
        if (!fst.isFile() || !f.endsWith(".jsonl")) extra.push("findings/" + f);
        else files.set("findings/" + f, readFileSync(join(dir, name, f)));
      }
    } else if (!st.isFile()) fail(name, "is not a regular file", "replace it with a regular file");
    else files.set(name, readFileSync(join(dir, name)));
  }
  if (extra.length) fail(extra.join(", "), "not part of arm contract v1", "move it out of the arm directory; the contract holds arm.json, findings/<unit>.jsonl, judgments.tsv and cost.tsv");
  return files;
}

export interface Prepared {
  arm: Arm;
  /** What gets published, after any digest-only substitution, plus ingest.json. */
  out: Map<string, Buffer>;
  digestOnly: string[];
  treeSha256: string;
}

const treeDigest = (files: Map<string, Buffer>): string => sha256([...files].filter(([k]) => k !== INGEST_RECORD).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + "\0" + sha256(v)).join("\n"));

/**
 * Validates and scans the snapshot. digestOnly names findings (by id, or "all") whose text is replaced by the digest of
 * its original line; a scan hit anywhere else is refused, naming the rule and place but never the text.
 */
export function prepare(files: Map<string, Buffer>, suite: Suite, suiteSha256: string, digestOnly: string[]): Prepared {
  const arm = parseArm(files, suite, suiteSha256);
  const all = digestOnly.includes("all");
  const used = new Set<string>();
  const problems: Problem[] = [];
  const out = new Map<string, Buffer>();
  for (const [name, bytes] of files) {
    const lines = bytes.toString("utf8").split("\n");
    if (!name.startsWith("findings/")) {
      lines.forEach((l, i) => {
        const hits = scanText(l);
        if (hits.length) problems.push({ code: "E_NOLOSS_ARM", where: name + " line " + (i + 1), message: "breaks the publication scan (" + hits.join(", ") + ")", fix: "remove it in the source arm and ingest again; only findings can be published digest-only" });
      });
      out.set(name, bytes);
      continue;
    }
    const rewritten = lines.map((l, i) => {
      if (!l.trim()) return l;
      const f = JSON.parse(l) as Record<string, unknown>;
      const id = String(f.id ?? f.fingerprint ?? "#" + i);
      const hits = scanText(l);
      if (all || digestOnly.includes(id)) {
        used.add(id);
        const kept = Object.fromEntries(KEEP_IN_DIGEST_ONLY.filter((k) => k in f).map((k) => [k, f[k]]));
        if (!("id" in kept) && !("fingerprint" in kept)) kept.id = id;
        const digest = "sha256:" + sha256(l);
        return JSON.stringify({ ...kept, summary: "[digest-only " + digest + "]", digest_only: digest });
      }
      if (hits.length) problems.push({ code: "E_NOLOSS_ARM", where: name + " line " + (i + 1) + " (finding " + JSON.stringify(id) + ")", message: "breaks the publication scan (" + hits.join(", ") + ")", fix: "remove it in the source arm, or pass --digest-only " + id + " to publish only that finding's digest" });
      return l;
    });
    out.set(name, Buffer.from(rewritten.join("\n")));
  }
  const unused = digestOnly.filter((d) => d !== "all" && !used.has(d));
  if (unused.length) problems.push({ code: "E_NOLOSS_ARM", where: "--digest-only", message: "names no finding: " + unused.join(", "), fix: "use ids from findings/<unit>.jsonl (id, fingerprint or #<0-based line>)" });
  if (problems.length) throw new ContractError(problems);
  const sources = Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sha256(v)]));
  const treeSha256 = treeDigest(out);
  const record = { contract_version: 1, suite: suite.id, suite_sha256: suiteSha256, arm: arm.arm.id, state: arm.state, provenance: arm.provenance, source_sha256: sources, tree_sha256: treeSha256, digest_only: all ? "all" : [...used].sort(), replaced: null as string | null };
  out.set(INGEST_RECORD, Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  return { arm, out, digestOnly: all ? ["all"] : [...used].sort(), treeSha256 };
}

function readTree(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) {
    if (name === "findings") for (const f of readdirSync(join(dir, name))) files.set("findings/" + f, readFileSync(join(dir, name, f)));
    else files.set(name, readFileSync(join(dir, name)));
  }
  return files;
}

/**
 * Publishes a prepared arm under root. Returns unchanged when the destination already holds the same tree. A sealed
 * suite's arms never land inside the repo.
 */
export function publish(p: Prepared, suite: Suite, root: string, replace: string | null): { dest: string; status: "published" | "unchanged" | "replaced" } {
  if (!ARM_ID.test(p.arm.arm.id)) fail("arm.json id", "not a safe directory name", "use letters, digits, _ and -");
  if (suite.sealed && insideRepo(root)) fail("--root", "suite " + suite.id + " is sealed, and " + root + " is inside the repo", "pass --root <dir> outside the repo; commit only counts and digests");
  const parent = join(root, suite.id);
  const dest = join(parent, p.arm.arm.id);
  let existing: Map<string, Buffer> | null = null;
  try {
    if (lstatSync(dest).isDirectory()) existing = readTree(dest);
  } catch {
    existing = null;
  }
  if (existing) {
    const before = treeDigest(existing);
    if (before === p.treeSha256) return { dest, status: "unchanged" };
    if (replace === null) fail(dest, "already holds arm " + p.arm.arm.id + " with tree digest " + before + "; this ingest would publish " + p.treeSha256, "ingest under a new arm id, or pass --replace \"<reason>\" to replace it with the reason recorded");
    const record = JSON.parse(p.out.get(INGEST_RECORD)!.toString("utf8"));
    record.replaced = replace + " (replaced tree " + before + ")";
    p.out.set(INGEST_RECORD, Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  }
  mkdirSync(parent, { recursive: true });
  const staging = join(parent, "." + p.arm.arm.id + ".staging-" + process.pid);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, "findings"), { recursive: true });
  for (const [name, bytes] of p.out) writeFileSync(join(staging, name), bytes);
  if (![...p.out.keys()].some((k) => k.startsWith("findings/"))) rmSync(join(staging, "findings"), { recursive: true });
  if (existing) {
    const old = join(parent, "." + p.arm.arm.id + ".old-" + process.pid);
    renameSync(dest, old);
    renameSync(staging, dest);
    rmSync(old, { recursive: true, force: true });
    return { dest, status: "replaced" };
  }
  renameSync(staging, dest);
  return { dest, status: "published" };
}
