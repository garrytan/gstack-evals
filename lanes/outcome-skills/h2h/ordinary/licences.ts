// Copyright (c) 2026 Garry Tan. MIT License.
// The O frame's freeze-date reads (plan section 5): each candidate repository's licence, read once through GitHub's
// GraphQL API with the authenticated gh CLI and frozen as o-licences.json; the second read of the root licence files for
// repositories GraphQL names no licence for or calls NOASSERTION, with the frozen classifier part B also calls; and
// SWE-bench-Live MultiLang's Hugging Face head, recorded in o-frame.json beside the revision the state machines harness
// pins.
//
// The classifier's frozen rule. A licence file matches a listed licence when its whole text matches that licence's SPDX
// template (spdx/license-list-data at SPDX_TEMPLATES.commit, each file checked by sha256) after both are normalised:
// lower case; "licenc" spelled "licens"; every run of characters other than a to z and 0 to 9 becomes one space; "https"
// reads as "http". In the template, <<beginOptional>> ... <<endOptional>> may be absent, and each <<var>> slot matches
// any text of up to 300 normalised characters, or up to the slot's own bound when its match is .{0,N}. The var's own
// regular expression is not used. A space between template pieces is optional. Listed licences are tried in
// prereg.json's order and the first that matches names the file. A file with no text (binary or truncated) matches none.
// A repository passes when at least one root file whose name starts with LICENSE, LICENCE or COPYING (compared without
// case; blobs only, so a LICENSES directory is not read) is found and every such file matches a listed licence.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { h2hFail } from "../prereg.ts";
import { LICENCES_SCHEMA, type LicenceRead, type SecondRead } from "./frame.ts";

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

/** The SPDX templates the classifier reads: spdx/license-list-data v3.29.0 (released 2026-09-16), one per listed licence. */
export const SPDX_TEMPLATES = {
  source: "spdx/license-list-data",
  tag: "v3.29.0",
  commit: "31ba1a50e5397e00a304dbadc76531740e89ee48",
  sha256: {
    MIT: "9b91e12dfe57d42e91ea96d2acb7624040bffc54182bd164d39d0fae33e77794",
    "MIT-0": "c897e948891e3e587ba8e14acb51743a3ec69a671ce5a0f07f25ddf24f73de7a",
    "Apache-2.0": "5567209d3a634ebd6ed122a7302563b9668ab141941149a4e30d9c7b887f41b9",
    "BSD-2-Clause": "922ac644c79e7c2aa31bacac531a5d4d5b9d183853a3dc44a253fd9267c3c890",
    "BSD-3-Clause": "c42368b683ceef1ad41b6f17999adf3b7534e3c47fbdd51449ed6690edb1fc5f",
    ISC: "a382ee687364e5fa6361f299be089d79ded228a7ccbf1d4352a30fa22bfddb8f",
    "0BSD": "5b5b3cf0d303e1bed3144433e570f46f92810f6d9cb31073fb089786ff5472ff",
    Zlib: "517518a720051db892e77865041587abc99146359c9a0eb4de360bdab9e9255b",
    "BSL-1.0": "5218853c2dd51b793b84bce58bb669dcad92215fc6de3dd06be83946e94d9078",
    Unlicense: "e6a01517253c197874d66ab30ca3f596cfce601aafcc310ec2944585a4a254bd",
  } as Record<string, string>,
} as const;
export const VAR_BOUND = 300;
/** Root file names the second read takes. */
export const LICENCE_FILE = /^(licen[sc]e|copying)/i;

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** The classifier's text normalisation. */
export const normaliseLicence = (t: string): string =>
  t.toLowerCase().replace(/licenc/g, "licens").replace(/[^a-z0-9]+/g, " ").replace(/\bhttps\b/g, "http").trim();

/** One SPDX template, compiled to a matcher over normalised text. */
export interface LicencePattern { test(normalised: string): boolean }

type Piece = string | { slot: number } | { opt: Piece[] };
type Op = { op: "lit"; s: string } | { op: "sp" } | { op: "slot"; n: number } | { op: "opt"; skip: number } | { op: "end" };

/** Searches the (step, position) pairs the template's steps can reach, each once, so a near miss costs time in
 *  proportion to the text instead of the exponential backtracking a regular expression with many slots falls into. */
function runPattern(prog: readonly Op[], text: string): boolean {
  const width = text.length + 1;
  const seen = new Uint8Array(prog.length * width);
  const todo: number[] = [];
  const go = (pc: number, at: number) => {
    if (at > text.length || seen[pc * width + at]) return;
    seen[pc * width + at] = 1;
    todo.push(pc, at);
  };
  go(0, 0);
  while (todo.length) {
    const at = todo.pop()!;
    const pc = todo.pop()!;
    const o = prog[pc]!;
    if (o.op === "end") {
      if (at === text.length) return true;
    } else if (o.op === "lit") {
      if (text.startsWith(o.s, at)) go(pc + 1, at + o.s.length);
    } else if (o.op === "sp") {
      go(pc + 1, at);
      if (text[at] === " ") go(pc + 1, at + 1);
    } else if (o.op === "slot") {
      for (let k = Math.min(o.n, text.length - at); k >= 0; k--) go(pc + 1, at + k);
    } else {
      go(pc + 1, at);
      go(o.skip, at);
    }
  }
  return false;
}

/** One SPDX template as a whole-text matcher over normalised text. */
export function compileTemplate(template: string): LicencePattern {
  const stack: Piece[][] = [[]];
  const token = /<<beginOptional>>|<<endOptional>>|<<var;[\s\S]*?">>/g;
  let at = 0;
  const literal = (t: string) => {
    const n = normaliseLicence(t);
    if (n) stack[stack.length - 1]!.push(n);
  };
  for (const m of template.matchAll(token)) {
    literal(template.slice(at, m.index));
    at = m.index! + m[0].length;
    if (m[0] === "<<beginOptional>>") stack.push([]);
    else if (m[0] === "<<endOptional>>") {
      if (stack.length < 2) h2hFail("E_H2H_O_LICENCE", "an SPDX template closes an optional part it never opened");
      const inner = stack.pop()!;
      if (inner.length) stack[stack.length - 1]!.push({ opt: inner });
    } else {
      const bound = /match="\.\{0,(\d+)\}"/.exec(m[0]);
      stack[stack.length - 1]!.push({ slot: bound ? Number(bound[1]) : VAR_BOUND });
    }
  }
  literal(template.slice(at));
  if (stack.length !== 1) h2hFail("E_H2H_O_LICENCE", "an SPDX template leaves an optional part open");
  const prog: Op[] = [];
  const emit = (seq: readonly Piece[]) => seq.forEach((p, k) => {
    if (k) prog.push({ op: "sp" });
    if (typeof p === "string") prog.push({ op: "lit", s: p });
    else if ("slot" in p) prog.push({ op: "slot", n: p.slot });
    else {
      const open = prog.push({ op: "opt", skip: 0 }) - 1;
      emit(p.opt);
      prog[open] = { op: "opt", skip: prog.length };
    }
  });
  prog.push({ op: "sp" });
  emit(stack[0]!);
  prog.push({ op: "sp" }, { op: "end" });
  return { test: (text) => runPattern(prog, text) };
}

export interface Templates { order: string[]; patterns: Map<string, LicencePattern> }

/** The listed licences' templates from dir, each checked against SPDX_TEMPLATES, in the listed order. */
export function loadTemplates(dir: string, listed: readonly string[]): Templates {
  const patterns = new Map<string, LicencePattern>();
  for (const id of listed) {
    const want = SPDX_TEMPLATES.sha256[id] ?? h2hFail("E_H2H_O_LICENCE", "no pinned SPDX template for the listed licence " + id);
    const f = join(dir, id + ".template.txt");
    if (!existsSync(f)) h2hFail("E_H2H_O_LICENCE", f + " is missing; fetch the templates with fetchTemplates");
    const text = readFileSync(f);
    if (sha256(text) !== want) h2hFail("E_H2H_O_LICENCE", f + " is not the pinned " + SPDX_TEMPLATES.tag + " template for " + id);
    patterns.set(id, compileTemplate(text.toString("utf8")));
  }
  return { order: [...listed], patterns };
}

/** Downloads any missing listed template from the pinned commit into dir. */
export async function fetchTemplates(dir: string, listed: readonly string[], fetchFn: typeof fetch = fetch): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const id of listed) {
    const f = join(dir, id + ".template.txt");
    if (existsSync(f)) continue;
    const url = "https://raw.githubusercontent.com/" + SPDX_TEMPLATES.source + "/" + SPDX_TEMPLATES.commit + "/template/" + id + ".template.txt";
    const res = await fetchFn(url);
    if (!res.ok) h2hFail("E_H2H_O_LICENCE", url + " answered " + res.status);
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
}

/** The first listed licence whose template matches the whole text, or null. */
export function classifyLicenceText(text: string | null, t: Templates): string | null {
  if (text === null) return null;
  const n = normaliseLicence(text);
  return t.order.find((id) => t.patterns.get(id)!.test(n)) ?? null;
}

export interface LicenceFile { name: string; text: string | null }
/** The second-read verdict over a repository's root licence files. */
export function classifyLicenceFiles(files: readonly LicenceFile[], t: Templates): { eligible: boolean; reason: "matched" | "no_file" | "unmatched"; matches: (string | null)[] } {
  const own = files.filter((f) => LICENCE_FILE.test(f.name));
  const matches = own.map((f) => classifyLicenceText(f.text, t));
  if (!own.length) return { eligible: false, reason: "no_file", matches };
  return matches.every((m) => m !== null) ? { eligible: true, reason: "matched", matches } : { eligible: false, reason: "unmatched", matches };
}

const SECOND_BATCH = 25;
type Gql = { data?: Record<string, unknown>; errors?: { type?: string; message?: string }[] };
function gql(call: GraphQl, q: string): Record<string, unknown> {
  const res = call(q);
  let j: Gql;
  try {
    j = JSON.parse(res.stdout);
  } catch {
    return h2hFail("E_H2H_O_LICENCE", "gh api graphql answered with no JSON (exit " + res.status + "): " + res.stderr.slice(-300));
  }
  const other = (j.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
  if (!j.data || other.length) h2hFail("E_H2H_O_LICENCE", "gh api graphql answered with errors: " + JSON.stringify(other.slice(0, 3)).slice(0, 400));
  return j.data!;
}
const repoArg = (r: string) => {
  const [owner, name] = r.split("/");
  if (!owner || !name) h2hFail("E_H2H_O_LICENCE", JSON.stringify(r) + " is not owner/name");
  return "repository(owner: " + JSON.stringify(owner) + ", name: " + JSON.stringify(name) + ")";
};

/** The second read: each repository's default-branch root, its licence files' texts by blob id, and the classifier's
 *  verdict. A repository GitHub does not find has no file. */
export function readLicenceFilesGraphQl(repos: readonly string[], t: Templates, now: Date = new Date(), call: GraphQl = ghGraphQl): SecondRead {
  const sorted = [...new Set(repos)].sort();
  const out: SecondRead = {
    read_at: now.toISOString(), rule: "classifyLicenceFiles in lanes/outcome-skills/h2h/ordinary/licences.ts",
    templates: { source: SPDX_TEMPLATES.source, tag: SPDX_TEMPLATES.tag, commit: SPDX_TEMPLATES.commit, sha256: Object.fromEntries(t.order.map((id) => [id, SPDX_TEMPLATES.sha256[id]!])) },
    repos: {},
  };
  type Entry = { name: string; type: string; mode: number; oid: string };
  const roots = new Map<string, { head: string | null; files: Entry[] }>();
  for (let i = 0; i < sorted.length; i += SECOND_BATCH) {
    const part = sorted.slice(i, i + SECOND_BATCH);
    const data = gql(call, "query { " + part.map((r, k) => "r" + k + ": " + repoArg(r) + " { defaultBranchRef { target { ... on Commit { oid tree { entries { name type mode oid } } } } } }").join(" ") + " }");
    part.forEach((r, k) => {
      const target = (data["r" + k] as { defaultBranchRef?: { target?: { oid?: string; tree?: { entries?: Entry[] } } } } | null)?.defaultBranchRef?.target;
      roots.set(r, { head: target?.oid ?? null, files: (target?.tree?.entries ?? []).filter((e) => e.type === "blob" && LICENCE_FILE.test(e.name)).sort((a, b) => (a.name < b.name ? -1 : 1)) });
    });
  }
  const wanted = sorted.flatMap((r) => roots.get(r)!.files.map((f) => ({ r, f })));
  const texts = new Map<string, { text: string | null; bytes: number }>();
  for (let i = 0; i < wanted.length; i += SECOND_BATCH) {
    const part = wanted.slice(i, i + SECOND_BATCH);
    const data = gql(call, "query { " + part.map((w, k) => "b" + k + ": " + repoArg(w.r) + " { object(oid: " + JSON.stringify(w.f.oid) + ") { ... on Blob { text isBinary isTruncated byteSize } } }").join(" ") + " }");
    part.forEach((w, k) => {
      const b = (data["b" + k] as { object?: { text?: string | null; isBinary?: boolean; isTruncated?: boolean; byteSize?: number } } | null)?.object;
      texts.set(w.r + "\t" + w.f.oid, { text: !b || b.isBinary || b.isTruncated || typeof b.text !== "string" ? null : b.text, bytes: b?.byteSize ?? 0 });
    });
  }
  for (const r of sorted) {
    const root = roots.get(r)!;
    const files = root.files.map((f) => ({ ...f, ...texts.get(r + "\t" + f.oid)! }));
    const v = classifyLicenceFiles(files.map((f) => ({ name: f.name, text: f.mode === 40960 ? null : f.text })), t);
    out.repos[r] = {
      head: root.head, eligible: v.eligible, reason: v.reason,
      files: files.map((f, k) => ({ name: f.name, mode: f.mode, git_oid: f.oid, bytes: f.bytes, sha256: f.text === null ? null : sha256(f.text), match: v.matches[k] ?? null })),
    };
  }
  return out;
}
