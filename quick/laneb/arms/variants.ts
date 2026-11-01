// One-entry variants of the arm tars for GEVA-106's runs. Each variant is its base tar with one
// regular-file entry's content replaced in place: that entry's size field and header checksum are
// rewritten, and every other header and byte (name order, mtime 0, owner) is kept, so the output
// depends only on the base tar's bytes and this file, never on the host's tar.
//
//   gstack-rewritten  gstack.tar with the description line of .claude/skills/investigate/SKILL.md
//                     replaced by the frozen text of the preregistration, section 3.
//   placebo-short     placebo.tar with .claude/skills/investigate/SKILL.md's body regenerated at
//                     847 o200k_base tokens by the placebo generator, frontmatter bytes kept.
//
//   bun arms/variants.ts --in <dir with gstack.tar and placebo.tar> --out <dir> [--manifests <dir>]
//   bun arms/variants.ts --carriers <tar> <text>    lists the regular-file entries whose bytes contain <text>
//
// Without --manifests the built tars and manifests are checked against the committed ones in arms/manifests.
// The tars are read with positional reads and written in chunks, so a 1.35 GB base is never held in memory.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { treeDigest, type Entry } from "./tree.ts";
import { countTokens, frontmatterFields, proceduralMarkers, prng, prose, splitSkill, topicTerms } from "./placebo/placebo.ts";
import { generatorHash } from "./placebo/generate.ts";

export const SKILL_PATH = ".claude/skills/investigate/SKILL.md";
export const SHIPPED_LINE = "description: Systematic debugging with root cause investigation. (gstack)";
export const REWRITTEN_DESCRIPTION =
  "Systematic debugging with root cause investigation. Use when a task involves something that does not work as expected: " +
  "a failing build, test, script, service or configuration, an error message or stack trace, wrong or missing output, " +
  "or broken data to recover. Use it before editing code to fix such a problem. (gstack)";
export const SHORT_SEED = "gstack-evals/laneb/placebo/v1-short";
export const SHORT_TARGET = 847;

const BLOCK = 512;
const RECORD = 10240;
const CHUNK = 8 << 20;
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const pad = (n: number) => Math.ceil(n / BLOCK) * BLOCK;
const cstr = (b: Uint8Array) => {
  const z = b.indexOf(0);
  return Buffer.from(z < 0 ? b : b.subarray(0, z)).toString("utf8");
};

export type TarEntry = { name: string; type: string; header: number; data: number; size: number };
export type Listing = { entries: TarEntry[]; end: number; size: number };

export function readAt(fd: number, pos: number, len: number): Buffer {
  const buf = Buffer.alloc(len);
  for (let off = 0; off < len; ) {
    const n = readSync(fd, buf, off, len - off, pos + off);
    if (!n) throw new Error("E_INPUT tar ends early at byte " + (pos + off));
    off += n;
  }
  return buf;
}

function octal(field: Uint8Array, what: string): number {
  if (field[0]! & 0x80) throw new Error("E_INPUT tar " + what + " uses base-256, which this reader does not support");
  const s = cstr(field).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error("E_INPUT tar " + what + " is not octal: " + JSON.stringify(s));
  return s ? parseInt(s, 8) : 0;
}

export function headerChecksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return sum;
}

// Every entry of a ustar or GNU tar, with GNU long names (L, K) applied. pax headers are refused:
// none of the arm tars has one, and a pax size or path would override the fields rewritten here.
// The end is the first zero block; what follows it must be the zero padding GNU tar writes (two
// blocks, then up to a 10240-byte record), so a rewrite that pads the same way keeps that rule.
export function tarEntries(fd: number): Listing {
  const size = fstatSync(fd).size;
  const entries: TarEntry[] = [];
  let pos = 0;
  let longName: string | null = null;
  while (pos + BLOCK <= size) {
    const h = readAt(fd, pos, BLOCK);
    if (h.every((b) => b === 0)) {
      const trailer = readAt(fd, pos, size - pos);
      if (size !== Math.ceil((pos + 2 * BLOCK) / RECORD) * RECORD || !trailer.every((b) => b === 0)) {
        throw new Error("E_INPUT tar trailer after byte " + pos + " is not two zero blocks padded to a " + RECORD + "-byte record");
      }
      return { entries, end: pos, size };
    }
    if (octal(h.subarray(148, 156), "checksum") !== headerChecksum(h)) throw new Error("E_INPUT tar header at " + pos + " has a bad checksum");
    const type = String.fromCharCode(h[156]!);
    const len = octal(h.subarray(124, 136), "size");
    const data = pos + BLOCK;
    if (type === "x" || type === "g") throw new Error("E_INPUT tar has a pax header at " + pos + "; not supported");
    if (type === "L") longName = cstr(readAt(fd, data, len));
    else if (type !== "K") {
      entries.push({ name: longName ?? cstr(h.subarray(0, 100)), type, header: pos, data, size: len });
      longName = null;
    }
    pos = data + pad(len);
  }
  throw new Error("E_INPUT tar has no end-of-archive block");
}

const isFile = (e: TarEntry) => e.type === "0" || e.type === "\0";

export function onlyFile(entries: TarEntry[], path: string): TarEntry {
  const hits = entries.filter((e) => e.name === path || e.name === "./" + path);
  if (hits.length !== 1 || !isFile(hits[0]!)) throw new Error("E_INPUT tar must hold exactly one regular file " + path + "; found " + hits.length + " entries");
  return hits[0]!;
}

export const entryBytes = (fd: number, e: TarEntry) => readAt(fd, e.data, e.size);

function* chunks(fd: number, from: number, to: number) {
  for (let pos = from; pos < to; pos += CHUNK) yield readAt(fd, pos, Math.min(CHUNK, to - pos));
}

export function fileSha256(path: string): string {
  const fd = openSync(path, "r");
  try {
    const hash = createHash("sha256");
    for (const c of chunks(fd, 0, fstatSync(fd).size)) hash.update(c);
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

// Writes the base tar with one regular file's content replaced: the bytes before its header, its
// header with a new size and checksum, the new content padded to a block, the bytes after its old
// data up to the end, then the GNU end padding. Returns the output's size and sha256.
export function writeReplaced(fd: number, listing: Listing, path: string, content: Uint8Array, outPath: string): { bytes: number; sha256: string } {
  const e = onlyFile(listing.entries, path);
  if (content.length > 0o77777777777) throw new Error("E_INPUT content too large for an octal size field");
  const header = readAt(fd, e.header, BLOCK);
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
  header.write(headerChecksum(header).toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
  const tailFrom = e.data + pad(e.size);
  const body = e.header + BLOCK + pad(content.length) + (listing.end - tailFrom);
  const total = Math.ceil((body + 2 * BLOCK) / RECORD) * RECORD;
  const hash = createHash("sha256");
  const out = openSync(outPath, "w");
  let bytes = 0;
  const put = (p: Uint8Array) => {
    hash.update(p);
    for (let off = 0; off < p.length; ) off += writeSync(out, p, off, p.length - off);
    bytes += p.length;
  };
  try {
    for (const c of chunks(fd, 0, e.header)) put(c);
    put(header);
    put(content);
    put(new Uint8Array(pad(content.length) - content.length));
    for (const c of chunks(fd, tailFrom, listing.end)) put(c);
    put(new Uint8Array(total - body));
  } finally {
    closeSync(out);
  }
  return { bytes, sha256: hash.digest("hex") };
}

// The regular-file entries whose content holds text, read in chunks that overlap by the text's length.
export function carriers(fd: number, listing: Listing, text: string): string[] {
  const needle = Buffer.from(text);
  return listing.entries.filter(isFile).filter((e) => {
    for (let pos = e.data; pos < e.data + e.size; pos += CHUNK) {
      const len = Math.min(CHUNK + needle.length - 1, e.data + e.size - pos);
      if (readAt(fd, pos, len).includes(needle)) return true;
    }
    return false;
  }).map((e) => e.name);
}

export function rewriteDescription(text: string): string {
  const { frontmatter, body } = splitSkill(text);
  const lines = frontmatter.split("\n");
  const at = lines.flatMap((l, i) => (l === SHIPPED_LINE ? [i] : []));
  if (at.length !== 1) throw new Error("E_INPUT " + SKILL_PATH + " frontmatter has " + at.length + " copies of the shipped description line");
  lines[at[0]!] = "description: " + JSON.stringify(REWRITTEN_DESCRIPTION);
  const out = lines.join("\n");
  if (frontmatterFields(out).description !== REWRITTEN_DESCRIPTION) throw new Error("E_INTERNAL rewritten description does not parse back to the frozen text");
  return out + body;
}

export function shortPlacebo(text: string): { output: string; tokens: number } {
  const { frontmatter } = splitSkill(text);
  const { name, description } = frontmatterFields(frontmatter);
  const body = prose(topicTerms(name, description), SHORT_TARGET, prng(SHORT_SEED, "investigate"));
  const tokens = countTokens(body);
  const markers = proceduralMarkers(body);
  if (markers.length) throw new Error("E_INTERNAL placebo-short body has procedural markers: " + markers.join(", "));
  if (Math.abs(tokens - SHORT_TARGET) > 1) throw new Error("E_INTERNAL placebo-short body has " + tokens + " tokens, not " + SHORT_TARGET + " +- 1");
  return { output: frontmatter + body, tokens };
}

function parseList(tsv: string): Entry[] {
  return tsv.trimEnd().split("\n").slice(1).map((line) => {
    const [sha, size, mode, type, ...path] = line.split("\t");
    return { path: path.join("\t"), type: type as Entry["type"], mode: parseInt(mode!, 8), size: Number(size), sha256: sha! };
  });
}

// A variant's manifest is its base manifest with the one changed file's row replaced and the
// digests recomputed the way tree.ts computes them.
export function variantManifest(arm: string, base: any, baseList: string, changed: { sha256: string; size: number }, tar: { file: string; bytes: number; sha256: string }, meta: Record<string, unknown>) {
  const entries = parseList(baseList);
  if (treeDigest(entries) !== base.tree.digest) throw new Error("E_INTERNAL " + base.arm + ".files.tsv does not reproduce " + base.arm + ".json's tree digest");
  const row = entries.find((e) => e.path === SKILL_PATH);
  if (!row || row.type !== "file") throw new Error("E_INPUT " + base.arm + ".files.tsv has no file row " + SKILL_PATH);
  row.sha256 = changed.sha256;
  row.size = changed.size;
  const prefix = ".claude/skills/";
  const skillEntries = entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
  const files = entries.filter((e) => e.type === "file");
  const summary = {
    arm, claude_code: base.claude_code, gstack_sha: base.gstack_sha, ...meta, tar,
    tree: { files: files.length, symlinks: base.tree.symlinks, dirs: base.tree.dirs, bytes: files.reduce((n, e) => n + e.size, 0), digest: treeDigest(entries) },
    skills: {
      count: base.skills.count, tree_digest: treeDigest(skillEntries),
      skill_md_digest: treeDigest(skillEntries.filter((e) => /^[^/]+\/SKILL\.md$/.test(e.path))), names: base.skills.names,
    },
  };
  const list = ["sha256\tbytes\tmode\ttype\tpath", ...entries.map((e) => [e.sha256, e.size, e.mode.toString(8), e.type, e.path].join("\t"))];
  return { summary, list: list.join("\n") + "\n" };
}

export function buildVariants(inDir: string, outDir: string, manifestsDir: string) {
  const source = sha256(readFileSync(import.meta.path));
  mkdirSync(outDir, { recursive: true });
  const variant = (baseArm: string, arm: string, change: (skillMd: string) => { output: string; meta: Record<string, unknown> }) => {
    const json = JSON.parse(readFileSync(join(manifestsDir, baseArm + ".json"), "utf8"));
    const list = readFileSync(join(manifestsDir, baseArm + ".files.tsv"), "utf8");
    const inPath = join(inDir, baseArm + ".tar");
    if (fileSha256(inPath) !== json.tar.sha256) throw new Error("E_INPUT " + baseArm + ".tar is not the registered " + json.tar.sha256);
    const fd = openSync(inPath, "r");
    try {
      const listing = tarEntries(fd);
      const changed = change(entryBytes(fd, onlyFile(listing.entries, SKILL_PATH)).toString("utf8"));
      const content = Buffer.from(changed.output);
      const tar = { file: arm + ".tar", ...writeReplaced(fd, listing, SKILL_PATH, content, join(outDir, arm + ".tar")) };
      return variantManifest(arm, json, list, { sha256: sha256(content), size: content.length }, tar, {
        base_arm: baseArm, base_tar_sha256: json.tar.sha256, changed_entry: SKILL_PATH, ...changed.meta, variants_ts_sha256: source,
      });
    } finally {
      closeSync(fd);
    }
  };
  const rewrittenManifest = variant("gstack", "gstack-rewritten", (text) => ({ output: rewriteDescription(text), meta: { description_sha256: sha256(REWRITTEN_DESCRIPTION) } }));
  let shortTokens = 0;
  const shortManifest = variant("placebo", "placebo-short", (text) => {
    const short = shortPlacebo(text);
    shortTokens = short.tokens;
    return { output: short.output, meta: { placebo_seed: SHORT_SEED, placebo_generator_hash: generatorHash(SHORT_SEED), target_tokens: SHORT_TARGET, placebo_tokens: short.tokens } };
  });
  const row = readFileSync(join(manifestsDir, "placebo-tokens.tsv"), "utf8").split("\n").find((l) => l.startsWith("investigate\t"));
  if (!row) throw new Error("E_INPUT placebo-tokens.tsv has no investigate row");
  const original = Number(row.split("\t")[1]);
  const tokens = "skill\toriginal_tokens\tplacebo_tokens\tratio\trouting_kept_bytes\trouting_kept_sha256\n" +
    ["investigate", original, shortTokens, (shortTokens / original).toFixed(4), 0, "-"].join("\t") + "\n";
  return { manifests: [rewrittenManifest, shortManifest], tokens, shortTokens };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const carrierTar = flag("--carriers");
  if (carrierTar) {
    const text = args[args.indexOf("--carriers") + 2];
    if (!text) {
      console.error("E_USAGE usage: variants.ts --carriers <tar> <text>");
      process.exit(2);
    }
    const fd = openSync(carrierTar, "r");
    try {
      for (const name of carriers(fd, tarEntries(fd), text)) console.log(name);
    } finally {
      closeSync(fd);
    }
    process.exit(0);
  }
  const inDir = flag("--in");
  const outDir = flag("--out");
  const write = flag("--manifests");
  if (!inDir || !outDir) {
    console.error("E_USAGE usage: variants.ts --in <dir with gstack.tar and placebo.tar> --out <dir> [--manifests <dir>]");
    process.exit(2);
  }
  const registered = join(import.meta.dir, "manifests");
  const built = buildVariants(inDir, outDir, registered);
  let bad = 0;
  for (const m of built.manifests) {
    const arm = m.summary.arm;
    console.log(arm + " tar_sha256=" + m.summary.tar.sha256 + " bytes=" + m.summary.tar.bytes + " tree_digest=" + m.summary.tree.digest);
    if (write) {
      writeFileSync(join(write, arm + ".json"), JSON.stringify(m.summary, null, 2) + "\n");
      writeFileSync(join(write, arm + ".files.tsv"), m.list);
      continue;
    }
    const path = join(registered, arm + ".json");
    const same = existsSync(path) && readFileSync(path, "utf8") === JSON.stringify(m.summary, null, 2) + "\n" &&
      readFileSync(join(registered, arm + ".files.tsv"), "utf8") === m.list;
    console.log(arm + " manifest " + (same ? "matches" : "DIFFERS from") + " arms/manifests/" + arm + ".json and .files.tsv");
    if (!same) bad++;
  }
  if (write) writeFileSync(join(write, "placebo-short-tokens.tsv"), built.tokens);
  else {
    const path = join(registered, "placebo-short-tokens.tsv");
    const same = existsSync(path) && readFileSync(path, "utf8") === built.tokens;
    console.log("placebo-short-tokens.tsv " + (same ? "matches" : "DIFFERS"));
    if (!same) bad++;
  }
  console.log("placebo-short investigate body tokens=" + built.shortTokens + " target=" + SHORT_TARGET);
  if (bad) process.exit(1);
}
