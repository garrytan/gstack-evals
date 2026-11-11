// Copyright (c) 2026 Garry Tan. MIT License.
// Frozen recipes of the eng-review build read (plan sections 3 and 11), ported from the supply probe: ecosystem
// detection from the nearest manifest, the install and per-case test step for Go, Node (npm, pnpm, yarn or bun, with
// jest, vitest, mocha or node:test), Python (pip or uv, with pytest) and Rust (cargo test), and the classifier that
// gives every case in every run its CaseClass. Only "assert" is a scorable failure: a Python AttributeError, NameError
// or ImportError, a JavaScript ReferenceError or a TypeError through something undefined, a Go or Rust compile error
// and a collection or load error never are. Holds no unit data and prints no repository content.
import type { NodeRunner, Runner } from "../real-outcome/task/format.ts";
import { parseCargo, parseGoTest, parseJestJson, parseMochaJson, parseNodeEvents, parseXml, resultFor, type Parsed, type Results, type TestResult, type XmlNode } from "../real-outcome/task/record.ts";
import { fail } from "./errors.ts";
import type { CaseClass, Ecosystem } from "./types.ts";

const DEP_BASENAMES = new Set([
  "go.mod", "go.sum", "go.work", "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "bun.lockb", "bun.lock", ".yarnrc.yml",
  "pyproject.toml", "setup.py", "setup.cfg", "poetry.lock", "uv.lock", "Pipfile", "Pipfile.lock", "Cargo.toml", "Cargo.lock", ".nvmrc", ".node-version", ".python-version", "rust-toolchain", "rust-toolchain.toml",
]);

const base = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (d: string, n: string): string => (d === "" ? n : d + "/" + n);
const ext = (p: string): string => (base(p).includes(".") ? base(p).slice(base(p).lastIndexOf(".")).toLowerCase() : "");
function* parents(d: string): Generator<string> {
  for (;;) {
    yield d;
    if (d === "") return;
    d = dirOf(d);
  }
}

/** A file whose change can change what the install puts in the image. */
export const isDepFile = (path: string): boolean => DEP_BASENAMES.has(base(path)) || (base(path).startsWith("requirements") && path.endsWith(".txt"));

const EXT_ECO: Record<string, string> = {
  ".go": "go", ".ts": "node", ".tsx": "node", ".js": "node", ".jsx": "node", ".mjs": "node", ".cjs": "node", ".mts": "node", ".cts": "node", ".svelte": "node", ".vue": "node",
  ".py": "python", ".rs": "rust", ".php": "php", ".rb": "ruby", ".kt": "jvm", ".java": "jvm", ".dart": "dart", ".swift": "swift", ".cpp": "cpp", ".cc": "cpp", ".c": "cpp", ".h": "cpp",
  ".hpp": "cpp", ".m": "objc", ".cs": "dotnet", ".ex": "elixir", ".exs": "elixir",
};
const RECIPE_ECOS: readonly string[] = ["go", "node", "python", "rust"];

/** A source file's ecosystem, a recipe ecosystem or another language name (which has no recipe), or null. */
export const ecoOfFile = (path: string): string | null => EXT_ECO[ext(path)] ?? null;
export const hasRecipe = (eco: string | null): eco is Ecosystem => eco !== null && RECIPE_ECOS.includes(eco);

/** Refuses an ecosystem with no frozen recipe: the unit drops with E_EB_NO_RECIPE. */
export function needRecipe(unit: string, eco: string): Ecosystem {
  if (!hasRecipe(eco)) fail("E_EB_NO_RECIPE", unit + " step=recipe class=" + eco + ": only Go, Node, Python and Rust have a frozen recipe");
  return eco as Ecosystem;
}

/** Whether a file is a test file a runner of its ecosystem runs on its own. Any Rust source may hold inline tests. */
export function runnable(eco: string, path: string): boolean {
  const b = base(path);
  const parts = path.split("/");
  if (eco === "go") return b.endsWith("_test.go");
  if (eco === "node") {
    if (parts.includes("node_modules")) return false;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(b)) return true;
    return /\.[cm]?[jt]sx?$/.test(b) && (parts.includes("__tests__") || parts.slice(0, -1).includes("test") || parts.slice(0, -1).includes("tests")) && !/^(setup|helper|util|fixture|index\.)/.test(b);
  }
  if (eco === "python") return b.endsWith(".py") && (b.startsWith("test_") || b.endsWith("_test.py")) && b !== "__init__.py";
  if (eco === "rust") return b.endsWith(".rs");
  return false;
}

const MARKERS: Record<Ecosystem, string[]> = {
  go: ["go.mod"],
  node: ["package.json"],
  python: ["pyproject.toml", "setup.py", "setup.cfg", "pytest.ini", "tox.ini", "requirements.txt"],
  rust: ["Cargo.toml"],
};
const NODE_LOCKS = ["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb", "bun.lock", "npm-shrinkwrap.json"];

/** The install root and the project dir of a test file: the nearest manifest, then (Node, Rust, Python) the dir that
 * holds the lockfile or the project file. Null when no manifest is found. */
export function findProject(eco: Ecosystem, path: string, listing: Set<string>): { root: string; projdir: string; marker: string } | null {
  let projdir: string | null = null;
  let marker = "";
  for (const d of parents(dirOf(path))) {
    const m = MARKERS[eco].find((x) => listing.has(join(d, x)));
    if (m) {
      projdir = d;
      marker = m;
      break;
    }
  }
  if (projdir === null) return null;
  let root = projdir;
  const up = (has: (d: string) => boolean) => {
    for (const d of parents(projdir!)) if (has(d)) return d;
    return projdir!;
  };
  if (eco === "node") root = up((d) => NODE_LOCKS.some((l) => listing.has(join(d, l))));
  else if (eco === "rust") root = up((d) => listing.has(join(d, "Cargo.lock")));
  else if (eco === "python" && ["pytest.ini", "tox.ini", "requirements.txt"].includes(marker)) root = up((d) => listing.has(join(d, "pyproject.toml")) || listing.has(join(d, "setup.py")));
  return { root, projdir, marker };
}

const major = (v: string | undefined, dflt: number | null): number | null => {
  const m = /(\d+)/.exec(v ?? "");
  return m ? Number(m[1]) : dflt;
};
const sq = (s: string): string => "'" + s.replaceAll("'", "'\\''") + "'";

/** Reads a repository file of the tree a recipe is for, or null. */
export type Read = (path: string) => string | null;

export interface Recipe {
  eco: Ecosystem;
  /** The install root, relative to the repository. */
  root: string;
  pm: "npm" | "pnpm" | "yarn" | "bun" | "go" | "pip" | "uv" | "poetry" | "cargo";
  /** Base image tags to try in order; the unit image pins the first that pulls by digest. */
  images: string[];
  /** Environment for the install and the screen's test steps. Caches sit under /cache, a per-unit volume. */
  env: Record<string, string>;
  /** The install, run with the network on in the repository dir. */
  install: (repo: string) => string;
  /** A Node build command (package.json scripts.build), run offline; null when there is none. */
  build: ((repo: string) => string) | null;
  /** Per-unit volumes the recipe mounts: name and container path. */
  volumes: [string, string][];
}

const NODE_ENV: Record<string, string> = {
  npm_config_cache: "/cache/npm", npm_config_store_dir: "/cache/pnpm", YARN_CACHE_FOLDER: "/cache/yarn", COREPACK_HOME: "/cache/corepack", COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  BUN_INSTALL_CACHE_DIR: "/cache/bun", HUSKY: "0", PUPPETEER_SKIP_DOWNLOAD: "1", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1", CYPRESS_INSTALL_BINARY: "0", ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
  NODE_OPTIONS: "--max-old-space-size=3072", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false", TZ: "UTC",
};

function nodeRecipe(read: Read, root: string, listing: Set<string>): Recipe {
  let pkg: Record<string, any> = {};
  try {
    const p = JSON.parse(read(join(root, "package.json")) ?? "{}");
    if (p && typeof p === "object" && !Array.isArray(p)) pkg = p;
  } catch {}
  const has = (n: string) => listing.has(join(root, n));
  const pm = has("pnpm-lock.yaml") ? "pnpm" : has("bun.lockb") || has("bun.lock") ? "bun" : has("yarn.lock") ? "yarn" : "npm";
  const field = typeof pkg.packageManager === "string" ? (pkg.packageManager as string) : "";
  let v: number | null = null;
  for (const n of [".nvmrc", ".node-version"]) {
    const t = (read(join(root, n)) ?? "").trim().toLowerCase();
    if (t) {
      const lts: Record<string, number> = { "lts/hydrogen": 18, "lts/iron": 20, "lts/jod": 22, "lts/*": 22, node: 24, stable: 24, lts: 22 };
      v = lts[t] ?? major(t, null);
      break;
    }
  }
  if (v === null && typeof pkg.volta?.node === "string") v = major(pkg.volta.node, null);
  if (v === null && typeof pkg.engines?.node === "string") {
    const eng = pkg.engines.node as string;
    const lo = major(eng, 22)!;
    v = eng.includes(">") && !/<\s*\d/.test(eng) ? Math.max(lo, 22) : lo;
  }
  v = Math.min(Math.max(v ?? 22, 18), 24);
  const pnpmVer = () => {
    if (field.startsWith("pnpm@")) return field.split("@")[1].split("+")[0];
    const m = /lockfileVersion:\s*'?(\d+)/.exec((read(join(root, "pnpm-lock.yaml")) ?? "").slice(0, 200));
    return ({ 9: "9", 6: "8", 5: "7" } as Record<number, string>)[m ? Number(m[1]) : 9] ?? "9";
  };
  const install = () => {
    if (pm === "pnpm") return "(npm i -g pnpm@" + sq(pnpmVer()) + " || npm i -g pnpm@9) >/dev/null 2>&1; pnpm config set manage-package-manager-versions false >/dev/null 2>&1; pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile";
    if (pm === "bun") return "npm i -g bun@1 >/dev/null 2>&1; (bun install --frozen-lockfile || bun install)";
    if (pm === "yarn") {
      const berry = has(".yarnrc.yml") || (read(join(root, "yarn.lock")) ?? "").slice(0, 3000).includes("__metadata");
      if (berry) return (field.startsWith("yarn@") ? "corepack enable; " : "") + "(yarn install --immutable || YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install)";
      return "yarn install --frozen-lockfile --network-timeout 600000 || yarn install --network-timeout 600000";
    }
    return "npm ci || npm install";
  };
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const build =
    "build" in scripts
      ? (repo: string) => "export PATH=" + join(repo, join(root, "node_modules/.bin")) + ":$PATH; " + (pm === "yarn" && field.startsWith("yarn@") ? "corepack enable >/dev/null 2>&1; " : "") + (pm === "bun" || pm === "pnpm" ? "npm run build" : pm + " run build")
      : null;
  return { eco: "node", root, pm, images: ["node:" + v, "node:22"], env: NODE_ENV, install, build, volumes: [] };
}

function pythonRecipe(read: Read, root: string, listing: Set<string>): Recipe {
  const txt = ["pyproject.toml", "setup.py", "setup.cfg"].map((n) => read(join(root, n)) ?? "").join("\n");
  const pv = (read(join(root, ".python-version")) ?? "").trim();
  const allowed = ["3.13", "3.12", "3.11", "3.10", "3.9", "3.8"];
  const spec = /(?:requires-python|python_requires)\s*=\s*['"]([^'"]+)/.exec(txt)?.[1] ?? "";
  let lo: number | null = null;
  let upper: number | null = null;
  const ge = />=?\s*3\.(\d+)/.exec(spec);
  if (ge) lo = Number(ge[1]);
  const caret = /\^\s*3\.(\d+)|~=\s*3\.(\d+)/.exec(spec);
  if (caret) lo = Number(caret[1] ?? caret[2]);
  const lt = /<\s*3\.(\d+)/.exec(spec);
  if (lt) upper = Number(lt[1]);
  const cands = allowed.filter((x) => (lo === null || Number(x.split(".")[1]) >= lo) && (upper === null || Number(x.split(".")[1]) < upper));
  const v = /^3\.\d+/.exec(pv)?.[0] ?? (cands.includes("3.12") || cands.length === 0 ? "3.12" : cands[0]);
  const has = (n: string) => listing.has(join(root, n));
  const pm = has("uv.lock") ? "uv" : has("poetry.lock") ? "poetry" : "pip";
  const install = () => {
    let s = "rm -rf /opt/venv/* /opt/venv/.[!.]* 2>/dev/null; python -m venv /opt/venv && . /opt/venv/bin/activate && pip install -q -U pip; ";
    if (pm === "uv") s += "pip install -q uv && (uv sync --frozen --all-extras --all-groups || uv sync --frozen --all-extras || uv sync --frozen || uv sync); ";
    else if (pm === "poetry") s += "pip install -q poetry && (poetry install --no-interaction --all-extras --with dev,test || poetry install --no-interaction --all-extras || poetry install --no-interaction); ";
    else {
      const reqs = [...listing].filter((p) => ((dirOf(p) === root || dirOf(p) === join(root, "requirements")) && base(p).startsWith("requirements") && p.endsWith(".txt")) || (dirOf(p) === root && /^(dev|test)[-_]?requirements.*\.txt$/.test(base(p)))).sort();
      for (const r of reqs) s += "pip install -r " + sq(root && r.startsWith(root + "/") ? r.slice(root.length + 1) : r) + " || true; ";
      if (has("pyproject.toml") || has("setup.py") || has("setup.cfg"))
        s += "pip install -e '.[test,tests,testing,dev]' || pip install -e '.[test]' || pip install -e '.[tests]' || pip install -e '.[dev]' || pip install -e . || pip install .; pip install --group test 2>/dev/null; pip install --group dev 2>/dev/null; pip install --group tests 2>/dev/null; ";
    }
    return s + "python -m pytest --version >/dev/null 2>&1 || pip install -q pytest";
  };
  const env = {
    PIP_CACHE_DIR: "/cache/pip", UV_CACHE_DIR: "/cache/uv", POETRY_CACHE_DIR: "/cache/poetry", PIP_DISABLE_PIP_VERSION_CHECK: "1", UV_PROJECT_ENVIRONMENT: "/opt/venv", UV_LINK_MODE: "copy",
    VIRTUAL_ENV: "/opt/venv", POETRY_VIRTUALENVS_CREATE: "false", PIP_NO_INPUT: "1", TZ: "UTC", PYTHONDONTWRITEBYTECODE: "1", SETUPTOOLS_SCM_PRETEND_VERSION: "0.0.0", PDM_BUILD_SCM_VERSION: "0.0.0",
  };
  return { eco: "python", root, pm, images: ["python:" + v, "python:3.12"], env, install, build: null, volumes: [["venv", "/opt/venv"]] };
}

function goRecipe(read: Read, root: string): Recipe {
  const txt = read(join(root, "go.mod")) ?? "";
  const vers = [/^go\s+(\d+)\.(\d+)/m, /^toolchain\s+go(\d+)\.(\d+)/m].map((re) => re.exec(txt)).filter((m): m is RegExpExecArray => m !== null).map((m) => [Number(m[1]), Number(m[2])] as const);
  const best = vers.reduce<readonly [number, number]>((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a), [1, 18]);
  const images = vers.length === 0 ? ["golang:1.22", "golang:1"] : ["golang:" + best[0] + "." + best[1], "golang:1"];
  return { eco: "go", root, pm: "go", images, env: { GOMODCACHE: "/cache/gomod", GOCACHE: "/cache/gobuild", GOFLAGS: "-buildvcs=false" }, install: () => "export GOTOOLCHAIN=auto; go mod download", build: null, volumes: [] };
}

function rustRecipe(read: Read, root: string): Recipe {
  let image = "rust:1";
  for (const n of ["rust-toolchain.toml", "rust-toolchain"]) {
    const m = /(\d+\.\d+(?:\.\d+)?)/.exec(read(join(root, n)) ?? "");
    if (m) {
      image = "rust:" + m[1];
      break;
    }
  }
  return {
    eco: "rust",
    root,
    pm: "cargo",
    images: image === "rust:1" ? ["rust:1"] : [image, "rust:1"],
    env: { CARGO_TARGET_DIR: "/target", CARGO_INCREMENTAL: "0", CARGO_TERM_COLOR: "never", CARGO_BUILD_JOBS: "2" },
    install: () => TOOLCHAIN + "cargo fetch",
    build: null,
    volumes: [["target", "/target"]],
  };
}

const TOOLCHAIN = "export RUSTUP_TOOLCHAIN=$(ls /usr/local/rustup/toolchains | head -1 | sed 's/-x86_64.*//'); ";

/** The frozen recipe for an ecosystem at an install root. */
export function recipeFor(eco: Ecosystem, read: Read, root: string, listing: Set<string>): Recipe {
  if (eco === "node") return nodeRecipe(read, root, listing);
  if (eco === "python") return pythonRecipe(read, root, listing);
  if (eco === "go") return goRecipe(read, root);
  return rustRecipe(read, root);
}

/** The Node runner a group of test files uses: an import names it first, then the project's dependencies and scripts.
 * bun's own test runner has no recipe. */
export function nodeRunner(unit: string, texts: string[], pkgs: Record<string, any>[]): NodeRunner {
  const all = texts.map((t) => t.slice(0, 20000)).join(" ");
  const deps: Record<string, unknown> = {};
  let scripts = "";
  for (const p of pkgs) {
    for (const k of ["dependencies", "devDependencies", "peerDependencies"]) if (p?.[k] && typeof p[k] === "object") Object.assign(deps, p[k]);
    if (p?.scripts && typeof p.scripts === "object") scripts += " " + Object.values(p.scripts).map(String).join(" ");
  }
  if (/from\s+['"]bun:test['"]/.test(all)) return fail("E_EB_NO_RECIPE", unit + " step=recipe class=bun-test: bun's test runner has no frozen recipe");
  if (/from\s+['"]vitest['"]|require\(['"]vitest['"]\)/.test(all)) return "vitest";
  if (/['"]node:test['"]/.test(all)) return "nodetest";
  if (/@jest\/globals|\bjest\.(fn|mock|spyOn)/.test(all)) return "jest";
  if ("vitest" in deps || scripts.includes("vitest")) return "vitest";
  if ("jest" in deps || /\bjest\b/.test(scripts) || "react-scripts" in deps) return "jest";
  if ("mocha" in deps || scripts.includes("mocha")) return "mocha";
  if (scripts.includes("bun test")) return fail("E_EB_NO_RECIPE", unit + " step=recipe class=bun-test: bun's test runner has no frozen recipe");
  if (scripts.includes("node --test")) return "nodetest";
  return "vite" in deps ? "vitest" : "jest";
}

/** Where a runner's entry script sits under an install root's node_modules, so the hidden run uses the image's copy. */
export const NODE_BINS: Record<Exclude<NodeRunner, "nodetest">, string[]> = {
  jest: ["node_modules/jest/bin/jest.js", "node_modules/jest-cli/bin/jest.js", "node_modules/react-scripts/node_modules/jest/bin/jest.js"],
  vitest: ["node_modules/vitest/vitest.mjs"],
  mocha: ["node_modules/mocha/bin/mocha.js", "node_modules/mocha/bin/mocha"],
};

/** The verifier runner for a recipe and its test files. read gives the tree's files, installed the installed tree's (the
 * image), so the runner's entry and version come from what the image holds. */
export function verifierRunner(unit: string, recipe: Recipe, projdir: string, files: { path: string; text: string }[], read: Read, installed: Read): Runner {
  if (recipe.eco === "go") {
    const mod = /^module\s+(\S+)/m.exec(read(join(recipe.root, "go.mod")) ?? "");
    if (!mod || recipe.root !== "") return fail("E_EB_NO_RECIPE", unit + " step=recipe class=go-subdir: the Go recipe needs go.mod at the repository root");
    return { kind: "go", module: mod[1] };
  }
  if (recipe.eco === "python") {
    if (recipe.root !== "") return fail("E_EB_NO_RECIPE", unit + " step=recipe class=python-subdir: the pytest recipe needs the project at the repository root");
    return { kind: "pytest", python: "/opt/venv/bin/python", config: "pytest.ini" };
  }
  if (recipe.eco === "rust") {
    let name: string | null = null;
    try {
      const t = Bun.TOML.parse(read(join(projdir, "Cargo.toml")) ?? "") as { package?: { name?: unknown } };
      name = typeof t.package?.name === "string" ? t.package.name : null;
    } catch {}
    return { kind: "cargo", root: projdir, package: name, build: null };
  }
  const pkgs = [projdir, recipe.root].map((d) => {
    try {
      return JSON.parse(read(join(d, "package.json")) ?? "{}");
    } catch {
      return {};
    }
  });
  const kind = nodeRunner(unit, files.map((f) => f.text), pkgs);
  const dirs = [...new Set([projdir, recipe.root])];
  let bin = "node";
  const args: string[] = [];
  if (kind !== "nodetest") {
    const found = dirs.flatMap((d) => NODE_BINS[kind].map((b) => join(d, b))).find((b) => installed(b) !== null);
    if (!found) return fail("E_EB_IMAGE", unit + " step=install class=runner_missing: no " + kind + " under node_modules");
    bin = found;
    if (kind === "vitest") {
      const v = /^(\d+)\.(\d+)/.exec(JSON.parse(installed(found.replace(/vitest\.mjs$/, "package.json")) ?? "{}").version ?? "");
      if (v && (Number(v[1]) > 3 || (Number(v[1]) === 3 && Number(v[2]) >= 1))) args.push("--configLoader", "runner");
    }
  }
  const scripts = pkgs.map((p) => String(p?.scripts?.test ?? "")).join(" ");
  const nodeArgs = [
    ...(/--experimental-vm-modules/.test(scripts) ? ["--experimental-vm-modules"] : []),
    ...(kind === "nodetest" && files.some((f) => /\.[cm]?tsx?$/.test(f.path)) && dirs.some((d) => installed(join(d, "node_modules/tsx/package.json")) !== null) ? ["--import", "tsx"] : []),
  ];
  return { kind, root: projdir, bin, config: null, build: recipe.build ? recipe.build("/testbed") : null, node_args: nodeArgs, args };
}

/** The screen's test step for a group of test files of one project, writing its record under out (a path in the
 * container). go and cargo name packages and targets; the rest name files relative to the project dir. */
export function screenTest(runner: Runner, files: string[], out: string, repo = "/work"): string {
  const proj = (root: string) => join(repo, root);
  const rel = (root: string) => files.map((f) => sq(root && f.startsWith(root + "/") ? f.slice(root.length + 1) : f)).join(" ");
  if (runner.kind === "go") {
    const pkgs = [...new Set(files.map((f) => (dirOf(f) ? "./" + dirOf(f) : ".")))].sort();
    return "cd " + repo + "; export GOTOOLCHAIN=auto GOPROXY=off GOSUMDB=off; go test -json -count=1 -vet=off -p 2 -timeout 20m " + pkgs.map(sq).join(" ") + " > " + out + ".json 2> " + out + ".err";
  }
  if (runner.kind === "pytest") return ". /opt/venv/bin/activate; cd " + repo + "; export PYTHONPATH=" + repo + ":" + repo + "/src; python -m pytest -p no:cacheprovider -p no:randomly --junitxml=" + out + ".xml -o junit_family=xunit1 " + rel("") + " > " + out + ".log 2>&1";
  if (runner.kind === "cargo") {
    const sel = new Set<string>();
    for (const f of files) {
      const p = (runner.root && f.startsWith(runner.root + "/") ? f.slice(runner.root.length + 1) : f).split("/");
      if (p[0] === "tests" && p.length === 2) sel.add("--test " + sq(p[1].slice(0, -3)));
      else if (p[0] === "tests" && p.length === 3 && p[2] === "main.rs") sel.add("--test " + sq(p[1]));
      else if (p[0] === "tests") sel.add("--tests");
      else if (p[0] !== "benches" && p[0] !== "examples") sel.add("--lib");
    }
    return TOOLCHAIN + "cd " + proj(runner.root) + "; cargo test --offline " + (runner.package ? "-p " + sq(runner.package) + " " : "") + [...sel].sort().join(" ") + " --no-fail-fast -- --test-threads=2 > " + out + ".log 2>&1";
  }
  const pre = "cd " + proj(runner.root) + "; export PATH=" + proj(runner.root) + "/node_modules/.bin:$PATH; ";
  const bin = runner.kind === "nodetest" ? "" : "node " + runner.node_args.map((a) => sq(a) + " ").join("") + sq(join(repo, runner.bin)) + " " + runner.args.map((a) => sq(a) + " ").join("");
  const q = rel(runner.root);
  if (runner.kind === "vitest") return pre + bin + "run " + q + " --reporter=json --outputFile=" + out + ".json --passWithNoTests > " + out + ".log 2>&1";
  if (runner.kind === "jest") return pre + bin + "--ci --json --outputFile=" + out + ".json --watchAll=false --runTestsByPath " + q + " > " + out + ".log 2>&1";
  if (runner.kind === "mocha") return pre + bin + "--reporter json --reporter-option output=" + out + ".json " + q + " > " + out + ".stdout 2> " + out + ".log";
  return pre + "node " + runner.node_args.map(sq).join(" ") + " --test --test-reporter=" + dirOf(out) + "/node-reporter.mjs --test-reporter-destination=" + out + ".jsonl " + q + " > " + out + ".log 2>&1";
}

/** pytest --junitxml (xunit1, with file attributes): one result per test, keyed like pytest's node ids. A collection
 * error fails its file. */
export function parsePytestJunit(xml: string): Parsed {
  const results: Results = {};
  const seen: string[] = [];
  const doc = parseXml(xml.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""));
  if (!doc) return { results, seen, notes: xml.trim() ? ["unparsable junit record"] : [] };
  const cases: XmlNode[] = [];
  const walk = (n: XmlNode) => n.children.forEach((c) => (c.tag === "testcase" ? cases.push(c) : walk(c)));
  walk(doc);
  for (const tc of cases) {
    const file = tc.attrs.file ?? "";
    const cls = tc.attrs.classname ?? "";
    const mod = file.replace(/\.py$/, "").replaceAll("/", ".");
    const inner = cls.startsWith(mod + ".") ? cls.slice(mod.length + 1).split(".") : [];
    const bad = tc.children.find((c) => c.tag === "failure" || c.tag === "error");
    const text = bad ? (bad.attrs.message ?? "") + "\n" + bad.text : "";
    if (bad && bad.tag === "error" && (!file || /collection failure|ERROR collecting/.test(text) || tc.attrs.name === mod.split(".").pop())) {
      const f = file || (cls || tc.attrs.name || "").replaceAll(".", "/") + ".py";
      results["collect:" + f] = { status: "fail", cls: "load", exc: excName(text), msg: text.slice(0, 300) };
      continue;
    }
    const id = [file || cls.replaceAll(".", "/") + ".py", ...inner, tc.attrs.name ?? ""].join("::");
    seen.push(id);
    if (!bad) results[id] = tc.children.some((c) => c.tag === "skipped") ? { status: "skip" } : { status: "pass" };
    else results[id] = { status: "fail", cls: bad.tag === "error" ? "load" : "assert", exc: excName(text), msg: text.slice(0, 300) };
  }
  return { results, seen, notes: [] };
}

const excName = (text: string): string | undefined => /^(?:E\s+)?([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt))\b/m.exec(text)?.[1]?.split(".").pop();

/** The screen's record of one test step, parsed by its runner. read gets a suffix such as ".json". */
export function parseScreen(runner: Runner, read: (suffix: string) => string | null, repo = "/work"): Parsed {
  if (runner.kind === "go") return parseGoTest(read(".json") ?? "", read(".err") ?? "", runner.module);
  if (runner.kind === "pytest") return parsePytestJunit(read(".xml") ?? "");
  if (runner.kind === "cargo") return parseCargo(read(".log") ?? "", runner.root);
  if (runner.kind === "nodetest") return parseNodeEvents(read(".jsonl") ?? "", repo);
  if (runner.kind === "mocha") return parseMochaJson(read(".json") ?? read(".stdout") ?? "", repo);
  return parseJestJson(read(".json") ?? "", repo);
}

const PY_MISSING = new Set(["AttributeError", "NameError", "ImportError", "ModuleNotFoundError", "UnboundLocalError"]);

/** One case's class in one run. A run that timed out gives every case it did not pass "timeout"; a run killed past its
 * output buffer or one that left /out full gives "no_result". A case the run never reported, or one it skipped, has no
 * result. A failure that reached the case through its file's or package's collection is "compile" for Go and Rust and
 * "load" or "missing_name" otherwise. Otherwise the message decides: the names listed in this file's header are never
 * "assert". */
export function caseClass(runner: Runner["kind"], r: TestResult, run: { timed_out?: boolean; stopped?: boolean }, fromCollect: boolean): CaseClass {
  if (run.timed_out) return "timeout";
  if (run.stopped) return "no_result";
  if (r.status === "pass") return "pass";
  if (r.status === "missing" || r.status === "skip") return "no_result";
  const text = (r.exc ?? "") + " " + (r.msg ?? "");
  if (fromCollect) return runner === "go" || runner === "cargo" ? "compile" : r.cls === "missing_name" ? "missing_name" : "load";
  if (runner === "pytest") {
    if (PY_MISSING.has(r.exc ?? "") || /^(?:E\s+)?(AttributeError|NameError|ImportError|ModuleNotFoundError|UnboundLocalError)\b/m.test(r.msg ?? "")) return "missing_name";
    return r.cls === "assert" ? "assert" : r.cls === "missing_name" ? "missing_name" : "load";
  }
  if (runner === "go" || runner === "cargo") {
    if (/\[build failed\]|could not compile|^error\[E\d{4}\]/m.test(text)) return "compile";
    if (runner === "go" && /panic: test timed out/.test(text)) return "timeout";
    return r.cls === "assert" ? "assert" : r.cls === "missing_name" ? "missing_name" : "load";
  }
  if (/error TS\d{4}/.test(text)) return "compile";
  if (/ReferenceError|TypeError:? (?:\[Error\]:? )?(?:[\w$.()[\]]*?\.)?[\w$]+ is not a (?:function|constructor)|TypeError:? (?:\[Error\]:? )?Cannot read propert(?:y|ies) of undefined/.test(text)) return "missing_name";
  return r.cls === "assert" ? "assert" : r.cls === "missing_name" ? "missing_name" : "load";
}

/** Every id's class in one parsed run. */
export function runClasses(runner: Runner["kind"], parsed: Parsed, ids: string[], run: { timed_out?: boolean; stopped?: boolean }): Record<string, CaseClass> {
  return Object.fromEntries(ids.map((id) => [id, caseClass(runner, resultFor(parsed, id), run, !(id in parsed.results) && resultFor(parsed, id).status === "fail")]));
}

/** Step failure classes for the screen's accounting, first match wins. Counts only; never the log itself. */
const FAIL_PATTERNS: [string, RegExp][] = [
  ["oom", /\bKilled\b|JavaScript heap out of memory|exit status 137|OOMKilled|Cannot allocate memory/],
  ["network_needed", /ENOTFOUND|EAI_AGAIN|getaddrinfo|Temporary failure in name resolution|Could not resolve host|dial tcp|Network is unreachable|failed to lookup address/],
  ["lockfile_drift", /ERR_PNPM_OUTDATED_LOCKFILE|YN0028|lockfile needs to be updated|lock file.*out of date|npm ci. can only install packages when|not in sync|is not up to date with/],
  ["pm_version", /ERR_PNPM_BAD_PM_VERSION|This project is configured to use|Usage Error: This project/],
  ["node_engine", /EBADENGINE|The engine "node" is incompatible|Unsupported engine|ERR_PNPM_UNSUPPORTED_ENGINE/],
  ["go_toolchain", /go\.mod requires go|requires go >=|toolchain not available/],
  ["python_version", /requires a different Python|Requires-Python|Python version .* not supported/],
  ["dep_resolve", /No matching distribution|Could not find a version|ResolutionImpossible|failed to select a version|No matching version found|ETARGET|Could not resolve dependencies/],
  ["native_build", /node-gyp|gyp ERR|Failed building wheel|error: command 'gcc'/],
  ["service_needed", /:5432|:3306|:6379|:27017|could not connect to server|ECONNREFUSED|Connection refused/],
  ["browser_needed", /browserType\.launch|Failed to launch the browser|Executable doesn't exist.*(chrom|playwright)/],
  ["ts_error", /error TS\d{4}/],
  ["compile_error", /could not compile|\[build failed\]|\[setup failed\]|undefined: |compilation failed|error\[E\d{4}\]|SyntaxError|Parse error/],
  ["module_missing", /Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|Failed to resolve import|Cannot find package|cannot find package/],
  ["collection_error", /ERROR collecting|errors during collection|Test suite failed to run|Failed to load|No test files found|No tests found|no tests to run|collected 0 items|no test files/],
  ["tool_missing", /command not found|: not found|No such file or directory/],
  ["config_error", /Unknown option|Unrecognized|unknown flag|invalid option|Validation Error|Unknown argument/],
];

export function classifyLog(text: string): string {
  if (!text.trim()) return "empty_log";
  return FAIL_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? "other";
}
