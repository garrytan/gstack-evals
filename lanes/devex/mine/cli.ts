// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx mine (devex prereg sections 3 and 4; design prereg frame-rules.md): one public miner for both evals,
// GitHub only. The side and the eval's own filters are parameters (devex: side dev, the post's five filters, released
// by 2026-09-30).
//   dx mine repos --out <dir>                       the topic-search union, recorded with its date (repos.json)
//   dx mine draw --out <dir> --draws <n> [--repos <n>|all] [--side dev|ui] [--item <ledger item>] [--pace <points an hour>] [--max-minutes <n>]
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
//       and prints one status line: exit 0 when the draw is finished, 3 when more remains.
// Records name repositories, so --out must sit outside the repository; only counts belong in anything committed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { drawOrder } from "../../aftermath/draw.ts";
import type { GhExec } from "../../aftermath/gh.ts";
import { openMeter, type Meter } from "../../aftermath/meter.ts";
import type { Io } from "../cli.ts";
import { SEED } from "../types.ts";
import { classify } from "./classify.ts";
import { mechanicalSide, titleExcluded } from "./frame.ts";
import { unitDiff } from "./git.ts";
import { allFiles, baseTree, COMPARE_BATCH, LIST_BATCH, listRepos, openDxGitHub, readWindow, repoUnion, tagsContain, UNIT_BATCH, unitFactsMany, type FrameRepo, type ListedPr, type Listing } from "./github.ts";
import { DEVEX_FILTERS, DEVEX_RELEASED_BY, drawOne, earliestBefore, excludedDigests, inDates, PER_REPO, planText, releaseByAncestry, treeFacts, unitOrder, type Candidate, type Drawn, type Step, type UnitFacts } from "./units.ts";
import { basePaths, type UnitRead } from "./handover.ts";
import { paced, PACE } from "./pace.ts";
import { DIFF_BYTES, screenRead } from "./window.ts";

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

/** What the tests and the dry run swap in: the gh executable, the clock and the diff. */
export interface MineDeps {
  exec?: GhExec;
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
  const item = flag(rest, "--item");
  if (!(maxDraws > 0) || !(pace > 0) || !(maxMinutes > 0) || (reposArg !== "all" && !(Number(reposArg) > 0))) throw usage("--draws, --pace and --max-minutes take positive numbers, --repos a count or all");
  const deadline = now() + maxMinutes * 60_000;
  const gh = paced(raw, { pace, now, sleep, log: (r) => log({ step: "rate", ...r }) });
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
  let work = 0;
  const due = () => work > 0 && now() >= deadline;
  const todo = listed.filter((r) => !listing.has(r.repo));
  for (let i = 0; i < todo.length && !due(); i += LIST_BATCH, work++) {
    for (const l of listRepos(gh, todo.slice(i, i + LIST_BATCH))) {
      appendFileSync(listingFile, JSON.stringify(l) + "\n");
      listing.set(l.repo, l);
    }
  }

  const units = listed.every((r) => listing.has(r.repo))
    ? listed.filter((r) => r.sides.includes(side)).flatMap((r) => listing.get(r.repo)!.prs.map((pr) => ({ repo: r, pr, order: unitOrder(r.repo, pr.number) }))).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    : null;
  const progFile = join(out, "progress.jsonl");
  const prog = readJsonl<Progress>(progFile);
  if (units && prog.length && units[prog.length - 1]?.order !== prog[prog.length - 1]!.order) throw Object.assign(new Error("progress.jsonl does not follow the listing's draw order; the listing changed under a draw in progress"), { code: "E_MINE_SOURCE" });
  const kept: Drawn[] = [], drops: Record<string, number> = {};
  const count = (step: Step) => ("keep" in step ? kept.push(step.keep) : (drops[step.drop] = (drops[step.drop] ?? 0) + 1));
  for (const p of prog) count(p.step);
  const rows = prog.flatMap((p) => (p.screen ? [p.screen] : []));
  if (rows.length) writeFileSync(join(out, "screen.jsonl"), rows.map((r) => JSON.stringify(r) + "\n").join(""));

  const plan = { side, filters: side === "dev" ? DEVEX_FILTERS : [], releasedBy: DEVEX_RELEASED_BY, perRepo: PER_REPO, excluded: excludedDigests() };
  const end = units ? Math.min(units.length, maxDraws) : 0;
  let meter: Meter | null = null;
  if (item && units && prog.length < end) meter = await openMeter({ item, runId: item, out: join(out, "journal"), cacheDir: join(out, "cache"), maxOutputTokens: 2000, driftCode: "E_DX_PROVIDER_DRIFT", onDrift: "stop-model", arm: "dx" });
  try {
    if (units) {
      const shallowOf = (repo: FrameRepo, pr: ListedPr): UnitFacts => ({ repo: repo.repo, number: pr.number, title: pr.title, labels: pr.labels, created_at: pr.created_at, merged_at: pr.merged_at, base_ref: pr.base_ref, default_branch: repo.default_branch, body: { created_at: pr.created_at, current: "", last_edited_at: null, edits: [] }, closing: [], commits: [], files: pr.files, merge_sha: null, base_sha: null });
      const quick = (j: number) => plan.excluded.has(units[j]!.order) || !inDates(shallowOf(units[j]!.repo, units[j]!.pr)) || titleExcluded(units[j]!.pr.title, units[j]!.pr.labels);
      const facts = new Map<number, ReturnType<typeof unitFactsMany>[number]>();
      const load = (i: number) => {
        if (!facts.has(i)) {
          const want = [i];
          for (let j = i + 1; j < end && want.length < UNIT_BATCH; j++) if (!facts.has(j) && !quick(j)) want.push(j);
          const got = unitFactsMany(gh, want.map((j) => ({ repo: units[j]!.repo, pr: units[j]!.pr, files: allFiles(gh, units[j]!.repo.repo, units[j]!.pr) })));
          want.forEach((j, k) => facts.set(j, got[k]!));
        }
        return facts.get(i)!;
      };
      for (let i = prog.length; i < end && !due(); i++, work++) {
        const { repo, pr, order } = units[i]!;
        const rel = listing.get(repo.repo)!;
        let paths: ReturnType<typeof basePaths> | null = null;
        const c: Candidate = {
          facts: shallowOf(repo, pr),
          full: () => load(i).facts,
          repo: { topics: repo.topics, stratum: repo.stratum, licence_field: repo.licence_field },
          release: () => {
            const f = c.full();
            if (!f.merge_sha) return null;
            const seq: string[] = [];
            releaseByAncestry(f.merged_at, DEVEX_RELEASED_BY, rel.releases, rel.tags, (tag) => (seq.push(tag), false));
            const known = new Map<string, boolean>();
            return releaseByAncestry(f.merged_at, DEVEX_RELEASED_BY, rel.releases, rel.tags, (tag) => {
              if (!known.has(tag)) {
                const chunk = seq.slice(seq.indexOf(tag)).filter((t) => !known.has(t)).slice(0, COMPARE_BATCH);
                tagsContain(gh, f.repo, f.merge_sha!, chunk).forEach((v, k) => known.set(chunk[k]!, v));
              }
              return known.get(tag)!;
            });
          },
          label: async () => {
            const f = c.full();
            if (!meter) {
              const m = mechanicalSide({ title: f.title, labels: f.labels, body: earliestBefore(f.body, f.merged_at) ?? "", files: f.files }, repo);
              return { dev: m.dev.length > 0, ui: m.ui.length > 0 };
            }
            const l = (await classify(meter, f.repo + "#" + f.number, { title: f.title, body: earliestBefore(f.body, f.merged_at) ?? "", closing: f.closing.filter((x) => x.created_at < f.merged_at).map((x) => ({ title: x.title, body: earliestBefore(x.body, f.merged_at) ?? "" })), files: f.files.map((x) => x.path) })).label;
            return l ? { dev: l.developer_facing, ui: l.ui } : null;
          },
          base: () => {
            const f = c.full();
            if (!f.base_sha) return null;
            const t = baseTree(gh, f.repo, f.base_sha);
            paths = basePaths(t.tree);
            return treeFacts(t.tree, t.truncated, t.licence);
          },
        };
        const step = await drawOne(c, plan, kept);
        let screen: Progress["screen"];
        if ("keep" in step && step.keep.window.to <= cutoff) {
          const k = step.keep, f = c.full(), text = planText(f).text;
          const r = screenRead({ repo: k.repo, number: k.number, title: f.title, text, closing: f.closing.map((x) => x.number), files: f.files.map((x) => x.path), diff: f.base_sha && f.merge_sha ? (deps.diff ?? unitDiff)(k.repo, f.base_sha, f.merge_sha, join(out, "clones"), DIFF_BYTES) : null, timeline_refs: load(i).timeline_refs }, readWindow(gh, k.repo, k.window));
          if (r.screen.positive) {
            const read: UnitRead = { id: k.id, source: text, base_sha: f.base_sha, ...(paths ?? { readme_path: null, manifest_paths: [] }), records: r.records, candidates: r.candidates };
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
        facts.delete(i);
      }
    }
  } finally {
    if (meter) await meter.close();
  }
  const finished = !!units && prog.length >= end;
  if (finished) writeFileSync(join(out, "draws.json"), JSON.stringify({ kept, drops, draws: prog.length, steps: prog.map((p) => ({ order: p.order, step: p.step })) }));
  const last = gh.read("end");
  const summary = { status: finished ? "finished" : "more remains", phase: units ? "draw" : "listing", listed: listed.filter((r) => listing.has(r.repo)).length, of: listed.length, candidates: units?.length ?? null, draws: prog.length, kept: kept.length, drops, window_open: kept.filter((k) => k.window.to > cutoff).length, screened: rows.length, screen_positive: rows.filter((r) => r.positive).length, classifier: item ? "panel" : "mechanical stand-in (no model call)", graphql_before: first.remaining, graphql_after: last.remaining, points: gh.pointsUsed(), calls: gh.calls() };
  log({ step: "draw", ...summary });
  io.out("dx mine draw: " + summary.status + " " + JSON.stringify(summary));
  return finished ? 0 : MORE_REMAINS;
}
