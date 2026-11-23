# Shared frame rules for the devex and design evals (frozen copy)

A frozen copy of the frame the devex eval's free supply count wrote for both evals on 2026-11-09, so the design eval's preregistration carries its own record of the rules it draws from. Counts only: no repository names, pull request numbers or quoted text. Sources, by sha256:

- the shared frame, whose section 1 is part A below: 30d44b38e9de26fd426c4e9db273fc8b8e15dd5cffe18d7bf9774d399da93dbb
- the supply count, whose section 12 is part B below: 982868d0cf2e08d9d9ffe7b3ee8a140ebecee7754e8bd7d4f581f2ecb05f4ecb
- the exclusion digests, part C below: d44493a5727f70a4bddce46b8cf8e5f58073c410ad3c83331284c7160e8fc9f1

Parts A and C are verbatim. Part B is verbatim except 3 lines that set the count's scratch paths, left out. In part A, "supply-count-raw.md section 12" means part B, "read-digests.txt beside this file" means part C, and "the screen pilot below" is the devex eval's own screen pilot, which its preregistration describes.

## A. The frame

**Repositories.** Public GitHub, at least 500 stars, not a fork, not archived, pushed on or after 2026-10-01. Licence from GitHub's SPDX field, two tiers: permissive (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0, ISC, 0BSD, Unlicense, CC0-1.0) and copyleft (GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0, AGPL-3.0), copyleft under sealed custody with nothing redistributed and no network service run. Each eval says which tiers it draws from. Repository source: a topic-search union, two sides (developer-facing topics; UI topics in web, mobile and desktop strata), recorded with its date. It is a lower bound: repos without topics are missed.

**Unit.** One merged pull request into the default branch, with:
1. created on or after 2026-07-01 and merged 2026-07-01 to 2026-09-30 (UTC);
2. not a fix, revert, docs, chore, dependency, release, CI-only, refactor, test-only or translation change (title and label filter; a title starting feat/add/support/new/introduce/allow/implement isn't dropped for a docs or test word);
3. at least 2 non-test source files or at least 40 added non-test source lines;
4. plan text: the PR body plus its closing issues hold at least 120 words in their earliest recoverable versions dated before the merge (the count used current bodies, an upper bound);
5. released: the first non-draft GitHub release, else the first tag, whose commit contains the merge (the miner checks git ancestry; the count used publication dates). Each eval sets its own window from that release;
6. at most 3 units a repository for each eval.
Earliest exposure (PR opened, closing issues opened, earliest commit) is recorded for each eval's per-model leak marking.

**Developer-facing versus UI, and exclusive assignment.** The miner first applies the count's mechanical class rules (title, labels, cleaned body and changed paths; supply-count-raw.md section 12) as a prefilter. Because spot checks found them loose (a perf change read as SDK, a formatting change as CONFIG, a branch merge through the title filter, and 365 of 1,244 passing units in the developer sample classed neither side), each candidate is then labelled by a frozen model classifier: Opus 5.5 and GPT-6.1 Sol independently, Gemini 4 Argon settling a split, reading only the title, body, closing issues and changed-file list (nothing dated after the merge). Labels: developer-facing with a primary class (CLI, API, SDK, CONFIG; BREAKING as a tag), UI with a class (WEB, MOBILE, DESKTOP), both, or neither. A unit labelled both goes to the UI side when its UI-file added lines are at least half its added non-test source lines (the count's mechanical file rules), otherwise to the developer-facing side. No unit serves both evals. Draws are seeded (seed 20261109, order sha256(seed + newline + owner/repo#number)).

**Excluded from both draws.** The 14 units the count read in full (digests in read-digests.txt beside this file), plus any the screen pilot below reads.

## B. Mechanical rules

All regexes are Python re. Title and label filter (units.py):
```
EXCL = r"\b(fix(es|ed|ing)?|bugs?|bugfix(es)?|hotfix(es)?|chores?|docs?|documentation|readme|typos?|bump(s|ed|ing)?|deps?|dependenc\w*|refactor\w*|clean ?ups?|lint\w*|format(s|ted|ting)?|ci|tests?|testing|releases?|released|revert(s|ed)?|translations?|i18n|l10n|changelog)\b"
EXCL_KEEP = r"\b(fix(es|ed|ing)?|bugs?|bugfix(es)?|hotfix(es)?|chores?|typos?|bump(s|ed|ing)?|deps?|dependenc\w*|refactor\w*|clean ?ups?|lint\w*|format(s|ted|ting)?|ci|releases?|released|revert(s|ed)?|translations?|i18n|l10n|changelog)\b"
KEEP_START = r"^\s*(\[[^\]]*\]\s*)?(feat|feature|features|add|adds|added|support|supports|new|introduce|introduces|allow|allows|implement|implements)\b"
```
A title matching KEEP_START (case-insensitive) is excluded only if it matches EXCL_KEEP (EXCL without the docs and test words); any other title is excluded if it matches EXCL. A PR is excluded if any label name matches EXCL. Search query per repo: `repo:R is:pr is:merged base:<default branch> merged:2026-07-01..2026-09-30 created:>=2026-07-01`, split by month or 10-day slices if over 1,000.

Word count: PR body plus closing-issue bodies (first 5), after removing HTML comments, markdown images and URLs; a word is a match of `[A-Za-z][A-Za-z0-9'_-]*`.

File and class rules (analyze.py):
```
SRC_EXT = set("py pyi js jsx mjs cjs ts tsx mts cts go rs java kt kts scala swift m mm c h cc cpp cxx hpp hh cs fs rb php dart ex exs erl hs ml mli clj cljs lua zig nim jl r vue svelte astro html htm css scss sass less sql proto graphql graphqls gql sh bash ps1 tf sol elm vala groovy pl qml ui xaml axaml cr gleam".split())
NONSRC = re.compile(r"(^|/)(vendor|third_party|third-party|node_modules|dist|\.github|docs?|website/docs)/|\.min\.(js|css)$|\.generated\.|\.gen\.|_generated\.|\.pb\.go$|_pb2(_grpc)?\.py$|\.pb\.(h|cc)$", re.I)
TEST = re.compile(r"(^|/)(tests?|__tests__|specs?|testdata|test-data|fixtures?|e2e|__mocks__|mocks?|testing|integration[-_]tests?|__snapshots__)/|(^|/)test_[^/]*\.py$|_test\.(go|py|rs|rb|exs?|dart|cc|cpp|c)$|\.(test|spec|e2e|cy)\.[a-z0-9]+$|(^|/)[^/]*Tests?\.(swift|kt|java|cs|scala)$|(^|/)conftest\.py$|\.snap$", re.I)
ANDROID_LAYOUT = re.compile(r"(^|/)res/layout[^/]*/[^/]+\.xml$")
UI_DIR = re.compile(r"(^|/)(components?|pages|app|views?|ui|screens?|layouts?|templates?|widgets?)/", re.I)
WEB_EXT = {"tsx","jsx","vue","svelte","astro","html","htm","css","scss","sass","less"}
MOB_SWIFT = re.compile(r"(view|screen|controller|cell|sheet|ui)[^/]*\.swift$|/(views?|screens?|ui)/[^/]*\.swift$", re.I)
MOB_KT = re.compile(r"(screen|activity|fragment|view|composable|dialog)[^/]*\.(kt|java)$|/ui/[^/]*\.(kt|java)$", re.I)
MOB_DART = re.compile(r"(^|/)(widgets?|screens?|pages?|views?|ui|components?)/[^/]*\.dart$|_(page|screen|view|widget|dialog)\.dart$", re.I)
MOB_RN = re.compile(r"(^|/)screens?/[^/]*\.(tsx|jsx|js|ts)$", re.I)
DESK = re.compile(r"(^|/)(src-tauri|renderer|electron)/|\.(qml|ui|glade|xaml|axaml)$|(window|dialog)[^/]*\.(cpp|cc|h|hpp|py|cs|rs|vala|c)$", re.I)
UI_NOUN = re.compile(r"\b(page|pages|screens?|views?|dialogs?|modals?|buttons?|forms?|panels?|sidebar|menus?|tabs?|toolbar|navbar|navigation|layout|ui|ux|components?|tooltips?|toasts?|dropdowns?|popover|drawer|cards?|tables?|charts?|theme|dark mode|light mode|icons?|widgets?|window|tray|onboarding|dashboard)\b", re.I)
BRK_LABEL = re.compile(r"breaking", re.I)
BRK_TITLE_BANG = re.compile(r"^\s*\w+(\([^)]*\))?!:")
BRK_BODY = re.compile(r"breaking[ _-]?changes?|\bBREAKING\b", re.I)
BRK_NEG_BEFORE = re.compile(r"\b(no|not|non|without|any|n't|none)\b[\s\w-]{0,12}$", re.I)
BRK_NEG_AFTER = re.compile(r"^[\s:*_)-]{0,6}(none|no|n/a|nope|false)\b", re.I)
BRK_TITLE_RM = re.compile(r"\b(remove[sd]?|removing|rename[sd]?|renaming|deprecate[sd]?|deprecating|drop(s|ped|ping)?)\b.*\b(commands?|subcommands?|flags?|options?|endpoints?|methods?|settings?|apis?|arguments?|args?|parameters?|params?|config\w*|functions?|fields?|properties|property)\b", re.I)
CLI_PATH = re.compile(r"(^|/)(cmd|cli|commands?|subcommands?|bin)/|_cmd\.[a-z]+$|(^|/)cmd_[^/]+$|(^|/)(cli|__main__)\.(py|ts|js|go|rs|rb|mjs)$", re.I)
CLI_TITLE = re.compile(r"\b(commands?|subcommands?|cli|flags?)\b|(^|\s|\x60)--[a-z][a-z0-9-]+", re.I)
CLI_BODY = re.compile(r"(?im)^(?=.*\b(flags?|options?|arguments?|cli|commands?|subcommands?)\b).*(^|[\s\x60(])--[a-z][a-z0-9-]{1,}")
API_PATH = re.compile(r"(^|/)(routes?|routers?|handlers?|controllers?|endpoints?|resolvers?|rpc)/|(^|/)(routes?|router|urls|endpoints?|handlers?|controllers?)\.[a-z]+$|openapi|swagger|\.proto$|\.graphqls?$|\.gql$", re.I)
API_TITLE = re.compile(r"\b(endpoints?|routes?|rest|graphql|grpc|rpc|webhooks?|http api)\b", re.I)
API_BODY = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE)\s+/[\w{}/:.-]*|\b(new|add(ed|s)?)\s+(an?\s+)?(endpoint|route)\b")
SDK_PATH = re.compile(r"(^|/)(index\.(ts|js|mjs|cjs)|mod\.rs|lib\.rs|__init__\.py)$|\.d\.ts$|(^|/)(sdk|include)/", re.I)
SDK_TITLE = re.compile(r"\b(methods?|functions?|hooks?|class(es)?|types?|interfaces?|apis?|sdk|exports?|helpers?)\b|\w\(\)", re.I)
SDK_BODY = re.compile(r"\b(new|add(s|ed)?|expose[sd]?|export(s|ed)?)\s+(a\s+|an\s+|the\s+)?(public\s+)?(method|function|hook|class|type|interface|api)\b", re.I)
CFG_PATH = re.compile(r"(^|/)(config|configs|configuration|settings)(/|\.[a-z]+$)|\.schema\.json$|(^|/)\.env(\.[a-z]+)?$|(^|/)(defaults|options)\.[a-z]+$", re.I)
CFG_TITLE = re.compile(r"\b(options?|settings?|config|configs|configuration|configurable|env(ironment)?\s+var(iable)?s?|preferences?)\b", re.I)
CFG_BODY = re.compile(r"\b[A-Z][A-Z0-9]{1,}_[A-Z0-9_]{2,}\b")
DEV_ORDER = ["BREAKING","CLI","API","SDK","CONFIG"]
UI_ORDER = ["DESKTOP","MOBILE","WEB"]
```
- Source file: extension in SRC_EXT (or an Android res/layout XML), path not matching NONSRC or TEST. Size rule: at least 2 source files or at least 40 added source lines. Relaxed: at least 1 source file and at least 15 added source lines.
- Body for class detection: HTML comments, unchecked task-list lines (`- [ ] ...`), fenced code blocks and lines starting with `$ ` removed.
- BREAKING: a label matching BRK_LABEL; or the title matching BRK_TITLE_BANG or BRK_TITLE_RM; or a body match of BRK_BODY not preceded within 30 characters by BRK_NEG_BEFORE and not followed within 20 characters by BRK_NEG_AFTER.
- CLI, API, SDK, CONFIG: any non-test, non-NONSRC changed path matching the class PATH regex, or the title matching the class TITLE regex, or the cleaned body matching the class BODY regex. Primary = first match in order BREAKING, CLI, API, SDK, CONFIG.
- UI file tests: web_file = extension in WEB_EXT, or .ts/.js/.mjs under UI_DIR. mobile_file = .swift matching MOB_SWIFT, .kt/.java matching MOB_KT, Android res/layout XML, .dart matching MOB_DART, a path matching MOB_RN, or any .tsx/.jsx in a repo with topic react-native-app or react-native. desktop_file = path matching DESK, or a web_file in a repo of the desktop stratum.
- A UI class applies when at least one source file of that kind changed and the title or cleaned body matches UI_NOUN. WEB is not set for a file that is also a desktop file, or a mobile file in a React Native repo. Primary = first of DESKTOP, MOBILE, WEB.
- Assignment: only developer-facing classes -> developer-facing; only UI -> UI; both -> UI if added lines in UI files are at least half of added source lines, else developer-facing; none -> neither.
- Cap: within a repo and side, units are ordered by sha256(seed + newline + owner/repo#number) and the first 3 kept.
- Release: the earliest non-draft release with publishedAt at or after mergedAt (prerelease allowed, recorded). If the repo has no releases at all, the earliest tag whose commit date is at or after mergedAt. Buckets: by_0909 (on or before 2026-09-09), by_0930, by_1015, later, none. Continuous delivery: no releases and no tag dated 2026.
- Frame strata: desktop if any topic in desktop-app, electron-app, tauri-app, desktop-application, macos-app, electron, tauri; else mobile if any of android-app, ios-app, flutter-app, react-native-app, mobile-app, swiftui, jetpack-compose, android-application; else web if any of web-app, webapp, dashboard, self-hosted, react, nextjs, vue, svelte, angular, tailwindcss, web-application, admin-dashboard, react-app, pwa.
- Developer-facing topics used: cli, command-line, command-line-tool, terminal, sdk, api, rest-api, graphql, grpc, api-client, http-client, library, framework, web-framework, developer-tools, devtools, build-tool, package-manager, compiler, linter, static-analysis, testing, orm, database, kubernetes, terraform-provider, infrastructure-as-code, devops, llm, ai-agents, mcp, mcp-server, python-library, rust-library, go-library, npm-package, command-line-interface, cli-tool, openapi, javascript-library, typescript-library, java-library, developer-tool, ai-agent, mcp-servers. Added to the brief's list: command-line-interface, cli-tool, openapi, javascript-library, typescript-library, java-library, developer-tool, ai-agent, mcp-servers (developer side); web-application, admin-dashboard, react-app, pwa, android-application, desktop-application, macos-app, electron, tauri (UI side).

## C. Units excluded from both draws

Each line after the seed is sha256(seed + newline + owner/repo#number) of a unit the count read in full.

```
seed 20261109
89276d64722519d3002fe420ff3e222e1b52669ec42d8390d45275f07cfbd15e
7eebf271b9baf33eb41f16a113da637db21d03cd44109e4dc64124faa0ae16ea
8c4a6c28fd7a45c918c8a8d0b078610431fa8a87d0f4388ada7f4b407022c9b3
f20b38ec28f3fc65d8cc7bee260a9ac3f8c73774a005bbd947f24ac5f5d9f6da
5c693abc6a85c9c09a59b1e5ad00407885d3a783b519dcdb58b656567a53afdb
508ca87faf3eb43aa5e2898b57cde9e206a41f26cef84f36d4cfb5fbee3a4081
565bfbacdf2ca3639c616e218c46eb468ee528e5d602e7356b0b0a17c6cab452
046397868efb0f110393d23ef5344b466f74e4e9704ce1fc224b82c39c3cc263
fadf8006175915ade7f4d25d70bcb937bca1d58322994e29d7f068c65a07242b
39506da438846951cfe25adbdb91faf0884de144770f243dc036c7d15ff85d9a
5a370895cc62ec4abede204550b05029ff6157cf47abc4f5f9edd6a335e4beba
4b76d66e54e73d169dc70a3bed367cfa9cf082f95571ccc37d60eac9efc06359
6e229639eab596a302466fc8271249c3a61a9613290ee906c05e71b52e8b9547
7074373f63c0c36b03032ff16fef18e8c6fc248b6de9cc15c140a40b4034e22c
```
