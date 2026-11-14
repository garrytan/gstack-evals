// Copyright (c) 2026 Garry Tan. MIT License.
// The frame's entry filters, frame order and owner dedupe (prereg section 3, frozen; plan section 8's BT readings).
// Every filter runs on every repository the search returned, in the order ENTRY_FILTERS lists them, and a repository
// leaves at the first it fails. Then the frame is ordered by sha256 of the seed, a newline and nameWithOwner (hex
// ascending), and every repository after an owner's first is left out, owners compared case-insensitively.
import { createHash } from "node:crypto";
import { FRAME, SEED } from "../frozen.ts";
import type { SearchedRepo } from "./search.ts";

/** Lowercase whole words: runs of letters and digits. */
export const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const hasPair = (ws: readonly string[], pair: string) => {
  const [a, b] = pair.split(" ");
  return ws.some((w, i) => w === a && ws[i + 1] === b);
};

/** A topic is left out when its hyphen-split words hold a barred word or a barred word pair. */
export function topicBarred(topic: string): boolean {
  const ws = topic.toLowerCase().split("-").filter(Boolean);
  return ws.some((w) => (FRAME.topicWords as readonly string[]).includes(w)) || FRAME.wordPairs.some((p) => hasPair(ws, p));
}

/** Markdown links and images become their text, HTML tags go, so a title's words are the words a reader sees. */
const plain = (s: string) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .trim();

/**
 * The README title: its first Markdown heading (ATX, or setext under a paragraph), outside fenced code, else its first
 * non-empty line; null when there is no README or it has no non-empty line.
 */
export function readmeTitle(text: string | null): string | null {
  if (text === null) return null;
  const lines = text.split(/\r\n|\r|\n/);
  let fence: { ch: string; len: number } | null = null;
  let para: string[] = [];
  let paraOk = false;
  for (const line of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence.ch && f[1]!.length >= fence.len && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      continue;
    }
    if (f) {
      fence = { ch: f[1]![0]!, len: f[1]!.length };
      para = [];
      continue;
    }
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (atx) return plain((atx[1] ?? "").replace(/[ \t]+#+$/, "").replace(/^#+$/, ""));
    if (para.length && paraOk && /^ {0,3}(=+|-+)[ \t]*$/.test(line)) return plain(para.join(" "));
    if (line.trim() === "") {
      para = [];
      continue;
    }
    if (!para.length) paraOk = !/^ {0,3}([<>]|[-*+][ \t]|\d+[.)][ \t])/.test(line) && !/^( {4}|\t)/.test(line);
    para.push(line.trim());
  }
  const first = lines.find((l) => l.trim() !== "");
  return first === undefined ? null : plain(first);
}

/** The README title is left out when its words hold a barred title word or a barred word pair. */
export function titleBarred(title: string | null): boolean {
  if (title === null) return false;
  const ws = words(title);
  return ws.some((w) => (FRAME.titleWords as readonly string[]).includes(w)) || FRAME.wordPairs.some((p) => hasPair(ws, p));
}

const PUSHED_FLOOR = Date.parse(FRAME.pushedOnOrAfter + "T00:00:00Z");
const LICENCES = new Set(FRAME.licenses.map((l) => l.toLowerCase()));

/** The entry filters in the order they run; each names what keeps a repository in. */
export const ENTRY_FILTERS: readonly { name: string; keeps: (r: SearchedRepo) => boolean }[] = [
  { name: "public", keeps: (r) => r.isPrivate === false },
  { name: "not a fork", keeps: (r) => r.isFork === false },
  { name: "not archived", keeps: (r) => r.isArchived === false },
  { name: "not a template", keeps: (r) => r.isTemplate === false },
  { name: "stars", keeps: (r) => r.stars >= FRAME.minStars },
  { name: "pushed", keeps: (r) => Date.parse(r.pushedAt) >= PUSHED_FLOOR },
  { name: "licence", keeps: (r) => r.spdxId !== null && LICENCES.has(r.spdxId.toLowerCase()) },
  { name: "language", keeps: (r) => r.language !== null && (FRAME.languages as readonly string[]).includes(r.language) },
  { name: "topic words", keeps: (r) => !r.topics.some(topicBarred) },
  { name: "readme title", keeps: (r) => !titleBarred(readmeTitle(r.readme)) },
];

/** The first filter a repository fails, or null when it passes them all. */
export const firstFailed = (r: SearchedRepo): string | null => ENTRY_FILTERS.find((f) => !f.keeps(r))?.name ?? null;

/** The frame order key: sha256 of the seed, a newline and nameWithOwner, in hex. */
export const frameKey = (nameWithOwner: string): string => createHash("sha256").update(String(SEED) + "\n" + nameWithOwner).digest("hex");

export interface FrameEntry {
  /** 1-based position in the frame. */
  position: number;
  nameWithOwner: string;
  key: string;
  headOid: string | null;
  defaultBranch: string | null;
}

export interface Framed {
  /** How many remain after each entry filter, in order. */
  afterFilter: { name: string; left: number }[];
  /** The filtered repositories in frame order, before the owner dedupe. */
  ordered: number;
  /** The frame: after the owner dedupe, in frame order. */
  frame: FrameEntry[];
  /** Each returned repository with the first filter it failed, "owner dedupe", or null in the frame. */
  outcome: { nameWithOwner: string; left_at: string | null }[];
}

/** Entry filters, frame order, then the owner dedupe. */
export function buildFrame(repos: readonly SearchedRepo[]): Framed {
  let left = [...repos];
  const afterFilter: Framed["afterFilter"] = [];
  const leftAt = new Map<string, string | null>();
  for (const f of ENTRY_FILTERS) {
    left = left.filter((r) => {
      if (f.keeps(r)) return true;
      leftAt.set(r.nameWithOwner, f.name);
      return false;
    });
    afterFilter.push({ name: f.name, left: left.length });
  }
  const ordered = left.map((r) => ({ r, key: frameKey(r.nameWithOwner) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const owners = new Set<string>();
  const frame: FrameEntry[] = [];
  for (const { r, key } of ordered) {
    const owner = r.nameWithOwner.split("/")[0]!.toLowerCase();
    if (owners.has(owner)) {
      leftAt.set(r.nameWithOwner, "owner dedupe");
      continue;
    }
    owners.add(owner);
    leftAt.set(r.nameWithOwner, null);
    frame.push({ position: frame.length + 1, nameWithOwner: r.nameWithOwner, key, headOid: r.headOid, defaultBranch: r.defaultBranch });
  }
  return { afterFilter, ordered: ordered.length, frame, outcome: repos.map((r) => ({ nameWithOwner: r.nameWithOwner, left_at: leftAt.get(r.nameWithOwner) ?? null })) };
}
