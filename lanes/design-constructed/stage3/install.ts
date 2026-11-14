// Copyright (c) 2026 Garry Tan. MIT License.
// What the controller installs in a sandbox VM before its session or checks start (the Captain's ruling on open item 1D,
// option 1): Playwright's headless Chromium build, copied over SSH with its system libraries from the apt mirror, and
// for the VMs that run an agent the pinned Claude Code binary. The install runs as root after the preamble (the mirror
// config and the egress filter are already in place), between two markers, and records every file it wrote with its
// sha256 (a symlink's target for a link). That list is the controller's: the audit leaves a listed file out of the
// session's written files and out of the key scan only while it still matches the recorded digest, so a file the agent
// changes afterwards reads as the agent's again.
import { DcError } from "../errors.ts";
import { AUDIT_DIR, describeCommand, parseDescribe, type ControllerEntry, type ExecResult, type Vm, type VmBackend } from "./sandbox.ts";

/** BT: where the browser build unpacks in the VM; the browser seam launches it from here. */
export const BROWSER_ROOT = "/opt/dc-browser";
/** BT: where the agent's Claude Code binary unpacks in the VM (the npm tarball's package/ folder). */
export const AGENT_ROOT = "/opt/dc-agent";

/**
 * Playwright's own install-deps list for chromium on ubuntu24.04-x64 at playwright-core 1.65.1 (the package.json pin):
 * its tools, then its chromium libraries, in its order. tests/dc/stage3/install.test.ts reads the same list from the
 * installed playwright-core and checks they are equal, so a version bump that changes it fails a test.
 */
export const CHROMIUM_APT: readonly string[] = [
  "xvfb",
  "fonts-noto-color-emoji",
  "fonts-unifont",
  "libfontconfig1",
  "libfreetype6",
  "xfonts-cyrillic",
  "xfonts-scalable",
  "fonts-liberation",
  "fonts-ipafont-gothic",
  "fonts-wqy-zenhei",
  "fonts-tlwg-loma-otf",
  "fonts-freefont-ttf",
  "libasound2t64",
  "libatk-bridge2.0-0t64",
  "libatk1.0-0t64",
  "libatspi2.0-0t64",
  "libcairo2",
  "libcups2t64",
  "libdbus-1-3",
  "libdrm2",
  "libgbm1",
  "libglib2.0-0t64",
  "libnspr4",
  "libnss3",
  "libpango-1.0-0",
  "libx11-6",
  "libxcb1",
  "libxcomposite1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxkbcommon0",
  "libxrandr2",
];

/** One thing the controller copies into a VM. */
export interface ControllerFiles {
  /** A name for errors and the tar's file name; lower-case letters, digits and dashes. */
  name: string;
  /** The folder in the VM it unpacks into. */
  root: string;
  /** The tar (or gzip tar) of the files, read on the controller. */
  tar: () => Promise<Uint8Array>;
  /** apt packages it needs, from the apt mirror. */
  apt: readonly string[];
  /** A shell check, run as the run user after the unpack, that exits 0 when the install works. */
  check: string;
}

export interface InstallOptions {
  /** Where the marker, the list and the tars live; the sandbox's audit folder. */
  auditDir?: string;
  /** The tree the manifest walks; / in a VM. */
  scanRoot?: string;
  /** How long the apt step may take. */
  aptTimeoutMs?: number;
}

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const PKG = /^[a-z0-9][a-z0-9.+:-]*$/;
/** The paths written since the start marker, outside the pruned trees, NUL-separated into the list file. */
export const manifestFind = (o: { scanRoot: string; auditDir: string }) =>
  "find " +
  q(o.scanRoot) +
  " -xdev \\( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /work -o -path " +
  q(o.auditDir) +
  " \\) -prune -o -newer " +
  q(o.auditDir + "/controller-start") +
  " -print0 > " +
  q(o.auditDir + "/controller.list");

const must = (r: ExecResult, what: string, vm: Vm): void => {
  if (r.exit !== 0) throw new DcError("E_DC_INFRA_MISSING", "the controller's install on " + vm.id + " failed at " + what + " (exit " + r.exit + ")");
};

/**
 * Installs each item as root, in order: the start marker, the apt packages from the mirror in one install, each tar
 * unpacked into its root (owned by root, readable by all, with fresh times so the audit's written-file list sees it), each check as the run user, then the manifest of every file
 * written since the marker. Any step that fails throws E_DC_INFRA_MISSING: a failure outside the agent.
 */
export async function installControllerFiles(backend: VmBackend, vm: Vm, items: readonly ControllerFiles[], o: InstallOptions = {}): Promise<ControllerEntry[]> {
  const audit = o.auditDir ?? AUDIT_DIR;
  const scanRoot = o.scanRoot ?? "/";
  for (const it of items) {
    if (!NAME.test(it.name)) throw new DcError("E_USAGE", "controller file set " + JSON.stringify(it.name) + " is not a plain name");
    if (!it.root.startsWith("/") || it.root.includes("'")) throw new DcError("E_USAGE", it.name + "'s root is not an absolute path");
    for (const p of it.apt) if (!PKG.test(p)) throw new DcError("E_USAGE", it.name + " names apt package " + JSON.stringify(p) + ", which is not a package name");
  }
  must(await backend.exec(vm, "mkdir -p " + q(audit) + " && touch " + q(audit + "/controller-start"), { user: "root" }), "the start marker", vm);
  const apt = [...new Set(items.flatMap((it) => it.apt))];
  if (apt.length) must(await backend.exec(vm, "export DEBIAN_FRONTEND=noninteractive && apt-get update -q && apt-get install -y -q --no-install-recommends " + apt.join(" "), { user: "root", timeoutMs: o.aptTimeoutMs ?? 900_000 }), "the apt packages", vm);
  for (const it of items) {
    const tar = audit + "/" + it.name + ".tar";
    await backend.write(vm, tar, await it.tar());
    must(await backend.exec(vm, "mkdir -p " + q(it.root) + " && tar -xf " + q(tar) + " -C " + q(it.root) + " --no-same-owner --touch && rm -f " + q(tar) + " && chmod -R a+rX,go-w " + q(it.root), { user: "root", timeoutMs: 300_000 }), it.name + "'s unpack", vm);
  }
  for (const it of items) must(await backend.exec(vm, it.check, { user: "run" }), it.name + "'s check", vm);
  const listed = await backend.exec(vm, manifestFind({ scanRoot, auditDir: audit }) + " && " + describeCommand(audit + "/controller.list"), { user: "root", timeoutMs: 300_000 });
  must(listed, "the manifest", vm);
  const rows = parseDescribe(listed.stdout);
  if (!rows) throw new DcError("E_DC_INFRA_MISSING", "the controller's manifest on " + vm.id + " was cut");
  return rows.filter((r): r is ControllerEntry => r.type !== "x");
}

/** The tar of a folder on the controller, as bytes (a symlink stays a symlink). */
export async function tarOf(dir: string): Promise<Uint8Array> {
  const p = Bun.spawn(["tar", "-cf", "-", "-C", dir, "."], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), p.exited]);
  if (code !== 0) throw new DcError("E_DC_INFRA_MISSING", "could not pack " + dir + " on the controller (tar exited " + code + ")");
  return new Uint8Array(out);
}

/** The browser build: a Playwright Chromium folder on the controller, its binary at bin inside it, with Playwright's apt list. */
export function browserFiles(dir: string, bin: string): ControllerFiles {
  if (bin.startsWith("/") || bin.split("/").includes("..")) throw new DcError("E_USAGE", "the browser binary must be a path inside the build folder");
  const path = BROWSER_ROOT + "/" + bin;
  return { name: "browser", root: BROWSER_ROOT, tar: () => tarOf(dir), apt: CHROMIUM_APT, check: "test -x " + q(path) + " && ! ldd " + q(path) + " 2>/dev/null | grep -q 'not found'" };
}

/** Where the agent's Claude Code binary sits in the VM once its npm tarball is unpacked. */
export const AGENT_CLAUDE = AGENT_ROOT + "/package/claude";

/** The pinned Claude Code binary: the npm tarball's bytes, already checked against the pin by the caller. */
export const claudeFiles = (tgz: () => Promise<Uint8Array>): ControllerFiles => ({ name: "claude-code", root: AGENT_ROOT, tar: tgz, apt: [], check: q(AGENT_CLAUDE) + " --version" });

/**
 * A backend whose prepare installs the controller's files: the browser in every VM, Claude Code too in the VMs that
 * reach the proxy (recipe sessions and builds). Every other call goes to the inner backend.
 */
export function controllerBackend(inner: VmBackend, o: { browser: ControllerFiles; agent: ControllerFiles | null; install?: InstallOptions }): VmBackend {
  return {
    create: (spec) => inner.create(spec),
    exec: (vm, command, eo) => inner.exec(vm, command, eo),
    write: (vm, path, data) => inner.write(vm, path, data),
    read: (vm, path) => inner.read(vm, path),
    destroy: (vm) => inner.destroy(vm),
    prepare: (vm) => installControllerFiles(inner, vm, vm.spec.proxy && o.agent ? [o.browser, o.agent] : [o.browser], o.install),
  };
}
