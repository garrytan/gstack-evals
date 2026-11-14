// Copyright (c) 2026 Garry Tan. MIT License.
// K10 (PD-11): the author's input bundle. README up to 30 KB; the file tree up to 4,000 paths; design-system files up
// to 60 KB in all; up to 6 screen files of up to 30 KB each, each cut with a marker. A KB is 1,000 bytes (BT, the
// skeleton's choice). Screen files are the route files the file check found, ranked by the count of the kind's noun
// words their path holds (path words split on non-letters and camelCase, lowercased, whole-word equality), then by
// size descending, then by path.
import { AUTHORING, KIND_NOUNS } from "../frozen.ts";
import type { ChangeKind } from "../types.ts";
import type { BaseAppView } from "./seams.ts";
import { underPath } from "./text.ts";

const B = AUTHORING.bundle;
const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

/** The longest prefix of s within n UTF-8 bytes, never splitting a character. */
export function cutBytes(s: string, n: number): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= n) return s;
  let end = n;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8");
}

/** BT: the marker a cut file ends with. */
export const cutMarker = (n: number): string => "\n[cut at " + n + " bytes]\n";

export const capped = (s: string, n: number): string => (bytes(s) <= n ? s : cutBytes(s, n) + cutMarker(n));

/** A path's words: split on non-letters and camelCase, lowercased. */
export const pathWords = (path: string): string[] =>
  path.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z]+/).filter(Boolean).map((w) => w.toLowerCase());

/** How many of the kind's noun words a path holds. */
export const nounScore = (path: string, kind: ChangeKind): number => {
  const w = new Set(pathWords(path));
  return KIND_NOUNS[kind].filter((n) => w.has(n)).length;
};

/** The screen files the author sees, in rank order. */
export function rankScreens(app: BaseAppView, kind: ChangeKind): string[] {
  const size = (p: string) => bytes(app.read(p) ?? "");
  return [...new Set(app.routeFiles)].sort((a, b) => nounScore(b, kind) - nounScore(a, kind) || size(b) - size(a) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, B.screenFiles);
}

/** The design-system files within 60 KB in all, in path order; the file that crosses the limit is cut and the rest named. */
export function designBlock(app: BaseAppView): string {
  let left = B.designBytes;
  const out: string[] = [];
  const paths = [...new Set(app.designFiles)].sort();
  for (let i = 0; i < paths.length; i++) {
    const text = app.read(paths[i]!) ?? "";
    if (left <= 0) {
      out.push("[" + (paths.length - i) + " more design files not shown: " + paths.slice(i).join(", ") + "]\n");
      break;
    }
    out.push(underPath(paths[i]!, capped(text, left)));
    left -= bytes(text);
  }
  return out.join("\n");
}

export interface Bundle {
  text: string;
  screens: string[];
  treeShown: number;
  treeTotal: number;
}

/** The whole bundle in a fixed framing (BT). */
export function authorBundle(app: BaseAppView, kind: ChangeKind): Bundle {
  const tree = [...new Set(app.tree)].sort();
  const shown = tree.slice(0, B.treePaths);
  const treeText = shown.join("\n") + (tree.length > shown.length ? "\n[" + (tree.length - shown.length) + " more paths not shown]" : "");
  const screens = rankScreens(app, kind);
  const text = [
    "## README\n\n" + underPath("README", capped(app.readme, B.readmeBytes)),
    "## File tree\n\n" + underPath("file tree", treeText),
    "## Design files\n\n" + designBlock(app),
    "## Screens\n\n" + screens.map((p) => underPath(p, capped(app.read(p) ?? "", B.screenFileBytes))).join("\n"),
  ].join("\n");
  return { text, screens, treeShown: shown.length, treeTotal: tree.length };
}
