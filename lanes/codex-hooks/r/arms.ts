// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's arm tars (preregistration section 4.2): the build (arms/Dockerfile in docker buildx, gstack fetched at its pin by
// sha and repacked on one thread, as lanes/delivery-route/b1d-build.sh does, so its pack and the tars rebuild byte for byte),
// each tar's manifest (the tar's digest, the tree inventory's digest, gstack-config's switches, prove-it's digest and
// Codex's start capture, normalized and digested), and the check a run's tars must pass against the committed manifests in
// quick/laneb/arms/manifests/codex-hooks-r (prepare-run.ts refuses a tar whose sha256 is not its manifest's).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ONBOARDING_MARKERS } from "../../../src/trial/state-root.ts";
import { ARM_NAMES, ARMS, CODEX, GSTACK, HERE, PROVE_IT, proveItText, R, REPO, SEED_CONFIG, sha256, type RArm } from "./pins.ts";

export const MANIFESTS = join(REPO, "quick/laneb", R.armManifests);
export const TAR_COMMAND = "tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --format=gnu";
const run = (cmd: string[], opts: { cwd?: string; log?: string } = {}) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: opts.cwd, encoding: "utf8", maxBuffer: 1 << 30 });
  if (opts.log) writeFileSync(opts.log, (r.stdout ?? "") + (r.stderr ?? ""));
  if (r.status !== 0) throw new Error("E_CODEX_R_ARMS " + cmd.slice(0, 3).join(" ") + " exited " + r.status + ": " + String(r.stderr ?? "").slice(-600));
  return r.stdout ?? "";
};

/** Codex's start capture with what changes from run to run taken out: each item's id and create_time, and the date in its
 *  environment context. */
export function normalizePromptInput(text: string): string {
  const items = JSON.parse(text) as Record<string, unknown>[];
  if (!Array.isArray(items)) throw new Error("E_CODEX_R_ARMS a prompt-input capture is a JSON list");
  const strip = (v: unknown): unknown => (Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id" && k !== "create_time").map(([k, x]) => [k, strip(x)])) : typeof v === "string" ? v.replace(/<current_date>[^<]*<\/current_date>/g, "<current_date></current_date>") : v);
  return JSON.stringify(strip(items));
}

/** The skills list Codex puts in the model's first input, and prove-it's line in it when there is one. */
export function skillsListed(text: string): { skills: string[]; proveIt: string | null } {
  const items = JSON.parse(text) as { content?: { text?: string }[] }[];
  const block = items.flatMap((i) => i.content ?? []).map((c) => c.text ?? "").find((t) => t.includes("<skills_instructions>")) ?? "";
  const lines = block.split("\n").filter((l) => /^- [\w.-]+: /.test(l));
  return { skills: lines.map((l) => /^- ([\w.-]+):/.exec(l)![1]!), proveIt: lines.find((l) => l.startsWith("- prove-it: ")) ?? null };
}

export type ArmManifest = {
  arm: RArm; spec: string; codex: string; gstack: { sha: string; tag: string } | null; routing: string | null;
  switches: Record<string, string>; prove_it: { path: string; sha256: string } | null; tar_command: string;
  tar: { file: string; bytes: number; sha256: string }; tree: { files: number; symlinks: number; dirs: number; digest: string };
  prompt_input: { sha256: string; skills: number; prove_it_line: string | null }; build: { markers: string[]; seed: Record<string, string> };
};

/** One arm's manifest from the build's outputs in dir. */
export function armManifest(dir: string, arm: RArm): ArmManifest {
  const tar = join(dir, arm + ".tar"), inv = readFileSync(join(dir, arm + ".files.tsv"), "utf8"), pi = readFileSync(join(dir, arm + ".prompt-input.json"), "utf8");
  const rows = inv.split("\n").filter(Boolean).map((l) => l.split("\t"));
  const switches = Object.fromEntries(readFileSync(join(dir, arm + ".switches.tsv"), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t") as [string, string]));
  const prove = rows.find((r) => r[0] === "f" && r[1] === PROVE_IT.path);
  const listed = skillsListed(pi);
  const a = ARMS[arm];
  return {
    arm, spec: a.spec, codex: CODEX.version, gstack: a.gstack ? { sha: GSTACK.sha, tag: GSTACK.tag } : null, routing: a.routing, switches,
    prove_it: prove ? { path: PROVE_IT.path, sha256: prove[2]!.split(" ")[2]! } : null, tar_command: TAR_COMMAND,
    tar: { file: arm + ".tar", bytes: readFileSync(tar).length, sha256: sha256(readFileSync(tar)) },
    tree: { files: rows.filter((r) => r[0] === "f").length, symlinks: rows.filter((r) => r[0] === "l").length, dirs: rows.filter((r) => r[0] === "d").length, digest: sha256(inv) },
    prompt_input: { sha256: sha256(normalizePromptInput(pi)), skills: listed.skills.length, prove_it_line: listed.proveIt },
    build: { markers: [...ONBOARDING_MARKERS], seed: { ...SEED_CONFIG } },
  };
}

/** What each arm must hold (section 4.2): the gstack arms prove-it at its digest, listed in Codex's start capture, and the
 *  three switches as the arm sets them; r-none no gstack, no skill and no switch. */
export function armProblems(m: ArmManifest): string[] {
  const out: string[] = [];
  const a = ARMS[m.arm];
  if (a.gstack) {
    if (m.prove_it?.sha256 !== PROVE_IT.sha256) out.push(m.arm + ": prove-it is " + (m.prove_it?.sha256 ?? "missing") + ", not " + PROVE_IT.sha256);
    if (!m.prompt_input.prove_it_line) out.push(m.arm + ": Codex's start capture does not list prove-it");
    const want = { skill_routing: a.routing, skill_contracts: "on", destructive_guard: "on" };
    for (const [k, v] of Object.entries(want)) if (m.switches[k] !== v) out.push(m.arm + ": gstack-config reads " + k + " " + JSON.stringify(m.switches[k] ?? null) + ", not " + v);
  } else {
    if (m.prove_it || m.prompt_input.skills || Object.keys(m.switches).length || m.tree.files) out.push(m.arm + ": the no-gstack arm holds a file, a skill or a switch");
  }
  return out;
}

/** Build the three tars in docker and write each manifest beside them; with register, also into MANIFESTS. */
export function buildArms(outArg: string, o: { register?: boolean } = {}) {
  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });
  const src = join(out, "src-pin"), ctx = join(out, "ctx");
  rmSync(src, { recursive: true, force: true });
  rmSync(ctx, { recursive: true, force: true });
  run(["git", "init", "-q", src]);
  run(["git", "-C", src, "fetch", "-q", "--depth", "1", GSTACK.repo, GSTACK.sha]);
  run(["git", "-C", src, "checkout", "-q", "FETCH_HEAD"]);
  if (run(["git", "-C", src, "rev-parse", "HEAD"]).trim() !== GSTACK.sha) throw new Error("E_CODEX_R_ARMS gstack's checkout is not at " + GSTACK.sha);
  run(["git", "-C", src, "-c", "pack.threads=1", "repack", "-a", "-d", "-F", "-q"]);
  mkdirSync(ctx);
  copyFileSync(join(REPO, HERE, "arms/Dockerfile"), join(ctx, "Dockerfile"));
  writeFileSync(join(ctx, "prove-it.md"), proveItText());
  const seed = Object.entries(SEED_CONFIG).map(([k, v]) => k + "=" + v).join(" ");
  rmSync(join(out, "export"), { recursive: true, force: true });
  run(["docker", "buildx", "build", "--progress=plain", "--build-context", "gstack=" + src, "--build-arg", "GSTACK_MARKERS=" + ONBOARDING_MARKERS.join(" "), "--build-arg", "GSTACK_SEED=" + seed,
    "--target", "out", "--output", "type=local,dest=" + join(out, "export"), ctx], { log: join(out, "build.log") });
  const version = readFileSync(join(out, "export/codex-version.txt"), "utf8").trim();
  if (version !== "codex-cli " + CODEX.version) throw new Error("E_CODEX_R_ARMS the builder's Codex reports " + version);
  const manifests: ArmManifest[] = [];
  for (const arm of ARM_NAMES) {
    for (const ext of [".tar", ".files.tsv", ".switches.tsv", ".prompt-input.json"]) renameSync(join(out, "export", arm + ext), join(out, arm + ext));
    const m = armManifest(out, arm);
    const bad = armProblems(m);
    if (bad.length) throw new Error("E_CODEX_R_ARMS " + bad.join("; "));
    writeFileSync(join(out, arm + ".json"), JSON.stringify(m, null, 2) + "\n");
    if (o.register) {
      mkdirSync(MANIFESTS, { recursive: true });
      writeFileSync(join(MANIFESTS, arm + ".json"), JSON.stringify(m, null, 2) + "\n");
      writeFileSync(join(MANIFESTS, arm + ".files.tsv"), readFileSync(join(out, arm + ".files.tsv")));
    }
    manifests.push(m);
  }
  return manifests;
}

/** A run's tars against the committed manifests: each tar's sha256, and r-on and r-off differing only in gstack's config. */
export function checkArms(dir: string): string[] {
  const out: string[] = [];
  for (const arm of ARM_NAMES) {
    const mf = join(MANIFESTS, arm + ".json"), tar = join(dir, arm + ".tar");
    if (!existsSync(mf)) { out.push(arm + ": no committed manifest at " + mf); continue; }
    if (!existsSync(tar)) { out.push(arm + ": no tar at " + tar); continue; }
    const m = JSON.parse(readFileSync(mf, "utf8")) as ArmManifest;
    const got = sha256(readFileSync(tar));
    if (got !== m.tar.sha256) out.push(arm + ": tar sha256 " + got + " is not the manifest's " + m.tar.sha256);
    out.push(...armProblems(m));
  }
  const on = join(MANIFESTS, "r-on.files.tsv"), off = join(MANIFESTS, "r-off.files.tsv");
  if (existsSync(on) && existsSync(off)) {
    const a = readFileSync(on, "utf8").split("\n"), b = readFileSync(off, "utf8").split("\n");
    const diff = a.filter((l) => !b.includes(l)).concat(b.filter((l) => !a.includes(l))).map((l) => l.split("\t")[1]);
    if (a.length !== b.length || [...new Set(diff)].join() !== ".gstack/config.yaml") out.push("r-on and r-off differ in " + [...new Set(diff)].join(", ") + ", not only .gstack/config.yaml");
  }
  return out;
}
