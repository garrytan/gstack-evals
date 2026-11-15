// Copyright (c) 2026 Garry Tan. MIT License.
// home_tree_sha256 (types.ts ArmInstall): sha256 over the sorted (path, mode, content sha256) list of an installed home,
// read with lstat and never following a link. Modes are git's: 100644 or 100755 for a file by its owner execute bit, and
// 120000 for a link, whose content is its target text. Directories are not entries. The frozen rule (HASH_RULE, measured
// by installing every home twice on the freeze date, PART-A.md) leaves out the paths that differ from run to run and
// hashes listed JSON files with their run-to-run keys removed.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

/** The frozen hash rule, from two installs of every home on the freeze date (PART-A.md lists what each line covers).
 *  Globs are relative to HOME: * is one path segment's characters, ** any number of whole segments. skip: files and links
 *  left out. json: JSON files hashed as JSON.stringify of the parsed file with the listed keys deleted at any depth.
 *  text: files whose matches of a pattern are replaced before hashing. A path takes the first json rule it matches;
 *  text rules apply to files no json rule matches. */
export const HASH_RULE = {
  skip: [
    ".claude/backups/**",
    ".npm/_cacache/index-v5/**",
    ".npm/_logs/**",
    "**/.git/index",
    "**/.git/logs/**",
    ".claude/skills/gstack/bin/.gstack-cso-build.log",
    ".claude/plugins/.last_inuse_sweep",
  ],
  json: [
    { glob: ".claude.json", drop: ["firstStartTime", "machineID", "userID"] },
    { glob: ".claude/plugins/installed_plugins.json", drop: ["installedAt", "lastUpdated"] },
    { glob: ".claude/plugins/known_marketplaces.json", drop: ["lastUpdated"] },
    { glob: ".claude/gsd-install-state.json", drop: ["appliedAt"] },
    { glob: ".claude/gsd-file-manifest.json", drop: ["timestamp", "files"] },
    { glob: ".gstack/.gbrain-local-status-cache.json", drop: ["cached_at"] },
  ],
  text: [
    { glob: ".claude/**", pattern: "(GSD_[A-Z_]*ARGS_END)_[0-9a-f]{32}", replace: "$1_NONCE" },
    { glob: ".gstack/installs.tsv", pattern: "\\t\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ$", replace: "\tTIME" },
  ],
};

/** A glob as a whole-path regex. */
export function globRe(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

const dropKeys = (v: unknown, drop: Set<string>): unknown => {
  if (Array.isArray(v)) return v.map((x) => dropKeys(x, drop));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !drop.has(k)).map(([k, x]) => [k, dropKeys(x, drop)]));
  return v;
};

export interface HomeEntry { path: string; mode: "100644" | "100755" | "120000"; sha256: string }

/** Every file and link under dir as a sorted entry list, the frozen rule applied unless raw. Other file types refuse. */
export function homeEntries(dir: string, raw = false): HomeEntry[] {
  const skip = raw ? [] : HASH_RULE.skip.map(globRe);
  const json = raw ? [] : HASH_RULE.json.map((j) => ({ re: globRe(j.glob), drop: new Set(j.drop) }));
  const text = raw ? [] : HASH_RULE.text.map((t) => ({ re: globRe(t.glob), pattern: new RegExp(t.pattern, "gm"), replace: t.replace }));
  const out: HomeEntry[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      const r = rel ? rel + "/" + name : name;
      const st = lstatSync(p);
      if (st.isDirectory()) {
        walk(p, r);
        continue;
      }
      if (skip.some((re) => re.test(r))) continue;
      if (st.isSymbolicLink()) out.push({ path: r, mode: "120000", sha256: sha(readlinkSync(p)) });
      else if (st.isFile()) {
        const j = json.find((x) => x.re.test(r));
        const t = j ? [] : text.filter((x) => x.re.test(r));
        let body: string | Buffer = readFileSync(p);
        if (j) body = JSON.stringify(dropKeys(JSON.parse(body.toString("utf8")), j.drop));
        else if (t.some((x) => { x.pattern.lastIndex = 0; return x.pattern.test((body as Buffer).toString("latin1")); })) body = t.reduce((s, x) => s.replace(x.pattern, x.replace), (body as Buffer).toString("latin1"));
        out.push({ path: r, mode: st.mode & 0o100 ? "100755" : "100644", sha256: sha(typeof body === "string" ? Buffer.from(body, "latin1") : body) });
      } else throw new Error("E_H2H_INSTALL " + p + " is neither a file, a link nor a directory");
    }
  };
  walk(dir, "");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The home's tree hash: one JSON array [path, mode, sha256] per entry, newline-joined, sorted by path. */
export const treeSha256 = (entries: HomeEntry[]): string => sha(entries.map((e) => JSON.stringify([e.path, e.mode, e.sha256])).join("\n"));
export const homeTreeSha256 = (dir: string): string => treeSha256(homeEntries(dir));

/** Directories under HOME that hold several packs' entries; every other entry the walk meets is a root. */
export const SHARED_DIRS = [".claude", ".claude/plugins", ".claude/plugins/cache", ".claude/plugins/marketplaces", ".claude/plugin-sources", ".claude/skills", ".claude/agents", ".claude/commands", ".claude/hooks", ".cache", ".config", ".local", ".local/share", ".local/bin"];

/** The roots a home's install wrote (types.ts ArmInstall roots), relative to HOME: the walk descends only into
 *  SHARED_DIRS and every other entry it meets is one root. */
export function homeRoots(dir: string): string[] {
  const shared = new Set(SHARED_DIRS);
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs).sort()) {
      const r = rel ? rel + "/" + name : name;
      if (shared.has(r) && lstatSync(join(abs, name)).isDirectory()) walk(join(abs, name), r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out;
}
