# Part A: arm installs, pins and home containment

Part A installs each arm's pack into a home directory, checks every installed byte against the pins in prereg.json,
writes arms-pins.json into the preregistration bundle, and scans every home for a unit's fix before that unit runs.
The code is in `arms/`; the tests are `tests/outcome-skills/h2h-arms*.test.ts`.

## The arm layer contract

This is what part S (sessions) and the lead build on.

- An arm's home is a host directory, `<homes>/<home arm>`, installed by `install`. gstack-oneline and gstack-qa use
  gstack's home (`HOME_OF`), so there are 8 homes for 10 arms.
- Inside a session container HOME is `/root` (`ARM_HOME`) and sessions run as root, as in the state machines and
  pstack-checks rigs. Every path a pack wrote (`.claude/...`, `.claude.json`, `.npm/_npx`, `.cache/ms-playwright`,
  `.gstack`) is relative to that HOME.
- Before a home is used, `checkHome(dir, readArmInstall(arm))` hashes it and refuses with E_H2H_HOME_DRIFT unless it
  matches arms-pins.json's `home_tree_sha256`.
- The home reaches a session image as one layer. `loadHomeVolume` checks the home and copies it into a fresh volume
  named `h2h-home-<home arm>-<12 hex of home_tree_sha256>`. The session image build mounts that volume read-only at
  `/h2h-home` and runs `HOME_COPY` (`cp -a --no-preserve=ownership /h2h-home/. /root/`) as root. A build can also copy
  the host directory directly; the volume is optional. The session's `/root` is then the unit image's own `/root`
  (usually `.bashrc` and `.profile`) plus the home. The Docker test empties `/root`, runs `HOME_COPY` and gets
  tstack's home back byte for byte.
- The none arm's home is empty and hashes to sha256 of the empty string, so its layer adds nothing.
- A home holds no runtimes. `RUNTIME_NEEDS` lists what each pack's README expects on PATH: bun 1.4.2 or newer and git
  for gstack's scripts and preambles, node 18 or newer for GSD's hooks, node and npx for agent-skills' chrome-devtools
  MCP server on B1 units, bash for the Superpowers and ponystack hooks, and python3 and gh for tstack's pull-request
  steps. Unit images may not have them. Part A builds no runtime volume; the lead or part S decides how sessions get
  them, and says so in the run record.
- agent-skills registers its chrome-devtools MCP server at user scope in `.claude.json`. If part S starts Claude Code
  with `--strict-mcp-config`, that server does not load, and agent-skills runs without the browser its docs describe.

## Commands

`arms/commands.ts` exports `commands`, which `h2h/cli.ts` loads (COMMAND_MODULES).

- `install --arm <arm> --home <dir> [--sources <dir>]` installs one home into an empty directory, in a throwaway
  container from the install image, and writes `<home>.install.json` and `<home>.install.log` beside it. It refuses a
  non-empty home. A failed step keeps the record and the log.
- `pins --out <file> --homes <dir> [--sources <dir>]` reads every home under `<dir>`, runs the pin checks and writes
  arms-pins.json.
- `contain-home --arm <arm> --home <dir> --unit <unit dir> (--tree <base tree> | --volume <tree volume> --image <image>)
  [--frame <file of unit dirs>] [--out <file>]` scans one home for one unit.

`--sources` is the directory of local clones (default `$H2H_SOURCES`, else `sources` beside the homes). A missing
clone is fetched from GitHub. Every refusal prints its code first. contain-home exits 12 on a confirmed hit
(E_H2H_HOME_LEAK, the unit drops for every arm) and 3 when the scan cannot finish (E_H2H_HOME_SCAN, the unit stays
dropped until a scan passes). Every other refusal exits 2.

## Install recipes

`arms/recipes.ts` holds one recipe per home. Each runs the install as the pack's README describes it, at
prereg.json's pins, inside `h2h-arm-install:<12 hex of its Dockerfile's sha256>`: node:24-bookworm and oven/bun:1.4.4
by digest, Claude Code 2.1.325 by npm integrity, and Playwright 1.65.0's Chromium system libraries. The container runs
with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and `DISABLE_AUTOUPDATER=1`, and the home is bind-mounted at
`/root`. The install script traces every step into one log and gives the home back to the caller's user.

| Home | Recipe |
|---|---|
| none | nothing |
| gstack | clone at the pin into `~/.claude/skills/gstack`, then `./setup`; prereg.json's CLAUDE.md section appended |
| gstack-pony | gstack's steps, then ponystack's marketplace and `claude plugin install ponystack@ponystack` |
| superpowers | `claude plugin marketplace add anthropics/claude-plugins-official` at the build pin, then `claude plugin install superpowers@claude-plugins-official` |
| agent-skills | its marketplace from the pinned tree, `claude plugin install agent-skills@addy-agent-skills`, then the chrome-devtools MCP server at user scope |
| gsd | `npx -y @opengsd/gsd-core@1.21.0 --claude --global` |
| pstack | cursor/plugins' marketplace from the pinned tree, then `claude plugin install pstack@cursor-plugins` |
| tstack | `cp -R <pinned tree>/skills/* ~/.claude/skills/` |

Each home was installed twice on the freeze date, from empty directories, and every one exited 0 both times.

## Where the post could not be followed as written

Each of these is also in arms-pins.json, in the arm's `deviations`.

1. Claude Code 2.1.325 refuses a local directory for the official marketplace: the name claude-plugins-official is
   reserved for GitHub sources from the anthropics organization. It also refuses a commit sha as a marketplace ref
   (only a branch or tag). So the marketplace is added from GitHub, and its clone is reset to the commit read on the
   freeze date (`BUILD_PINS.official_marketplace`, b5b01ac4) before Superpowers installs. The pin check confirms the
   clone's HEAD and tree.
2. Claude Code uses a local directory marketplace in place (its install location is the path you give). So pstack,
   agent-skills and ponystack's pinned trees are copied into `~/.claude/plugin-sources/<name>` inside HOME, where a
   session can still find them.
3. agent-skills' marketplace names its plugin source as GitHub with no ref, which would fetch today's head. The build
   rewrites only that `source` field to `./`, the pinned tree itself, and records the file's sha256 before and after.
4. Claude Code's plugin copy rewrites agent-skills' link `.opencode/skills` from `../skills/` to `../skills`. The pin
   check applies the same trim before it compares trees.
5. The GSD installer writes a random heredoc nonce into about 280 files on every install. The hash rule replaces it.
6. chrome-devtools-mcp is pinned at 1.13.0 (the latest on the freeze date, by npm integrity) instead of `@latest`, and
   runs with `--headless` (no display in a session) and `--executablePath /opt/h2h/chromium` (the shared browser).
7. `npx` gets `-y`, so GSD's installer does not wait at a prompt.
8. The CLAUDE.md section for gstack and gstack-pony is appended on the host after the container exits, from
   prereg.json's frozen text.
9. gstack is fetched at depth 1 from the local clone at the pin, with origin set to GitHub, instead of cloning
   GitHub's head.

## The home tree hash

`home_tree_sha256` is sha256 over the sorted list of (path, git mode, content sha256) for every file and link in a
home. Links are hashed by their target text and never followed. The frozen rule (`HASH_RULE`) came from installing
every home twice and diffing the two runs. Its lines cover only what differed between those runs:

- skipped: `.claude/backups/**` (Claude Code's timestamped config backups), `.npm/_cacache/index-v5/**` and
  `.npm/_logs/**` (npm's cache index and logs, which record times), `**/.git/index` and `**/.git/logs/**` (stat data
  and reflog times), and gstack's `bin/.gstack-cso-build.log`.
- JSON keys dropped: `firstStartTime`, `machineID` and `userID` in `.claude.json`; `installedAt` and `lastUpdated` in
  `installed_plugins.json`; `lastUpdated` in `known_marketplaces.json`; `appliedAt` in GSD's install state;
  `timestamp` and `files` in GSD's file manifest (it lists every file's hash, which the tree hash already covers, with
  the nonce in it); `cached_at` in gstack's gbrain status cache.
- text replaced: GSD's `GSD_..._ARGS_END_<32 hex>` nonce, and the time at the end of each line in `.gstack/installs.tsv`.
- added after the freeze-date runs: `.claude/plugins/.last_inuse_sweep`. Claude Code writes this file, holding only the
  time, when it loads plugins and finds in-use markers to sweep, at most once a day. Whether a `claude plugin` command
  gets that far before it exits varies from run to run, so any plugin home (superpowers, agent-skills, pstack,
  gstack-pony) can have it or not. Neither freeze-date run wrote it in any home, and part S's end-to-end install wrote it
  in superpowers' home, which then drifted from arms-pins.json by this file alone. Skipping it changes no recorded
  home's hash.

With this rule all 8 homes hash the same in both runs. Everything a pack installed (skills, plugins, hooks, settings,
MCP entries, exec bits) still changes the hash, which the unit tests check.

## Pin checks and newer_seen

Each arm's `pin_checks` say how its installed bytes were matched to the pin: a checkout's HEAD, tree and clean
status (gstack, the official marketplace), or a copied tree hashed as a git tree with attributes off (plugins,
marketplaces, tstack's skills directory). An npm package is matched by its integrity. Every check matched.

`newer_seen` records each pinned repository's default-branch head and latest release tag, read with `git ls-remote`,
and npm's latest version for npm pins. Unauthenticated GitHub API reads hit their rate limit on this machine, and
`git ls-remote` has no such limit. Latest releases come from github.com's `/releases/latest` redirect. One thing to
know: gstack's latest release tag, v1.99.4.0, points at 81fb9008, not the pinned commit 3805969, even though the pinned
commit's VERSION file also reads 1.99.4.0. The pin is prereg.json's and was not changed.

## Home containment

`contain-home` runs the state machines eval's three needle sets over a home: fix lines, test-side markers and hidden
test names, each filtered against the unit's base tree. `sh/scan-home.sh` reads every file raw and streams every git
object store object by object, because packed objects are compressed on disk. Archives are found by their leading
bytes (gzip, tar, zip, xz, bzip2) and opened two levels deep; a deeper archive, or one that will not open, is listed
in the record and does not fail the scan, as the state machines contain.sh already does. A hit keeps its path and the
needle's sha256, never the text.

The frozen idiom rule calls a hit an idiom when it is a test name of 12 characters or fewer, or when the needle
appears in at least 3 repositories of the unit's frame that are unrelated to the unit's repository. Part A reads "the
frame" as the patch text of the frame's converted unit directories, passed with `--frame`. Two repositories are
unrelated when their owners differ and their names differ, so forks and same-owner repositories do not count, and lines
are compared trimmed. Any other hit is confirmed.

A run on the freeze-date homes with a fixture unit found no hits. GSD's home took 8.0 s and opened all 103 of its
archives; gstack's took 9.4 s and streamed its git store; the others took under a second.

## Not tested

- `npx -y chrome-devtools-mcp@1.13.0` starting offline from the warmed npx cache in agent-skills' home, under
  `--network none`.
- Any home inside a real unit image, with that image's runtimes. That is part S's driven launch.
