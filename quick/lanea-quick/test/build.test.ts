import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "build-"));
const bin = join(dir, "bin");
mkdirSync(bin);
mkdirSync(join(dir, "tree", "test", "fixtures"), { recursive: true });
writeFileSync(join(dir, "tree", "SKILL.md"), "skill");
writeFileSync(join(dir, "tree", "test", "fixtures", "tasks.json"), "[]");
const gitFails = join(dir, "git-fails");
const ids = join(dir, "ids");
const stub = (name: string, body: string) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};
stub("git", `[ -e "${gitFails}" ] && exit 1\ntar -c -C "${join(dir, "tree")}" .`);
stub("docker", `if [ "$1" = image ]; then for a; do t=$a; done; awk -v t="$t" '$1 == t { print $2 }' "${ids}"; fi\necho "$@" >> "${join(dir, "docker.log")}"`);
const env = (extra: Record<string, string> = {}) => ({ PATH: `${bin}:${process.env.PATH}`, HOME: dir, ...extra });
const build = (work: string) => Bun.spawnSync(["bash", "docker/build-arms.sh", join(dir, "gstack"), "base"], { cwd: root, env: env({ LANEA_WORK: work }) });
const resolve = (tags: string[], fake: boolean) => {
  const code = `import { resolveImages } from "./src/run.ts"; resolveImages(${JSON.stringify(tags)}, ${fake}).then((x) => console.log(JSON.stringify(x)), (e) => console.log(String(e.message)));`;
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: root, env: env() }).stdout.toString().trim();
  return out.startsWith("{") ? JSON.parse(out) : out;
};

describe("build-arms.sh", () => {
  test("a failed git archive leaves no context to reuse", () => {
    const work = mkdtempSync(join(tmpdir(), "work-"));
    writeFileSync(gitFails, "");
    expect(build(work).exitCode).not.toBe(0);
    const ctx = join(work, "docker-ctx");
    expect(existsSync(ctx) ? readdirSync(ctx) : []).toEqual([]);
  });
  test("each context holds the tree without test/", () => {
    const work = mkdtempSync(join(tmpdir(), "work-"));
    Bun.spawnSync(["rm", "-f", gitFails]);
    expect(build(work).exitCode).toBe(0);
    const ctx = join(work, "docker-ctx");
    const dirs = readdirSync(ctx).filter((d) => !d.startsWith("."));
    expect(dirs.length).toBe(4);
    for (const d of dirs) {
      expect(existsSync(join(ctx, d, "gstack", "SKILL.md"))).toBe(true);
      expect(existsSync(join(ctx, d, "gstack", "test"))).toBe(false);
    }
  });
});

describe("resolveImages", () => {
  const pinned = JSON.parse(readFileSync(join(root, "images.json"), "utf8")).images as Record<string, string>;
  const base = "lanea-quick/base:cc2.1.312-bun1.4.4";
  const arm = "lanea-quick/office-hours-after:latest";
  test("a paid run gets the pinned ids and refuses an image that does not match images.json", () => {
    writeFileSync(ids, `${base} ${pinned[base]}\n${arm} ${pinned[arm]}\n`);
    expect(resolve([base, arm], false)).toEqual({ [base]: pinned[base]!, [arm]: pinned[arm]! });
    writeFileSync(ids, `${base} ${pinned[base]}\n${arm} sha256:rebuilt\n`);
    expect(resolve([base, arm], false)).toContain("E_IMAGE");
    expect(resolve([base, arm], true)).toEqual({ [base]: pinned[base]!, [arm]: "sha256:rebuilt" });
  });
});
