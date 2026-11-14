// Copyright (c) 2026 Garry Tan. MIT License.
// The author area's prompts: the frozen ones from frozen.ts and the build-time ones (audit, 2x audit additions, fix,
// rewrite note, validator labelling brief) as sha256-pinned .md files under ../prompts/author/, written for this
// build from no unit. Each builder puts a prompt's material in one fixed framing (BT).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { capped } from "./bundle.ts";
import { AUTHORING, AUTHOR_PROMPT, CHANGE_KINDS, CONTEXT_WRITER_PROMPT, FULL_INFORMATION_OPENING, GIVE_AWAY_OPENING, TEMPLATE, TRANSFORM_2X_PROMPT, TWIN_NOTE } from "../frozen.ts";
import type { ChangeKind, Key, KeyItem } from "../types.ts";
import type { BaseAppView } from "./seams.ts";
import type { Failure } from "./screen.ts";
import { numbered, sha256, underPath } from "./text.ts";
import type { UnitFiles } from "./unit.ts";

export const PROMPT_DIR = join(import.meta.dir, "..", "prompts", "author");

/** Each build-time prompt's file and sha256. A file whose bytes differ is refused. */
export const PROMPT_PINS = {
  audit: { file: "audit.md", sha256: "0f6c270b85c562a3d62f37985e90544273aaeb333f0cb6650511f18385e2c49f" },
  audit2x: { file: "audit-2x.md", sha256: "d3485a43b32394c80d6c069d056bc7f91396bcad662027926be4d04ecf442c17" },
  fix: { file: "fix.md", sha256: "217f4de0d456d5a2b16afd9bd02a27860586215591791a6e78162729e67ee5a3" },
  rewriteNote: { file: "rewrite-note.md", sha256: "f93db8a40b64d6b2c6f0bd3f24c3807849addecfe681918eb24cfc277f4f8a54" },
  labellingBrief: { file: "labelling-brief.md", sha256: "18cdc46489500ccfb30e1c5d1ca92f50827dccae29a8f3a4544459eb06dbb702" },
} as const;

export type PromptName = keyof typeof PROMPT_PINS;

const cache = new Map<PromptName, string>();

/** A build-time prompt's text, read once and checked against its pin. */
export function pinned(name: PromptName): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const pin = PROMPT_PINS[name];
  const bytes = readFileSync(join(PROMPT_DIR, pin.file));
  const got = sha256(bytes);
  if (got !== pin.sha256) fail("E_USAGE", "prompts/author/" + pin.file + " has sha256 " + got + ", not the pinned " + pin.sha256);
  const text = bytes.toString("utf8");
  cache.set(name, text);
  return text;
}

/** key.json in the author prompt's own format, for the transform and the twin translation (no ids, no flags). */
export function authorKeyJson(k: Key): string {
  const items = k.items.map((i) => ({ class: i.class, statement: i.statement, detail: i.detail, evidence: i.evidence }));
  const mentioned = k.items.filter((i) => i.mentioned).map((i) => i.class);
  return JSON.stringify({ items, mentioned, wrong_way: k.wrongWay, ...(k.decoy !== null ? { decoy: k.decoy } : {}) }, null, 2);
}

/** key.json as auditors read it: ids, wording, pointers, the mentioned flags, the wrong-way facts and the decoy. */
export function auditKeyJson(items: readonly KeyItem[], k: Key): string {
  return JSON.stringify({ items: items.map((i) => ({ id: i.id, class: i.class, statement: i.statement, detail: i.detail, evidence: i.evidence, mentioned: i.mentioned })), wrong_way: k.wrongWay, ...(k.decoy !== null ? { decoy: k.decoy } : {}) }, null, 2);
}

const evidenceBlock = (u: UnitFiles, withLines: boolean): string => u.evidence.map((e) => underPath(e.path, withLines ? numbered(e.text) : e.text)).join("\n");

/** Step 1: the author's input bundle, then the frozen author prompt with the kind's words. */
export const authorPrompt = (bundle: string, kind: ChangeKind): string => bundle + "\n\n" + AUTHOR_PROMPT.replace("<kind>", CHANGE_KINDS[kind]);

/** K6: the first prompt, the previous output and the fixed rewrite note naming each failed check. */
export const rewritePrompt = (first: string, previous: string, failures: readonly Failure[]): string =>
  first + "\n\nYour previous output:\n" + previous + "\n\n" + pinned("rewriteNote") + failures.map((f) => "- " + f.check + ": " + f.detail).join("\n") + "\n";

/** The unit's files as one JSON object in the author format, for a rewrite's "previous output". */
export const unitJson = (u: UnitFiles): string => JSON.stringify({ plan: u.plan, evidence: u.evidence, key: JSON.parse(authorKeyJson(u.key)) }, null, 2);

/** The first markdown heading of a text, or "(no heading)". */
export const firstHeading = (text: string | null): string => (text ?? "").split("\n").find((l) => /^#{1,6}\s/.test(l))?.replace(/^#+\s*/, "").trim() ?? "(no heading)";

/**
 * Step 2: the frozen prompt, then the README, design files, the tree with each docs file's first heading, and plan.md.
 * BT: the README and the tree take the author bundle's caps; every evidence path is listed whatever the cap.
 */
export function contextPrompt(app: BaseAppView, design: string, u: UnitFiles, docsDir: string): string {
  const evidence = new Map(u.evidence.map((e) => [e.path, e.text]));
  const tree = [...new Set([...[...app.tree].sort().slice(0, AUTHORING.bundle.treePaths), ...evidence.keys()])].sort();
  const lines = tree.map((p) => (p.startsWith(docsDir) ? p + "  # " + firstHeading(evidence.get(p) ?? app.read(p)) : p));
  return CONTEXT_WRITER_PROMPT + "\n\n" + underPath("README", capped(app.readme, AUTHORING.bundle.readmeBytes)) + "\n" + design + "\n" + underPath("file tree", lines.join("\n")) + "\n" + underPath("plan.md", u.plan);
}

/** Step 4: the pinned audit prompt (and the 2x additions), then everything the author and context writer saw and wrote. */
export function auditPrompt(bundle: string, u: UnitFiles, items: readonly KeyItem[], x2: boolean): string {
  return pinned("audit") + (x2 ? "\n" + pinned("audit2x") : "") + "\n\n## The author's input material\n\n" + bundle + "\n\n## What the author and the context writer wrote\n\n" + underPath("plan.md", u.plan) + "\n" + underPath("context/project.md", u.context ?? "") + "\n" + evidenceBlock(u, true) + "\n" + underPath("key.json", auditKeyJson(items, u.key));
}

/** The fix step: the pinned fix prompt, the case, both auditors' notes on the items to fix, and their ids. */
export function fixPrompt(u: UnitFiles, fixIds: readonly string[], notes: readonly { auditor: string; id: string; verdict: string; reason: string }[]): string {
  const noteLines = notes.filter((n) => fixIds.includes(n.id)).map((n) => "- " + n.id + ", " + n.auditor + " (" + n.verdict + "): " + n.reason);
  return pinned("fix") + "\n" + underPath("plan.md", u.plan) + "\n" + underPath("context/project.md", u.context ?? "") + "\n" + evidenceBlock(u, true) + "\n" + underPath("key.json", auditKeyJson(u.key.items, u.key)) + "\nAuditors' notes:\n" + noteLines.join("\n") + "\n\nItems to fix: " + fixIds.join(", ") + "\n";
}

/** Steps 5 and 6: the frozen opening, the files under their paths, then the template after a blank line. */
export function validatorPrompt(kind: "unanimous" | "give-away", u: UnitFiles, app: BaseAppView, citedBaseFiles: readonly string[]): string {
  const head = underPath("plan.md", u.plan) + "\n" + underPath("context/project.md", u.context ?? "");
  if (kind === "give-away") return GIVE_AWAY_OPENING + "\n\n" + head + "\n" + TEMPLATE;
  const design = app.designFiles.map((p) => underPath(p, app.read(p) ?? "")).join("\n");
  const cited = citedBaseFiles.filter((p) => !app.designFiles.includes(p)).map((p) => underPath(p, app.read(p) ?? "")).join("\n");
  return FULL_INFORMATION_OPENING + "\n\n" + head + "\n" + evidenceBlock(u, false) + "\n" + design + (cited ? "\n" + cited : "") + "\n" + TEMPLATE;
}

/** A label packet: the pinned brief, whether details are asked, the items, then each list's numbered changes. */
export function labelPacket(items: readonly { id: string; statement: string; detail: string | null }[], lists: readonly { id: string; changes: readonly string[] }[], details: boolean): string {
  const itemLines = items.map((i) => "- " + i.id + ": " + i.statement + (details && i.detail !== null ? " (detail: " + i.detail + ")" : ""));
  const listBlocks = lists.map((l) => "List " + l.id + ":\n" + l.changes.map((c, n) => "  " + (n + 1) + ". " + c).join("\n"));
  return pinned("labellingBrief") + "\nDetails: " + (details ? "yes" : "no") + "\n\nKey items:\n" + itemLines.join("\n") + "\n\n" + listBlocks.join("\n\n") + "\n";
}

/** The 2x transform: the frozen prompt ("Below are"), then plan.md, the evidence files and key.json. */
export const transformPrompt = (u: UnitFiles): string => TRANSFORM_2X_PROMPT + "\n\n" + underPath("plan.md", u.plan) + "\n" + evidenceBlock(u, false) + "\n" + underPath("key.json", authorKeyJson(u.key));

/** The twin translation: the next base app's bundle, the case in the author format, then the frozen twin note. */
export const twinPrompt = (targetBundle: string, u: UnitFiles): string => targetBundle + "\n\n## The case\n\n" + unitJson(u) + "\n\n" + TWIN_NOTE;
