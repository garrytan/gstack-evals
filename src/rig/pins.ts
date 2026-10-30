// Unpinned installs under docker/ (CI plan v5, U20). An image the rig builds must come from the bytes the recipe hash
// covers, so every install names them: a FROM by @sha256 digest, an ADD from a URL with --checksum, a package install at
// exact versions or from a frozen lockfile, a download checked with sha256sum, a clone checked out at a full commit sha, and
// nothing piped from the network into a shell.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { RIG_ROOT } from "./recipe.ts";

export interface PinFinding {
  file: string;
  line: number;
  why: string;
}

/** The Dockerfile's instructions with continuation lines joined, each with the line it starts on. */
function instructions(text: string): { line: number; op: string; args: string }[] {
  const out: { line: number; op: string; args: string }[] = [];
  let start = 0;
  let buf = "";
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#/.test(line) || (!buf && !line.trim())) return;
    if (!buf) start = i + 1;
    const more = /\\\s*$/.test(line);
    buf += (buf ? " " : "") + line.replace(/\\\s*$/, "").trim();
    if (more) return;
    const m = /^([A-Za-z]+)\s*(.*)$/.exec(buf);
    if (m) out.push({ line: start, op: m[1]!.toUpperCase(), args: m[2]! });
    buf = "";
  });
  return out;
}

const VERSIONED = /^(@[^/@\s]+\/)?[^@\s]+@\d[\w.+-]*$/;
const args = (rest: string) => rest.split(/\s+/).filter((w) => w && !w.startsWith("-"));

/** What in one RUN instruction installs bytes the recipe does not pin. */
function runFindings(cmd: string): string[] {
  const why: string[] = [];
  if (/\b(curl|wget)\b[^;&|]*\|\s*(sudo\s+)?(ba|da|z)?sh\b/.test(cmd)) why.push("pipes a download into a shell");
  else if (/\b(curl|wget)\b/.test(cmd) && /\s(-o|-O|--output|--remote-name|--output-document)(\s|=|$)/.test(" " + cmd) && !/\bsha(256|512)sum\b[^;&|]*(\s-c\b|--check)/.test(cmd)) why.push("downloads a file without checking its sha256");
  if (/\bgit\s+clone\b/.test(cmd) && !/\b(checkout|reset\s+--hard|switch\s+--detach)\s+[0-9a-f]{40}\b/.test(cmd)) why.push("clones a repository without checking out a full commit sha");
  for (const seg of cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).map((s) => s.trim().replace(/^sudo\s+/, ""))) {
    let m: RegExpExecArray | null;
    const loose = (what: string, items: string[]) => items.length && why.push(what + ": " + items.join(" "));
    if ((m = /^(?:apt-get|apt)\s+(?:-\S+\s+)*install\b(.*)$/.exec(seg))) loose("installs apt packages without an exact version", args(m[1]!).filter((p) => !p.includes("=")));
    else if ((m = /^apk\s+add\b(.*)$/.exec(seg))) loose("installs apk packages without an exact version", args(m[1]!).filter((p) => !p.includes("=")));
    else if ((m = /^(?:npm|pnpm)\s+(?:install|i|add)\b(.*)$/.exec(seg)) || (m = /^yarn\s+(?:global\s+)?add\b(.*)$/.exec(seg))) {
      const pkgs = args(m[1]!);
      if (!pkgs.length) why.push("runs an npm install that can move its lockfile; use npm ci");
      loose("installs packages without an exact version", pkgs.filter((p) => !VERSIONED.test(p)));
    } else if ((m = /^bun\s+install\b(.*)$/.exec(seg)) && !/--frozen-lockfile\b/.test(m[1]!)) why.push("runs bun install without --frozen-lockfile");
    else if ((m = /^bun\s+(?:add|a)\b(.*)$/.exec(seg))) loose("adds packages without an exact version", args(m[1]!).filter((p) => !VERSIONED.test(p)));
    else if ((m = /^(?:bunx|npx)\s+(.*)$/.exec(seg)) && args(m[1]!)[0] && !VERSIONED.test(args(m[1]!)[0]!)) why.push("runs " + args(m[1]!)[0] + " without an exact version");
    else if ((m = /^(?:python3?\s+-m\s+)?pip3?\s+install\b(.*)$/.exec(seg))) {
      if (/(^|\s)(-r|--requirement)\b/.test(m[1]!)) {
        if (!/--require-hashes\b/.test(m[1]!)) why.push("installs a requirements file without --require-hashes");
      } else loose("installs pip packages without an exact version", args(m[1]!).filter((p) => !p.includes("==")));
    } else if ((m = /^go\s+install\b(.*)$/.exec(seg))) loose("go-installs without an exact version", args(m[1]!).filter((p) => !/@v\d/.test(p)));
    else if ((m = /^cargo\s+install\b(.*)$/.exec(seg)) && !(/--locked\b/.test(m[1]!) && /(--version\b|@\d)/.test(m[1]!))) why.push("cargo-installs without --locked and an exact version");
  }
  return why;
}

/** What in a Dockerfile installs bytes the recipe does not pin. A FROM naming an earlier stage is internal. */
export function unpinnedInstalls(file: string, text: string): PinFinding[] {
  const findings: PinFinding[] = [];
  const stages = new Set<string>();
  for (const ins of instructions(text)) {
    const add = (why: string) => findings.push({ file, line: ins.line, why });
    if (ins.op === "FROM") {
      const m = /^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(ins.args);
      const image = m?.[1] ?? ins.args;
      if (!stages.has(image.toLowerCase()) && !/@sha256:[0-9a-f]{64}$/.test(image)) add("FROM " + image + " is not pinned by @sha256 digest");
      if (m?.[2]) stages.add(m[2].toLowerCase());
    } else if (ins.op === "ADD" && /(^|\s)(https?:\/\/|git@)/.test(ins.args) && !/--checksum=sha256:[0-9a-f]{64}(\s|$)/.test(ins.args)) add("ADD from a URL without --checksum=sha256:<digest>");
    else if (ins.op === "RUN") for (const why of runFindings(ins.args)) add(why);
  }
  return findings;
}

/** Every Dockerfile under docker/, repo-relative. */
export function dockerfiles(root: string = RIG_ROOT): string[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  return walk(join(root, "docker")).filter((f) => /(^Dockerfile(\..+)?$|\.Dockerfile$)/i.test(basename(f))).map((f) => relative(root, f)).sort();
}

export const dockerDirFindings = (root: string = RIG_ROOT): PinFinding[] => dockerfiles(root).flatMap((f) => unpinnedInstalls(f, readFileSync(join(root, f), "utf8")));
