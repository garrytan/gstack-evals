// The stacks the stack arm kind installs besides gstack (plan 2026-10-30-geva-59-stacks-round-1-plan, sections 3 and 4):
// where each lives, the commit the plan pinned, how its tree is installed per host, and the commands a lane tells the
// model to open with. Nothing from either stack is vendored: the rig extracts each tree from a local clone at the pinned
// commit and verifies it against the commit's tree id (src/arms/install.ts), and each installer runs that tree as its
// author publishes it. pstack is Lauren Tan's (MIT, in cursor/plugins); tstack is Theo Browne's (MIT, t3dotgg/tstack).
//
// - pstack: the generated Claude Code plugin under harness/pstack/claude-code, checked out at ~/.local/share/pstack and
//   loaded for every session as a plugin directory (Claude Code's --plugin-dir, through the Agent SDK's plugins option),
//   so its skills answer as /pstack:<name>. The tree has no marketplace file, and a plugin directory needs none. The
//   installer runs pstack's own bootstrap for poteto-mode's scripts in the builder, where egress is open, so the
//   scripts find their pinned dependencies offline in a trial.
// - tstack: the whole tree, installed by the copy of skills/ into the host's skills directory that its README gives.
//   sol-loop runs Sol only through a subagent set up for it and refuses to substitute a model, so the arm adds one
//   rig-authored, disclosed file: agents/sol.md beside this module, at ~/.claude/agents/sol.md. It relays the brief to
//   the cell's voice (gpt-6.1-sol) through the Codex CLI on the session's proxy slot, taking the model from the
//   session's Codex config, and its sha256 is in the arm's provenance.
// - gstack is not listed: a stack arm whose repository is not listed here runs gstack's own ./setup (stackInstall).
import { fileURLToPath } from "node:url";
import type { Host, StackRef } from "../types.ts";

export interface StackKind {
  /** The arm's usual name, and the checkout's name under ~/.local/share. */
  name: string;
  repo: string;
  /** The subtree that is installed, when the stack is one folder of a larger repository. */
  path?: string;
  author: string;
  license: string;
  /** The commit the plan pinned on 2026-10-30, and the git tree of what is installed (the subtree's, when path is set). */
  pin: { sha: string; git_tree: string };
  /** The installer per host, run in the checkout. A host with no entry cannot install the stack. */
  install: Partial<Record<Host, string>>;
  /** The checkout is a Claude Code plugin, loaded for each session as a plugin directory. */
  plugin: boolean;
  /** Rig-authored files the arm adds on the claude host, by destination under HOME. */
  files: Record<string, string>;
  /** The stack keeps a cross-family voice through the Codex CLI in a cell that admits one. */
  voice: boolean;
  /** The command each lane's told prompt opens with; null where the plan runs no such cell. */
  told: { review: string; tb2: string | null };
}

export const SOL_AGENT = fileURLToPath(new URL("./agents/sol.md", import.meta.url));

/** pstack's installer: its own bootstrap installs poteto-mode's script dependencies from their lockfile. A tree without it fails to install. */
const PSTACK_INSTALL = "(cd skills/poteto-mode/scripts && bun -e 'import(\"./bootstrap.ts\").then((m) => m.ensureDependenciesInstalled())')";

export const STACKS: readonly StackKind[] = [
  {
    name: "pstack",
    repo: "cursor/plugins",
    path: "harness/pstack/claude-code",
    author: "Lauren Tan",
    license: "MIT",
    pin: { sha: "c742dd61706fbacc1b95f1a20b7b988cf096ce6c", git_tree: "cdbbd4ca5dd2f4ca0eef3294e7b981c0c610d4bb" },
    install: { claude: PSTACK_INSTALL },
    plugin: true,
    files: {},
    voice: false,
    told: { review: "/pstack:interrogate", tb2: "/pstack:poteto-mode" },
  },
  {
    name: "tstack",
    repo: "t3dotgg/tstack",
    author: "Theo Browne",
    license: "MIT",
    pin: { sha: "1085050f3baed1ac724caa4a8166145fb2ac88af", git_tree: "a939d866f545629c277cc9fdf766051385f3e9d9" },
    install: { claude: 'mkdir -p "$HOME/.claude/skills" && cp -R skills/* "$HOME/.claude/skills/"', codex: 'mkdir -p "$HOME/.codex/skills" && cp -R skills/* "$HOME/.codex/skills/"' },
    plugin: false,
    files: { ".claude/agents/sol.md": SOL_AGENT },
    voice: true,
    told: { review: "/sol-loop", tb2: null },
  },
];

/** The listed stack a ref names: the same repository (or its last segment, as gstack@<sha> names gstack) and the same subtree. */
export function stackKind(ref: StackRef): StackKind | null {
  return STACKS.find((k) => (ref.repo === k.repo || ref.repo === k.repo.split("/").pop()) && (ref.path ?? "") === (k.path ?? "")) ?? null;
}
