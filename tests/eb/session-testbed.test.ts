// Copyright (c) 2026 Garry Tan. MIT License.
// The session image's /testbed cleanup (dated pre-run change, 2026-11-17). The session image sits on the unit image, whose
// /testbed is a copy of B with its .git, so a session could read a stripped name or its object there. For a unit image
// whose /testbed keeps one, the session layer deletes /testbed/.git and every stripped name under /testbed; every other
// unit's Dockerfile stays as it was.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLEAN_SCRIPT, claudePin, DEPS_SCRIPT, PROBE_SCRIPT, sessionDockerfile, sessionImage } from "../../lanes/eng-build/session-image.ts";

const root = mkdtempSync(join(tmpdir(), "eb-testbed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sh = (script: string, T: string) => spawnSync("sh", ["-c", script], { encoding: "utf8", env: { ...process.env, EB_T: T } });
const git = (repo: string, ...args: string[]) => spawnSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
const step = (script: string) => "RUN echo " + Buffer.from(script).toString("base64") + " | base64 -d | sh";

/** A project like a unit image's /testbed: B's one commit tracks main.go and the given files, which are written first. */
function project(dir: string, files: Record<string, string>, track: string[]): string {
  const T = join(dir, "testbed");
  for (const [p, text] of Object.entries({ "main.go": "package main\n", ...files })) {
    mkdirSync(join(T, p, ".."), { recursive: true });
    writeFileSync(join(T, p), text);
  }
  spawnSync("git", ["init", "-q", T]);
  git(T, "add", "main.go", ...track);
  git(T, "commit", "-q", "-m", "base");
  return T;
}

describe("the session image's /testbed cleanup", () => {
  // Value: protects=which units get the cleanup; fails_when=a stripped name in a dependency folder or only in the base
  // commit reads as none, or a clean project reads as holding one.
  test("the probe counts stripped names on disk, in dependency folders and in the base commit, and reads 0 for a clean project", () => {
    const count = (T: string) => sh(PROBE_SCRIPT, T).stdout.trim();
    expect(count(project(join(root, "p-clean"), { "src/x.go": "package src\n" }, ["src"]))).toBe("0");
    expect(count(project(join(root, "p-dep"), { "node_modules/pkg/CLAUDE.md": "dep notes\n" }, []))).toBe("1");
    const only = project(join(root, "p-commit"), { "AGENTS.md": "agent notes\n" }, ["AGENTS.md"]);
    rmSync(join(only, "AGENTS.md"));
    expect(count(only)).toBe("1");
    expect(count(join(root, "p-none"))).toBe("0");
  });
  // Value: protects=a session can't read a stripped file or its object under /testbed; fails_when=/testbed/.git or a
  // stripped name at any depth survives the cleanup, or the cleanup takes any other file.
  test("the cleanup deletes /testbed/.git and every stripped name under /testbed, and keeps every other file", () => {
    const T = project(join(root, "c"), { "AGENTS.md": "a\n", "src/.claude/settings.json": "{}\n", "src/x.go": "package src\n", "node_modules/pkg/CLAUDE.md": "d\n", "node_modules/pkg/index.js": "\n" }, ["AGENTS.md", "src"]);
    expect(sh(CLEAN_SCRIPT, T).status).toBe(0);
    for (const p of [".git", "AGENTS.md", "src/.claude", "node_modules/pkg/CLAUDE.md"]) expect(existsSync(join(T, p))).toBe(false);
    for (const p of ["main.go", "src/x.go", "node_modules/pkg/index.js"]) expect(existsSync(join(T, p))).toBe(true);
    expect(sh(PROBE_SCRIPT, T).stdout.trim()).toBe("0");
  });
  // Value: protects=only affected units' session images change; fails_when=the builder skips the cleanup for a unit image
  // whose /testbed keeps a stripped name, adds it to any other unit's Dockerfile, or keeps an image that still holds one.
  test("the builder deletes /testbed/.git only for a unit image whose /testbed keeps a stripped name, and checks the result", () => {
    const fake = join(root, "docker");
    writeFileSync(
      fake,
      [
        "#!/bin/sh",
        'd="$FAKE_DOCKER"',
        'for a; do last=$a; done',
        'case "$1" in',
        "  image)",
        '    case "$4" in',
        '      "{{json .RootFS.Layers}}") if [ "$last" = "$FAKE_UNIT" ]; then echo \'["sha256:aa"]\'; elif [ -e "$d/built" ]; then echo \'["sha256:aa","sha256:bb"]\'; else echo \'[]\'; fi ;;',
        '      "{{json .RepoTags}}") echo \'[]\' ;;',
        '      "{{.Id}}") echo sha256:5e55 ;;',
        '      *) [ -e "$d/built" ] ;;',
        "    esac ;;",
        "  tag) ;;",
        '  build) cp "$last/Dockerfile" "$d/Dockerfile" && touch "$d/built" ;;',
        "  run)",
        '    while [ "$1" != --entrypoint ]; do shift; done',
        '    case "$2" in',
        '      claude) echo "$FAKE_CLAUDE (Claude Code)" ;;',
        "      cat) ;;",
        '      sh) if [ "$3" = "$FAKE_UNIT" ]; then echo "$FAKE_HELD"; else echo "${FAKE_LEFT:-0}"; fi ;;',
        "    esac ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(fake, 0o755);
    const unit = "sha256:" + "ab".repeat(32);
    const build = (name: string, held: string, left = "0") => {
      const d = join(root, "docker-" + name);
      mkdirSync(d);
      Object.assign(process.env, { FAKE_DOCKER: d, FAKE_UNIT: unit, FAKE_HELD: held, FAKE_LEFT: left, FAKE_CLAUDE: claudePin().version });
      const img = sessionImage(unit, { docker: fake });
      return { img, text: readFileSync(join(d, "Dockerfile"), "utf8") };
    };
    const clean = build("clean", "0");
    const held = build("held", "2");
    expect(clean.img.cleaned).toBe(false);
    expect(clean.text).toBe(sessionDockerfile("gstack-evals-eb-base:" + unit.slice(7, 31), claudePin()));
    expect(held.img.cleaned).toBe(true);
    expect(held.text.split("\n").filter((l) => !clean.text.split("\n").includes(l))).toEqual([step(CLEAN_SCRIPT)]);
    expect(held.text.indexOf(step(CLEAN_SCRIPT))).toBeGreaterThan(held.text.indexOf(step(DEPS_SCRIPT)));
    expect(held.img.tag).not.toBe(clean.img.tag);
    expect(() => build("left", "2", "1")).toThrow(/still holds \/testbed\/\.git or a stripped name/);
  });
});
