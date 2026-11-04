// Copyright (c) 2026 Garry Tan. MIT License.
// The mutation scorer's pinned tools (outcome-per-skill plan v3, section 10): one tool per language, its version, its
// licence and the level at which it can restrict mutants to the agent's diff. Scores are compared only within a language,
// because the restriction level differs. Each tool image under images/ installs exactly these versions, and the Docker
// test checks the licence each image recorded at build time against this table.

export type Lang = "rust" | "typescript" | "python" | "go";
export const LANGS: readonly Lang[] = ["rust", "typescript", "python", "go"];

/** line: mutants only on changed lines. function: every mutant in a function holding a changed line. file: every mutant
 * in a changed file. */
export type Restriction = "line" | "function" | "file";

export interface ToolPin {
  tool: string;
  version: string;
  /** SPDX id, as the package metadata the image installed states it. */
  licence: string;
  restriction: Restriction;
  /** Where the bytes come from and what pins them. */
  source: string;
  /** The tool image's Dockerfile, relative to this folder. */
  dockerfile: string;
}

export const TOOLS: Record<Lang, ToolPin> = {
  rust: {
    tool: "cargo-mutants",
    version: "27.1.0",
    licence: "MIT",
    restriction: "line",
    source: "crates.io cargo-mutants 27.1.0, built with cargo install --locked",
    dockerfile: "images/rust.Dockerfile",
  },
  typescript: {
    tool: "StrykerJS (@stryker-mutator/core with @stryker-mutator/vitest-runner)",
    version: "10.1.1",
    licence: "Apache-2.0",
    restriction: "line",
    source: "npm @stryker-mutator/core 10.1.1 and @stryker-mutator/vitest-runner 10.1.1, from images/node-package-lock.json",
    dockerfile: "images/node.Dockerfile",
  },
  python: {
    tool: "mutmut",
    version: "3.8.1",
    licence: "BSD-3-Clause",
    restriction: "function",
    source: "PyPI mutmut 3.8.1 and its dependencies, hash-checked from images/python-requirements.txt",
    dockerfile: "images/python.Dockerfile",
  },
  go: {
    tool: "go-mutesting (avito-tech fork)",
    version: "v0.0.0-20261002081621-9ce5f731e321",
    licence: "MIT",
    restriction: "file",
    source: "github.com/avito-tech/go-mutesting at that pseudo-version, checked against the Go checksum database",
    dockerfile: "images/go.Dockerfile",
  },
};

/** At most this many mutants per tree are run, chosen by sample() with the frozen seed. */
export const SAMPLE_CAP = 200;
export const SAMPLE_SEED = "gstack-evals O2 mutation sample, frozen 2026-11-04";
