// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's vocabulary screen (prereg section 3, "Authoring and validation", reusing the founder
// lane's screen). It bars any 5-word sequence from the questions both skills ask and from the arms' lens line, and each
// of the founder lane's six named terms, in a brief's opening, persona, facts, key and prior session. Its sources are a
// build-time choice, each read from a gstack checkout at its commit and refused on any other sha256: the six forcing
// questions ("Ask:" lines) of phase-2a at the current pin and at the new pin (pre-run change 2), the quoted questions
// of that head's reality check, and the quoted questions of its pivot flow (phase-2c). Words are compared the founder
// lane's way: lowercased, with every run of other characters one space.
import { spawnSync } from "node:child_process";
import { AuthorError, sha256 } from "../../office-hours-founder/author/files.ts";
import { forcingQuestions, unitStrings, words, type Hits, type Screen } from "../../office-hours-founder/author/screens.ts";
import { LENS_LINE, PINS } from "../frozen.ts";
import type { BriefFiles } from "./files.ts";
import { NAMED_TERMS } from "./prompts.ts";

export type { Hits, Screen };

/** The content change's ready head the anti-pattern list and the screen read: the new pin (pre-run change 2). */
export const REWRITE_HEAD = PINS.new!.sha;
const PHASE_2A = "office-hours/sections/phase-2a-startup-diagnostic.md";
const PHASE_2C = "office-hours/sections/phase-2c-pivot-discovery.md";

/** The quoted strings of one "### " section of a file. */
export function quotedIn(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) throw new AuthorError("E_USAGE", "the screen source holds no " + JSON.stringify(heading) + " section");
  const end = lines.findIndex((l, k) => k > at && l.startsWith("### "));
  return [...lines.slice(at + 1, end < 0 ? lines.length : end).join("\n").matchAll(/"([^"\n]+)"/g)].map((m) => m[1]!);
}

export const SCREEN_SOURCES: readonly { commit: string; path: string; sha256: string; extract: (text: string) => string[] }[] = [
  { commit: PINS.current!.sha, path: PHASE_2A, sha256: PINS.current!.files[PHASE_2A]!, extract: forcingQuestions },
  { commit: REWRITE_HEAD, path: PHASE_2A, sha256: PINS.new!.files[PHASE_2A]!, extract: (t) => [...forcingQuestions(t), ...quotedIn(t, "### Reality Check (ask first, at every stage)")] },
  { commit: REWRITE_HEAD, path: PHASE_2C, sha256: PINS.new!.files[PHASE_2C]!, extract: (t) => quotedIn(t, "### Pivot flow") },
];

const grams = (w: readonly string[]): string[] => Array.from({ length: Math.max(0, w.length - 4) }, (_, i) => w.slice(i, i + 5).join(" "));

/** The screen over these source strings and the lens line. */
export const buildScreen = (sources: readonly string[]): Screen => ({ grams: new Set([...sources, LENS_LINE].flatMap((s) => grams(words(s)))) });

/** Reads every source at its commit through readAt, refusing a file whose sha256 differs from the pinned one. */
export function loadScreen(readAt: (commit: string, path: string) => Buffer): Screen {
  return buildScreen(SCREEN_SOURCES.flatMap((s) => {
    const text = readAt(s.commit, s.path);
    const got = sha256(text);
    if (got !== s.sha256) throw new AuthorError("E_USAGE", s.path + " at " + s.commit.slice(0, 7) + " has sha256 " + got + ", not the pinned " + s.sha256);
    return s.extract(text.toString("utf8"));
  }));
}

/** readAt over a gstack clone that holds both commits. */
export const gitReader = (dir: string) => (commit: string, path: string): Buffer => {
  const r = spawnSync("git", ["-C", dir, "show", commit + ":" + path]);
  if (r.status !== 0) throw new AuthorError("E_USAGE", "git show " + commit.slice(0, 7) + ":" + path + " failed in " + dir + "; the screen needs a full gstack clone holding both commits");
  return r.stdout;
};

const holds = (hay: readonly string[], needle: readonly string[]) => (" " + hay.join(" ") + " ").includes(" " + needle.join(" ") + " ");

/** No barred 5-word sequence and no named term in the brief's strings; files names the files that hold a hit. */
export function screenVocabulary(screen: Screen, b: Partial<BriefFiles>): Hits {
  const strings = [...unitStrings({ opening: b.opening, sheet: b.sheet, key: b.key }), ...(b.prior ? [b.prior.assignment, b.prior.test, b.prior.condition].map((text) => ({ file: "prior.json", text })) : [])];
  const hits = new Set<string>(), files = new Set<string>();
  for (const s of strings) {
    const w = words(s.text);
    const found = [...grams(w).filter((g) => screen.grams.has(g)), ...NAMED_TERMS.filter((t) => holds(w, words(t)))];
    for (const f of found) hits.add(f);
    if (found.length) files.add(s.file);
  }
  return { pass: hits.size === 0, hits: [...hits], files: [...files] };
}
