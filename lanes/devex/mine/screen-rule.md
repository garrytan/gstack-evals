### 14.2 Screen rule, verbatim

1. Candidate identifiers come from the PR title, PR body and closing-issue bodies (HTML comments and URLs removed): backticked spans of 3 to 60 characters (dropped if they hold more than 4 words), --flags, /endpoint/paths, snake_case tokens, dotted tokens that do not end in a file extension, identifier( calls, and "<repo name> <subcommand>" taken from lines in fenced code blocks. From the PR diff (REST pulls/{n}, diff media type, first 300 KB), backticked spans and --flags on added lines of files whose path matches DOC_PATH or a cli/cmd/commands/flags/args/options path.
2. A candidate is dropped if it is shorter than 4 characters, in STOP or CC_TYPES or FLAG_STOP, purely numeric, a version, an issue ref or a hex hash; if it holds any of < > = + " ' , ; * ; if it has a space and is not of the form "word subcommand"; if it has a / and does not start with /, ends in a file extension, or has more than 5 slashes; if it ends in a file extension; if it starts with test_ or ends in _test(s), or holds more than 4 underscores. Duplicates (case-insensitive) are dropped.
3. Specificity: df = the number of window items (issues and discussions created, PRs merged in [release, release + 60 days], excluding the unit itself) whose title or body matches the token. Tokens with df above max(3, 10% of window items) are dropped. The rest are sorted by df ascending, then length descending, and the first 6 kept. (The brief asked for frequency in window titles; titles alone let generic build flags and common words through, so I measured over titles and bodies.)
4. Matching: case-insensitive, token not preceded or followed by a word character or hyphen.
5. Score = outside issues (author association NONE, CONTRIBUTOR, FIRST_TIMER or FIRST_TIME_CONTRIBUTOR) created in the window whose title or body matches any kept identifier + outside discussions likewise + merged PRs in the window whose title or body matches one and that change a file matching DOC_PATH or have a title matching \b(docs?|documentation|readme|help|error messages?|errors?)\b. Help text and error strings inside code are not detected (no diff read for window PRs).

Regexes and lists (screen.py):
```
OUTSIDE = {"NONE","CONTRIBUTOR","FIRST_TIMER","FIRST_TIME_CONTRIBUTOR"}
DOC_PATH = re.compile(r"(^|/)(docs?|documentation|website|site|guide|guides)/|(^|/)readme[^/]*$|\.(md|mdx|rst|adoc|txt)$|(^|/)(help|errors?|messages|locales?|i18n)[/._]|(help|usage|errors?|messages?)\.[a-z]+$", re.I)
STOP = set("""the and for with this that from into when then than true false null none self main test tests todo note json yaml toml http https html true file files path paths name type types value values data config option options error errors return returns string number object array list default install update create delete remove added adds support issue issues docs readme python node rust golang crate crates package packages module modules version release feature fix bug code src lib bin cmd cli api new old foo bar baz example examples""".split())
BT = re.compile(r"\x60([^\x60\n]{3,60})\x60")
FLAG = re.compile(r"(?<![\w-])--[a-z][a-z0-9-]{2,}")
EP = re.compile(r"(?<![\w.:/])/[a-z][\w-]*(?:/[\w{}:.-]+)+")
SNAKE = re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b")
DOT = re.compile(r"\b[a-z][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+\b")
CALL = re.compile(r"\b([A-Za-z_][\w.]{3,})\(")
FENCE = re.compile(r"\x60\x60\x60.*?(?:\x60\x60\x60|$)", re.S)
FILEEXT = re.compile(r"\.(py|ts|tsx|js|go|rs|md|json|yaml|yml|toml|java|rb|txt|sh|cfg|lock|html|css)$", re.I)
FLAG_STOP = set("--locked --check --release --all --workspace --verbose --help --version --fix --frozen --frozen-lockfile --no-deps --manifest-path --all-features --all-targets --dry-run --force --quiet --debug --no-verify --watch --coverage --cov --tests --lib --bins --deny --write --save-dev --global --update".split())
CC_TYPES = {"feat","fix","chore","refactor","perf","test","tests","docs","build","style","revert","ci","deps","release"}
```

