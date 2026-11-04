// Copyright (c) 2026 Garry Tan. MIT License.
// Runs the pinned mutation tool for one tree (outcome-per-skill plan v3, sections 3 and 10). The tree is a patch against
// a project image that holds the repository at its starting tree with its dependencies installed, as the verifier's task
// image does. A scorer image adds the tool to that image, offline. A prepare container (root, no network) copies the
// repository into a fresh volume and applies the patch; every later step runs as a non-root user with no network, no
// capabilities and a read-only root. The steps: find the tests the patch added or changed, run them on the tree and drop
// the failures, list the tool's mutants within its restriction, sample at most SAMPLE_CAP with the frozen seed, run them
// against the passing tests, and score. With a gold patch the same tests run on gold's tree against gold's mutants.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { docker, dockerRun, type DockerResult } from "../../real-outcome/task/docker.ts";
import { REPO_DIR } from "../../real-outcome/task/format.ts";
import { classify, parsePatch, sourceRanges, touched, type FileChange } from "./diff.ts";
import { SAMPLE_CAP, SAMPLE_SEED, TOOLS, type Lang } from "./pins.ts";
import { reading, record, sample, type MutationRecord, type Outcome, type Reading } from "./score.ts";
import { changedUnits, goUnits, pythonFunctions, pythonModule, pythonUnits, rustUnits, tsUnits, type Unit } from "./units.ts";

export class MutationError extends Error {
  constructor(
    readonly code: "E_MUTATION_DOCKER" | "E_MUTATION_INPUT",
    message: string,
  ) {
    super(message);
  }
}

export const RUN_UID = "10001:10001";
const HERE = import.meta.dir;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const DEPS = [".venv", "venv", "node_modules", ".tox", "__pypackages__"];
const SUB: Record<Lang, string> = { rust: "rust", typescript: "node", python: "python", go: "go" };

const imageExists = (ref: string) => docker(["image", "inspect", "-f", "{{.Id}}", ref]).status === 0;
const imageId = (ref: string) => docker(["image", "inspect", "-f", "{{.Id}}", ref]).stdout.trim();

/** The tool image for a language, tagged by the bytes it is built from, built if missing (this needs the network). */
export function toolImage(lang: Lang): string {
  const file = join(HERE, TOOLS[lang].dockerfile);
  const text = readFileSync(file, "utf8");
  const copied = [...text.matchAll(/^COPY\s+(?!--from)(\S+)\s/gm)].map((m) => readFileSync(join(HERE, "images", m[1]!)));
  const tag = "gstack-mutation-tool-" + lang + ":" + sha(Buffer.concat([Buffer.from(text), ...copied])).slice(0, 12);
  if (imageExists(tag)) return tag;
  const b = docker(["build", "-q", "-t", tag, "-f", file, join(HERE, "images")], { timeoutMs: 3600000 });
  if (b.status !== 0) throw new MutationError("E_MUTATION_DOCKER", "building " + tag + " failed: " + b.stderr.trim().slice(-800));
  return tag;
}

/** The project image plus the language's tool, built with no network. Python installs mutmut's wheels into a folder of
 * their own; TypeScript links the project's vitest into Stryker's folder, so the runner uses the project's version. */
export function scorerImage(project: string, lang: Lang, repoDir: string = REPO_DIR, python = "python"): string {
  if (!imageExists(project)) throw new MutationError("E_MUTATION_INPUT", "project image " + project + " is not on this host");
  const tool = toolImage(lang);
  const sub = SUB[lang];
  const lines = ["FROM " + project, "COPY --from=" + tool + " /opt/gstack-mutation/" + sub + " /opt/gstack-mutation/" + sub];
  if (lang === "python") lines.push("RUN " + python + " -m pip install --no-index --no-deps --require-hashes --disable-pip-version-check --no-cache-dir --find-links /opt/gstack-mutation/python/wheels --target /opt/gstack-mutation/python/site -r /opt/gstack-mutation/python/requirements.txt");
  if (lang === "typescript") lines.push("RUN ln -sfn " + repoDir + "/node_modules/vitest /opt/gstack-mutation/node/node_modules/vitest");
  const dockerfile = lines.join("\n") + "\n";
  const tag = "gstack-mutation-scorer-" + lang + ":" + sha(imageId(project) + imageId(tool) + dockerfile).slice(0, 12);
  if (imageExists(tag)) return tag;
  const b = docker(["build", "--network", "none", "-q", "-t", tag, "-"], { input: dockerfile, timeoutMs: 1800000 });
  if (b.status !== 0) throw new MutationError("E_MUTATION_DOCKER", "building the scorer image on " + project + " failed: " + b.stderr.trim().slice(-800));
  return tag;
}

export interface ScoreOptions {
  lang: Lang;
  /** The project image: the repository at repoDir at its starting tree, dependencies installed, git and sh present. */
  image: string;
  /** The agent's tree, as a git patch against the image's tree. */
  patch: string;
  /** The gold change as a git patch against the same tree; when given, the transplant reading runs. */
  gold?: string;
  /** Host scratch folder; each call writes under work/label. */
  work: string;
  label?: string;
  repoDir?: string;
  /** The project's Python interpreter. */
  python?: string;
  cap?: number;
  seed?: string;
  cpus?: number;
  memory?: string;
  /** Wall limit for each container step. A step past it makes the tree a tool error. */
  stepMs?: number;
}

interface Tree {
  volume: string;
  out: string;
  changes: FileChange[];
  files: Map<string, string>;
  list: Set<string>;
}

interface Opts {
  lang: Lang;
  repoDir: string;
  python: string;
  cpus: number;
  memory: string;
  stepMs: number;
}

interface Ctx {
  o: Opts;
  tree: Tree;
  run: (script: string, env?: Record<string, string>) => DockerResult;
}

interface Adapter {
  /** The test units the patch added or changed. */
  units(ctx: Ctx): Unit[];
  /** The units that pass on the tree; an error when the runner could not run at all. */
  baseline(ctx: Ctx, units: Unit[]): { passing: Unit[]; error?: string };
  /** The ids of the mutants within the tool's restriction of the scope patch. */
  mutants(ctx: Ctx, scopePatch: string): { ids: string[]; error?: string };
  /** The outcome of each sampled mutant against the passing units. */
  run(ctx: Ctx, scopePatch: string, sampled: string[], tests: Unit[]): { outcomes: Map<string, Outcome>; error?: string };
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const tail = (r: DockerResult) => (r.timed_out ? "timed out" : "exit " + r.status) + ": " + (r.stderr || r.stdout).trim().slice(-600);

/** Copies the repository into a fresh volume, applies the patch and any overlay files, and reads back the changed files
 * and the tree's file list. Returns null for a patch that does not apply. */
function prepare(repoDir: string, image: string, dir: string, patch: string, overlay: Map<string, string>): Tree | null {
  rmSync(dir, { recursive: true, force: true });
  for (const d of ["input/overlay", "status", "out"]) mkdirSync(join(dir, d), { recursive: true });
  chmodSync(join(dir, "status"), 0o777);
  chmodSync(join(dir, "out"), 0o777);
  const changes = parsePatch(patch);
  writeFileSync(join(dir, "input/tree.patch"), patch);
  for (const [p, text] of overlay) {
    mkdirSync(join(dir, "input/overlay", posix.dirname(p)), { recursive: true });
    writeFileSync(join(dir, "input/overlay", p), text);
  }
  const want = [...new Set([...changes.map((c) => c.newPath).filter((p): p is string => !!p), ...overlay.keys()])];
  writeFileSync(join(dir, "input/want.txt"), want.join("\n") + "\n");
  const volume = "gstack-mutation-" + randomBytes(6).toString("hex");
  if (docker(["volume", "create", volume]).status !== 0) throw new MutationError("E_MUTATION_DOCKER", "docker volume create failed");
  const excludes = DEPS.flatMap((d) => ["--exclude=" + d, "--exclude=" + d + "/*", "--exclude=*/" + d, "--exclude=*/" + d + "/*"]).join(" ");
  const script = [
    "set -eu",
    'cp -a "$SRC/." /work/',
    "cd /work",
    "if [ -s /input/tree.patch ]; then git -c core.hooksPath=/dev/null -c core.fsmonitor=false apply --whitespace=nowarn " + excludes + " /input/tree.patch 2>/status/apply.err || { echo patch=failed > /status/prepare.txt; exit 0; }; fi",
    "cp -a /input/overlay/. /work/",
    'while IFS= read -r p; do if [ -n "$p" ] && [ -f "$p" ] && [ ! -L "$p" ]; then mkdir -p "/status/files/$(dirname "$p")" && cp "$p" "/status/files/$p"; fi; done < /input/want.txt',
    "find . \\( -name .git -o -name node_modules -o -name target -o -name .venv -o -name __pycache__ \\) -prune -o -type f -print | sed 's|^\\./||' > /status/list.txt",
    "chown -R " + RUN_UID + " /work",
    "echo done > /status/prepare.txt",
  ].join("\n");
  const r = dockerRun("gstack-mutation-prepare-" + randomBytes(6).toString("hex"), ["--rm", "--network", "none", "--user", "0:0", "-e", "SRC=" + repoDir, "-v", volume + ":/work", "-v", join(dir, "input") + ":/input:ro", "-v", join(dir, "status") + ":/status", "--entrypoint", "sh", image, "-c", script], { timeoutMs: 900000 });
  const state = read(join(dir, "status/prepare.txt")).trim();
  if (state === "patch=failed" || r.status !== 0 || state !== "done") docker(["volume", "rm", "-f", volume]);
  if (state === "patch=failed") return null;
  if (r.status !== 0 || state !== "done") throw new MutationError("E_MUTATION_DOCKER", "prepare failed (" + tail(r) + ")");
  const files = new Map<string, string>();
  for (const p of want) if (existsSync(join(dir, "status/files", p))) files.set(p, readFileSync(join(dir, "status/files", p), "utf8"));
  const list = new Set(read(join(dir, "status/list.txt")).split("\n").filter(Boolean));
  return { volume, out: join(dir, "out"), changes, files, list };
}

function context(o: Opts, image: string, tree: Tree, env: Record<string, string>): Ctx {
  return {
    o,
    tree,
    run: (script, more = {}) => {
      const e = Object.entries({ ...env, ...more }).flatMap(([k, v]) => ["-e", k + "=" + v]);
      return dockerRun(
        "gstack-mutation-run-" + randomBytes(6).toString("hex"),
        ["--rm", "--network", "none", "--user", RUN_UID, "--read-only", "--tmpfs", "/tmp:rw,exec,size=4g", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--cpus", String(o.cpus), "--memory", o.memory, "--pids-limit", "4096", "-e", "HOME=/tmp", ...e, "-v", tree.volume + ":" + o.repoDir, "-v", tree.out + ":/out", "--workdir", o.repoDir, "--entrypoint", "sh", image, "-c", script],
        { timeoutMs: o.stepMs },
      );
    },
  };
}

const testFiles = (ctx: Ctx, kinds: string[]) => ctx.tree.changes.filter((c) => c.newPath && !c.binary && ctx.tree.files.has(c.newPath) && kinds.includes(classify(ctx.o.lang, c.newPath)));
const reEscape = (s: string) => s.replace(/[.*+?^$()|[\]\\{}\/]/g, "\\$&");

// ---------- Python: mutmut, function level ----------

const MUTMUT = "\"$PY\" -c \"import sys; sys.path.append('/opt/gstack-mutation/python/site'); sys.argv=['mutmut']+sys.argv[1:]; from mutmut.__main__ import cli; cli()\"";
const META = "\"$PY\" -c \"import json,pathlib; json.dump({k:v for m in pathlib.Path('mutants').rglob('*.meta') for k,v in json.loads(m.read_text()).get('exit_code_by_key',{}).items()}, open('/out/py-meta.json','w'))\"";

const PY_WRITE_CONFIG = [
  "import json, pathlib, re, configparser",
  "cfg = json.load(open('/out/py-config.json'))",
  "p = pathlib.Path('pyproject.toml')",
  "text = p.read_text() if p.exists() else ''",
  "if re.search(r'(?m)^\\[tool\\.mutmut\\]', text):",
  "    text = re.sub(r'(?ms)^\\[tool\\.mutmut\\].*?(?=^\\[|\\Z)', '', text)",
  "    tv = lambda v: 'true' if v is True else 'false' if v is False else json.dumps(v)",
  "    p.write_text(text.rstrip() + '\\n\\n[tool.mutmut]\\n' + ''.join(k + ' = ' + tv(v) + '\\n' for k, v in cfg.items()))",
  "else:",
  "    c = configparser.ConfigParser(interpolation=None)",
  "    c.read('setup.cfg')",
  "    if c.has_section('mutmut'):",
  "        c.remove_section('mutmut')",
  "    c.add_section('mutmut')",
  "    for k, v in cfg.items():",
  "        c.set('mutmut', k, '\\n' + '\\n'.join(v) if isinstance(v, list) else str(v).lower())",
  "    with open('setup.cfg', 'w') as f:",
  "        c.write(f)",
  "",
].join("\n");

function pyConfig(ctx: Ctx, scopePatch: string, tests: Unit[]): string {
  const roots = new Set<string>();
  for (const f of sourceRanges("python", parsePatch(scopePatch)).keys()) {
    let dir = posix.dirname(f);
    if (!ctx.tree.list.has(posix.join(dir, "__init__.py"))) {
      roots.add(f);
      continue;
    }
    while (posix.dirname(dir) !== "." && ctx.tree.list.has(posix.join(posix.dirname(dir), "__init__.py"))) dir = posix.dirname(dir);
    roots.add(dir);
  }
  const copies = new Set(tests.map((u) => u.file.split("/")[0]!).filter((p) => !p.endsWith(".py")));
  for (const f of ["conftest.py", "pytest.ini", "tox.ini"]) if (ctx.tree.list.has(f)) copies.add(f);
  return JSON.stringify({ source_paths: [...roots].sort(), pytest_add_cli_args_test_selection: tests.map((u) => u.name), pytest_add_cli_args: ["-p", "no:cacheprovider"], also_copy: [...copies].sort(), use_git_change_detection: false });
}

function junitCases(xml: string): { classname: string; name: string; ok: boolean }[] {
  const attr = (a: string, n: string) => (new RegExp("\\b" + n + '="([^"]*)"').exec(a)?.[1] ?? "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => ({ classname: attr(m[1]!, "classname"), name: attr(m[1]!, "name"), ok: m[2] === "/>" || !/<(failure|error|skipped)\b/.test(m[3] ?? "") }));
}

const python: Adapter = {
  units: (ctx) => testFiles(ctx, ["test"]).flatMap((c) => changedUnits(pythonUnits(c.newPath!, ctx.tree.files.get(c.newPath!)!), touched(c))),
  baseline(ctx, units) {
    const r = ctx.run('"$PY" -m pytest -p no:cacheprovider -q --junitxml=/out/py-baseline.xml ' + units.map((u) => q(u.name)).join(" ") + " > /out/py-baseline.log 2>&1; echo $? > /out/py-baseline.exit");
    if (r.status !== 0 || !existsSync(join(ctx.tree.out, "py-baseline.exit"))) return { passing: [], error: "pytest did not run (" + tail(r) + ")" };
    const cases = junitCases(read(join(ctx.tree.out, "py-baseline.xml")));
    return {
      passing: units.filter((u) => {
        const [file, ...rest] = u.name.split("::");
        const cls = [file!.replace(/\.py$/, "").split("/").join("."), ...rest.slice(0, -1)].join(".");
        const mine = cases.filter((c) => c.classname === cls && c.name.split("[")[0] === rest[rest.length - 1]);
        return mine.length > 0 && mine.every((c) => c.ok);
      }),
    };
  },
  mutants(ctx, scopePatch) {
    const scope = new Set<string>();
    for (const [f, ranges] of sourceRanges("python", parsePatch(scopePatch))) {
      const text = ctx.tree.files.get(f);
      if (text === undefined) continue;
      const mod = pythonModule(f);
      for (const fn of pythonFunctions(text)) if (ranges.some(([s, e]) => s <= fn.end && e >= fn.start)) scope.add((mod ? mod + "." : "") + fn.mangled);
    }
    if (scope.size === 0) return { ids: [] };
    writeFileSync(join(ctx.tree.out, "py-config.json"), pyConfig(ctx, scopePatch, []));
    writeFileSync(join(ctx.tree.out, "py-write-config.py"), PY_WRITE_CONFIG);
    const r = ctx.run('"$PY" /out/py-write-config.py && ' + MUTMUT + " run --max-children 2 'gstack_mutation_list_only*' > /out/py-list.log 2>&1; " + META);
    if (r.status !== 0 || !existsSync(join(ctx.tree.out, "py-meta.json"))) return { ids: [], error: "mutmut could not generate mutants (" + tail(r) + "): " + read(join(ctx.tree.out, "py-list.log")).slice(-600) };
    const keys = Object.keys(JSON.parse(read(join(ctx.tree.out, "py-meta.json"))) as Record<string, unknown>);
    return { ids: keys.filter((k) => scope.has(k.split("__mutmut_")[0]!)) };
  },
  run(ctx, scopePatch, sampled, tests) {
    writeFileSync(join(ctx.tree.out, "py-config.json"), pyConfig(ctx, scopePatch, tests));
    rmSync(join(ctx.tree.out, "py-meta.json"), { force: true });
    const r = ctx.run('rm -rf mutants && "$PY" /out/py-write-config.py && ' + MUTMUT + " run --max-children 2 " + sampled.map(q).join(" ") + " > /out/py-run.log 2>&1; echo $? > /out/py-run.exit; " + META);
    if (r.status !== 0 || !existsSync(join(ctx.tree.out, "py-meta.json"))) return { outcomes: new Map(), error: "mutmut did not run (" + tail(r) + ")" };
    const exit = read(join(ctx.tree.out, "py-run.exit")).trim();
    if (exit !== "0") return { outcomes: new Map(), error: "mutmut exited " + exit + ": " + read(join(ctx.tree.out, "py-run.log")).slice(-600) };
    const meta = JSON.parse(read(join(ctx.tree.out, "py-meta.json"))) as Record<string, number | null>;
    const outcomes = new Map<string, Outcome>();
    for (const id of sampled) {
      const code = meta[id];
      if (code === undefined || code === null) continue;
      outcomes.set(id, code === 1 || code === 3 ? "killed" : code === 0 || code === 5 || code === 33 ? "survived" : [36, 24, -24, 152, 255].includes(code) ? "timeout" : "error");
    }
    return { outcomes };
  },
};

// ---------- Go: go-mutesting, file level ----------

const GM_EXEC = [
  "#!/bin/sh",
  'id="$MUTATE_ORIGINAL:$(sha256sum "$MUTATE_CHANGED" | cut -c1-16)"',
  "if [ \"$GM_MODE\" = list ]; then printf '%s\\n' \"$id\" >> /out/gm-list.txt; exit 2; fi",
  'grep -qxF "$id" /out/gm-sample.txt || exit 2',
  'cp "$MUTATE_ORIGINAL" /tmp/gm-orig.go && cp "$MUTATE_CHANGED" "$MUTATE_ORIGINAL"',
  "outcome=survived",
  "while IFS=$(printf '\\t') read -r pkg regex; do",
  '  [ -n "$pkg" ] || continue',
  '  timeout -k 5 "$GM_TIMEOUT" go test -count=1 -vet=off -json -run "$regex" "./$pkg" > /tmp/gm-out.json 2> /tmp/gm-err.txt',
  "  rc=$?",
  '  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then outcome=timeout; break; fi',
  "  if grep -q '\"Action\":\"build-fail\"' /tmp/gm-out.json || grep -q '\\[build failed\\]\\|\\[setup failed\\]' /tmp/gm-out.json /tmp/gm-err.txt; then outcome=error; break; fi",
  '  if [ "$rc" -ne 0 ]; then outcome=killed; break; fi',
  "done < /out/gm-tests.txt",
  'cp /tmp/gm-orig.go "$MUTATE_ORIGINAL"',
  "printf '%s\\t%s\\n' \"$id\" \"$outcome\" >> /out/gm-outcomes.txt",
  'case "$outcome" in killed) exit 0 ;; survived) exit 1 ;; *) exit 2 ;; esac',
  "",
].join("\n");

function goEvents(text: string): { Action?: string; Test?: string }[] {
  return text.split("\n").flatMap((l) => {
    try {
      return l.startsWith("{") ? [JSON.parse(l) as { Action?: string; Test?: string }] : [];
    } catch {
      return [];
    }
  });
}

function goByPkg(units: Unit[]): Map<string, Unit[]> {
  const m = new Map<string, Unit[]>();
  for (const u of units) m.set(u.scope, [...(m.get(u.scope) ?? []), u]);
  return m;
}
const goRegex = (us: Unit[]) => "^(" + [...new Set(us.map((u) => u.name))].join("|") + ")$";
const GM = "/opt/gstack-mutation/go/bin/go-mutesting";
const goFiles = (ctx: Ctx, scopePatch: string) => [...sourceRanges("go", parsePatch(scopePatch)).keys()].filter((f) => ctx.tree.list.has(f));

const go: Adapter = {
  units: (ctx) => testFiles(ctx, ["test"]).flatMap((c) => changedUnits(goUnits(c.newPath!, ctx.tree.files.get(c.newPath!)!), touched(c))),
  baseline(ctx, units) {
    const pkgs = [...goByPkg(units)];
    const script = pkgs.map(([pkg, us], i) => "go test -count=1 -vet=off -json -run " + q(goRegex(us)) + " " + q("./" + pkg) + " > /out/go-base-" + i + ".jsonl 2> /out/go-base-" + i + ".err").join("; ") + "; echo ok > /out/go-base.done";
    const r = ctx.run(script);
    if (r.status !== 0 || !existsSync(join(ctx.tree.out, "go-base.done"))) return { passing: [], error: "go test did not run (" + tail(r) + ")" };
    const passing: Unit[] = [];
    pkgs.forEach(([, us], i) => {
      const ev = goEvents(read(join(ctx.tree.out, "go-base-" + i + ".jsonl")));
      for (const u of us) if (ev.some((e) => e.Action === "pass" && e.Test === u.name) && !ev.some((e) => e.Action === "fail" && e.Test === u.name)) passing.push(u);
    });
    return { passing };
  },
  mutants(ctx, scopePatch) {
    const files = goFiles(ctx, scopePatch);
    if (files.length === 0) return { ids: [] };
    writeFileSync(join(ctx.tree.out, "gm-exec.sh"), GM_EXEC);
    rmSync(join(ctx.tree.out, "gm-list.txt"), { force: true });
    const r = ctx.run(GM + ' --exec "sh /out/gm-exec.sh" ' + files.map((f) => q("./" + f)).join(" ") + " > /out/gm-list.log 2>&1; touch /out/gm-list.txt", { GM_MODE: "list" });
    const log = read(join(ctx.tree.out, "gm-list.log"));
    if (r.status !== 0 || /INTERNAL ERROR|panic:/.test(log)) return { ids: [], error: "go-mutesting could not list mutants (" + tail(r) + "): " + log.slice(-600) };
    return { ids: [...new Set(read(join(ctx.tree.out, "gm-list.txt")).split("\n").filter(Boolean))] };
  },
  run(ctx, scopePatch, sampled, tests) {
    writeFileSync(join(ctx.tree.out, "gm-exec.sh"), GM_EXEC);
    writeFileSync(join(ctx.tree.out, "gm-sample.txt"), sampled.join("\n") + "\n");
    writeFileSync(join(ctx.tree.out, "gm-tests.txt"), [...goByPkg(tests)].map(([pkg, us]) => pkg + "\t" + goRegex(us)).join("\n") + "\n");
    rmSync(join(ctx.tree.out, "gm-outcomes.txt"), { force: true });
    const r = ctx.run(GM + ' --exec "sh /out/gm-exec.sh" ' + goFiles(ctx, scopePatch).map((f) => q("./" + f)).join(" ") + " > /out/gm-run.log 2>&1; touch /out/gm-outcomes.txt", { GM_MODE: "run", GM_TIMEOUT: "120" });
    const log = read(join(ctx.tree.out, "gm-run.log"));
    if (r.status !== 0) return { outcomes: new Map(), error: "go-mutesting did not run (" + tail(r) + ")" };
    const outcomes = new Map<string, Outcome>();
    for (const l of read(join(ctx.tree.out, "gm-outcomes.txt")).split("\n").filter(Boolean)) {
      const [id, outcome] = l.split("\t");
      outcomes.set(id!, outcome as Outcome);
    }
    const score = /The mutation score is [\d.]+ \((\d+) passed, (\d+) failed, \d+ duplicated, \d+ skipped, total is \d+\)/.exec(log);
    const count = (x: Outcome) => [...outcomes.values()].filter((v) => v === x).length;
    if (!score) return { outcomes, error: "go-mutesting printed no score line: " + log.slice(-600) };
    if (Number(score[1]) !== count("killed") || Number(score[2]) !== count("survived")) return { outcomes, error: "go-mutesting's score line (" + score[1] + " passed, " + score[2] + " failed) disagrees with the recorded outcomes (" + count("killed") + " killed, " + count("survived") + " survived)" };
    return { outcomes };
  },
};

// ---------- Rust: cargo-mutants, line level ----------

const CARGO_ENV = 'ORIG_CARGO_HOME="$CARGO_HOME"; [ -n "$ORIG_CARGO_HOME" ] || ORIG_CARGO_HOME=/usr/local/cargo; export CARGO_HOME=/tmp/cargo-home CARGO_TARGET_DIR=/tmp/target CARGO_NET_OFFLINE=true CARGO_TERM_COLOR=never; mkdir -p "$CARGO_HOME"; for d in registry git config.toml config; do if [ -e "$ORIG_CARGO_HOME/$d" ]; then cp -a "$ORIG_CARGO_HOME/$d" "$CARGO_HOME/"; fi; done; export PATH="$PATH:$ORIG_CARGO_HOME/bin"; ';
const CM = "/opt/gstack-mutation/rust/bin/cargo-mutants mutants";

function crateRoot(list: Set<string>, file: string): string {
  let dir = posix.dirname(file);
  while (dir !== "." && !list.has(posix.join(dir, "Cargo.toml"))) dir = posix.dirname(dir);
  return dir;
}

/** libtest's per-test lines, keyed by test target ("unit" or the integration test's name) and test path. */
export function rustResults(log: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  let target = "unit";
  for (const line of log.split("\n")) {
    const run = /^\s*Running (?:unittests )?(\S+)/.exec(line);
    if (run) {
      const m = /(?:^|\/)tests\/([^/]+?)(?:\.rs|\/main\.rs)$/.exec(run[1]!);
      target = m ? m[1]! : "unit";
      continue;
    }
    const t = /^test (\S+) \.\.\. (ok|FAILED|ignored)/.exec(line);
    if (t) out.set(target + "\t" + t[1], (out.get(target + "\t" + t[1]) ?? true) && t[2] === "ok");
  }
  return out;
}

const exactArgs = (units: Unit[]) => "-- --exact " + [...new Set(units.map((u) => u.name))].map(q).join(" ");

const rust: Adapter = {
  units: (ctx) =>
    testFiles(ctx, ["test", "source"]).flatMap((c) => {
      const root = crateRoot(ctx.tree.list, c.newPath!);
      return changedUnits(rustUnits(c.newPath!, root === "." ? c.newPath! : posix.relative(root, c.newPath!), ctx.tree.files.get(c.newPath!)!), touched(c));
    }),
  baseline(ctx, units) {
    if (!ctx.tree.list.has("Cargo.toml")) return { passing: [], error: "no Cargo.toml at the repository root" };
    const r = ctx.run(CARGO_ENV + "cargo test --no-fail-fast --workspace --tests " + exactArgs(units) + " > /out/rs-base.log 2>&1; echo $? > /out/rs-base.exit");
    if (r.status !== 0 || !existsSync(join(ctx.tree.out, "rs-base.exit"))) return { passing: [], error: "cargo test did not run (" + tail(r) + ")" };
    const res = rustResults(read(join(ctx.tree.out, "rs-base.log")));
    return { passing: units.filter((u) => res.get(u.scope + "\t" + u.name) === true) };
  },
  mutants(ctx, scopePatch) {
    writeFileSync(join(ctx.tree.out, "scope.patch"), scopePatch);
    const r = ctx.run(CARGO_ENV + CM + " --list --in-diff /out/scope.patch > /out/cm-list.txt 2> /out/cm-list.err; echo $? > /out/cm-list.exit");
    const exit = read(join(ctx.tree.out, "cm-list.exit")).trim();
    if (r.status !== 0 || exit !== "0") return { ids: [], error: "cargo-mutants could not list mutants (exit " + (exit || r.status) + "): " + read(join(ctx.tree.out, "cm-list.err")).slice(-600) };
    return { ids: [...new Set(read(join(ctx.tree.out, "cm-list.txt")).split("\n").filter(Boolean))] };
  },
  run(ctx, scopePatch, sampled, tests) {
    writeFileSync(join(ctx.tree.out, "scope.patch"), scopePatch);
    writeFileSync(join(ctx.tree.out, "cm-re.txt"), "^(?:" + sampled.map(reEscape).join("|") + ")$");
    const r = ctx.run(CARGO_ENV + CM + ' --in-diff /out/scope.patch --no-shuffle --jobs 2 --minimum-test-timeout 30 --output /tmp/cm -F "$(cat /out/cm-re.txt)" -- --tests ' + exactArgs(tests) + " > /out/cm-run.log 2>&1; echo $? > /out/cm-run.exit; mkdir -p /out/cm; cp /tmp/cm/mutants.out/*.txt /out/cm/ 2>/dev/null; true");
    const exit = read(join(ctx.tree.out, "cm-run.exit")).trim();
    if (r.status !== 0 || !["0", "2", "3"].includes(exit)) return { outcomes: new Map(), error: "cargo-mutants exited " + (exit || r.status) + ": " + read(join(ctx.tree.out, "cm-run.log")).slice(-600) };
    const outcomes = new Map<string, Outcome>();
    const want = new Set(sampled);
    for (const [file, outcome] of [["caught.txt", "killed"], ["missed.txt", "survived"], ["timeout.txt", "timeout"], ["unviable.txt", "error"]] as const)
      for (const id of read(join(ctx.tree.out, "cm", file)).split("\n")) if (want.has(id)) outcomes.set(id, outcome);
    return { outcomes };
  },
};

// ---------- TypeScript: StrykerJS with vitest, line level ----------

const STRYKER = 'command -v ps >/dev/null || export PATH="/opt/gstack-mutation/node/bin:$PATH"; node /opt/gstack-mutation/node/node_modules/@stryker-mutator/core/bin/stryker.js run';
const STRYKER_PREP_FAILED = 3;
const VITEST_CONFIGS = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];

interface StrykerMutant {
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}

/** Stryker's mutants keyed by file, exact location, mutator and replacement, which stay the same from run to run. */
export function strykerMutants(report: string): Map<string, StrykerMutant> {
  const out = new Map<string, StrykerMutant>();
  const files = (JSON.parse(report) as { files: Record<string, { mutants: StrykerMutant[] }> }).files;
  for (const [file, f] of Object.entries(files)) for (const m of f.mutants) out.set(file + "@" + m.location.start.line + ":" + m.location.start.column + "-" + m.location.end.line + ":" + m.location.end.column + "#" + m.mutatorName + "=" + (m.replacement ?? ""), m);
  return out;
}

/** The test file with every test() and it() call outside keep turned into .skip, so Stryker runs only the kept tests:
 * its vitest runner clears any name filter for the dry run. */
export function skipOthers(file: string, text: string, keep: Set<number>): string {
  const lines = text.split("\n");
  const others = tsUnits(file, text)
    .filter((u) => !keep.has(u.start))
    .map((u) => ({ line: u.start, col: Number(u.name.split(":").pop()) - 1 }))
    .sort((a, b) => b.line - a.line || b.col - a.col);
  for (const { line, col } of others) {
    const s = lines[line - 1]!;
    const id = /^(?:it|test)/.exec(s.slice(col))![0];
    lines[line - 1] = s.slice(0, col + id.length) + ".skip" + s.slice(col + id.length);
  }
  return lines.join("\n");
}

const typescript: Adapter = {
  units: (ctx) => testFiles(ctx, ["test"]).flatMap((c) => changedUnits(tsUnits(c.newPath!, ctx.tree.files.get(c.newPath!)!), touched(c))),
  baseline(ctx, units) {
    const files = [...new Set(units.map((u) => u.file))];
    const r = ctx.run("node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=/out/vt-base.json --includeTaskLocation " + files.map(q).join(" ") + " > /out/vt-base.log 2>&1; echo $? > /out/vt-base.exit");
    if (r.status !== 0 || !existsSync(join(ctx.tree.out, "vt-base.exit"))) return { passing: [], error: "vitest did not run (" + tail(r) + ")" };
    const results = existsSync(join(ctx.tree.out, "vt-base.json")) ? (JSON.parse(read(join(ctx.tree.out, "vt-base.json"))) as { testResults: { name: string; assertionResults: { status: string; location?: { line: number } }[] }[] }).testResults : [];
    const byLine = new Map<string, string[]>();
    for (const t of results) {
      const file = posix.relative(ctx.o.repoDir, t.name);
      for (const a of t.assertionResults) if (a.location) byLine.set(file + ":" + a.location.line, [...(byLine.get(file + ":" + a.location.line) ?? []), a.status]);
    }
    return { passing: units.filter((u) => (byLine.get(u.file + ":" + u.start) ?? []).length > 0 && byLine.get(u.file + ":" + u.start)!.every((s) => s === "passed")) };
  },
  mutants(ctx, scopePatch) {
    const mutate = [...sourceRanges("typescript", parsePatch(scopePatch))].filter(([f]) => ctx.tree.list.has(f)).flatMap(([f, rs]) => rs.map(([s, e]) => f + ":" + s + "-" + e));
    if (mutate.length === 0) return { ids: [] };
    writeFileSync(join(ctx.tree.out, "st-list.json"), JSON.stringify({ testRunner: "command", commandRunner: { command: "true" }, coverageAnalysis: "off", mutate, reporters: ["json"], jsonReporter: { fileName: "/out/st-list-report.json" }, tempDirName: "/tmp/stryker-tmp", concurrency: 2, plugins: [], logLevel: "warn", allowEmpty: true }));
    const r = ctx.run(STRYKER + " /out/st-list.json > /out/st-list.log 2>&1; echo $? > /out/st-list.exit");
    const exit = read(join(ctx.tree.out, "st-list.exit")).trim();
    if (r.status !== 0 || exit !== "0" || !existsSync(join(ctx.tree.out, "st-list-report.json"))) return { ids: [], error: "Stryker could not list mutants (exit " + (exit || r.status) + "): " + read(join(ctx.tree.out, "st-list.log")).slice(-600) };
    return { ids: [...strykerMutants(read(join(ctx.tree.out, "st-list-report.json"))).keys()] };
  },
  run(ctx, _scopePatch, sampled, tests) {
    const files = [...new Set(tests.map((u) => u.file))];
    files.forEach((f, i) => writeFileSync(join(ctx.tree.out, "kept-" + i + ".txt"), skipOthers(f, ctx.tree.files.get(f)!, new Set(tests.filter((u) => u.file === f).map((u) => u.start)))));
    const base = VITEST_CONFIGS.find((f) => ctx.tree.list.has(f));
    const include = JSON.stringify(files);
    writeFileSync(
      join(ctx.tree.out, "vitest.config.mts"),
      base
        ? "import base from './" + base + "';\nconst c: any = typeof base === 'function' ? await (base as any)({ command: 'serve', mode: 'test' }) : await base;\nexport default { ...c, test: { ...(c.test ?? {}), include: " + include + " } };\n"
        : "export default { test: { include: " + include + " } };\n",
    );
    const mutate = [...new Set(sampled.map((id) => /^(.*)@(\d+):(\d+)-(\d+):(\d+)#/.exec(id)!).map((m) => m[1] + ":" + m[2] + ":" + (Number(m[3]) - 1) + "-" + m[4] + ":" + (Number(m[5]) - 1)))];
    writeFileSync(join(ctx.tree.out, "st-run.json"), JSON.stringify({ testRunner: "vitest", vitest: { configFile: ".gstack-mutation.vitest.config.mts", related: false }, coverageAnalysis: "perTest", mutate, reporters: ["json"], jsonReporter: { fileName: "/out/st-run-report.json" }, tempDirName: "/tmp/stryker-tmp", concurrency: 2, timeoutMS: 10000, logLevel: "warn", allowEmpty: true }));
    const copies = files.map((f, i) => "cp /out/kept-" + i + ".txt " + q(f) + " && ").join("");
    const r = ctx.run(copies + "cp /out/vitest.config.mts .gstack-mutation.vitest.config.mts || exit " + STRYKER_PREP_FAILED + "; " + STRYKER + " /out/st-run.json > /out/st-run.log 2>&1; echo $? > /out/st-run.exit");
    const exit = read(join(ctx.tree.out, "st-run.exit")).trim();
    if (r.status !== 0 || exit !== "0" || !existsSync(join(ctx.tree.out, "st-run-report.json"))) return { outcomes: new Map(), error: "Stryker exited " + (exit || r.status) + ": " + read(join(ctx.tree.out, "st-run.log")).slice(-600) };
    const got = strykerMutants(read(join(ctx.tree.out, "st-run-report.json")));
    const outcomes = new Map<string, Outcome>();
    for (const id of sampled) {
      const m = got.get(id);
      if (m) outcomes.set(id, m.status === "Killed" ? "killed" : m.status === "Survived" || m.status === "NoCoverage" ? "survived" : m.status === "Timeout" ? "timeout" : "error");
    }
    return { outcomes };
  },
};

const ADAPTERS: Record<Lang, Adapter> = { python, go, rust, typescript };
const ENV: Record<Lang, (o: Opts) => Record<string, string>> = {
  python: (o) => ({ PY: o.python, PYTHONDONTWRITEBYTECODE: "1", PYTHONPYCACHEPREFIX: "/tmp/pycache" }),
  go: () => ({ GOFLAGS: "-mod=readonly", GOPROXY: "off", GOTOOLCHAIN: "local", GOCACHE: "/tmp/gocache", GOTMPDIR: "/tmp", GOSUMDB: "off" }),
  rust: () => ({}),
  typescript: () => ({ npm_config_update_notifier: "false", CI: "1" }),
};

/** One reading: run the units on the tree, drop the failures, list, sample, run, score. */
function readTree(ctx: Ctx, units: Unit[], scopePatch: string, cap: number, seed: string): Reading {
  const a = ADAPTERS[ctx.o.lang];
  if (units.length === 0) return reading({ changed: 0, passing: 0 });
  const base = a.baseline(ctx, units);
  const changed = units.length;
  if (base.error) return reading({ changed, passing: 0, toolError: base.error });
  const passing = base.passing.length;
  if (passing === 0) return reading({ changed, passing: 0 });
  const listed = a.mutants(ctx, scopePatch);
  if (listed.error) return reading({ changed, passing, toolError: listed.error });
  if (listed.ids.length === 0) return reading({ changed, passing, inScope: 0 });
  const chosen = sample(listed.ids, cap, seed);
  const ran = a.run(ctx, scopePatch, chosen, base.passing);
  return reading({ changed, passing, inScope: listed.ids.length, sampled: chosen, outcomes: ran.outcomes, toolError: ran.error });
}

/** Scores one tree, and with a gold patch also runs the transplant reading. Each step's logs stay under work/label, handed
 * back to the caller's user; the volumes are removed. */
export function scoreTree(opts: ScoreOptions): MutationRecord {
  const o: Opts = { lang: opts.lang, repoDir: opts.repoDir ?? REPO_DIR, python: opts.python ?? "python", cpus: opts.cpus ?? 2, memory: opts.memory ?? "4g", stepMs: opts.stepMs ?? 1800000 };
  const cap = opts.cap ?? SAMPLE_CAP;
  const seed = opts.seed ?? SAMPLE_SEED;
  const image = scorerImage(opts.image, o.lang, o.repoDir, o.python);
  const dir = join(opts.work, opts.label ?? "tree-" + randomBytes(4).toString("hex"));
  const env = ENV[o.lang](o);
  const volumes: string[] = [];
  const done = (own: Reading, transplant?: Reading) => record(o.lang, own, transplant, cap, seed);
  try {
    const tree = prepare(o.repoDir, image, join(dir, "own"), opts.patch, new Map());
    if (!tree) return done(reading({ changed: 1, passing: 0, toolError: "the patch does not apply to the image's tree" }));
    volumes.push(tree.volume);
    const ctx = context(o, image, tree, env);
    const units = ADAPTERS[o.lang].units(ctx);
    const own = readTree(ctx, units, opts.patch, cap, seed);
    if (opts.gold === undefined) return done(own);
    if (units.length === 0) return done(own, reading({ changed: 0, passing: 0 }));
    const inline = units.filter((u) => classify(o.lang, u.file) !== "test");
    if (inline.length > 0) return done(own, reading({ changed: units.length, passing: 0, notTransplantable: inline.length + " of the tests sit inside source files" }));
    const overlay = new Map([...new Set(units.map((u) => u.file))].map((f) => [f, tree.files.get(f)!] as const));
    const goldTree = prepare(o.repoDir, image, join(dir, "gold"), opts.gold, overlay);
    if (!goldTree) return done(own, reading({ changed: units.length, passing: 0, toolError: "the gold patch does not apply to the image's tree" }));
    volumes.push(goldTree.volume);
    return done(own, readTree(context(o, image, goldTree, env), units, opts.gold, cap, seed));
  } finally {
    for (const v of volumes) docker(["volume", "rm", "-f", v]);
    if (existsSync(dir)) docker(["run", "--rm", "--network", "none", "--user", "0:0", "-v", dir + ":/d", "--entrypoint", "chown", image, "-R", process.getuid!() + ":" + process.getgid!(), "/d"]);
  }
}
