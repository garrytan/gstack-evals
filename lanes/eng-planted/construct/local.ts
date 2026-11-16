// Copyright (c) 2026 Garry Tan. MIT License.
// Shared pieces of the construct part that types.ts and frozen.ts don't hold. Each cites the section of the plan
// (handoffs/GEVA-537/plan-approved.md) that sets it. A piece another part needs moves to types.ts or frozen.ts with that
// part's owner.
import { createHash, randomBytes } from "node:crypto";
import type { Sandbox } from "../../eng-build/unit.ts";
import type { Ecosystem } from "../types.ts";

/** One GitHub REST read: the status and parsed JSON body. Real runs pass githubReader(); tests pass a stub. */
export type GitHub = (path: string) => Promise<{ status: number; body: any }>;

/** Section 2, fix frame: F looks like a bug fix by its message or a label on its pull request. */
export const FIX_RE = /\b(fix(es|ed|ing)?|bug(s|fix)?|hotfix|regression|crash(es|ed|ing)?|handl(e|es|ed|ing)|correct(s|ed|ly|ion)?|edge)\b/i;
export const FIX_LABEL_RE = /\b(bug|fix|regression|defect)\b/i;

/** Section 2, frozen grading sandbox: the verifier's sandbox with eb525-explore-sandbox's two changes at 510fc5f. */
export const SANDBOX: Sandbox = { writable: true, tmp: "8g", memory: "12g" };

/** Section 2, construction: B, M and F' carry this author, committer, date and messages, so nothing in the unit repo
 * dates or names the fix. */
export const NEUTRAL = { ident: "unit <unit@example.invalid>", epoch: 1767225600, messages: { base: "base", merge: "merge", fix: "fix" } } as const;

/** Files a repository's licence is read from, at the fix commit (section 2, repository frame). */
export const LICENCE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING"];

/** The frame's licence by its text: the lane's four, plus ISC and 0BSD, which the frame also admits (section 2). */
export function frameLicence(text: string): string | null {
  if (/Permission is hereby granted, free of charge/.test(text)) return "MIT";
  if (/Apache License,?\s+Version 2\.0/.test(text)) return "Apache-2.0";
  if (/Redistribution and use in source and binary forms/.test(text)) return /Neither the name/.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  if (/Permission to use, copy, modify, and\/or distribute this software for\s+any\s+purpose\s+with or without fee is hereby\s+granted/.test(text))
    return /provided that the above\s+copyright notice/.test(text) ? "ISC" : "0BSD";
  return null;
}

/** A repository in the frozen manifest (section 2, repository frame). Held on the screening host, never committed. */
export interface ManifestRow {
  repo: string;
  eco: Ecosystem;
  stars: number;
  sizeKB: number;
  pushedAt: string;
  /** The query that found it, by its index in Manifest.queries. */
  query: number;
}

export interface Manifest {
  /** The search date, recorded with each query's text (section 2). */
  searchedAt: string;
  /** Minted from random bytes and recorded before the draw. */
  seed: string;
  queries: { eco: Ecosystem; text: string; total: number; read: number }[];
  /** In draw order. */
  rows: ManifestRow[];
}

/** One fix that passed the fix frame, before construction. Held on the screening host, never committed. */
export interface MinedFix {
  /** Minted from random bytes, never derived from a sha or name. */
  id: string;
  repo: string;
  eco: Ecosystem;
  stars: number;
  /** F and its first parent P. */
  fix: string;
  parent: string;
  authorDate: string;
  committerDate: string;
  /** The earliest of the author date, the pull request's open date and any linked issue's open date. */
  earliestPublic: string;
  licence: string;
  productLines: number;
  /** The enclosing named function or method of each product hunk at P, outermost kept. */
  functions: { file: string; name: string; line: number }[];
  /** Test files F changes that a recipe runs, with Rust product files whose inline test region F changes. */
  testFiles: string[];
}

/** A unit drop: a record with a reason, never an error (section 13). */
export interface DropRecord {
  id: string | null;
  repo: string;
  step: "mine" | "construct" | "screen" | "build" | "region" | "body" | "leak" | "history" | "recount";
  reason: string;
}

/** Section 2: stars print as a popularity stratum. */
export const starStratum = (stars: number): "300-999" | "1k-9.9k" | "10k+" => (stars >= 10000 ? "10k+" : stars >= 1000 ? "1k-9.9k" : "300-999");

/** The digest a frozen file is known by. */
export const digest = (text: string): string => "sha256:" + createHash("sha256").update(text).digest("hex");

/** A label minted from random bytes (CREW: never derived from shas, repository names or case ids). */
export const mint = (prefix: string): string => prefix + randomBytes(5).toString("hex");
