# Lane B arms for Claude Code

Three trees that a trial extracts into `/root` before Claude Code starts:

- **none**: an empty `.claude/skills/`.
- **gstack**: the real `./setup --host claude --no-browser` result for gstack at a pinned sha.
- **placebo**: the same skill folders, with each `SKILL.md` body replaced by on-topic, non-procedural prose of the same token count.

Each arm ships as a tar whose paths are relative to `/root` (`.claude/...`, and for gstack also `.gstack/...`). Extract it with `tar -x -C /root -f <arm>.tar`. The tars are build output and stay out of git; `manifests/` records what was built.

## Files

| Path | What it is |
| --- | --- |
| `build.sh` | Builds the three tars, the placebo tree and the manifests. Needs docker with buildx, bun, git and network at build time. Every tar and gzip runs in the pinned builder image. |
| `Dockerfile` | `gstack-tar` runs gstack's setup in an Ubuntu 24.04 builder. `runtime` and `check` mirror the trial runtime for the offline checks. |
| `check-arms.sh`, `check-inside.sh` | Offline checks of each tar on a set of base images, with `--network none`. |
| `placebo/placebo.ts` | The placebo generator: frontmatter split, routing section, seeded prose, token count, procedural-marker check. |
| `placebo/generate.ts` | Generator CLI. Prints the generator hash, the seed and both digests. |
| `placebo/verify-tokens.ts` | Re-counts every body with Anthropic's count_tokens endpoint for claude-opus-5-5. Skips when `ANTHROPIC_API_KEY` is not set. |
| `tree.ts` | Tree walk, digest and per-arm manifest. |
| `manifests/<arm>.json` | Tar sha256 and size, file count, total bytes, tree digest, skill count and names. |
| `manifests/<arm>.files.tsv` | Every entry: sha256, bytes, mode, type, path. |
| `manifests/placebo-tokens.tsv` | Per skill: original and placebo body tokens, ratio, routing bytes kept. |
| `../tests/placebo.test.ts` | Keyless tests. |
| `../package.json`, `../bun.lock`, `../tsconfig.json` | The quick/laneb package: js-tiktoken 1.0.21, @types/bun and TypeScript, locked apart from the repo root. |

## The trial runtime these trees expect

The runtime is the harness's, identical across arms: the Claude Code 2.1.312 native binary at `/usr/local/bin/claude`, Node 24 at `/opt/laneb/bin/node`, Bun 1.4.4 at `/opt/laneb/bin/bun`, with `/opt/laneb/bin` at the end of `PATH`. Claude Code runs as root with `HOME=/root`, `CLAUDE_CONFIG_DIR=/root/.claude` and `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. Without that last variable Claude Code adds its own bundled skills to every arm. With it, Claude Code 2.1.312 still lists one built-in skill, `plugin-authoring`, in every arm, so the none arm sees one skill and the other two see 65.

gstack's scripts start with `#!/usr/bin/env bun`, so they run the first `bun` on `PATH`. A task image with its own older Bun earlier on `PATH` would shadow 1.4.4. gstack needs 1.4.2 or newer.

## The gstack arm

`build.sh` fetches gstack at `61e201ec08bcf59163ef2d3a69a26e334a536c04` (v1.91.295.0) from its public repo and runs `./setup --host claude --no-browser` as root with the checkout at `/root/.claude/skills/gstack`. The builder has Bun 1.4.4 (gstack's install default, checksum from gstack's own table), Node 24.22.1, Claude Code 2.1.312 and a C compiler, so setup also builds the static `/cso` helper. Chromium is skipped, so the browser skills report no browser.

After setup the build changes the following and nothing else. The `gstack-build` stage of the Dockerfile does all of it.

1. **No update check.** `gstack-config set update_check false`. On a network that accepts connections and never answers, the update check's `git ls-remote` held the skill preamble past a 120 second timeout. With `--network none` it fails fast either way. `GSTACK_UPDATE_CHECK=true` keeps setup's default.
2. **A long-time user.** Each trial starts from a fresh extract, which gstack would treat as a first run. The one-time prompts in `bin/gstack-skill-start` chain: the model-overlay notice and the lake intro, then the telemetry prompt once the lake intro is seen, then the proactive prompt, then an offer to add routing rules to the project's CLAUDE.md and commit it, plus a first-run or first-loop tip. The build marks all of them seen with these empty files: `.gstack/.feature-prompted-model-overlay`, `.gstack/.completeness-intro-seen`, `.gstack/.telemetry-prompted`, `.gstack/.proactive-prompted`, `.gstack/.activated` and `.gstack/.first-loop-tip-shown`. It answers the CLAUDE.md offer with `gstack-config set routing_declined true`. Telemetry stays off and proactive stays `core`, the defaults. `GSTACK_ONBOARDING_SEEN=false` keeps a fresh install. The gstack manifest lists the markers.
3. **Self-contained.** Every symlink outside `node_modules` becomes a copy of its target, so the tree no longer depends on links into the checkout. `node_modules` keeps its relative links.
4. **Claude Code's own state goes.** Setup's probe of the claude binary leaves `.claude/.claude.json` (with a random machine and user id) and a backup of it. That is not gstack state, so no arm carries it.
5. **Volatile files are fixed.** The timestamp in `.gstack/installs.tsv` becomes `1970-01-01T00:00:00Z`. `.gstack/.gbrain-local-status-cache.json` goes; it is keyed on the builder's PATH and is rebuilt on first use. `bin/.gstack-cso-build.log` (timings and a random stage folder) is emptied. The checkout's reflog goes, since it holds a timestamp and the builder's git identity. The checkout's index is rebuilt from HEAD with no stat data, so git rehashes files on first use instead of trusting build-time stat data.
6. **A canonical tar**: sorted names, mtime 0, owner root.

The tar holds `.claude/skills/` (one folder per skill, plus the `gstack` checkout with `bin/`, `node_modules/` and the compiled `dist/` binaries), `.claude/settings.json` (setup's Stop hook, which closes gstack's session timeline) and `.gstack/` (setup's state: install registry, setup version, welcome marker, gbrain detection, config).

## The placebo arm

For every folder in the installed `.claude/skills/`, the placebo tree has the same folder with one `SKILL.md`:

- The YAML frontmatter is byte-identical except that the top-level `hooks:` key and its block are removed. Name, description, triggers, allowed-tools and every other key keep their bytes, and so does every frontmatter without hooks.
- The router's routing text is byte-identical. Setup installs the router twice, as the checkout's own `gstack/SKILL.md` and as `_gstack-command/SKILL.md`. In both, the section from the line `## Route first` to the end of the file maps requests to skills, and it is kept. The router's other sections (preamble, voice, telemetry and so on) are replaced like any other body. No other installed file holds routing text: setup writes no CLAUDE.md block, and the skill descriptions are already kept as frontmatter.
- The rest of the body becomes prose whose o200k_base token count matches the original body's. The generator lands within one token of the target, so any body of 20 tokens or more stays inside +-5%. gstack's smallest body is 330 tokens.

Everything else is left out of the placebo tree: `sections/`, `bin/`, scripts, templates, the gstack checkout, `node_modules`, `.claude/settings.json` and `.gstack/`.

Hooks are removed because they never reach the model's skill listing and, in this arm, they would point at gstack scripts that do not exist. Kept as written, they would fail while their skill is active: careful and guard would exit 127 on every Bash call, freeze and guard on every Edit and Write call, and autoplan's guard would deny every Read and Agent call. Six skills carry hooks in gstack: autoplan, careful, freeze, guard, investigate and plan-ceo-review.

The prose is on-topic: its topic terms come only from the skill's name and the phrases of its description, with paths, commands, flags, file names and instruction verbs removed. It is non-procedural: every sentence comes from a fixed set of descriptive, historical or definitional templates, none of which starts with a topic term, and the output carries no lists, headings, code, backticks, commands, tool names or paths. `proceduralMarkers` in `placebo.ts` checks that, and the tests run it on every generated body.

## Seed, hash and digests

The seed is `gstack-evals/laneb/placebo/v1` unless `--seed` says otherwise. Each skill gets its own sfc32 stream seeded from sha256(seed, folder name), so output does not depend on processing order. Nothing reads a clock or `Math.random`.

The generator hash is sha256 over the lines `<sha256 of file>  placebo/<file>` for `generate.ts` and `placebo.ts`, then `js-tiktoken <version>` and `seed <seed>`, each ending in a newline. js-tiktoken is locked in `quick/laneb/bun.lock`.

A tree digest is sha256 over one line per entry, sorted by path: `<sha256 of file>  <path>` for a file and `link:<target>  <path>` for a symlink. Directories and modes are left out; the tar sha256 covers them.

## Reproducibility

Two builds with an empty docker build cache, each from a fresh fetch of gstack, gave byte-identical tars and tar.gz files for all three arms, and identical manifests. A rebuild on another machine depends on these staying the same:

- the builder image, pinned by digest, which also runs every tar and gzip;
- the Ubuntu packages the builder installs (build-essential, git, curl, python3), which are not pinned: a gcc or libc update would change the static `/cso` helper, and a git update could change the index that `git read-tree` writes;
- the host's git, because `build.sh` fetches gstack on the host, so the checkout's `.git` template files (hook samples, description, info/exclude) come from the host's git version;
- the pack GitHub serves for the pinned commit, and the npm packages in gstack's `bun.lock`.

If a rebuild does not match, `manifests/gstack.files.tsv` shows which files moved.

## Checks

`check-arms.sh [out-dir] [base ...]` runs each tar on ubuntu:24.04, debian:bookworm-slim and debian:bullseye-slim by default, in a container with the runtime above and `--network none`. It checks the binaries, the skill count, the `investigate` preamble and the onboarding blocks it prints (none are expected), the same preamble inside a git repo when the base has git, a `review` preamble against a tarpit that accepts connections and never answers, the Stop hook and a frontmatter hook. It then points Claude Code at a local stub server that records the request and answers 400, so no model is called, and counts the skill names Claude Code sent.

`cd quick/laneb && bun install --frozen-lockfile && bun test` runs keyless on a fixture tree, and `npx tsc --noEmit -p quick/laneb/tsconfig.json` typechecks. Set `LANEB_GSTACK_SKILLS` to an installed `.claude/skills` to run the same checks on every real skill; `build.sh` does.
