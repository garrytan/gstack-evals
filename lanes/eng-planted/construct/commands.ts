// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals ep subcommands from the construct part: search, mine, construct, screen, recount, supply, units and digests, over one run
// directory on the screening host (plan section 14, step 2). The run directory holds the frozen manifest and its digest,
// each repository's mined fixes, the constructed units and every fix's outcome; it holds real repository names and
// shas, so it stays on that host and is never committed. Every command prints counts only. The lane's cli.ts merges
// every part's table.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { keepEvidence } from "../../eng-build/evidence.ts";
import { removeLabelled } from "../../eng-build/screen.ts";
import { docker } from "../../real-outcome/task/docker.ts";
import { fail } from "../errors.ts";
import type { Command, DryCase, Ecosystem } from "../types.ts";
import { construct, type Constructed } from "./build.ts";
import { compareDigests, unitDigests } from "./digests.ts";
import { DRY } from "./dry.ts";
import { emitUnit, type LabelMap } from "./emit.ts";
import { qualify, recount, requireSandbox, type Outcome } from "./grade.ts";
import { FROZEN } from "../frozen.ts";
import { digest, starStratum, type Manifest, type MinedFix } from "./local.ts";
import { cloneMirror, mineRepo } from "./mine.ts";
import { draw, freeze, githubReader, mintSeed, repoKey, search } from "./search.ts";
import { supplyGate, supplyReport } from "./supply.ts";

const ECOS: Ecosystem[] = ["go", "node", "python", "rust"];

/** The run directory's files. */
const store = (run: string) => ({
  seed: join(run, "seed.txt"),
  manifest: join(run, "manifest.json"),
  digest: join(run, "manifest.digest"),
  pool: join(run, "pool.json"),
  poolDigest: join(run, "pool.digest"),
  mirror: (i: number) => join(run, "mirrors", String(i)),
  mined: (i: number) => join(run, "mined", i + ".json"),
  constructed: (id: string) => join(run, "constructed", id + ".json"),
  outcome: (id: string) => join(run, "outcomes", id + ".json"),
  unit: (id: string) => join(run, "units", id),
  labels: join(run, "labels.json"),
});

const writeJson = (path: string, v: unknown) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 1) + "\n", { mode: 0o600 });
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

function need(flags: Map<string, string>, name: string): string {
  const v = flags.get(name);
  if (!v) fail("E_USAGE", "needs " + name);
  return v!;
}

/** The frozen manifest, refused when its digest moved. */
function frozenManifest(run: string): Manifest {
  const s = store(run);
  if (!existsSync(s.manifest) || !existsSync(s.digest)) fail("E_USAGE", "no frozen manifest in the run; run gstack-evals ep search first");
  const text = readFileSync(s.manifest, "utf8");
  if (digest(text) !== readFileSync(s.digest, "utf8").trim()) fail("E_USAGE", "the manifest no longer matches its frozen digest");
  return JSON.parse(text) as Manifest;
}

type Mined = { repo: string; eco: Ecosystem; cloned: boolean; stats: Record<string, number>; fixes: MinedFix[]; mirror: string };
const allMined = (run: string): Mined[] =>
  existsSync(join(run, "mined"))
    ? readdirSync(join(run, "mined"))
        .filter((f) => f.endsWith(".json"))
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((f) => readJson<Mined>(join(run, "mined", f)))
    : [];

const searchCmd: Command = {
  summary: "search GitHub per ecosystem, draw in a seeded order and freeze the manifest; --extend draws the next repositories of an earlier run's pool",
  usage: "--run <dir> --per-eco <n> [--pages <n>] [--extend <earlier run dir>] [--exclude <file of sha256 hex of lowercase owner/name, one a line>]",
  bools: [],
  async run({ flags }, io) {
    const run = need(flags, "--run");
    const s = store(run);
    if (existsSync(s.manifest)) fail("E_USAGE", "the run already holds a frozen manifest");
    mkdirSync(run, { recursive: true });
    const from = flags.get("--extend");
    if (from) {
      const first = frozenManifest(from);
      const t = store(from);
      const poolText = readFileSync(t.pool, "utf8");
      if (digest(poolText) !== readFileSync(t.poolDigest, "utf8").trim()) fail("E_USAGE", "the earlier run's pool no longer matches its frozen digest");
      const taken = new Set(first.rows.map((r) => r.repo));
      const perEco = Math.max(...ECOS.map((e) => first.rows.filter((r) => r.eco === e).length)) + Number(need(flags, "--per-eco"));
      const m: Manifest = { searchedAt: first.searchedAt, seed: first.seed, queries: first.queries, rows: draw(JSON.parse(poolText), first.seed, perEco).filter((r) => !taken.has(r.repo)) };
      const f = freeze(m);
      writeFileSync(s.manifest, f.text, { mode: 0o600 });
      writeFileSync(s.digest, f.digest + "\n");
      io.out("search: extension of " + taken.size + " repositories by " + m.rows.length + " in the same seeded order (" + ECOS.map((e) => e + " " + m.rows.filter((r) => r.eco === e).length).join(", ") + "), frozen as " + f.digest);
      return 0;
    }
    const excludeFile = flags.get("--exclude");
    const excluded = new Set(excludeFile ? readFileSync(excludeFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean) : []);
    if ([...excluded].some((h) => !/^[0-9a-f]{64}$/.test(h))) fail("E_USAGE", "--exclude holds a line that is not a sha256 hex digest");
    const kept = (r: Manifest["rows"][number]) => !excluded.has(repoKey(r.repo));
    const seed = mintSeed();
    writeFileSync(s.seed, seed + "\n", { mode: 0o600 });
    const github = githubReader();
    const searchedAt = new Date().toISOString();
    const queries: Manifest["queries"] = [];
    const rows: Manifest["rows"] = [];
    for (const eco of ECOS) {
      const r = await search(github, eco, Number(flags.get("--pages") ?? 10));
      rows.push(...r.rows.map((x) => ({ ...x, query: x.query + queries.length })));
      queries.push(...r.queries);
    }
    const poolText = JSON.stringify(rows) + "\n";
    writeFileSync(s.pool, poolText, { mode: 0o600 });
    writeFileSync(s.poolDigest, digest(poolText) + "\n");
    const m: Manifest = { searchedAt, seed, queries, rows: draw(rows.filter(kept), seed, Number(need(flags, "--per-eco"))) };
    const f = freeze(m);
    writeFileSync(s.manifest, f.text, { mode: 0o600 });
    writeFileSync(s.digest, f.digest + "\n");
    if (excludeFile) io.out("search: excluded " + new Set(rows.filter((r) => !kept(r)).map((r) => r.repo)).size + " of " + excluded.size + " listed repositories (list " + digest(readFileSync(excludeFile, "utf8")) + ")");
    io.out("search: " + queries.length + " queries read " + rows.length + " results; manifest " + m.rows.length + " repositories (" + ECOS.map((e) => e + " " + m.rows.filter((r) => r.eco === e).length).join(", ") + "), frozen as " + f.digest);
    return 0;
  },
};

const mineCmd: Command = {
  summary: "mine every manifest repository for fixes in the frame, with the earliest public date",
  usage: "--run <dir> [--cap <fixes a repository>] [--shard <k>/<n>: mine only the manifest rows whose index is k modulo n]",
  bools: [],
  async run({ flags }, io) {
    const run = need(flags, "--run");
    const m = frozenManifest(run);
    const s = store(run);
    const github = githubReader();
    const shard = flags.get("--shard")?.match(/^(\d+)\/(\d+)$/);
    if (flags.has("--shard") && !(shard && Number(shard[1]) < Number(shard[2]))) fail("E_USAGE", "--shard takes k/n with 0 <= k < n");
    const mine = (i: number) => !shard || i % Number(shard[2]) === Number(shard[1]);
    let fixes = 0;
    for (const [i, row] of m.rows.entries()) {
      if (!mine(i) || existsSync(s.mined(i))) continue;
      const mirror = s.mirror(i);
      const cloned = cloneMirror(row.repo, mirror);
      const r = cloned ? await mineRepo({ repo: row.repo, eco: row.eco, stars: row.stars, mirror, github, cap: flags.has("--cap") ? Number(flags.get("--cap")) : undefined }) : { stats: {}, fixes: [] };
      writeJson(s.mined(i), { repo: row.repo, eco: row.eco, cloned, stats: r.stats, fixes: r.fixes, mirror });
      fixes += r.fixes.length;
    }
    io.out("mine: " + m.rows.filter((_, i) => mine(i) && existsSync(s.mined(i))).length + " of " + m.rows.filter((_, i) => mine(i)).length + " repositories mined" + (shard ? " in shard " + shard[1] + "/" + shard[2] : "") + ", " + fixes + " fixes mined this pass");
    return 0;
  },
};

const constructCmd: Command = {
  summary: "build B, M and F' for every mined fix in its mirror",
  usage: "--run <dir>",
  bools: [],
  async run({ flags }, io) {
    const run = need(flags, "--run");
    frozenManifest(run);
    const s = store(run);
    const n = { built: 0, dropped: 0 };
    for (const r of allMined(run))
      for (const f of r.fixes) {
        if (existsSync(s.constructed(f.id)) || existsSync(s.outcome(f.id))) continue;
        const c = construct(r.mirror, f);
        if (c.ok) {
          writeJson(s.constructed(f.id), c.unit);
          n.built++;
        } else {
          writeJson(s.outcome(f.id), { id: f.id, repo: f.repo, eco: f.eco, stars: starStratum(f.stars), strict: f.earliestPublic.slice(0, 10) >= FROZEN.window.strictFrom, step: "construct", reason: c.reason, regionLines: 0, planted: 0, crash: 0, functional: 0 } satisfies Outcome);
          n.dropped++;
        }
      }
    io.out("construct: " + n.built + " constructed, " + n.dropped + " dropped this pass");
    return 0;
  },
};

const screenCmd: Command = {
  summary: "screen and build every constructed unit in the frozen grading sandbox, with the body, leak and one-commit checks; --minutes drops a candidate whose screen runs past that wall time as screen:timeout",
  usage: "--run <dir> --work <dir> [--minutes <wall minutes a candidate>]",
  bools: [],
  async run({ flags }, io) {
    const run = need(flags, "--run");
    const work = need(flags, "--work");
    frozenManifest(run);
    requireSandbox();
    const s = store(run);
    const steps = new Map<string, number>();
    const minutes = flags.has("--minutes") ? Number(flags.get("--minutes")) : null;
    if (minutes !== null && !(minutes > 0)) fail("E_USAGE", "--minutes needs a positive number of minutes");
    if (minutes !== null) removeLabelled();
    for (const r of allMined(run))
      for (const f of r.fixes) {
        if (!existsSync(s.constructed(f.id)) || existsSync(s.outcome(f.id))) continue;
        const mark = join(run, "screening", f.id);
        let o: Outcome;
        if (minutes !== null && existsSync(mark) && Date.now() - statSync(mark).mtimeMs >= minutes * 60000) {
          o = { id: f.id, repo: f.repo, eco: f.eco, stars: starStratum(f.stars), strict: f.earliestPublic.slice(0, 10) >= FROZEN.window.strictFrom, step: "screen", reason: "timeout", regionLines: readJson<Constructed>(s.constructed(f.id)).regionLines, planted: 0, crash: 0, functional: 0 };
          keepEvidence(f.id, "drop.json", { step: "screen", reason: "timeout", detail: { minutes } });
          rmSync(mark, { force: true });
        } else {
          let killer: ChildProcess | null = null;
          if (minutes !== null) {
            mkdirSync(dirname(mark), { recursive: true });
            writeFileSync(mark, "");
            killer = spawn("sh", ["-c", "sleep " + Math.ceil(minutes * 60) + " && kill -TERM " + process.pid], { detached: true, stdio: "ignore" });
            killer.unref();
          }
          try {
            o = qualify({ mirror: r.mirror, fix: f, unit: readJson<Constructed>(s.constructed(f.id)), out: s.unit(f.id), work, labels: s.labels });
          } finally {
            if (killer?.pid) {
              try {
                process.kill(-killer.pid, "SIGKILL");
              } catch {
                // the timer already ended
              }
            }
            rmSync(mark, { force: true });
            removeLabelled();
          }
        }
        writeJson(s.outcome(f.id), o);
        const images = docker(["images", "-q", "--filter", "label=gstack-evals.eb.unit=" + f.id]).stdout.split("\n").filter(Boolean);
        if (o.step !== "qualified" && images.length) docker(["image", "rm", "-f", ...images]);
        steps.set(o.step, (steps.get(o.step) ?? 0) + 1);
      }
    io.out("screen: " + ([...steps].map(([k, v]) => k + "=" + v).join(" ") || "nothing to screen"));
    return 0;
  },
};

const recountCmd: Command = {
  summary: "grade every qualified unit again, 3 runs on its real trees, under the planted rules",
  usage: "--run <dir> --work <dir>",
  bools: [],
  async run({ flags }, io) {
    const run = need(flags, "--run");
    const work = need(flags, "--work");
    const s = store(run);
    const n = { clean: 0, not: 0 };
    for (const r of allMined(run))
      for (const f of r.fixes) {
        if (!existsSync(s.outcome(f.id))) continue;
        const o = readJson<Outcome>(s.outcome(f.id));
        if (o.step !== "qualified") continue;
        const next = recount(o, s.unit(f.id), work);
        writeJson(s.outcome(f.id), next);
        next.step === "clean" ? n.clean++ : n.not++;
      }
    io.out("recount: " + n.clean + " clean, " + n.not + " not clean");
    return 0;
  },
};

const supplyCmd: Command = {
  summary: "print the supply counts by step and reason; refuse under the minimum",
  usage: "--run <dir>",
  bools: [],
  async run({ flags }, io) {
    const run = need(flags, "--run");
    const manifest = frozenManifest(run);
    const s = store(run);
    const mined = allMined(run);
    const fixes = mined.flatMap((m) => m.fixes.map((f) => ({ id: f.id, eco: f.eco })));
    const outcomes = fixes.filter((f) => existsSync(s.outcome(f.id))).map((f) => readJson<Outcome>(s.outcome(f.id)));
    const r = supplyReport({ manifest, digest: readFileSync(s.digest, "utf8").trim(), mined, outcomes, fixes });
    for (const l of r.lines) io.out(l);
    supplyGate(r.capped);
    return 0;
  },
};

const REPO = resolve(import.meta.dir, "..", "..", "..");

const unitsCmd: Command = {
  summary: "write every clean unit in the stages contract, with its B tree, and keep the label map in custody",
  usage: "--run <dir> --units <dir> --repos <dir> --labels <custody file outside the repository>",
  bools: [],
  async run({ flags }, io) {
    const run = need(flags, "--run");
    const file = resolve(need(flags, "--labels"));
    if (!relative(REPO, file).startsWith("..")) fail("E_USAGE", "the label map is held out: keep it outside the repository");
    frozenManifest(run);
    const s = store(run);
    const labels: LabelMap = existsSync(file) ? readJson<LabelMap>(file) : { repos: {}, units: {} };
    const done = new Set(Object.values(labels.units).map((u) => u.candidate));
    let n = 0;
    for (const r of allMined(run))
      for (const f of r.fixes) {
        if (done.has(f.id) || !existsSync(s.outcome(f.id)) || readJson<Outcome>(s.outcome(f.id)).step !== "clean") continue;
        emitUnit({ mirror: r.mirror, fix: f, unit: readJson<Constructed>(s.constructed(f.id)), unitDir: s.unit(f.id), units: need(flags, "--units"), repos: need(flags, "--repos"), labels });
        writeJson(file, labels);
        n++;
      }
    io.out("units: " + n + " written this pass, " + Object.keys(labels.units).length + " in the label map from " + Object.keys(labels.repos).length + " repositories");
    return 0;
  },
};

const digestsCmd: Command = {
  summary: "write a unit folder's content digests to a custody file, or check a rebuilt unit against its sealed digests (exit 1 on a mismatch)",
  usage: "--unit <dir> (--out <file outside the repository> | --check <sealed digests file>)",
  bools: [],
  async run({ flags }, io) {
    const unit = need(flags, "--unit");
    const out = flags.get("--out");
    const check = flags.get("--check");
    if ((out === undefined) === (check === undefined)) fail("E_USAGE", "pass exactly one of --out and --check");
    if (out !== undefined) {
      const file = resolve(out);
      if (!relative(REPO, file).startsWith("..")) fail("E_USAGE", "a unit's digests are held out: keep them outside the repository");
      const lines = unitDigests(unit);
      writeFileSync(file, lines.join("\n") + "\n");
      io.out("digests: " + lines.length + " lines written, " + (lines.length - 2) + " of them restore files");
      return 0;
    }
    const r = compareDigests(readFileSync(resolve(check!), "utf8").split("\n").filter(Boolean), unitDigests(unit));
    io.out("digests: " + (["B", "R", "D"] as const).map((k) => k + " " + r.kinds[k].matched + " of " + r.kinds[k].compared).join(", ") + " matched; " + (r.match ? "match" : "mismatch, so the unit counts as lost (section 15)"));
    return r.match ? 0 : 1;
  },
};

export const COMMANDS: Record<string, Command> = { search: searchCmd, mine: mineCmd, construct: constructCmd, screen: screenCmd, recount: recountCmd, supply: supplyCmd, units: unitsCmd, digests: digestsCmd };

/** This part's keyless dry-run cases; lanes/eng-planted/dryrun.ts runs every part's. */
export const DRY_CASES: DryCase[] = DRY;
