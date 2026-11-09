// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx mine (devex prereg sections 3 and 4; design prereg frame-rules.md): one public miner for both evals,
// GitHub only. The side and the eval's own filters are parameters (devex: side dev, the post's five filters, released
// by 2026-09-30).
//   dx mine repos --out <dir>                       the topic-search union, recorded with its date (repos.json)
//   dx mine draw --out <dir> --draws <n> [--repos <n>] [--side dev|ui] [--item <ledger item>]
//       repositories in seeded order, their units in draw order through every rule, then the window read and the
//       free screen for kept units whose window has closed. With --item the frozen classifier runs on that ledger
//       item; without it no model is called and the mechanical prefilter's side stands in (a smoke), and says so.
// Records name repositories, so --out must sit outside the repository; only counts belong in anything committed.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { drawOrder } from "../../aftermath/draw.ts";
import { openMeter, type Meter } from "../../aftermath/meter.ts";
import type { Io } from "../cli.ts";
import { SEED } from "../types.ts";
import { classify } from "./classify.ts";
import { mechanicalSide } from "./frame.ts";
import { unitDiff } from "./git.ts";
import { allFiles, baseTree, listPrs, openDxGitHub, readWindow, releasesOf, repoUnion, tagContains, unitFacts, type FrameRepo } from "./github.ts";
import { DEVEX_FILTERS, DEVEX_RELEASED_BY, draw, earliestBefore, excludedDigests, PER_REPO, planText, releaseByAncestry, treeFacts, type Candidate, type UnitFacts } from "./units.ts";
import { DIFF_BYTES, screen } from "./window.ts";

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const usage = (m: string) => Object.assign(new Error(m), { code: "E_USAGE" });

export async function run(argv: string[], io: Io): Promise<number> {
  const [sub, ...rest] = argv;
  const out = flag(rest, "--out");
  if (!out || (sub !== "repos" && sub !== "draw")) throw usage("dx mine repos|draw --out <dir outside the repo> ...");
  if (resolve(out).startsWith(resolve(import.meta.dir, "../../.."))) throw usage("--out must sit outside the repository: mine records name repositories");
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const gh = openDxGitHub();
  const before = gh.graphqlLeft();
  const log = (o: Record<string, unknown>) => appendFileSync(join(out, "mine.log"), JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
  if (sub === "repos") {
    const u = repoUnion(gh);
    writeFileSync(join(out, "repos.json"), JSON.stringify(u));
    const after = gh.graphqlLeft();
    log({ step: "repos", repos: u.repos.length, short: u.short.length, graphql_before: before.remaining, graphql_after: after.remaining, points: gh.pointsUsed(), calls: gh.calls() });
    io.out("dx mine repos: " + u.repos.length + " repositories in the frame, searched " + u.searched_at + "; " + u.short.length + " topic bands read short");
    return 0;
  }
  const side = (flag(rest, "--side") ?? "dev") as "dev" | "ui";
  const maxDraws = Number(flag(rest, "--draws") ?? "25");
  const maxRepos = Number(flag(rest, "--repos") ?? "12");
  const item = flag(rest, "--item");
  const union = JSON.parse(readFileSync(join(out, "repos.json"), "utf8")) as { repos: FrameRepo[] };
  const repos = union.repos.filter((r) => r.sides.includes(side)).sort((a, b) => (drawOrder(SEED, a.repo) < drawOrder(SEED, b.repo) ? -1 : 1)).slice(0, maxRepos);
  let meter: Meter | null = null;
  if (item) meter = await openMeter({ item, runId: item, out: join(out, "journal"), cacheDir: join(out, "cache"), maxOutputTokens: 2000, driftCode: "E_DX_PROVIDER_DRIFT", onDrift: "stop-model", arm: "dx" });
  const cands: Candidate[] = [];
  const refs = new Map<string, Array<{ kind: "issue" | "pr"; number: number }>>();
  try {
    for (const repo of repos) {
      const rel = releasesOf(gh, repo.repo);
      for (const pr of listPrs(gh, repo)) {
        let full: UnitFacts | null = null;
        const load = (): UnitFacts => {
          if (!full) {
            const r = unitFacts(gh, repo, pr, allFiles(gh, repo.repo, pr));
            full = r.facts;
            refs.set(repo.repo + "#" + pr.number, r.timeline_refs);
          }
          return full;
        };
        const shallow: UnitFacts = { repo: repo.repo, number: pr.number, title: pr.title, labels: pr.labels, created_at: pr.created_at, merged_at: pr.merged_at, base_ref: pr.base_ref, default_branch: repo.default_branch, body: { created_at: pr.created_at, current: "", last_edited_at: null, edits: [] }, closing: [], commits: [], files: pr.files, merge_sha: null, base_sha: null };
        const c: Candidate = {
          facts: shallow,
          full: load,
          repo: { topics: repo.topics, stratum: repo.stratum, licence_field: repo.licence_field },
          release: () => {
            const f = load();
            return f.merge_sha ? releaseByAncestry(f.merged_at, DEVEX_RELEASED_BY, rel.releases, rel.tags, (tag) => tagContains(gh, f.repo, f.merge_sha!, tag)) : null;
          },
          label: async () => {
            const f = load();
            if (!meter) {
              const m = mechanicalSide({ title: f.title, labels: f.labels, body: earliestBefore(f.body, f.merged_at) ?? "", files: f.files }, repo);
              return { dev: m.dev.length > 0, ui: m.ui.length > 0 };
            }
            const l = (await classify(meter, f.repo + "#" + f.number, { title: f.title, body: earliestBefore(f.body, f.merged_at) ?? "", closing: f.closing.filter((x) => x.created_at < f.merged_at).map((x) => ({ title: x.title, body: earliestBefore(x.body, f.merged_at) ?? "" })), files: f.files.map((x) => x.path) })).label;
            return l ? { dev: l.developer_facing, ui: l.ui } : null;
          },
          base: () => {
            const f = load();
            if (!f.base_sha) return null;
            const t = baseTree(gh, f.repo, f.base_sha);
            return treeFacts(t.tree, t.truncated, t.licence);
          },
        };
        cands.push(c);
      }
    }
    const result = await draw(cands, { side, filters: side === "dev" ? DEVEX_FILTERS : [], releasedBy: DEVEX_RELEASED_BY, perRepo: PER_REPO, excluded: excludedDigests() }, maxDraws);
    const today = new Date().toISOString();
    let positive = 0, open = 0, screened = 0;
    for (const k of result.kept) {
      if (k.window.to > today) {
        open++;
        continue;
      }
      const f = cands.find((c) => c.facts.repo === k.repo && c.facts.number === k.number)!.full();
      const s = screen({ repo: k.repo, number: k.number, title: f.title, text: planText(f).text, closing: f.closing.map((c) => c.number), files: f.files.map((x) => x.path), diff: f.base_sha && f.merge_sha ? unitDiff(k.repo, f.base_sha, f.merge_sha, join(out, "clones"), DIFF_BYTES) : null, timeline_refs: refs.get(k.id) ?? [] }, readWindow(gh, k.repo, k.window));
      screened++;
      if (s.positive) positive++;
      appendFileSync(join(out, "screen.jsonl"), JSON.stringify({ id: k.id, prerelease: k.release.prerelease, ...s }) + "\n");
    }
    writeFileSync(join(out, "draws.json"), JSON.stringify({ ...result, steps: result.steps }));
    const after = gh.graphqlLeft();
    const summary = { draws: result.draws, kept: result.kept.length, drops: result.drops, window_open: open, screened, screen_positive: positive, classifier: meter ? "panel" : "mechanical stand-in (no model call)", graphql_before: before.remaining, graphql_after: after.remaining, points: gh.pointsUsed(), calls: gh.calls() };
    log({ step: "draw", ...summary });
    io.out("dx mine draw: " + JSON.stringify(summary));
  } finally {
    if (meter) await meter.close();
  }
  return 0;
}
