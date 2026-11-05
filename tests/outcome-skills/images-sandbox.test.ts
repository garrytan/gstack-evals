// One bound T-G task through real sandbox setup, on real Docker (GSTACK_EVALS_DOCKER=1), keyless and with no model call.
// pin builds a fixture task's image with quick/laneb's runtime layer on top, check passes it, and bind writes its run
// copy. A container started from bind's tag then goes through real_agent's own sandbox setup (sandbox_setup_test.py): the
// U4 image check against the manifest row, the sidecar's trial, the egress table and its probe from the runtime layer's
// /opt/laneb/bin/node, and the in-container prep. Once the tag is moved to another image, a container started from it is
// refused before any sandbox opens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bind, check, pin, type ImageManifest } from "../../lanes/outcome-skills/images/manifest.ts";
import { startSidecar, type SidecarHandle } from "../../lanes/real-outcome/sandbox/sidecar.ts";
import { buildTask } from "../../lanes/real-outcome/task/build.ts";
import { buildRepo, calcCommits, calcSpecs, tempDir } from "../real/fixture.ts";

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("one bound T-G task through real sandbox setup (GSTACK_EVALS_DOCKER=1)", () => {
  const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 600_000 });
  const names: string[] = [];
  const tags: string[] = [];
  let tmp: ReturnType<typeof tempDir>;
  let m: ImageManifest;
  let manifestPath: string;
  let label: string;
  let tag: string;
  let taskImage: string;
  let gateway: string;
  let sidecar: SidecarHandle;
  let proxy: Bun.TCPSocketListener<undefined>;

  beforeAll(async () => {
    tmp = tempDir("tg-sandbox-");
    const calc = join(tmp.dir, "calc");
    const dir = join(tmp.dir, "k1");
    const t = buildTask(calcSpecs(tmp.dir, buildRepo(calc, calcCommits())).k1, calc, dir).task;
    label = t.id;
    taskImage = "real-task-" + t.id.toLowerCase() + ":" + createHash("sha256").update(readFileSync(join(dir, "task.json"))).digest("hex").slice(0, 12);
    manifestPath = join(tmp.dir, "tg-images.json");
    m = await pin([dir], manifestPath, "T-G", "test");
    check(m);
    tag = bind(dir, m, label, join(tmp.dir, "run")).tag;
    tags.push(tag, taskImage);
    gateway = docker("network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}").stdout.trim();
    sidecar = startSidecar({ root: join(tmp.dir, "sidecar"), agentHost: gateway, agentPort: 0, controlPort: 0 });
    proxy = Bun.listen({ hostname: gateway, port: 0, socket: { data() {} } });
  }, 1_800_000);

  afterAll(() => {
    sidecar?.stop();
    proxy?.stop(true);
    if (names.length) docker("rm", "-f", ...names);
    if (tags.length) docker("rmi", "-f", ...tags);
    if (m) docker("rmi", "-f", m.rows[0]!.image_id);
    tmp?.cleanup();
  });

  const setup = async (want: "setup" | "refused") => {
    const name = "tg-sandbox-" + process.pid + "-" + names.length;
    names.push(name);
    expect(docker("run", "-d", "--name", name, tag, "sleep", "infinity").status).toBe(0);
    const p = Bun.spawn(["python3", join(import.meta.dir, "..", "real-outcome", "sandbox_setup_test.py"), want], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", CONTAINER: name, TASK_JSON: join(tmp.dir, "run", "task.json"), LABEL: label, IMAGE_ID: m.rows[0]!.image_id, MANIFEST: manifestPath, MANIFEST_SHA256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"), SIDECAR: sidecar.controlUrl, BASE_URL: "http://" + gateway + ":" + proxy.port },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    const code = await p.exited;
    if (code !== 0) console.log(out);
    return { code, out };
  };

  test("the pinned image carries the runtime layer, and a container from bind's tag passes the image check, the egress probe from /opt/laneb/bin/node and the prep, with no session opened", async () => {
    expect(m.rows[0]!.image_id).toBe(docker("image", "inspect", "-f", "{{.Id}}", tag).stdout.trim());
    const r = await setup("setup");
    expect(r.out).not.toContain("FAIL");
    expect(r.out.match(/^PASS /gm)?.length).toBe(1);
    expect(r.code).toBe(0);
  }, 600_000);

  test("a tag moved to another image is refused before any sandbox opens", async () => {
    expect(docker("tag", taskImage, tag).status).toBe(0);
    const r = await setup("refused");
    expect(r.out).not.toContain("FAIL");
    expect(r.out.match(/^PASS /gm)?.length).toBe(1);
    expect(r.code).toBe(0);
  }, 600_000);
});
