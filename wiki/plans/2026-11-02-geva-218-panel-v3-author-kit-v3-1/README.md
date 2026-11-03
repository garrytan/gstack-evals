---
id: 2026-11-02-geva-218-panel-v3-author-kit-v3-1
kind: design
title: "Planning panel v3 author kit v3.1: checker holes closed, auto-loaded files refused, spec tightened from the first audits"
summary: "Kit v3.1 supersedes kit v3: the checker refuses symlinked units, pipes, auto-loaded files and @-imports, reports malformed keys, and the spec adds worked examples."
author: GEVA-218
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: done
supersedes:
  - 2026-11-02-geva-202-panel-v3-author-kit
links:
  - 2026-11-02-geva-165-planning-panel-v3-plan
  - 2026-11-02-geva-202-panel-v3-author-kit
  - tests/panel-kit-v3-1.test.ts
source: "Built by GEVA-218 (issue GST-1071) from kit v3 (#158, ee4a61f, kit digest 6f21a709), the four outside-voice findings #158 shipped as skipped, #166's open note R3 and GEVA-202's first-audit counts."
attachments:
  - 4ed951fb525d16bcc8456f1fb6132ec0b3c0cb43a938f7d9214aba37113ef6e6  KIT.sha256.txt
  - 22b900bd1bacb4928167fffb2d9fba8af1956886960baa1861ca636d8f2e339f  author-spec.md
  - 10c15ee29c725960ae49b41e43efcd5375a38a25bf948c929a6c8ca478bb8ff0  audit-brief.md
  - d790df3fc9ee59fa328e551578b5b7a0d33d516f2377bf503f76a302c398f225  check_units.py.txt
  - a3ac8b97504afc9b2118a1d8a34b6201d9826b57308a303440b142803a19957a  draw.py.txt
  - 61f3b2d8c835f3838f5aea748584938bbc9713fc4b6b7a52cc70419a0246045f  echo-terms.txt
---

# Planning panel v3 author kit v3.1

Kit v3.1 replaces kit v3 for every v3 authoring wave still to come: the admission units for E1, the confirmatory units and the decoys. The calibration slice was written and audited under kit v3, and its eight pending units finish under kit v3. Like kit v3, this kit holds no unit, key or assignment.

It closes the four checker holes #158's outside voice found, refuses the files a coding CLI loads on its own (#166's open note R3), adds five checks drawn from kit v3's first audits, and tightens the author spec and the audit brief where those audits failed, with a worked example for each top failure code.

## Kit digest

The procedure is kit v3's. The kit is the five files below. KIT.sha256 lists their sha256 in name order, as `sha256sum` prints them, and the kit digest is the sha256 of KIT.sha256 itself:

    sha256sum author-spec.md audit-brief.md check_units.py draw.py echo-terms.txt > KIT.sha256
    sha256sum KIT.sha256

In this bundle the two scripts and the manifest carry a .txt suffix (check_units.py.txt, draw.py.txt, KIT.sha256.txt), as in kit v3, so the post stays a document; their bytes are the kit's. To check the kit from the bundle, copy those three files without the suffix beside the other two and run `sha256sum -c KIT.sha256`.

Kit digest: **4ed951fb525d16bcc8456f1fb6132ec0b3c0cb43a938f7d9214aba37113ef6e6**

Every authoring wave copies the five files and KIT.sha256 to each author's and auditor's machine, and each agent runs `sha256sum -c KIT.sha256` before it starts and stops if a line fails. A change to any file is a new kit version in a new post.

| File | Change from kit v3 |
|---|---|
| author-spec.md | Refused files, how each lever fails audit, absent_terms, independent evidence, worked examples, a stricter editor pass. |
| audit-brief.md | Calibration on the worked examples, lever and key sub-codes, notes for [S], [I] and [U], counts per code in the report. |
| check_units.py | The fixes and checks below, `--write-fixtures`, a larger self-test. |
| draw.py | None: byte-identical to kit v3's. |
| echo-terms.txt | Kit v3's 192 terms unchanged, plus 10 signpost terms and a header note. |

## What changed in the checker

### The four holes from #158

- **Symlinked unit root.** Kit v3 listed unit folders with a test that follows symlinks, then walked the link's target, so a unit folder that was a symlink to a clean tree passed. Kit v3.1 refuses a unit folder that is a symlink, and any entry in the panel folder that is not a unit folder.
- **Named pipe.** Kit v3 opened every entry that was not a folder, and opening a named pipe blocks for good. Kit v3.1 reads each entry's type without following links and refuses anything that is not a regular file or a folder, before it opens anything.
- **Malformed key values.** Kit v3 sorted and hashed key values without checking their type, so a levers list holding a number or an object, an item_kind or plan_section given as a list, a candidate with no item_kind, or a key.json nested too deep stopped it with a traceback. Kit v3.1 checks each value's type first and reports a problem. Its self-test puts ten malformed values into every item, key, minor and bait field (780 cases) and checks that none crashes it.
- **Wrapped echo terms.** Kit v3 matched echo terms one line at a time. Kit v3.1 matches "any:" terms across one line break, also when the next line starts with a comment or quote marker (#, //, /*, *, --, ;, >), and matches "heading:" terms in setext headings (a line underlined with = or -) as well as # headings. A blank line still ends a phrase.

### Auto-loaded content (#166, R3)

Claude Code picks up CLAUDE.md and CLAUDE.local.md (at the root and in the subfolders it reads), the files a CLAUDE.md @-imports, .claude/commands, .claude/settings.json and the project MCP servers in .mcp.json from its working tree. Other coding CLIs do the same with AGENTS.md, AGENTS.override.md or GEMINI.md. Any of these inside a unit would reach an arm that should see only the unit. Kit v3.1 refuses:

- a file or folder named CLAUDE.md, CLAUDE.local.md, AGENTS.md, AGENTS.override.md, GEMINI.md, SKILL.md, .mcp.json, .claude, .capy, .gstack or .local, at any depth and in any case (code clean-room);
- an @-import anywhere in a unit's text: an @ that starts a word and is followed by a path (@~/, @/, @./, @../, @src/, @context/ or any path holding ../) or by a file name ending in .md, .txt, .json, .yaml, .yml or .toml (code auto-load). In .md files, code spans and fenced blocks are exempt, as they are for Claude Code's own imports; a fence closes only on a fence of the same character that is at least as long. Decorators, scoped package names and mail addresses don't match;
- a CLAUDE.md, or any other file, beside the units in the panel folder.

Kit v3 already refused .claude/commands and .claude/settings.json, through its .claude folder rule and its hidden-path rule, and CLAUDE.md, AGENTS.md, GEMINI.md and SKILL.md by name. Kit v3.1 keeps those rules, carries .claude/commands and .claude/settings.json as regression fixtures, and adds CLAUDE.local.md, AGENTS.override.md, .mcp.json, @-imports and the panel-folder rule.

### Checks drawn from the first audits

Each check turns part of an audit code into a refusal an author sees before audit. None replaces the audit, which still judges meaning.

- **absent_terms ([L] on OM).** Every OM item lists two or more words or phrases a plan would use to name the missing step, and the checker refuses a plan.md that uses any of them, across line breaks (lever-om).
- **Independent evidence ([I]).** Two keyed items may not share an evidence or other_places file other than plan.md (key-independent).
- **Signposts ([S]).** echo-terms.txt gains a "signpost:" scope holding the author spec's own phrases ("we assume", "note that", "risk:", "to be confirmed", "it is worth checking") and close variants, refused anywhere in a unit's text (signpost).
- **Computation ([L] and [K] on QT).** A QT item's computation names at least three numbers (key-field).
- **Code fact ([K] on CD).** A CD item's code_fact names the src/ file it describes (key-field).

### From the /ship review

- **Unreadable folders and files.** Kit v3 skipped a folder it could not list without a word, so a folder with its permissions removed could hide a CLAUDE.md, and it stopped with a traceback on a file it could not read. Kit v3.1 refuses both (clean-room, "cannot read"). tests/panel-kit-v3-1.test.ts checks this as a user other than root, because root can read every file.
- **Punctuation in absent_terms.** An absent_terms entry whose words are punctuation, such as x, then 80 spaced hyphens, then y, must not slow the checker down. The fixture below holds that entry and matching plan text, and the test requires its run to take less than 500 ms longer than the clean unit's.
- **More @-import forms.** An @ followed by src/ or context/, or by any path holding ../, is an @-import too, so `@src/mod1.py`, `@context/doc1.csv` and `@src/../../outside.py` are refused (auto-load).

### Fixtures, failing first

`check_units.py --write-fixtures <dir>` writes the clean self-test unit and each defect case kit v3.1 added, one panel folder per case. tests/panel-kit-v3-1.test.ts runs kit v3's and kit v3.1's checkers on every one, checks the kit digest and runs kit v3.1's self-test, so CI repeats this table on every push. The run on this branch:

| Fixture | Kit v3 | Kit v3.1 |
|---|---|---|
| clean | problems 0 | problems 0 |
| symlinked unit root | problems 0 | clean-room |
| named pipe | hangs (killed after 5 s) | clean-room |
| levers with a number | TypeError | key-levers |
| levers with an object | TypeError | key-levers |
| item_kind as a list | TypeError | key-kind |
| candidate without item_kind | TypeError | key-kind |
| plan_section as a list | TypeError | key-place |
| key nested too deep | RecursionError | key-json |
| echo term wrapped across lines | problems 0 | echo |
| echo term wrapped across comment lines | problems 0 | echo |
| heading echo as a setext heading | problems 0 | echo-heading |
| CLAUDE.local.md in context | problems 0 | clean-room |
| .claude/commands in the unit | refused (regression fixture) | clean-room |
| .claude/settings.json in the unit | refused (regression fixture) | clean-room |
| @-import line | problems 0 | auto-load |
| @-import after a longer fence holding a shorter one | problems 0 | auto-load |
| @-import after a tilde fence holding a backtick line | problems 0 | auto-load |
| @-import after a backtick line that is not a fence | problems 0 | auto-load |
| CLAUDE.md beside the units | problems 0 | clean-room |
| signpost phrase | problems 0 | signpost |
| plan names an absent term | problems 0 | lever-om |
| OM item without absent_terms | problems 0 | key-field |
| two items share an evidence file | problems 0 | key-independent |
| computation with two numbers | problems 0 | key-field |
| code_fact names no src file | problems 0 | key-field |
| absent term made of a spaced hyphen run | problems 0 | lever-om |
| @-import of a src file | problems 0 | auto-load |
| @-import of a context csv | problems 0 | auto-load |
| @-import out through src | problems 0 | auto-load |

`--self-test` now runs 832 cases: a clean unit, and one with @ signs in a code fence, a mail address and a decorator, pass; 43 broken units fail with the right code; 780 malformed key values report without a crash; plus three usage and four recipe cases.

## What changed in the author spec and the audit brief

The first audits of kit v3's 24 calibration units (GEVA-202, counts only) failed 23 of them. Item failures: L 29, K 14, S 10, F 6, M 1. Unit failures: U in 4 units, I in 2, and none on B, N, R, P or E. The Opus auditor (O, 12 units) recorded L 15, S 9, K 2, F 2, M 1, I 2 and U 2; the GPT-6.1 Sol auditor (S2, 12 units) recorded L 14, K 12, F 4, S 1 and U 2.

- **Levers [L].** Each lever now says how it fails audit and how the author checks it first: search for the intermediate fact (H2), list absent_terms (OM), name the src/ path and keep comments clean (CD), end the computation in its result and search the unit for that result in every written form (QT).
- **Keys [K].** The editor pass checks the plan_section (where the fix lands, not where the goal is stated), the kind's Shape column, and the arithmetic against the files, in the files' units.
- **Signposts, independence and unkeyed must-fix ([S], [I], [U]).** The spec says what the checker refuses and what the audit still judges by meaning, and asks authors to reread every section that uses a number they changed while planting.
- **Worked examples.** One invented example each for [L], [K], [S], [F], [U] and [I], broken and then fixed.
- **Audit brief.** Auditors calibrate on the worked examples, record which lever sub-test failed (lever_fail) and which part of a key was wrong (key_fail), and report counts per code and per sub-test. The two auditors split far apart on K (2 against 12) and S (9 against 1); the sub-codes will show at the next wave whether that split comes from the units or from the auditors.

## Pricing the admission wave

GEVA-202 measured these costs per unit from platform counters on the 24 calibration units: authoring 0.74M to 2.31M tokens by author (mean 1.64M); a first audit 1.57M on the Opus auditor and 0.74M on the Sol auditor (mean 1.16M); a re-audit 1.36M on Opus and up to 1.64M on Sol (about 1.5M); and about 1.0M per unit for each fix round (28.3M over 28 unit-rounds). So a unit that passes its first audit costs about 2.8M, each fix round adds about 2.5M (the fix plus a re-audit), and a unit that needs two rounds costs about 7.8M. The admission wave is 32 units if all four strata pass E0, 8 fewer for each stratum that doesn't. At kit v3's first-pass rate (1 of 24) the 32 units cost about 250M tokens; if every unit passed its first audit they would cost about 90M, and each unit kit v3.1 moves from two fix rounds to none saves about 5M. The plan's estimate of 50M (1.2M to author and 0.4M to audit a unit) is about a fifth of the measured rate. Custody comes on top: GEVA-202's custodian used 44.3M for 24 units (about 1.8M a unit), most of it polling a thread record, so a custodian that watches files should cost less. GEVA-202's counter turned 229.8M tokens into 75,791 credits, about 330 credits per million tokens, so 250M tokens is about 82,000 credits (about $82 at $1 per 1,000 credits) before custody and machines. Budget the wave at the measured rate, and count kit v3.1's effect once the admission audits report their first-pass rate.

## Limits

- draw.py draws the calibration wave only (`python3 draw.py calibration <public seed> <out dir>`). The admission wave needs its own assignment draw (authors, modes, the auditor split, OS-random labels) before authoring starts, and this kit does not supply one.
- The checker reads text, not meaning. It catches the literal signpost phrases, absent terms and shared files, but not a plan that points at a step in other words or two items that share a fact through different files. Those stay audit work, as the worked examples show.

## What stays out of the repo

Unit trees, keys, assignments, audit findings and the sealed bundles stay outside the repo, in the Captain drive under the authoring thread's handoffs/ folder with CUSTODY.md. Commits about any wave carry counts by stratum and kind, panel-wide size ranges and digests only (plan section 8). Nothing in this post comes from a sealed unit: the worked examples are invented, and the audit numbers are panel-wide counts.
