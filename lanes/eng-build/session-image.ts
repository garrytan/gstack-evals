// Copyright (c) 2026 Garry Tan. MIT License.
// The build stage's session image (prereg 2026-11-11-geva-522 section 4, build stage). real_agent runs Claude Code with
// docker exec inside the session container, so the session image is the unit's graded image with a runtime layer on top,
// the way family SM's runtime layer sits on its unit image (lanes/outcome-skills/images/manifest.ts withRuntime): Claude
// Code at the review stage's pin in /usr/local/bin, and Node at /opt/laneb/bin for the gh stub and the egress probe, at
// the end of PATH so the unit's own toolchains win. The Claude Code pin is read from where the review stage keeps it
// (docker/host-cli.json and the checksum line in docker/trial.Dockerfile), so the two stages cannot drift apart. The
// layer adds no gstack, no drive and no skills folder; the clean-room preflight scans the session image before any lease.
// The build tree is a bind mount the host user owns, and real_agent runs git and Claude Code as root, so the image marks
// /work/repo a safe directory for git; the launcher hands the tree back to the host user after the session.
// The graded image never changes: the session image is a new tag whose root filesystem starts with every layer of the
// unit image, which sessionImage checks, and the grader keeps reading the unit image by id.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_DIR as TESTBED } from "../real-outcome/task/format.ts";
import { REPO_DIR } from "./build-stage.ts";
import { fail } from "./errors.ts";

const ROOT = join(import.meta.dir, "../..");
export const SESSION_REPO = "gstack-evals-eb-session";
export const SESSION_LABEL = "gstack-evals.eb=session";
/** Node for the gh stub and real_agent's egress probe, pinned by digest (node:24-bookworm-slim, Node 24.22.2). */
export const NODE_IMAGE = "node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9";

/** Where the session image lists the dependencies it copied from the unit image's project to the build tree's path, one
 * per line as "d <path>" (a folder) or "f <path>" (a file), relative to the project root. */
export const DEPS_FILE = "/opt/eb/deps";

/**
 * The session layer's dependency step, run as root at image build. It copies from the unit image's project (T) to the
 * build tree's path (R) every in-project dependency the base commit does not track: node_modules folders, Yarn PnP's
 * .pnp.cjs and .pnp.loader.mjs, and .yarn (or, when .yarn holds tracked files such as a committed release, each of its
 * untracked children, such as cache, unplugged and install-state.gz). Then it points every editable Python install
 * at R: each __editable__ finder, .pth and .egg-link file in a site-packages or dist-packages folder that names T gets
 * T's paths rewritten to R, so a builder imports its own edits at /work/repo. EB_T, EB_R, EB_D and EB_SITE override the
 * paths for the keyless test.
 */
export const DEPS_SCRIPT = [
  "set -e",
  'T="${EB_T:-' + TESTBED + '}"; R="${EB_R:-' + REPO_DIR + '}"; D="${EB_D:-/opt/eb}"; SITE="${EB_SITE:-/}"',
  'mkdir -p "$D"; : > "$D/deps"; : > "$D/editable"',
  '[ -d "$T" ] || exit 0',
  "untracked() { [ -z \"$(git -C \"$T\" -c safe.directory='*' ls-files -- \":(literal)$1\" | head -n 1)\" ]; }",
  'take() { mkdir -p "$R/$(dirname "$1")"; cp -a "$T/$1" "$R/$1"; if [ -d "$T/$1" ]; then echo "d $1" >> "$D/deps"; else echo "f $1" >> "$D/deps"; fi; }',
  'cd "$T"',
  "find . -path ./.git -prune -o -type d \\( -name node_modules -o -name .yarn \\) -prune -print -o -type f \\( -name .pnp.cjs -o -name .pnp.loader.mjs \\) -print | sed 's|^\\./||' | LC_ALL=C sort > \"$D/found\"",
  'while IFS= read -r p; do',
  '  if untracked "$p"; then take "$p"',
  '  elif [ "$(basename "$p")" = .yarn ]; then',
  '    for c in "$p"/* "$p"/.[!.]*; do if [ -e "$c" ] && untracked "$c"; then take "$c"; fi; done',
  "  fi",
  'done < "$D/found"',
  'rm -f "$D/found"',
  "find \"$SITE\" -xdev \\( -path /proc -o -path /sys -o -path /dev -o -path \"$T\" -o -path \"$R\" \\) -prune -o -type f \\( -name '__editable__*' -o -name '*.pth' -o -name '*.egg-link' \\) -path '*-packages/*' -print | LC_ALL=C sort > \"$D/site\"",
  'while IFS= read -r f; do',
  '  if grep -qF "$T" "$f"; then sed -i -e "s#$T\\([^A-Za-z0-9_.-]\\)#$R\\1#g" -e "s#$T\\$#$R#" "$f"; echo "$f" >> "$D/editable"; fi',
  'done < "$D/site"',
  'rm -f "$D/site"',
  "",
].join("\n");

export interface ClaudePin {
  version: string;
  /** The checksum-pinned ADD line for the Claude Code tarball, as docker/trial.Dockerfile has it. */
  add: string;
}

/** The review stage's Claude Code pin: the version docker/host-cli.json names and the ADD line for that version's tarball in docker/trial.Dockerfile. */
export function claudePin(root: string = ROOT): ClaudePin {
  const version = (JSON.parse(readFileSync(join(root, "docker/host-cli.json"), "utf8")) as { claude?: string }).claude ?? "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail("E_USAGE", "docker/host-cli.json pins no Claude Code version");
  const add = readFileSync(join(root, "docker/trial.Dockerfile"), "utf8").split("\n").find((l) => /^ADD --checksum=sha256:[0-9a-f]{64} https:\/\/registry\.npmjs\.org\/@anthropic-ai\/claude-code-linux-x64\//.test(l));
  if (!add || !add.includes("/claude-code-linux-x64-" + version + ".tgz ")) fail("E_USAGE", "docker/trial.Dockerfile has no checksum-pinned Claude Code " + version + " tarball line");
  return { version, add: add! };
}

/** The session image's Dockerfile on base, a local tag for the unit image's id. */
export function sessionDockerfile(base: string, pin: ClaudePin = claudePin()): string {
  return [
    "# Generated by gstack-evals eb (lanes/eng-build/session-image.ts). Do not edit.",
    "FROM " + NODE_IMAGE + " AS eb-node",
    "FROM " + base,
    "COPY --from=eb-node /usr/local/bin/node /opt/laneb/bin/node",
    pin.add.replace(/ \S+$/, " /tmp/claude-code.tgz"),
    "RUN tar -xzf /tmp/claude-code.tgz -C /tmp package/claude && install -m 0755 /tmp/package/claude /usr/local/bin/claude && rm -rf /tmp/claude-code.tgz /tmp/package \\",
    " && mkdir -p /logs/artifacts && git config --system --add safe.directory " + REPO_DIR + " && /usr/local/bin/claude --version && /opt/laneb/bin/node --version",
    "RUN echo " + Buffer.from(DEPS_SCRIPT).toString("base64") + " | base64 -d | sh",
    "ENV PATH=$PATH:/opt/laneb/bin CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1",
    "",
  ].join("\n");
}

export interface SessionImage {
  tag: string;
  id: string;
  /** The unit image the session image sits on, by id. */
  base: string;
  claude: string;
  /** In-project dependencies (node_modules, Yarn PnP's files and .yarn) the base commit does not track, copied from the
   * unit image's project to the same paths under the build tree, relative to it. The launcher mounts each folder as a
   * volume over the bind mounted tree, so the session sees the installed dependencies with no network, and the patch
   * leaves every entry out. */
  deps: string[];
  /** The entries of deps that are files (Yarn PnP's .pnp.cjs, for one). A volume can only hold a folder, so the launcher
   * copies these into the tree instead and removes them after the session. */
  depFiles: string[];
}

const DEP_PATH = /^([^/\0]+\/)*(node_modules|\.pnp\.cjs|\.pnp\.loader\.mjs|\.yarn(\/[^/\0]+)?)$/;

const docker = (bin: string, args: string[], timeout = 120_000) => spawnSync(bin, args, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
const layers = (bin: string, image: string): string[] => JSON.parse(docker(bin, ["image", "inspect", "--format", "{{json .RootFS.Layers}}", image]).stdout || "[]") as string[];

/**
 * Builds (or reuses) the session image for a unit image id, tagged by a digest of that id and the Dockerfile. Refuses
 * unless the result's root filesystem starts with every unit image layer and adds its own, the unit image's layers are
 * unchanged, and claude --version prints the pinned version with no network.
 */
export function sessionImage(unitImage: string, o: { docker?: string } = {}): SessionImage {
  const bin = o.docker ?? "docker";
  if (!/^sha256:[0-9a-f]{64}$/.test(unitImage)) fail("E_USAGE", "the unit image id " + JSON.stringify(unitImage) + " is not sha256:<64 hex>");
  const pin = claudePin();
  const base = "gstack-evals-eb-base:" + unitImage.slice(7, 31);
  const text = sessionDockerfile(base, pin);
  const tag = SESSION_REPO + ":" + createHash("sha256").update(unitImage + "\0" + text).digest("hex").slice(0, 24);
  const before = layers(bin, unitImage);
  if (!before.length) fail("E_USAGE", "the unit image " + unitImage + " is not on this host");
  if (docker(bin, ["image", "inspect", tag]).status !== 0) {
    const t = docker(bin, ["tag", unitImage, base]);
    if (t.status !== 0) fail("E_USAGE", "docker tag " + unitImage + " failed: " + t.stderr.trim().slice(-300));
    const ctx = mkdtempSync(join(tmpdir(), "eb-session-"));
    try {
      writeFileSync(join(ctx, "Dockerfile"), text);
      const b = docker(bin, ["build", "-q", "--label", SESSION_LABEL, "--label", "gstack-evals.eb.base=" + unitImage, "-t", tag, ctx], 1_800_000);
      if (b.status !== 0) fail("E_USAGE", "the session image on " + unitImage + " did not build: " + b.stderr.trim().slice(-600));
    } finally {
      rmSync(ctx, { recursive: true, force: true });
      const tags = JSON.parse(docker(bin, ["image", "inspect", "--format", "{{json .RepoTags}}", unitImage]).stdout || "[]") as string[];
      if (tags.some((x) => x !== base)) docker(bin, ["rmi", "--no-prune", base]);
    }
  }
  const id = docker(bin, ["image", "inspect", "--format", "{{.Id}}", tag]).stdout.trim();
  const after = layers(bin, tag);
  if (layers(bin, unitImage).join() !== before.join() || before.some((l, i) => after[i] !== l) || after.length <= before.length) fail("E_USAGE", "the session image " + tag + " does not sit on every layer of the unit image " + unitImage);
  const v = docker(bin, ["run", "--rm", "--network", "none", "--entrypoint", "claude", id, "--version"], 60_000);
  const claude = v.stdout.trim().split(" ")[0] ?? "";
  if (v.status !== 0 || claude !== pin.version) fail("E_USAGE", "claude --version in " + tag + " prints " + JSON.stringify(v.stdout.trim() || v.stderr.trim().slice(-200)) + ", not " + pin.version);
  const d = docker(bin, ["run", "--rm", "--network", "none", "--entrypoint", "cat", id, DEPS_FILE], 60_000);
  const rows = d.stdout.split("\n").filter(Boolean).map((l) => ({ kind: l.slice(0, 2), path: l.slice(2) }));
  if (d.status !== 0 || rows.some((r) => (r.kind !== "d " && r.kind !== "f ") || !DEP_PATH.test(r.path) || r.path.split("/").some((s) => s === ".." || s === "."))) fail("E_USAGE", "the session image " + tag + " lists no readable dependencies in " + DEPS_FILE + ": " + JSON.stringify(d.stdout.slice(0, 300) || d.stderr.trim().slice(-200)));
  const deps = rows.map((r) => r.path);
  const depFiles = rows.filter((r) => r.kind === "f ").map((r) => r.path);
  return { tag, id, base: unitImage, claude, deps, depFiles };
}

/** Removes every session image this lane built, by label; the unit images stay. Returns how many it removed. */
export function removeSessionImages(o: { docker?: string } = {}): number {
  const bin = o.docker ?? "docker";
  const ids = [...new Set(docker(bin, ["images", "-q", "--filter", "label=" + SESSION_LABEL]).stdout.split("\n").filter(Boolean))];
  if (ids.length) docker(bin, ["rmi", "-f", "--no-prune", ...ids]);
  return ids.length;
}
