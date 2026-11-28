// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit repository search (plan section 2, repository frame): a frozen GitHub search per ecosystem (300 to
// 50,000 stars in three bands, pushed since October 2026, at most 300 MB, no forks or archives), with each query's text
// and the search date recorded, then a draw in an order seeded from random bytes minted and recorded before the draw.
// The manifest is frozen by its digest before screening. Licence and test needs are read later, at the fix commit and
// at the screen. Real repository names stay in the manifest on the screening host and are never committed.
import { createHash, randomBytes } from "node:crypto";
import { FROZEN } from "../frozen.ts";
import type { Ecosystem } from "../types.ts";
import { digest, type GitHub, type Manifest, type ManifestRow } from "./local.ts";

export const LANGUAGES: Record<Ecosystem, string[]> = { go: ["Go"], node: ["TypeScript", "JavaScript"], python: ["Python"], rust: ["Rust"] };
const BANDS = ["300..999", "1000..9999", "10000..50000"];

/** The frozen query texts for one ecosystem. */
export const queries = (eco: Ecosystem): string[] =>
  LANGUAGES[eco].flatMap((lang) => BANDS.map((stars) => "language:" + lang + " stars:" + stars + " pushed:>=" + FROZEN.frame.pushedMonth + "-01 size:<=" + FROZEN.frame.maxRepoMB * 1024 + " fork:false archived:false"));

/** A reader of the GitHub REST API. A token from GITHUB_TOKEN, when set, raises the rate limit; a rate-limited read
 * waits for the reset and tries again, up to three times. */
export function githubReader(token = process.env.GITHUB_TOKEN): GitHub {
  return async (path) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch("https://api.github.com" + path, { headers: { Accept: "application/vnd.github+json", "User-Agent": "gstack-evals", ...(token ? { Authorization: "Bearer " + token } : {}) } });
      const limited = (res.status === 403 || res.status === 429) && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"));
      if (!limited || attempt >= 3) return { status: res.status, body: await res.json().catch(() => null) };
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      const wait = res.headers.has("retry-after") ? Number(res.headers.get("retry-after")) * 1000 : Math.max(1000, reset - Date.now() + 1000);
      await new Promise((r) => setTimeout(r, Math.min(wait, 3600000)));
    }
  };
}

/** Runs one ecosystem's queries, up to pages of 100 results each. */
export async function search(github: GitHub, eco: Ecosystem, pages = 10): Promise<{ queries: Manifest["queries"]; rows: ManifestRow[] }> {
  const qs: Manifest["queries"] = [];
  const rows: ManifestRow[] = [];
  for (const text of queries(eco)) {
    const q = { eco, text, total: 0, read: 0 };
    qs.push(q);
    for (let page = 1; page <= pages; page++) {
      const r = await github("/search/repositories?q=" + encodeURIComponent(text) + "&sort=stars&order=desc&per_page=100&page=" + page);
      if (r.status !== 200 || !Array.isArray(r.body?.items)) break;
      q.total = Number(r.body.total_count ?? 0);
      for (const it of r.body.items) rows.push({ repo: String(it.full_name), eco, stars: Number(it.stargazers_count), sizeKB: Number(it.size), pushedAt: String(it.pushed_at), query: qs.length - 1 });
      q.read += r.body.items.length;
      if (r.body.items.length < 100) break;
    }
  }
  return { queries: qs, rows };
}

/** A seed for the draw, minted from random bytes. */
export const mintSeed = (): string => randomBytes(16).toString("hex");

/** The seeded draw: rows in the frame, one per repository, ordered by a hash of the seed and the repository, the first
 * perEco of each ecosystem kept. */
export function draw(rows: ManifestRow[], seed: string, perEco: number): ManifestRow[] {
  const key = (r: ManifestRow) => createHash("sha256").update(seed + "\0" + r.repo).digest("hex");
  const inFrame = (r: ManifestRow) => r.stars >= FROZEN.frame.stars.min && r.stars <= FROZEN.frame.stars.max && r.sizeKB <= FROZEN.frame.maxRepoMB * 1024 && r.pushedAt.slice(0, 7) >= FROZEN.frame.pushedMonth;
  const seen = new Set<string>();
  const ordered = rows.filter((r) => inFrame(r) && !seen.has(r.repo) && seen.add(r.repo)).sort((a, b) => key(a).localeCompare(key(b)));
  const count = new Map<Ecosystem, number>();
  return ordered.filter((r) => {
    const n = count.get(r.eco) ?? 0;
    if (n >= perEco) return false;
    count.set(r.eco, n + 1);
    return true;
  });
}

/** The manifest's frozen text and digest. */
export function freeze(m: Manifest): { text: string; digest: string } {
  const text = JSON.stringify(m, null, 1) + "\n";
  return { text, digest: digest(text) };
}
