// Copyright (c) 2026 Garry Tan. MIT License.
// The state machines family's source (post section 3): SWE-bench-Live MultiLang at its pinned Hugging Face revision, read
// from the dataset's own parquet files (keyless downloads, each checked against its pinned sha256), and each candidate's
// image pinned to its linux/amd64 manifest digest by a registry HEAD, the way swerebench-r3a4.json pins image_digest.
// candidates.json carries ids, months, languages, digests and counts only; row bytes stay in the local cache.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classify, DATASET_LANG, featFirst800, type Lang } from "./langs.ts";
import { smFail } from "./unit.ts";

export const MULTILANG = {
  dataset: "SWE-bench-Live/MultiLang",
  revision: "eb09c2e5db6e4c5a95e01c903c8fd1d5da33c4f3",
  files: {
    c: "a4c382c1416ee6e19964931998610f0bf1adc5132516ed034202675ad77541de",
    cpp: "8448db887817b63e4c0c284ca99de1ccda15023f48e5b2234a4084466e0768ae",
    cs: "29ffe16d0b2cd802e753262b8b0d7fe3f2bb1b489396da238146e79f37937c1f",
    go: "76d2b5dff0f3fac8303d30fa85495539e487d25974ad7c21cd21a545cb4756e2",
    java: "00387685808c71d21ada175335304b1c118859453afadd58ea21a00b0d568ee8",
    js: "bc6ec49ffaf9db97840d55eba6954fae8f5fb0fb071cf49e187f36ffadd55a7a",
    rust: "02ac78e2c51a84eb174ac393bb07b77478f1f96cf260af18835a711dd8074ebc",
    ts: "7e23783e27230c9cfab1035690035c25523043d6af635bc78da3fd2010c32714",
  } as Record<string, string>,
};
/** pyarrow for the keyless parquet read (parquet.py, under uv). */
export const PYARROW = "22.0.0";
/** The post's window: units created from this date. */
export const WINDOW_START = "2026-03-01";

export interface MlRow {
  repo: string; pull_number: string; instance_id: string; base_commit: string; patch: string; test_patch: string;
  problem_statement: string; created_at: string; rebuild_cmds: string[]; test_cmds: string[]; print_cmds: string[];
  log_parser: string; FAIL_TO_PASS: string[]; PASS_TO_PASS: string[]; docker_image: string;
}

export interface Candidate {
  id: string; source: "live-multilang"; revision: string; repo: string; pull_number: string; created_at: string; month: string;
  lang: Lang; docker_image: string; image_digest: string | null; image_error?: string; base_commit: string; f2p: number; p2p: number;
  fix_files: number; fix_source_files: number; test_files: number; tests_share_fix_file: boolean; feature_screen: boolean;
  issue_sha256: string; row_sha256: string;
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Downloads each pinned parquet file into cache (if missing), checks its sha256 and converts it to JSON lines. */
export async function fetchMultiLang(cache: string, fetchFn: typeof fetch = fetch): Promise<void> {
  mkdirSync(cache, { recursive: true });
  for (const [stem, want] of Object.entries(MULTILANG.files)) {
    const pq = join(cache, stem + ".parquet");
    if (!existsSync(pq)) {
      const url = "https://huggingface.co/datasets/" + MULTILANG.dataset + "/resolve/" + MULTILANG.revision + "/data/" + stem + "-00000-of-00001.parquet";
      const res = await fetchFn(url);
      if (!res.ok) smFail("E_SM_SOURCE", url + " answered " + res.status);
      writeFileSync(pq + ".part", Buffer.from(await res.arrayBuffer()));
      renameSync(pq + ".part", pq);
    }
    const got = sha(readFileSync(pq));
    if (got !== want) smFail("E_SM_SOURCE", pq + " has sha256 " + got + ", not the pinned " + want + " (revision " + MULTILANG.revision + ")");
    const jl = join(cache, stem + ".jsonl");
    if (!existsSync(jl)) {
      const r = spawnSync("uv", ["run", "--no-project", "--with", "pyarrow==" + PYARROW, "python3", join(import.meta.dir, "parquet.py"), pq, jl], { encoding: "utf8", timeout: 600_000 });
      if (r.status !== 0) smFail("E_SM_SOURCE", "parquet.py could not read " + pq + ": " + (r.stderr ?? "").slice(-400));
    }
  }
}

/** Every row of the cached revision, with its language. The parquet files are checked against their pins on every read. */
export function readRows(cache: string): { lang: Lang; row: MlRow }[] {
  const out: { lang: Lang; row: MlRow }[] = [];
  for (const [stem, want] of Object.entries(MULTILANG.files)) {
    const pq = join(cache, stem + ".parquet");
    if (!existsSync(pq) || sha(readFileSync(pq)) !== want) smFail("E_SM_SOURCE", pq + " is missing or is not the pinned file; run sm source fetch");
    for (const line of readFileSync(join(cache, stem + ".jsonl"), "utf8").split("\n")) if (line) out.push({ lang: DATASET_LANG[stem]!, row: JSON.parse(line) as MlRow });
  }
  return out;
}

export const patchFiles = (patch: string): string[] => [...new Set([...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!))];

export function toCandidate(lang: Lang, row: MlRow): Candidate {
  const fix = patchFiles(row.patch);
  const tests = new Set(patchFiles(row.test_patch));
  const created = String(row.created_at);
  return {
    id: row.instance_id, source: "live-multilang", revision: MULTILANG.revision, repo: row.repo, pull_number: String(row.pull_number),
    created_at: created, month: created.slice(0, 7), lang, docker_image: row.docker_image, image_digest: null, base_commit: row.base_commit,
    f2p: (row.FAIL_TO_PASS ?? []).length, p2p: (row.PASS_TO_PASS ?? []).length,
    fix_files: fix.length, fix_source_files: fix.filter((f) => classify(lang, f, tests) === "source").length, test_files: tests.size,
    tests_share_fix_file: fix.some((f) => tests.has(f)), feature_screen: featFirst800(row.problem_statement ?? ""),
    issue_sha256: sha(row.problem_statement ?? ""), row_sha256: sha(JSON.stringify(row)),
  };
}

const ACCEPT = [
  "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.oci.image.manifest.v1+json",
].join(", ");
const isIndex = (t: string) => /manifest\.list|image\.index/.test(t);
export const splitImage = (image: string): { repo: string; tag: string } => {
  const m = image.match(/^(.+?)(?::([^:/]+))?$/)!;
  return { repo: m[1]!.includes("/") ? m[1]! : "library/" + m[1]!, tag: m[2] ?? "latest" };
};

async function token(repo: string, fetchFn: typeof fetch): Promise<string> {
  const r = await fetchFn("https://auth.docker.io/token?service=registry.docker.io&scope=repository:" + repo + ":pull");
  if (!r.ok) throw new Error("token " + r.status);
  return ((await r.json()) as { token: string }).token;
}

/** The linux/amd64 manifest digest by registry HEAD (not a counted pull). An index needs one GET to pick the platform,
 *  which onGet is told of, so the caller's pull pacing counts it. */
export async function pinDigest(image: string, fetchFn: typeof fetch = fetch, onGet: () => Promise<void> = async () => {}): Promise<string> {
  const { repo, tag } = splitImage(image);
  const auth = { Authorization: "Bearer " + (await token(repo, fetchFn)), Accept: ACCEPT };
  const url = "https://registry-1.docker.io/v2/" + repo + "/manifests/" + tag;
  const h = await fetchFn(url, { method: "HEAD", headers: auth });
  if (!h.ok) throw new Error("HEAD " + h.status);
  const digest = h.headers.get("docker-content-digest") ?? "";
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("no digest in the HEAD answer");
  if (!isIndex(h.headers.get("content-type") ?? "")) return digest;
  await onGet();
  const g = await fetchFn(url, { headers: auth });
  const idx = (await g.json()) as { manifests: { digest: string; platform?: { os: string; architecture: string } }[] };
  const m = idx.manifests.find((x) => x.platform?.os === "linux" && x.platform.architecture === "amd64");
  if (!m) throw new Error("no linux/amd64 manifest in the index");
  return m.digest;
}

/** Compressed image size from the manifest by digest, as docker pull reads it (one counted GET, told to onGet). */
export async function manifestSize(image: string, digest: string, fetchFn: typeof fetch = fetch, onGet: () => Promise<void> = async () => {}): Promise<number> {
  const { repo } = splitImage(image);
  await onGet();
  const r = await fetchFn("https://registry-1.docker.io/v2/" + repo + "/manifests/" + digest, { headers: { Authorization: "Bearer " + (await token(repo, fetchFn)), Accept: ACCEPT } });
  if (!r.ok) throw new Error("GET " + r.status);
  const m = (await r.json()) as { config?: { size: number }; layers?: { size: number }[] };
  return (m.config?.size ?? 0) + (m.layers ?? []).reduce((a, l) => a + l.size, 0);
}

/** sm source pin: every row to a candidate, each image pinned by digest (8 at a time). */
export async function pinCandidates(cache: string, fetchFn: typeof fetch = fetch): Promise<Candidate[]> {
  const cands = readRows(cache).map(({ lang, row }) => toCandidate(lang, row));
  let next = 0;
  const work = async () => {
    while (next < cands.length) {
      const c = cands[next++]!;
      try {
        c.image_digest = await pinDigest(c.docker_image, fetchFn);
      } catch (e) {
        c.image_error = (e as Error).message;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  return cands.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const imageRef = (c: { docker_image: string; image_digest: string | null }): string => splitImage(c.docker_image).repo.replace(/^library\//, "") + "@" + c.image_digest;
