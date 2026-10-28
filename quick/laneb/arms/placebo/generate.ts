// Placebo arm generator CLI.
//
//   bun arms/placebo/generate.ts --in <gstack .claude/skills> --out <placebo .claude/skills>
//       [--seed <seed>] [--report <tokens.tsv>]
//
// Writes one SKILL.md per gstack skill folder and nothing else, then prints the
// generator hash, the seed, the digest of the input SKILL.md files, the digest
// of the output tree and the token-ratio range.

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { treeDigest, walk } from "../tree.ts";
import { DEFAULT_SEED, placeboSkill, sha256, type SkillResult } from "./placebo.ts";

// The files whose bytes decide the output. The generator hash covers them, the
// tokenizer package version and the seed.
export const GENERATOR_SOURCES = ["generate.ts", "placebo.ts"];

export function tokenizerVersion(): string {
  let dir = dirname(Bun.resolveSync("js-tiktoken/lite", import.meta.dir));
  while (!existsSync(join(dir, "package.json")) || JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== "js-tiktoken") {
    if (dirname(dir) === dir) throw new Error("js-tiktoken package.json not found");
    dir = dirname(dir);
  }
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
}

export function generatorHash(seed: string): string {
  const lines = GENERATOR_SOURCES.map((f) => sha256(readFileSync(join(import.meta.dir, f))) + "  placebo/" + f + "\n");
  return sha256(lines.join("") + "js-tiktoken " + tokenizerVersion() + "\n" + "seed " + seed + "\n");
}

export function skillFolders(skillsDir: string): string[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function generatePlacebo(inDir: string, outDir: string, seed: string): SkillResult[] {
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error(outDir + " is not empty");
  const results: SkillResult[] = [];
  for (const folder of skillFolders(inDir)) {
    const src = join(inDir, folder, "SKILL.md");
    if (!existsSync(src)) throw new Error(folder + " has no SKILL.md");
    const result = placeboSkill(folder, readFileSync(src, "utf8"), seed);
    const dst = join(outDir, folder);
    mkdirSync(dst, { recursive: true });
    chmodSync(dst, statSync(join(inDir, folder)).mode & 0o777);
    writeFileSync(join(dst, "SKILL.md"), result.output);
    chmodSync(join(dst, "SKILL.md"), statSync(src).mode & 0o777);
    results.push(result);
  }
  return results;
}

// The generator's input: each skill folder's SKILL.md, nothing else.
export const skillMdEntries = (skillsDir: string) => walk(skillsDir).filter((e) => /^[^/]+\/SKILL\.md$/.test(e.path));

export const ratio = (r: SkillResult) => r.placeboTokens / r.originalTokens;

export function tokenReport(results: SkillResult[]): string {
  const rows = results.map((r) =>
    [r.folder, r.originalTokens, r.placeboTokens, ratio(r).toFixed(4), r.routingKept ? Buffer.byteLength(r.routingKept) : 0,
      r.routingKept ? sha256(r.routingKept) : "-"].join("\t"),
  );
  return ["skill\toriginal_tokens\tplacebo_tokens\tratio\trouting_kept_bytes\trouting_kept_sha256", ...rows].join("\n") + "\n";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const inDir = flag("--in");
  const outDir = flag("--out");
  const seed = flag("--seed") ?? DEFAULT_SEED;
  if (!inDir || !outDir) {
    console.error("usage: generate.ts --in <gstack skills dir> --out <placebo skills dir> [--seed <seed>] [--report <tsv>]");
    process.exit(2);
  }
  const results = generatePlacebo(inDir, outDir, seed);
  const report = flag("--report");
  if (report) writeFileSync(report, tokenReport(results));
  const ratios = results.map(ratio);
  console.log("generator_hash " + generatorHash(seed));
  console.log("seed " + seed);
  console.log("skills " + results.length);
  console.log("input_skill_md_digest " + treeDigest(skillMdEntries(inDir)));
  console.log("output_tree_digest " + treeDigest(walk(outDir)));
  console.log("ratio_min " + Math.min(...ratios).toFixed(4) + " ratio_max " + Math.max(...ratios).toFixed(4));
  for (const r of results) if (r.routingKept) console.log("routing_kept " + r.folder + " bytes=" + Buffer.byteLength(r.routingKept) + " sha256=" + sha256(r.routingKept));
  if (ratios.some((x) => x < 0.95 || x > 1.05)) {
    console.error("a skill is outside the +-5% token bound");
    process.exit(1);
  }
}
