// Copyright (c) 2026 Garry Tan. MIT License.
// The shared frame's mechanical rules (design prereg frame-rules.md part B, shared by the devex prereg's section 4):
// the title and label filter, the word count, the source, test and size rules, the class rules (BREAKING, CLI, API,
// SDK, CONFIG; DESKTOP, MOBILE, WEB), the UI file tests, the exclusive assignment with its line-share rule, the
// per-repository cap, part B's release rule and buckets, the strata and the topic lists; plus part A's licence tiers.
// The regexes and lists are read from frame-part-b.txt, part B's two code blocks byte for byte, and compiled with py()
// so they keep Python re's semantics.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { py } from "./pyre.ts";

/** Reads the Python literal forms part B and the screen rule use: r"..." strings, re.compile, set(...split()), {...} and [...]. */
export function parsePy(text: string): { str: Record<string, string>; rx: Record<string, { src: string; I: boolean; S: boolean }>; set: Record<string, string[]> } {
  const str: Record<string, string> = {}, rx: Record<string, { src: string; I: boolean; S: boolean }> = {}, set: Record<string, string[]> = {};
  const raw = (s: string, at: number): { v: string; end: number } => {
    let i = at, v = "";
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\") {
        v += s[i]! + s[i + 1]!;
        i += 2;
      } else v += s[i++];
    }
    return { v, end: i + 1 };
  };
  const re = /^([A-Z_]+) = (.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1]!, rhs = m[2]!, start = m.index + m[0].length - rhs.length;
    if (rhs.startsWith('r"')) str[name] = raw(text, start + 2).v;
    else if (rhs.startsWith('re.compile(r"')) {
      const r = raw(text, start + 13);
      const tail = text.slice(r.end, text.indexOf("\n", r.end) < 0 ? undefined : text.indexOf("\n", r.end));
      rx[name] = { src: r.v, I: /re\.I\b/.test(tail), S: /re\.S\b/.test(tail) };
    } else if (rhs.startsWith('set("""')) {
      const end = text.indexOf('"""', start + 7);
      set[name] = text.slice(start + 7, end).split(/\s+/).filter(Boolean);
    } else if (rhs.startsWith('set("')) set[name] = rhs.slice(5, rhs.indexOf('"', 5)).split(/\s+/).filter(Boolean);
    else if (rhs.startsWith("{") || rhs.startsWith("[")) set[name] = [...rhs.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);
  }
  return { str, rx, set };
}

export const PART_B = readFileSync(join(import.meta.dir, "frame-part-b.txt"), "utf8");
const P = parsePy(PART_B);
const need = <T>(v: T | undefined, name: string): T => {
  if (v === undefined) throw new Error("frame-part-b.txt holds no " + name);
  return v;
};
const RX = (name: string) => {
  const r = need(P.rx[name], name);
  return py(r.src, { I: r.I, S: r.S });
};

/** The title filter's three patterns, applied case-insensitively. */
export const EXCL = py(need(P.str.EXCL, "EXCL"), { I: true });
export const EXCL_KEEP = py(need(P.str.EXCL_KEEP, "EXCL_KEEP"), { I: true });
export const KEEP_START = py(need(P.str.KEEP_START, "KEEP_START"), { I: true });
export const SRC_EXT = new Set(need(P.set.SRC_EXT, "SRC_EXT"));
export const WEB_EXT = new Set(need(P.set.WEB_EXT, "WEB_EXT"));
export const DEV_ORDER = need(P.set.DEV_ORDER, "DEV_ORDER") as Array<"BREAKING" | "CLI" | "API" | "SDK" | "CONFIG">;
export const UI_ORDER = need(P.set.UI_ORDER, "UI_ORDER") as Array<"DESKTOP" | "MOBILE" | "WEB">;
export const R = Object.fromEntries(Object.keys(P.rx).map((k) => [k, RX(k)])) as Record<string, RegExp>;

export type DevTag = "BREAKING" | "CLI" | "API" | "SDK" | "CONFIG";
export type UiClass = "DESKTOP" | "MOBILE" | "WEB";
export type Stratum = "desktop" | "mobile" | "web" | null;
export type Side = "dev" | "ui" | "neither";

/** A title or label set the title and label filter excludes. */
export function titleExcluded(title: string, labels: readonly string[]): boolean {
  if (labels.some((l) => EXCL.test(l))) return true;
  return KEEP_START.test(title) ? EXCL_KEEP.test(title) : EXCL.test(title);
}

const WORD = /[A-Za-z][A-Za-z0-9'_-]*/g;
/** Words in plan text after removing HTML comments, markdown images and URLs. */
export function wordCount(text: string): number {
  const t = text.replace(/<!--[\s\S]*?-->/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\bhttps?:\/\/[^\s)>\]]+/gi, " ");
  return (t.match(WORD) ?? []).length;
}

const ext = (path: string) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
};
export const isTestPath = (path: string) => R.TEST!.test(path);
export const isNonSrc = (path: string) => R.NONSRC!.test(path);
/** A source file: extension in SRC_EXT (or an Android res/layout XML), path not matching NONSRC or TEST. */
export const isSource = (path: string) => (SRC_EXT.has(ext(path)) || R.ANDROID_LAYOUT!.test(path)) && !isNonSrc(path) && !isTestPath(path);

export interface ChangedFile {
  path: string;
  additions: number;
}

/** At least 2 source files or at least 40 added source lines; relaxed: at least 1 file and 15 lines. */
export function sizeRule(files: readonly ChangedFile[], relaxed = false): boolean {
  const src = files.filter((f) => isSource(f.path));
  const lines = src.reduce((n, f) => n + f.additions, 0);
  return relaxed ? src.length >= 1 && lines >= 15 : src.length >= 2 || lines >= 40;
}

/** The body for class detection: HTML comments, unchecked task-list lines, fenced code blocks and "$ " lines removed. */
export function cleanBody(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\x60\x60\x60[\s\S]*?(?:\x60\x60\x60|$)/g, "")
    .split("\n")
    .filter((l) => !/^\s*[-*+] \[ \] /.test(l) && !l.startsWith("$ "))
    .join("\n");
}

export interface PrFacts {
  title: string;
  labels: string[];
  body: string;
  files: ChangedFile[];
}

/** BREAKING by label, title (bang or removal) or an unnegated body match. */
export function isBreaking(pr: Pick<PrFacts, "title" | "labels" | "body">): boolean {
  if (pr.labels.some((l) => R.BRK_LABEL!.test(l))) return true;
  if (R.BRK_TITLE_BANG!.test(pr.title) || R.BRK_TITLE_RM!.test(pr.title)) return true;
  const body = cleanBody(pr.body);
  const g = new RegExp(R.BRK_BODY!.source, R.BRK_BODY!.flags + "g");
  for (const m of body.matchAll(g)) {
    const before = body.slice(Math.max(0, m.index! - 30), m.index!);
    const after = body.slice(m.index! + m[0].length, m.index! + m[0].length + 20);
    if (!R.BRK_NEG_BEFORE!.test(before) && !R.BRK_NEG_AFTER!.test(after)) return true;
  }
  return false;
}

/** Developer-facing tags in DEV_ORDER, BREAKING first when present; primary is the first. */
export function devClasses(pr: PrFacts): DevTag[] {
  const body = cleanBody(pr.body);
  const paths = pr.files.map((f) => f.path).filter((p) => !isTestPath(p) && !isNonSrc(p));
  const hit = (k: string) => paths.some((p) => R[k + "_PATH"]!.test(p)) || R[k + "_TITLE"]!.test(pr.title) || R[k + "_BODY"]!.test(body);
  return DEV_ORDER.filter((c) => (c === "BREAKING" ? isBreaking(pr) : hit(c === "CONFIG" ? "CFG" : c)));
}

export interface RepoFacts {
  topics: string[];
  stratum: Stratum;
}
const RN = (r: RepoFacts) => r.topics.includes("react-native-app") || r.topics.includes("react-native");
const UI_SCRIPT = new Set(["ts", "js", "mjs"]);
export const webFile = (p: string) => WEB_EXT.has(ext(p)) || (UI_SCRIPT.has(ext(p)) && R.UI_DIR!.test(p));
export function mobileFile(p: string, repo: RepoFacts): boolean {
  const e = ext(p);
  if (e === "swift") return R.MOB_SWIFT!.test(p);
  if (e === "kt" || e === "java") return R.MOB_KT!.test(p);
  if (R.ANDROID_LAYOUT!.test(p)) return true;
  if (e === "dart" && R.MOB_DART!.test(p)) return true;
  if (R.MOB_RN!.test(p)) return true;
  return (e === "tsx" || e === "jsx") && RN(repo);
}
export const desktopFile = (p: string, repo: RepoFacts) => R.DESK!.test(p) || (webFile(p) && repo.stratum === "desktop");
const isUiFile = (p: string, repo: RepoFacts) => webFile(p) || mobileFile(p, repo) || desktopFile(p, repo);

/** UI classes in UI_ORDER: a source file of that kind changed and the title or cleaned body names a UI noun. */
export function uiClasses(pr: PrFacts, repo: RepoFacts): UiClass[] {
  if (!R.UI_NOUN!.test(pr.title) && !R.UI_NOUN!.test(cleanBody(pr.body))) return [];
  const src = pr.files.map((f) => f.path).filter(isSource);
  const has: Record<UiClass, boolean> = {
    DESKTOP: src.some((p) => desktopFile(p, repo)),
    MOBILE: src.some((p) => mobileFile(p, repo)),
    WEB: src.some((p) => webFile(p) && !desktopFile(p, repo) && !(RN(repo) && mobileFile(p, repo))),
  };
  return UI_ORDER.filter((c) => has[c]);
}

/** Added lines in UI files over added non-test source lines (the line-share rule's ratio). */
export function uiLineShare(files: readonly ChangedFile[], repo: RepoFacts): number {
  const src = files.filter((f) => isSource(f.path));
  const all = src.reduce((n, f) => n + f.additions, 0);
  const ui = src.filter((f) => isUiFile(f.path, repo)).reduce((n, f) => n + f.additions, 0);
  return all === 0 ? 0 : ui / all;
}

/** Exclusive assignment: one side only, both going to UI when UI-file added lines are at least half. */
export function assign(dev: boolean, ui: boolean, files: readonly ChangedFile[], repo: RepoFacts): Side {
  if (dev && ui) return uiLineShare(files, repo) >= 0.5 ? "ui" : "dev";
  return dev ? "dev" : ui ? "ui" : "neither";
}

/** The mechanical side (the classifier's prefilter record): part B's classes, then assign(). */
export function mechanicalSide(pr: PrFacts, repo: RepoFacts): { side: Side; dev: DevTag[]; ui: UiClass[] } {
  const dev = devClasses(pr), ui = uiClasses(pr, repo);
  return { side: assign(dev.length > 0, ui.length > 0, pr.files, repo), dev, ui };
}

/** Keeps the first n per repository in draw order among the units that pass (part B's cap; the devex rule counts passing units only). */
export function capPerRepo<T extends { repo: string; order: string }>(units: readonly T[], n = 3): T[] {
  const per = new Map<string, number>();
  return [...units].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)).filter((u) => {
    const k = per.get(u.repo) ?? 0;
    if (k >= n) return false;
    per.set(u.repo, k + 1);
    return true;
  });
}

export interface ReleaseNode {
  tag: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}
export interface TagNode {
  tag: string;
  date: string;
}

/** Part B's date rule: the earliest non-draft release published at or after the merge; with no releases at all, the earliest tag dated so. */
export function releaseByDate(mergedAt: string, releases: readonly ReleaseNode[], tags: readonly TagNode[]): { kind: "release" | "tag"; tag: string; published_at: string; prerelease: boolean } | null {
  const rel = releases.filter((r) => !r.draft && r.published_at && r.published_at >= mergedAt).sort((a, b) => (a.published_at < b.published_at ? -1 : 1))[0];
  if (releases.length > 0) return rel ? { kind: "release", tag: rel.tag, published_at: rel.published_at, prerelease: rel.prerelease } : null;
  const t = tags.filter((x) => x.date >= mergedAt).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  return t ? { kind: "tag", tag: t.tag, published_at: t.date, prerelease: false } : null;
}

/** Part B's buckets of a release date. */
export function releaseBucket(at: string | null): "by_0909" | "by_0930" | "by_1015" | "later" | "none" {
  if (!at) return "none";
  const d = at.slice(0, 10);
  return d <= "2026-09-09" ? "by_0909" : d <= "2026-09-30" ? "by_0930" : d <= "2026-10-15" ? "by_1015" : "later";
}

/** Continuous delivery: no releases and no tag dated 2026. */
export const continuousDelivery = (releases: readonly ReleaseNode[], tags: readonly TagNode[]) => releases.length === 0 && !tags.some((t) => t.date.startsWith("2026"));

export const DESKTOP_TOPICS = ["desktop-app", "electron-app", "tauri-app", "desktop-application", "macos-app", "electron", "tauri"];
export const MOBILE_TOPICS = ["android-app", "ios-app", "flutter-app", "react-native-app", "mobile-app", "swiftui", "jetpack-compose", "android-application"];
export const WEB_TOPICS = ["web-app", "webapp", "dashboard", "self-hosted", "react", "nextjs", "vue", "svelte", "angular", "tailwindcss", "web-application", "admin-dashboard", "react-app", "pwa"];
export const UI_TOPICS = [...DESKTOP_TOPICS, ...MOBILE_TOPICS, ...WEB_TOPICS];
export const DEV_TOPICS = ["cli", "command-line", "command-line-tool", "terminal", "sdk", "api", "rest-api", "graphql", "grpc", "api-client", "http-client", "library", "framework", "web-framework", "developer-tools", "devtools", "build-tool", "package-manager", "compiler", "linter", "static-analysis", "testing", "orm", "database", "kubernetes", "terraform-provider", "infrastructure-as-code", "devops", "llm", "ai-agents", "mcp", "mcp-server", "python-library", "rust-library", "go-library", "npm-package", "command-line-interface", "cli-tool", "openapi", "javascript-library", "typescript-library", "java-library", "developer-tool", "ai-agent", "mcp-servers"];

/** Desktop first, then mobile, then web, from the repository's topics. */
export function stratum(topics: readonly string[]): Stratum {
  if (topics.some((t) => DESKTOP_TOPICS.includes(t))) return "desktop";
  if (topics.some((t) => MOBILE_TOPICS.includes(t))) return "mobile";
  if (topics.some((t) => WEB_TOPICS.includes(t))) return "web";
  return null;
}

export const PERMISSIVE = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "MPL-2.0", "ISC", "0BSD", "Unlicense", "CC0-1.0"];
export const COPYLEFT = ["GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0"];
/** Part A's licence tier for an SPDX id; GitHub reports the GPL family with -only or -or-later suffixes in some places. */
export function licenceTier(spdx: string | null | undefined): "permissive" | "copyleft" | null {
  if (!spdx) return null;
  if (PERMISSIVE.includes(spdx)) return "permissive";
  const base = spdx.replace(/-(only|or-later)$/, "");
  return COPYLEFT.includes(base) ? "copyleft" : null;
}

/** Part A's repository rule, from a search or REST repository object. */
export function repoInFrame(r: { stargazers_count: number; fork: boolean; archived: boolean; pushed_at: string; license?: { spdx_id?: string | null } | null }): boolean {
  return r.stargazers_count >= 500 && !r.fork && !r.archived && r.pushed_at >= "2026-10-01" && licenceTier(r.license?.spdx_id) !== null;
}
