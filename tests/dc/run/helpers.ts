// Copyright (c) 2026 Garry Tan. MIT License.
// Shared fixtures for the run area's tests: an invented base app committed with fixed metadata, the pinned gstack
// checkout when this machine has one (DC_GSTACK_PIN_DIR), and transcript builders.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GSTACK_PIN } from "../../../lanes/design-constructed/frozen.ts";
import { git } from "../../../lanes/design-constructed/run/export.ts";

/** Commits everything in dir (force-adding ignored files) with fixed metadata; returns the commit id. */
export function commitAll(dir: string, message = "fixture"): string {
  if (!existsSync(join(dir, ".git"))) git(dir, ["init", "-q", "--template="]);
  git(dir, ["add", "-A", "-f"]);
  const tree = git(dir, ["write-tree"]).stdout.trim();
  const parent = git(dir, ["rev-parse", "-q", "--verify", "HEAD"], { ok: [0, 1] }).stdout.trim();
  const body = "tree " + tree + "\n" + (parent ? "parent " + parent + "\n" : "") + "author t <t@invalid> 1 +0000\ncommitter t <t@invalid> 1 +0000\n\n" + message + "\n";
  const c = git(dir, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: body }).stdout.trim();
  git(dir, ["update-ref", "HEAD", c]);
  return c;
}

/** A small invented web app with files a strip removes and files it keeps. */
export function baseApp(files: Record<string, string> = {}): { dir: string; pin: string } {
  const dir = mkdtempSync(join(tmpdir(), "dc-app-"));
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "demo", dependencies: { react: "19.0.0" } }) + "\n",
    "src/components/Button.tsx": "export const Button = () => null;\n",
    "src/pages/index.tsx": "export default function Home() { return null; }\n",
    ".gitignore": "dist/\n*.log\n",
    "dist/tracked.js": "// tracked though ignored\n",
    "CLAUDE.md": "instructions\n",
    ".claude/settings.json": "{}\n",
    ...files,
  };
  for (const [p, t] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), t);
  }
  return { dir, pin: commitAll(dir) };
}

export const EVIDENCE = [
  { path: "docs/research/notes.md", text: "# Research notes\n\nFour of six people looked for the export button below the fold.\n" },
  { path: "docs/support/summary.md", text: "# Support summary\n\nTickets about empty dashboards rose in March.\n" },
];

/** The pinned gstack checkout, when DC_GSTACK_PIN_DIR names one at the pin; else null and the reason. */
export function pinnedGstack(): { dir: string; bin: string } | { skip: string } {
  const dir = process.env.DC_GSTACK_PIN_DIR;
  if (!dir) return { skip: "DC_GSTACK_PIN_DIR is unset: clone garrytan/gstack at " + GSTACK_PIN.commit + " and point it there" };
  const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  if (head !== GSTACK_PIN.commit) return { skip: "DC_GSTACK_PIN_DIR is at " + head + ", not the pin " + GSTACK_PIN.commit };
  return { dir, bin: join(dir, "bin") };
}

type Block = Record<string, unknown>;
export const say = (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
export const call = (id: string, name: string, input: Record<string, unknown>, result: string, error = false): Block[] => [
  { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: result, is_error: error }] } },
];
export const tx = (...ms: unknown[]): string => ms.flat().map((m) => JSON.stringify(m)).join("\n") + "\n";
export const BLOCK = "```plan-changes\n" + JSON.stringify({ changes: ["Show an empty state on the dashboard with one action."] }) + "\n```";

/** A stand-in for the score area's parser: the last plan-changes fence holding {"changes": [...]}. */
export const parseStub = (reply: string) => {
  const m = [...reply.matchAll(/```plan-changes\n([\s\S]*?)\n```/g)].at(-1);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]!);
    return Array.isArray(v.changes) ? { source: "none" as const, changes: v.changes.map(String) } : null;
  } catch {
    return null;
  }
};
