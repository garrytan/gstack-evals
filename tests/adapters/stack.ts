// The fake stack for the arm install tests: tests/adapters/fixtures/fake-stack committed as the base, then a second
// commit that edits demo's SKILL.md, with HEAD and the working tree back on the base.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, git } from "../cli/helpers.ts";

export const FAKE_STACK = join(import.meta.dir, "fixtures", "fake-stack");

export function fakeStack(): { root: string; base: string; edited: string } {
  const root = mkdtempSync(join(tmpdir(), "gse-stack-"));
  cpSync(FAKE_STACK, root, { recursive: true });
  const base = commitAll(root, "base");
  const md = join(root, "demo", "SKILL.md");
  writeFileSync(md, readFileSync(md, "utf8").replace("# Demo base", "# Demo edited"));
  const edited = commitAll(root, "edited");
  git(root, "checkout", "-q", base);
  return { root, base, edited };
}
