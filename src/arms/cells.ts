// Per-cell settings for a stack arm (plan 2026-10-30-geva-59-stacks-round-1-plan, section 5): what an arm's install
// holds or runs differently with the cell's model, so arms.json and the session key can record a tree per arm and cell.
//
// - A cell is the session's model and the cross-family voice it admits: gpt-6.1-sol in the Opus cells, none in a cheap
//   cell, where every role and reader runs on the cell's model.
// - pstack: ~/.claude/rules/pstack-models.md, the rule pstack's setup-pstack writes. It is derived at build time from the
//   rule shape in the pinned tree's setup-pstack SKILL.md (its step 5) and mapped as pstack's Claude Code adapter says:
//   in a voice cell each Claude slug becomes "<family> <effort>" and every other slug inherit-parent, so pstack's Grok
//   seats run on the session model; in a cheap cell every value is inherit-parent, list lengths kept, since a panel's
//   length sets its fan-out. The shape is read from the installed tree, so no pstack text is stored in this repo.
// - gstack: config keys for the trial's state root, appended after the seed (seedStateRoot's extra): agent_model host,
//   so its readers run on the parent model, and codex_reviews enabled only in a voice cell.
// - Codex: in a voice cell, an arm whose stack keeps a voice (gstack's outside voice, tstack's Sol reviewer) gets the
//   Claude Code driver's codex option, which writes the session's ~/.codex/config.toml with no credential in it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dirTreeSha256 } from "../trial/cache.ts";
import { canonicalize, InstallError, type ArmInstall, type Layer } from "./install.ts";
import { stackKind } from "./stacks.ts";
import type { StackRef } from "../types.ts";

export interface Cell {
  model: string;
  /** The cross-family voice the cell's proxy allowlist admits, or null when every role runs on model. */
  voice: string | null;
}

export interface CellSettings {
  cell: Cell;
  /** Files the cell adds under HOME on top of the arm's layers, or null. */
  layer: Layer | null;
  /** Keys the trial appends to the gstack state root's config.yaml; empty for an arm without gstack. */
  gstack_config: Record<string, string>;
  /** The Claude Code driver's codex option for this cell, or null. */
  codex: { model: string } | null;
  /** The arm's tree for this cell: the session key's arm tree when cells differ. */
  tree_sha256: string;
}

export const PSTACK_RULE = ".claude/rules/pstack-models.md";
const SLUG = /^claude-([a-z]+)-(?:\d+-)*\d+-(max|xhigh|high|medium|low)(?:-fast)?$/;

/** pstack's model rule for a cell, from setup-pstack's SKILL.md; null when the file holds no rule shape with role lines. */
export function pstackModelsRule(setupSkill: string, cell: Cell): string | null {
  const lines = setupSkill.split("\n");
  const step = lines.findIndex((l) => /^#{2,4}\s*5\.\s/.test(l));
  const open = step < 0 ? -1 : lines.findIndex((l, i) => i > step && l.startsWith("```"));
  const close = open < 0 ? -1 : lines.findIndex((l, i) => i > open && l.startsWith("```"));
  if (close < 0) return null;
  let body = lines.slice(open + 1, close);
  if (body[0] === "---") body = body.slice(body.indexOf("---", 1) + 1);
  const map = (v: string): string => {
    if (v === "auto" || v === "inherit-parent") return cell.voice ? v : "inherit-parent";
    const m = SLUG.exec(v);
    return cell.voice && m ? m[1] + " " + m[2] : "inherit-parent";
  };
  let roles = 0;
  const out = body.map((l) => {
    const m = /^([^#:][^:]*):\s*(.+)$/.exec(l);
    if (!m) return l;
    roles++;
    return m[1] + ": " + m[2]!.split(",").map((v) => map(v.trim())).join(", ");
  });
  return roles ? out.join("\n").trim() + "\n" : null;
}

/** The settings of one arm in one cell; a layer is written under dir when the cell adds files. */
export function cellSettings(install: ArmInstall, cell: Cell, dir: string): CellSettings {
  const kind = install.provenance.kind === "stack" ? stackKind(install.provenance.stack as StackRef) : null;
  let layer: Layer | null = null;
  if (kind?.plugin && install.plugins.length) {
    const file = join(install.layers[0]!.src, install.plugins[0]!, "skills", "setup-pstack", "SKILL.md");
    const rule = existsSync(file) ? pstackModelsRule(readFileSync(file, "utf8"), cell) : null;
    if (rule === null) throw new InstallError("E_CELL_RULE", "arm " + install.name + ": " + install.plugins[0] + "/skills/setup-pstack/SKILL.md holds no rule shape with role lines in its step 5, so the cell's " + PSTACK_RULE + " cannot be derived");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
    writeFileSync(join(dir, PSTACK_RULE), rule);
    canonicalize(dir, null);
    layer = { src: dir, dest: "" };
  }
  const gstack_config: Record<string, string> = install.gstack ? { agent_model: "host", codex_reviews: cell.voice ? "enabled" : "disabled" } : {};
  const codex = cell.voice && (install.gstack || kind?.voice) ? { model: cell.voice } : null;
  const parts = [install.tree_sha256, layer ? PSTACK_RULE + " " + dirTreeSha256(dir) : "", JSON.stringify(gstack_config), JSON.stringify(codex)];
  return { cell, layer, gstack_config, codex, tree_sha256: createHash("sha256").update(parts.join("\n")).digest("hex") };
}
