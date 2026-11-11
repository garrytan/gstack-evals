// Copyright (c) 2026 Garry Tan. MIT License.
// Changed-line coverage, a build-side secondary of the eng-review build read (prereg 2026-11-11-geva-522, sections 6
// and 11): the share of the build's changed product lines that the build's own tests execute, read on the build's own
// tree in the unit's image with no network. go test -coverprofile for Go, pytest-cov for Python, c8 for Node and
// cargo-llvm-cov for Rust. The tools sit in a coverage image layered on the unit's image (built once per unit image with
// the network on, from public packages at pinned versions), so the graded image never changes. A changed line counts
// when the tool can execute it; a changed file the tool never loaded counts its non-blank, non-comment lines as not run.
// A tree the tool gives no data for is unscored. A build with no tests of its own scores 0, and one with no changed
// product line is unscored. Lines inside a Rust file's test region are test code, never product.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../real-outcome/mine/git.ts";
import { docker } from "../real-outcome/task/docker.ts";
import { classifyFile } from "../real-outcome/task/region.ts";
import { cargoSelectors } from "../real-outcome/task/verify.ts";
import { splitBuild, type BuildSplit } from "./catch.ts";
import { readUnit, type EbTask } from "./unit.ts";

export const COVERAGE_TOOLS = {
  pytestCov: "pytest-cov==5.0.0",
  c8: "c8@10.1.3",
  cargoLlvmCov: "https://github.com/taiki-e/cargo-llvm-cov/releases/download/v0.6.16/cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz",
} as const;

export interface CoverageResult {
  scored: boolean;
  /** Covered changed lines over changed lines the tools can execute; null when unscored. */
  share: number | null;
  lines: number;
  covered: number;
  /** Why the tree is unscored, or a note on a scored one (no_own_tests). */
  why: string | null;
  tools: string[];
}

/** Executed counts per line, per repository-relative file. */
export type LineHits = Map<string, Map<number, number>>;

const add = (hits: LineHits, file: string, line: number, n: number) => {
  const m = hits.get(file) ?? new Map<number, number>();
  m.set(line, Math.max(m.get(line) ?? 0, n));
  hits.set(file, m);
};

/** lcov tracefile (pytest-cov, c8, cargo-llvm-cov): SF and DA lines; absolute paths under /testbed become relative,
 * and relative ones are taken from the project dir. */
export function parseLcov(text: string, projdir: string, hits: LineHits = new Map()): LineHits {
  let file: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const p = line.slice(3);
      file = p.startsWith("/testbed/") ? p.slice("/testbed/".length) : p.startsWith("/") ? null : (projdir ? projdir + "/" : "") + p.replace(/^\.\//, "");
    } else if (line.startsWith("DA:") && file) {
      const [n, c] = line.slice(3).split(",");
      add(hits, file, Number(n), Number(c));
    } else if (line === "end_of_record") file = null;
  }
  return hits;
}

/** go test -coverprofile: every line of a block is executable, and run when the block ran. */
export function parseGoCover(text: string, module: string, projdir: string, hits: LineHits = new Map()): LineHits {
  for (const line of text.split("\n")) {
    const m = /^(.+):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/.exec(line.trim());
    if (!m || !m[1].startsWith(module + "/")) continue;
    const file = (projdir ? projdir + "/" : "") + m[1].slice(module.length + 1);
    for (let n = Number(m[2]); n <= Number(m[3]); n++) add(hits, file, n, Number(m[4]));
  }
  return hits;
}

/** The new-side line numbers each product file's hunks add or change, without a Rust test region's lines. */
export function changedLines(split: BuildSplit): Map<string, { lines: number[]; text: string[] }> {
  const out = new Map<string, { lines: number[]; text: string[] }>();
  for (const p of split.product) {
    const diff = git(split.dir, ["diff", "--cached", "-U0", "--no-renames", "HEAD", "--", p.path]);
    const text = git(split.dir, ["show", ":" + p.path]);
    const cls = classifyFile(p.path, text);
    const lineAt = (off: number) => text.slice(0, off).split("\n").length;
    const region = cls.kind === "region" ? [lineAt(cls.start), lineAt(cls.end)] : null;
    const rows = text.split("\n");
    const lines: number[] = [];
    for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const from = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let n = from; n < from + count; n++) if (!region || n < region[0] || n > region[1]) lines.push(n);
    }
    if (lines.length) out.set(p.path, { lines, text: rows });
  }
  return out;
}

const codeLine = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t !== "" && !/^(\/\/|#|\/\*|\*|""")/.test(t) && !/^[{}()[\];,]+$/.test(t);
};

/** The share over changed lines: a line the tool knows counts when executable; a file it never saw counts its code lines. */
export function share(changed: Map<string, { lines: number[]; text: string[] }>, hits: LineHits): { lines: number; covered: number } {
  let lines = 0;
  let covered = 0;
  for (const [file, c] of changed) {
    const h = hits.get(file);
    for (const n of c.lines) {
      if (h ? !h.has(n) : !codeLine(c.text[n - 1])) continue;
      lines++;
      if ((h?.get(n) ?? 0) > 0) covered++;
    }
  }
  return { lines, covered };
}

/** The coverage image for a unit image: the unit image with the tools its runner groups need, built once and reused. */
export function coverageImage(eb: EbTask): string {
  const kinds = new Set(eb.groups.map((g) => g.runner.kind));
  const steps: string[] = [];
  for (const g of eb.groups) if (g.runner.kind === "pytest") steps.push(g.runner.python + " -m pip install --no-cache-dir " + COVERAGE_TOOLS.pytestCov);
  if (["jest", "vitest", "mocha", "nodetest"].some((k) => kinds.has(k as never))) steps.push("npm install -g --no-audit --no-fund --cache /tmp/npm-cov " + COVERAGE_TOOLS.c8 + " && rm -rf /tmp/npm-cov");
  if (kinds.has("cargo")) steps.push("rustup component add llvm-tools-preview && curl -fsSL " + COVERAGE_TOOLS.cargoLlvmCov + " | tar xzf - -C /usr/local/cargo/bin");
  if (steps.length === 0) return eb.image.id;
  const from = eb.image.id;
  const found = docker(["images", "-q", "--no-trunc", "--filter", "label=gstack-evals.eb.cov.from=" + from]).stdout.trim().split("\n").filter(Boolean)[0];
  if (found) return found;
  const ctx = mkdtempSync(join(tmpdir(), "eb-cov-"));
  const base = "eb-cov-base-" + from.replace(/^sha256:/, "").slice(0, 12) + ":" + randomBytes(3).toString("hex");
  try {
    if (docker(["tag", from, base]).status !== 0) throw new Error("the unit image " + from + " is not on this host");
    writeFileSync(join(ctx, "Dockerfile"), "FROM " + base + "\n" + steps.map((s) => "RUN " + s).join("\n") + "\n");
    const tag = "eb-cov-" + eb.unit.id.toLowerCase().replace(/[^a-z0-9_.-]/g, "-") + ":" + randomBytes(4).toString("hex");
    const b = docker(["build", "-q", "--label", "gstack-evals.eb=cov", "--label", "gstack-evals.eb.cov.from=" + from, "-t", tag, ctx], { timeoutMs: 1800000 });
    if (b.status !== 0) return "";
    return docker(["image", "inspect", "-f", "{{.Id}}", tag]).stdout.trim();
  } finally {
    docker(["rmi", base]);
    rmSync(ctx, { recursive: true, force: true });
  }
}

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const MARK = "===EB-COVERAGE-DATA===";

/** One runner group's coverage command, run in the project dir; it prints MARK and the tool's data at the end. */
function command(eb: EbTask, gi: number, files: string[]): { cmd: string; tool: string } {
  const g = eb.groups[gi];
  const r = g.runner;
  const rel = files.map((f) => (g.projdir && f.startsWith(g.projdir + "/") ? f.slice(g.projdir.length + 1) : f));
  const out = (file: string) => "; echo " + MARK + "; cat " + file + " 2>/dev/null";
  if (r.kind === "go") {
    const pkgs = [...new Set(rel.map((f) => "./" + (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".")))].sort();
    return { tool: "go test -coverprofile", cmd: "export GOFLAGS=-mod=readonly GOPROXY=off GOTOOLCHAIN=local GOCACHE=/tmp/gocache; go test -count=1 -coverpkg=./... -coverprofile=/tmp/eb-cov.out " + pkgs.map(q).join(" ") + " >/tmp/eb-cov.log 2>&1" + out("/tmp/eb-cov.out") };
  }
  if (r.kind === "pytest") return { tool: "pytest-cov", cmd: "export PYTHONDONTWRITEBYTECODE=1; " + r.python + " -m pytest -q -p no:cacheprovider --cov=. --cov-report=lcov:/tmp/eb-cov.lcov " + rel.map(q).join(" ") + " >/tmp/eb-cov.log 2>&1" + out("/tmp/eb-cov.lcov") };
  if (r.kind === "cargo") {
    const pkg = r.package ? "-p " + r.package.replace(/[^\w.-]/g, "") + " " : "";
    return { tool: "cargo-llvm-cov", cmd: "export CARGO_TARGET_DIR=/tmp/target CARGO_TERM_COLOR=never; cargo llvm-cov --offline --lcov --output-path /tmp/eb-cov.lcov " + pkg + cargoSelectors(r.root, files).join(" ") + " >/tmp/eb-cov.log 2>&1" + out("/tmp/eb-cov.lcov") };
  }
  const bin = "/testbed/" + r.bin;
  const argv = r.kind === "nodetest" ? ["node", ...r.node_args, "--test", ...rel] : r.kind === "jest" ? ["node", ...r.node_args, bin, "--ci", "--watchAll=false", "--runTestsByPath", ...rel] : r.kind === "vitest" ? ["node", ...r.node_args, bin, "run", ...rel] : ["node", ...r.node_args, bin, ...rel];
  return { tool: "c8", cmd: "export CI=true NO_COLOR=1; c8 --reporter=lcovonly --reports-dir=/tmp/eb-c8 --temp-directory=/tmp/eb-c8-tmp " + argv.map(q).join(" ") + " >/tmp/eb-cov.log 2>&1" + out("/tmp/eb-c8/lcov.info") };
}

export interface CoverageOptions {
  unitDir: string;
  /** The build's diff from the unit's base. */
  patch: string;
  timeoutSec?: number;
}

/** Changed-line coverage of one build's own tests on its own tree. */
export function coverageBuild(o: CoverageOptions): CoverageResult {
  const { eb } = readUnit(o.unitDir);
  const result: CoverageResult = { scored: false, share: null, lines: 0, covered: 0, why: null, tools: [] };
  let split: BuildSplit;
  try {
    split = splitBuild(o.unitDir, eb, o.patch);
  } catch {
    return { ...result, why: "patch_does_not_apply" };
  }
  try {
    const changed = changedLines(split);
    if (changed.size === 0) return { ...result, why: "no_product_change" };
    const own = [...split.tests, ...split.regions];
    const hits: LineHits = new Map();
    if (own.length === 0) {
      const s = share(changed, hits);
      return { ...result, scored: true, share: 0, lines: s.lines, covered: 0, why: "no_own_tests" };
    }
    const image = coverageImage(eb);
    if (!image) return { ...result, why: "coverage_image_failed" };
    let data = 0;
    for (const gi of [...new Set(own.map((f) => f.group))].sort()) {
      const g = eb.groups[gi];
      const { cmd, tool } = command(eb, gi, own.filter((f) => f.group === gi).map((f) => f.path));
      result.tools.push(tool);
      const script = "cat > /tmp/eb-build.patch && cd /testbed && { [ ! -s /tmp/eb-build.patch ] || git apply --whitespace=nowarn /tmp/eb-build.patch; } && cd " + q(["/testbed", g.projdir].filter(Boolean).join("/")) + " && " + cmd;
      const name = "eb-cov-" + randomBytes(6).toString("hex");
      const res = docker(["run", "--rm", "-i", "--name", name, "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "2048", "--memory", "8g", "--tmpfs", "/tmp:rw,exec,size=4g", "-e", "HOME=/tmp", "--entrypoint", "sh", image, "-c", script], { input: o.patch, timeoutMs: (o.timeoutSec ?? 1800) * 1000 });
      if (res.error) docker(["rm", "-f", name]);
      const at = res.stdout.indexOf(MARK);
      const text = at < 0 ? "" : res.stdout.slice(at + MARK.length);
      if (!text.trim()) continue;
      data++;
      if (g.runner.kind === "go") parseGoCover(text, g.runner.module, g.projdir, hits);
      else parseLcov(text, g.projdir, hits);
    }
    if (data === 0) return { ...result, why: "tool_gave_no_data" };
    const s = share(changed, hits);
    if (s.lines === 0) return { ...result, why: "no_executable_changed_line" };
    return { ...result, scored: true, share: s.covered / s.lines, lines: s.lines, covered: s.covered };
  } finally {
    split.cleanup();
  }
}

/** Removes the coverage images built on this host. */
export function removeCoverageImages(): number {
  const ids = docker(["images", "-q", "--filter", "label=gstack-evals.eb=cov"]).stdout.trim().split("\n").filter(Boolean);
  for (const id of new Set(ids)) docker(["rmi", "-f", id]);
  return new Set(ids).size;
}
