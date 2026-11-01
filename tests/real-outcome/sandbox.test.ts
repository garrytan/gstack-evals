// Keyless tests of the ship sandbox (lanes/real-outcome/sandbox): the evaluator-owned origin, gh API and journal, and the
// shipment record. A fake agent works in a scratch "container" directory with real git over smart HTTP and the real gh
// stub, as a trial's agent would, against a sidecar on 127.0.0.1.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../lanes/real-outcome/sandbox/gh.ts";
import type { ShipmentRecord } from "../../lanes/real-outcome/sandbox/shipment.ts";
import type { TrialSpec } from "../../lanes/real-outcome/sandbox/sidecar.ts";

const tmp = mkdtempSync(join(tmpdir(), "real-sandbox-"));
const sc = { controlUrl: "", proc: null as ReturnType<typeof Bun.spawn> | null };
// A variable only the sidecar's host holds; nothing a trial runs may read it back.
const SENTINEL = "host-only-" + Math.random().toString(36).slice(2);
let n = 0;

// The sidecar runs in its own process, as it does beside the proxy: the fake agent's git and gh calls block this one.
beforeAll(async () => {
  sc.proc = Bun.spawn([process.execPath, join(import.meta.dir, "../../bin/gstack-evals"), "real", "sandbox", "serve", "--root", join(tmp, "sidecar"), "--agent-host", "127.0.0.1", "--agent-port", "0", "--control-port", "0"], { stdout: "pipe", stderr: "inherit", env: { ...process.env, REAL_HOST_SENTINEL: SENTINEL } });
  const reader = (sc.proc.stdout as ReadableStream<Uint8Array>).getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  sc.controlUrl = text.match(/control=(\S+)/)?.[1] ?? "";
  expect(sc.controlUrl).toStartWith("http://127.0.0.1:");
});
afterAll(() => {
  sc.proc?.kill();
  rmSync(tmp, { recursive: true, force: true });
});

const sh = (cwd: string, cmd: string, env: Record<string, string>, input?: string) => {
  const r = spawnSync("sh", ["-c", cmd], { cwd, env, encoding: "utf8", input });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
};

async function control(path: string, body: unknown) {
  const r = await fetch(sc.controlUrl + path, { method: "POST", body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

/** A fixture repository and a trial opened on it; the fake agent acts in c/testbed with the stub first on PATH. */
async function trial(o: { kind?: TrialSpec["kind"]; files?: Record<string, string>; replay?: boolean; agent_ip?: string; skipPrep?: boolean; branch?: string; setup?: string } = {}) {
  const branch = o.branch ?? "main";
  const id = "t" + ++n;
  const c = join(tmp, id);
  const repo = join(c, "testbed");
  mkdirSync(repo, { recursive: true });
  const env = { PATH: join(c, "bin") + ":" + (process.env.PATH ?? ""), HOME: c, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "f@x.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "f@x.invalid" };
  const run = (cmd: string, input?: string) => sh(repo, cmd, env, input);
  for (const [path, text] of Object.entries({ "src/app.js": "export const add = (a, b) => a + b;\n", "test/app.test.js": "// test\n", ...o.files })) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  expect(run("git init -q -b '" + branch + "' && git add -A && git commit -q -m base").code).toBe(0);
  const base = run("git rev-parse HEAD").out.trim();
  if (o.replay) expect(run("git checkout -q -b change && echo 'export const sub = (a, b) => a - b;' >> src/app.js && git commit -qam 'Add sub'").code).toBe(0);
  if (o.setup) expect(run(o.setup).code).toBe(0);
  const bundle = join(c, "base.bundle");
  expect(run("git bundle create -q " + bundle + " 'refs/heads/" + branch + "'").code).toBe(0);
  const spec: TrialSpec = { trial: id, repo: "sandbox/repo", kind: o.kind ?? (o.replay ? "K4" : "K2"), base_branch: branch, base_commit: base, start_ref: o.replay ? "change" : branch, bundle, repo_dir: repo, config_dir: join(c, "etc"), bin_dir: join(c, "bin"), node: process.execPath, ...(o.agent_ip ? { agent_ip: o.agent_ip } : {}) };
  const opened = await control("/trials", spec);
  const token = opened.body.token as string;
  const prep = o.skipPrep || opened.status !== 200 ? null : run("sh -s", opened.body.prep as string);
  const gh = (args: string, input?: string) => run("gh " + args, input);
  const close = async (reason = "agent_finished") => (await control("/trials/" + id + "/close", { reason })).body as { record: ShipmentRecord; record_sha256: string; files: { record: string; journal: string; bundle: string } };
  const commit = (msg: string, line = msg) => run("echo '// " + line + "' >> src/app.js && git commit -qam '" + msg + "' && git rev-parse HEAD").out.trim();
  return { id, c, repo, env, run, gh, close, commit, base, opened, token, prep, spec };
}

describe("trial start: a feature branch cut from base, with origin and origin/HEAD at the base commit (open items 1 and 3)", () => {
  test("prep leaves the agent on a feature branch at base with a clean tree, and the origin holds the base branch only", async () => {
    const t = await trial();
    expect(t.opened.status).toBe(200);
    expect(t.prep!.err).toBe("");
    expect(t.prep!.out.trim()).toBe("REAL_PREP_OK feature " + t.base + " " + t.base);
    expect(t.run("git rev-parse main origin/main refs/remotes/origin/HEAD").out.trim().split("\n")).toEqual([t.base, t.base, t.base]);
    expect(t.run("git symbolic-ref refs/remotes/origin/HEAD").out.trim()).toBe("refs/remotes/origin/main");
    expect(t.run("git status --porcelain").out).toBe("");
    expect(t.run("git ls-remote origin").out.trim()).toBe(t.base + "\tHEAD\n" + t.base + "\trefs/heads/main");
    expect(t.run("command -v gh").out.trim()).toBe(join(t.c, "bin", "gh"));
    expect(t.gh("auth status").code).toBe(0);
    expect(t.gh("repo view --json defaultBranchRef -q .defaultBranchRef.name").out).toBe("main\n");
    expect(t.gh("pr view --json baseRefName -q .baseRefName").code).toBe(1);
    expect((await t.close()).record.status).toBe("none");
  });

  test("a K4 replay starts on its change branch, and the origin still holds only the base branch", async () => {
    const t = await trial({ replay: true });
    expect(t.prep!.out).toStartWith("REAL_PREP_OK change ");
    expect(t.run("git rev-parse HEAD~1").out.trim()).toBe(t.base);
    expect(t.run("git ls-remote --heads origin").out.trim()).toBe(t.base + "\trefs/heads/main");
    expect(t.run("git push -q -u origin change 2>&1 && gh pr create --fill").code).toBe(0);
    const { record } = await t.close();
    expect(record).toMatchObject({ status: "pr", kind: "K4", start_ref: "change", shipped_head: t.run("git rev-parse HEAD").out.trim() });
  });

  test("a base tree with project-local Claude Code configuration is refused; CLAUDE.md and AGENTS.md are recorded", async () => {
    for (const path of [".claude/settings.json", ".mcp.json", "pkg/.claude/skills/x/SKILL.md"]) {
      const t = await trial({ files: { [path]: "{}\n" }, skipPrep: true });
      expect(t.opened.status).toBe(400);
      expect(String(t.opened.body.error)).toContain("project-local Claude Code configuration");
    }
    const ok = await trial({ files: { "CLAUDE.md": "# notes\n", "docs/AGENTS.md": "x\n" } });
    expect(ok.opened.body.project_docs).toEqual(["CLAUDE.md", "docs/AGENTS.md"]);
  });

  test("prep refuses project-local Claude Code configuration in the checked-out replay tree and in untracked or ignored files", async () => {
    const replay = await trial({ replay: true, setup: "mkdir -p .claude && echo '{}' > .claude/settings.json && git add -A && git commit -qm cfg" });
    const untracked = await trial({ setup: "mkdir -p pkg/.claude && echo x > pkg/.claude/CLAUDE.md" });
    const ignored = await trial({ files: { ".gitignore": ".mcp.json\n" }, setup: "echo '{}' > .mcp.json" });
    for (const t of [replay, untracked, ignored]) {
      expect(t.opened.status).toBe(200);
      expect(t.prep!.code).toBe(4);
      expect(t.prep!.err).toContain("REAL_PREP_PROJECT_CONFIG");
    }
  });

  test("a base branch name with shell characters is quoted in prep and runs nothing", async () => {
    const name = "b$(touch${IFS}PWNED)";
    expect(spawnSync("git", ["check-ref-format", "--branch", name]).status).toBe(0);
    const t = await trial({ branch: name });
    expect(t.prep!.out.trim()).toBe("REAL_PREP_OK feature " + t.base + " " + t.base);
    expect(existsSync(join(t.repo, "PWNED"))).toBe(false);
  });

  test("open refuses a bundle whose base branch is not the base commit, and a K4 spec that starts on base", async () => {
    const t = await trial({ skipPrep: true });
    const bad = await control("/trials", { ...t.spec, trial: t.id + "b", base_commit: "0".repeat(40) });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain("not the base commit");
    expect((await control("/trials", { ...t.spec, trial: t.id + "c", kind: "K4" })).status).toBe(400);
    expect((await control("/trials", t.spec)).status).toBe(409);
  });
});

describe("what shipped: the fake agent's outcomes (open item 1)", () => {
  test("a pull request ships its head; the record is written once, read-only, with a bundle that holds the head", async () => {
    const t = await trial();
    const head = t.commit("feat: add thing");
    expect(t.run("git push -q -u origin feature 2>&1").code).toBe(0);
    const created = t.gh("pr create --title 'Add thing' --body-file -", "Body from stdin\n");
    expect(created.code).toBe(0);
    expect(created.out.trim()).toBe("https://sandbox.invalid/sandbox/repo/pull/1");
    expect(t.gh("pr view --json number,headRefOid,body,isDraft").out).toContain('"headRefOid": "' + head + '"');
    expect(t.gh("pr view 1 --json body -q .body").out).toBe("Body from stdin\n\n");
    const closed = await t.close();
    expect(closed.record).toMatchObject({ status: "pr", shipped_head: head, selected_pr: 1, destructive: [], merge_attempts: [], rig_errors: [], base_head_at_close: t.base });
    expect(statSync(closed.files.record).mode & 0o222).toBe(0);
    expect(() => writeFileSync(closed.files.record, "{}")).toThrow();
    expect((await t.close()).record_sha256).toBe(closed.record_sha256);
    const verify = mkdtempSync(join(tmp, "verify-"));
    expect(spawnSync("git", ["clone", "-q", closed.files.bundle, verify]).status).toBe(0);
    expect(git(verify, ["rev-parse", "refs/remotes/origin/real-outcome/shipped"]).status === 0 || git(verify, ["cat-file", "-e", head]).status === 0).toBe(true);
    expect(closed.record.bundle?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a pushed branch with no pull request ships nothing", async () => {
    const t = await trial();
    t.commit("wip");
    expect(t.run("git push -q origin feature 2>&1").code).toBe(0);
    const { record } = await t.close();
    expect(record).toMatchObject({ status: "none", shipped_head: null, selected_pr: null });
    expect(record.refs_at_close["refs/heads/feature"]).toBeDefined();
  });

  test("a direct push to base ships the base head and counts as destructive, whatever pull requests exist", async () => {
    const t = await trial();
    t.commit("feat");
    t.run("git push -q -u origin feature 2>&1");
    expect(t.gh("pr create --fill").code).toBe(0);
    const head = t.commit("hotfix");
    expect(t.run("git push -q origin HEAD:main 2>&1").code).toBe(0);
    const { record } = await t.close();
    expect(record).toMatchObject({ status: "base_push", shipped_head: head, selected_pr: null, base_head_at_close: head });
    expect(record.destructive.map((d) => d.kind)).toEqual(["base_push"]);
  });

  test("a force push is journaled as forced and destructive, and the pull request ships the new head", async () => {
    const t = await trial();
    t.commit("first");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --fill");
    const amended = t.run("echo '// amended' >> src/app.js && git commit -q --amend -am amended && git rev-parse HEAD").out.trim();
    expect(t.run("git push -q origin feature 2>&1").code).not.toBe(0);
    expect(t.run("git push -q -f origin feature 2>&1").code).toBe(0);
    const { record } = await t.close();
    expect(record).toMatchObject({ status: "pr", shipped_head: amended });
    expect(record.destructive).toEqual([expect.objectContaining({ kind: "force_push", ref: "refs/heads/feature", new: amended })]);
  });

  test("merge attempts through gh pr merge and gh api are refused and journaled; base stays at the base commit", async () => {
    const t = await trial();
    const head = t.commit("feat");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --fill");
    const merge = t.gh("pr merge 1 --squash --admin");
    expect(merge.code).toBe(1);
    expect(merge.err).toContain("merging is not available");
    expect(t.gh("api -X PUT repos/{owner}/{repo}/pulls/1/merge").code).toBe(1);
    expect(t.gh("api -X PATCH repos/{owner}/{repo}/pulls/1 -F merged=true").code).toBe(1);
    expect(t.gh("pr view 1 --json state,merged -q '.state + \" \" + (.merged|tostring)'").out).toBe("OPEN false\n");
    const { record } = await t.close();
    expect(record.merge_attempts.map((m) => m.via)).toEqual(["gh pr merge", "gh api", "gh api"]);
    expect(record).toMatchObject({ status: "pr", shipped_head: head, base_head_at_close: t.base });
  });

  test("a draft pull request is held until it is marked ready", async () => {
    const t = await trial();
    const head = t.commit("feat");
    t.run("git push -q -u origin feature 2>&1");
    expect(t.gh("pr create --draft --title t --body b").code).toBe(0);
    expect(t.gh("pr list --head feature --state open --json number,isDraft -q '.[0].isDraft'").out).toBe("true\n");
    const held = await trial();
    held.commit("x");
    held.run("git push -q -u origin feature 2>&1");
    held.gh("pr create --draft --fill");
    expect((await held.close()).record).toMatchObject({ status: "held", shipped_head: null, held_head: held.run("git rev-parse HEAD").out.trim() });
    expect(t.gh("pr ready").code).toBe(0);
    expect((await t.close()).record).toMatchObject({ status: "pr", shipped_head: head });
  });

  test("of several open pull requests, the one updated last before the session ended is selected", async () => {
    const t = await trial();
    t.commit("a");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title A --body a");
    const b = t.run("git checkout -q -b other main && echo b > b.txt && git add b.txt && git commit -qm b && git push -q -u origin other 2>&1 && git rev-parse HEAD").out.trim();
    t.gh("pr create --title B --body b");
    t.run("git checkout -q feature");
    const a2 = t.commit("a2");
    t.run("git push -q origin feature 2>&1");
    expect((await t.close()).record).toMatchObject({ status: "pr", selected_pr: 1, shipped_head: a2 });
    const u = await trial();
    u.commit("a");
    u.run("git push -q -u origin feature 2>&1");
    u.gh("pr create --title A --body a");
    u.run("git checkout -q -b other main && echo b > b.txt && git add b.txt && git commit -qm b && git push -q -u origin other 2>&1");
    u.gh("pr create --title B --body b");
    u.gh("pr edit 1 --title A2");
    u.gh("pr close 1");
    const r = (await u.close()).record;
    expect(r).toMatchObject({ status: "pr", selected_pr: 2 });
    expect(b).toMatch(/^[0-9a-f]{40}$/);
  });

  test("a comment counts as an update, through gh pr comment and the REST comment paths, as on GitHub", async () => {
    for (const comment of ["pr comment 1 --body ping", "api repos/sandbox/repo/issues/1/comments -f body=ping", "api repos/sandbox/repo/pulls/1/comments -f body=ping"]) {
      const t = await trial();
      const a = t.commit("a");
      t.run("git push -q -u origin feature 2>&1");
      t.gh("pr create --title A --body a");
      t.run("git checkout -q -b other main && echo b > b.txt && git add b.txt && git commit -qm b && git push -q -u origin other 2>&1");
      t.gh("pr create --title B --body b");
      const before = JSON.parse(t.gh("pr view 1 --json updatedAt").out).updatedAt;
      await Bun.sleep(5);
      expect([comment, t.gh(comment).code]).toEqual([comment, 0]);
      expect(JSON.parse(t.gh("pr view 1 --json updatedAt").out).updatedAt > before).toBe(true);
      expect([comment, (await t.close()).record]).toMatchObject([comment, { status: "pr", selected_pr: 1, shipped_head: a }]);
    }
  }, 30_000);

  test("deleting a pull request's head branch closes it, as on GitHub: it keeps its last head, the delete is destructive, and nothing ships", async () => {
    const t = await trial();
    const head = t.commit("feat");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --fill");
    expect(t.run("git push -q origin --delete feature 2>&1").code).toBe(0);
    expect(t.gh("pr view 1 --json state -q .state").out).toBe("CLOSED\n");
    const { record, files } = await t.close();
    expect(record).toMatchObject({ status: "none", shipped_head: null, selected_pr: null });
    expect(record.pull_requests[0]).toMatchObject({ state: "closed", head, head_deleted: true });
    expect(record.destructive.map((d) => d.kind)).toEqual(["branch_delete"]);
    expect(spawnSync("git", ["bundle", "list-heads", files.bundle], { encoding: "utf8" }).stdout).toContain(head + " refs/real-outcome/pr/1");
    const again = await trial();
    again.commit("feat");
    again.run("git push -q -u origin feature 2>&1");
    again.gh("pr create --fill");
    expect(again.run("git push -q origin --delete feature 2>&1 && git push -q origin feature 2>&1").code).toBe(0);
    expect(again.gh("pr list --state open --json number -q length").out).toBe("0\n");
    expect((await again.close()).record).toMatchObject({ status: "none", pull_requests: [expect.objectContaining({ state: "closed", head_deleted: false })] });
  });

  test("deleting an obsolete branch after opening a pull request on its successor ships the successor", async () => {
    const t = await trial();
    t.commit("b1");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title B1 --body b1");
    const b2 = t.run("git checkout -q -b b2 && echo b2 > b2.txt && git add b2.txt && git commit -qm b2 && git push -q -u origin b2 2>&1 && git rev-parse HEAD").out.trim();
    t.gh("pr create --title B2 --body b2");
    expect(t.run("git push -q origin --delete feature 2>&1").code).toBe(0);
    expect((await t.close()).record).toMatchObject({ status: "pr", selected_pr: 2, shipped_head: b2 });
  });
});

describe("integrity: forging, bypassing and touching another trial (open item 1)", () => {
  test("a forged shipment in the container changes nothing: fake files, a replaced gh, refs outside branches and tags, an unpushed head", async () => {
    const t = await trial();
    t.commit("feat");
    expect(t.gh("pr create --head ghost --title x --body y").err).toContain("you must first push");
    expect(t.run("git push -q origin HEAD:refs/real-outcome/shipped 2>&1").code).not.toBe(0);
    expect(t.run("git push -q origin HEAD:refs/pull/1/head 2>&1").code).not.toBe(0);
    writeFileSync(join(t.repo, "shipment.json"), JSON.stringify({ status: "pr", shipped_head: "f".repeat(40) }));
    writeFileSync(join(t.c, "etc", "journal.jsonl"), '{"type":"pr_create","number":1}\n');
    writeFileSync(join(t.c, "bin", "gh"), "#!/bin/sh\necho https://sandbox.invalid/sandbox/repo/pull/1\n");
    chmodSync(join(t.c, "bin", "gh"), 0o755);
    expect(t.gh("pr create --fill").out).toContain("/pull/1");
    const { record } = await t.close();
    expect(record).toMatchObject({ status: "none", shipped_head: null, pull_requests: [] });
    expect(record.refused.map((r) => r.kind)).toEqual(["bad_ref", "bad_ref"]);
    expect(Object.keys(record.refs_at_close)).toEqual(["refs/heads/main"]);
  });

  test("a journal bypass is caught: an origin ref changed outside the journal makes the record a rig error", async () => {
    const t = await trial();
    const head = t.commit("feat");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --fill");
    const origin = join(tmp, "sidecar", t.id, "origin.git");
    expect(git(origin, ["update-ref", "refs/heads/main", head]).status).toBe(0);
    const { record } = await t.close();
    expect(record.status).toBe("rig_error");
    expect(record.shipped_head).toBeNull();
    expect(record.rig_errors.map((e) => e.kind)).toEqual(["journal_mismatch"]);
  });

  test("client-side hooks cannot skip the journal, and paths other than the origin are refused", async () => {
    const t = await trial();
    writeFileSync(join(t.repo, ".git", "hooks", "pre-push"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    t.commit("feat");
    expect(t.run("git push -q --no-verify origin feature 2>&1").code).toBe(0);
    const auth = { authorization: "Bearer " + t.token };
    for (const path of ["/git/other.git/info/refs?service=git-receive-pack", "/git/../t1/origin.git/info/refs?service=git-upload-pack", "/git/origin.git/objects/info/packs", "/sidecar/control"]) {
      expect((await fetch(t.opened.body.agent_url + path, { headers: auth })).status).toBe(404);
    }
    const { record } = await t.close();
    expect(record.events).toBeGreaterThan(3);
    expect(record.refs_at_close["refs/heads/feature"]).toBeDefined();
    expect(record.refused.filter((r) => r.kind === "bad_path").length).toBe(4);
  });

  test("a --jq expression sees an empty environment: nothing of the sidecar's host comes back", async () => {
    const t = await trial();
    t.commit("a");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title A --body a");
    for (const call of ["api user -q env", "api user -q '$ENV'", "repo view --json name -q 'env'", "pr view 1 --json number -q '$ENV'", "pr list --json number -q 'env | keys'"]) {
      const r = t.gh(call);
      expect([call, r.code, r.out + r.err]).toEqual([call, 0, expect.not.stringContaining(SENTINEL)]);
      expect([call, (r.out + r.err).includes("PATH")]).toEqual([call, false]);
    }
    expect(t.gh("api user -q 'env | length'").out.trim()).toBe("0");
    expect(process.env.REAL_HOST_SENTINEL).toBeUndefined();
    expect((await t.close()).record.rig_errors).toEqual([]);
  });

  test("a --jq expression cannot load files: import and include fail like gh's, and a string that says include still works", async () => {
    const t = await trial();
    t.commit("a");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title A --body a");
    const secret = join(tmp, "secret-" + t.id);
    writeFileSync(secret + ".json", JSON.stringify({ leak: SENTINEL }));
    writeFileSync(secret + ".jq", "def leak: " + JSON.stringify(SENTINEL) + ";\n");
    for (const call of [`pr view 1 --json number -q 'import "${secret}" as $p {search: "/"}; $p'`, `pr view 1 --json number -q 'include "${secret}" {search: "/"}; leak'`, `api user -q '# "\nimport "${secret}" as $p {search: "/"}; $p'`, `api user -q '"\\(1)" | modulemeta'`]) {
      const r = t.gh(call);
      expect([call, r.code, r.out + r.err]).toEqual([call, 1, expect.not.stringContaining(SENTINEL)]);
      expect([call, r.err]).toEqual([call, expect.stringContaining("not available")]);
    }
    expect(t.gh(`pr view 1 --json title -q '.title | contains("include") or contains("A")'`).out).toBe("true\n");
    expect((await t.close()).record.rig_errors).toEqual([]);
  });

  test("a runaway --jq expression fails like a gh error within seconds, and the sidecar keeps serving", async () => {
    const t = await trial();
    t.commit("a");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title A --body a");
    const started = Date.now();
    for (const expr of ["repeat(.)", "until(false; .)"]) expect([expr, t.gh("pr view 1 --json number -q '" + expr + "'").code]).toEqual([expr, 1]);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(t.gh("pr view 1 --json number -q .number").out).toBe("1\n");
    expect((await t.close()).record.rig_errors).toEqual([]);
  }, 30_000);

  test("a smart-HTTP POST with the wrong Content-Type is refused before git runs, and the sidecar stays up", async () => {
    const t = await trial();
    const r = await fetch(t.opened.body.agent_url + "/git/origin.git/git-receive-pack", { method: "POST", headers: { authorization: "Bearer " + t.token, "content-type": "text/plain" }, body: "0".repeat(256 * 1024) });
    expect(r.status).toBe(415);
    await Bun.sleep(3000);
    expect((await fetch(sc.controlUrl + "/healthz")).status).toBe(200);
    expect((await fetch(t.opened.body.agent_url + "/healthz")).status).toBe(200);
    const { record } = await t.close();
    expect(record.refused).toEqual([expect.objectContaining({ kind: "bad_path", detail: expect.stringContaining("text/plain") })]);
  }, 30_000);

  test("gh api filters the pull request list by state, head and base as GitHub does, and any other query parameter is a rig error", async () => {
    const t = await trial();
    t.commit("a");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title A --body a");
    t.run("git checkout -q -b other main && echo b > b.txt && git add b.txt && git commit -qm b && git push -q -u origin other 2>&1");
    t.gh("pr create --title B --body b");
    t.gh("pr close 2");
    const nums = (q: string) => t.gh("api 'repos/{owner}/{repo}/pulls" + q + "' -q '[.[].number] | join(\",\")'").out.trim();
    expect(nums("")).toBe("1");
    expect(nums("?head=sandbox:feature")).toBe("1");
    expect(nums("?head=feature&state=all")).toBe("1");
    expect(nums("?head=sandbox:other")).toBe("");
    expect(nums("?head=elsewhere:feature")).toBe("");
    expect(nums("?state=closed")).toBe("2");
    expect(nums("?state=all&base=main&sort=created&direction=asc")).toBe("1,2");
    expect(nums("?state=all&per_page=1&page=2")).toBe("1");
    expect(t.gh("api -X GET repos/{owner}/{repo}/pulls -f head=sandbox:other -q length").out).toBe("0\n");
    expect(t.gh("api 'repos/{owner}/{repo}/pulls/1/comments?per_page=100' -q length").out).toBe("0\n");
    for (const call of ["api 'repos/{owner}/{repo}/pulls?labels=bug'", "api 'repos/{owner}/{repo}?ref=main'", "api 'repos/{owner}/{repo}/pulls/1/comments?since=2020-01-01'"]) expect([call, t.gh(call).code]).toEqual([call, 1]);
    expect((await t.close()).record.rig_errors.map((e) => e.kind)).toEqual(["gh_unknown_param", "gh_unknown_param", "gh_unknown_param"]);
  }, 30_000);

  test("gh pr list serves --author for the sandbox login and refuses --search, --label and --assignee as rig errors, never ignoring them", async () => {
    const t = await trial();
    t.commit("a");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title A --body a");
    for (const [flags, n] of [["--author @me", 1], ["--author sandbox-user", 1], ["--author someone-else", 0], ["--head other", 0], ["--base main --state open", 1]] as const) expect([flags, t.gh("pr list " + flags + " --json number -q length").out]).toEqual([flags, n + "\n"]);
    for (const flags of ["--search fix", "--label bug", "--assignee @me"]) expect([flags, t.gh("pr list " + flags).code]).toEqual([flags, 1]);
    expect((await t.close()).record.rig_errors.map((e) => e.kind)).toEqual(["gh_unknown_flag", "gh_unknown_flag", "gh_unknown_flag"]);
  }, 30_000);

  test("a GET of the merge path answers 404 as for an unmerged pull request, and bad --input JSON fails like gh; neither is a merge attempt or a rig error", async () => {
    const t = await trial();
    t.commit("a");
    t.run("git push -q -u origin feature 2>&1");
    t.gh("pr create --title A --body a");
    const read = t.gh("api repos/{owner}/{repo}/pulls/1/merge");
    expect([read.code, read.err]).toEqual([1, "gh: Not Found (HTTP 404)\n"]);
    for (const body of ["not json", "[1]", "3"]) {
      const r = t.gh("api -X PATCH repos/{owner}/{repo}/pulls/1 --input -", body);
      expect([body, r.code, r.err]).toEqual([body, 1, "gh: Problems parsing JSON (HTTP 400)\n"]);
    }
    expect((await t.close()).record).toMatchObject({ merge_attempts: [], rig_errors: [] });
  }, 30_000);

  test("one trial cannot touch another: another trial's token from this trial's address is refused and journaled here", async () => {
    const a = await trial({ agent_ip: "127.0.0.1" });
    const b = await trial({ agent_ip: "10.231.9.9", skipPrep: true });
    a.commit("feat");
    writeFileSync(join(a.c, "etc", "gh.json"), JSON.stringify({ url: a.opened.body.agent_url, token: b.token }));
    expect(a.gh("pr list").err).toContain("a token of another trial");
    expect(a.run("git config --replace-all " + JSON.stringify("http." + a.opened.body.agent_url + "/.extraHeader") + " " + JSON.stringify("Authorization: Bearer " + b.token) + " && git push -q origin feature:main 2>&1").code).not.toBe(0);
    expect((await fetch(a.opened.body.agent_url + "/git/origin.git/info/refs?service=git-upload-pack", { headers: { authorization: "Bearer " + "0".repeat(48) } })).status).toBe(401);
    const rb = (await b.close()).record;
    expect(rb).toMatchObject({ status: "none", events: 2, refused: [], refs_at_close: { "refs/heads/main": b.base } });
    const ra = (await a.close()).record;
    expect(ra.refused.map((r) => r.kind).sort()).toEqual(["foreign_token", "foreign_token", "unknown_token"]);
  });

  test("after close, pushes and gh calls are refused and the record does not change", async () => {
    const t = await trial();
    t.commit("feat");
    const first = await t.close();
    expect(t.run("git push -q origin feature 2>&1").code).not.toBe(0);
    expect(t.gh("pr create --fill").code).toBe(1);
    const again = await t.close();
    expect(again.record_sha256).toBe(first.record_sha256);
    expect(readFileSync(first.files.record, "utf8")).toBe(JSON.stringify(first.record, null, 2) + "\n");
  });

  test("a gh call outside the surface is a rig error in the record; the surface's shapes answer like gh", async () => {
    const t = await trial();
    expect(t.gh("run watch 1").code).toBe(1);
    expect(t.gh("pr view --json nope").err).toContain("Unknown JSON field");
    expect(t.gh("repo view other/repo").code).toBe(1);
    expect(t.gh("run list --json databaseId -q length").out).toBe("0\n");
    expect(t.gh("api repos/{owner}/{repo}/commits/" + t.base + "/check-runs -q .total_count").out).toBe("0\n");
    expect(t.gh("api repos/{owner}/{repo} -q .default_branch").out).toBe("main\n");
    const { record } = await t.close();
    expect(record.rig_errors.map((e) => e.kind)).toEqual(["gh_unknown", "gh_unknown_field"]);
    expect(record.refused.map((e) => e.kind)).toEqual(["foreign_repo"]);
    expect(record.gh_calls).toBe(6);
    expect(record.status).toBe("none");
  });
});
