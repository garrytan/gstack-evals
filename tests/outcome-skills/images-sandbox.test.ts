// One bound T-G task through real sandbox setup, on real Docker (GSTACK_EVALS_DOCKER=1), keyless and with no model call.
// pin builds a fixture task's image with quick/laneb's runtime layer on top, check passes it, and bind writes its run
// copy. A container started from bind's tag then goes through real_agent's own sandbox setup (sandbox_setup_test.py): the
// U4 image check against the manifest row, the sidecar's trial, the egress table and its probe from the runtime layer's
// /opt/laneb/bin/node, and the in-container prep. Once the tag is moved to another image, a container started from it is
// refused before any sandbox opens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bind, check, pin, type ImageManifest } from "../../lanes/outcome-skills/images/manifest.ts";
import { startSidecar, type SidecarHandle } from "../../lanes/real-outcome/sandbox/sidecar.ts";
import { buildTask } from "../../lanes/real-outcome/task/build.ts";
import { buildImage } from "../../lanes/real-outcome/task/check.ts";
import { readTask } from "../../lanes/real-outcome/task/format.ts";
import { allPass, requiredTests, verifyTree } from "../../lanes/real-outcome/task/verify.ts";
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
    const j = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
    j.tests.regression_scope = [];
    j.tests.regression = [];
    writeFileSync(join(dir, "task.json"), JSON.stringify(j, null, 2));
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

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("pin checks gold in the layered image (GSTACK_EVALS_DOCKER=1)", () => {
  test("a required test that passes in the bare task image and fails once the runtime layer puts node on PATH refuses the row, naming it", async () => {
    const tmp = tempDir("tg-oracle-");
    const images: string[] = [];
    try {
      const calc = join(tmp.dir, "calc");
      const dir = join(tmp.dir, "k1");
      const probe = "\n\ndef test_no_node():\n    import shutil\n    assert shutil.which(\"node\") is None\n";
      const commits = calcCommits().map((c) => {
        const ops = c.files?.["tests/test_ops.py"];
        return typeof ops === "string" ? { ...c, files: { ...c.files, "tests/test_ops.py": ops + probe } } : c;
      });
      buildTask(calcSpecs(tmp.dir, buildRepo(calc, commits)).k1, calc, dir);
      const j = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
      j.tests.regression_scope = [];
      j.tests.regression = ["tests/test_ops.py::test_no_node"];
      writeFileSync(join(dir, "task.json"), JSON.stringify(j, null, 2));
      const t = readTask(dir);
      const bare = buildImage(dir, t);
      images.push(bare.tag);
      const gold = verifyTree({ taskDir: dir, task: t, image: bare.tag, label: "bare-gold", patch: readFileSync(join(dir, "solution", "gold.patch"), "utf8"), runs: 1, seed: 1, work: join(tmp.dir, "work") });
      expect(allPass(gold, requiredTests(t))).toBe(true);
      const out = join(tmp.dir, "tg-images.json");
      const refused = await pin([dir], out, "T-G", "test").then(() => null, (e) => (e as Error).message);
      expect(refused).toMatch(/^E_OUTCOME_IMAGE fx-calc-k1: gold fails tests\/test_ops\.py::test_no_node in the pinned image sha256:[0-9a-f]{64}/);
      expect(existsSync(out)).toBe(false);
    } finally {
      if (images.length) spawnSync("docker", ["rmi", "-f", ...images], { encoding: "utf8", timeout: 600_000 });
      tmp.cleanup();
    }
  }, 1_800_000);
});
