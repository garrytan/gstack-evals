// Tree walk, digest and manifest for the arm trees.
//
// skills.tree_digest covers everything under .claude/skills; skills.skill_md_digest
// covers only <skill>/SKILL.md, the placebo generator's input.
//
// The digest is sha256 over one line per entry, sorted by relative path:
// "<sha256 of the file>  <path>\n" for a regular file and
// "link:<target>  <path>\n" for a symlink. Directories and modes are not in
// the digest; the canonical tar carries them and has its own sha256.
//
//   bun arms/tree.ts manifest --arm <name> --tree <dir> --tar <file> --out <dir> [--meta k=v ...]

import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type Entry = { path: string; type: "file" | "link" | "dir"; mode: number; size: number; sha256: string };

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const byPath = (a: Entry, b: Entry) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));

export function walk(root: string): Entry[] {
  const out: Entry[] = [];
  const visit = (rel: string) => {
    for (const name of readdirSync(join(root, rel))) {
      const path = rel ? rel + "/" + name : name;
      const st = lstatSync(join(root, path));
      const mode = st.mode & 0o7777;
      if (st.isSymbolicLink()) out.push({ path, type: "link", mode, size: 0, sha256: "link:" + readlinkSync(join(root, path)) });
      else if (st.isDirectory()) {
        out.push({ path, type: "dir", mode, size: 0, sha256: "-" });
        visit(path);
      } else out.push({ path, type: "file", mode, size: st.size, sha256: sha256(readFileSync(join(root, path))) });
    }
  };
  visit("");
  return out.sort(byPath);
}

export function treeDigest(entries: Entry[]): string {
  return sha256(entries.filter((e) => e.type !== "dir").map((e) => e.sha256 + "  " + e.path + "\n").join(""));
}

export function skillNames(root: string): string[] {
  try {
    return readdirSync(join(root, ".claude/skills"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && readdirSync(join(root, ".claude/skills", d.name)).includes("SKILL.md"))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function manifest(arm: string, root: string, tarPath: string, meta: Record<string, string>) {
  const entries = walk(root);
  const skillsPrefix = ".claude/skills/";
  const files = entries.filter((e) => e.type === "file");
  const skillEntries = entries.filter((e) => e.path.startsWith(skillsPrefix)).map((e) => ({ ...e, path: e.path.slice(skillsPrefix.length) }));
  const tar = readFileSync(tarPath);
  const summary = {
    arm,
    ...meta,
    tar: { file: tarPath.split("/").pop(), bytes: tar.length, sha256: sha256(tar) },
    tree: {
      files: files.length,
      symlinks: entries.filter((e) => e.type === "link").length,
      dirs: entries.filter((e) => e.type === "dir").length,
      bytes: files.reduce((n, e) => n + e.size, 0),
      digest: treeDigest(entries),
    },
    skills: {
      count: skillNames(root).length,
      tree_digest: treeDigest(skillEntries),
      skill_md_digest: treeDigest(skillEntries.filter((e) => /^[^/]+\/SKILL\.md$/.test(e.path))),
      names: skillNames(root),
    },
  };
  const list = ["sha256\tbytes\tmode\ttype\tpath", ...entries.map((e) => [e.sha256, e.size, e.mode.toString(8), e.type, e.path].join("\t"))];
  return { summary, list: list.join("\n") + "\n" };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [cmd] = args;
  const arm = flag("--arm");
  const root = flag("--tree");
  const tarPath = flag("--tar");
  const outDir = flag("--out");
  if (cmd !== "manifest" || !arm || !root || !tarPath || !outDir) {
    console.error("E_USAGE usage: tree.ts manifest --arm <name> --tree <dir> --tar <file> --out <dir> [--meta k=v ...]");
    process.exit(2);
  }
  const meta: Record<string, string> = {};
  args.forEach((a, i) => {
    if (a === "--meta") {
      const [k, ...v] = (args[i + 1] ?? "").split("=");
      if (k) meta[k] = v.join("=");
    }
  });
  const { summary, list } = manifest(arm, root, tarPath, meta);
  writeFileSync(join(outDir, arm + ".json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(join(outDir, arm + ".files.tsv"), list);
  console.log(arm + " files=" + summary.tree.files + " bytes=" + summary.tree.bytes + " skills=" + summary.skills.count +
    " tree_digest=" + summary.tree.digest + " tar_sha256=" + summary.tar.sha256);
}
