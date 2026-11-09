// The devex paid-mode pin guard: a run without --dry-run refuses with E_USAGE unless GSTACK_EVALS_DX_PIN names a
// checkout whose HEAD is the prereg's gstack pin and holds bin/gstack-session-kind. Tests can't fetch gstack, so
// dxPinProblem gets a temp repo's own commit as the expected sha, and dxMain's passing case runs a fake git on PATH
// that reports the pin.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../src/trial/review/cli.ts";
import { DX_GSTACK, dxPinProblem } from "../../../src/trial/review/devex.ts";
import { commitAll } from "../../cli/helpers.ts";

const TMP = mkdtempSync(join(tmpdir(), "dx-pin-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));
const stack = DX_GSTACK.repo + "@" + DX_GSTACK.sha;

function checkout(name: string, sessionKind = true): { dir: string; head: string } {
  const dir = join(TMP, name);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "VERSION"), DX_GSTACK.version + "\n");
  if (sessionKind) writeFileSync(join(dir, "bin", "gstack-session-kind"), "#!/bin/sh\necho interactive\n");
  return { dir, head: commitAll(dir) };
}

function run(env: Record<string, string>) {
  const units = join(TMP, "units");
  mkdirSync(join(units, "u1", "repo"), { recursive: true });
  writeFileSync(join(units, "u1", "unit.json"), JSON.stringify({ id: "u1" }));
  writeFileSync(join(units, "u1", "plan.md"), "Add an init command.\n");
  writeFileSync(join(units, "u1", "repo", "a.ts"), "export {};\n");
  const out: string[] = [];
  const err: string[] = [];
  const argv = ["--plan", "devex", "--units-dir", units, "--units", "all", "--models", "claude-opus-5-5", "--out", join(TMP, "out"), "--arms", "none", "plan-devex-review=" + stack];
  return { code: main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, env), err };
}

describe("the devex paid-mode pin guard", () => {
  // Value: protects=the pin check reads the checkout's own HEAD and its bin/gstack-session-kind; fails_when=it passes another commit, a checkout without the script, a directory that is not a checkout, or no pin; why_new=section 5's per-session kind record; seam=dxPinProblem; no_claim=gstack's own script
  test("dxPinProblem passes the expected commit with the script and refuses everything else", () => {
    const good = checkout("good");
    expect(dxPinProblem(good.dir, undefined, good.head)).toBeNull();
    expect(dxPinProblem(good.dir, undefined)).toContain("not the pin " + DX_GSTACK.sha);
    const bare = checkout("bare", false);
    expect(dxPinProblem(bare.dir, undefined, bare.head)).toContain("bin/gstack-session-kind");
    const plain = join(TMP, "plain");
    mkdirSync(plain, { recursive: true });
    expect(dxPinProblem(plain, undefined, good.head)).toContain("not a git checkout");
    expect(dxPinProblem(undefined, undefined)).toContain("GSTACK_EVALS_DX_PIN is not set");
  });

  // Value: protects=a paid run never reaches a session without the pinned checkout, and passes the guard with it; fails_when=a paid run proceeds unpinned or at a wrong commit, or the pinned checkout is refused by the guard; why_new=section 5's per-session kind record; seam=main dispatch, dxMain; no_claim=the paid loop, which still refuses after the guard
  test("a paid run refuses unset and at a wrong commit, and the pinned checkout reaches the session loop refusal", async () => {
    const unset = run({});
    expect(await unset.code).toBe(2);
    expect(unset.err.join("\n")).toMatch(/^E_USAGE .*GSTACK_EVALS_DX_PIN is not set[\s\S]*\n  fix: /);
    const wrong = checkout("wrong");
    const atWrong = run({ GSTACK_EVALS_DX_PIN: wrong.dir });
    expect(await atWrong.code).toBe(2);
    expect(atWrong.err.join("\n")).toMatch(new RegExp("^E_USAGE .*is at " + wrong.head + ", not the pin " + DX_GSTACK.sha));
    expect(atWrong.err.join("\n")).not.toContain("session loop is not built");
    const pinned = checkout("pinned");
    const bin = join(TMP, "fake-git");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "git"), "#!/bin/sh\necho " + DX_GSTACK.sha + "\n");
    chmodSync(join(bin, "git"), 0o755);
    const ok = run({ GSTACK_EVALS_DX_PIN: pinned.dir, PATH: bin + ":/usr/bin:/bin" });
    expect(await ok.code).toBe(2);
    expect(ok.err.join("\n")).toMatch(/^E_USAGE .*session loop is not built/);
    expect(ok.err.join("\n")).not.toContain("GSTACK_EVALS_DX_PIN");
  });
});
