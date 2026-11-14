// Copyright (c) 2026 Garry Tan. MIT License.
// The throwaway VM sandbox for recipe sessions, qualification runs and stage 3 builds and checks (plan C5, R2-2 and the
// Captain's B1 ruling), with its fail-closed audit.
// Adapted from lanes/devex/stage3/sandbox.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (branch build-devex-review-eval).
//
// One VM per run, created for it and deleted after it: no keys inside, egress only to the metering proxy and the named
// mirror endpoints (npm, PyPI, Ubuntu apt and a Docker Hub pull-through cache, each a config entry the run's terms record
// names), no drive or host mount, apt's timers stopped and unattended-upgrades masked before anything runs, UBI_OWNER
// from the environment and a time to live covering the run. Every SSH command's exit is checked. After each run the audit
// reads the egress filter, the process list, the egress log and a stat-only list of files written outside /work, and
// scans written files and process arguments for key patterns and drive paths. Evidence it can't collect (a non-zero exit,
// empty or cut output where content is expected) stops like a breach (E_DC_SANDBOX_AUDIT).
//
// UbicloudBackend is the real backend: Ubicloud's API through an injected fetch, commands through an injected ssh. Tests
// drive it on invented fixtures; nothing in the keyless code creates a real VM.
import { DcError, fail } from "../errors.ts";
import { CapStopSignal, type HostsSeam } from "./seams.ts";

export interface Endpoint {
  /** An IPv4 literal, so the egress filter can name it. */
  host: string;
  port: number;
}

export type MirrorName = "npm" | "pypi" | "apt" | "dockerhub";
export const MIRROR_NAMES: readonly MirrorName[] = ["npm", "pypi", "apt", "dockerhub"];

/** One package mirror endpoint (B1). Each is a config entry whose terms the run's terms record names. */
export interface Mirror extends Endpoint {
  name: MirrorName;
  /** The registry base URL the VM's package manager reads, served on host:port. */
  url: string;
  /** The dated terms record's line for this registry and its terms. */
  terms: string;
}

export interface VmSpec {
  /** The frozen run, for example "recipe session 7"; names the VM and its dc-hosts sub-reservation. */
  label: string;
  /** UBI_OWNER, read from the environment by ownerFromEnv. */
  owner: string;
  ttlMinutes: number;
  /** The whole run: setup, the session or checks, the audit and the teardown. The time to live must cover it. */
  runMinutes: number;
  runUser: string;
  /** The metering proxy; null for a qualification or check run, which is offline except for the mirror. */
  proxy: Endpoint | null;
  mirrors: Mirror[];
  /** Drive or host mounts; must be empty. */
  mounts: string[];
  /** The environment the VM's commands get; never a key. */
  env: Record<string, string>;
}

export interface ExecResult {
  exit: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  user?: "root" | "run";
  timeoutMs?: number;
  /** Bytes for the command's stdin, such as the controller service's environment, which never touches the disk. */
  input?: Uint8Array;
}

export interface Vm {
  id: string;
  spec: VmSpec;
}

export interface VmBackend {
  create(spec: VmSpec): Promise<Vm>;
  exec(vm: Vm, command: string, o?: ExecOptions): Promise<ExecResult>;
  write(vm: Vm, path: string, data: Uint8Array | string): Promise<void>;
  read(vm: Vm, path: string): Promise<Uint8Array>;
  destroy(vm: Vm): Promise<void>;
  /**
   * The controller's own install after the preamble and before the job (stage3/install.ts: the browser build and, for
   * an agent's VM, Claude Code), returning every file it wrote. Absent, nothing is installed.
   */
  prepare?(vm: Vm): Promise<ControllerEntry[]>;
}

/** One file the controller wrote: f with its sha256, l with its link target, d or o (another type) with "-". */
export interface ControllerEntry {
  type: "f" | "l" | "d" | "o";
  digest: string;
  path: string;
}

/** A path as describeCommand reads it; x is a path that is gone. */
export interface Described {
  type: ControllerEntry["type"] | "x";
  digest: string;
  path: string;
}

export const DESCRIBE_DONE = "DC-CTL-DONE";

/**
 * Describes every path in a NUL-separated list file, one line each: type, sha256 (read through stdin, so a name never
 * changes sha256sum's output) or link target or "-", then the path. A gone path prints x. The done line is the
 * sentinel; output without it was cut.
 */
export const describeCommand = (list: string) =>
  "while IFS= read -r -d '' p; do if [ -L \"$p\" ]; then printf 'l\\t%s\\t%s\\n' \"$(readlink -- \"$p\")\" \"$p\"; elif [ -f \"$p\" ]; then printf 'f\\t%s\\t%s\\n' \"$(sha256sum < \"$p\" | cut -d' ' -f1)\" \"$p\"; elif [ -d \"$p\" ]; then printf 'd\\t-\\t%s\\n' \"$p\"; elif [ -e \"$p\" ]; then printf 'o\\t-\\t%s\\n' \"$p\"; else printf 'x\\t-\\t%s\\n' \"$p\"; fi; done < " +
  "'" + list.replace(/'/g, "'\\''") + "'" +
  " && echo " +
  DESCRIBE_DONE;

/** Reads describeCommand's lines. Null when a line is malformed or the done line is missing: the output was cut. */
export function parseDescribe(text: string): Described[] | null {
  const lines = text.split("\n").filter(Boolean);
  if (lines.pop() !== DESCRIBE_DONE) return null;
  const out: Described[] = [];
  for (const l of lines) {
    const m = /^([fldox])\t([^\t]*)\t(\/.*)$/.exec(l);
    if (!m) return null;
    if (m[1] === "f" && !/^[0-9a-f]{64}$/.test(m[2]!)) return null;
    out.push({ type: m[1] as Described["type"], digest: m[2]!, path: m[3]! });
  }
  return out;
}

/** The paths that are still the controller's: in its manifest and matching it now (type, and digest or link target). */
export function controllerOwned(manifest: readonly ControllerEntry[], now: readonly Described[]): Set<string> {
  const was = new Map(manifest.map((m) => [m.path, m]));
  const own = new Set<string>();
  for (const r of now) {
    const m = was.get(r.path);
    if (m && m.type === r.type && m.digest === r.digest) own.add(r.path);
  }
  return own;
}

/** BT: provider key shapes. The run's own proxy token is lease-scoped and is not one of them. */
export const KEY_PATTERNS: readonly string[] = [
  "(^|[^A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}",
  "(^|[^A-Za-z0-9_-])sk-(proj-|svcacct-|or-v1-)?[A-Za-z0-9_-]{32,}",
  "(^|[^A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}",
  "(^|[^A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36}",
  "github_pat_[A-Za-z0-9_]{40,}",
];
/** BT: paths into a Capy drive or a Capy machine's private folders. */
export const DRIVE_PATTERNS: readonly string[] = ["\\.capy/(drive|files|work|tool-outputs)", "drive://"];
/** Provider key names that never enter a VM's environment. */
export const KEY_NAMES: readonly string[] = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "UBICLOUD_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY"];

const keyRes = KEY_PATTERNS.map((p) => new RegExp(p));
const driveRes = DRIVE_PATTERNS.map((p) => new RegExp(p));
/** What a text carries: "key", "drive path", or null. */
export function secretHit(text: string): "key" | "drive path" | null {
  if (keyRes.some((r) => r.test(text))) return "key";
  if (driveRes.some((r) => r.test(text))) return "drive path";
  return null;
}

/** UBI_OWNER from the environment, read by name only. */
export function ownerFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const v = (env.UBI_OWNER ?? "").trim();
  if (!v) fail("E_USAGE", "UBI_OWNER is not set; every Ubicloud VM is named for its owner");
  return v;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** The endpoints a run may reach: exactly the proxy and the named mirrors. */
export const allowed = (spec: VmSpec): Endpoint[] => [...(spec.proxy ? [spec.proxy] : []), ...spec.mirrors];

/** What keeps a spec from running; empty when it may run. */
export function specProblems(spec: VmSpec): string[] {
  const out: string[] = [];
  if (!spec.owner.trim()) out.push("UBI_OWNER is not set");
  if (!spec.label.trim()) out.push("the run has no label");
  if (!(spec.runMinutes > 0) || !(spec.ttlMinutes >= spec.runMinutes)) out.push("the time to live (" + spec.ttlMinutes + " min) does not cover the run (" + spec.runMinutes + " min)");
  if (spec.mounts.length) out.push("the VM has mounts: " + spec.mounts.join(", "));
  const names = Object.keys(spec.env).filter((k) => KEY_NAMES.includes(k));
  if (names.length) out.push("the VM environment carries key names: " + names.join(", "));
  const hits = Object.entries(spec.env).filter(([k, v]) => secretHit(k + "=" + v) !== null).map(([k]) => k);
  if (hits.length) out.push("the VM environment carries a key or drive path in: " + hits.join(", "));
  if (!spec.runUser.trim() || spec.runUser === "root" || !/^[a-z][a-z0-9-]*$/.test(spec.runUser)) out.push("the run user must be a named non-root user");
  if (!allowed(spec).length) out.push("the run has no proxy and no mirror");
  for (const e of allowed(spec)) if (!IPV4.test(e.host) || !Number.isInteger(e.port) || e.port < 1 || e.port > 65535) out.push("endpoint " + e.host + ":" + e.port + " is not an IPv4 literal and port");
  const seen = new Set<string>();
  for (const m of spec.mirrors) {
    if (!MIRROR_NAMES.includes(m.name)) out.push("mirror " + m.name + " is not a named registry");
    if (seen.has(m.name)) out.push("mirror " + m.name + " is named twice");
    seen.add(m.name);
    if (!m.terms.trim()) out.push("mirror " + m.name + " has no terms record line");
    let url: URL | null = null;
    try {
      url = new URL(m.url);
    } catch {
      url = null;
    }
    if (!url || url.hostname !== m.host || Number(url.port || (url.protocol === "https:" ? 443 : 80)) !== m.port) out.push("mirror " + m.name + "'s URL is not served on its endpoint");
  }
  return out;
}

/** BT: each kind of run's length in minutes (the session or steps plus setup, audit and teardown). */
export const RUN_MINUTES = { recipe: 75, qualify: 90, build: 150, check: 90 } as const;
/** BT: the time to live's margin past the run. */
export const TTL_MARGIN_MINUTES = 60;

/**
 * A spec for one run: UBI_OWNER from the environment, a time to live covering the run, no mounts and no environment.
 * Recipe sessions and builds reach the proxy and the mirrors; qualification and check runs reach the mirrors only.
 */
export function specFor(kind: keyof typeof RUN_MINUTES, label: string, o: { proxy: Endpoint; mirrors: Mirror[]; runUser?: string; env?: Readonly<Record<string, string | undefined>> }): VmSpec {
  const online = kind === "recipe" || kind === "build";
  return { label, owner: ownerFromEnv(o.env), ttlMinutes: RUN_MINUTES[kind] + TTL_MARGIN_MINUTES, runMinutes: RUN_MINUTES[kind], runUser: o.runUser ?? "run", proxy: online ? o.proxy : null, mirrors: o.mirrors, mounts: [], env: {} };
}

/** The run's terms record lines: every named mirror registry and its terms (B1). */
export const termsRecord = (spec: VmSpec): string[] => spec.mirrors.map((m) => m.name + " " + m.url + " " + m.terms);

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
export const AUDIT_DIR = "/var/lib/dc-audit";
export const NET_PREFIX = "DCNET ";
export const DROP_PREFIX = "DCDROP ";
export const START_MARK = "DCNET-START";
export const END_MARK = "DCNET-END";

/** Each mirror's package manager pointed at it, before anything installs. */
export function mirrorConfig(spec: VmSpec): string[] {
  const out: string[] = [];
  for (const m of spec.mirrors) {
    if (m.name === "npm") out.push("printf 'registry=%s\\n' " + q(m.url) + " | tee /root/.npmrc /home/" + spec.runUser + "/.npmrc > /dev/null && chown " + spec.runUser + " /home/" + spec.runUser + "/.npmrc");
    if (m.name === "pypi") out.push("printf '[global]\\nindex-url = %s\\n' " + q(m.url) + " > /etc/pip.conf");
    if (m.name === "apt") out.push("printf 'deb %s noble main universe\\ndeb %s noble-updates main universe\\ndeb %s noble-security main universe\\n' " + q(m.url) + " " + q(m.url) + " " + q(m.url) + " > /etc/apt/sources.list && rm -f /etc/apt/sources.list.d/*");
    if (m.name === "dockerhub") out.push("mkdir -p /etc/docker && printf '{\"registry-mirrors\": [\"%s\"]}\\n' " + q(m.url) + " > /etc/docker/daemon.json && systemctl restart docker");
  }
  return out;
}

/**
 * What runs as root before anything else, each step's exit checked: apt's timers stopped and unattended-upgrades masked
 * (and verified), the run user's linger set, the audit's start marker, the mirror config, and an egress filter that
 * accepts and logs only the proxy and the mirrors and logs and drops every other new connection.
 */
export function preamble(spec: VmSpec): string[] {
  const allow = (e: Endpoint) => "nft add rule inet dc out ip daddr " + e.host + " tcp dport " + e.port + " ct state new log prefix " + q('"' + NET_PREFIX + '"') + " accept";
  return [
    "systemctl stop apt-daily.timer apt-daily-upgrade.timer",
    "systemctl disable apt-daily.timer apt-daily-upgrade.timer",
    "systemctl mask --now unattended-upgrades.service",
    "test \"$(systemctl is-enabled unattended-upgrades.service)\" = masked && ! systemctl is-active --quiet apt-daily.timer && ! systemctl is-active --quiet apt-daily-upgrade.timer",
    "id -u " + spec.runUser + " > /dev/null 2>&1 || useradd -m -s /bin/bash " + spec.runUser,
    "loginctl enable-linger " + spec.runUser,
    "mkdir -p " + AUDIT_DIR + " && chmod 700 " + AUDIT_DIR + " && touch " + AUDIT_DIR + "/start",
    ...mirrorConfig(spec),
    "nft add table inet dc",
    "nft 'add chain inet dc out { type filter hook output priority 0; policy drop; }'",
    "nft add rule inet dc out oif lo accept",
    "nft add rule inet dc out ct state established,related accept",
    ...allowed(spec).map(allow),
    "nft add rule inet dc out log prefix " + q('"' + DROP_PREFIX + '"') + " drop",
    "echo " + START_MARK + " > /dev/kmsg",
  ];
}

export interface Connection {
  host: string;
  port: number;
}

export interface ProcessRow {
  pid: number;
  user: string;
  args: string;
}

/** One file list row: stat data only, never contents. */
export interface StatEntry {
  path: string;
  size: number;
  mode: number;
  mtime: string;
  type: string;
}

export interface AuditEvidence {
  processes: ProcessRow[];
  /** New connections the filter accepted (egress). */
  egress: Connection[];
  /** New connections the filter dropped. Recorded and printed; a drop is not egress. */
  blocked: Connection[];
  /** Files written since the run started, outside /work. */
  files: StatEntry[];
  /** Scanned files that hold a key pattern or a drive path, by path only. */
  hits: string[];
  /** Written files left out of files and the scan as the controller's own install, each still matching its manifest. */
  controller: number;
  /** Files the session wrote under /work after its start marker, vendored folders left out; scanned beside files. */
  work: string[];
}

export type AuditResult =
  | { ok: true; evidence: AuditEvidence }
  | { ok: false; kind: "breach" | "uncollected"; reasons: string[]; evidence: Partial<AuditEvidence> };

/** The marker the job touches right before its agent starts; files under /work newer than it are the session's. */
export const SESSION_MARK = AUDIT_DIR + "/session-start";
/** BT (the Captain's ruling on open item 2.26): the dependency folders whose files the /work scan leaves out as vendored. */
export const VENDORED_DIRS: readonly string[] = ["node_modules", "bower_components", "vendor", ".venv", "venv", "site-packages", "dist-packages", ".pnpm-store", ".yarn"];
export const WORK_DONE = "DC-WORK-DONE";

export const AUDIT_COMMANDS = {
  ruleset: "nft list chain inet dc out",
  processes: "ps -eo pid=,user=,args= && echo DC-PS-DONE",
  egress: "echo " + END_MARK + " > /dev/kmsg && journalctl --sync && journalctl -k -o cat --no-pager",
  files:
    "touch " + AUDIT_DIR + "/end && find / -xdev \\( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /work \\) -prune -o -newer " + AUDIT_DIR + "/start -printf '%p\\t%s\\t%m\\t%TY-%Tm-%TdT%TT\\t%y\\n' && echo DC-FIND-DONE",
  controller: describeCommand(AUDIT_DIR + "/controller.now"),
  work:
    "if [ -e " + SESSION_MARK + " ]; then find /work \\( " + VENDORED_DIRS.map((d) => "-name '" + d + "'").join(" -o ") + " \\) -prune -o -type f -newer " + SESSION_MARK + " -print0; fi && printf '\\n" + WORK_DONE + "\\n'",
  scan:
    "while IFS= read -r -d '' f; do grep -qIE -f " + AUDIT_DIR + "/patterns -- \"$f\"; s=$?; if [ $s -eq 0 ]; then printf 'HIT\\t%s\\n' \"$f\"; elif [ $s -gt 1 ]; then printf 'ERR\\t%s\\n' \"$f\"; fi; done < " + AUDIT_DIR + "/scan.list; echo DC-SCAN-DONE",
} as const;

/** Reads the egress filter's listing: the accepted endpoints must be exactly the allowed ones, and the policy drop. */
export function parseRuleset(text: string, spec: VmSpec): string[] {
  const out: string[] = [];
  if (!/policy drop;/.test(text)) out.push("the egress filter's policy is not drop");
  const accepts = text.split("\n").map((l) => l.trim()).filter((l) => /\baccept$/.test(l));
  const seen: Connection[] = [];
  for (const l of accepts) {
    if (/^oif "lo" accept$/.test(l) || /^ct state (established,related|related,established) accept$/.test(l)) continue;
    const m = /^ip daddr (\S+) tcp dport (\d+) ct state new log prefix "DCNET " accept$/.exec(l);
    if (!m) {
      out.push("the egress filter has a rule it did not set: " + l);
      continue;
    }
    seen.push({ host: m[1]!, port: Number(m[2]) });
  }
  const key = (c: Connection) => c.host + ":" + c.port;
  const want = allowed(spec).map(key).sort().join(",");
  if (seen.map(key).sort().join(",") !== want) out.push("the egress filter accepts " + (seen.map(key).join(", ") || "nothing") + ", not exactly " + want);
  if (!/log prefix "DCDROP " drop/.test(text)) out.push("the egress filter's logged drop is missing");
  return out;
}

/** Reads ps's rows. Null when a row is malformed or the done line is missing: the list was cut. */
export function parseProcesses(text: string): ProcessRow[] | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.pop() !== "DC-PS-DONE") return null;
  const rows: ProcessRow[] = [];
  for (const l of lines) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(l);
    if (!m) return null;
    rows.push({ pid: Number(m[1]), user: m[2]!, args: m[3]! });
  }
  return rows;
}

/** Reads the kernel log's filter lines. Null when either marker is missing: the log was cut or never collected. */
export function parseEgress(text: string): { egress: Connection[]; blocked: Connection[] } | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.includes(START_MARK));
  const end = lines.findIndex((l, i) => i > start && l.includes(END_MARK));
  if (start < 0 || end < 0) return null;
  const egress: Connection[] = [];
  const blocked: Connection[] = [];
  for (const l of lines.slice(start + 1, end)) {
    const m = /DST=(\S+).*?DPT=(\d+)/.exec(l);
    if (l.includes(NET_PREFIX) && m) egress.push({ host: m[1]!, port: Number(m[2]) });
    else if (l.includes(DROP_PREFIX) && m) blocked.push({ host: m[1]!, port: Number(m[2]) });
    else if (l.includes(NET_PREFIX) || l.includes(DROP_PREFIX)) return null;
  }
  return { egress, blocked };
}

/** Reads find's rows. Null when a row is malformed or the end marker is missing: the list was cut or never collected. */
export function parseFiles(text: string): StatEntry[] | null {
  const lines = text.split("\n").filter(Boolean);
  if (lines.pop() !== "DC-FIND-DONE") return null;
  const rows: StatEntry[] = [];
  for (const l of lines) {
    const p = l.split("\t");
    if (p.length !== 5 || !p[0]!.startsWith("/") || !/^\d+$/.test(p[1]!) || !/^[0-7]+$/.test(p[2]!)) return null;
    rows.push({ path: p[0]!, size: Number(p[1]), mode: parseInt(p[2]!, 8), mtime: p[3]!, type: p[4]! });
  }
  if (!rows.some((r) => r.path === AUDIT_DIR + "/end")) return null;
  return rows;
}

/** Reads the /work list: NUL-separated paths under /work, then the done line. Null when the done line is missing. */
export function parseWork(text: string): string[] | null {
  const end = "\n" + WORK_DONE + "\n";
  if (!text.endsWith(end)) return null;
  const paths = text.slice(0, -end.length).split("\0").filter(Boolean);
  return paths.every((p) => p.startsWith("/work/")) ? paths : null;
}

export function parseScan(text: string): { hits: string[]; errors: string[] } | null {
  const lines = text.split("\n").filter(Boolean);
  if (lines.at(-1) !== "DC-SCAN-DONE") return null;
  const hits: string[] = [];
  const errors: string[] = [];
  for (const l of lines.slice(0, -1)) {
    const [tag, ...rest] = l.split("\t");
    if (tag === "HIT") hits.push(rest.join("\t"));
    else if (tag === "ERR") errors.push(rest.join("\t"));
    else return null;
  }
  return { hits, errors };
}

/**
 * The audit after a run, through the backend's own commands. Collection comes first and fails closed: a command that
 * exits non-zero or returns empty or cut output ends the audit as uncollected. Then the evidence is checked: the egress
 * filter as set, egress to exactly the proxy and the named mirrors, and no key pattern or drive path in a process's
 * arguments or in a written file. Extra paths (a recipe.json, say) are scanned beside the written files.
 */
export async function audit(backend: VmBackend, vm: Vm, o: { scanExtra?: readonly string[]; controller?: readonly ControllerEntry[] } = {}): Promise<AuditResult> {
  const spec = vm.spec;
  const evidence: Partial<AuditEvidence> = {};
  const uncollected = (why: string): AuditResult => ({ ok: false, kind: "uncollected", reasons: [why], evidence });
  const run = async (name: keyof typeof AUDIT_COMMANDS): Promise<ExecResult | string> => {
    let r: ExecResult;
    try {
      r = await backend.exec(vm, AUDIT_COMMANDS[name], { user: "root" });
    } catch (e) {
      return "the " + name + " command failed to run: " + (e as Error).message;
    }
    if (r.exit !== 0) return "the " + name + " command exited " + r.exit;
    if (!r.stdout.trim()) return "the " + name + " command returned nothing";
    return r;
  };

  const rules = await run("ruleset");
  if (typeof rules === "string") return uncollected(rules);
  const ps = await run("processes");
  if (typeof ps === "string") return uncollected(ps);
  const processes = parseProcesses(ps.stdout);
  if (!processes || !processes.some((p) => p.pid === 1)) return uncollected("the process list is cut or holds no pid 1");
  evidence.processes = processes;
  const net = await run("egress");
  if (typeof net === "string") return uncollected(net);
  const egress = parseEgress(net.stdout);
  if (!egress) return uncollected("the egress log is cut: a start or end marker is missing");
  evidence.egress = egress.egress;
  evidence.blocked = egress.blocked;
  const fl = await run("files");
  if (typeof fl === "string") return uncollected(fl);
  const files = parseFiles(fl.stdout);
  if (!files) return uncollected("the written-file list is cut or empty");
  const written = files.filter((f) => !f.path.startsWith(AUDIT_DIR + "/"));
  let own = new Set<string>();
  const manifest = o.controller ?? [];
  if (manifest.length) {
    const mine = new Set(manifest.map((m) => m.path));
    const listed = written.filter((f) => mine.has(f.path)).map((f) => f.path);
    if (listed.length) {
      try {
        await backend.write(vm, AUDIT_DIR + "/controller.now", listed.map((p) => p + "\0").join(""));
      } catch (e) {
        return uncollected("could not write the controller's file list: " + (e as Error).message);
      }
      const cr = await run("controller");
      if (typeof cr === "string") return uncollected(cr);
      const now = parseDescribe(cr.stdout);
      if (!now || now.length !== listed.length) return uncollected("the controller's file check is cut");
      own = controllerOwned(manifest, now);
    }
  }
  evidence.controller = own.size;
  evidence.files = written.filter((f) => !own.has(f.path));
  const wk = await run("work");
  if (typeof wk === "string") return uncollected(wk);
  const work = parseWork(wk.stdout);
  if (!work) return uncollected("the /work list is cut");
  evidence.work = work;
  const scanList = [...new Set([...evidence.files.filter((f) => f.type === "f").map((f) => f.path), ...work, ...(o.scanExtra ?? [])])];
  try {
    await backend.write(vm, AUDIT_DIR + "/patterns", [...KEY_PATTERNS, ...DRIVE_PATTERNS].join("\n") + "\n");
    await backend.write(vm, AUDIT_DIR + "/scan.list", scanList.map((p) => p + "\0").join(""));
  } catch (e) {
    return uncollected("could not write the scan inputs: " + (e as Error).message);
  }
  const sc = await run("scan");
  if (typeof sc === "string") return uncollected(sc);
  const scan = parseScan(sc.stdout);
  if (!scan) return uncollected("the file scan is cut");
  if (scan.errors.length) return uncollected("the file scan could not read " + scan.errors.join(", "));
  evidence.hits = scan.hits;

  const reasons = parseRuleset(rules.stdout, spec);
  const ok = new Set(allowed(spec).map((e) => e.host + ":" + e.port));
  for (const c of egress.egress) if (!ok.has(c.host + ":" + c.port)) reasons.push("egress to " + c.host + ":" + c.port + ", which is not the proxy or a named mirror");
  for (const p of processes) {
    const hit = secretHit(p.args);
    if (hit) reasons.push("a " + hit + " in the arguments of pid " + p.pid);
  }
  for (const h of scan.hits) reasons.push("a key pattern or drive path in " + h);
  return reasons.length ? { ok: false, kind: "breach", reasons, evidence } : { ok: true, evidence: evidence as AuditEvidence };
}

/** One sandbox's dropped connections, printed per sandbox (the Captain's ruling on open item X). */
export interface SandboxTally {
  label: string;
  blocked: number;
}

export const sandboxLine = (t: SandboxTally) => "sandbox " + t.label + ": " + t.blocked + " blocked connection" + (t.blocked === 1 ? "" : "s");

export interface SandboxRun<T> {
  value: T | null;
  /** New connections the egress filter dropped in this VM, from the audit's log (0 when the log was never read). */
  blocked: number;
  /** A preamble step or the job failed before it returned: a failure outside the agent. */
  error: string | null;
  audit: AuditResult;
  /** The VM could not be deleted; the runner's reaper deletes it past its time to live. */
  destroyError: string | null;
}

export interface SandboxDeps {
  backend: VmBackend;
  hosts: HostsSeam;
  /** Epoch milliseconds, for measured VM hours. */
  now: () => number;
}

/**
 * Runs job in a fresh VM: admit its time to live on dc-hosts, create, preamble, job, audit, delete, always, then settle
 * the VM at its measured hours. A preamble step that fails ends the run before the job; the audit still runs. A refused
 * dc-hosts admission throws CapStopSignal before any VM exists. A cap stop or a lane error inside the job is rethrown
 * after the audit, unless the audit failed, which the caller stops on first. A failure outside the agent (a thrown
 * E_DC_INFRA_MISSING or any other error) becomes the run's error. scanExtra names files beside the written ones for the
 * audit's scan, fixed or read from the job's value.
 */
export async function sandboxed<T>(d: SandboxDeps, spec: VmSpec, job: (vm: Vm) => Promise<T>, o: { scanExtra?: readonly string[] | ((value: T | null) => readonly string[]) } = {}): Promise<SandboxRun<T>> {
  const problems = specProblems(spec);
  if (problems.length) fail("E_USAGE", "the sandbox spec can't run: " + problems.join("; "));
  const lease = await d.hosts.admit({ run: spec.label, hours: spec.ttlMinutes / 60 });
  if (!lease.ok) throw new CapStopSignal("dc-hosts", lease.why);
  const started = d.now();
  let vm: Vm;
  try {
    vm = await d.backend.create(spec);
  } catch (e) {
    await d.hosts.settle(lease.id, (d.now() - started) / 3_600_000);
    return { value: null, blocked: 0, error: "the VM did not start: " + (e as Error).message, audit: { ok: false, kind: "uncollected", reasons: ["no VM"], evidence: {} }, destroyError: null };
  }
  let value: T | null = null;
  let error: string | null = null;
  let result: AuditResult = { ok: false, kind: "uncollected", reasons: ["the audit did not run"], evidence: {} };
  let destroyError: string | null = null;
  let rethrow: unknown = null;
  try {
    for (const step of preamble(spec)) {
      let r: ExecResult;
      try {
        r = await d.backend.exec(vm, step, { user: "root" });
      } catch (e) {
        r = { exit: -1, stdout: "", stderr: (e as Error).message };
      }
      if (r.exit !== 0) {
        error = "preamble step failed (exit " + r.exit + "): " + step;
        break;
      }
    }
    let controller: ControllerEntry[] = [];
    if (error === null && d.backend.prepare) {
      try {
        controller = await d.backend.prepare(vm);
      } catch (e) {
        error = "the controller's install failed: " + (e as Error).message;
      }
    }
    if (error === null) {
      try {
        value = await job(vm);
      } catch (e) {
        if (e instanceof CapStopSignal || (e instanceof DcError && e.code !== "E_DC_INFRA_MISSING")) rethrow = e;
        error = (e as Error).message;
      }
    }
    result = await audit(d.backend, vm, { scanExtra: typeof o.scanExtra === "function" ? o.scanExtra(value) : o.scanExtra, controller });
  } finally {
    try {
      await d.backend.destroy(vm);
    } catch (e) {
      destroyError = (e as Error).message;
    }
    await d.hosts.settle(lease.id, (d.now() - started) / 3_600_000);
  }
  if (rethrow && result.ok) throw rethrow;
  return { value, blocked: result.evidence.blocked?.length ?? 0, error, audit: result, destroyError };
}

export interface UbicloudOptions {
  project: string;
  location: string;
  /** The Ubicloud token, passed in by the paid run's launcher; this module never reads it from the environment. */
  token: string;
  size: string;
  image: string;
  publicKey: string;
  fetch: typeof fetch;
  /** Runs a command over SSH as root or the run user on the VM's address; input feeds stdin. */
  ssh: (host: string, command: string, o: ExecOptions & { input?: Uint8Array }) => Promise<ExecResult & { raw?: Uint8Array }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** A private subnet every VM joins, so sandboxes reach the controller host's proxy and mirrors on its private IPv4. */
  privateSubnet?: string;
}

/**
 * The Ubicloud backend for paid runs. It names each VM for its owner and its expiry minute, so the runner's reaper can
 * delete it past its time to live, and deletes the VM in destroy. Every SSH result's exit is the caller's to check;
 * write and read check their own.
 */
export class UbicloudBackend implements VmBackend {
  private readonly hosts = new Map<string, string>();
  private readonly privates = new Map<string, string>();
  constructor(private readonly o: UbicloudOptions) {
    if (!o.token) fail("E_USAGE", "the Ubicloud backend needs a token from the paid run's launcher");
  }
  private async api(method: string, name: string, body?: unknown): Promise<any> {
    const url = "https://api.ubicloud.com/project/" + this.o.project + "/location/" + this.o.location + "/vm/" + name;
    const res = await this.o.fetch(url, { method, headers: { authorization: "Bearer " + this.o.token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok && res.status !== 404) fail("E_DC_INFRA_MISSING", "Ubicloud " + method + " " + name + " returned " + res.status);
    return res.status === 204 || res.status === 404 ? null : res.json();
  }
  async create(spec: VmSpec, o: { prefix?: string; size?: string } = {}): Promise<Vm> {
    if (!spec.owner) fail("E_USAGE", "UBI_OWNER is not set");
    const expires = Math.floor(this.o.now() / 60_000) + spec.ttlMinutes;
    const name = ((o.prefix ?? "dc") + "-" + spec.owner + "-" + expires + "-" + crypto.randomUUID().slice(0, 8)).toLowerCase();
    try {
      await this.api("POST", name, { public_key: this.o.publicKey, size: o.size ?? this.o.size, boot_image: this.o.image, enable_ip4: true, ...(this.o.privateSubnet ? { private_subnet_id: this.o.privateSubnet } : {}) });
      for (let i = 0; i < 120; i++) {
        const v = await this.api("GET", name);
        if (v?.state === "running" && v.ip4) {
          this.hosts.set(name, v.ip4);
          if (v.private_ipv4) this.privates.set(name, String(v.private_ipv4).replace(/\/\d+$/, ""));
          return { id: name, spec };
        }
        await this.o.sleep(5_000);
      }
    } catch (e) {
      await this.api("DELETE", name).catch(() => {});
      throw e;
    }
    await this.api("DELETE", name);
    return fail("E_DC_INFRA_MISSING", "Ubicloud VM " + name + " did not start");
  }
  /** Attaches to a VM an earlier launch made: its handle when it is running, else null (gone or not running). */
  async attach(name: string, spec: VmSpec): Promise<Vm | null> {
    const v = await this.api("GET", name);
    if (v?.state !== "running" || !v.ip4) return null;
    this.hosts.set(name, v.ip4);
    if (v.private_ipv4) this.privates.set(name, String(v.private_ipv4).replace(/\/\d+$/, ""));
    return { id: name, spec };
  }
  /** Whether Ubicloud still holds the VM, in any state. */
  async exists(name: string): Promise<boolean> {
    return (await this.api("GET", name)) !== null;
  }
  /** The VM's public IPv4, for an SSH tunnel. */
  address(vm: Vm): string {
    return this.host(vm);
  }
  /** The VM's private IPv4 on the run's subnet, or null when Ubicloud reported none. */
  privateAddress(vm: Vm): string | null {
    return this.privates.get(vm.id) ?? null;
  }
  private host(vm: Vm) {
    const h = this.hosts.get(vm.id);
    if (!h) fail("E_INTERNAL", "unknown VM " + vm.id);
    return h!;
  }
  exec(vm: Vm, command: string, o: ExecOptions = {}): Promise<ExecResult> {
    return this.o.ssh(this.host(vm), command, o);
  }
  async write(vm: Vm, path: string, data: Uint8Array | string) {
    const r = await this.o.ssh(this.host(vm), "cat > " + q(path), { user: "root", input: typeof data === "string" ? new TextEncoder().encode(data) : data });
    if (r.exit !== 0) fail("E_DC_INFRA_MISSING", "could not write " + path + " on " + vm.id + " (exit " + r.exit + ")");
  }
  async read(vm: Vm, path: string) {
    const r = await this.o.ssh(this.host(vm), "cat " + q(path), { user: "root" });
    if (r.exit !== 0) fail("E_DC_INFRA_MISSING", "could not read " + path + " on " + vm.id + " (exit " + r.exit + ")");
    return r.raw ?? new TextEncoder().encode(r.stdout);
  }
  async destroy(vm: Vm) {
    await this.api("DELETE", vm.id);
    this.hosts.delete(vm.id);
    this.privates.delete(vm.id);
  }
}
