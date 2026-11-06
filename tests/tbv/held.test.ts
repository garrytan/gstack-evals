// Copyright (c) 2026 Garry Tan. MIT License.
// Confined held-out steps (held-step, held-unseal): every planted write outside the work dir fails inside the container
// and never reaches the host, the seal phase refuses what it cannot walk and never overwrites, and a held-out-derived
// input on a synced drive is a burned-task event. The containers are real (docker); the seal command is a stub.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { heldStep, heldUnseal, place, sealOne } from "../../lanes/tbv/held.ts";
import { TbvError } from "../../lanes/tbv/errors.ts";
import { historySha256 } from "../../lanes/tbv/history/events.ts";
import { history } from "./drive-fixture.ts";
import { pr } from "./history-helpers.ts";

const REPO = resolve(import.meta.dir, "../..");
const SEAL = "printf 'STUB-SEALED\\n'; base64 -w0";
const UNSEAL = "tail -n +2 | base64 -d";
const open = (p: string) => Buffer.from(readFileSync(p, "utf8").split("\n")[1] ?? "", "base64").toString("utf8");
const DOCKER = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"]).status === 0;
if (!DOCKER && process.env.CI) throw new Error("tests/tbv/held.test.ts needs docker in CI; the held-out steps it covers never run unconfined");
const T = 60_000;

const made: string[] = [];
const shm = () => { const d = mkdtempSync("/dev/shm/tbv-held-test-"); made.push(d); return d; };
const disk = () => { const d = mkdtempSync(join(tmpdir(), "tbv-held-test-")); made.push(d); return d; };
afterAll(() => {
  for (const d of made) { spawnSync("chmod", ["-R", "u+rwx", d]); rmSync(d, { recursive: true, force: true }); }
});
const code = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof TbvError ? e.code + " " + e.message : "thrown " + String(e); }
  return "no error";
};
const io = () => { const out: string[] = []; return { out, io: { out: (t: string) => out.push(t), err: (t: string) => out.push(t) } }; };
const sealedNames = (dir: string): string[] => existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter((n) => n.endsWith(".sealed")).sort() : [];
const mountsText = readFileSync("/proc/mounts", "utf8");
const hostMounts = mountsText.trim().split("\n").map((l) => l.split(" ")).map((f) => ({ at: f[1]!.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))), type: f[2]! }));
const driveMount = hostMounts.find((m) => /^fuse\.capydrive$/.test(m.type));

describe("placement (no container)", () => {
  const FAKE = "/dev/root / ext4 rw 0 0\ntmpfs /dev/shm tmpfs rw 0 0\ncapydrive /fake/drive fuse.capydrive rw 0 0\n";
  test("a path under a broken mount refuses instead of placing it", () => {
    const broken = { lstat: (p: string) => { if (p.startsWith("/fake/drive")) throw Object.assign(new Error("transport endpoint is not connected"), { code: "ENOTCONN" }); }, realpath: (p: string) => p };
    expect(code(() => place("/fake/drive/scope/histories/h.json", FAKE, broken))).toMatch(/^E_TBV_CUSTODY .*ENOTCONN/);
    const badReal = { lstat: () => {}, realpath: () => { throw Object.assign(new Error("broken"), { code: "ENOTCONN" }); } };
    expect(code(() => place("/fake/drive/x", FAKE, badReal))).toMatch(/^E_TBV_CUSTODY .*ENOTCONN/);
    const ok = { lstat: () => {}, realpath: (p: string) => p };
    expect(place("/fake/drive/x", FAKE, ok)).toMatchObject({ type: "fuse.capydrive", at: "/fake/drive", exists: true });
  });

  test("an unreadable directory above an input refuses before any container", () => {
    if (process.getuid?.() === 0) return;
    const d = shm();
    mkdirSync(join(d, "locked"));
    writeFileSync(join(d, "locked", "h.json"), "{}");
    chmodSync(join(d, "locked"), 0o000);
    expect(code(() => place(join(d, "locked", "h.json"), mountsText))).toMatch(/^E_TBV_CUSTODY .*EACCES/);
    chmodSync(join(d, "locked"), 0o700);
  });

  test("drive hit: a held-out-derived input on a synced fuse mount is a burned-task event; nothing runs and nothing is deleted", () => {
    const d = shm();
    const input = join(d, "histories");
    mkdirSync(input);
    writeFileSync(join(input, "h.json"), "{}");
    const mounts = mountsText + "capydrive " + d + " fuse.capydrive rw 0 0\n";
    const work = join(shm(), "w");
    const r = code(() => heldStep({ work, held: join(disk(), "sealed"), sealCmd: SEAL, inputs: [input], ro: [], cmd: ["true"], mounts, docker: "/nonexistent/docker" }));
    expect(r).toMatch(/^E_TBV_BURNED /);
    expect(r).toContain("CUSTODY.md");
    expect(r).toContain("Captain");
    expect(existsSync(join(input, "h.json"))).toBe(true);
    expect(existsSync(work)).toBe(false);
  });

  test.skipIf(!driveMount)("drive hit on this machine's real Captain drive", () => {
    const file = join(driveMount!.at, "captain-gstack-evals", "CREW.md");
    if (!existsSync(file)) return;
    const work = join(shm(), "w");
    expect(code(() => heldStep({ work, held: join(disk(), "sealed"), sealCmd: SEAL, inputs: [file], ro: [], cmd: ["true"], docker: "/nonexistent/docker" }))).toMatch(/^E_TBV_BURNED /);
    expect(existsSync(file)).toBe(true);
  });

  test("refusals before any container: leftover work dir, work not on tmpfs, held on tmpfs or a drive, input off tmpfs, missing input, no docker", () => {
    const base = () => ({ work: join(shm(), "w"), held: join(disk(), "sealed"), sealCmd: SEAL, inputs: [] as string[], ro: [] as string[], cmd: ["true"] });
    const left = base();
    mkdirSync(left.work);
    writeFileSync(join(left.work, "plain.json"), "x");
    expect(code(() => heldStep(left))).toMatch(/^E_TBV_CUSTODY .*leftover/);
    expect(readFileSync(join(left.work, "plain.json"), "utf8")).toBe("x");
    expect(code(() => heldStep({ ...base(), work: join(disk(), "w") }))).toMatch(/^E_TBV_CUSTODY .*tmpfs/);
    expect(code(() => heldStep({ ...base(), held: join(shm(), "sealed") }))).toMatch(/^E_TBV_CUSTODY .*--held/);
    const dd = disk();
    expect(code(() => heldStep({ ...base(), held: join(dd, "sealed"), mounts: mountsText + "capydrive " + dd + " fuse.capydrive rw 0 0\n" }))).toMatch(/^E_TBV_CUSTODY .*--held/);
    const onDisk = disk();
    expect(code(() => heldStep({ ...base(), inputs: [onDisk] }))).toMatch(/^E_TBV_CUSTODY .*--input/);
    expect(code(() => heldStep({ ...base(), inputs: [join(shm(), "missing")] }))).toMatch(/^E_TBV_CUSTODY .*--input/);
    const nod = base();
    expect(code(() => heldStep({ ...nod, docker: "/nonexistent/docker" }))).toMatch(/^E_TBV_CUSTODY .*docker/);
    expect(existsSync(nod.work)).toBe(false);
  });

  test("sealOne never overwrites: an existing target keeps its bytes and no .tmp is left", () => {
    const d = disk();
    writeFileSync(join(d, "in.json"), "plain");
    writeFileSync(join(d, "out.sealed"), "ORIGINAL");
    expect(code(() => sealOne(join(d, "in.json"), join(d, "out.sealed"), SEAL))).toMatch(/^E_TBV_CUSTODY /);
    expect(readFileSync(join(d, "out.sealed"), "utf8")).toBe("ORIGINAL");
    expect(existsSync(join(d, "out.sealed.tmp"))).toBe(false);
    sealOne(join(d, "in.json"), join(d, "new.sealed"), SEAL);
    expect(open(join(d, "new.sealed"))).toBe("plain");
    expect(readdirSync(d).sort()).toEqual(["in.json", "new.sealed", "out.sealed"]);
  });
});

describe.skipIf(!DOCKER)("confined steps (docker)", () => {
  test("extract runs confined: its output file and its stdout are sealed, and the command line prints no plaintext", () => {
    const inDir = shm();
    const h = history("task-held-1");
    writeFileSync(join(inDir, "h.json"), JSON.stringify({ ...h, sha256: historySha256(h.events) }));
    const work = join(shm(), "w"), held = join(disk(), "sealed");
    const o = io();
    const rc = heldStep({ work, held, sealCmd: SEAL, inputs: [inDir], ro: [], cmd: ["sh", "-c", 'mkdir -p "$0/extracts" && ' + REPO + '/bin/gstack-evals tbv extract --history "$1" --out "$0/extracts/h.json"', work, join(inDir, "h.json")], io: o.io });
    expect(rc).toBe(0);
    expect(sealedNames(held)).toEqual([".held-step/stderr.sealed", ".held-step/stdout.sealed", "extracts/h.json.sealed"]);
    expect(JSON.parse(open(join(held, "extracts/h.json.sealed"))).task).toBe("task-held-1");
    expect(JSON.parse(open(join(held, ".held-step/stdout.sealed"))).task).toBe("task-held-1");
    expect(readFileSync(join(work, "extracts/h.json"), "utf8")).toContain("task-held-1");
    expect(o.out.join("\n")).not.toContain("task-held-1");
    expect(o.out.join("\n")).toContain("sealed 3");
  }, T);

  test("assemble-b runs confined from read-only records, and git reads the checkout inside (assemble-a dates its runner with it)", () => {
    const raw = disk();
    writeFileSync(join(raw, "prs.json"), JSON.stringify({ schema: "tbv-prs.v1", prs: [pr(), pr({ number: 13, closingIssues: [] })] }));
    const work = join(shm(), "w"), held = join(disk(), "sealed");
    expect(heldStep({ work, held, sealCmd: SEAL, inputs: [], ro: [raw], cmd: [REPO + "/bin/gstack-evals", "tbv", "assemble-b", "--records", join(raw, "prs.json"), "--out-dir", work], io: io().io })).toBe(0);
    const histories = sealedNames(held).filter((n) => !n.startsWith(".held-step/"));
    expect(histories.length).toBeGreaterThan(0);
    expect(JSON.parse(open(join(held, histories[0]!))).schema).toBe("tbv-history.v1");
    const w2 = join(shm(), "w"), h2 = join(disk(), "sealed");
    expect(heldStep({ work: w2, held: h2, sealCmd: SEAL, inputs: [], ro: [], cmd: ["git", "-C", REPO, "log", "-1", "--format=%H"], io: io().io })).toBe(0);
    expect(open(join(h2, ".held-step/stdout.sealed")).trim()).toMatch(/^[0-9a-f]{40}$/);
  }, T);

  test("planted writes to every mount type fail inside the container and never reach the host", () => {
    const w0 = shm(), held = join(disk(), "sealed"), work = join(w0, "w");
    mkdirSync(held, { mode: 0o700 });
    const tag = ".tbv-plant-" + process.pid + "-" + Date.now();
    const targets: { type: string; path: string }[] = [
      { type: "disk (tmpdir)", path: join(disk(), tag) },
      { type: "disk (checkout)", path: join(REPO, tag) },
      { type: "disk (home)", path: join(homedir(), tag) },
      { type: "tmpfs (/dev/shm outside work)", path: join(shm(), tag) },
      { type: "tmpfs (/dev/shm root)", path: join("/dev/shm", tag) },
      { type: "disk (--held during the command)", path: join(held, tag) },
      { type: "host /tmp", path: join("/tmp", tag) },
    ];
    if (driveMount) {
      const cap = join(driveMount.at, "captain-gstack-evals");
      targets.push({ type: "fuse.capydrive (Captain drive)", path: join(existsSync(cap) ? cap : driveMount.at, tag) });
    }
    const seen = new Set(targets.map((t) => t.type.split(" ")[0]));
    for (const m of hostMounts) {
      if (seen.has(m.type) || m.at.startsWith("/proc") || m.at.startsWith("/sys") || m.at === w0) continue;
      seen.add(m.type);
      targets.push({ type: m.type + " (" + m.at + ")", path: join(m.at, tag) });
    }
    const script = 'for t in "$@"; do if (echo planted > "$t") 2>/dev/null; then echo "WROTE $t"; else echo "REFUSED $t"; fi; done > "$0/results"';
    const rc = heldStep({ work, held, sealCmd: SEAL, inputs: [], ro: [], cmd: ["sh", "-c", script, work, ...targets.map((t) => t.path)], io: io().io });
    expect(rc).toBe(0);
    const results = readFileSync(join(work, "results"), "utf8").trim().split("\n");
    expect(results.length).toBe(targets.length);
    for (const t of targets) {
      expect(results).toContain("REFUSED " + t.path);
      const leaked = existsSync(t.path);
      if (leaked) rmSync(t.path, { force: true });
      expect({ type: t.type, leaked }).toEqual({ type: t.type, leaked: false });
    }
    console.log("planted-write mount types: " + targets.map((t) => t.type).join("; "));
  }, T);

  test("cp -p: an mtime-preserving copy into work is sealed; the same copy anywhere else fails", () => {
    const inDir = shm();
    writeFileSync(join(inDir, "h.json"), "held-out text");
    utimesSync(join(inDir, "h.json"), new Date("2001-01-01"), new Date("2001-01-01"));
    const other = shm(), home = join(homedir(), ".tbv-cp-" + process.pid);
    const work = join(shm(), "w"), held = join(disk(), "sealed");
    const rc = heldStep({ work, held, sealCmd: SEAL, inputs: [inDir], ro: [], cmd: ["sh", "-c", 'cp -p "$1" "$0/copy.json"; cp -p "$1" "$2/copy.json" 2>/dev/null; cp -p "$1" "$3" 2>/dev/null; true', work, join(inDir, "h.json"), other, home], io: io().io });
    expect(rc).toBe(0);
    expect(open(join(held, "copy.json.sealed"))).toBe("held-out text");
    expect(existsSync(join(other, "copy.json"))).toBe(false);
    const leaked = existsSync(home);
    if (leaked) rmSync(home, { force: true });
    expect(leaked).toBe(false);
  }, T);

  test("an unreadable directory the command leaves in work refuses the seal, and nothing is sealed", () => {
    const work = join(shm(), "w"), held = join(disk(), "sealed");
    const r = code(() => heldStep({ work, held, sealCmd: SEAL, inputs: [], ro: [], cmd: ["sh", "-c", 'echo a > "$0/a.json" && mkdir "$0/locked" && echo b > "$0/locked/b.json" && chmod 000 "$0/locked"', work], io: io().io }));
    expect(r).toMatch(/^E_TBV_CUSTODY .*locked/);
    expect(sealedNames(held)).toEqual([]);
  }, T);

  test("a symlink the command leaves in work refuses the seal", () => {
    const work = join(shm(), "w"), held = join(disk(), "sealed");
    const r = code(() => heldStep({ work, held, sealCmd: SEAL, inputs: [], ro: [], cmd: ["sh", "-c", 'ln -s .. "$0/escape"', work], io: io().io }));
    expect(r).toMatch(/^E_TBV_CUSTODY .*escape/);
    expect(sealedNames(held)).toEqual([]);
  }, T);

  test("seal is atomic: an existing target or .tmp refuses with nothing written; a seal failure leaves no .tmp and no target for that file", () => {
    const h1 = join(disk(), "sealed");
    mkdirSync(h1);
    writeFileSync(join(h1, "a.json.sealed"), "ORIGINAL");
    const w1 = join(shm(), "w");
    expect(code(() => heldStep({ work: w1, held: h1, sealCmd: SEAL, inputs: [], ro: [], cmd: ["sh", "-c", 'echo a > "$0/a.json"', w1], io: io().io }))).toMatch(/^E_TBV_CUSTODY .*already/);
    expect(readFileSync(join(h1, "a.json.sealed"), "utf8")).toBe("ORIGINAL");
    expect(sealedNames(h1)).toEqual(["a.json.sealed"]);
    const h2 = join(disk(), "sealed");
    mkdirSync(h2);
    writeFileSync(join(h2, "a.json.sealed.tmp"), "half");
    const w2 = join(shm(), "w");
    expect(code(() => heldStep({ work: w2, held: h2, sealCmd: SEAL, inputs: [], ro: [], cmd: ["sh", "-c", 'echo a > "$0/a.json"', w2], io: io().io }))).toMatch(/^E_TBV_CUSTODY .*already/);
    expect(sealedNames(h2)).toEqual([]);
    const h3 = join(disk(), "sealed"), w3 = join(shm(), "w");
    const failing = 'x=$(cat); case "$x" in *FAIL*) exit 7;; esac; printf "STUB-SEALED\\n%s" "$(printf %s "$x" | base64 -w0)"';
    expect(code(() => heldStep({ work: w3, held: h3, sealCmd: failing, inputs: [], ro: [], cmd: ["sh", "-c", 'echo a > "$0/a.json"; echo FAIL > "$0/b.json"', w3], io: io().io }))).toMatch(/^E_TBV_CUSTODY .*seal command/);
    expect(existsSync(join(h3, "b.json.sealed"))).toBe(false);
    expect(existsSync(join(h3, "b.json.sealed.tmp"))).toBe(false);
    expect(existsSync(join(h3, "a.json.sealed"))).toBe(true);
  }, T);

  test("a command that fails is reported, and nothing is sealed", () => {
    const work = join(shm(), "w"), held = join(disk(), "sealed");
    expect(code(() => heldStep({ work, held, sealCmd: SEAL, inputs: [], ro: [], cmd: ["sh", "-c", 'echo a > "$0/a.json"; exit 3', work], io: io().io }))).toMatch(/^E_TBV_STEP .*exited 3/);
    expect(sealedNames(held)).toEqual([]);
  }, T);

  test("refusal twin: an extra writable mount fails the probe, and the command never runs", () => {
    const extra = disk(), work = join(shm(), "w"), held = join(disk(), "sealed");
    const r = code(() => heldStep({ work, held, sealCmd: SEAL, inputs: [], ro: [], cmd: ["sh", "-c", 'touch "$0/ran"', work], io: io().io, extraBinds: [extra] }));
    expect(r).toMatch(/^E_TBV_CUSTODY .*probe/);
    expect(r).toContain(extra);
    expect(existsSync(join(work, "ran"))).toBe(false);
    expect(readdirSync(extra)).toEqual([]);
  }, T);

  test("held-unseal copies only the named records, confined, and refuses clashes, misses and a failing unseal", () => {
    const s1 = disk(), s2 = disk();
    for (const [d, n, t] of [[s1, "reading-a.json", "A"], [s1, "start-a.json", "S"], [s2, "reading-b.json", "B"]] as const) writeFileSync(join(d, n + ".sealed"), "STUB-SEALED\n" + Buffer.from(t).toString("base64"));
    const work = join(shm(), "w");
    expect(heldUnseal({ work, froms: [s1, s2], prefix: "reading-", unsealCmd: UNSEAL, ro: [], io: io().io })).toBe(0);
    expect(readdirSync(work).sort()).toEqual(["reading-a.json", "reading-b.json"]);
    expect(readFileSync(join(work, "reading-b.json"), "utf8")).toBe("B");
    writeFileSync(join(s2, "reading-a.json.sealed"), "STUB-SEALED\n" + Buffer.from("A2").toString("base64"));
    expect(code(() => heldUnseal({ work: join(shm(), "w"), froms: [s1, s2], prefix: "reading-", unsealCmd: UNSEAL, ro: [], io: io().io }))).toMatch(/^E_TBV_CUSTODY .*reading-a\.json/);
    expect(code(() => heldUnseal({ work: join(shm(), "w"), froms: [s1], prefix: "packet-", unsealCmd: UNSEAL, ro: [], io: io().io }))).toMatch(/^E_TBV_CUSTODY .*packet-/);
    expect(code(() => heldUnseal({ work: join(shm(), "w"), froms: [s1], prefix: "reading-", unsealCmd: "exit 9", ro: [], io: io().io }))).toMatch(/^E_TBV_CUSTODY .*unseal command/);
    expect(code(() => heldUnseal({ work, froms: [s1], prefix: "reading-", unsealCmd: UNSEAL, ro: [], io: io().io }))).toMatch(/^E_TBV_CUSTODY .*leftover/);
  }, T);
});
