// Copyright (c) 2026 Garry Tan. MIT License.
// dc apps and dc planted: the author and gatecheck rows' inputs, built keyless from checkouts and sealed records.
//
// A base app's view is read from its checkout at its pin, as the planted units' pin record states the rule: the tree is
// the pin's tracked regular files (git ls-tree, outside .git and node_modules), designFiles are every tracked file the
// file check's designKind accepts (frame/filecheck.ts), and routeFiles are the screen files the discovered router
// names: a file router's page files, and for a code router (vue-router, react-router, Angular) the component files its
// router files import. The checkout must sit at the pin with a clean working tree.
//
// gstack-evals dc apps --clones <clones row folder> --base-apps <recipes sink base-apps.json> --out <new apps.json>
// writes one AppEntry per base app in base-apps.json's order, each pointing at clones/<id> from the clones row.
//
// gstack-evals dc planted --in <opened planted tar folder> --out <new folder> writes the gatecheck row's two inputs:
// planted.json (PlantedEntry[], app 0) from units/<name>/, cross-checked against pin.json's units and each unit.json and
// against the committed digests in author/planted.json, and a one-entry apps.json for the planted app, re-fetched by
// pin.json's commit through the frame's hardened fetch, its tree checked against pin.json's tree and its view compared
// with pin.json's base_app_view. Any difference refuses. Lines carry counts and sha256 digests only, never a repository
// name, a URL, a file path from a checkout or any unit text.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { checkPlantedDigests, loadPlantedTable, type PlantedName, type PlantedTable, type PlantedUnit } from "../author/gatecheck.ts";
import type { EvidenceFile, UnitFiles } from "../author/unit.ts";
import { fail } from "../errors.ts";
import { designKind } from "../frame/filecheck.ts";
import { git, headOf } from "../frame/git.ts";
import { codeRouterOf, codeRoutes, isTestOrStory, patternSegs } from "../frame/routes.ts";
import { realSeams, type FrameSeams } from "../frame/run.ts";
import { parentOf, readPackages, readText, SKIPPED_DIRS, under } from "../frame/tree.ts";
import type { AuthorFamily, ChangeKind, ItemClass, Key } from "../types.ts";
import type { AppEntry, PlantedEntry } from "./author.ts";
import { readJson } from "./json.ts";
import { need, type Row } from "./start.ts";

/** What a base app's view holds besides its checkout: the tracked file count, the design files and the screen files. */
export interface AppView {
  files: number;
  designFiles: string[];
  routeFiles: string[];
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const OID = /^[0-9a-f]{40}$/;
const COMPONENT = /\.(vue|tsx|jsx|svelte)$/;
const CODE_FILE = /\.(m|c)?(js|ts)x?$/;
const RESOLVE_EXTS = [".vue", ".tsx", ".jsx", ".svelte", ".ts", ".js"];
const REPO_ROOT = resolve(import.meta.dir, "../../..");

/** The pin's tracked regular files outside .git and node_modules, sorted; symlinks and submodules are left out. */
function trackedAt(dir: string, pin: string): string[] {
  return git(dir, ["ls-tree", "-r", "-z", "--full-tree", pin])
    .split("\0")
    .filter(Boolean)
    .map((l) => ({ mode: l.slice(0, l.indexOf(" ")), path: l.slice(l.indexOf("\t") + 1) }))
    .filter((e) => (e.mode === "100644" || e.mode === "100755") && !e.path.split("/").some((s) => SKIPPED_DIRS.includes(s)))
    .map((e) => e.path)
    .sort();
}

const nearestPackage = (pkgs: readonly string[], f: string) => pkgs.filter((p) => under(f, p) && f !== p).reduce((a, p) => (p.length > a.length ? p : a), "");

/** A file router's page files, as frame/routes.ts reads them: Next.js pages/ and app/, SvelteKit +page.svelte, Nuxt pages/. */
function pageFiles(files: readonly string[], pkgs: ReturnType<typeof readPackages>): string[] {
  const out: string[] = [];
  const jp = (a: string, b: string) => (a ? a + "/" + b : b);
  for (const p of pkgs) {
    if ("next" in p.deps) {
      for (const dir of [jp(p.dir, "pages"), jp(p.dir, "src/pages")])
        for (const f of files) {
          if (!f.startsWith(dir + "/") || !/\.(jsx?|tsx?)$/.test(f) || f.endsWith(".d.ts") || isTestOrStory(f)) continue;
          const segs = f.slice(dir.length + 1).replace(/\.(jsx?|tsx?)$/, "").split("/");
          if (segs[0] === "api" || (segs.length === 1 && ["_app", "_document", "_error"].includes(segs[0]!))) continue;
          out.push(f);
        }
      for (const dir of [jp(p.dir, "app"), jp(p.dir, "src/app")])
        for (const f of files) {
          if (!f.startsWith(dir + "/") || !/(^|\/)page\.(jsx?|tsx?)$/.test(f)) continue;
          if (parentOf(f.slice(dir.length + 1)).split("/").filter(Boolean).some((s) => s.startsWith("_") || /^\(\.{1,3}\)/.test(s))) continue;
          out.push(f);
        }
    }
    if ("nuxt" in p.deps)
      for (const dir of [jp(p.dir, "pages"), jp(p.dir, "app/pages"), jp(p.dir, "src/pages")]) for (const f of files) if (f.startsWith(dir + "/") && /\.(vue|jsx|tsx)$/.test(f) && !isTestOrStory(f)) out.push(f);
  }
  for (const f of files) if (f === "+page.svelte" || f.endsWith("/+page.svelte")) out.push(f);
  return out;
}

/** The tracked file an import names, relative or through the @/ and ~/ source aliases, or null. */
function resolveImport(spec: string, from: string, pkg: string, tracked: ReadonlySet<string>): string | null {
  const base = spec.startsWith(".") ? posix.join(parentOf(from), spec) : /^[@~]\//.test(spec) ? posix.join(pkg, "src", spec.slice(2)) : null;
  if (base === null || base.startsWith("..")) return null;
  for (const c of [base, ...RESOLVE_EXTS.map((e) => base + e), ...RESOLVE_EXTS.map((e) => base + "/index" + e)]) if (tracked.has(c)) return c;
  return null;
}

const wildcardOnly = (p: string) => {
  const segs = patternSegs(p);
  return segs.length > 0 && segs.every((s) => s.kind === "rest0" || s.kind === "rest1");
};

/** A code router's screen files: the component files that each file defining its routes imports, statically or lazily. */
function importedScreens(root: string, files: readonly string[], pkgs: readonly string[]): string[] {
  const tracked = new Set(files);
  const out: string[] = [];
  for (const f of files) {
    if (!CODE_FILE.test(f) || f.endsWith(".d.ts") || f.endsWith(".min.js") || isTestOrStory(f)) continue;
    const text = readText(root, f);
    const r = text === null ? null : codeRouterOf(text);
    if (!r) continue;
    const loader = /\.(m|c)?ts$/.test(f) ? "ts" : "tsx";
    if (!codeRoutes(text!, loader, r.config).some((e) => !e.redirect && !wildcardOnly(e.path))) continue;
    let imports: { path: string }[];
    try {
      imports = new Bun.Transpiler({ loader }).scanImports(text!);
    } catch {
      continue;
    }
    for (const i of imports) {
      const hit = resolveImport(i.path, f, nearestPackage(pkgs, f), tracked);
      if (hit && COMPONENT.test(hit) && !isTestOrStory(hit)) out.push(hit);
    }
  }
  return out;
}

/** The view of a checkout at its pin; refuses with E_DCW_APPS_VIEW unless HEAD is the pin and the working tree is clean. */
export function viewAt(dir: string, pin: string, label: string): AppView {
  if (!OID.test(pin) || headOf(dir) !== pin) fail("E_DCW_APPS_VIEW", label + "'s checkout is not at its pin");
  if (git(dir, ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=all"]).trim() !== "") fail("E_DCW_APPS_VIEW", label + "'s checkout has changes or files outside the pin's tree");
  const files = trackedAt(dir, pin);
  const pkgs = readPackages(dir, files);
  const designFiles = files.filter((f) => designKind(dir, f) !== null);
  const routeFiles = [...new Set([...pageFiles(files, pkgs), ...importedScreens(dir, files, pkgs.map((p) => p.dir))])].sort();
  return { files: files.length, designFiles, routeFiles };
}

const listDigest = (l: readonly string[]) => sha(JSON.stringify([...l].sort()));
const viewLine = (label: string, v: AppView) => "app " + label + ": " + v.files + " tracked files, " + v.designFiles.length + " design files (sha256 " + listDigest(v.designFiles) + "), " + v.routeFiles.length + " route files (sha256 " + listDigest(v.routeFiles) + ")";

/** Refuses with E_DCW_APPS_VIEW when a built view's designFiles or routeFiles differ from a pin record's, by counts only. */
export function checkView(label: string, got: AppView, want: { designFiles: string[]; routeFiles: string[] }): void {
  const bad: string[] = [];
  for (const k of ["designFiles", "routeFiles"] as const) {
    const extra = got[k].filter((x) => !want[k].includes(x)).length;
    const missing = want[k].filter((x) => !got[k].includes(x)).length;
    if (extra || missing) bad.push(k + ": " + extra + " built and not in the pin record, " + missing + " in the pin record and not built");
  }
  if (bad.length) fail("E_DCW_APPS_VIEW", label + "'s view differs from its pin record: " + bad.join("; "));
}

const newPath = (out: string, what: string) => {
  const p = resolve(out);
  const rel = relative(REPO_ROOT, p);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) fail("E_USAGE", what + " must sit outside the repository");
  if (existsSync(p)) fail("E_USAGE", what + " " + p + " exists already");
  return p;
};

const writeText = (path: string, v: unknown): string => {
  const text = JSON.stringify(v, null, 2) + "\n";
  writeFileSync(path, text);
  return sha(text);
};

export const appsRow: Row = (a, io) => {
  const usage = "apps --clones <clones row folder> --base-apps <base-apps.json> --out <new apps.json>";
  const clones = resolve(need(a, "--clones", usage));
  const baseApps = readJson<Array<{ id: string; pin: string }>>(resolve(need(a, "--base-apps", usage)), "--base-apps");
  const out = newPath(need(a, "--out", usage), "--out");
  if (!Array.isArray(baseApps) || !baseApps.length) fail("E_USAGE", "--base-apps holds no base apps");
  const entries: AppEntry[] = baseApps.map((b, i) => {
    if (!/^c\d{3}$/.test(b?.id ?? "") || !OID.test(b?.pin ?? "")) fail("E_USAGE", "--base-apps entry " + i + " needs an id c<NNN> and a 40-hex pin");
    const dir = join(clones, "clones", b.id);
    if (!existsSync(dir)) fail("E_USAGE", "the clones folder holds no clone for " + b.id);
    const v = viewAt(dir, b.pin, b.id);
    io.out(viewLine(b.id, v));
    return { label: b.id, dir: relative(dirname(out), dir), designFiles: v.designFiles, routeFiles: v.routeFiles };
  });
  io.out("apps: " + entries.length + " base apps; sha256 apps.json " + writeText(out, entries));
  return 0;
};

/** pin.json in the opened planted tar: the planted app's commit, tree and view, and the eight units. */
interface PlantedPin {
  commit: string;
  tree: string;
  repository: string;
  base_app_view: { designFiles: string[]; routeFiles: string[]; files: number };
  units: Array<{ name: string; unitId: string; author: string; kind: string; plantedClass: string | null }>;
}

const NAMES: readonly PlantedName[] = ["G1", "G2", "B1", "B2", "B3", "B4", "B5", "B6"];
const CLASSES: readonly ItemClass[] = ["S", "H", "R", "A", "Y"];
/** pin.json's planted class: an item class, or null for a unit-level case written as null, "", "none" or "unit". */
const plantedClassOf = (v: string | null): ItemClass | null | undefined => (v === null || v === "" || v === "none" || v === "unit" ? null : CLASSES.includes(v as ItemClass) ? (v as ItemClass) : undefined);

/** Every regular file under dir, relative and sorted. */
const filesUnder = (dir: string, rel = ""): string[] =>
  readdirSync(join(dir, rel))
    .flatMap((n) => {
      const p = rel ? rel + "/" + n : n;
      return statSync(join(dir, p)).isDirectory() ? filesUnder(dir, p) : [p];
    })
    .sort();

/** One planted unit's entry from its folder, refused unless unit.json and pin.json agree and the evidence list is the folder's. */
function plantedEntry(root: string, u: PlantedPin["units"][number]): PlantedEntry {
  const no = (why: string): never => fail("E_DCW_PLANTED_INPUTS", "planted unit " + u.name + ": " + why);
  const dir = join(root, "units", u.name);
  const unit = readJson<Record<string, unknown>>(join(dir, "unit.json"), "unit.json");
  for (const k of ["name", "unitId", "author", "kind", "plantedClass"] as const) if ((unit[k] ?? null) !== (u[k] ?? null)) no("unit.json's " + k + " differs from pin.json's");
  if (!["sol", "argon"].includes(u.author)) no("the author is not sol or argon");
  if (!/^k[1-6]$/.test(u.kind)) no("the change kind is not k1 to k6");
  const plantedClass = plantedClassOf(u.plantedClass);
  if (plantedClass === undefined) no("the planted class is not an item class or a unit-level case");
  const listed = Array.isArray(unit.evidence) ? unit.evidence.map((e) => (typeof e === "string" ? e : (e as { path?: unknown })?.path)) : null;
  if (!listed || listed.some((p) => typeof p !== "string" || p.startsWith("/") || p.split("/").includes(".."))) no("unit.json's evidence is not a list of relative paths");
  const onDisk = filesUnder(dir).filter((f) => !["plan.md", "context/project.md", "key.json", "unit.json"].includes(f));
  if (JSON.stringify([...listed!].sort()) !== JSON.stringify(onDisk)) no("unit.json lists " + listed!.length + " evidence files and the folder holds " + onDisk.length + " other files");
  const evidence: EvidenceFile[] = (listed as string[]).map((p) => ({ path: p, text: readFileSync(join(dir, p), "utf8") }));
  const key = readJson<Key>(join(dir, "key.json"), "key.json");
  if (!Array.isArray(key?.items) || !Array.isArray(key.wrongWay)) no("key.json is not a key (items and wrongWay)");
  const files: UnitFiles = { plan: readFileSync(join(dir, "plan.md"), "utf8"), context: readFileSync(join(dir, "context", "project.md"), "utf8"), evidence, key: { items: key.items, wrongWay: key.wrongWay, decoy: key.decoy ?? null } };
  return { name: u.name as PlantedName, unitId: u.unitId, files, app: 0, author: u.author as AuthorFamily, kind: u.kind as ChangeKind, plantedClass: plantedClass ?? null };
}

/** The planted row; the command line fetches the planted app over HTTPS through the frame's clone seam. */
export const plantedRow =
  (s: { clone?: FrameSeams["clone"]; table?: () => PlantedTable } = {}): Row =>
  (a, io) => {
    const usage = "planted --in <opened planted tar folder> --out <new folder>";
    const root = resolve(need(a, "--in", usage));
    const out = newPath(need(a, "--out", usage), "--out");
    const pin = readJson<PlantedPin>(join(root, "pin.json"), "pin.json");
    if (!OID.test(pin.commit ?? "") || !OID.test(pin.tree ?? "") || typeof pin.repository !== "string" || !pin.repository) fail("E_DCW_PLANTED_INPUTS", "pin.json needs a 40-hex commit and tree and a repository");
    const v = pin.base_app_view;
    if (!v || !Array.isArray(v.designFiles) || !Array.isArray(v.routeFiles)) fail("E_DCW_PLANTED_INPUTS", "pin.json has no base_app_view with designFiles and routeFiles");
    const units = Array.isArray(pin.units) ? pin.units : [];
    const folders = existsSync(join(root, "units")) ? readdirSync(join(root, "units")).sort() : [];
    const names = JSON.stringify([...NAMES].sort());
    if (JSON.stringify(units.map((u) => u?.name).sort()) !== names || JSON.stringify(folders) !== names) fail("E_DCW_PLANTED_INPUTS", "pin.json lists " + units.length + " units and units/ holds " + folders.length + " folders; both must be G1, G2 and B1 to B6");
    const planted = units.map((u) => plantedEntry(root, u)).sort((x, y) => NAMES.indexOf(x.name) - NAMES.indexOf(y.name));
    checkPlantedDigests(planted.map((p) => ({ name: p.name, files: p.files }) as PlantedUnit), (s.table ?? loadPlantedTable)());
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const app = join(out, "app");
    try {
      (s.clone ?? realSeams().clone)(pin.repository, pin.commit, app);
    } catch {
      fail("E_DCW_PLANTED_INPUTS", "the planted app's commit can't be fetched");
    }
    let tree = "";
    try {
      tree = git(app, ["rev-parse", "HEAD^{tree}"]).trim();
    } catch {}
    if (tree !== pin.tree) fail("E_DCW_PLANTED_INPUTS", "the planted app's fetched tree differs from pin.json's tree");
    const view = viewAt(app, pin.commit, "the planted app");
    checkView("the planted app", view, v);
    io.out(viewLine("planted", view) + (view.files === v.files ? "" : "; pin.json counts " + v.files + " files"));
    const apps: AppEntry[] = [{ label: "planted", dir: "app", designFiles: view.designFiles, routeFiles: view.routeFiles }];
    io.out("planted: " + planted.length + " units match pin.json, their unit.json files and author/planted.json's digests; sha256 planted.json " + writeText(join(out, "planted.json"), planted));
    io.out("planted: the app's tree and view match pin.json; sha256 apps.json " + writeText(join(out, "apps.json"), apps));
    return 0;
  };
