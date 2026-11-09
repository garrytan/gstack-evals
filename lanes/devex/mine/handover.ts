// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dx handover (devex prereg sections 3, 4 and 11): the miner's output handed to authoring.
//   dx handover --from <miner out> --units <dir> [--now <iso>]
// For each kept unit that is screen-positive and whose window has closed, in draw order, it writes
// <units>/<id>/funnel.json (the funnel's input plus draw_digest) and <units>/<id>/alias.json (the forward alias map), as
// dx author reads them. Every field but the README comes from what the miner read and kept: draws.json, screen.jsonl
// and read/<draw digest>.json. The base README and manifest files for the alias map are read through the miner's
// GraphQL client as object(expression: "<sha>:<path>"), so no repository code is fetched or run here; the snapshot is
// built later, for keyed units only, with the same alias.json. Each unit's id is minted from random bytes, never from a
// name, a sha or a number, and ids.json under --units maps it to its repository, pull request and draw digest so
// custody seals the map with the units; a rerun reuses every id and skips a unit already written. --units sits outside
// the repository and is either new or this command's own earlier output. Stdout carries counts only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitHub } from "../../aftermath/gh.ts";
import { insideRepo } from "../../review-noloss/suite.ts";
import { DX_UNIT_ID } from "../../../src/trial/review/devex.ts";
import { put, readJson, type UnitFile } from "../author/cli.ts";
import { DxError, type Candidate, type WindowRecord } from "../author/funnel.ts";
import type { Io } from "../cli.ts";
import { buildAliasMap, type Manifest } from "../unit/alias.ts";
import { openDxGitHub } from "./github.ts";
import type { Drawn } from "./units.ts";
import type { Screen } from "./window.ts";

/** What the miner keeps for a screen-positive unit, at read/<draw digest>.json under its --out. */
export interface UnitRead {
  id: string;
  /** The plan text the screen read: the earliest pre-merge description and closing-issue bodies. */
  source: string;
  base_sha: string | null;
  readme_path: string | null;
  manifest_paths: string[];
  records: WindowRecord[];
  candidates: Candidate[];
}

interface IdsFile {
  written_by: "dx handover";
  units: Array<{ id: string; repo: string; number: number; draw_digest: string }>;
}

const MANIFESTS = new Set(["package.json", "composer.json", "Cargo.toml", "pyproject.toml", "setup.cfg", "go.mod"]);
const SKIP_DIRS = new Set(["node_modules", "vendor", "third_party", "test", "tests", "testdata", "fixtures", "examples", "example", "docs"]);
/** Manifests are read from the root and at most two folders down, outside vendored, test, example and docs folders. */
export const MANIFEST_DEPTH = 3;
export const MANIFEST_MAX = 20;
const README = /^readme(\.[a-z]+)?$/i;

/** From the base tree the miner walked: the root README (a Markdown one first) and the manifest files the alias map reads. */
export function basePaths(tree: ReadonlyArray<{ path: string; type: string }>): { readme_path: string | null; manifest_paths: string[] } {
  const blobs = tree.filter((e) => e.type === "blob").map((e) => e.path);
  const readme = blobs.filter((p) => !p.includes("/") && README.test(p)).sort((a, b) => Number(!/\.md$/i.test(a)) - Number(!/\.md$/i.test(b)) || (a < b ? -1 : 1))[0] ?? null;
  const manifests = blobs
    .map((p) => p.split("/"))
    .filter((s) => s.length <= MANIFEST_DEPTH && (MANIFESTS.has(s[s.length - 1]!) || s[s.length - 1]!.endsWith(".gemspec")) && !s.slice(0, -1).some((d) => SKIP_DIRS.has(d.toLowerCase())))
    .sort((a, b) => a.length - b.length || (a.join("/") < b.join("/") ? -1 : 1))
    .slice(0, MANIFEST_MAX)
    .map((s) => s.join("/"));
  return { readme_path: readme, manifest_paths: manifests };
}

/** The README and manifests at the base sha, in one GraphQL call; a binary or unreadable file is left out. */
export function readBase(gh: GitHub, repo: string, read: Pick<UnitRead, "base_sha" | "readme_path" | "manifest_paths">): { readme: string | null; manifests: Manifest[] } {
  const paths = [...(read.readme_path ? [read.readme_path] : []), ...read.manifest_paths];
  if (!read.base_sha || !paths.length) return { readme: null, manifests: [] };
  const [owner, name] = repo.split("/");
  const q = "query($owner: String!, $name: String!" + paths.map((_, i) => ", $e" + i + ": String!").join("") + ") { repository(owner: $owner, name: $name) { " + paths.map((_, i) => "f" + i + ": object(expression: $e" + i + ") { ... on Blob { text isBinary } }").join(" ") + " } rateLimit { cost remaining resetAt } }";
  const r = gh.graphql<any>(q, { owner, name, ...Object.fromEntries(paths.map((p, i) => ["e" + i, read.base_sha + ":" + p])) }).repository;
  const text = (i: number): string | null => {
    const b = r?.["f" + i];
    return b && !b.isBinary && typeof b.text === "string" ? b.text : null;
  };
  const off = read.readme_path ? 1 : 0;
  return { readme: read.readme_path ? text(0) : null, manifests: read.manifest_paths.flatMap((path, i) => (text(i + off) === null ? [] : [{ path, text: text(i + off)! }])) };
}

const flag = (argv: string[], name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const USAGE = "dx handover --from <miner out> --units <dir outside the repo> [--now <iso>]";

function mint(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = "u" + Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex");
    if (DX_UNIT_ID.test(id) && !taken.has(id)) return id;
  }
}

export async function run(argv: string[], io: Io, over: { gh?: GitHub } = {}): Promise<number> {
  const from = flag(argv, "--from"), units = flag(argv, "--units"), now = flag(argv, "--now") ?? new Date().toISOString();
  if (!from || !units || Number.isNaN(Date.parse(now))) throw new DxError("E_USAGE", USAGE);
  if (insideRepo(units)) throw new DxError("E_USAGE", "--units " + units + " is inside the repository; unit text goes outside it");
  const idsFile = join(units, "ids.json");
  if (existsSync(units) && !(existsSync(idsFile) && readJson<IdsFile>(idsFile).written_by === "dx handover")) throw new DxError("E_USAGE", "--units " + units + " exists and is not dx handover's own output; name a new directory");
  if (!existsSync(join(from, "draws.json"))) throw new DxError("E_USAGE", "--from " + from + " holds no draws.json; run dx mine draw first");
  const kept = [...readJson<{ kept: Drawn[] }>(join(from, "draws.json")).kept].sort((a, b) => (a.order < b.order ? -1 : 1));
  const screened = new Map<string, Screen>();
  const screenFile = join(from, "screen.jsonl");
  if (existsSync(screenFile)) for (const l of readFileSync(screenFile, "utf8").split("\n").filter(Boolean)) {
    const s = JSON.parse(l) as Screen & { id: string };
    screened.set(s.id, s);
  }
  const ids: IdsFile = existsSync(idsFile) ? readJson<IdsFile>(idsFile) : { written_by: "dx handover", units: [] };
  const counts = { written: 0, "window-open": 0, "screen-negative": 0, unscreened: 0, unread: 0, already: 0 };
  let gh = over.gh ?? null;
  for (const k of kept) {
    if (Date.parse(k.window.to) > Date.parse(now)) {
      counts["window-open"]++;
      continue;
    }
    const s = screened.get(k.id);
    if (!s) {
      counts.unscreened++;
      continue;
    }
    if (!s.positive) {
      counts["screen-negative"]++;
      continue;
    }
    let entry = ids.units.find((u) => u.draw_digest === k.order);
    if (entry && existsSync(join(units, entry.id, "funnel.json"))) {
      counts.already++;
      continue;
    }
    const readFile = join(from, "read", k.order + ".json");
    if (!existsSync(readFile)) {
      counts.unread++;
      continue;
    }
    const read = readJson<UnitRead>(readFile);
    if (!entry) {
      entry = { id: mint(new Set(ids.units.map((u) => u.id))), repo: k.repo, number: k.number, draw_digest: k.order };
      ids.units.push(entry);
      put(idsFile, ids);
    }
    gh ??= openDxGitHub();
    const base = readBase(gh, k.repo, read);
    const [owner, project] = k.repo.split("/") as [string, string];
    const alias = buildAliasMap({ owner, project, readme: base.readme, manifests: base.manifests, seed: k.order });
    const unit: UnitFile = { id: entry.id, release_at: k.release.published_at, window: k.window, source: read.source, identifiers: s.identifiers.map((x) => x.token), candidates: read.candidates, records: read.records, readme: base.readme ?? "", real_names: [...new Set([k.repo, ...alias.entries.map((e) => e.original)])], draw_digest: k.order };
    put(join(units, entry.id, "alias.json"), alias);
    put(join(units, entry.id, "funnel.json"), unit);
    counts.written++;
  }
  io.out("dx handover: written " + counts.written + "; skipped window-open " + counts["window-open"] + ", screen-negative " + counts["screen-negative"] + ", unscreened " + counts.unscreened + ", unread " + counts.unread + ", already " + counts.already);
  return 0;
}
