// Copyright (c) 2026 Garry Tan. MIT License.
// The export intake, keyless: a kept clone or a kept bundle exports only when its HEAD is the base app's recorded commit
// and HEAD^{tree} its recorded tree; a mismatch or a commit that can no longer be fetched drops the base app with the
// reason printed (E_BASE_APP_DROPPED), and nothing is written.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { exportUnit, git, type BaseRecord, type ExportSource } from "../../../lanes/design-constructed/run/export.ts";
import { baseApp, EVIDENCE, recordOf } from "./helpers.ts";

const root = mkdtempSync(join(tmpdir(), "dc-intake-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const out = () => join(root, "out" + n++);

function drop(source: ExportSource, record: BaseRecord): { code: string; message: string; wrote: boolean } {
  const to = out();
  try {
    exportUnit({ source, expect: record, evidence: EVIDENCE, out: to });
  } catch (e) {
    return { code: e instanceof DcError ? e.code : "not a DcError", message: (e as Error).message, wrote: existsSync(to) };
  }
  throw new Error("the export passed");
}

const nextCommit = (dir: string, rec: BaseRecord): string => {
  const child = git(dir, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: "tree " + rec.tree + "\nparent " + rec.commit + "\nauthor t <t@invalid> 2 +0000\ncommitter t <t@invalid> 2 +0000\n\nnext\n" }).stdout.trim();
  git(dir, ["update-ref", "refs/heads/next", child]);
  return child;
};

describe("the export intake checks the recorded commit and tree", () => {
  // Value: protects=the Captain's ruling on recorded base apps: the export starts only from a source whose HEAD is the recorded commit and whose HEAD^{tree} is the recorded tree, from a kept clone or a kept bundle alike; fails_when=a bundle exports another commit than its clone, or a mismatched or unfetchable source exports or fails with another code; why_new=run area open item 9 (exportUnit took a clone only) and the intake ruling; seam=exportUnit, intakeBase; no_claim=which apps the frame records, or the caller's drop bookkeeping
  test("a clone and its bundle at the recorded commit and tree export the same commit", () => {
    const app = baseApp();
    const rec = recordOf(app.dir);
    const bundle = join(root, "match.bundle");
    git(app.dir, ["bundle", "create", "-q", bundle, "HEAD"]);
    const viaClone = exportUnit({ source: { clone: app.dir }, expect: rec, evidence: EVIDENCE, out: out() });
    const viaBundle = exportUnit({ source: { bundle }, expect: rec, evidence: EVIDENCE, out: out() });
    expect(viaBundle.manifest).toEqual(viaClone.manifest);
    expect(viaClone.manifest.base).toEqual({ pin: rec.commit, tree: rec.tree });
  });

  test("a HEAD or tree other than the record drops the base app with the reason", () => {
    const app = baseApp();
    const rec = recordOf(app.dir);
    const bundle = join(root, "mismatch.bundle");
    git(app.dir, ["bundle", "create", "-q", bundle, "HEAD"]);
    const other = { commit: nextCommit(app.dir, rec), tree: rec.tree };
    for (const source of [{ clone: app.dir }, { bundle }]) {
      const head = drop(source, other);
      expect(head).toMatchObject({ code: "E_BASE_APP_DROPPED", wrote: false });
      expect(head.message).toContain("HEAD is " + rec.commit + ", not the recorded commit " + other.commit);
      expect(head.message).toContain("never swapped");
      const tree = drop(source, { commit: rec.commit, tree: "3".repeat(40) });
      expect(tree).toMatchObject({ code: "E_BASE_APP_DROPPED", wrote: false });
      expect(tree.message).toContain("HEAD^{tree} is " + rec.tree + ", not the recorded tree " + "3".repeat(40));
    }
  });

  test("a commit that can no longer be fetched drops the base app", () => {
    const app = baseApp();
    const rec = recordOf(app.dir);
    const child = nextCommit(app.dir, rec);
    const thin = join(root, "thin.bundle");
    git(app.dir, ["bundle", "create", "-q", thin, "refs/heads/next", "^" + rec.commit]);
    expect(drop({ bundle: thin }, { commit: child, tree: rec.tree })).toMatchObject({ code: "E_BASE_APP_DROPPED", message: expect.stringContaining("git bundle verify failed") });
    const noHead = join(root, "nohead.bundle");
    git(app.dir, ["bundle", "create", "-q", noHead, "refs/heads/next"]);
    expect(drop({ bundle: noHead }, { commit: child, tree: rec.tree })).toMatchObject({ code: "E_BASE_APP_DROPPED", message: expect.stringContaining("names no HEAD") });
    rmSync(join(app.dir, ".git", "objects", rec.commit.slice(0, 2), rec.commit.slice(2)));
    expect(drop({ clone: app.dir }, rec)).toMatchObject({ code: "E_BASE_APP_DROPPED", message: expect.stringContaining("can no longer be read") });
    expect(drop({ clone: join(root, "no-such-clone") }, rec)).toMatchObject({ code: "E_BASE_APP_DROPPED", message: expect.stringContaining("does not exist") });
    expect(drop({ bundle: join(root, "no-such.bundle") }, rec)).toMatchObject({ code: "E_BASE_APP_DROPPED", message: expect.stringContaining("does not exist") });
  });
});
