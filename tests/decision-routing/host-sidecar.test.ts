// Copyright (c) 2026 Garry Tan. MIT License.
// Every session's traffic leaves through Harbor's egress sidecar, a gost transparent proxy. gost's redirect handler cuts
// a connection whose response has not started within its readTimeout, 15 s unless set, and Harbor's gost.yaml leaves
// it unset, so a model reply that took 15 s or more was paid for and never delivered. The rig now builds the sidecar
// from its own copy of Harbor's build context (lanes/decision-routing/agent/egress-sidecar, from Harbor f3a5a923) with
// one added line, the handler's readTimeout: 900s, the proxy's own upstream deadline, and Harbor's job config names
// that environment (controller.ts harborJob, agent/dr_sidecar.py).
//
// The keyless tests pin the copy to Harbor's bytes apart from its header and that one line. With DR_REAL_SIDECAR=1
// and DR_HARBOR_PYTHON naming a python that imports Harbor, the real tests resolve the sidecar the job config builds,
// build it with docker, and send a 20 s reply and an off-allowlist request through it; a container with no sidecar
// shows the off-allowlist address answers when nothing stands in the way.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { harborJob, type PlanRow } from "../../lanes/decision-routing/host/controller.ts";

const AGENT = resolve(import.meta.dir, "../../lanes/decision-routing/agent");
const CONTEXT = join(AGENT, "egress-sidecar");
const HEADER = "# harbor: ";
const READ_TIMEOUT_LINE = "        readTimeout: 900s";
const GOST_DIGEST = "sha256:afc0137758ab4ce399d47a299f9abbacbf522b52a17e59cbb4b4e7a1a66e9196";
/** sha256 of each file at Harbor f3a5a923f6d722472c9e797af836ae4425fb215f, under src/harbor/environments/docker/harbor-docker-egress-control-sidecar/ (LICENSE at the root), and its mode there. */
const UPSTREAM: Record<string, { sha256: string; mode: number }> = {
  Dockerfile: { sha256: "a2385dd6b3eee6e04c49b467df84ed2a273fd402a9cdd404a64fb535e9b26ff7", mode: 0o644 },
  "allowlist.txt": { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", mode: 0o644 },
  "entrypoint.sh": { sha256: "2e225ed745eb5976f93afd52d91c844b954b5f6f45373fb70c4c509e36d1e069", mode: 0o755 },
  "gost.yaml": { sha256: "78c18e58efbc7c8e226cb311e2a4cf3863d5a2f3e54b3bf15a0ea4b885345290", mode: 0o644 },
  "bin/network-policy": { sha256: "ff1cacfb95e17cda3668f389176ae54e5e4139cff12ee54b4d745722ad0ff0b2", mode: 0o755 },
  LICENSE: { sha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4", mode: 0o644 },
};
const ROW: PlanRow = { task: "django-1", cell: "N", model: "opus", item: "dr-calibration-r3" };
const JOB = harborJob(ROW, { out: "/o", tasksDir: "/tasks", proxyHost: "172.17.0.1", runtimeTarball: "/rt.tgz", runtimeSha256: "ab", pinFile: "/pin.json" });

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [relative(CONTEXT, join(dir, e.name))])).sort();
const withoutHeader = (text: string) => text.split("\n").filter((l) => !l.startsWith(HEADER)).join("\n");

describe("the rig's copy of Harbor's egress sidecar", () => {
  test("Harbor's job config names the rig's docker environment, which builds the sidecar from the copy", () => {
    expect((JOB.environment as { import_path?: string }).import_path).toBe("dr_sidecar:DrDockerEnvironment");
    const stub = [
      "import sys, types",
      "from pathlib import Path",
      "class DockerEnvironment:",
      "    _EGRESS_CONTROL_SIDECAR_CONTEXT_PATH = Path('/stock')",
      "for n in ('harbor', 'harbor.environments', 'harbor.environments.docker'):",
      "    sys.modules[n] = types.ModuleType(n)",
      "m = types.ModuleType('harbor.environments.docker.docker')",
      "m.DockerEnvironment = DockerEnvironment",
      "sys.modules[m.__name__] = m",
      "sys.path.insert(0, sys.argv[1])",
      "module, name = sys.argv[2].split(':')",
      "cls = getattr(__import__(module), name)",
      "print(issubclass(cls, DockerEnvironment), cls._EGRESS_CONTROL_SIDECAR_CONTEXT_PATH)",
    ].join("\n");
    const r = spawnSync("python3", ["-I", "-B", "-c", stub, AGENT, String((JOB.environment as { import_path?: string }).import_path)], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("True " + CONTEXT);
  });

  test("the copy is Harbor's files byte for byte, apart from each file's header and gost.yaml's readTimeout line", () => {
    expect(files(CONTEXT)).toEqual(Object.keys(UPSTREAM).sort());
    for (const [name, want] of Object.entries(UPSTREAM)) {
      const text = readFileSync(join(CONTEXT, name), "utf8");
      const lines = withoutHeader(text).split("\n");
      const body = name === "gost.yaml" ? lines.filter((l) => l !== READ_TIMEOUT_LINE).join("\n") : lines.join("\n");
      expect({ name, sha256: sha(body), mode: statSync(join(CONTEXT, name)).mode & 0o777 }).toEqual({ name, sha256: want.sha256, mode: want.mode });
      if (name !== "LICENSE" && name !== "allowlist.txt") expect(text.split("\n").filter((l) => l.startsWith(HEADER)).join("\n")).toContain("f3a5a923f6d722472c9e797af836ae4425fb215f");
    }
  });

  test("gost.yaml sets the redirect handler's readTimeout to 900s, once, inside the handler's metadata", () => {
    const lines = readFileSync(join(CONTEXT, "gost.yaml"), "utf8").split("\n");
    const at = lines.flatMap((l, i) => (l === READ_TIMEOUT_LINE ? [i] : []));
    expect(at).toHaveLength(1);
    expect(lines.lastIndexOf("    handler:", at[0])).toBeGreaterThan(-1);
    expect(lines.lastIndexOf("      metadata:", at[0])).toBeGreaterThan(lines.lastIndexOf("    handler:", at[0]));
    expect(lines.indexOf("    listener:")).toBeGreaterThan(at[0]);
  });

  test("the sidecar still starts from the same gost image digest", () => {
    expect(readFileSync(join(CONTEXT, "Dockerfile"), "utf8").split("\n").filter((l) => l.startsWith("FROM "))).toEqual(["FROM gogost/gost:3.2.7-nightly.20260602@" + GOST_DIGEST]);
  });

  test("NOTICE.md lists the copy as vendored from Harbor's source commit", () => {
    const row = readFileSync(join(import.meta.dir, "../../NOTICE.md"), "utf8").split("\n").find((l) => l.includes("lanes/decision-routing/agent/egress-sidecar/"));
    expect(row).toContain("harbor-framework/harbor");
    expect(row).toContain("f3a5a923");
    expect(row).toContain("Apache");
    expect(row).toContain("vendored");
  });
});

const REAL = process.env.DR_REAL_SIDECAR === "1";
const PORT = Number(process.env.DR_SIDECAR_PROBE_PORT ?? 47107);
const NAME = "dr-sidecar-test-" + process.pid;
const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 600_000 });

describe.skipIf(!REAL)("the sidecar Harbor builds for the job config, with real docker", () => {
  let image = "";
  let gateway = "";
  let hostIp = "";
  let server: ReturnType<typeof Bun.serve> | null = null;

  beforeAll(() => {
    const python = process.env.DR_HARBOR_PYTHON;
    if (!python) throw new Error("DR_REAL_SIDECAR=1 needs DR_HARBOR_PYTHON, a python that imports Harbor");
    const importPath = (JOB.environment as { import_path?: string }).import_path ?? "";
    const resolveContext = [
      "import sys",
      "from harbor.environments.docker.docker import DockerEnvironment",
      "from harbor.utils.import_path import import_symbol",
      "cls = import_symbol(sys.argv[1]) if sys.argv[1] else DockerEnvironment",
      "print(cls._EGRESS_CONTROL_SIDECAR_CONTEXT_PATH)",
    ].join("\n");
    const ctx = spawnSync(python, ["-c", resolveContext, importPath], { encoding: "utf8", env: { ...process.env, PYTHONPATH: AGENT } });
    if (ctx.status !== 0) throw new Error("could not resolve the job's sidecar context: " + ctx.stderr);
    const built = docker("build", "-q", "-t", NAME + ":img", ctx.stdout.trim());
    if (built.status !== 0) throw new Error("docker build failed: " + built.stderr);
    image = NAME + ":img";
    gateway = docker("network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}").stdout.trim();
    hostIp = /\bsrc (\S+)/.exec(spawnSync("ip", ["-4", "route", "get", "1.1.1.1"], { encoding: "utf8" }).stdout)?.[1] ?? "";
    if (!gateway || !hostIp || hostIp === gateway) throw new Error("need the docker bridge gateway and a second host address, got " + JSON.stringify({ gateway, hostIp }));
    server = Bun.serve({ hostname: "0.0.0.0", port: PORT, idleTimeout: 0, fetch: async (req) => { const d = Number(new URL(req.url).searchParams.get("d") ?? 0); await Bun.sleep(d * 1000); return new Response("ok after " + d); } });
    const run = docker("run", "-d", "--name", NAME, "--cap-add", "NET_ADMIN", "--cap-add", "NET_RAW", "-e", "EGRESS_CONTROL_INITIAL_NETWORK_MODE=allowlist", "-e", "EGRESS_CONTROL_INITIAL_ALLOWED_HOSTS=" + gateway, "--entrypoint", "/opt/egress-sidecar/entrypoint.sh", image);
    if (run.status !== 0) throw new Error("the sidecar did not start: " + run.stderr);
    const ready = () => docker("exec", NAME, "test", "-f", "/tmp/harbor-docker-egress-control-sidecar.ready").status === 0;
    for (let i = 0; i < 60 && !ready(); i++) Bun.sleepSync(500);
    if (!ready()) throw new Error("the sidecar never became ready (its kernel needs nftables inet tables, as host/post-boot.sh checks): " + docker("logs", "--tail", "5", NAME).stderr);
  }, 900_000);

  afterAll(() => {
    docker("rm", "-f", NAME);
    if (image) docker("rmi", "-f", image);
    server?.stop(true);
  });

  // Asynchronous, so this process's server keeps answering while the client container waits.
  const fetchVia = async (network: string[], url: string, timeoutSec: number) => {
    const started = performance.now();
    const p = Bun.spawn(["docker", "run", "--rm", ...network, "--entrypoint", "wget", image, "-q", "-O", "-", "-T", String(timeoutSec), url], { stdout: "pipe", stderr: "pipe" });
    const body = (await new Response(p.stdout).text()).trim();
    return { ok: (await p.exited) === 0, body, seconds: Math.round((performance.now() - started) / 100) / 10 };
  };

  test("a reply that starts after 20 s reaches the agent through the sidecar", async () => {
    const r = await fetchVia(["--network", "container:" + NAME], "http://" + gateway + ":" + PORT + "/?d=20", 120);
    expect({ ok: r.ok, body: r.body }).toEqual({ ok: true, body: "ok after 20" });
  }, 180_000);

  test("an address off the allowlist is refused through the sidecar, and answers from a container with no sidecar", async () => {
    const off = "http://" + hostIp + ":" + PORT + "/?d=0";
    expect(await fetchVia(["--network", "container:" + NAME], off, 15)).toMatchObject({ ok: false, body: "" });
    expect(await fetchVia([], off, 15)).toMatchObject({ ok: true, body: "ok after 0" });
  }, 120_000);
});
