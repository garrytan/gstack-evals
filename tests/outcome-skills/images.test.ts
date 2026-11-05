// T-G's image manifest and the trial-image binding (lanes/outcome-skills/images/manifest.ts, real_agent's image_id). The
// keyless tier drives the manifest rules and bind against a stub docker, and runs image_test.py, which drives real_agent's
// check with the Agent SDK stubbed. The Docker tier (GSTACK_EVALS_DOCKER=1) binds a task to a real image and runs it.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bind, check, pin, publicForm, readManifest, tagFor, treeDigest, type ImageManifest } from "../../lanes/outcome-skills/images/manifest.ts";
import { fileDigests, walk } from "../../lanes/real-outcome/task/format.ts";
import { buildTask } from "../../lanes/real-outcome/task/build.ts";
import { CODES } from "../../src/errors/codes.ts";
import { buildRepo, calcCommits, calcSpecs } from "../real/fixture.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "outcome-images-"));
  roots.push(d);
  return d;
};
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const BIN = join(import.meta.dir, "..", "..", "bin", "gstack-evals");
const BARE = "sha256:" + "1".repeat(64);
const LAYERED = "sha256:" + "2".repeat(64);
const ID = "sha256:" + "a".repeat(64);
const OTHER = "sha256:" + "b".repeat(64);
const TOML = 'schema_version = "1.4"\n\n[metadata]\nlane = "real-outcome"\n\n[environment]\nnetwork_mode = "no-network"\nbuild_timeout_sec = 1800.0\nos = "linux"\n';

function task(root: string, from = "FROM busybox:1.36\nCOPY f /testbed/f\n") {
  const d = join(root, "task");
  mkdirSync(join(d, "environment"), { recursive: true });
  mkdirSync(join(d, "tests"), { recursive: true });
  writeFileSync(join(d, "task.toml"), TOML);
  writeFileSync(join(d, "instruction.md"), "Add it.\n");
  writeFileSync(join(d, "environment", "Dockerfile"), from);
  writeFileSync(join(d, "environment", "f"), "x\n");
  writeFileSync(join(d, "tests", "t.py"), "def test(): pass\n");
  writeFileSync(join(d, "task.json"), JSON.stringify({ id: "rox", kind: "K3", files: fileDigests(d) }));
  return d;
}
function manifest(root: string, d: string, image = ID): { path: string; m: ImageManifest } {
  const m: ImageManifest = { schema: "tg-images.v1", set: "T-G", gstack_evals: "test", home: "/root", workdir: "/testbed", rows: [{ label: "rox", kind: "K3", task_json_sha256: sha(readFileSync(join(d, "task.json"))), environment_sha256: treeDigest(join(d, "environment")), image_id: image }] };
  const path = join(root, "manifest.json");
  writeFileSync(path, JSON.stringify(m));
  return { path, m };
}
/** A docker that answers tag with exit 0, image inspect with RESOLVES, and run with RUN_EXIT, logging each call. */
function stubDocker(root: string, resolves: string, runExit = 0) {
  const p = join(root, "docker");
  const log = join(root, "docker.log");
  writeFileSync(p, "#!/bin/sh\necho \"$*\" >> " + log + "\ncase \"$1\" in\n  tag) exit 0 ;;\n  image) echo " + resolves + " ;;\n  run) exit " + runExit + " ;;\nesac\n");
  chmodSync(p, 0o755);
  return { docker: p, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}
const thrown = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("the T-G image manifest (keyless)", () => {
  test("readManifest refuses a wrong schema, a row with no sha256 image id, a missing digest and a repeated label", () => {
    const root = fresh();
    const { path, m } = manifest(root, task(root));
    expect(readManifest(path).rows[0]!.image_id).toBe(ID);
    const bad = (edit: (x: any) => void) => {
      const x = structuredClone(m) as any;
      edit(x);
      writeFileSync(path, JSON.stringify(x));
      return thrown(() => readManifest(path));
    };
    expect(bad((x) => (x.schema = "v0"))).toMatch(/^E_OUTCOME_IMAGE .*not a tg-images.v1 manifest/);
    expect(bad((x) => (x.workdir = "/work"))).toMatch(/^E_OUTCOME_IMAGE /);
    expect(bad((x) => (x.rows[0].image_id = "busybox:1.36"))).toMatch(/no sha256:<64 hex> image id/);
    expect(bad((x) => (x.rows[0].environment_sha256 = ""))).toMatch(/needs its task.json and environment digests/);
    expect(bad((x) => x.rows.push({ ...x.rows[0] }))).toMatch(/its own label/);
  });

  test("the public form carries digests and kind counts only, sorted, never a label", () => {
    const root = fresh();
    const { path, m } = manifest(root, task(root));
    m.rows.push({ ...m.rows[0]!, label: "roa", kind: "K2", image_id: OTHER, environment_sha256: "0".repeat(64) });
    writeFileSync(path, JSON.stringify(m));
    const p = publicForm(readManifest(path), readFileSync(path));
    expect(p).toEqual({ schema: "tg-images.public.v1", set: "T-G", manifest_sha256: sha(readFileSync(path)), gstack_evals: "test", rows: 2, kinds: { K3: 1, K2: 1 }, image_ids: [ID, OTHER], environment_sha256: ["0".repeat(64), m.rows[0]!.environment_sha256].sort() });
    expect(JSON.stringify(p)).not.toContain("rox");
  });

  test("bind writes a run copy whose environment is only FROM the pinned image's tag and whose task.toml names that tag", () => {
    const root = fresh();
    const d = task(root);
    const { m } = manifest(root, d);
    const s = stubDocker(root, ID);
    const out = join(root, "run");
    expect(bind(d, m, "rox", out, s.docker)).toEqual({ image_id: ID, tag: tagFor(ID), out });
    expect(s.calls()).toEqual(["tag " + ID + " " + tagFor(ID), "image inspect --format {{.Id}} " + tagFor(ID)]);
    expect(readdirSync(join(out, "environment"))).toEqual(["Dockerfile"]);
    expect(readFileSync(join(out, "environment", "Dockerfile"), "utf8")).toBe("FROM " + tagFor(ID) + "\n");
    expect(readFileSync(join(out, "task.toml"), "utf8")).toBe(TOML.replace("[environment]\n", "[environment]\ndocker_image = \"" + tagFor(ID) + "\"\n"));
    for (const f of ["task.json", "instruction.md", "tests/t.py"]) expect(readFileSync(join(out, f), "utf8")).toBe(readFileSync(join(d, f), "utf8"));
  });

  test("bind refuses a task dir that is not the pinned one, a tag that resolves to another id, an existing out dir and an unknown label", () => {
    const root = fresh();
    const d = task(root);
    const { m } = manifest(root, d);
    const out = join(root, "run");
    expect(thrown(() => bind(d, m, "rox", out, stubDocker(root, OTHER).docker))).toMatch(/^E_OUTCOME_IMAGE the tag .* resolves to sha256:b+, not sha256:a+/);
    expect(existsSync(out)).toBe(false);
    expect(thrown(() => bind(d, m, "nope", out, stubDocker(root, ID).docker))).toMatch(/no row for label nope/);
    writeFileSync(join(d, "environment", "f"), "y\n");
    expect(thrown(() => bind(d, m, "rox", out, stubDocker(root, ID).docker))).toMatch(/environment has digest .*not the manifest row's/);
    writeFileSync(join(d, "environment", "f"), "x\n");
    writeFileSync(join(d, "task.json"), "{}");
    expect(thrown(() => bind(d, m, "rox", out, stubDocker(root, ID).docker))).toMatch(/task.json has sha256 .*not the manifest row's/);
    mkdirSync(out);
    expect(thrown(() => bind(d, m, "rox", out, stubDocker(root, ID).docker))).toMatch(/exists; bind writes a new run copy/);
  });

  test.each([
    ["an edited file", /: instruction\.md differ from task\.json's file digests/, (d: string) => writeFileSync(join(d, "instruction.md"), "Add it, and delete the tests.\n")],
    ["an added file", /: tests\/extra\.py differ from task\.json's file digests/, (d: string) => writeFileSync(join(d, "tests", "extra.py"), "def test_more(): pass\n")],
    ["a deleted file", /: tests\/t\.py differ from task\.json's file digests/, (d: string) => rmSync(join(d, "tests", "t.py"))],
    ["a symlink", /holds symlinks \(tests\/link\.md\)/, (d: string) => symlinkSync(join(d, "instruction.md"), join(d, "tests", "link.md"))],
  ] as const)("bind refuses a task dir with %s against task.json's digests, before any run copy", (_what, why, edit) => {
    const root = fresh();
    const d = task(root);
    const { m } = manifest(root, d);
    const out = join(root, "run");
    edit(d);
    expect(thrown(() => bind(d, m, "rox", out, stubDocker(root, ID).docker))).toMatch(new RegExp("^E_OUTCOME_IMAGE .*" + why.source));
    expect(existsSync(out)).toBe(false);
  });

  test("bind refuses a task dir path that is itself a symlink, and leaves the task it points at untouched", () => {
    const root = fresh();
    const d = task(root);
    const { m } = manifest(root, d);
    const link = join(root, "link");
    symlinkSync(d, link);
    const before = fileDigests(d);
    expect(thrown(() => bind(link, m, "rox", join(root, "run"), stubDocker(root, ID).docker))).toMatch(/^E_OUTCOME_IMAGE .*link is a symlink/);
    expect(existsSync(join(root, "run"))).toBe(false);
    expect(fileDigests(d)).toEqual(before);
    expect(thrown(() => bind(link + "/", m, "rox", join(root, "run"), stubDocker(root, ID).docker))).toMatch(/^E_OUTCOME_IMAGE .*link\/ is a symlink/);
    expect(existsSync(join(root, "run"))).toBe(false);
    expect(fileDigests(d)).toEqual(before);
  });

  test.each([
    ["a parent dir that links into the task dir", (root: string, d: string) => (symlinkSync(d, join(root, "alias")), join(root, "alias", "run")), /lies inside the task dir/],
    ["a dangling symlink into the task dir", (root: string, d: string) => (symlinkSync(join(d, "copy"), join(root, "run")), join(root, "run")), /run exists; bind writes a new run copy/],
  ] as const)("bind refuses a run copy root at %s, before any write, and leaves the task untouched", (_what, place, why) => {
    const root = fresh();
    const d = task(root);
    const { m } = manifest(root, d);
    const before = fileDigests(d);
    const out = place(root, d);
    expect(thrown(() => bind(d, m, "rox", out, stubDocker(root, ID).docker))).toMatch(new RegExp("^E_OUTCOME_IMAGE .*" + why.source));
    expect(readdirSync(d).sort()).toEqual(["environment", "instruction.md", "task.json", "task.toml", "tests"]);
    expect(fileDigests(d)).toEqual(before);
  });

  test.each(["environment", "environment/Dockerfile", "task.toml"])("bind refuses a task whose %s is a symlink (cpSync keeps it a link in the copy) and never writes through it", (path) => {
    const root = fresh();
    const d = task(root);
    const { m } = manifest(root, d);
    const ext = join(root, "ext");
    rmSync(ext, { recursive: true, force: true });
    spawnSync("cp", ["-r", join(d, path), ext]);
    rmSync(join(d, path), { recursive: true });
    symlinkSync(ext, join(d, path));
    const before = path === "environment" ? fileDigests(ext) : sha(readFileSync(ext));
    expect(thrown(() => bind(d, m, "rox", join(root, "run"), stubDocker(root, ID).docker))).toMatch(new RegExp("^E_OUTCOME_IMAGE .*holds symlinks \\(" + path + "\\)"));
    expect(existsSync(join(root, "run"))).toBe(false);
    expect(path === "environment" ? fileDigests(ext) : sha(readFileSync(ext))).toEqual(before);
  });

  test("the run copy holds its own bytes: no symlinks, and an edit to the task dir after bind does not reach it", () => {
    const root = fresh();
    const d = task(root);
    const { m } = manifest(root, d);
    const out = join(root, "run");
    bind(d, m, "rox", out, stubDocker(root, ID).docker);
    expect(walk(out).links).toEqual([]);
    for (const f of walk(out).files) expect(lstatSync(join(out, f)).isFile()).toBe(true);
    writeFileSync(join(d, "instruction.md"), "Something else.\n");
    writeFileSync(join(d, "tests", "t.py"), "def test(): assert False\n");
    expect(readFileSync(join(out, "instruction.md"), "utf8")).toBe("Add it.\n");
    expect(readFileSync(join(out, "tests", "t.py"), "utf8")).toBe("def test(): pass\n");
  });

  test("images check prints a multiline refusal with every stderr line led by its reason code", () => {
    const root = fresh();
    const { path } = manifest(root, task(root));
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "bin", "gstack-evals"), "outcome", "images", "check", path, "--sha256", sha(readFileSync(path))], { env: { ...process.env, DOCKER: stubDocker(root, OTHER).docker }, stdout: "pipe", stderr: "pipe" });
    const err = p.stderr.toString().trim().split("\n");
    expect(p.exitCode).toBe(2);
    expect(err.length).toBeGreaterThan(3);
    expect(err.some((l) => l.includes("fix: point the none arm"))).toBe(true);
    for (const l of err) expect(l).toMatch(/^E_OUTCOME_CLEAN_ROOM /);
  });

  test("pin refuses an existing out file before any build, and leaves no manifest when its rows fail the manifest rules", async () => {
    const root = fresh();
    const out = join(root, "m.json");
    writeFileSync(out, "{}");
    const refused = (p: Promise<unknown>) => p.then(() => null, (e) => (e as Error).message);
    expect(await refused(pin([task(root)], out, "T-G", "c"))).toMatch(/^E_OUTCOME_IMAGE .*exists; pin writes a new manifest/);
    const none = join(root, "none.json");
    expect(await refused(pin([], none, "T-G", "c"))).toMatch(/^E_OUTCOME_IMAGE .*not a tg-images\.v1 manifest with rows/);
    expect(existsSync(none)).toBe(false);
  });

  test("images pin refuses a malformed task dir under the task's own reason code, every stderr line led by it", () => {
    const root = fresh();
    mkdirSync(join(root, "bad"));
    writeFileSync(join(root, "bad", "task.json"), "{}");
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "bin", "gstack-evals"), "outcome", "images", "pin", "--out", join(root, "m.json"), "--set", "T-G", "--commit", "c", join(root, "bad")], { stdout: "pipe", stderr: "pipe" });
    const err = p.stderr.toString().trim().split("\n");
    expect(p.exitCode).toBe(2);
    expect(err[0]).toContain("schema is not");
    for (const l of err) expect(l).toMatch(/^E_REAL_TASK_FORMAT /);
    expect(existsSync(join(root, "m.json"))).toBe(false);
  });

  test("check refuses a row whose image id is not the pinned one, and passes a present, clean image", () => {
    const root = fresh();
    const { m } = manifest(root, task(root));
    expect(thrown(() => check(m, stubDocker(root, OTHER).docker))).toMatch(/^E_OUTCOME_CLEAN_ROOM .*not the pinned digest/);
    const seen: number[] = [];
    expect(thrown(() => check(m, stubDocker(fresh(), ID, 0).docker, (_r, n) => seen.push(n)))).toBeNull();
    expect(seen).toEqual([1]);
    expect(thrown(() => check(m, stubDocker(fresh(), ID, 3).docker))).toMatch(/^E_OUTCOME_CLEAN_ROOM /);
  });

  test("real_agent runs a U4 session only in the manifest's image, checked before any sandbox or session opens (image_test.py)", () => {
    const r = spawnSync("python3", [join(import.meta.dir, "../real-outcome/image_test.py")], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 120_000 });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    if (r.status !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    expect(out.match(/^PASS /gm)?.length).toBe(8);
    expect(r.status).toBe(0);
  });
  test("check reads only the manifest the readiness post recorded: --sha256 is required, and a manifest with other bytes is refused", () => {
    const root = fresh();
    const { path } = manifest(root, task(root));
    const recorded = sha(readFileSync(path));
    expect(readManifest(path, recorded).rows.length).toBe(1);
    expect(thrown(() => readManifest(path, "0".repeat(64)))).toMatch(/^E_OUTCOME_IMAGE .*manifest\.json has sha256 [0-9a-f]{64}, not the recorded 0{64}$/);
    const cli = (...extra: string[]) => Bun.spawnSync(["bun", BIN, "outcome", "images", "check", path, ...extra], { env: { ...process.env, DOCKER: stubDocker(fresh(), ID, 0).docker }, stdout: "pipe", stderr: "pipe" });
    const none = cli();
    expect(none.exitCode).toBe(2);
    expect(none.stderr.toString()).toMatch(/^E_USAGE images check needs --sha256/);
    const other = cli("--sha256", "0".repeat(64));
    expect(other.exitCode).toBe(2);
    expect(other.stderr.toString()).toMatch(/^E_OUTCOME_IMAGE .*not the recorded 0{64}/);
    const ok = cli("--sha256", recorded);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toContain("TG_IMAGES: ok rows=1");
  });

  test("the environment digest counts each file's executable bit: bind refuses a mode changed after pin, and binds the mode pin saw", () => {
    const root = fresh();
    const d = task(root);
    const before = treeDigest(join(d, "environment"));
    chmodSync(join(d, "environment", "f"), 0o755);
    expect(treeDigest(join(d, "environment"))).not.toBe(before);
    const { m } = manifest(root, d);
    expect(bind(d, m, "rox", join(root, "run"), stubDocker(root, ID).docker).image_id).toBe(ID);
    chmodSync(join(d, "environment", "f"), 0o644);
    expect(thrown(() => bind(d, m, "rox", join(root, "run2"), stubDocker(fresh(), ID).docker))).toMatch(/^E_OUTCOME_IMAGE .*environment has digest .*not the manifest row's/);
    expect(existsSync(join(root, "run2"))).toBe(false);
  });

  test("two binds on one out: the second refuses with E_USAGE while the first holds out, and the first one's copy stands", async () => {
    const root = fresh();
    const d = task(root);
    const { path } = manifest(root, d);
    const slow = join(root, "slow-docker");
    writeFileSync(slow, "#!/bin/sh\ncase \"$1\" in\n  tag) sleep 3 ;;\n  image) echo " + ID + " ;;\nesac\n", { mode: 0o755 });
    const out = join(root, "run");
    const args = ["bun", BIN, "outcome", "images", "bind", path, "--task", d, "--label", "rox", "--out", out];
    const fast = () => ({ env: { ...process.env, DOCKER: stubDocker(fresh(), ID).docker }, stdout: "pipe" as const, stderr: "pipe" as const });
    const first = Bun.spawn(args, { env: { ...process.env, DOCKER: slow }, stdout: "pipe", stderr: "pipe" });
    for (let i = 0; i < 200 && !existsSync(join(out, "task.toml")); i++) await Bun.sleep(25);
    const second = Bun.spawnSync(args, fast());
    const err = second.stderr.toString().trim().split("\n");
    expect(second.exitCode).toBe(2);
    expect(err[0]).toMatch(/^E_USAGE .*run is held by another bind/);
    for (const l of err) expect(l).toMatch(/^E_USAGE /);
    expect(await first.exited).toBe(0);
    expect(readFileSync(join(out, "environment", "Dockerfile"), "utf8")).toBe("FROM " + tagFor(ID) + "\n");
    expect(existsSync(out + ".bind-lock")).toBe(false);
    const third = Bun.spawnSync(args, fast());
    expect(third.exitCode).toBe(2);
    expect(third.stderr.toString()).toMatch(/^E_OUTCOME_IMAGE .*run exists; bind writes a new run copy/);
  }, 60_000);

  /** A docker for pin: a task build answers BARE (after writing race, as another pin finishing first would), the runtime
   *  layer's build (its Dockerfile names laneb-claude) keeps its Dockerfile and answers LAYERED, image inspect answers BARE. */
  const pinDocker = (root: string, race = "") => {
    const dir = join(root, "pin-bin");
    mkdirSync(dir, { recursive: true });
    const log = join(root, "pin-docker.log");
    const lines = ["#!/bin/sh", "echo \"$*\" >> " + log, "if [ \"$1\" = build ]; then", "  for a; do ctx=\"$a\"; done",
      "  if grep -q laneb-claude \"$ctx/Dockerfile\" 2>/dev/null; then cp \"$ctx/Dockerfile\" " + join(root, "runtime.Dockerfile") + "; echo " + LAYERED + "; exit 0; fi",
      ...(race ? ["  printf 'another pin\\n' > " + race] : []), "  echo " + BARE + "; exit 0", "fi", "if [ \"$1\" = image ]; then echo " + BARE + "; fi"];
    writeFileSync(join(dir, "docker"), lines.join("\n") + "\n", { mode: 0o755 });
    return { path: dir + ":" + process.env.PATH, log };
  };
  const fixtureTask = (root: string) => {
    const calc = join(root, "calc");
    const dir = join(root, "k1");
    buildTask(calcSpecs(root, buildRepo(calc, calcCommits())).k1, calc, dir);
    return dir;
  };
  const pinCli = (out: string, dir: string, path: string) => Bun.spawnSync(["bun", BIN, "outcome", "images", "pin", "--out", out, "--set", "T-G", "--commit", "c", dir], { env: { ...process.env, PATH: path }, stdout: "pipe", stderr: "pipe" });

  test("pin lays quick/laneb's runtime layer on each task image and pins that final image's id (a stand-in docker)", () => {
    const root = fresh();
    const dir = fixtureTask(root);
    const d = pinDocker(root);
    const out = join(root, "m.json");
    const p = pinCli(out, dir, d.path);
    if (p.exitCode !== 0) console.log(p.stderr.toString());
    expect(p.exitCode).toBe(0);
    expect(readManifest(out).rows.map((r) => r.image_id)).toEqual([LAYERED]);
    const tag = readFileSync(d.log, "utf8").split("\n").find((l) => l.startsWith("build -q -t "))!.split(" ")[3];
    const runner = join(import.meta.dir, "..", "..", "quick", "laneb", "runner");
    expect(readFileSync(join(root, "runtime.Dockerfile"), "utf8")).toBe(readFileSync(join(runner, "runtime-stages.Dockerfile"), "utf8") + "\nFROM " + tag + "\n\n" + readFileSync(join(runner, "runtime-copy.Dockerfile"), "utf8"));
  }, 120_000);

  test("pin never replaces a manifest another pin wrote while it built: its write is an exclusive create", () => {
    const root = fresh();
    const dir = fixtureTask(root);
    const out = join(root, "m.json");
    const p = pinCli(out, dir, pinDocker(root, out).path);
    const err = p.stderr.toString().trim().split("\n");
    expect(p.exitCode).toBe(2);
    expect(err[0]).toMatch(/^E_OUTCOME_IMAGE .*m\.json exists; pin writes a new manifest/);
    expect(readFileSync(out, "utf8")).toBe("another pin\n");
  }, 120_000);

  test("the reason codes name every refusal the image path makes, and the header says pin runs on a keyless build host", () => {
    for (const s of ["sha256 is not the --sha256", "no manifest row for --label", "an out path inside the task dir", "a task.json that is not JSON", "a docker tag that failed", "executable bits", "runtime layer did not build"]) expect(CODES.E_OUTCOME_IMAGE.meaning).toContain(s);
    for (const s of ["image_id is not a sha256:<64 hex> id", "manifest_sha256", "no row for task_label", "pins another image than image_id", "docker inspect could not read", "runs another image than image_id"]) expect(CODES.E_REAL_SANDBOX_SETUP.meaning).toContain(s);
    const header = readFileSync(join(import.meta.dir, "..", "..", "lanes", "outcome-skills", "images", "manifest.ts"), "utf8").split("\nimport ")[0]!;
    expect(header).toContain("pin runs on a keyless build host");
    expect(header).not.toContain("on the envelope host");
  });
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("the T-G image manifest on real Docker (GSTACK_EVALS_DOCKER=1)", () => {
  const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 300_000 });
  const tags: string[] = [];
  afterAll(() => {
    if (tags.length) docker("rmi", "-f", ...tags);
  });
  const build = (root: string, name: string, extra = "") => {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "Dockerfile"), "FROM busybox:1.36\nRUN mkdir -p /testbed /root" + extra + "\n");
    const tag = "gstack-evals-images-test-" + name + ":" + process.pid;
    tags.push(tag);
    expect(docker("build", "-q", "-t", tag, join(root, name)).status).toBe(0);
    return docker("image", "inspect", "-f", "{{.Id}}", tag).stdout.trim();
  };

  test("check passes a clean image and refuses one with /root/.gstack; a bound run copy's tag runs exactly the pinned id", () => {
    const root = fresh();
    expect(docker("pull", "-q", "busybox:1.36").status).toBe(0);
    const clean = build(root, "clean");
    const seeded = build(root, "seeded", " /root/.gstack");
    const d = task(root);
    const { m } = manifest(root, d, clean);
    expect(thrown(() => check(m))).toBeNull();
    expect(thrown(() => check({ ...m, rows: [{ ...m.rows[0]!, image_id: seeded }] }))).toMatch(/^E_OUTCOME_CLEAN_ROOM .*found \/root\/.gstack/);
    const b = bind(d, m, "rox", join(root, "run"));
    tags.push(b.tag);
    const name = "gstack-evals-images-test-" + process.pid;
    expect(docker("create", "--name", name, b.tag, "true").status).toBe(0);
    const ran = docker("inspect", "-f", "{{.Image}}", name).stdout.trim();
    docker("rm", "-f", name);
    expect(ran).toBe(clean);
  }, 600_000);
});
