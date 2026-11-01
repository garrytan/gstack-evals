// The ship sandbox's evaluator-owned sidecar (plan 2026-11-01-geva-87, open item 1; lanes/real-outcome/sandbox/README.md).
// One process per batch, beside the metering proxy, outside every trial container. Per trial it holds:
//   - the origin, a bare repository seeded with the base branch only, served over git's smart HTTP (git http-backend);
//   - the gh API that the in-container stub (gh-stub.cjs) forwards every call to (gh.ts);
//   - the journal, one append-only file that only this process writes: every ref change on the origin, read as the
//     difference between the origin's refs before and after each push, every gh call and pull request change, every
//     merge attempt and every refused request;
//   - the shipment record, derived from the journal at close (shipment.ts) and written once, read-only.
// The agent plane serves the containers: a request is admitted only with its trial's token from its trial's address,
// on the three smart-HTTP paths or /gh. The control plane listens on 127.0.0.1 for the evaluator alone.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, runGh, type GhContext, type Issue, type Pr, type Visibility } from "./gh.ts";
import { deriveShipment, type JournalEvent, type Refs, type ShipmentRecord } from "./shipment.ts";

export const STUB = join(import.meta.dir, "gh-stub.cjs");
export const KINDS = ["K1", "K2", "K3", "K4"] as const;
const TRIAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
/** Paths that load project-local skills, plugins, agents, commands, settings or MCP servers in Claude Code; a base tree holding one is refused (open item 6). */
export const PROJECT_CONFIG = /(^|\/)(\.claude\/|\.mcp\.json$)/;
/** Project instruction files Claude Code loads in both arms alike; recorded, never removed. */
export const PROJECT_DOCS = /(^|\/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$/;

export interface TrialSpec {
  trial: string;
  /** owner/name the gh surface reports; never the upstream's, so the container learns nothing from it. */
  repo: string;
  kind: (typeof KINDS)[number];
  base_branch: string;
  base_commit: string;
  start_ref: string;
  /** Evaluator-side path of a bundle holding refs/heads/<base_branch> at base_commit. */
  bundle: string;
  /** The container's address on its network; requests from any other address are refused. Omit only in tests. */
  agent_ip?: string;
  visibility?: Visibility;
  /** Where prep writes the stub and its config in the container, and the repository's path there. */
  repo_dir?: string;
  feature_branch?: string;
  config_dir?: string;
  bin_dir?: string;
  node?: string;
}

export interface OpenResult {
  trial: string;
  token: string;
  agent_url: string;
  prep: string;
  project_docs: string[];
}

export interface CloseResult {
  record: ShipmentRecord;
  record_sha256: string;
  files: { record: string; journal: string; bundle: string | null };
}

export class SandboxError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface Trial {
  spec: TrialSpec;
  dir: string;
  origin: string;
  journalPath: string;
  token: string;
  seq: number;
  closed: CloseResult | null;
  prs: Pr[];
  issues: Issue[];
  lock: Promise<unknown>;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const must = (r: ReturnType<typeof git>, what: string) => {
  if (r.status !== 0) throw new SandboxError(what + ": " + (r.stderr || r.stdout).trim().slice(0, 500), 500);
  return r.stdout;
};

export function readRefs(origin: string): Refs {
  const out = must(git(origin, ["for-each-ref", "--format=%(refname) %(objectname)"]), "for-each-ref");
  return Object.fromEntries(out.split("\n").filter(Boolean).map((l) => l.split(" ") as [string, string]).filter(([r]) => !r.startsWith("refs/real-outcome/")));
}

const PRE_RECEIVE = (rejects: string) => "#!/bin/sh\n# Written by the real-outcome sidecar. Branches and tags only; refs/real-outcome/ is the evaluator's.\nstatus=0\nwhile read old new ref; do\n  case \"$ref\" in\n    refs/real-outcome/*) bad=1 ;;\n    refs/heads/*|refs/tags/*) bad=0 ;;\n    *) bad=1 ;;\n  esac\n  if [ \"$bad\" = 1 ]; then\n    echo \"refused: $ref is outside refs/heads and refs/tags in this sandbox\" >&2\n    printf '%s\\n' \"$ref\" >> '" + rejects.replaceAll("'", "") + "'\n    status=1\n  fi\ndone\nexit $status\n";

const shq = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

/** The script the evaluator runs in the trial container (docker exec sh -s) after the egress rules are on: the gh stub and its config, the origin remote with the trial's token, origin/<base> and origin/HEAD at the base commit, and the starting branch. */
export function prepScript(o: { spec: TrialSpec; agentUrl: string; token: string; stub: string }): string {
  const s = o.spec;
  const cfgDir = s.config_dir ?? "/etc/real-sandbox";
  const binDir = s.bin_dir ?? "/usr/local/bin";
  const node = s.node ?? "/opt/laneb/bin/node";
  const feature = s.feature_branch ?? "feature";
  const eof = "REAL_SANDBOX_EOF_" + randomBytes(8).toString("hex");
  const stub = o.stub.replace("__REAL_SANDBOX_CONFIG__", cfgDir + "/gh.json");
  const url = o.agentUrl.replace(/\/+$/, "");
  const base = s.base_branch;
  const lines = [
    "set -eu",
    "umask 022",
    "mkdir -p " + shq(cfgDir) + " " + shq(binDir),
    "cat > " + shq(cfgDir + "/gh.json") + " <<'" + eof + "'",
    JSON.stringify({ url, token: o.token }),
    eof,
    "cat > " + shq(cfgDir + "/gh.cjs") + " <<'" + eof + "'",
    stub.replace(/\n$/, ""),
    eof,
    "printf '%s\\n' '#!/bin/sh' " + shq("exec " + shq(node) + " " + shq(cfgDir + "/gh.cjs") + ' "$@"') + " > " + shq(binDir + "/gh"),
    "chmod 0755 " + shq(binDir + "/gh"),
    "chmod 0644 " + shq(cfgDir + "/gh.json") + " " + shq(cfgDir + "/gh.cjs"),
    "cd " + shq(s.repo_dir ?? "/testbed"),
    "test \"$(git rev-parse --verify -q " + shq("refs/heads/" + base) + ")\" = " + s.base_commit + " || { echo 'REAL_PREP_FAIL the base branch is not at the base commit' >&2; exit 3; }",
    "git remote remove origin 2>/dev/null || true",
    "git remote add origin " + shq(url + "/git/origin.git"),
    "git config " + shq("http." + url + "/.extraHeader") + " " + shq("Authorization: Bearer " + o.token),
    "git config user.name >/dev/null || git config user.name 'Sandbox User'",
    "git config user.email >/dev/null || git config user.email 'user@sandbox.invalid'",
    "git fetch -q origin " + shq("+refs/heads/" + base + ":refs/remotes/origin/" + base),
    "git remote set-head origin " + shq(base) + " >/dev/null",
    s.start_ref === base ? "git checkout -q -b " + shq(feature) + " " + shq(base) : "git checkout -q " + shq(s.start_ref),
    "bad=$({ git ls-tree -r --name-only HEAD; git ls-files -o; } | grep -E " + shq('(^|/|")(\.claude/|\.mcp\.json"?$)') + " | head -n 5 | tr '\n' ' ')",
    'test -z "$bad" || { echo "REAL_PREP_PROJECT_CONFIG the checked-out tree or its untracked files hold project-local Claude Code configuration: $bad" >&2; exit 4; }',
    "test \"$(command -v gh)\" = " + shq(binDir + "/gh") + " || { echo \"REAL_PREP_FAIL gh resolves to $(command -v gh), not the sandbox stub\" >&2; exit 3; }",
    'echo "REAL_PREP_OK $(git symbolic-ref --short HEAD) $(git rev-parse HEAD) $(git rev-parse refs/remotes/origin/HEAD)"',
  ];
  return lines.join("\n") + "\n";
}

export interface SidecarOptions {
  root: string;
  agentHost: string;
  agentPort: number;
  controlPort: number;
  /** The address containers use to reach the agent plane, when it differs from agentHost. */
  agentUrl?: string;
}

export interface SidecarHandle {
  controlUrl: string;
  agentUrl: string;
  stop: () => void;
}

export class Sidecar {
  readonly trials = new Map<string, Trial>();
  readonly byToken = new Map<string, Trial>();
  constructor(readonly root: string, public agentUrl: string) {
    mkdirSync(root, { recursive: true });
  }

  private journal(t: Trial, e: Parameters<GhContext["journal"]>[0]): void {
    if (t.closed) throw new SandboxError("the trial is closed", 403);
    appendFileSync(t.journalPath, JSON.stringify({ seq: ++t.seq, t: new Date().toISOString(), ...e }) + "\n");
  }

  /** Journals a ref change. Deleting a branch closes the open pull requests whose head it is, as on GitHub. */
  private journalRef(t: Trial, e: { ref: string; old: string | null; new: string | null; forced: boolean; via: "push" | "gh" }): void {
    this.journal(t, { type: "ref", ...e });
    if (e.new !== null) return;
    for (const pr of t.prs.filter((p) => p.state === "OPEN" && "refs/heads/" + p.head === e.ref)) {
      pr.state = "CLOSED";
      pr.updatedAt = new Date().toISOString();
      this.journal(t, { type: "pr_state", number: pr.number, state: "closed" });
    }
  }

  private locked<T>(t: Trial, fn: () => T | Promise<T>): Promise<T> {
    const run = t.lock.then(fn, fn);
    t.lock = run.catch(() => undefined);
    return run;
  }

  open(spec: TrialSpec): OpenResult {
    if (!TRIAL_ID.test(spec.trial ?? "")) throw new SandboxError("trial must match " + TRIAL_ID);
    if (!REPO.test(spec.repo ?? "")) throw new SandboxError("repo must be owner/name");
    if (!KINDS.includes(spec.kind)) throw new SandboxError("kind must be one of " + KINDS.join(", "));
    if (!SHA.test(spec.base_commit ?? "")) throw new SandboxError("base_commit must be a full lowercase sha");
    for (const [k, v] of [["base_branch", spec.base_branch], ["start_ref", spec.start_ref], ["feature_branch", spec.feature_branch ?? "feature"]] as const) {
      if (typeof v !== "string" || spawnSync("git", ["check-ref-format", "--branch", v], { encoding: "utf8" }).status !== 0 || v.startsWith("-")) throw new SandboxError(k + " is not a valid branch name");
    }
    if ((spec.kind === "K4") === (spec.start_ref === spec.base_branch)) throw new SandboxError("start_ref must be the base branch for K1 to K3 and the replay branch for K4");
    if (this.trials.has(spec.trial) || existsSync(join(this.root, spec.trial))) throw new SandboxError("trial " + spec.trial + " already exists", 409);
    if (!existsSync(spec.bundle ?? "")) throw new SandboxError("bundle not found: " + spec.bundle);
    const dir = join(this.root, spec.trial);
    const origin = join(dir, "origin.git");
    mkdirSync(dir, { recursive: true });
    try {
      must(git(dir, ["init", "-q", "--bare", "origin.git"]), "git init");
      must(git(origin, ["fetch", "-q", resolve(spec.bundle), "refs/heads/" + spec.base_branch + ":refs/heads/" + spec.base_branch]), "seeding the origin from the bundle");
      const head = must(git(origin, ["rev-parse", "refs/heads/" + spec.base_branch]), "rev-parse").trim();
      if (head !== spec.base_commit) throw new SandboxError("the bundle's " + spec.base_branch + " is " + head + ", not the base commit " + spec.base_commit);
      const tree = must(git(origin, ["ls-tree", "-r", "--name-only", spec.base_commit]), "ls-tree").split("\n").filter(Boolean);
      const config = tree.filter((p) => PROJECT_CONFIG.test(p));
      if (config.length) throw new SandboxError("the base tree holds project-local Claude Code configuration, which the sandbox refuses: " + config.slice(0, 5).join(", "));
      for (const args of [["symbolic-ref", "HEAD", "refs/heads/" + spec.base_branch], ["config", "http.receivepack", "true"], ["config", "receive.denyNonFastForwards", "false"], ["config", "receive.denyDeletes", "false"], ["config", "receive.advertisePushOptions", "false"], ["config", "gc.auto", "0"], ["config", "core.hooksPath", join(origin, "hooks")]]) must(git(origin, args), "configuring the origin");
      writeFileSync(join(origin, "hooks", "pre-receive"), PRE_RECEIVE(join(dir, "rejects.log")), { mode: 0o755 });
      const token = randomBytes(24).toString("hex");
      const t: Trial = { spec: { ...spec, visibility: spec.visibility ?? "PUBLIC" }, dir, origin, journalPath: join(dir, "journal.jsonl"), token, seq: 0, closed: null, prs: [], issues: [], lock: Promise.resolve() };
      this.journal(t, { type: "open", trial: spec.trial, repo: spec.repo, kind: spec.kind, base_branch: spec.base_branch, base_commit: spec.base_commit, start_ref: spec.start_ref, refs: readRefs(origin) });
      this.trials.set(spec.trial, t);
      this.byToken.set(token, t);
      return { trial: spec.trial, token, agent_url: this.agentUrl, prep: prepScript({ spec, agentUrl: this.agentUrl, token, stub: readFileSync(STUB, "utf8") }), project_docs: tree.filter((p) => PROJECT_DOCS.test(p)) };
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }

  private ctx(t: Trial): GhContext {
    return {
      repo: t.spec.repo,
      baseBranch: t.spec.base_branch,
      visibility: t.spec.visibility ?? "PUBLIC",
      origin: t.origin,
      prs: t.prs,
      issues: t.issues,
      journal: (e) => this.journal(t, e),
      deleteBranch: (branch) => {
        const ref = "refs/heads/" + branch;
        const old = readRefs(t.origin)[ref];
        if (old === undefined) return;
        must(git(t.origin, ["update-ref", "-d", ref, old]), "deleting " + ref);
        this.journalRef(t, { ref, old, new: null, forced: false, via: "gh" });
      },
      now: () => new Date().toISOString(),
    };
  }

  /** The trial a request belongs to, or why it is refused. Refusals are journaled to the trial that owns the source address. */
  admit(auth: string | null, ip: string): { trial: Trial } | { status: number; message: string } {
    const token = auth?.match(/^Bearer\s+([0-9a-f]{48})$/i)?.[1] ?? null;
    const t = token ? this.byToken.get(token) : undefined;
    const owner = [...this.trials.values()].find((x) => x.spec.agent_ip === ip && !x.closed);
    const refuse = (kind: string, status: number, message: string) => {
      if (owner && !owner.closed) this.journal(owner, { type: "refused", kind, detail: message + " (from " + ip + ")" });
      return { status, message };
    };
    if (!t) return refuse(token ? "unknown_token" : "no_token", 401, "the request carries no token of an open trial");
    if (t.spec.agent_ip !== undefined && t.spec.agent_ip !== ip) return refuse("foreign_token", 403, "a token of another trial");
    if (t.closed) return { status: 403, message: "the trial is closed" };
    return { trial: t };
  }

  async gh(t: Trial, body: { argv?: unknown; branch?: unknown }): Promise<{ stdout: string; stderr: string; exit: number }> {
    if (!Array.isArray(body.argv) || !body.argv.every((a) => typeof a === "string")) throw new SandboxError("argv must be a list of strings");
    return this.locked(t, () => {
      if (t.closed) throw new SandboxError("the trial is closed", 403);
      return runGh(this.ctx(t), { argv: body.argv as string[], branch: typeof body.branch === "string" ? body.branch : null });
    });
  }

  /** git smart HTTP for one request. A receive-pack holds the trial's lock and journals the refs it changed. */
  async git(t: Trial, req: Request, path: string, ip: string): Promise<Response> {
    const url = new URL(req.url);
    const m = path.match(/^\/git\/origin\.git(\/info\/refs|\/git-upload-pack|\/git-receive-pack)$/);
    const service = url.searchParams.get("service");
    if (!m || (m[1] === "/info/refs" && service !== "git-upload-pack" && service !== "git-receive-pack") || (m[1] !== "/info/refs" && req.method !== "POST") || (m[1] === "/info/refs" && req.method !== "GET")) {
      await this.locked(t, () => !t.closed && this.journal(t, { type: "refused", kind: "bad_path", detail: req.method + " " + path.slice(0, 200) }));
      return new Response("not found\n", { status: 404 });
    }
    const type = req.headers.get("content-type") ?? "";
    if (req.method === "POST" && type !== "application/x-" + m[1].slice(1) + "-request") {
      await this.locked(t, () => !t.closed && this.journal(t, { type: "refused", kind: "bad_path", detail: "POST " + path.slice(0, 200) + " with Content-Type " + type.slice(0, 100) }));
      return new Response("unsupported content type\n", { status: 415 });
    }
    const body = req.method === "POST" ? Buffer.from(await req.arrayBuffer()) : Buffer.alloc(0);
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_PROJECT_ROOT: t.dir, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: path.slice("/git".length), REQUEST_METHOD: req.method, QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: type, REMOTE_USER: "agent", REMOTE_ADDR: ip,
    };
    if (req.method === "POST") env.CONTENT_LENGTH = String(body.length);
    if (req.headers.get("content-encoding")) env.HTTP_CONTENT_ENCODING = req.headers.get("content-encoding")!;
    if (req.headers.get("git-protocol")) env.GIT_PROTOCOL = req.headers.get("git-protocol")!;
    const run = () =>
      new Promise<Buffer>((done, fail) => {
        const child = spawn("git", ["http-backend"], { env, stdio: ["pipe", "pipe", "pipe"] });
        const out: Buffer[] = [];
        child.stdout.on("data", (c: Buffer) => out.push(c));
        child.stderr.on("data", () => undefined);
        child.stdin.on("error", () => undefined);
        child.stdout.on("error", () => undefined);
        child.on("error", fail);
        child.on("close", () => done(Buffer.concat(out)));
        child.stdin.end(body);
      });
    const receive = m[1] === "/git-receive-pack";
    const raw = receive
      ? await this.locked(t, async () => {
          if (t.closed) throw new SandboxError("the trial is closed", 403);
          const rejects = join(t.dir, "rejects.log");
          rmSync(rejects, { force: true });
          const before = readRefs(t.origin);
          const result = await run();
          for (const ref of existsSync(rejects) ? readFileSync(rejects, "utf8").split("\n").filter(Boolean) : []) this.journal(t, { type: "refused", kind: "bad_ref", detail: "push to " + ref.slice(0, 200) });
          rmSync(rejects, { force: true });
          const after = readRefs(t.origin);
          for (const ref of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
            const old = before[ref] ?? null;
            const next = after[ref] ?? null;
            if (old === next) continue;
            const forced = old !== null && next !== null && git(t.origin, ["merge-base", "--is-ancestor", old, next]).status !== 0;
            this.journalRef(t, { ref, old, new: next, forced, via: "push" });
          }
          return result;
        })
      : await run();
    const split = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
    const sep = raw.indexOf("\r\n\r\n") >= 0 ? 4 : 2;
    if (split < 0) return new Response("git backend failed\n", { status: 500 });
    const headers = new Headers();
    let status = 200;
    for (const line of raw.subarray(0, split).toString("latin1").split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k.toLowerCase() === "status") status = Number(v.split(" ")[0]) || 500;
      else headers.append(k, v);
    }
    return new Response(raw.subarray(split + sep), { status, headers });
  }

  /** Freezes the trial, journals the close, derives the shipment record and writes it once with a bundle of every head. Idempotent. */
  async close(id: string, reason: string): Promise<CloseResult> {
    const t = this.trials.get(id);
    if (!t) throw new SandboxError("no trial " + id, 404);
    return this.locked(t, () => {
      if (t.closed) return t.closed;
      const refs = readRefs(t.origin);
      this.journal(t, { type: "close", reason: String(reason ?? "agent_finished").slice(0, 200), refs });
      const journal = readFileSync(t.journalPath);
      const events = journal.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as JournalEvent);
      const record = deriveShipment(events, refs, sha256(journal));
      const keep: [string, string | null][] = [["refs/real-outcome/shipped", record.shipped_head], ["refs/real-outcome/held", record.held_head], ...record.pull_requests.map((p) => ["refs/real-outcome/pr/" + p.number, p.head] as [string, string | null])];
      for (const [ref, sha] of keep) if (sha && git(t.origin, ["cat-file", "-e", sha + "^{commit}"]).status === 0) must(git(t.origin, ["update-ref", ref, sha]), "keeping " + ref);
      const bundlePath = join(t.dir, "shipped.bundle");
      must(git(t.origin, ["bundle", "create", "-q", bundlePath, "--all"]), "bundling the origin");
      record.bundle = { file: "shipped.bundle", sha256: sha256(readFileSync(bundlePath)) };
      const text = JSON.stringify(record, null, 2) + "\n";
      const recordPath = join(t.dir, "shipment.json");
      writeFileSync(recordPath, text, { flag: "wx", mode: 0o444 });
      chmodSync(recordPath, 0o444);
      chmodSync(t.journalPath, 0o444);
      t.closed = { record, record_sha256: sha256(text), files: { record: recordPath, journal: t.journalPath, bundle: bundlePath } };
      return t.closed;
    });
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body) + "\n", { status, headers: { "content-type": "application/json" } });

/** Starts both planes. The control plane binds 127.0.0.1 only. */
export function startSidecar(o: SidecarOptions): SidecarHandle {
  const agentUrl = o.agentUrl ?? "http://" + o.agentHost + ":" + o.agentPort;
  const sc = new Sidecar(o.root, agentUrl);
  const fail = (e: unknown) => (e instanceof SandboxError ? json(e.status, { error: e.message }) : json(500, { error: e instanceof Error ? e.message : String(e) }));
  const control = Bun.serve({
    hostname: "127.0.0.1",
    port: o.controlPort,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      try {
        if (req.method === "GET" && path === "/healthz") return json(200, { ok: true, trials: sc.trials.size });
        if (req.method === "POST" && path === "/trials") return json(200, sc.open((await req.json()) as TrialSpec));
        const m = path.match(/^\/trials\/([^/]+)\/close$/);
        if (req.method === "POST" && m) return json(200, await sc.close(decodeURIComponent(m[1]!), ((await req.json().catch(() => ({}))) as { reason?: string }).reason ?? "agent_finished"));
        return json(404, { error: "not found" });
      } catch (e) {
        return fail(e);
      }
    },
  });
  const agent = Bun.serve({
    hostname: o.agentHost,
    port: o.agentPort,
    maxRequestBodySize: 2 * 1024 * 1024 * 1024,
    async fetch(req, server) {
      const path = new URL(req.url).pathname;
      if (req.method === "GET" && path === "/healthz") return new Response("ok\n");
      const ip = (server.requestIP(req)?.address ?? "").replace(/^::ffff:/, "");
      try {
        const a = sc.admit(req.headers.get("authorization"), ip);
        if (!("trial" in a)) return json(a.status, { error: a.message, stdout: "", stderr: "gh: " + a.message + "\n", exit: 1 });
        if (path === "/gh" && req.method === "POST") return json(200, await sc.gh(a.trial, (await req.json()) as { argv?: unknown; branch?: unknown }));
        return await sc.git(a.trial, req, path, ip);
      } catch (e) {
        return fail(e);
      }
    },
  });
  sc.agentUrl = o.agentUrl ?? "http://" + o.agentHost + ":" + agent.port;
  return {
    controlUrl: "http://127.0.0.1:" + control.port,
    agentUrl: sc.agentUrl,
    stop: () => {
      control.stop(true);
      agent.stop(true);
    },
  };
}
