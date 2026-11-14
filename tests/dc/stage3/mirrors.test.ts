// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host's package mirrors (stage3/ubicloud-real.ts mirrorSetup and checkMirrors) on stage3/fake.ts's
// service model: ce415cb's setup, whose verdaccio ran under Ubuntu noble's Node 18, fails the readiness check with
// E_DCH_MIRROR_DOWN; the setup on the pinned Node passes; a Node tarball that is not the pin stops the setup; and the
// check's own result reads strictly. No key, no network, no VM.
import { describe, expect, test } from "bun:test";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { downMirrors, fakeBackend, fakeWorld } from "../../../lanes/design-constructed/stage3/fake.ts";
import { NODE } from "../../../lanes/design-constructed/stage3/install.ts";
import type { VmSpec } from "../../../lanes/design-constructed/stage3/sandbox.ts";
import { checkMirrors, MIRROR_JOURNAL_CHARS, MIRROR_NODE_ROOT, MIRROR_PORTS, mirrorProblems, mirrorSetup, parseMirrorReady, shq, VERDACCIO_PREFIX } from "../../../lanes/design-constructed/stage3/ubicloud-real.ts";

const HOST: VmSpec = { label: "dc controller host test", owner: "test", ttlMinutes: 60, runMinutes: 30, runUser: "run", proxy: null, mirrors: [], mounts: [], env: {} };

/** ce415cb's mirrorSetup word for word: Ubuntu's nodejs and npm, and verdaccio started from npm's global bin. */
function ce415cbSetup(ip: string): string[] {
  const unit = (name: string, exec: string) => "printf '%s\\n' '[Unit]' 'After=network-online.target' '[Service]' " + shq("ExecStart=" + exec) + " 'Restart=always' '[Install]' 'WantedBy=multi-user.target' > /etc/systemd/system/" + name + ".service";
  return [
    "DEBIAN_FRONTEND=noninteractive apt-get install -y apt-cacher-ng docker-registry python3-venv nodejs npm -o DPkg::Lock::Timeout=600",
    "printf 'Port:%s\\nBindAddress: %s\\n' " + MIRROR_PORTS.apt + " " + ip + " > /etc/apt-cacher-ng/zz-dc.conf && systemctl restart apt-cacher-ng",
    "printf 'version: 0.1\\nstorage:\\n  filesystem:\\n    rootdirectory: /var/lib/docker-registry\\nhttp:\\n  addr: %s:%s\\nproxy:\\n  remoteurl: https://registry-1.docker.io\\n' " + ip + " " + MIRROR_PORTS.dockerhub + " > /etc/docker/registry/config.yml && systemctl restart docker-registry",
    "npm install -g verdaccio@7.1.0",
    "mkdir -p /etc/verdaccio && printf 'storage: /var/lib/verdaccio\\nuplinks:\\n  npmjs:\\n    url: https://registry.npmjs.org/\\npackages:\\n  \"**\":\\n    access: $all\\n    proxy: npmjs\\nlisten: %s:%s\\n' " + ip + " " + MIRROR_PORTS.npm + " > /etc/verdaccio/config.yaml",
    unit("dc-verdaccio", "/usr/local/bin/verdaccio --config /etc/verdaccio/config.yaml"),
    "python3 -m venv /opt/devpi && /opt/devpi/bin/pip install devpi-server==6.21.0 && /opt/devpi/bin/devpi-init --serverdir /var/lib/devpi",
    unit("dc-devpi", "/opt/devpi/bin/devpi-server --serverdir /var/lib/devpi --host " + ip + " --port " + MIRROR_PORTS.pypi),
    "systemctl daemon-reload && systemctl enable --now dc-verdaccio dc-devpi",
  ];
}

/** Runs setup lines as root on one fake controller until one fails, then the readiness check with a short wait. */
async function controller(lines: (ip: string) => string[]) {
  const w = fakeWorld();
  const b = fakeBackend(w);
  const vm = await b.create(HOST);
  const ip = w.vms[0]!.ip;
  let failed: string | null = null;
  for (const l of lines(ip)) {
    const r = await b.exec(vm, l, { user: "root" });
    if (r.exit !== 0) {
      failed = l;
      break;
    }
  }
  const check = await checkMirrors((c, o) => b.exec(vm, c, o), ip, 20).then(
    () => null,
    (e: unknown) => e as DcError,
  );
  return { ip, fake: w.vms[0]!, failed, check };
}

describe("the controller host's mirrors", () => {
  // Value: protects=the launch's ready step: every mirror answers its protocol-level check before the host reports ready; fails_when=a verdaccio that cannot start under the controller's Node, or any mirror that answers no 200, passes the check, or the refusal drops the unit's state and journal; why_new=ce415cb's controller installed verdaccio 7.1.0 under Ubuntu noble's Node 18, it died with ERR_REQUIRE_ESM, and the launch still reported ready, so the preflight's corepack request failed in the sandbox; seam=mirrorSetup, checkMirrors, stage3/fake.ts's unit model; no_claim=a real VM (the 2026-11-14 probe ran both setups on one)
  test("ce415cb's mirror setup fails the readiness check with E_DCH_MIRROR_DOWN: verdaccio's unit failed under Node 18", async () => {
    const c = await controller(ce415cbSetup);
    expect(c.failed).toBeNull();
    expect(downMirrors(c.fake)).toEqual(["npm"]);
    expect(c.check).toBeInstanceOf(DcError);
    expect(c.check!.code).toBe("E_DCH_MIRROR_DOWN");
    const m = c.check!.message;
    const unit = "dc-verdaccio.service: ";
    expect(m).toBe("the npm mirror (http://" + c.ip + ":4873/-/ping) answered no HTTP response within 20 s; dc-verdaccio is failed; its journal ends: } | Node.js v18.19.1 | " + unit + "Main process exited, code=exited, status=1/FAILURE | " + unit + "Failed with result 'exit-code'. | " + unit + "Scheduled restart job, restart counter is at 5. | " + unit + "Start request repeated too quickly. | " + unit + "Failed with result 'exit-code'. | Failed to start dc-verdaccio.service.");
  });
  test("a long journal is quoted by its last " + MIRROR_JOURNAL_CHARS + " characters", () => {
    const [line] = mirrorProblems([{ name: "apt", code: "502", state: "active", journal: "x".repeat(900) + "\nlast line\n" }], "10.0.0.3");
    expect(line!.startsWith("the apt mirror (http://10.0.0.3:3142/acng-report.html) answered HTTP 502 within 180 s; apt-cacher-ng is active; its journal ends: ...")).toBe(true);
    expect(line!.slice(line!.indexOf("ends: ") + 6)).toBe("..." + ("x".repeat(900) + " | last line").slice(-MIRROR_JOURNAL_CHARS));
  });
  test("the setup on the pinned Node passes: verdaccio runs under the sha256-checked Node 24 build, and Ubuntu's nodejs and npm are not installed", async () => {
    const c = await controller((ip) => mirrorSetup(ip));
    expect([c.failed, c.check, downMirrors(c.fake)]).toEqual([null, null, []]);
    expect(c.fake.units.get("dc-verdaccio")).toEqual({ exec: MIRROR_NODE_ROOT + "/bin/node " + VERDACCIO_PREFIX + "/lib/node_modules/verdaccio/bin/verdaccio --config /etc/verdaccio/config.yaml", state: "active", journal: [] });
    expect([...c.fake.nodes]).toEqual([[MIRROR_NODE_ROOT + "/bin/node", NODE.version]]);
    const lines = mirrorSetup(c.ip);
    expect(lines[0]).not.toMatch(/\bnodejs\b|\bnpm\b/);
    expect(lines.filter((l) => l.includes(NODE.sha256))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("npm "))).toBe(false);
  });
  test("a Node tarball that is not the pinned build stops the setup at its sha256 check, before verdaccio installs", async () => {
    const c = await controller((ip) => mirrorSetup(ip, { version: "24.0.0", sha256: NODE.sha256 }));
    expect(c.failed).toStartWith('test "$(sha256sum /var/tmp/node-v24.0.0-linux-x64.tar.xz');
    expect(c.check!.code).toBe("E_DCH_MIRROR_DOWN");
    expect(downMirrors(c.fake)).toEqual(["npm", "pypi"]);
  });
  test("the check's result reads strictly: a missing end marker, a missing or repeated mirror and a bad code read as no result", async () => {
    const row = (n: string, code = "200") => n + "\t" + code + "\tactive\t";
    const all = ["npm", "pypi", "apt", "dockerhub"].map((n) => row(n));
    expect(parseMirrorReady([...all, "DC-MIRRORS-DONE", ""].join("\n"))!.map((r) => r.code)).toEqual(["200", "200", "200", "200"]);
    expect(parseMirrorReady(all.join("\n"))).toBeNull();
    expect(parseMirrorReady([...all.slice(1), "DC-MIRRORS-DONE"].join("\n"))).toBeNull();
    expect(parseMirrorReady([...all, row("npm"), "DC-MIRRORS-DONE"].join("\n"))).toBeNull();
    expect(parseMirrorReady([row("npm", "2x0"), ...all.slice(1), "DC-MIRRORS-DONE"].join("\n"))).toBeNull();
    const cut = await checkMirrors(async () => ({ exit: 0, stdout: all.join("\n"), stderr: "" }), "10.0.0.3").then(() => null, (e: DcError) => e);
    expect([cut!.code, cut!.message]).toEqual(["E_DCH_MIRROR_DOWN", "the controller host's mirror check returned no readable result (exit 0), so no mirror is known to serve"]);
  });
});
