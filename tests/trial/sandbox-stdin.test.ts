// Value: protects=a value a session step needs reaches it on stdin and never in an argument, under docker and under bubblewrap.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerSandbox, processSandbox } from "../../src/trial/sandbox.ts";

/** A client that exits 0 for --version, run and rm, and otherwise keeps its argv (one argument per line) and stdin beside itself. */
const stub = (dir: string, name: string): string => {
  const bin = join(dir, name);
  writeFileSync(bin, '#!/bin/sh\nPATH=/usr/bin:/bin\nd=$(dirname "$0")\n[ "$1" = --version ] && exit 0\n[ "$1" = run ] || [ "$1" = rm ] && exit 0\nprintf \'%s\\n\' "$@" > "$d/argv"\ncat > "$d/stdin"\n');
  chmodSync(bin, 0o755);
  return bin;
};
const last = (dir: string) => ({ argv: readFileSync(join(dir, "argv"), "utf8").split("\n").slice(0, -1), stdin: readFileSync(join(dir, "stdin"), "utf8") });

const secret = "slot-2-" + "ab".repeat(16);
const command = 'IFS= read -r t && [ -n "$t" ] && echo got';

describe("a session step's stdin", () => {
  test("docker exec gets -i and the input on stdin only when there is input, and no argument holds the input", () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-stdin-"));
    try {
      const session = dockerSandbox({ trialImage: "img", docker: stub(dir, "docker") }).agent("app", { work: dir, env: {} });
      session.exec(command, 10_000, secret + "\n");
      const fed = last(dir);
      expect(fed.argv.slice(0, 4)).toEqual(["exec", "-i", "-w", "/work/app"]);
      expect(fed.argv.slice(-3)).toEqual(["sh", "-c", command]);
      expect(fed.stdin).toBe(secret + "\n");
      expect(fed.argv.some((a) => a.includes(secret))).toBe(false);
      session.exec(command, 10_000);
      const bare = last(dir);
      expect(bare.argv).not.toContain("-i");
      expect(bare.stdin).toBe("");
      session.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bubblewrap gets the input on stdin, and no argument holds it", () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-stdin-"));
    try {
      const home = join(dir, "home");
      mkdirSync(home);
      const session = processSandbox({ bwrap: stub(dir, "bwrap") }).agent("app", { work: dir, env: { HOME: home } });
      session.exec(command, 10_000, secret + "\n");
      const fed = last(dir);
      expect(fed.argv.slice(-3)).toEqual(["sh", "-c", command]);
      expect(fed.stdin).toBe(secret + "\n");
      expect(fed.argv.some((a) => a.includes(secret))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
