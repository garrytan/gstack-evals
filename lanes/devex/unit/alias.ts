// Copyright (c) 2026 Garry Tan. MIT License.
// The unit's alias map (devex prereg section 4, B1): the project, owner, package, module and binary names, read from
// the manifest files at base and the README's title plus the repository's own owner and name, each get an invented
// name from a seeded list. aliasText replaces them whole-word and case-preserving in plan.md, in every snapshot text
// file and in every key statement; unaliasText maps a block back for stage 3. A name that is a common English word
// (common-words.txt) or shorter than 4 characters is left as it is, and that is recorded in the map.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AliasEntry, AliasMap } from "../types.ts";

export const COMMON_WORDS: ReadonlySet<string> = new Set(readFileSync(join(import.meta.dir, "common-words.txt"), "utf8").split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean));
export const MIN_NAME = 4;

type Kind = AliasEntry["kind"];
export interface Manifest {
  path: string;
  text: string;
}

const tomlSection = (text: string, header: string): string[] => {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const h = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
    if (h) {
      cur = h[1]!.trim();
      if (cur === header) out.push("");
      continue;
    }
    if (cur === header && out.length) out[out.length - 1] += line + "\n";
  }
  return out;
};
const tomlName = (block: string) => /^\s*name\s*=\s*["']([^"']+)["']/m.exec(block)?.[1];
const tomlKeys = (block: string) => [...block.matchAll(/^\s*["']?([A-Za-z0-9_.-]+)["']?\s*=/gm)].map((m) => m[1]!);

/** Package, module and binary names from the manifest files the repository holds at base. */
export function manifestNames(manifests: readonly Manifest[]): Array<{ name: string; kind: Kind }> {
  const out: Array<{ name: string; kind: Kind }> = [];
  const add = (name: string | undefined, kind: Kind) => {
    if (!name) return;
    const scoped = /^@([^/]+)\/(.+)$/.exec(name);
    if (scoped) {
      out.push({ name: scoped[1]!, kind: "owner" }, { name: scoped[2]!, kind });
    } else out.push({ name, kind });
  };
  for (const m of manifests) {
    const base = m.path.slice(m.path.lastIndexOf("/") + 1);
    try {
      if (base === "package.json" || base === "composer.json") {
        const j = JSON.parse(m.text);
        if (base === "composer.json" && typeof j.name === "string" && j.name.includes("/")) {
          const [v, p] = j.name.split("/");
          add(v, "owner");
          add(p, "package");
        } else add(typeof j.name === "string" ? j.name : undefined, "package");
        if (j.bin && typeof j.bin === "object") for (const k of Object.keys(j.bin)) add(k, "binary");
      } else if (base === "Cargo.toml") {
        for (const b of tomlSection(m.text, "package")) add(tomlName(b), "package");
        for (const b of tomlSection(m.text, "lib")) add(tomlName(b), "module");
        for (const b of tomlSection(m.text, "bin")) add(tomlName(b), "binary");
      } else if (base === "pyproject.toml") {
        for (const b of [...tomlSection(m.text, "project"), ...tomlSection(m.text, "tool.poetry")]) add(tomlName(b), "package");
        for (const b of [...tomlSection(m.text, "project.scripts"), ...tomlSection(m.text, "tool.poetry.scripts")]) for (const k of tomlKeys(b)) add(k, "binary");
      } else if (base === "setup.cfg") {
        for (const b of tomlSection(m.text, "metadata")) add(/^\s*name\s*=\s*(\S+)/m.exec(b)?.[1], "package");
      } else if (base === "go.mod") {
        const mod = /^module\s+(\S+)/m.exec(m.text)?.[1];
        const segs = (mod ?? "").split("/").filter((s) => !/^v\d+$/.test(s));
        add(segs[segs.length - 1], "module");
      } else if (base.endsWith(".gemspec")) add(/\.name\s*=\s*["']([^"']+)["']/.exec(m.text)?.[1], "package");
    } catch {
      continue;
    }
  }
  return out;
}

/** The README's title: its first heading, before any separator, when it reads as a name (at most 4 words). */
export function readmeTitle(readme: string | null): string | null {
  if (!readme) return null;
  for (const line of readme.split("\n")) {
    const h = /^\s*#\s+(.+?)\s*#*\s*$/.exec(line) ?? /^\s*<h1[^>]*>(.+?)<\/h1>/i.exec(line);
    if (!h) continue;
    const t = h[1]!.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").split(/\s+[-|:\u2013\u2014]\s+|:\s/)[0]!.replace(/[*_\x60]/g, "").trim();
    return t && t.split(/\s+/).length <= 4 ? t : null;
  }
  return null;
}

const SEP = /[-_.\s]/;
const parts = (s: string) => s.split(SEP).filter(Boolean);
/** Seeded invented words: consonant-vowel syllables from sha256(seed, counter). */
function invent(seed: string, taken: Set<string>): () => string {
  let n = 0;
  const C = "bdfgklmnprstvz", V = "aeiou";
  return () => {
    for (;;) {
      const h = createHash("sha256").update(seed + "\n" + n++).digest();
      const syl = 3 + (h[0]! % 2);
      let w = "";
      for (let i = 0; i < syl; i++) w += C[h[1 + i * 2]! % C.length]! + V[h[2 + i * 2]! % V.length]!;
      if (!taken.has(w) && !COMMON_WORDS.has(w)) {
        taken.add(w);
        return w;
      }
    }
  };
}

/** A word cased like another: upper, lower, title, or part by part. */
export function caseLike(model: string, word: string): string {
  const letters = model.replace(/[^\p{L}]/gu, "");
  if (!letters) return word;
  if (letters === letters.toUpperCase()) return word.toUpperCase();
  if (letters === letters.toLowerCase()) return word.toLowerCase();
  const mp = model.split(/([-_.\s])/), wp = word.split(/([-_.\s])/);
  if (mp.length === wp.length) return wp.map((w, i) => (i % 2 ? w : caseLike1(mp[i]!, w))).join("");
  return caseLike1(model, word);
}
const caseLike1 = (model: string, word: string) => {
  if (model === model.toUpperCase()) return word.toUpperCase();
  if (model === model.toLowerCase()) return word.toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

export interface AliasInput {
  owner: string;
  project: string;
  readme: string | null;
  manifests: readonly Manifest[];
  /** The unit's seed: its draw digest. */
  seed: string;
}

/** The unit's alias map, with each name's separator variants (my-tool, my_tool, mytool) mapped consistently. */
export function buildAliasMap(input: AliasInput): AliasMap {
  const names: Array<{ name: string; kind: Kind }> = [{ name: input.project, kind: "project" }, { name: input.owner, kind: "owner" }];
  const title = readmeTitle(input.readme);
  if (title) names.push({ name: title, kind: "project" });
  names.push(...manifestNames(input.manifests));
  const entries: AliasEntry[] = [];
  const kept: AliasMap["kept"] = [];
  const seen = new Set<string>();
  const taken = new Set<string>();
  const next = invent(input.seed, taken);
  const partAlias = new Map<string, string>();
  const aliasPart = (p: string) => {
    const k = p.toLowerCase();
    if (!partAlias.has(k)) partAlias.set(k, next());
    return partAlias.get(k)!;
  };
  for (const { name, kind } of names) {
    const n = name.trim();
    const k = n.toLowerCase();
    if (!n || seen.has(k)) continue;
    seen.add(k);
    if (n.length < MIN_NAME) {
      kept.push({ name: n, why: "short" });
      continue;
    }
    if (COMMON_WORDS.has(k)) {
      kept.push({ name: n, why: "common-word" });
      continue;
    }
    const ps = parts(n);
    const sep = /[-_.\s]/.exec(n)?.[0] ?? "";
    const base = ps.map(aliasPart);
    entries.push({ original: n, alias: caseLike(n, base.join(sep)), kind });
    if (ps.length > 1) {
      for (const s of ["-", "_", ""]) {
        const v = ps.join(s);
        if (seen.has(v.toLowerCase()) || v.length < MIN_NAME || COMMON_WORDS.has(v.toLowerCase())) continue;
        seen.add(v.toLowerCase());
        entries.push({ original: v, alias: caseLike(v, base.join(s)), kind });
      }
    }
  }
  return { entries, kept };
}

const esc = (s: string) => s.replace(/[.*+?^$|()[\]\\{}\/]/g, (c) => "\\" + c);
function replacer(pairs: ReadonlyArray<[string, string]>): (text: string) => string {
  if (pairs.length === 0) return (t) => t;
  const by = new Map(pairs.map(([from, to]) => [from.toLowerCase(), { from, to }]));
  const keys = [...by.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp("(?<![\\p{L}\\p{N}_])(?:" + keys.map(esc).join("|") + ")(?![\\p{L}\\p{N}_])", "giu");
  return (text) => text.replace(re, (m) => {
    const e = by.get(m.toLowerCase())!;
    return m === e.from ? e.to : caseLike(m, e.to);
  });
}

/** Forward: originals to aliases, whole-word and case-preserving. */
export function aliasText(text: string, map: AliasMap): string {
  return replacer(map.entries.map((e) => [e.original, e.alias]))(text);
}

/** Back: aliases to originals, for a block stage 3 builds from. */
export function unaliasText(text: string, map: AliasMap): string {
  return replacer(map.entries.map((e) => [e.alias, e.original]))(text);
}

export async function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): Promise<number> {
  const [dir, file, mapFile] = [argv[0], argv[1], argv[2]];
  if ((dir !== "forward" && dir !== "back") || !file || !mapFile) throw Object.assign(new Error("dx alias forward|back <text file> <alias.json>"), { code: "E_USAGE" });
  const map = JSON.parse(readFileSync(mapFile, "utf8")) as AliasMap;
  const text = readFileSync(file, "utf8");
  io.out(dir === "forward" ? aliasText(text, map) : unaliasText(text, map));
  return 0;
}
