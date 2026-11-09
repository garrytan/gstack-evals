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
| `manifests/r3/<arm>.json` | R3's none, gstack and placebo tars, in the same shape; prepare-run reads them with `ARM_MANIFESTS=arms/manifests/r3`. |
| `manifests/<arm>.files.tsv` | Every entry: sha256, bytes, mode, type, path. |
| `manifests/placebo-tokens.tsv` | Per skill: original and placebo body tokens, ratio, routing bytes kept. |
| `../tests/placebo.test.ts` | Keyless tests. |
| `../tsconfig.json` | Typecheck config for quick/laneb. js-tiktoken 1.0.21 is a pinned dev dependency of the repo root, so root CI runs these tests too. |
| `stacks.ts` | Builds the stacks round's pstack and pstack-placebo tars and their manifests. See [The pstack arms](#the-pstack-arms-stacks-round-1). |
| `manifests/pstack*.json`, `manifests/pstack*.files.tsv`, `manifests/pstack-placebo-tokens.tsv` | What `stacks.ts` built, in the same shape as the other manifests, plus the pin and install provenance. |
| `../tests/stacks.test.ts` | Keyless tests of the pstack arms and the stacks skill map. |
| `l1.ts` | The L1 pins, the prereg's frozen values, each L1 arm's manifest meta and the in-image checks. See [The L1 arms](#the-l1-arms). |
| `check-l1.sh` | In-image checks of the L1 tars. |
| `task-bun.sh` | The bun and bash the hooks would reach in each L1 task image. |
| `manifests/l1/` | The L1 manifests, in the same shape, plus `task-bun.tsv`. |
| `../tests/l1-arms.test.ts` | Keyless tests of the L1 arms. |

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

The generator hash is sha256 over the lines `<sha256 of file>  placebo/<file>` for `generate.ts` and `placebo.ts`, then `js-tiktoken <version>` and `seed <seed>`, each ending in a newline. js-tiktoken is pinned in the root `package.json` and locked in the root `bun.lock`.

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

`bun install --frozen-lockfile` at the repo root, then `bun test quick/laneb`, runs keyless on a fixture tree, and `npx tsc --noEmit -p quick/laneb/tsconfig.json` typechecks. Set `LANEB_GSTACK_SKILLS` to an installed `.claude/skills` to run the same checks on every real skill; `build.sh` does.

## The L1 arms

The L1 preregistration ([plan](../../../wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000/README.md), sections 2 and 10, unit U1) runs four arms: none, before, after and off. `build.sh l1 [out-dir]` builds them (default out-dir `~/.capy/work/laneb-arms-l1`), and `manifests/l1/` records what it built.

| Arm | gstack | After setup |
| --- | --- | --- |
| none | none: an empty `.claude/skills/` | nothing |
| before | `82db89ab3ea3c64185538b8af33da2ffd1a18b57` (v1.93.22.0), lite | the seeded user |
| after | `699a41cb6808e01240d02e82247693f9170d401a` (v1.94.39.0), lite | the seeded user |
| off | the after pin, lite | the seeded user, then both switches off |

**Pins and fetch.** build.sh holds both shas as constants (`L1_BEFORE_SHA`, `L1_AFTER_SHA`), equal to the prereg's. It fetches each one by sha, never by branch: `git init`, `git fetch --depth 1 https://github.com/garrytan/gstack.git <sha>`, `git checkout FETCH_HEAD`. Then `git rev-parse HEAD` must equal the sha. It hashes `git archive --format=tar <sha>` twice and requires the two values to match. Each manifest records the fetch and the archive sha256. GitHub serves a different pack for the same shallow fetch each time, so build.sh then repacks the checkout single-threaded with every object recompressed (`git -c pack.threads=1 repack -a -d -F`). Two independent fetches then give the same pack.

**Setup.** `./setup --host claude --no-browser --loadout lite` runs as root, with the checkout at `/root/.claude/skills/gstack`, in the same builder and runtime as the gstack arm. The Dockerfile target is `gstack-l1-tar`, with `GSTACK_LOADOUT` and `GSTACK_OFF_KEYS` as build args. `--no-browser` sets `GSTACK_SKIP_PLAYWRIGHT=1` and `GSTACK_SKIP_FONTS=1` inside setup, the two variables an earlier install set by hand. Each arm's gstack stage runs with no build cache (`--no-cache-filter gstack-l1-build`).

**What the build changes after setup.** It runs the gstack arm's steps 1 to 6 above (no update check, the seeded user, self-contained links, no Claude Code state, volatile files, canonical tar), with three differences:

- Only absolute symlinks become copies. Each pin tracks one relative symlink in git: `connect-chrome`, which points at `open-gstack-browser`. The build keeps it as a link. As a copy it would be a real folder, and the pin's own `gstack-modules render` would then count `connect-chrome/SKILL.md` as a 205th lite file. The first build showed exactly that. The build still checks that no link is absolute or broken and that every link resolves inside `/root`.
- Setup backs up `settings.json` each time it registers a hook, as `settings.json.bak.<time>.<pid>.<random>`, and writes the newest name into `settings.json.bak-latest`. These files changed from build to build, so the build removes them. They are setup's rollback copies, and nothing reads them at run time.
- The off arm gets `gstack-config set skill_routing off` and `gstack-config set skill_contracts off` in `/root/.gstack`, after the seeded user. Its hooks stay registered and exit without output.

After the tar is written, the stage records `gstack-config get` for both switches. It also writes the lite lock from an in-place `gstack-modules render --host claude --loadout lite` at setup's render path, with setup's render moved aside and put back, as an earlier install-pin.sh did.

**Manifests.** `manifests/l1/<arm>.json` has the same shape as the other manifests, plus `inventory_sha256`, the sha256 of the arm's file inventory. The build writes that inventory, `<arm>.files.tsv`, next to the tars in its output folder and not into the repo, because the four inventories push the review diff past gstack's 2 MB limit. For before, after and off they add these fields: `gstack_sha`, `gstack_version`, `fetch` (repo, sha, head after checkout, method), `git_archive_sha256`, `setup`, `claude_code`, `update_check`, `onboarding_markers`, `lite`, `hooks`, `gstack_config` and `investigate`. `lite` holds the spec, spec_sha256, file count, the lock file's sha256 and the normalized tree digest of setup's render, computed as manifest.py's tree() computes it. `hooks` holds event, `_gstack_source`, command (with `/root` as `<HOME>`) and timeout. `investigate` holds the normalized sha256 and the first-200-character sha256, as manifest.py computes them. `bun arms/l1.ts manifest` writes the files and exits 1 when a value differs from the prereg's frozen value.

| Value | before | after | off |
| --- | --- | --- | --- |
| lite spec_sha256 | `c5df50f999eb` | `c5df50f999eb` | `c5df50f999eb` |
| lite files | `204` | `204` | `204` |
| lite tree digest, normalized | `35dbf7b3ce88` | `ed09c8c81574` | `ed09c8c81574` |
| /investigate sha256, normalized | `c303d9febdc3` | `02b0e1e74913` | `02b0e1e74913` |
| /investigate first 200, sha256 | `07bd7af57db2` | `5bd9a0c6e900` | `5bd9a0c6e900` |
| git archive sha256 | `12c429a59eee` | `adfefb56eebb` | `adfefb56eebb` |
| gstack-config skill_routing, skill_contracts | `, ` | `on, on` | `off, off` |
| hook entries | `1` | `3` | `3` |

Every frozen value in the prereg reproduces: spec_sha256 `c5df50f9...` at both pins, 204 files, tree digests `35dbf7b3...` (before) and `ed09c8c8...` (after, and off equals after), and the /investigate digests in install-manifest.md.

**Checks inside the arm images.** `check-l1.sh [out-dir]` runs every check. Each check runs in a container built from the `check` target on ubuntu:24.04, with the arm tar extracted into `/root`, as root, with `--network none`. Each prints one JSON line from `arms/l1.ts`.

1. **Lite match** (before, after, off). The check moves `/root/.gstack/render/claude` aside and runs the pin's own `gstack-modules render --host claude --loadout lite --out-dir /root/.gstack/render/claude`. The lock's spec and spec_sha256 must be the prereg's. Its 204 files must match the installed render byte for byte, and the installed render may hold no other file. Then the check puts the installed render back.
2. **Hook entries.** before has only Stop timeline (5 s). after and off have Stop timeline (5 s), Stop skill contract (10 s) and UserPromptSubmit skill route (5 s). Every command sits under `<HOME>/.claude/skills/gstack/hosts/claude/hooks/`.
3. **None clean.** The none arm has no `~/.local/share/gstack`, no `~/.gstack`, nothing under `~/.claude/skills` and no gstack hook in any `~/.claude/settings*.json`.
4. **Switches.** `gstack-config get` prints off for skill_routing and skill_contracts in off. In after it prints on for both, the defaults.
5. **Hooks under Claude Code 2.1.312.** This check uses the runtime's binary, run as the Lane B agent runs it: HOME=/root, CLAUDE_CONFIG_DIR=/root/.claude, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, `--setting-sources user,project`, the stream-json flags and the runtime PATH. It points Claude Code at a fake upstream inside the container, built on `sse()` from `runner/fake_upstream.ts`, which answers each turn with text and never calls a model. The fixture prompt is "The test suite fails with a KeyError in the parser after the last change. Find the root cause and fix it." The after pin's `gstack-skill-route` routes it to /investigate with score 1, on the trigger "test fails". On that prompt, the after arm's route line reaches the first request. On the told prompt ("/investigate " then the fixture), the session ends with no DEBUG REPORT. The contract hook blocks once, and "Stop hook feedback:\nSKILL_CONTRACT_UNMET investigate" reaches the second request. In off and before, neither appears. The fake upstream waits 2 s before each answer. When it answered at once, the Stop hooks ran before Claude Code had written the transcript, and the contract hook failed open with ENOENT.
6. **Bun on each task image.** `task-bun.sh` covers the base image of each of the 80 F tasks and the 10 pilot tasks, pinned by digest in `tasks/swerebench-r3a4.json`. It pulls one image at a time and mounts the trial runtime built from `runner/runtime-stages.Dockerfile` at `/opt/laneb/bin` (bun, node, bunx). It appends `/opt/laneb/bin` to the image's own PATH and records `command -v bun`, `bun --version` and whether bash is on PATH, with `--network none`. `manifests/l1/task-bun.tsv` holds one row per task. `task-bun.sh check <image>` checks one image.

`LANEB_L1_ARMS=<out-dir> bun test quick/laneb/tests/l1-arms.test.ts` runs checks 1 to 6 on the built tars, each both ways. Each check passes on the real arm and fails on a doctored one: one byte changed in one rendered file, the contract hook entry removed, a gstack folder in none, skill_routing set back on in off, a route hook that prints nothing, or an image with an older bun earlier on PATH. Without `LANEB_L1_ARMS` those tests skip. The pure tests still run: the pins, the frozen values, the manifest fields, each check on fixtures, l1.ts's tree digest against manifest.py's own tree(), and task-bun.tsv's coverage.

| Arm | Tar sha256 | Tar.gz sha256 | Files | Skills |
| --- | --- | --- | --- | --- |
| none | `8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e` | `6e55e7062d67321245fdec133dd05f409a766ee601777e9634038440bfc9dcf5` | 0 | 0 |
| before | `e28da7d021fc530de9dc577cd4ebe9e28dc7773fd46ea006ca03c9f75701f29c` | `67f6e6156282f0df28fdb3352046b5f7f1c02e9287c27737d790f278695cdf55` | 14,338 | 65 |
| after | `604cdb537ccf2e62cace277262c8ec75341dd4fb4714a3135ce82e3725c47cac` | `5c2fd75d1562fd7c575907a8b0fa8e6e6d335c93c53a0a8cbef42df7a51685e1` | 14,514 | 65 |
| off | `a44be22f05a5ed681fc437371cb5c2bf057165b4e2aad2813f354d9d3c95daa9` | `2e86902f090b33581b3e6b2b905f2545fbce77282c85f0f397abbe33745f1c2a` | 14,514 | 65 |

**Reproducibility.** On 2026-11-04, two builds gave byte-identical tars and tar.gz files for all four arms, and identical manifests. Each build started from a fresh fetch, with the build cache emptied first and no cache for any arm's gstack stage. An earlier pair differed only in the checkout's pack files, which led to the repack step above. The gstack arm's outside dependencies still apply: unpinned Ubuntu packages, the host's git, and the npm packages in each pin's bun.lock.

**Bun on the task images.** On 2026-11-04 all 90 rows read `/opt/laneb/bin/bun`, version 1.4.4, with bash present. No F or pilot task image puts another bun ahead of the runtime's, and none lacks bash, so the hooks reach Bun 1.4.4 in every task and no task is listed.

## The pstack arms (stacks round 1)

The stacks round ([plan](../../../wiki/plans/2026-10-30-geva-59-stacks-round-1-plan/README.md), section 10 step 3) runs two more arms on TB2: pstack, Lauren Tan's skill stack (MIT, in cursor/plugins), and its placebo. `stacks.ts` builds both with the rig's own install path (src/arms/install.ts), the one step 1 built for the review lane, so the TB2 and review arms install pstack the same way. No pstack text is stored in this repo.

- **pstack**: cursor/plugins at `c742dd61706fbacc1b95f1a20b7b988cf096ce6c`, subtree `harness/pstack/claude-code`, verified against its git tree `cdbbd4ca5dd2f4ca0eef3294e7b981c0c610d4bb`. The tree goes to `.local/share/pstack`, and pstack's own bootstrap installs poteto-mode's script dependencies from their lockfile at build time, so a trial needs no registry.
- **pstack-placebo**: the rig's placebo arm of pstack. The plugin keeps its manifest (`.claude-plugin/plugin.json`) and one SKILL.md per skill from this folder's generator, with the default seed. Playbooks, references, scripts and agents are left out.
- **One rig-authored file in each**: `.claude/settings.json`, whose `env` block sets `CLAUDE_CODE_PLUGIN_DIRS` to `~/.local/share/pstack`. The Lane B agent loads the user and project setting sources, so Claude Code 2.1.312 reads it and loads the folder as a plugin, and `/pstack:poteto-mode` resolves with no runner change. Without the file the command does not resolve; a test checks both. Step 1's review rig passes the same folder as `--plugin-dir` instead.
- Directories are 0755, as in the other arms, because the trial runs Claude Code as root.

Run `bun quick/laneb/arms/stacks.ts [out-dir]` (default `~/.capy/work/laneb-arms`) after cloning cursor/plugins at the pin under the rig's `<state>/sources/` (on Capy, `~/.capy/work/gstack-evals/sources/`). It needs docker, bun, git and network at build time. Every tar and gzip runs in the pinned builder image. It also fetches the Claude Code binary the trial runtime pins into `<out>/claude-code/` for the tests. A rebuild from an empty install cache on 2026-10-31 gave byte-identical tars.

| Arm | Tar sha256 | Tree digest | Files | Skills |
| --- | --- | --- | --- | --- |
| pstack | `41a563830efca091a6c66ae37dfa37e83806105362843a382c9cefe9403a0ed6` | `97469e0b744a47bb0309caccf568f1cb7267c7b675cf1a61e544335a1354378e` | 1,607 | 58 |
| pstack-placebo | `0081750d87baa10d02b2822929807505a00adceed58610b05717be4935cbc157` | `6d22ef104b6371d7835294d6ab64766df761ca1774537083ac4f94bfd83f104b` | 60 | 58 |

Both tar.gz files are kept by digest outside this repo, with a SHA256SUMS file.

The placebo's 58 bodies land within one token of pstack's (ratios 0.9545 to 1.0000; the smallest body has 22 tokens). Five skills take words the procedural-marker check flags from their own names or descriptions (for example "never" in principle-never-block-on-the-human, "your" in show-me-your-work), and the generator uses those words as topic terms. The front matter keeps them anyway. The test runs the marker check on the prose with the topic terms removed.

The told prompt opens with the arm's command, as in quick look 3: `/investigate ` for gstack and its placebo, `/pstack:poteto-mode ` for pstack and its placebo. `../runner/skill-map.stacks.json` maps each of quick look 3's 40 tasks to that skill, per arm. Quick look 3's runner (tag `laneb-quick-3-runner`) reads one map per batch and invokes only the arms named gstack and placebo, so the stacks runner commit has to pass each arm its own map and invoke every arm but none.

`LANEB_STACK_ARMS=<out-dir> bun test quick/laneb/tests/stacks.test.ts` checks, on the built tars: each tar against its manifest and the pin; the told line in each arm, in a real Claude Code 2.1.312 session against a fake upstream, with that arm's poteto-mode body in the first model request and pstack's body never in the placebo's; no expansion once the settings file is removed; poteto-mode's bootstrap and watch-pr with the registry pointed at a closed port; and the placebo's files, front matter, prose and token counts. Without the built tars those tests skip, and the skill map tests still run.
