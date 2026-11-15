// Copyright (c) 2026 Garry Tan. MIT License.
// The O frame's two freeze-date reads (plan section 5): each candidate repository's licence, read once through GitHub's
// GraphQL API with the authenticated gh CLI and frozen as o-licences.json, and SWE-bench-Live MultiLang's Hugging Face
// head, recorded in o-frame.json beside the revision the state machines harness pins.
import { spawnSync } from "node:child_process";
import { h2hFail } from "../prereg.ts";
import { LICENCES_SCHEMA, type LicenceRead } from "./frame.ts";

export const LICENCE_QUERY = "repository(owner, name) { nameWithOwner licenseInfo { spdxId } }";
const BATCH = 50;

export type GraphQl = (query: string) => { status: number; stdout: string; stderr: string };
export const ghGraphQl: GraphQl = (query) => {
  const r = spawnSync("gh", ["api", "graphql", "-f", "query=" + query], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 << 20 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** One GraphQL read per 50 repositories. A repository GitHub does not find reads as no licence; any other error, or an
 *  answer without data, refuses (E_H2H_O_LICENCE). */
export function readLicencesGraphQl(repos: readonly string[], now: Date = new Date(), call: GraphQl = ghGraphQl): LicenceRead {
  const sorted = [...new Set(repos)].sort();
  const out: LicenceRead = { schema: LICENCES_SCHEMA, read_at: now.toISOString(), query: LICENCE_QUERY, repos: {} };
  for (let i = 0; i < sorted.length; i += BATCH) {
    const part = sorted.slice(i, i + BATCH);
    const q = "query { " + part.map((r, k) => {
      const [owner, name] = r.split("/");
      if (!owner || !name) h2hFail("E_H2H_O_LICENCE", JSON.stringify(r) + " is not owner/name");
      return "r" + k + ": repository(owner: " + JSON.stringify(owner) + ", name: " + JSON.stringify(name) + ") { nameWithOwner licenseInfo { spdxId } }";
    }).join(" ") + " }";
    const res = call(q);
    let j: { data?: Record<string, { nameWithOwner: string; licenseInfo: { spdxId: string } | null } | null>; errors?: { type?: string; path?: string[]; message?: string }[] };
    try {
      j = JSON.parse(res.stdout);
    } catch {
      return h2hFail("E_H2H_O_LICENCE", "gh api graphql answered with no JSON (exit " + res.status + "): " + res.stderr.slice(-300));
    }
    const other = (j.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
    if (!j.data || other.length) h2hFail("E_H2H_O_LICENCE", "gh api graphql answered with errors: " + JSON.stringify(other.slice(0, 3)).slice(0, 400));
    part.forEach((r, k) => {
      const v = j.data!["r" + k];
      out.repos[r] = { spdx: v?.licenseInfo?.spdxId ?? null, name_with_owner: v?.nameWithOwner ?? null };
    });
  }
  return out;
}

export interface HeadRead { sha: string; last_modified: string | null; read_at: string }
/** The dataset's current Hugging Face head, keyless. */
export async function readHfHead(dataset: string, fetchFn: typeof fetch = fetch, now: Date = new Date()): Promise<HeadRead> {
  const res = await fetchFn("https://huggingface.co/api/datasets/" + dataset);
  if (!res.ok) h2hFail("E_H2H_O_SOURCE", "Hugging Face answered " + res.status + " for " + dataset);
  const j = (await res.json()) as { sha?: string; lastModified?: string };
  if (!j.sha || !/^[0-9a-f]{40}$/.test(j.sha)) h2hFail("E_H2H_O_SOURCE", "Hugging Face gave no revision for " + dataset);
  return { sha: j.sha!, last_modified: j.lastModified ?? null, read_at: now.toISOString() };
}
