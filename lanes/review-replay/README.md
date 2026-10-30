# Review replay lane

This lane asks one question: does a gstack reviewer role catch a known historical defect, at which model and effort, and at what cost (plan v3.2, "Review replay lane"). This folder holds GSTA-131's review replay panel, vendored, and the catalog of historical-defect cases that the lane replays and U14 grows. Nothing here calls a model.

## The panel

panel/ is the panel GSTA-131 built and ran while sizing gstack's review depth (garrytan/gstack#3527). It replays single reviewer prompts on two public gstack cases.

- panel-cases.json: case 1 (gstack #3516, the ship-hook-actor negation guard that refused honest requests) and case 2 (gstack #3518, lib/ship-queue-train-verify.ts reading an unreadable GitHub state as "not merged"): PR, reviewed head, merge base, which reviewer caught what, and the evidence.
- build.ts: renders the panel's 15 prompts (fix-check and specialist prompts over the cases' ranges, plus two clean-code items) from a gstack checkout.
- eval1/: GSTA-131's first preregistration (bars B1 to B4), its items, the frozen prompt digests and the per-trial results table. Verdict: B1 missed, 0 of 3 for c1-statemachines-range and for c2-fixcheck at medium effort; the decoys passed.
- eval2/: the attribution run, with a full-pass control (A1) and an effort control (A2). c2-fixcheck caught the defect 2 of 3 times at high effort against 0 of 3 at medium, which set "blocking reviewers stay at full effort" in gstack.
- measured-tokens.json: median specialist output tokens (full 6,929, light 5,446), the input gstack's scripts/review-dispatch-compare.ts reads with --tokens.

The results tables score names_known_file with a grep on the known file name only; GSTA-131 scored catches by hand (right file and the defect named).

### What is not here

- Case 3 of the source panel-cases.json is a harness-evals case, a private repo, so none of its text is committed. It is withheld with this digest: sha256 `33e1b474e63b22a1f9ca11d4312512c187679081f8059f069f55d3a6c2dc3cbf` over the UTF-8 bytes of `JSON.stringify(cases[2], null, 2)`, where cases is the parsed source file, with no trailing newline. The committed file is `JSON.stringify(cases.slice(0, 2), null, 2)`, which matches the source's own formatting (the source is `JSON.stringify(cases, null, 2)` with no trailing newline).
- Rendered prompts. They are gstack text and render from a checkout, so panel/*/prompts/ is gitignored.
- Per-trial results (results/*.json, model output text) and the pilot files. They stay in the org drive at handoffs/gsta131-review-replay/eval1/results/ and eval2/results/.
- GSTA-131's run.ts. The lane's runner is rebuilt, not vendored.

### Reproducing the prompts

The prompts depend on the gstack checkout: the specialist prompts read review/specialists/<name>.md from its working tree, and the fix-check prompts import its scripts/resolvers/fix-check.ts. All 17 frozen prompts (7 in eval1, 10 in eval2, 2 of them shared) reproduce byte for byte at gstack `148d28ea81b7be4daad89d91b911c9efd85391eb`, the squash merge of #3527 on main. They also reproduce at a0b4c08edc2b9f2e3f6f70d13b4d53a78fa7de3c, the last commit of #3527's branch. build.ts pins the first.

    git -c credential.helper= clone https://github.com/garrytan/gstack.git ../gstack
    git -C ../gstack checkout 148d28ea81b7be4daad89d91b911c9efd85391eb
    bun lanes/review-replay/panel/build.ts --gstack ../gstack --check lanes/review-replay/panel/eval1
    bun lanes/review-replay/panel/build.ts --gstack ../gstack --check lanes/review-replay/panel/eval2

--check renders into a scratch dir and compares every prompt the eval's frozen file lists with the rendered file of the same name. It prints one OK or DIFF line per prompt and exits 1 on any difference. It never writes the frozen file or the eval dir, and it refuses a checkout at any other HEAD. If build.ts says commits are missing, fetch refs/pull/3516/head and refs/pull/3518/head from garrytan/gstack.

`--out <dir>` renders the prompts for a run. It refuses to overwrite a prompt file whose bytes differ, so a rerun cannot replace frozen prompts. To run an item, render into eval1/prompts or eval2/prompts; items.jsonl paths are relative to the eval dir.

Two things had to change to reproduce the prompts. git sizes abbreviated object names by the clone's object count, so the diffs' index lines differed in a fresh clone; build.ts now runs git with core.abbrev=9, the length GSTA-131's checkout used. And frozen2.sha256 lists eval 2's eight new prompts under prompts2/ while the drive kept all ten under prompts/; the items now point at prompts/<item>.md, and --check matches by file name. The drive's prompts match both frozen files by file name.

This folds GSTA-11's rerun precondition 9 and coverage gap G8: the reproduce step checks the frozen digests instead of overwriting them, and build.ts has a reproduction check. tests/replay/panel.test.ts covers both without a gstack checkout: the digest comparison, the overwrite refusal, and a --check refused off the pin that leaves the eval dir untouched.

### Digests

Every committed panel file, with its source in the org drive's handoffs/gsta131-review-replay/. tests/replay/panel.test.ts recomputes the committed digests and checks that every panel file is listed.

| File | sha256 as committed | Source | Source sha256 |
|---|---|---|---|
| `panel/build.ts` | `86354be25321eece058bc39a59351d748465aac8e57947b7bf88a731eecab970` | build.ts and build2.ts, changed | 6886718c0c3c31abc0f2fa3ea04ac8557c519c6f000bd18b2ca5297ae5428e71 and 4d83a3ec021d5745bf3afbe5fea1ca52b4d13e42b29aa03d84758a95a45a4dd9 |
| `panel/eval1/frozen.sha256` | `5f77b6b629b31dba1f08521aabe199037ba47bcfc1f008db3411e01c9ef59cd3` | eval1/frozen.sha256 | same bytes |
| `panel/eval1/items.jsonl` | `7088c46cacba4d328fd11fb51310a8361965f819e7af47aa91fc05985745cb09` | eval1/items.jsonl, prompt_file rewritten | 71a4c272d1ac4557cbe0360be686e5ce2317b3d1c7839b5ea333716029c43cc9 |
| `panel/eval1/prereg.md` | `daf92b34a5a296005aa14b84c88507aa5613f95e1f9319593aa98d76f7dbce49` | eval1/prereg.md | same bytes |
| `panel/eval1/results.tsv` | `57c05096a91fa662a096b29bc69d423705da3cae4334b1fc8f004324a2a2dc4c` | eval1/results.tsv | same bytes |
| `panel/eval2/frozen2.sha256` | `4bc08dc72118aad1a3f411b61bce51eaf7d876a1614ffa605fd250178be210b5` | eval2/frozen2.sha256 | same bytes |
| `panel/eval2/items2.jsonl` | `b7dbe8abc386d13dd5ad2a0d310135246535f73f16535c786eb0d1b83f22c536` | eval2/items2.jsonl, prompt_file rewritten | 55ca166dadad25638347924eba050710907a9999b71b9031795fb41f3514dabd |
| `panel/eval2/prereg2.md` | `60d04ee58c273f552fa52b025b84729a405c2e7e56026a14a070352d196b199e` | eval2/prereg2.md | same bytes |
| `panel/eval2/results.tsv` | `c0e1c3d00d2a68ebfd826cdce0931b2923e48737a705d9d2011784085c2e52c5` | eval2/results.tsv | same bytes |
| `panel/measured-tokens.json` | `ea719656c8787a756a214784fd56b55bbd590bdaf87c0c6c35169b1ab486eb37` | measured-tokens.json | same bytes |
| `panel/panel-cases.json` | `fcda04b4c4ea4467c9d1d32798f446720841d88bec360df4f598bb60a5144d7c` | panel-cases.json, cases 1 and 2 only | 3d715edc88a9c2fbfa7f71f070fd32383a7c88710ab837122706229c9629b1ae |

## The catalog

catalog/schema.json (JSON Schema 2020-12) describes one case per file, named <id>.json. A case records the repo and PR, the reviewed head and merge base as full shas, the diff range the replayed reviewer reads, the reviewer roles it replays (specialist with its checklist, red-team, fix-check), the known defect (file, line, summary), severity apart from detection, the fix commit and PR, its decoys, the receipt it came from, an answer-key audit, its shelf life and its credit.

catalog/catalog.ts loads a catalog dir. `loadCatalog(dir)` returns the valid cases and a list of problems: schema errors, a file not named after its id, a duplicate id, a sealed case in this repo's tree, and a decoy whose audit found a defect. Private cases use the same schema and live only in the sealed store.

**The decoy rule.** A decoy is the fix commit on the case's range, or a clean PR. It is scorable as clean only when its audit's verdict is clean, which `scorableAsClean(decoy)` implements. An audit records that someone checked for a later fix (later_fix_checked: true), what that later fix was if one exists, the verdict, who, when and how. A null audit means nobody has audited the decoy, and it is never scored as clean. GSTA-20 found why this matters: decoy y09 passed review and still held a real bug, fixed later inside a consolidated release (wiki/board/2026-10-29-gsta-20-review-replay-y09-correction). A decoy whose audit says holds-defect is not a decoy: validation refuses it and says to make it a defect case.

catalog/public/ holds two seeds from panel cases 1 and 2, with full shas resolved from gstack. Each has its fix commit as a decoy with a null audit, since nobody has audited them. Each shelf life starts at the fix PR's creation date from GitHub's API, and both are short: a short-shelf-life case counts only for models released before the PR first appeared. Case 1's deserved severity is CRITICAL, because the panel's evidence says the regression would fail a paid test case. Case 2's is null: every reviewer rated it INFORMATIONAL and the panel names no failing test or production break. Answer-key audits are null until U14 audits them. U14 adds more cases to public/.

## Credit and changes

The panel is GSTA-131's work: a gstack crew thread working for this repo's owner, whose gstack change is garrytan/gstack#3527 (merged). Its scripts were scratch files on GSTA-131's machine, so they have no source commit; the digest table above identifies every source file. The two cases were caught in GSTA-128's and GSTA-129's /ship review loops on gstack #3516 and #3518.

Changes on vendoring: build.ts's header lists its changes. The items files point at prompts/<item>.md relative to their eval dir instead of absolute paths on GSTA-131's machine. panel-cases.json keeps cases 1 and 2 only. Every other panel file is byte for byte. The catalog is new code for U13a.
