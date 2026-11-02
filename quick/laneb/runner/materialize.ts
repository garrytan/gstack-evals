// Turns Harbor task directories into Lane B task directories. Two sources:
// SWE-bench Verified (below) and Terminal-Bench 2.0 (materializeTb2). For SWE-bench Verified:
//  - the agent image is the task's own image plus an arm-neutral runtime layer (Claude Code, Node, Bun);
//  - grading moves to a separate verifier built from the pristine task image, which applies the agent's
//    patch from /logs/artifacts/model.patch and then runs the task's own test.sh unchanged;
//  - the agent phase gets the egress allowlist (only the metering proxy) and setup gets no network.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

export const APPLY_BLOCK = `# laneb: separate verifier. Apply the agent's patch from the artifact, staging new files
# so the task's own \`git clean -fd\` keeps them, then run the task's grader unchanged.
mkdir -p /logs/verifier
cd /testbed
if [ -s /logs/artifacts/model.patch ]; then
  git update-index -q --refresh >/dev/null 2>&1 || true
  if ! git apply --index --whitespace=nowarn /logs/artifacts/model.patch; then
    echo "laneb: model.patch did not apply"
    echo 0 > /logs/verifier/reward.txt
    exit 0
  fi
fi
`;

export function treeDigest(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  const h = createHash("sha256");
  for (const f of files.sort()) {
    const rel = relative(dir, f);
    h.update(rel + "\0" + createHash("sha256").update(readFileSync(f)).digest("hex") + "\n");
  }
  return h.digest("hex");
}

export function baseImage(dockerfile: string): string {
  const m = /^FROM\s+(\S+)/m.exec(dockerfile);
  if (!m) throw new Error("no FROM line");
  return m[1];
}

export function taskToml(agentTimeoutSec: number, verifierTimeoutSec: number, network: "allowlist" | "public", original: string): string {
  const meta = /\[metadata\]([\s\S]*?)(?=\n\[|$)/.exec(original)?.[1]?.trim() ?? "";
  return [
    'schema_version = "1.4"',
    "",
    "[metadata]",
    meta,
    'laneb_source = "harbor-datasets swebench-verified, converted to a separate verifier"',
    "",
    "[verifier]",
    `timeout_sec = ${verifierTimeoutSec.toFixed(1)}`,
    'environment_mode = "separate"',
    'network_mode = "public"',
    "",
    "[agent]",
    `timeout_sec = ${agentTimeoutSec.toFixed(1)}`,
    `network_mode = "${network}"`,
    "",
    "[environment]",
    `network_mode = "${network === "allowlist" ? "no-network" : "public"}"`,
    "build_timeout_sec = 1800.0",
    "cpus = 1",
    "memory = '4G'",
    "storage = '10G'",
    "",
  ].join("\n");
}

export function materialize(src: string, dest: string, opts: { runtimeStages: string; runtimeCopy: string; agentTimeoutSec: number; verifierTimeoutSec: number; network: "allowlist" | "public" }) {
  if (existsSync(dest)) rmSync(dest, { recursive: true });
  mkdirSync(join(dest, "environment"), { recursive: true });
  mkdirSync(join(dest, "tests"), { recursive: true });
  cpSync(join(src, "instruction.md"), join(dest, "instruction.md"));
  if (existsSync(join(src, "solution"))) {
    cpSync(join(src, "solution"), join(dest, "solution"), { recursive: true });
    const solve = join(dest, "solution", "solve.sh");
    writeFileSync(solve, readFileSync(solve, "utf8").trimEnd() + "\n\n# laneb: publish the oracle's change the way the agent does, for the separate verifier.\nmkdir -p /logs/artifacts && cd /testbed && git add -A && git diff --cached --binary HEAD > /logs/artifacts/model.patch\n", { mode: 0o755 });
  }
  const envDocker = readFileSync(join(src, "environment", "Dockerfile"), "utf8");
  const image = baseImage(envDocker);
  writeFileSync(join(dest, "environment", "Dockerfile"), opts.runtimeStages + "\n" + envDocker.trimEnd() + "\n\n" + opts.runtimeCopy);
  const testSh = readFileSync(join(src, "tests", "test.sh"), "utf8");
  const body = testSh.replace(/^#!.*\n/, "");
  writeFileSync(join(dest, "tests", "test.sh"), "#!/bin/bash\n" + APPLY_BLOCK + body, { mode: 0o755 });
  cpSync(join(src, "tests", "config.json"), join(dest, "tests", "config.json"));
  writeFileSync(
    join(dest, "tests", "Dockerfile"),
    [`FROM ${image}`, "WORKDIR /testbed", "RUN curl -LsSf https://astral.sh/uv/0.7.13/install.sh | sh", "RUN mkdir -p /logs /tests", "COPY test.sh config.json /tests/", "RUN chmod +x /tests/test.sh", ""].join("\n"),
  );
  writeFileSync(join(dest, "task.toml"), taskToml(opts.agentTimeoutSec, opts.verifierTimeoutSec, opts.network, readFileSync(join(src, "task.toml"), "utf8")));
  return { image, sourceDigest: treeDigest(src), digest: treeDigest(dest) };
}

// Terminal-Bench 2.0 tasks keep their shared verifier (test.sh inspects the container the agent
// leaves behind). The agent image becomes the task's published image plus the runtime layer, so it
// is built rather than pulled. Network per phase: allowlist for the agent (the metering proxy, which
// Harbor adds on its own, plus the OS and Python package registries the reference solutions use),
// public for the verifier (test.sh downloads uv and pytest).
export const TB2_AGENT_HOSTS = [
  "deb.debian.org",
  "security.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  "pypi.org",
  "files.pythonhosted.org",
  "download.pytorch.org",
  "download-r2.pytorch.org",
  "dl-cdn.alpinelinux.org",
];

export function tb2TaskToml(original: string, network: "allowlist" | "public"): string {
  const sections: { name: string; lines: string[] }[] = [{ name: "", lines: [] }];
  for (const line of original.split("\n")) {
    const m = /^\[([^\]]+)\]\s*$/.exec(line.trim());
    if (m) sections.push({ name: m[1], lines: [] });
    else sections.at(-1)!.lines.push(line);
  }
  const get = (name: string) => {
    let s = sections.find((x) => x.name === name);
    if (!s) sections.push((s = { name, lines: [] }));
    return s;
  };
  const env = get("environment");
  env.lines = env.lines.filter((l) => !/^\s*(docker_image|network_mode)\s*=/.test(l));
  env.lines.push('network_mode = "public"');
  const agent = get("agent");
  agent.lines = agent.lines.filter((l) => !/^\s*(network_mode|allowed_hosts)\s*=/.test(l));
  agent.lines.push(`network_mode = "${network}"`);
  if (network === "allowlist") agent.lines.push(`allowed_hosts = [${TB2_AGENT_HOSTS.map((h) => `"${h}"`).join(", ")}]`);
  const verifier = get("verifier");
  verifier.lines = verifier.lines.filter((l) => !/^\s*network_mode\s*=/.test(l));
  verifier.lines.push('network_mode = "public"');
  const out: string[] = [];
  for (const s of sections) {
    if (s.name) out.push(`[${s.name}]`);
    out.push(...s.lines.filter((l) => l.trim() !== ""), "");
  }
  return out.join("\n").trimEnd() + "\n";
}

export function materializeTb2(src: string, dest: string, opts: { runtimeStages: string; runtimeCopy: string; network: "allowlist" | "public" }) {
  if (existsSync(dest)) rmSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  const original = readFileSync(join(src, "task.toml"), "utf8");
  const image = /^\s*docker_image\s*=\s*"([^"]+)"/m.exec(original)?.[1];
  if (!image) throw new Error(`${src}: no docker_image in task.toml`);
  rmSync(join(dest, "environment"), { recursive: true });
  mkdirSync(join(dest, "environment"));
  writeFileSync(join(dest, "environment", "Dockerfile"), `${opts.runtimeStages}\nFROM ${image}\n\n${opts.runtimeCopy}`);
  writeFileSync(join(dest, "task.toml"), tb2TaskToml(original, opts.network));
  return { image, sourceDigest: treeDigest(src), digest: treeDigest(dest) };
}

// R3's SWE-bench Verified tasks (GEVA-101 prereg, section 4.8): the id list must hash to the prereg's sha256, the digest
// file must list exactly those ids, and each task directory must match its digest before it is materialized. Agent and
// verifier timeouts stay the dataset's own (task.toml [agent] and [verifier] timeout_sec).
export const R3_BAND_SHA256 = "5d555f1ff7eb6d7f3b5fb760ad46992ab5fb49d975f4cbd4585a0cfa637fdc67";

export type SwebvTask = { task_id: string; registry: { git_url: string; git_commit_id: string; path: string }; digest: string; digest_files: number };

export function loadSwebvTasks(listPath: string, digestsPath: string, wantSha256: string): SwebvTask[] {
  const raw = readFileSync(listPath);
  const got = createHash("sha256").update(raw).digest("hex");
  if (got !== wantSha256) throw new Error(`${listPath}: sha256 ${got} is not the preregistered ${wantSha256}`);
  const doc = JSON.parse(readFileSync(digestsPath, "utf8")) as { band_sha256: string; tasks: SwebvTask[] };
  if (doc.band_sha256 !== wantSha256) throw new Error(`${digestsPath}: band_sha256 ${doc.band_sha256} is not ${wantSha256}`);
  const ids = raw.toString("utf8").split("\n").filter(Boolean);
  const listed = doc.tasks.map((t) => t.task_id);
  if (listed.join("\n") !== ids.join("\n")) throw new Error(`${digestsPath}: its tasks are not the ids in ${listPath}, in order`);
  return doc.tasks;
}

// R3's drop list (Captain ruling on GEVA-177's finding, GST-941): GEVA-177's r3-drop-list.json, committed byte for byte
// as R3 amendment 3's drop-list.py.txt writes it. Its dropped tasks leave the screen's run, its oracle job and its
// coverage; each carries its reason and both oracle passes' evidence with their digests. The file must hash to
// R3_DROP_SHA256, name R3's band, list band tasks that failed both passes, once each, match its own id digests, and drop
// no task in the pilot draw. The band file, its sha256 and the pilot draw stay.
export const R3_DROP_FILE = "tasks/swebv-r3-drop.json";
export const R3_DROP_SHA256 = "e341afbeea0af5b64e7fcda19b76b5c36224eb6946d25b0acd278a32b942dcfc";

export type R3Drop = { task_id: string; reason: string };

export function loadR3Drops(path: string, wantSha256: string, band: string[]): R3Drop[] {
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const raw = readFileSync(path);
  if (sha(raw) !== wantSha256) throw new Error(`${path}: sha256 ${sha(raw)} is not the pinned ${wantSha256}`);
  const doc = JSON.parse(raw.toString("utf8")) as {
    band_file_sha256: string;
    band_size: number;
    dropped: { task: string; reason: string; pass1?: { result?: string }; pass2?: { result?: string } }[];
    dropped_ids_sha256: string;
    kept_size: number;
    kept_ids_sha256: string;
    pilot_tasks: string[];
    pilot_dropped: string[];
  };
  if (doc.band_file_sha256 !== R3_BAND_SHA256 || doc.band_size !== band.length) throw new Error(`${path}: band_file_sha256 ${doc.band_file_sha256} with band_size ${doc.band_size} is not R3's band (${R3_BAND_SHA256}, ${band.length} tasks)`);
  const seen = new Set<string>();
  for (const d of doc.dropped) {
    if (!band.includes(d.task)) throw new Error(`${path}: ${d.task} is not a band task`);
    if (seen.has(d.task)) throw new Error(`${path}: ${d.task} is listed twice`);
    if (typeof d.reason !== "string" || !d.reason.trim()) throw new Error(`${path}: ${d.task} has no reason`);
    if (d.pass1?.result !== "fail" || d.pass2?.result !== "fail") throw new Error(`${path}: ${d.task} did not fail both oracle passes`);
    seen.add(d.task);
  }
  const listing = (ids: string[]) => sha([...ids].sort().map((i) => i + "\n").join(""));
  const kept = band.filter((id) => !seen.has(id));
  if (doc.dropped_ids_sha256 !== listing([...seen]) || doc.kept_size !== kept.length || doc.kept_ids_sha256 !== listing(kept)) throw new Error(`${path}: dropped_ids_sha256, kept_size or kept_ids_sha256 does not match its dropped tasks`);
  const inPilot = [...new Set([...doc.pilot_tasks.filter((id) => seen.has(id)), ...doc.pilot_dropped])];
  if (inPilot.length) throw new Error(`${path}: drops tasks in the pilot draw: ${inPilot.join(", ")}`);
  return doc.dropped.map((d) => ({ task_id: d.task, reason: d.reason }));
}

function tomlNumber(text: string, section: string, key: string): number | null {
  const body = new RegExp(`^\\[${section}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m").exec(text)?.[1] ?? "";
  const v = new RegExp(`^\\s*${key}\\s*=\\s*([0-9.]+)`, "m").exec(body)?.[1];
  return v === undefined ? null : Number(v);
}

export function materializeSwebv(root: string, task: SwebvTask, dest: string, opts: { runtimeStages: string; runtimeCopy: string; network: "allowlist" | "public" }) {
  const src = join(root, task.registry.path);
  const sourceDigest = treeDigest(src);
  if ("sha256:" + sourceDigest !== task.digest) throw new Error(`${task.task_id}: source digest sha256:${sourceDigest} differs from swebv-r3.json ${task.digest}`);
  const original = readFileSync(join(src, "task.toml"), "utf8");
  const agentTimeoutSec = tomlNumber(original, "agent", "timeout_sec");
  const verifierTimeoutSec = tomlNumber(original, "verifier", "timeout_sec");
  if (!agentTimeoutSec || !verifierTimeoutSec) throw new Error(`${task.task_id}: task.toml has no [agent] or [verifier] timeout_sec`);
  return materialize(src, dest, { ...opts, agentTimeoutSec, verifierTimeoutSec });
}

if (import.meta.main) {
  const [kind, srcRoot, destRoot, idsCsv, network = "allowlist"] = Bun.argv.slice(2);
  const here = import.meta.dir;
  const runtimeStages = readFileSync(join(here, "runtime-stages.Dockerfile"), "utf8");
  const runtimeCopy = readFileSync(join(here, "runtime-copy.Dockerfile"), "utf8");
  const net = network as "allowlist" | "public";
  const out: Record<string, unknown> = {};
  for (const id of idsCsv.split(",").filter(Boolean)) {
    out[id] = kind === "tb2"
      ? materializeTb2(join(srcRoot, id), join(destRoot, id), { runtimeStages, runtimeCopy, network: net })
      : materialize(join(srcRoot, id), join(destRoot, id), { runtimeStages, runtimeCopy, agentTimeoutSec: Number(process.env.AGENT_TIMEOUT_SEC ?? 2400), verifierTimeoutSec: 1800, network: net });
  }
  console.log(JSON.stringify(out, null, 2));
}
