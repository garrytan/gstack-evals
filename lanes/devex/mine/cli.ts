// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx mine (devex prereg sections 3 and 4; design prereg frame-rules.md): one public miner for both evals,
// GitHub only. The side and the eval's own filters are parameters (devex: side dev, the post's five filters, released
// by 2026-09-30).
//   dx mine repos --out <dir>                       the topic-search union, recorded with its date (repos.json)
//   dx mine draw --out <dir> --draws <n> [--repos <n>|all] [--side dev|ui] [--item <ledger item>] [--pace <points an hour>] [--max-minutes <n>] [--concurrency <n>]
//       lists each repository once into listing.jsonl (its releases, tags and listed pull requests, side-neutral, so
//       either eval's draw reads it), then runs the side's units in draw order through every rule, then the window
//       read and the free screen for kept units whose window had closed when the draw began. --repos <n> lists the
//       first n of the side's repositories in seeded order (default 12, for smokes); --repos all lists every
//       repository in the frame and draws over all of them in frame-wide seeded order. With --item the frozen
//       classifier runs on that ledger item; without it no model is called and the mechanical prefilter's side stands
//       in (a smoke), and says so. For each screen-positive unit it keeps what dx handover needs at
//       read/<draw digest>.json: the plan text, the window's records and candidates as the screen read them, the
//       base sha and the base README and manifest paths.
//       Each step goes to progress.jsonl as it ends, so a rerun on the same --out continues from the next candidate
//       and any number of segments gives the same draws.json, screen.jsonl and read/ as one run. GraphQL use stays
//       under --pace points an hour (default 3000; pace.ts). A segment ends cleanly after --max-minutes (default 330)
//       and prints one status line: exit 0 when the draw is finished, 3 when more remains. Up to --concurrency (default
//       3) GraphQL queries are in flight at once (ahead.ts): the listing's batches and the next units' facts, ancestry,
//       base and window reads go ahead, while every step, write, screen and read file happens in draw order, so the
//       outputs and resumes match --concurrency 1 byte for byte. A frame repository GitHub no longer returns is listed
//       as missing, never asked again, and counted as repos_missing in the status line and mine.log. One that stops answering after it
//       was listed drops the unit being drawn as repo-missing, recorded in progress.jsonl like any step; the draw asks it
//       nothing more and goes on in order, and it counts in repos_missing too.
// Records name repositories, so --out must sit outside the repository; only counts belong in anything committed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { drawOrder } from "../../aftermath/draw.ts";
import type { GhExec, GitHub } from "../../aftermath/gh.ts";
import { openMeter, type Meter } from "../../aftermath/meter.ts";
import type { Io } from "../cli.ts";
import { SEED } from "../types.ts";
import { CONCURRENCY, ghCliAsync, Pending, reader, type GhExecAsync } from "./ahead.ts";
import { classify } from "./classify.ts";
import { mechanicalSide, titleExcluded } from "./frame.ts";
import { unitDiff } from "./git.ts";
import { allFiles, baseTree, RepoGone, COMPARE_BATCH, LIST_BATCH, listRepos, openDxGitHub, openDxGraphqlAsync, readWindow, repoUnion, tagsContain, UNIT_BATCH, unitFactsMany, type FrameRepo, type ListedPr, type Listing } from "./github.ts";
import { DEVEX_FILTERS, DEVEX_RELEASED_BY, drawOne, earliestBefore, excludedDigests, inDates, PER_REPO, planText, releaseByAncestry, treeFacts, unitOrder, type BaseTree, type Candidate, type Drawn, type Release, type Step, type UnitFacts } from "./units.ts";
import { basePaths, type UnitRead } from "./handover.ts";
import { paced, PACE } from "./pace.ts";
import { DIFF_BYTES, screenRead, type WindowItem } from "./window.ts";

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const usage = (m: string) => Object.assign(new Error(m), { code: "E_USAGE" });

export const MORE_REMAINS = 3;

/** A JSON-lines file's whole lines; a last line cut short by a stopped segment is removed from the file. */
export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const whole = text.slice(0, text.lastIndexOf("\n") + 1);
  if (whole.length !== text.length) writeFileSync(file, whole);
  return whole.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** What the tests and the dry run swap in: the gh executable (awaited, or plain and wrapped), the clock and the diff. */
export interface MineDeps {
  exec?: GhExec;
  execAsync?: GhExecAsync;
  now?: () => number;
  sleep?: (ms: number) => void;
  diff?: typeof unitDiff;
}

interface Progress {
  order: string;
  step: Step;
  screen?: Record<string, unknown> & { positive: boolean };
}

export async function run(argv: string[], io: Io, deps: MineDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  const out = flag(rest, "--out");
  if (!out || (sub !== "repos" && sub !== "draw")) throw usage("dx mine repos|draw --out <dir outside the repo> ...");
  if (resolve(out).startsWith(resolve(import.meta.dir, "../../.."))) throw usage("--out must sit outside the repository: mine records name repositories");
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleepSync(ms));
  const raw = openDxGitHub(deps.exec, deps.sleep, deps.now);
  const log = (o: Record<string, unknown>) => appendFileSync(join(out, "mine.log"), JSON.stringify({ at: new Date(now()).toISOString(), ...o }) + "\n");
  if (sub === "repos") {
    const before = raw.graphqlLeft();
    const u = repoUnion(raw);
    writeFileSync(join(out, "repos.json"), JSON.stringify(u));
    const after = raw.graphqlLeft();
    log({ step: "repos", repos: u.repos.length, short: u.short.length, graphql_before: before.remaining, graphql_after: after.remaining, points: raw.pointsUsed(), calls: raw.calls() });
    io.out("dx mine repos: " + u.repos.length + " repositories in the frame, searched " + u.searched_at + "; " + u.short.length + " topic bands read short");
    return 0;
  }
  const side = (flag(rest, "--side") ?? "dev") as "dev" | "ui";
  const maxDraws = Number(flag(rest, "--draws") ?? "25");
  const reposArg = flag(rest, "--repos") ?? "12";
  const pace = Number(flag(rest, "--pace") ?? PACE);
  const maxMinutes = Number(flag(rest, "--max-minutes") ?? "330");
  const concurrency = Number(flag(rest, "--concurrency") ?? CONCURRENCY);
  const item = flag(rest, "--item");
  if (!(maxDraws > 0) || !(pace > 0) || !(maxMinutes > 0) || (reposArg !== "all" && !(Number(reposArg) > 0))) throw usage("--draws, --pace and --max-minutes take positive numbers, --repos a count or all");
  if (!Number.isInteger(concurrency) || concurrency < 1) throw usage("--concurrency takes a whole number of 1 or more");
  const deadline = now() + maxMinutes * 60_000;
  const sleepAsync = deps.sleep ? async (ms: number) => deps.sleep!(ms) : (ms: number) => Bun.sleep(ms);
  const execAsync = deps.execAsync ?? (deps.exec ? async (args: string[], input?: string) => deps.exec!(args, input) : ghCliAsync);
  const gh = paced(raw, { pace, now, sleep, sleepAsync, async: openDxGraphqlAsync(execAsync, sleepAsync, now), log: (r) => log({ step: "rate", ...r }) });
  const first = gh.read("start");
  const params = { side, draws: String(maxDraws), repos: reposArg, item: item ?? null };
  const runFile = join(out, "run.json");
  const prior = existsSync(runFile) ? (JSON.parse(readFileSync(runFile, "utf8")) as { params: typeof params; cutoff: string }) : null;
  if (prior && JSON.stringify(prior.params) !== JSON.stringify(params)) throw usage("--out holds a draw with other settings " + JSON.stringify(prior.params) + "; rerun with them or use a new --out");
  const cutoff = prior?.cutoff ?? new Date(now()).toISOString();
  if (!prior) writeFileSync(runFile, JSON.stringify({ params, cutoff }));

  const union = JSON.parse(readFileSync(join(out, "repos.json"), "utf8")) as { repos: FrameRepo[] };
  const ordered = [...union.repos].sort((a, b) => (drawOrder(SEED, a.repo) < drawOrder(SEED, b.repo) ? -1 : 1));
  const listed = reposArg === "all" ? ordered : ordered.filter((r) => r.sides.includes(side)).slice(0, Number(reposArg));
  const listingFile = join(out, "listing.jsonl");
  const listing = new Map(readJsonl<Listing>(listingFile).map((l) => [l.repo, l]));
  const rd = reader(gh, concurrency);
  const quiet = <T>(p: Promise<T>) => (p.catch(() => {}), p);
  let work = 0;
  const due = () => work > 0 && now() >= deadline;
  const kept: Drawn[] = [], drops: Record<string, number> = {};
  const count = (step: Step) => ("keep" in step ? kept.push(step.keep) : (drops[step.drop] = (drops[step.drop] ?? 0) + 1));
  const gone = new Set<string>();
  const alive = (repo: string) => {
    if (gone.has(repo)) throw new RepoGone(repo);
  };
  const NF = { notFound: true };
  let units: Array<{ repo: FrameRepo; pr: ListedPr; order: string }> | null = null;
  let prog: Progress[] = [], rows: Array<NonNullable<Progress["screen"]>> = [], end = 0;
  let meter: Meter | null = null;
  try {
    const todo = listed.filter((r) => !listing.has(r.repo));
    const lists: Array<Promise<Listing[]>> = [];
    const listAt = (k: number) => (lists[k] ??= quiet(rd.read(k, (g) => listRepos(g, todo.slice(k * LIST_BATCH, (k + 1) * LIST_BATCH)), { notFound: true })));
    for (let k = 0; k * LIST_BATCH < todo.length && !due(); k++, work++) {
      for (let j = k; j < k + concurrency && j * LIST_BATCH < todo.length; j++) listAt(j);
      for (const l of await lists[k]!) {
        appendFileSync(listingFile, JSON.stringify(l) + "\n");
        listing.set(l.repo, l);
      }
    }

    units = listed.every((r) => listing.has(r.repo))
      ? listed.filter((r) => r.sides.includes(side)).flatMap((r) => listing.get(r.repo)!.prs.map((pr) => ({ repo: r, pr, order: unitOrder(r.repo, pr.number) }))).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      : null;
    const progFile = join(out, "progress.jsonl");
    prog = readJsonl<Progress>(progFile);
    if (units && prog.length && units[prog.length - 1]?.order !== prog[prog.length - 1]!.order) throw Object.assign(new Error("progress.jsonl does not follow the listing's draw order; the listing changed under a draw in progress"), { code: "E_MINE_SOURCE" });
    for (const p of prog) count(p.step);
    for (const [i, p] of prog.entries()) if ("drop" in p.step && p.step.drop === "repo-missing") gone.add(units![i]!.repo.repo);
    rows = prog.flatMap((p) => (p.screen ? [p.screen] : []));
    if (rows.length) writeFileSync(join(out, "screen.jsonl"), rows.map((r) => JSON.stringify(r) + "\n").join(""));

    const plan = { side, filters: side === "dev" ? DEVEX_FILTERS : [], releasedBy: DEVEX_RELEASED_BY, perRepo: PER_REPO, excluded: excludedDigests() };
    end = units ? Math.min(units.length, maxDraws) : 0;
    if (item && units && prog.length < end) meter = await openMeter({ item, runId: item, out: join(out, "journal"), cacheDir: join(out, "cache"), maxOutputTokens: 2000, driftCode: "E_DX_PROVIDER_DRIFT", onDrift: "stop-model", arm: "dx" });
    if (units) {
      const u = units;
      const shallowOf = (repo: FrameRepo, pr: ListedPr): UnitFacts => ({ repo: repo.repo, number: pr.number, title: pr.title, labels: pr.labels, created_at: pr.created_at, merged_at: pr.merged_at, base_ref: pr.base_ref, default_branch: repo.default_branch, body: { created_at: pr.created_at, current: "", last_edited_at: null, edits: [] }, closing: [], commits: [], files: pr.files, merge_sha: null, base_sha: null });
      const quick = (j: number) => plan.excluded.has(u[j]!.order) || !inDates(shallowOf(u[j]!.repo, u[j]!.pr)) || titleExcluded(u[j]!.pr.title, u[j]!.pr.labels);
      const batchOf = new Map<number, number[]>();
      let cur: number[] = [];
      for (let j = prog.length; j < end; j++) {
        if (quick(j)) continue;
        if (cur.length >= UNIT_BATCH) cur = [];
        cur.push(j);
        batchOf.set(j, cur);
      }
      type Memo = { load?: ReturnType<typeof unitFactsMany>[number]; release?: Release | null; base?: BaseTree | null; paths?: ReturnType<typeof basePaths>; label?: Promise<{ dev: boolean; ui: boolean } | null>; window?: { key: string; items: WindowItem[] } };
      const memo = new Map<number, Memo>();
      const memoOf = (j: number) => memo.get(j) ?? memo.set(j, {}).get(j)!;
      const factsOf = new Map<number[], Promise<void>>();
      const factsFor = (j: number) => {
        const want = batchOf.get(j)!;
        if (!factsOf.has(want)) factsOf.set(want, quiet(rd.read(want[0]!, (g) => unitFactsMany(g, want.map((k) => ({ repo: u[k]!.repo, pr: u[k]!.pr, files: gone.has(u[k]!.repo.repo) ? null : allFiles(g, u[k]!.repo.repo, u[k]!.pr) }))), NF).then((got) => want.forEach((k, x) => void ((memoOf(k).load = got[x]!) ?? gone.add(u[k]!.repo.repo))))));
        return factsOf.get(want)!;
      };
      const candidate = (i: number, g: GitHub, ahead: boolean): Candidate => {
        const { repo, pr } = u[i]!, m = memoOf(i), rel = listing.get(repo.repo)!;
        const c: Candidate = {
          facts: shallowOf(repo, pr),
          full: () => {
            alive(repo.repo);
            if (!m.load) throw new Pending(factsFor(i));
            return m.load.facts;
          },
          repo: { topics: repo.topics, stratum: repo.stratum, licence_field: repo.licence_field },
          release: () => {
            if ("release" in m) return m.release!;
            const f = c.full();
            if (!f.merge_sha) return (m.release = null);
            const seq: string[] = [];
            releaseByAncestry(f.merged_at, DEVEX_RELEASED_BY, rel.releases, rel.tags, (tag) => (seq.push(tag), false));
            const known = new Map<string, boolean>();
            return (m.release = releaseByAncestry(f.merged_at, DEVEX_RELEASED_BY, rel.releases, rel.tags, (tag) => {
              if (!known.has(tag)) {
                alive(repo.repo);
                const chunk = seq.slice(seq.indexOf(tag)).filter((t) => !known.has(t)).slice(0, COMPARE_BATCH);
                tagsContain(g, f.repo, f.merge_sha!, chunk).forEach((v, k) => known.set(chunk[k]!, v));
              }
              return known.get(tag)!;
            }));
          },
          label: () => {
            if (ahead && meter) return Promise.reject(new Error("reads ahead stop at the classifier"));
            return (m.label ??= (async () => {
              const f = c.full();
              if (!meter) {
                const s = mechanicalSide({ title: f.title, labels: f.labels, body: earliestBefore(f.body, f.merged_at) ?? "", files: f.files }, repo);
                return { dev: s.dev.length > 0, ui: s.ui.length > 0 };
              }
              const l = (await classify(meter, f.repo + "#" + f.number, { title: f.title, body: earliestBefore(f.body, f.merged_at) ?? "", closing: f.closing.filter((x) => x.created_at < f.merged_at).map((x) => ({ title: x.title, body: earliestBefore(x.body, f.merged_at) ?? "" })), files: f.files.map((x) => x.path) })).label;
              return l ? { dev: l.developer_facing, ui: l.ui } : null;
            })());
          },
          base: () => {
            if ("base" in m) return m.base!;
            const f = c.full();
            if (!f.base_sha) return (m.base = null);
            alive(repo.repo);
            const t = baseTree(g, f.repo, f.base_sha);
            m.paths = basePaths(t.tree);
            return (m.base = treeFacts(t.tree, t.truncated, t.licence));
          },
        };
        return c;
      };
      const aheads = new Map<number, Promise<void>>();
      const readAhead = (j: number) => {
        if (aheads.has(j)) return;
        const snapshot = kept.slice();
        aheads.set(j, (async () => {
          const step = await rd.read(j, (g) => drawOne(candidate(j, g, true), plan, snapshot), NF);
          if (!("keep" in step) || step.keep.window.to > cutoff) return;
          const k = step.keep;
          memoOf(j).window = { key: JSON.stringify(k.window), items: await rd.read(j, (g) => (alive(k.repo), readWindow(g, k.repo, k.window)), NF) };
        })().catch((e) => void (e instanceof RepoGone && gone.add(e.repo))));
      };
      for (let i = prog.length; i < end && !due(); i++, work++) {
        for (let j = i, n = 0; j < end && n <= 2 * concurrency; j++) if (!quick(j)) readAhead(j), n++;
        await aheads.get(i);
        const { order } = u[i]!, m = memoOf(i);
        let step: Step, items: WindowItem[] | null = null;
        try {
          step = await rd.read(i, (g) => drawOne(candidate(i, g, false), plan, kept), NF);
          if ("keep" in step && step.keep.window.to <= cutoff) {
            const k = step.keep;
            items = m.window?.key === JSON.stringify(k.window) ? m.window.items : await rd.read(i, (g) => (alive(k.repo), readWindow(g, k.repo, k.window)), NF);
          }
        } catch (e) {
          if (!(e instanceof RepoGone)) throw e;
          gone.add(e.repo);
          step = { drop: "repo-missing" };
        }
        let screen: Progress["screen"];
        if (items && "keep" in step) {
          const k = step.keep, f = m.load!.facts, text = planText(f).text;
          const diff = f.base_sha && f.merge_sha ? (deps.diff ?? unitDiff)(k.repo, f.base_sha, f.merge_sha, join(out, "clones"), DIFF_BYTES) : null;
          const r = screenRead({ repo: k.repo, number: k.number, title: f.title, text, closing: f.closing.map((x) => x.number), files: f.files.map((x) => x.path), diff, timeline_refs: m.load!.timeline_refs }, items);
          if (r.screen.positive) {
            const read: UnitRead = { id: k.id, source: text, base_sha: f.base_sha, ...(m.paths ?? { readme_path: null, manifest_paths: [] }), records: r.records, candidates: r.candidates };
            mkdirSync(join(out, "read"), { recursive: true, mode: 0o700 });
            writeFileSync(join(out, "read", k.order + ".json"), JSON.stringify(read), { mode: 0o600 });
          }
          screen = { id: k.id, prerelease: k.release.prerelease, ...r.screen };
        }
        const p: Progress = screen ? { order, step, screen } : { order, step };
        appendFileSync(progFile, JSON.stringify(p) + "\n");
        if (screen) {
          appendFileSync(join(out, "screen.jsonl"), JSON.stringify(screen) + "\n");
          rows.push(screen);
        }
        prog.push(p);
        count(step);
        memo.delete(i);
        aheads.delete(i);
        if (batchOf.get(i)?.at(-1) === i) factsOf.delete(batchOf.get(i)!);
      }
    }
  } finally {
    rd.close();
    if (meter) await meter.close();
  }
  const finished = !!units && prog.length >= end;
  if (finished) writeFileSync(join(out, "draws.json"), JSON.stringify({ kept, drops, draws: prog.length, steps: prog.map((p) => ({ order: p.order, step: p.step })) }));
  const last = gh.read("end");
  const vanished = new Set(prog.flatMap((p, i) => ("drop" in p.step && p.step.drop === "repo-missing" ? [units![i]!.repo.repo] : [])));
  const summary = { status: finished ? "finished" : "more remains", phase: units ? "draw" : "listing", listed: listed.filter((r) => listing.has(r.repo)).length, of: listed.length, repos_missing: listed.filter((r) => listing.get(r.repo)?.missing || vanished.has(r.repo)).length, candidates: units?.length ?? null, draws: prog.length, kept: kept.length, drops, window_open: kept.filter((k) => k.window.to > cutoff).length, screened: rows.length, screen_positive: rows.filter((r) => r.positive).length, classifier: item ? "panel" : "mechanical stand-in (no model call)", graphql_before: first.remaining, graphql_after: last.remaining, points: gh.pointsUsed(), calls: gh.calls() };
  log({ step: "draw", ...summary });
  io.out("dx mine draw: " + summary.status + " " + JSON.stringify(summary));
  return finished ? 0 : MORE_REMAINS;
}
