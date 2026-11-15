// Copyright (c) 2026 Garry Tan. MIT License.
// The B oracle with Docker (GSTACK_EVALS_DOCKER=1; it needs network for the npm, Playwright and runtime layers). Two
// small repositories are served from a local git daemon, built with the frozen recipes, stored by digest in a local
// registry:2 and prepared from the stored digest only. The B2 one (Go) takes the state machines oracle with 3 base and 3
// fixed runs. The B1 one (Playwright on Chromium) takes the browser-engine check and 5 base and 5 fixed runs in the
// hardened container with the browser conditions. No outside repository is fetched.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pacer, treeVolume } from "../../lanes/outcome-skills/statemachines/oracle.ts";
import { dropVolume } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { readUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { docker, dockerAvailable } from "../../lanes/real-outcome/task/docker.ts";
import { statementText } from "../../lanes/outcome-skills/h2h/breadth/b1.ts";
import { buildImage } from "../../lanes/outcome-skills/h2h/breadth/build.ts";
import { sha256 } from "../../lanes/outcome-skills/h2h/breadth/frame.ts";
import { fetchFix, oracleB, prepareB, repoFacts, type BCandidate, type BuildRecord } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import { chooseRecipe, isDrop, type Recipe } from "../../lanes/outcome-skills/h2h/breadth/recipes.ts";
import { registryStore, type ImageStore } from "../../lanes/outcome-skills/h2h/breadth/store.ts";

const REGISTRY = "registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
const on = process.env.GSTACK_EVALS_DOCKER === "1" && dockerAvailable();
const reg = "h2h-reg-oracle-" + process.pid;
const port = 20000 + (process.pid % 20000);
let root = "", store: ImageStore, daemon: ReturnType<typeof Bun.spawn> | null = null;
const cleanup: (() => void)[] = [];

const run = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 600_000 });
  if (r.status !== 0) throw new Error(cmd + " " + args.join(" ") + ": " + r.stderr + r.stdout);
  return r.stdout.trim();
};
const git = (args: string[], cwd: string) => run("git", ["-c", "user.name=h2h", "-c", "user.email=h2h@example.invalid", ...args], cwd);

/** A repository with a base commit and a fix commit, served by the daemon and cloned bare into work. */
function plant(repo: string, base: Record<string, string>, fix: Record<string, string>, work: string, prep?: (src: string) => void): { parent: string; commit: string } {
  const src = join(root, "srv", repo);
  mkdirSync(src, { recursive: true });
  for (const [p, t] of Object.entries(base)) {
    mkdirSync(join(src, p, ".."), { recursive: true });
    writeFileSync(join(src, p), t);
  }
  prep?.(src);
  git(["init", "-q"], src);
  git(["config", "uploadpack.allowAnySHA1InWant", "true"], src);
  git(["add", "-A"], src);
  git(["commit", "-q", "-m", "base"], src);
  const parent = git(["rev-parse", "HEAD"], src);
  for (const [p, t] of Object.entries(fix)) writeFileSync(join(src, p), t);
  git(["commit", "-q", "-am", "fix"], src);
  mkdirSync(join(work, "git"), { recursive: true });
  git(["clone", "-q", "--bare", src, join(work, "git", repo.replace("/", "__") + ".git")], root);
  return { parent, commit: git(["rev-parse", "HEAD"], src) };
}

async function buildStorePrepare(c: BCandidate, work: string, extra: { db?: string; gql?: Parameters<typeof prepareB>[0]["gql"] }) {
  const dir = fetchFix(work, c);
  if (isDrop(dir)) throw new Error(dir.rule);
  const eco = c.ecosystems[0]!;
  const recipe = chooseRecipe(c.kind, eco, repoFacts(dir, c.fix.parent)) as Recipe;
  const b = buildImage({ recipe, repoUrl: "git://172.17.0.1:" + port + "/" + c.repo, parent: c.fix.parent, tag: "h2h-b-test/" + c.id + "-" + process.pid });
  if (isDrop(b)) throw new Error(b.rule + "\n" + b.log_tail);
  cleanup.push(() => docker(["rmi", "-f", b.tag], { timeoutMs: 120_000 }));
  const s = store.push(b.tag);
  const build: BuildRecord = { schema: "h2h-b-build.v1", id: c.id, kind: c.kind, verdict: "built", rule: null, ecosystem: eco, recipe, tag: b.tag, image_id: b.image_id, wall_ms: b.wall_ms, dockerfile_sha256: sha256(b.dockerfile) };
  const prep = await prepareB({ c, work, ref: s.ref, store, build, ...extra });
  cleanup.push(() => dropVolume(treeVolume(c.id)));
  return { prep, ref: s.ref };
}

describe.skipIf(!on)("the B oracle with Docker", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "h2h-oracle-"));
    expect(docker(["run", "-d", "--rm", "--name", reg, "-p", "127.0.0.1::5000", REGISTRY], { timeoutMs: 300_000 }).status).toBe(0);
    store = registryStore("127.0.0.1:" + docker(["port", reg, "5000"], { timeoutMs: 30_000 }).stdout.trim().split(":").pop() + "/h2h-oracle-test");
    mkdirSync(join(root, "srv"), { recursive: true });
    daemon = Bun.spawn(["git", "daemon", "--base-path=" + join(root, "srv"), "--export-all", "--reuseaddr", "--listen=0.0.0.0", "--port=" + port, join(root, "srv")], { stdout: "ignore", stderr: "ignore" });
  });
  afterAll(() => {
    daemon?.kill();
    for (const f of cleanup) f();
    docker(["rm", "-f", reg], { timeoutMs: 60_000 });
    rmSync(root, { recursive: true, force: true });
  });

  test("B2 (Go): kept over 3 base and 3 fixed runs", async () => {
    const work = join(root, "work-b2"), db = join(root, "db");
    const tst = 'package calc\n\nimport "testing"\n\nfunc TestSub(t *testing.T) {\n\tif Sub(3, 1) != 2 {\n\t\tt.Fatal("sub")\n\t}\n}\n';
    const fix = plant("acme/calc", { "go.mod": "module example.com/calc\n\ngo 1.21\n", "calc.go": "package calc\n\nfunc Add(a, b int) int { return a - b }\n\nfunc Sub(a, b int) int { return a - b }\n", "calc_test.go": tst }, { "calc.go": "package calc\n\nfunc Add(a, b int) int { return a + b }\n\nfunc Sub(a, b int) int { return a - b }\n", "calc_test.go": tst + '\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 2) != 4 {\n\t\tt.Fatal("add")\n\t}\n}\n' }, work);
    mkdirSync(db, { recursive: true });
    writeFileSync(join(db, "adv.json"), JSON.stringify({ id: "GHSA-test-0000-0000", summary: "Add returns the difference of its arguments", details: "Every caller that sums two quantities with calc.Add gets a minus b instead of a plus b, so totals computed from user input come out wrong and checks that compare totals can be passed with crafted values." }));
    const c: BCandidate = { kind: "B2", id: "acme__calc-ghsa-test", repo: "acme/calc", ecosystems: ["Go"], month: "2026-05", created_at: "2026-05-01", pull: "", fix, licence: "MIT", runners: [], ghsa: "GHSA-test-0000-0000", advisory_path: "adv.json" };
    const { prep } = await buildStorePrepare(c, work, { db });
    expect([prep.verdict, prep.runner]).toEqual(["ready", "go"]);
    const v = await oracleB(prep.unit_dir!, store, new Pacer(join(work, "pacer.log")));
    expect(v.verdict).toBe("kept");
    const u = readUnit(prep.unit_dir!);
    expect(u.oracle!.runs.map((r) => r.tree + r.n)).toEqual(["base1", "fixed1", "base2", "fixed2", "base3", "fixed3"]);
    expect(u.oracle!.f2p).toEqual(["example.com/calc::TestAdd"]);
  }, 1_800_000);

  test("B1 (Playwright on Chromium): the browser-engine check, then kept over 5 base and 5 fixed runs with the browser conditions", async () => {
    const work = join(root, "work-b1");
    const spec = "import { test, expect } from '@playwright/test';\nimport { focusScript } from '../src/focus';\n\ntest('renders the button', async ({ page }) => {\n  await page.setContent('<button id=\"b\">Save</button>');\n  await expect(page.locator('#b')).toHaveText('Save');\n});\n";
    const fix = plant("acme/web", {
      "package.json": JSON.stringify({ name: "focus-fixture", private: true, version: "0.0.0", devDependencies: { "@playwright/test": "1.65.1" } }, null, 2) + "\n",
      "playwright.config.ts": "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './e2e', projects: [{ name: 'chromium', use: { browserName: 'chromium' } }] });\n",
      "src/focus.ts": "export const focusScript = \"document.getElementById('missing')?.focus()\";\n",
      "e2e/focus.spec.ts": spec, ".gitignore": "node_modules\n",
    }, {
      "src/focus.ts": "export const focusScript = \"document.getElementById('b').focus()\";\n",
      "e2e/focus.spec.ts": spec + "\ntest('moves focus to the button', async ({ page }) => {\n  await page.setContent('<button id=\"b\">Save</button><script>' + focusScript + '</script>');\n  await expect(page.locator('#b')).toBeFocused();\n});\n",
    }, work, (src) => run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], src));
    const title = "Focus does not move to the Save button", body = "When the dialog opens, keyboard focus should land on the Save button so that pressing Enter saves. Instead focus stays on the page body, so keyboard users must tab through every control first. This only shows in a real browser, where focus and the active element are tracked.";
    const c: BCandidate = { kind: "B1", id: "acme__web-1", repo: "acme/web", ecosystems: ["npm"], month: "2026-06", created_at: "2026-06-02", pull: "1", fix, licence: "MIT", runners: ["playwright"], issue_url: "https://github.com/acme/web/issues/1", statement_sha256: sha256(statementText(title, body)) };
    const { prep } = await buildStorePrepare(c, work, { gql: async () => ({ data: { resource: { title, body } } }) });
    expect([prep.verdict, prep.runner, prep.browser?.ok, prep.browser?.tests[0]?.engine]).toEqual(["ready", "playwright", true, "chromium"]);
    const v = await oracleB(prep.unit_dir!, store, new Pacer(join(work, "pacer.log")));
    expect(v.verdict).toBe("kept");
    const u = readUnit(prep.unit_dir!);
    expect(u.oracle!.runs).toHaveLength(10);
    expect(u.oracle!.f2p).toEqual(["[chromium]::focus.spec.ts::focus.spec.ts::::moves focus to the button"]);
    expect(u.oracle!.stable).toContain("[chromium]::focus.spec.ts::focus.spec.ts::::renders the button");
    expect(readFileSync(join(prep.unit_dir!, "issue.md"), "utf8")).toBe(statementText(title, body));
  }, 3_600_000);
});
