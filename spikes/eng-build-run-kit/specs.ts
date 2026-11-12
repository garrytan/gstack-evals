// eng-build run kit: build unit specs, base trees, plans and review units from the sealed checkpoint.
// Prints counts only. Every output goes under --out, which must be on tmpfs.
// usage: bun specs.ts --units <ckpt units dir> --clones <dir> --out <dir> --gstack <gstack clone> [--sets comparison,reserve,calibration]
//        bun specs.ts --pin --out <dir>     (pulls every recipe tag in <out>/tags.txt and writes the digests into specs.json)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { testChanges, listing, type UnitSpec } from "../gstack-evals/lanes/eng-build/unit.ts";
import { ecoOfFile, hasRecipe, runnable, findProject, recipeFor } from "../gstack-evals/lanes/eng-build/recipes.ts";
import { showFile } from "../gstack-evals/lanes/real-outcome/mine/git.ts";
import { buildUnitRepo } from "../gstack-evals/lanes/eng-review/author/run.ts";
import { renderEngPhase } from "../gstack-evals/lanes/eng-review/render.ts";

const { values: v } = parseArgs({ options: { units: { type: "string" }, clones: { type: "string" }, out: { type: "string" }, gstack: { type: "string" }, sets: { type: "string" }, pin: { type: "boolean" } } });
const out = v.out!;
const count: Record<string, number> = {};
const bump = (k: string) => (count[k] = (count[k] ?? 0) + 1);
const sh = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } });

if (v.pin) {
  const tags = readFileSync(join(out, "tags.txt"), "utf8").split("\n").filter(Boolean);
  const images: Record<string, string> = {};
  for (const t of tags) {
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      ok = spawnSync("docker", ["pull", "-q", t], { encoding: "utf8" }).status === 0;
      if (!ok) spawnSync("sleep", [String(30 * (i + 1))]);
    }
    if (!ok) { bump("pull_failed"); console.log("pull failed: " + t); continue; }
    const d = spawnSync("docker", ["image", "inspect", "-f", "{{index .RepoDigests 0}}", t], { encoding: "utf8" }).stdout.trim();
    if (!d.includes("@sha256:")) { bump("no_digest"); continue; }
    images[t] = d;
    bump("pinned");
  }
  const specs = JSON.parse(readFileSync(join(out, "specs.json"), "utf8")) as { spec: UnitSpec; repo: string }[];
  for (const s of specs) s.spec.images = images;
  writeFileSync(join(out, "specs.json"), JSON.stringify(specs, null, 1) + "\n", { mode: 0o600 });
  writeFileSync(join(out, "images.json"), JSON.stringify(images, null, 1) + "\n");
  console.log(JSON.stringify(count));
  process.exit(0);
}

const sets = new Set((v.sets ?? "comparison,reserve,calibration").split(","));
const most = (r: { opus: string | null; sol: string | null }): "yes" | "maybe" | "no" | null => {
  const xs = [r?.opus, r?.sol].filter((x): x is string => !!x);
  if (!xs.length) return null;
  return xs.includes("yes") ? "yes" : xs.includes("maybe") ? "maybe" : "no";
};
const specsOut: { spec: UnitSpec; repo: string }[] = [];
const reviewUnits: unknown[] = [];
const tags = new Set<string>();
for (const d of ["trees", "plans", "openings"]) mkdirSync(join(out, d), { recursive: true, mode: 0o700 });
const wt = join(out, "gstack-engphase");
if (!existsSync(wt)) {
  const r = sh(v.gstack!, ["worktree", "add", "--quiet", "--detach", wt, "199931029e9fe9808554a4863c960d4b9b663a60"]);
  if (r.status !== 0) { console.log("gstack worktree failed"); process.exit(2); }
}
for (const id of readdirSync(v.units!).sort()) {
  const dir = join(v.units!, id);
  if (!existsSync(join(dir, "unit.json")) || !existsSync(join(dir, "key.json"))) continue;
  const u = JSON.parse(readFileSync(join(dir, "unit.json"), "utf8"));
  const k = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
  if (!sets.has(u.set)) { bump("set_" + u.set + "_skipped"); continue; }
  bump("read_" + u.set);
  try {
    const clone = join(v.clones!, u.repo.replace("/", "__"));
    if (!existsSync(clone)) { bump("no_clone"); continue; }
    const has = (sha: string) => sh(clone, ["cat-file", "-e", sha + "^{commit}"]).status === 0;
    const primary = new Set<string>(k.primary);
    const items: UnitSpec["items"] = [];
    let missing = 0;
    for (const it of k.items) {
      if (!primary.has(it.id) || (it.kind !== "B" && it.kind !== "T")) continue;
      const commit = (it.evidence as string[]).find((e) => /^[0-9a-f]{40}$/.test(e));
      if (!commit) { bump("item_no_commit"); continue; }
      if (!has(commit)) sh(clone, ["fetch", "-q", "origin", commit]);
      if (!has(commit)) { missing++; bump("item_commit_missing"); continue; }
      items.push({ item: it.id, kind: it.kind, commit, mentioned: !!it.mentioned, generic: !!it.generic, foreseeable: most(it.foreseeable) });
    }
    for (const sha of [u.base_sha, u.merge_sha]) if (!has(sha)) sh(clone, ["fetch", "-q", "origin", sha]);
    if (!has(u.base_sha) || !has(u.merge_sha)) { bump("base_or_merge_missing"); continue; }
    const withTests = items.filter((i) => {
      const tc = testChanges(clone, i.commit + "^1", i.commit);
      return tc.whole.length + tc.regions.length > 0;
    });
    if (withTests.length === 0) { bump("no_test_changing_item_" + u.set); continue; }
    bump("candidate_" + u.set);
    const files: { rev: string; paths: string[] }[] = [];
    const own = testChanges(clone, u.base_sha, u.merge_sha);
    files.push({ rev: u.merge_sha, paths: [...own.whole, ...own.regions] });
    for (const i of items) {
      const tc = testChanges(clone, i.commit + "^1", i.commit);
      files.push({ rev: i.commit, paths: [...tc.whole, ...tc.regions] });
    }
    const baseNames = new Set(listing(clone, u.base_sha).keys());
    const readBase = (p: string) => showFile(clone, u.base_sha, p);
    const seen = new Set<string>();
    for (const f of files) {
      const names = new Set(listing(clone, f.rev).keys());
      for (const p of f.paths) {
        const eco = ecoOfFile(p);
        if (eco === null || !hasRecipe(eco) || !runnable(eco, p)) continue;
        const pr = findProject(eco, p, names);
        if (!pr) continue;
        const key = eco + "|" + pr.root;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          for (const t of recipeFor(eco, readBase, pr.root, baseNames).images) tags.add(t);
        } catch { bump("recipe_error"); }
      }
    }
    const spec: UnitSpec = { id: u.id, repo: u.repo, set: u.set, type: u.type, keying: "first", mergedMonth: String(u.merged_at).slice(0, 7), strictWindow: String(u.exposed_at) >= "2026-08-01", licence: u.licence, ...(u.copyleft ? { custody: true } : {}), trust: "upstream", base: u.base_sha, merge: u.merge_sha, items, images: {} };
    specsOut.push({ spec, repo: clone });
    buildUnitRepo(clone, u.base_sha, join(out, "trees", u.id));
    cpSync(join(dir, "plan.md"), join(out, "plans", u.id + ".md"));
    const o = renderEngPhase({ gstack: wt, plan: readFileSync(join(dir, "plan.md"), "utf8"), out: join(out, "openings", u.id) });
    reviewUnits.push({ id: u.id, set: u.set, rank: u.rank, repo: join(out, "trees", u.id), plan: join(out, "plans", u.id + ".md"), opening: { text: o.text, methodology: o.methodology, readRanges: o.readRanges, mounts: o.files.map((f) => ({ host: f.host, path: f.mount })) } });
  } catch (e) {
    bump("error_" + String((e as Error).message).split(/[ :]/)[0]!.slice(0, 24));
  }
}
writeFileSync(join(out, "specs.json"), JSON.stringify(specsOut, null, 1) + "\n", { mode: 0o600 });
writeFileSync(join(out, "review-units.json"), JSON.stringify(reviewUnits, null, 1) + "\n", { mode: 0o600 });
writeFileSync(join(out, "tags.txt"), [...tags].sort().join("\n") + "\n");
console.log(JSON.stringify({ ...count, specs: specsOut.length, tags: tags.size }));
