// Copyright (c) 2026 Garry Tan. MIT License.
// Small text helpers the author area shares: word counts, the vocabulary screen's normalization, word sequences,
// sha256 and the last JSON object of a reply.
// normWords, grams and holdsSequence adapted from lanes/office-hours-founder/author/screens.ts at 14fbe35b2a3cb6d7477bc1eea4e61577650d4243.
import { createHash } from "node:crypto";

export const sha256 = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");

/** BT: a word count is the number of whitespace-separated tokens, as main's review lanes count change words. */
export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** The vocabulary screen's normalization: lowercase, every run of non-letters and non-digits to one space. */
export const normWords = (s: string): string[] => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

export const grams = (w: readonly string[], n: number): string[] => Array.from({ length: Math.max(0, w.length - n + 1) }, (_, i) => w.slice(i, i + n).join(" "));

/** True when the word sequence needle appears whole in hay. */
export const holdsSequence = (hay: readonly string[], needle: readonly string[]): boolean => needle.length > 0 && (" " + hay.join(" ") + " ").includes(" " + needle.join(" ") + " ");

/** The last JSON object in a reply: a fenced json block if any, else the last balanced {...}. Null when none parses. */
export function lastJsonObject(reply: string): Record<string, unknown> | null {
  const fenced = [...reply.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g)].map((m) => m[1]!);
  for (const body of fenced.reverse()) {
    const v = tryParse(body);
    if (v) return v;
  }
  const found: string[] = [];
  for (let i = 0; i < reply.length; i++) {
    if (reply[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    for (let j = i; j < reply.length; j++) {
      const ch = reply[j]!;
      if (inString) {
        if (ch === "\\") j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        found.push(reply.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  for (const s of found.reverse()) {
    const v = tryParse(s);
    if (v) return v;
  }
  return null;
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Numbered lines, as auditors read evidence files. */
export const numbered = (text: string): string => text.split("\n").map((l, i) => String(i + 1).padStart(4) + "  " + l).join("\n");

/** A file under its path, the framing every prompt in this area uses (BT). */
export const underPath = (path: string, text: string): string => "=== " + path + " ===\n" + text.replace(/\n?$/, "\n");
