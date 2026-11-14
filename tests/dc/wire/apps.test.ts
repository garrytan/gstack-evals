// Copyright (c) 2026 Garry Tan. MIT License.
// dc apps and dc planted (lanes/design-constructed/wire/apps.ts) on invented fixture repositories and an invented
// opened planted tar of the sealed layout: the view's design files and the router's imported screen files, apps.json
// as the author rows read it, the planted row's two gatecheck inputs, and every refusal. Clones come from local
// fixture repositories through the frame's hardened fetchAt. No key, no network.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tableOf, type PlantedUnit } from "../../../lanes/design-constructed/author/gatecheck.ts";
import type { UnitFiles } from "../../../lanes/design-constructed/author/unit.ts";
import { main } from "../../../lanes/design-constructed/cli.ts";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { fetchAt } from "../../../lanes/design-constructed/frame/git.ts";
import { appsRow, plantedRow, viewAt } from "../../../lanes/design-constructed/wire/apps.ts";
import { appsFrom, type AppEntry, type PlantedEntry } from "../../../lanes/design-constructed/wire/author.ts";
import { fakeEnv, fakeKit } from "../../../lanes/design-constructed/wire/fakes.ts";
import type { Row } from "../../../lanes/design-constructed/wire/start.ts";

const dirs: string[] = [];
const temp = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), "dc-apps-" + tag + "-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GIT_ENV = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@invalid" };

/** A local repository holding files in one commit. */
function repo(files: Record<string, string>): { path: string; commit: string; tree: string } {
  const path = join(temp("src"), "invented-private-app");
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, f)), { recursive: true });
    writeFileSync(join(path, f), text);
  }
  const g = (args: string[]) => new TextDecoder().decode(Bun.spawnSync(["git", "-C", path, ...args], { stdout: "pipe", env: GIT_ENV }).stdout).trim();
  g(["init", "-q"]);
  g(["add", "."]);
  g(["commit", "-qm", "fixture"]);
  return { path, commit: g(["rev-parse", "HEAD"]), tree: g(["rev-parse", "HEAD^{tree}"]) };
}

const CSS_VARS = ":root {\n" + Array.from({ length: 20 }, (_, i) => "  --space-" + i + ": " + i * 4 + "px;\n").join("") + "}\n";
const VUE_APP: Record<string, string> = {
  "README.md": "# Invented app\n",
  "package.json": JSON.stringify({ dependencies: { vue: "^3.4.0", "vue-router": "^4.3.0" } }),
  "src/router/index.ts": [
    'import { createRouter, createWebHistory } from "vue-router";',
    'import Home from "../views/Home.vue";',
    'import Main from "@/layouts/Main.vue";',
    'import { guard } from "./guard";',
    "export default createRouter({ history: createWebHistory(), routes: [",
    '  { path: "/", component: Main, beforeEnter: guard, children: [',
    '    { path: "", component: Home },',
    '    { path: "projects", component: () => import("@/views/Projects.vue") },',
    '    { path: "projects/:id", component: () => import("../views/ProjectDetail.vue") },',
    "  ] },",
    "] });",
    "",
  ].join("\n"),
  "src/router/guard.ts": "export const guard = () => true;\n",
  "src/views/Home.vue": "<template><div>Home</div></template>\n",
  "src/views/Projects.vue": "<template><div>Projects</div></template>\n",
  "src/views/ProjectDetail.vue": "<template><div>Detail</div></template>\n",
  "src/views/Unrouted.vue": "<template><div>Not in the router</div></template>\n",
  "src/layouts/Main.vue": "<template><router-view /></template>\n",
  "src/styles/theme.css": "body { margin: 0; }\n",
  "src/styles/app.css": ":root { --one: 1px; }\n",
  "src/styles/vars.scss": CSS_VARS,
  "src/tokens.json": "{}\n",
  "tailwind.config.js": "module.exports = { theme: { extend: { colors: { brand: '#123456' } } } };\n",
};
const VUE_VIEW = {
  designFiles: ["src/styles/theme.css", "src/styles/vars.scss", "src/tokens.json", "tailwind.config.js"],
  routeFiles: ["src/layouts/Main.vue", "src/views/Home.vue", "src/views/ProjectDetail.vue", "src/views/Projects.vue"],
};

const localClone = (src: string, names: string[] = []) => (name: string, oid: string, dest: string) => {
  names.push(name);
  fetchAt(src, oid, dest, ["file"]);
};

async function run(row: Row, argv: string[]): Promise<{ out: string[]; error: DcError | null }> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) flags.set(argv[i]!, argv[i + 1]!);
  const out: string[] = [];
  try {
    await row({ flags, bools: new Set(), rest: [] }, { out: (t) => out.push(t), err: (t) => out.push(t) }, fakeEnv(fakeKit()));
    return { out, error: null };
  } catch (e) {
    if (!(e instanceof DcError)) throw e;
    return { out, error: e };
  }
}

describe("dc apps", () => {
  test("a vue-router app's view: every tracked design-system file, and the component files its router file imports", () => {
    // Value: protects=apps.json's rule: designFiles are every tracked file designKind accepts and routeFiles the screen files the router imports, statically or lazily, relative or through @/; fails_when=an unrouted view, a non-component import, a short CSS file or an untracked file enters the view, or a lazy import is missed; why_new=no row wrote apps.json; seam=viewAt; no_claim=a real base app's router
    const r = repo(VUE_APP);
    const dest = join(temp("view"), "c001");
    fetchAt(r.path, r.commit, dest, ["file"]);
    expect(viewAt(dest, r.commit, "c001")).toEqual({ files: Object.keys(VUE_APP).length, ...VUE_VIEW });
    const next = repo({ "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }), "pages/index.tsx": "export default () => null;\n", "pages/about.tsx": "export default () => null;\n", "pages/_app.tsx": "export default () => null;\n", "pages/api/ping.ts": "export default () => null;\n", "app/settings/page.tsx": "export default () => null;\n" });
    const nd = join(temp("view"), "c002");
    fetchAt(next.path, next.commit, nd, ["file"]);
    expect(viewAt(nd, next.commit, "c002").routeFiles).toEqual(["app/settings/page.tsx", "pages/about.tsx", "pages/index.tsx"]);
    writeFileSync(join(dest, "stray.txt"), "not in the pin's tree\n");
    expect(() => viewAt(dest, r.commit, "c001")).toThrow("files outside the pin's tree");
    expect(() => viewAt(nd, r.commit, "c002")).toThrow("is not at its pin");
  });

  test("the apps row writes one AppEntry per base app in base-apps.json's order, the author rows read it, and its lines name no repository and no path", async () => {
    // Value: protects=the author and gatecheck rows' --apps input: each entry's checkout from the clones row's layout, its label and its view; fails_when=apps.json doesn't parse through appsFrom, an entry points outside clones/<id>, a pin mismatch is written, or a line carries a repository name or file path; why_new=no row wrote apps.json; seam=the apps row through gstack-evals dc's main; no_claim=the real base apps
    const r = repo(VUE_APP);
    const work = temp("work");
    mkdirSync(join(work, "frame", "clones"), { recursive: true });
    for (const id of ["c004", "c002"]) fetchAt(r.path, r.commit, join(work, "frame", "clones", id), ["file"]);
    writeFileSync(join(work, "base-apps.json"), JSON.stringify([{ id: "c004", pin: r.commit, recipe: {} }, { id: "c002", pin: r.commit, recipe: {} }]));
    const out: string[] = [];
    const code = await main(["apps", "--clones", join(work, "frame"), "--base-apps", join(work, "base-apps.json"), "--out", join(work, "apps.json")], { out: (t) => out.push(t), err: (t) => out.push(t) });
    expect(code).toBe(0);
    const entries = JSON.parse(readFileSync(join(work, "apps.json"), "utf8")) as AppEntry[];
    expect(entries).toEqual([
      { label: "c004", dir: "frame/clones/c004", ...VUE_VIEW },
      { label: "c002", dir: "frame/clones/c002", ...VUE_VIEW },
    ]);
    const views = appsFrom({ flags: new Map([["--apps", join(work, "apps.json")]]), bools: new Set(), rest: [] }, "apps");
    expect(views.map((v) => [v.label, v.read("src/views/Home.vue")])).toEqual([["c004", VUE_APP["src/views/Home.vue"]], ["c002", VUE_APP["src/views/Home.vue"]]]);
    expect(out).toHaveLength(3);
    expect(out.at(-1)).toMatch(/^apps: 2 base apps; sha256 apps\.json [0-9a-f]{64}$/);
    expect(out.filter((l) => l.includes("invented-private-app") || l.includes("src/"))).toEqual([]);
    writeFileSync(join(work, "moved.json"), JSON.stringify([{ id: "c004", pin: "f".repeat(40), recipe: {} }]));
    const bad = await main(["apps", "--clones", join(work, "frame"), "--base-apps", join(work, "moved.json"), "--out", join(work, "apps-2.json")], { out: (t) => out.push(t), err: (t) => out.push(t) });
    expect([bad, out.at(-1)?.split(" ")[0]]).toEqual([2, "E_DCW_APPS_VIEW"]);
  });
});

const NAMES = ["G1", "G2", "B1", "B2", "B3", "B4", "B5", "B6"] as const;
const META: Record<(typeof NAMES)[number], { author: string; kind: string; plantedClass: string | null }> = {
  G1: { author: "sol", kind: "k1", plantedClass: null },
  G2: { author: "argon", kind: "k2", plantedClass: null },
  B1: { author: "sol", kind: "k3", plantedClass: null },
  B2: { author: "argon", kind: "k4", plantedClass: "S" },
  B3: { author: "sol", kind: "k5", plantedClass: null },
  B4: { author: "argon", kind: "k6", plantedClass: "H" },
  B5: { author: "sol", kind: "k1", plantedClass: "R" },
  B6: { author: "argon", kind: "k2", plantedClass: "Y" },
};

/** An opened planted tar of the sealed layout: pin.json and units/<name>/ with plan, context, key, unit.json and evidence. */
function openedTar(app: { commit: string; tree: string }): { root: string; files: Record<string, UnitFiles> } {
  const root = temp("tar");
  const files: Record<string, UnitFiles> = {};
  const units = NAMES.map((name) => ({ name, unitId: "planted-" + name.toLowerCase(), ...META[name] }));
  for (const u of units) {
    const dir = join(root, "units", u.name);
    const evidence = ["docs/product-notes/usage/" + u.name + "-a.md", "docs/product-notes/support/" + u.name + "-b.md"];
    const key = { items: [{ id: "i1", class: "S", statement: "Invented statement " + u.name, detail: "invented detail", evidence: [{ file: evidence[0], line: 1 }] }], wrongWay: [], decoy: null };
    const texts: Record<string, string> = { "plan.md": "Invented plan " + u.name + "\n", "context/project.md": "Invented context\n", "key.json": JSON.stringify(key), "unit.json": JSON.stringify({ ...u, evidence }), [evidence[0]!]: "Invented note one\n", [evidence[1]!]: "Invented note two\n" };
    for (const [f, t] of Object.entries(texts)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), t);
    }
    files[u.name] = { plan: texts["plan.md"]!, context: texts["context/project.md"]!, evidence: evidence.map((p) => ({ path: p, text: texts[p]! })), key: key as unknown as UnitFiles["key"] };
  }
  const pin = { authored: "2026-11-14", commit: app.commit, tree: app.tree, clone_url: "https://example.invalid/invented.git", repository: "invented-owner/invented-private-app", licence: "MIT", layout: "units/<name>/", frame_member: "no", file_check: { all: "pass" }, base_app_view: { ...VUE_VIEW, files: Object.keys(VUE_APP).length, rule: "invented" }, units };
  writeFileSync(join(root, "pin.json"), JSON.stringify(pin));
  return { root, files };
}

const table = (files: Record<string, UnitFiles>) => () => tableOf(NAMES.map((name) => ({ name, files: files[name]! }) as PlantedUnit));

describe("dc planted", () => {
  test("the planted row writes planted.json and a one-entry apps.json the gatecheck row reads, with the app fetched by pin.json's commit and checked against its tree and view", async () => {
    // Value: protects=the gate check's inputs: PlantedEntry[] from the opened tar, cross-checked with pin.json, each unit.json and the digest table, and the planted app's AppEntry from a fresh fetch; fails_when=an entry's files, app index or class differ from the tar, the app is not fetched by pin.json's repository and commit, or a line carries the repository name or unit text; why_new=the sealed tar holds no file in the rows' shapes; seam=plantedRow with a local clone seam and the fixture's table; no_claim=the real planted units or their real digests
    const app = repo(VUE_APP);
    const t = openedTar(app);
    const names: string[] = [];
    const out = join(temp("planted"), "inputs");
    const r = await run(plantedRow({ clone: localClone(app.path, names), table: table(t.files) }), ["--in", t.root, "--out", out]);
    expect(r.error).toBeNull();
    expect(names).toEqual(["invented-owner/invented-private-app"]);
    const planted = JSON.parse(readFileSync(join(out, "planted.json"), "utf8")) as PlantedEntry[];
    expect(planted.map((p) => [p.name, p.unitId, p.app, p.author, p.kind, p.plantedClass])).toEqual(NAMES.map((n) => [n, "planted-" + n.toLowerCase(), 0, META[n].author, META[n].kind, META[n].plantedClass]));
    expect(planted.map((p) => p.files)).toEqual(NAMES.map((n) => t.files[n]!));
    expect(JSON.parse(readFileSync(join(out, "apps.json"), "utf8"))).toEqual([{ label: "planted", dir: "app", ...VUE_VIEW }]);
    expect(appsFrom({ flags: new Map([["--apps", join(out, "apps.json")]]), bools: new Set(), rest: [] }, "planted")[0]!.designFiles).toEqual(VUE_VIEW.designFiles);
    expect(r.out.filter((l) => /invented|Invented|example\.invalid|src\//.test(l))).toEqual([]);
  });

  const refusals: Array<[string, (root: string, app: { commit: string; tree: string }) => void, string]> = [
    ["a unit.json whose kind differs from pin.json's", (root) => writeFileSync(join(root, "units", "B3", "unit.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(root, "units", "B3", "unit.json"), "utf8")), kind: "k6" })), "E_DCW_PLANTED_INPUTS planted unit B3: unit.json's kind differs"],
    ["an evidence file unit.json doesn't list", (root) => writeFileSync(join(root, "units", "G1", "docs", "product-notes", "usage", "extra.md"), "Invented extra\n"), "E_DCW_PLANTED_INPUTS planted unit G1: unit.json lists 2 evidence files and the folder holds 3"],
    ["a missing unit folder", (root) => rmSync(join(root, "units", "B6"), { recursive: true }), "E_DCW_PLANTED_INPUTS pin.json lists 8 units and units/ holds 7 folders"],
    ["a plan that differs from the digest table", (root) => writeFileSync(join(root, "units", "B2", "plan.md"), "Changed\n"), "E_PLANTED_DIGEST planted units differ from the committed table: B2: plan.md, digest"],
    ["a pin.json tree the fetched app doesn't have", (root) => writeFileSync(join(root, "pin.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(root, "pin.json"), "utf8")), tree: "e".repeat(40) })), "E_DCW_PLANTED_INPUTS the planted app's fetched tree differs"],
    ["a pin record whose routeFiles leave one out", (root) => {
      const pin = JSON.parse(readFileSync(join(root, "pin.json"), "utf8"));
      writeFileSync(join(root, "pin.json"), JSON.stringify({ ...pin, base_app_view: { ...pin.base_app_view, routeFiles: pin.base_app_view.routeFiles.slice(1) } }));
    }, "E_DCW_APPS_VIEW the planted app's view differs from its pin record: routeFiles: 1 built and not in the pin record, 0 in the pin record and not built"],
  ];
  for (const [name, spoil, want] of refusals)
    test("the planted row refuses " + name + " and writes no gatecheck input", async () => {
      // Value: protects=the planted row's cross-checks, each refusing on any difference; fails_when=the row writes planted.json or apps.json past a difference; why_new=the gate check's inputs are new; seam=plantedRow; no_claim=the real sealed tar
      const app = repo(VUE_APP);
      const t = openedTar(app);
      spoil(t.root, app);
      const out = join(temp("planted"), "inputs");
      const r = await run(plantedRow({ clone: localClone(app.path), table: table(t.files) }), ["--in", t.root, "--out", out]);
      expect(r.error ? r.error.code + " " + r.error.message : "no refusal").toStartWith(want);
      expect([Bun.file(join(out, "planted.json")).size, Bun.file(join(out, "apps.json")).size]).toEqual([0, 0]);
    });
});
