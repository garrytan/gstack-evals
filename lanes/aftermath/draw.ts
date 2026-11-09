// Copyright (c) 2026 Garry Tan. MIT License.
// Seeded draw order and the repository topic search shared by the aftermath evals' miners (product-value prereg
// section 4; devex prereg section 4 and the shared frame's part A). A unit's or repository's place is
// sha256(seed + newline + id); a topic search reads GitHub's repository search page by page, pacing each call.
import { createHash } from "node:crypto";

/** sha256(seed + newline + id), the order key every draw sorts on. */
export const drawOrder = (seed: string | number, id: string) => createHash("sha256").update(String(seed) + "\n" + id).digest("hex");

export interface TopicQuery {
  topic: string;
  /** The stars qualifier, such as ">=500" or "500..999". */
  stars: string;
  pushedSince: string;
  maxPages: number;
  /** Milliseconds to wait after each search call (search allows 30 a minute). */
  paceMs: number;
}

/** One topic's repositories, sorted by stars, page by page until a short page or maxPages; onPage sees each page as it lands. */
export function searchTopic(rest: (path: string) => any, q: TopicQuery, onPage: (items: any[]) => void = () => {}, sleep: (ms: number) => void = (ms) => Bun.sleepSync(ms)): { items: any[]; total: number } {
  const items: any[] = [];
  let total = 0;
  for (let page = 1; page <= q.maxPages; page++) {
    const query = encodeURIComponent("topic:" + q.topic + " stars:" + q.stars + " pushed:>=" + q.pushedSince + " archived:false fork:false");
    const r = rest("search/repositories?q=" + query + "&sort=stars&order=desc&per_page=100&page=" + page);
    sleep(q.paceMs);
    total = r.total_count ?? total;
    items.push(...(r.items ?? []));
    onPage(r.items ?? []);
    if ((r.items ?? []).length < 100) break;
  }
  return { items, total };
}
