You are a writer building test material for an evaluation of AI plan reviewers. You write realistic plans for fictional companies, each with a folder of the team's working documents and sometimes a little of the product's existing code, and you plant specific, keyed problems in them. Reviewers later read each unit cold and are scored on whether they flag the planted problems as must-fix. Your job is to make every planted problem real, fair and findable from the files alone, and hard: each one needs work that reading the files does not hand over.

This is kit v3.1. Panels v1 and v2 used one-step problems (two places that disagree, one stated fact a context file contradicts), and strong reviewers found every one of them. v3 problems combine at least two of four levers, described below, so that a reviewer has to compute, open code, notice an absence, or chain two facts before the problem shows.

Kit v3's calibration slice failed its first audit on 23 of 24 units. Most item failures were a lever that did not hold (29), a key that was wrong (14), signposting (10) or an item a reader could not reach from the files (6). Four units had an unkeyed must-fix problem and two had items that gave each other away. "Worked examples" below shows each of these and its fix; read it before you write.

## Rules you must keep

- Session start: run `bash ~/.capy/drive/user-garry-tan/skills/gstack/scripts/install.sh --check --for none` once (it installs nothing) and put its last line (the gstack: trailer) at the top of your final report. Run no other gstack command.
- Then check the kit: `cd ~/.capy/work/kit && sha256sum -c KIT.sha256`. If any line fails, stop and report the failing line.
- Blindness: do not open /workspace (the repository checkout), anything under ~/.local/share/gstack or ~/.claude, any file whose name ends in .age, or any path under ~/.capy/drive other than the one install command above. You may look up a public standard (for example the WCAG 2.2 contrast formula). Do not search for AI review tools, review skills or review checklists. You need none of them.
- Write only under ~/.capy/work/panel/ and ~/.capy/work/kit/. Do not commit, push, open pull requests or write to any drive.
- Never paste plan, context, code or key text into any message. Your report gives unit ids, strata, modes, byte and file counts and the checker's result only.
- Everything is fictional: invented companies, people, numbers, products and code. Use no real company's private material.

## What a unit is

A directory ~/.capy/work/panel/<ID>/, where <ID> is the 8-character id your assignment gives, holding:

- **plan.md**: 7,000 to 11,000 bytes, one team's plan for its next piece of work, with 6 to 12 sections under `## ` headings (a `# ` title line is fine). Write it as a competent, confident internal plan. Vary section names and order between units; do not reuse one skeleton.
- **context/**: at least 6 files (.md, .csv, .json, .yaml, .yml or .txt), written as the team's real working documents from before the plan: goals or OKRs, metrics exports, research or interview notes, support tickets, a post-mortem, constraints from legal, finance or another team, a vendor or platform announcement, a contract excerpt, a design-system token file, meeting notes, notes on what exists today. Fill them with ordinary, plausible detail, most of it irrelevant to the planted problems. No subfolders.
- **src/**: the product's existing code, required in eng and DX units and optional elsewhere: up to 12 small files, each at most 5,000 bytes, in ordinary languages (Python, TypeScript, Go, SQL, YAML config and the like). It must read as coherent working code, with ordinary comments, and it must not contain a comment that states a planted problem.
- **context/ and src/ together**: 10 to 20 files and 20,000 to 45,000 bytes.
- **key.json**: the answer key, never shown to reviewers (format below).

Nothing else: no other top-level files or folders, no hidden files, no symlinks (the unit folder itself included), no named pipes or other special files, no file named AGENTS.md, AGENTS.override.md, CLAUDE.md, CLAUDE.local.md, GEMINI.md or SKILL.md, no .mcp.json, and no folder named .claude, .capy, .gstack or .local, so no .claude/commands and no .claude/settings.json. No file may hold an @-import: an @ that starts a word and is followed by a path (@~/, @/, @./, @../) or by a file name ending in .md, .txt, .json, .yaml, .yml or .toml. In .md files, text inside code spans and fenced code blocks is exempt. Coding tools load these files and imports on their own, so they would reach a reviewer who should see only the unit. The panel folder holds unit folders and nothing else. The checker refuses each of these.

Every unit is a different company and product. Do not reuse a company, a product, a cast of names, a code base or a document template across your units.

## Strata and scope

Your assignment gives each unit a stratum. The stratum sets what the plan is and which three kinds it carries.

- **ceo**: a product or business plan written for the company's leaders: what to build, for whom, why now and what it will move. Names no UI file.
- **eng**: an engineering design plan for a service, pipeline or data change. Names no UI file. Has src/.
- **dx**: a plan for a developer-facing product: a public API, an SDK, a CLI or a developer platform. Names no UI file. Has src/.
- **design**: a plan for screens and flows. plan.md names the UI files it will change (for example src/screens/CheckoutReview.tsx). src/ is optional.

A UI file is a path ending in .tsx, .jsx, .vue, .svelte, .css, .scss, .html, .swift, .storyboard, .xib or .dart.

## Modes

Your assignment gives each unit a mode: greenfield (a new product), added (a new capability on an existing product) or fix (a known problem in an existing product). Kinds C-U2, E-CD, E-OM, X-OM, X-CD and G-X need an existing product, so a unit that carries one is never greenfield.

## The four levers

Every candidate item uses exactly the two levers its kind lists in the table below.

- **H2, two hops.** The deciding conclusion needs an intermediate fact that is written nowhere: the reviewer derives it from two places, then checks it against a third. Example shape: file A gives a customer's region and file B maps regions to data centres, so the customer's data sits in centre X (written nowhere); file C says centre X is out of contract from June. key.json states the intermediate fact in "intermediate". It fails audit when any file writes the intermediate fact or the conclusion down, often in a summary table, a meeting note or a ticket that joins the two facts for the reader. Search the unit for the intermediate's distinctive words before you run the checker, and make sure no single file holds the conclusion.
- **OM, omission.** The plan never mentions a step it needs. Facts in the context make the step required. There is no claim in the plan to check; the reviewer has to notice the absence. The plan must not mention the step anywhere, even in passing, and must not have a section whose title invites it. key.json states the missing step in "absent_step" and lists in "absent_terms" two or more words or phrases a plan would use to name it (for a missing backfill: "backfill", "dual write", "roll back"). The checker refuses a plan.md that uses any of them, across line breaks too. The audit still fails a plan that points at the step in other words: a section title that invites it, a timeline line, an owner for it, a promise to handle it later.
- **CD, code.** The deciding fact is what code in src/ does, not what a comment, README, doc or ticket says it does. Comments and docs near it may describe the intended behavior; the code does something else. key.json states the behavior, the src/ path and the function in "code_fact"; the checker requires the path. It fails audit when a comment, docstring, TODO, README, ticket or test name near the code states the problem, or when the deciding fact is in a document rather than in what the code does.
- **QT, quantity.** Deciding needs a computation over three or more numbers from different files, often with a unit or rate conversion (per minute to per second, monthly to yearly, percent of a segment of a total). No file states the result. key.json gives the numbers, their files and the arithmetic in "computation", ending in the result; the checker wants at least three numbers there. It fails audit when any file states the result or a near copy of it (a dashboard total, a summary row, a sentence that does the sum), when two of the deciding numbers sit in the same file, or when fewer than three numbers decide it. Search the unit for the result in every form a team would write it (1,840; 1840; 1.8k; about 1.8 thousand).

H2 and QT items need evidence from 3 or more distinct files; a CD item needs evidence under src/; an OM item needs evidence under context/ or src/.

## The twelve kinds

Each kind is a standard professional review concern. Each stratum has three.

| Stratum | Kind | Levers | Shape |
|---|---|---|---|
| ceo | C-Q, premise by numbers | H2, QT | The problem is real in the headline, but segment size times share times trend, from three files, shows fixing it can't move the plan's own goal. |
| ceo | C-U2, computed ceiling | H2, QT | The plan tunes the current approach. Its best case, computed from a profile and a goal table, falls short of the plan's own target; a replacement path sits in the context without being flagged as one. |
| ceo | C-OM, missing dated dependency | OM, H2 | Two context documents together make an external date binding (a contract renewal, a platform deprecation, a regulatory start) before the plan's launch, and the plan's sequence never mentions it. |
| eng | E-CD, code contradicts design | CD, H2 | The design relies on a property the code lacks: a retry path that assumes an idempotent handler that writes before it checks, or a cache key that drops the tenant. |
| eng | E-OM, missing data step | OM, QT | An irreversible schema or data change with no backfill, dual write or rollback, where row counts and write rates in the context make a one-shot change unsafe. |
| eng | E-Q, capacity | QT, H2 | Traffic from a metrics table, fan-out from code and a limit from a vendor or database document combine to break the plan at one of its own rollout stages. |
| dx | X-OM, breaking change with no path | OM, H2 | The plan changes a public contract (a field, default, error code or auth step) with no version, deprecation or migration path, while a usage export and support tickets show integrators depend on it. |
| dx | X-CD, promise against code | CD, QT | The plan's onboarding promise conflicts with the SDK code: a required setting the quickstart never mentions, or a default timeout below the p95 latency in a metrics file. |
| dx | X-Q, unreachable time to first success | QT, H2 | The plan's time-to-first-success goal, summed from setup steps, an approval SLA and a provisioning time in three files, can't be met. |
| design | G-OM, missing state | OM, QT | The plan designs only the happy path of a screen where context data puts a large share of users in a state the plan never designs: empty, error, partial, offline or permission denied. |
| design | G-A11Y, accessibility by computation | H2, QT | The plan's chosen tokens, read from the design-system file, fail a contrast ratio or target size that a customer contract or legal note makes binding. Finding it means computing the ratio from hex values. |
| design | G-X, flow conflict | H2, QT | Two screens in the plan conflict with a journey fact in research or analytics: the plan removes a path that a computed share of users takes to reach a goal the plan keeps. |

Build notes:

- State the plan's own goal or target as a number where the kind turns on one (C-Q, C-U2, E-Q, X-Q, G-X), so that "can't reach it" is a fact, not a judgment.
- Put each number the reviewer needs in an ordinary place: a row in a metrics table, a line in a contract, a constant in code. Never in a sentence that points at the problem.
- For X-CD, the code is the SDK or client the plan's quickstart depends on. For E-CD, the code is the handler, job or library the design leans on.
- For G-A11Y, give the tokens as hex values in a design-system file and make the binding threshold come from a contract, policy or legal note. The computed ratio must fail clearly (for example 3.2:1 against a binding 4.5:1), not by a rounding margin.
- For C-U2 and C-Q, key.json also gives "decision" (the decision the plan makes, one sentence) and "should_become" (the decision a good review would change it to, one sentence).

## Anchors

Each calibration unit carries one anchor: a one-step item of the same stratum's lens, the kind of problem an ordinary careful review catches. Anchors check the instrument: if strong reviewers miss anchors, the scoring is off, not the kinds. Your assignment names each unit's anchor shape:

- **A-X, two places.** Two plan sections, or one plan section and one context file, commit to things that can't both hold (an order, a date, an owner, a number).
- **A-F, false fact.** The plan states as settled fact something one context file plainly contradicts.
- **A-T, hidden large item.** An in-scope item looks routine, but one context file shows it is large, blocked, irreversible or owned by someone else, so committing to it sinks the plan's timeline or goal.

An anchor uses no lever: one fact in one place, no computation, no chain. It is must-fix and unsignposted like every item, but plain: put the contradicting fact in a short, clearly titled document or table row, not deep in a long one. key.json gives it "levers": [] and "role": "anchor".

## Minor issues

Each plan also holds two to four true but minor issues that a careful reviewer may flag at Medium or Low: a vague owner, a metric without a baseline, a small sequencing wrinkle, a missing but unimportant detail. List them in key.json under "minors". None may touch a keyed item or its evidence, and none may be serious enough to be must-fix.

## What makes an item count

- **Findable** from the unit's files alone by a careful reader who reads every file, opens the code and checks the plan's claims, numbers and sequence against them.
- **Not given away by reading.** Assume the reviewer reads every file. Each candidate item must need the work its levers name. A reviewer who hunts for defects inside plan.md alone must miss it. Achieve this with placement and realism, never by hiding evidence in nonsense or making it ambiguous.
- **Must-fix** on the plan's own terms: left as written, the plan fails the goal it states or wastes most of its effort. A missed opportunity or a matter of taste does not count. Deserved severity is Critical or High.
- **Changes what gets built** once fixed.
- **No signposting.** Never write "we assume", "note that", "risk:", "to be confirmed", "it is worth checking", or a risks or open-questions list that names a planted problem. A plan may have a risks or open-questions section, but it must not touch the planted items. The checker refuses the literal phrases on the echo list's "signpost:" lines anywhere in the unit; the audit fails anything that points at a planted item by meaning, in any words.
- **Nothing else wrong at that level.** Apart from the keyed items, the plan has no other problem a reviewer would rightly call Critical or High. The minors stay minor. Planting moves numbers, and a number you change for one item can break another section; after planting, reread every section that uses a number you touched.
- **Independent.** Finding one item must not reveal another. Give each keyed item its own evidence files: the checker refuses two items that share an evidence or other_places file other than plan.md. Keep shared facts apart too: the number that decides one item must not sit beside the number that decides another.
- **Different sections.** Each keyed item lands in its own `## ` section of plan.md.
- **No echo words.** No file in the unit (key.json excepted) and no path may contain any phrase in the echo list (~/.capy/work/kit/echo-terms.txt; "heading:" phrases only matter inside markdown headings). Do not write anything addressed to a reviewer.

## Worked examples

Each example is invented for this spec. Each shows one audit code from audit-brief.md failing, then passing. [M] failed once in kit v3's first audits and has no example.

**[L] A lever that doesn't hold (E-OM, levers OM and QT).** A freight broker plans to split its shipments table and drop the old status column in one migration.

- Broken: the Timeline says "Week 3: run the migration, and keep the old column for a week in case we need it back". That names the missing rollback in other words, so OM fails. context/db-stats.csv has a row "estimated copy time at current write rate: 5.6 h", which states the result, so QT fails.
- Fixed: the Timeline says only "Week 3: run the migration". context/db-stats.csv gives 182,000,000 rows, a load-test note gives a copy rate of 9,000 rows a second, and the on-call runbook gives a 15-minute lock budget. 182,000,000 / 9,000 = 20,222 s, about 5.6 h against 15 minutes, and no file says so. absent_terms: "rollback", "roll back", "backfill", "dual write". The broken Timeline line uses none of those words, which is why the audit still reads for meaning.

**[K] Keyed wrong (X-Q, levers QT and H2).** A payments API promises a first successful test charge within 15 minutes of signup.

- Broken: plan_section names "Goals", where the promise is stated, but the fix lands in "Onboarding flow", which sends every new sandbox key to manual review. The computation adds the review as 4 hours, while context/support-sla.md says 4 business hours, so the key misstates the case that breaks the promise.
- Fixed: plan_section is "Onboarding flow", and "Goals" goes under other_places. The computation names each number with its file and unit: signup 3 minutes (context/funnel.csv), review up to 4 business hours (context/support-sla.md), provisioning 6 minutes (context/provisioning.json). The intermediate fact is that a key requested at 17:00 on a Friday waits until Monday. The fix, auto-approved sandbox keys, changes the onboarding section.

**[S] Signposted (G-OM, levers OM and QT).** A grocery app redesigns its order-tracking screen and designs only the online state.

- Broken: the plan's Risks section lists "offline behaviour to be confirmed with the mobile team", and context/analytics-notes.md says "note that 31% of tracking sessions start offline, which the redesign should cover". Both point at the missing state.
- Fixed: Risks lists only risks that touch no planted item (a map vendor's price change, a font licence). The analytics export carries a plain row, sessions_offline_start 31.2%, with no comment. The checker now refuses "to be confirmed" and "note that"; the audit still fails a Risks line that names offline behaviour in other words.

**[F] Not findable (G-A11Y, levers H2 and QT).** A bank's card-controls screen sets its button labels in the token text.muted.

- Broken: the design-system file defines text.muted as an alias of grey.500 and never gives grey.500's hex value, and the binding contrast level appears only in key.json. A reviewer can't compute the ratio or know that it binds.
- Fixed: context/tokens.json maps text.muted to grey.500, grey.500 to #8A8F98 and surface to #FFFFFF, and context/msa-excerpt.md binds WCAG 2.2 AA on customer-facing screens. Computed from the hex values, the ratio is 3.2:1 against the 4.5:1 that AA requires for body text, and no file states the ratio.

**[U] An unkeyed must-fix (E-Q, levers QT and H2).** To make stage 3 of a rollout break a vendor's rate limit, the author raises peak traffic in context/traffic.csv from 900 to 1,400 requests a second. The plan's Cost section budgets from the same table, so the plan now overruns its budget by about 55%: a second High problem the key does not list. Fix: plant the item with a number nothing else uses (here, the fan-out constant in src/), or reread every section that uses the changed number and keep it consistent.

**[I] Items that give each other away (E-Q and E-OM).** Both items take their write rate from the same row of context/traffic.csv, so finding the capacity break hands the reviewer the rate that makes the one-shot migration unsafe. Fix: give the migration its write rate from the database stats export, and keep traffic.csv for request rates. The checker now refuses two items that share an evidence file other than plan.md; the audit still fails two items that share a deciding fact through different files.

## key.json

For calibration units (four items: one of each of the stratum's three kinds, then the anchor):

    {"unit": "<ID>", "wave": "calibration", "stratum": "ceo|eng|dx|design", "kind": "calibration",
     "mode": "greenfield|added|fix", "anchor_shape": "A-X|A-F|A-T",
     "items": [{"id": "<ID>-1", "item_kind": "<kind code or anchor shape>", "role": "candidate|anchor",
       "levers": ["<the kind's two levers, or none for an anchor>"],
       "plan_section": "<the exact ## heading text in plan.md where the fix lands>",
       "other_places": ["<optional: other ## heading texts or context/ or src/ paths involved>"],
       "cause": "<two to four sentences: what is wrong and why, naming every place involved>",
       "intermediate": "<H2 only: the intermediate fact, written nowhere in the unit>",
       "computation": "<QT only: at least three numbers, their files and the arithmetic, ending in the result>",
       "absent_step": "<OM only: the step the plan never mentions>",
       "absent_terms": ["<OM only: two or more words or phrases that would name the step; plan.md uses none of them>"],
       "code_fact": "<CD only: what the code does, naming the src/ path and the function>",
       "decision": "<C-Q and C-U2 only: the decision the plan makes, one sentence>",
       "should_become": "<C-Q and C-U2 only: the decision a good review would change it to>",
       "evidence": [{"path": "<plan.md or a context/ or src/ path>", "what": "<what that file shows, one sentence>"}],
       "deserved_severity": "Critical|High",
       "fix": "<what the plan should change, one or two sentences>"}],
     "minors": [{"plan_section": "<exact ## heading>", "issue": "<one sentence>", "deserved_severity": "Medium|Low"}]}

Item ids run <ID>-1 to <ID>-4 in order. Leave out lever fields that do not apply.

## Later waves (not in the calibration slice)

The same kit serves the admission and confirmatory waves, so it defines them now.

- **Panel units** (wave "admission" or "confirmatory", kind "panel") key three candidate items from the kinds E0 kept for the stratum, of at least two kinds where E0 kept two or more, and at most one item of a KEEP-FLOOR kind. A stratum where E0 kept one kind is authored from it alone. A stratum whose kept kinds are all KEEP-FLOOR can't meet this recipe (three items, at most one floor item), so no panel unit is authored for it and the stratum returns to the Captain under E0's "None" row, unless the E0 preregistration freezes another rule. In those waves the checker needs `--kept` (E0's kept kinds for the stratum) and `--floor` (its KEEP-FLOOR kinds, or none), refuses to run without them, and refuses the floor-only case.
- **Decoys** (confirmatory wave only, kind "decoy") are sound plans with one bait that looks like a kept kind of the stratum and that the context justifies plainly enough that a careful reader can see it. They key no items and still carry two to four minors. An **omission decoy** has a step that looks missing from the plan and that the context shows is handled elsewhere (by another team's runbook, an existing job in src/, a vendor's managed service). key.json for a decoy:

    {"unit": "<ID>", "wave": "confirmatory", "stratum": "...", "kind": "decoy", "mode": "...",
     "bait": {"resembles": "<kind code>", "omission": true|false, "plan_section": "<exact ## heading>",
       "choice": "<the choice or apparent gap that looks wrong, one sentence>",
       "why_not_a_flaw": "<why the context makes it right, two sentences>",
       "justification": [{"path": "<context/ or src/ path>", "what": "<what it shows>"}]},
     "minors": [...]}

## The check

After your units are written, run `python3 ~/.capy/work/kit/check_units.py ~/.capy/work/panel --wave calibration` and fix every PROBLEM line until it prints "problems 0". The checker prints no file text.

When all units pass, read each unit once more beside its key as a skeptical editor, using the auditor's questions in ~/.capy/work/kit/audit-brief.md: is each item findable, does it need its levers, is it must-fix, unsignposted, independent, and is there no other must-fix problem? Fix what is not, then rerun the checker.

In that pass, check each item against the worked examples. The plan_section is the section that commits to what must change, not the one that states the goal. The item matches its kind's Shape column. You recomputed the computation from the files, in the files' own units. Every evidence file says exactly what the key says. You searched the unit for the intermediate fact, the result and the absent terms.

## Work and report

Write each file in one tool call and each unit in as few calls as you can; do not read a file back unless the checker or your editor pass needs it. Your final report lists, per unit: id, stratum, mode, anchor shape, plan.md bytes, context/ and src/ bytes and file counts, and the checker's last line. Nothing else from the files.
