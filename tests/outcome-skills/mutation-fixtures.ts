// Copyright (c) 2026 Garry Tan. MIT License.
// Fixture repositories for the mutation scorer's Docker tests: one tiny project per language, a project image built on
// the language's tool image with no network, and patches for agent trees written as git diffs against the base commit.
// Each language has the same story: a base with double(), an agent that adds clamp() and sign(), and tests that either pin
// their behaviour (strong) or only call them (weak).
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { docker } from "../../lanes/real-outcome/task/docker.ts";
import type { Lang } from "../../lanes/outcome-skills/mutation/pins.ts";
import { scorerImage, toolImage } from "../../lanes/outcome-skills/mutation/run.ts";

export type Files = Record<string, string>;

const git = (cwd: string, args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
};

const write = (root: string, files: Files) => {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
};

export interface Fixture {
  lang: Lang;
  dir: string;
  image: string;
  /** A git patch against the base for the base files with these files written over them. */
  patch: (files: Files) => string;
  cleanup: () => void;
}

/** Builds the base repository and its project image (from the tool image, offline) and returns a patch maker. */
export function fixture(lang: Lang, base: Files, extra: string[] = []): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "mutation-fx-" + lang + "-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  write(repo, base);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "base"]);
  const ctx = join(dir, "ctx");
  mkdirSync(ctx);
  cpSync(repo, join(ctx, "repo"), { recursive: true });
  const tool = toolImage(lang);
  writeFileSync(join(ctx, "Dockerfile"), ["FROM " + tool, "COPY repo/ /testbed/", ...extra].join("\n") + "\n");
  const image = "gstack-mutation-fixture-" + lang + ":" + Math.random().toString(16).slice(2, 10);
  const b = docker(["build", "--network", "none", "-q", "-t", image, ctx], { timeoutMs: 900000 });
  if (b.status !== 0) throw new Error("fixture image: " + b.stderr);
  return {
    lang,
    dir,
    image,
    patch: (files) => {
      write(repo, files);
      git(repo, ["add", "-A"]);
      const p = git(repo, ["diff", "--cached", "--binary", "--no-renames"]);
      git(repo, ["reset", "-q", "--hard", "HEAD"]);
      git(repo, ["clean", "-qfdx"]);
      return p;
    },
    cleanup: () => {
      docker(["image", "rm", "-f", scorerImage(image, lang), image]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------- Python ----------

export const PY_BASE: Files = {
  "calc/__init__.py": "",
  "calc/ops.py": "def double(x):\n    return x * 2\n",
  "tests/__init__.py": "",
  "tests/test_base.py": "from calc.ops import double\n\n\ndef test_double():\n    assert double(2) == 4\n    assert double(0) == 0\n    assert double(-3) == -6\n",
};
export const PY_IMPL = "def double(x):\n    return x * 2\n\n\ndef clamp(x, lo, hi):\n    if x < lo:\n        return lo\n    if x > hi:\n        return hi\n    return x\n\n\ndef sign(x):\n    if x > 0:\n        return 1\n    if x < 0:\n        return -1\n    return 0\n";
export const PY_GOLD = "def double(x):\n    return x * 2\n\n\ndef clamp(x, lo, hi):\n    return max(lo, min(x, hi))\n\n\ndef sign(x):\n    return (x > 0) - (x < 0)\n";
export const PY_STRONG = "from calc.ops import clamp, sign\n\n\ndef test_clamp():\n    assert clamp(5, 0, 10) == 5\n    assert clamp(-1, 0, 10) == 0\n    assert clamp(11, 0, 10) == 10\n    assert clamp(0, 0, 10) == 0\n    assert clamp(10, 0, 10) == 10\n\n\ndef test_sign():\n    assert sign(3) == 1\n    assert sign(1) == 1\n    assert sign(-3) == -1\n    assert sign(-1) == -1\n    assert sign(0) == 0\n";
export const PY_WEAK = "from calc.ops import clamp, sign\n\n\ndef test_clamp_runs():\n    clamp(5, 0, 10)\n\n\ndef test_sign_runs():\n    sign(0)\n";
export const PY_FAILING = "\n\ndef test_wrong():\n    assert clamp(1, 0, 10) == 2\n";
export const PY_EXTRA = ["RUN python -m pip install --no-index --no-deps --require-hashes --disable-pip-version-check --find-links /opt/gstack-mutation/python/wheels -r /opt/gstack-mutation/python/requirements.txt"];
export const pythonFixture = () => fixture("python", PY_BASE, PY_EXTRA);

// ---------- Go ----------

export const GO_BASE: Files = {
  "go.mod": "module example.invalid/calc\n\ngo 1.22\n",
  "calc/ops.go": "package calc\n\nfunc Double(x int) int {\n\treturn x * 2\n}\n",
  "calc/ops_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestDouble(t *testing.T) {\n\tif Double(2) != 4 || Double(0) != 0 || Double(-3) != -6 {\n\t\tt.Fatal(\"double\")\n\t}\n}\n",
};
export const GO_IMPL = "package calc\n\nfunc Clamp(x, lo, hi int) int {\n\tif x < lo {\n\t\treturn lo\n\t}\n\tif x > hi {\n\t\treturn hi\n\t}\n\treturn x\n}\n\nfunc Sign(x int) int {\n\tif x > 0 {\n\t\treturn 1\n\t}\n\tif x < 0 {\n\t\treturn -1\n\t}\n\treturn 0\n}\n";
export const GO_STRONG = "package calc\n\nimport \"testing\"\n\nfunc TestClamp(t *testing.T) {\n\tcases := [][4]int{{5, 0, 10, 5}, {-1, 0, 10, 0}, {11, 0, 10, 10}, {0, 0, 10, 0}, {10, 0, 10, 10}}\n\tfor _, c := range cases {\n\t\tif got := Clamp(c[0], c[1], c[2]); got != c[3] {\n\t\t\tt.Fatalf(\"Clamp(%d) = %d\", c[0], got)\n\t\t}\n\t}\n}\n\nfunc TestSign(t *testing.T) {\n\tif Sign(3) != 1 || Sign(-3) != -1 || Sign(0) != 0 {\n\t\tt.Fatal(\"sign\")\n\t}\n}\n";
export const GO_WEAK = "package calc\n\nimport \"testing\"\n\nfunc TestClampRuns(t *testing.T) {\n\t_ = Clamp(5, 0, 10)\n}\n\nfunc TestSignRuns(t *testing.T) {\n\t_ = Sign(0)\n}\n";
export const goFixture = () => fixture("go", GO_BASE);

// ---------- Rust ----------

export const RS_BASE: Files = {
  "Cargo.toml": "[package]\nname = \"calc\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n",
  "Cargo.lock": "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"calc\"\nversion = \"0.1.0\"\n",
  "src/lib.rs": "pub fn double(x: i64) -> i64 {\n    x * 2\n}\n",
};
export const RS_IMPL = "pub fn double(x: i64) -> i64 {\n    x * 2\n}\n\npub fn clamp(x: i64, lo: i64, hi: i64) -> i64 {\n    if x < lo {\n        return lo;\n    }\n    if x > hi {\n        return hi;\n    }\n    x\n}\n\npub fn sign(x: i64) -> i64 {\n    if x > 0 {\n        1\n    } else if x < 0 {\n        -1\n    } else {\n        0\n    }\n}\n";
export const RS_STRONG_INLINE = "\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn clamps() {\n        assert_eq!(clamp(5, 0, 10), 5);\n        assert_eq!(clamp(-1, 0, 10), 0);\n        assert_eq!(clamp(11, 0, 10), 10);\n        assert_eq!(clamp(0, 0, 10), 0);\n        assert_eq!(clamp(10, 0, 10), 10);\n    }\n\n    #[test]\n    fn signs() {\n        assert_eq!(sign(3), 1);\n        assert_eq!(sign(-3), -1);\n        assert_eq!(sign(0), 0);\n    }\n}\n";
export const RS_WEAK_INTEGRATION = "use calc::{clamp, sign};\n\n#[test]\nfn clamp_runs() {\n    let _ = clamp(5, 0, 10);\n}\n\n#[test]\nfn sign_runs() {\n    let _ = sign(0);\n}\n";
export const rustFixture = () => fixture("rust", RS_BASE);

// ---------- TypeScript ----------

export const TS_BASE: Files = {
  "package.json": JSON.stringify({ name: "calc", private: true, type: "module" }, null, 2) + "\n",
  "src/ops.ts": "export function double(x: number): number {\n  return x * 2;\n}\n",
  "src/ops.test.ts": "import { expect, test } from \"vitest\";\nimport { double } from \"./ops\";\n\ntest(\"double\", () => {\n  expect(double(2)).toBe(4);\n  expect(double(0)).toBe(0);\n  expect(double(-3)).toBe(-6);\n});\n",
};
export const TS_IMPL = "export function double(x: number): number {\n  return x * 2;\n}\n\nexport function clamp(x: number, lo: number, hi: number): number {\n  if (x < lo) return lo;\n  if (x > hi) return hi;\n  return x;\n}\n\nexport function sign(x: number): number {\n  if (x > 0) return 1;\n  if (x < 0) return -1;\n  return 0;\n}\n";
export const TS_STRONG = "import { expect, test } from \"vitest\";\nimport { clamp, sign } from \"./ops\";\n\ntest(\"clamp\", () => {\n  expect(clamp(5, 0, 10)).toBe(5);\n  expect(clamp(-1, 0, 10)).toBe(0);\n  expect(clamp(11, 0, 10)).toBe(10);\n  expect(clamp(0, 0, 10)).toBe(0);\n  expect(clamp(10, 0, 10)).toBe(10);\n});\n\ntest(\"sign\", () => {\n  expect(sign(3)).toBe(1);\n  expect(sign(-3)).toBe(-1);\n  expect(sign(0)).toBe(0);\n});\n";
export const TS_WEAK = "import { test } from \"vitest\";\nimport { clamp, sign } from \"./ops\";\n\ntest(\"clamp runs\", () => {\n  clamp(5, 0, 10);\n});\n\ntest(\"sign runs\", () => {\n  sign(0);\n});\n";
export const typescriptFixture = () => fixture("typescript", TS_BASE, ["RUN cp -a /opt/gstack-mutation/fixture-node/node_modules /testbed/node_modules"]);
