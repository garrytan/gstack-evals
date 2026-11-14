# Office-hours founder eval: authoring

This folder builds the eval's units: the constructed founders that make up the primary, and the real-history stratum that
reports apart. It implements the preregistration's section 3 (with the parts of sections 2, 7, 8, 13, 14 and 15 that
authoring touches). Every model call goes through an injected caller in the product-value meter's `CallRequest` shape, and
every W label through the shared `Labeller`, so the tests and the dry-run seams make no call. Units, notes, fetched pages
and Names lines are written only to a custody directory outside the repository.

## Modules

- `prompts.ts` holds the frozen text (story shapes, type phrases, industries, the author prompt and its CEILING line, the
  twin note, the recognition probe and its rewrite line, the 40 queries, the left-out hosts, and the source-note, T1 and T2
  prompts), each checked byte for byte against the prereg by `tests/of/author/prompts.test.ts`. It also holds the prompts
  the prereg describes but does not word: the audits, traceability, the probe judges, the type labels, the founder-page test,
  the rewrite note and the twin translation.
- `draws.ts` fixes each draw position's shape, type, industry and author family, picks the pilot, and orders a unit's facts.
- `files.ts` reads a writer's reply into `opening.md`, `sheet.json` and `key.json`, checks their shapes, computes the digest
  every check binds, and opens the custody sink.
- `screens.ts` holds the keyless text checks: the vocabulary screen, the copy check and the name scan.
- `checks.ts` holds the model-backed checks shared by both strata: the unanimous key, the give-away check, the constructed
  blind audit, the recognition probe, the generic screen and the type labels.
- `constructed.ts` runs one draw position from the author call through steps 2 to 6, with the one rewrite, and a calibration
  unit's second skin.
- `real.ts` runs the real stratum: the frame, the two-check terms gate, the serial miner, the founder-page test, notes, T1,
  T2, the copy check, traceability, the audit with the foreseeable rating, then the shared checks; then fame terciles and
  cutoff marks.
- `sets.ts` fills the quotas with their minimums, projects supply from the pilot (start rule 12), replaces a dropped
  comparison unit with a reserve, and fixes the comparison set's record.
- `run.ts` drives the constructed pass from the pilot to the quotas or the cap (and the CEILING redraw), and writes both
  strata under custody, returning counts and digests only.
- `fixtures.ts` holds invented, neutral fixtures and the scripted caller and labeller the tests and seams use.
- `seams.ts` exports the dry-run seams for every start rule 7 edge this area owns, both sides.
- `cli.ts` exports the area's paid commands, `of author` and `of real`, for the lane's command table.

## Commands

`gstack-evals of author --units <dir> --gstack <checkout> --item <ledger item> --spend-cap <usd> [--pilot
[--authoring-cap <usd>]] [--ceiling] [--resume [--twins]] [--concurrency <n>] [--record <dir>] [--ledger <path>]` runs the
constructed pipeline. `--pilot` runs the 4-unit pilot and prints its supply projection; without it the run goes on to the quotas or the cap. `--ceiling` is the
CEILING redraw. `--resume --twins` rebuilds a finished run from its sealed outcome log and makes only the second-skin calls
the twin rule still owes (build-time choice 22), refusing before any call if the log rebuilds unfilled sets or another
comparison digest. `--gstack` must be a checkout at the pin (HEAD, VERSION and the phase-2a file are all checked).

`gstack-evals of real --units <dir> --frame <json> --gstack <checkout> --item <ledger item> --spend-cap <usd> [--resume]
[--record <dir>] [--ledger <path>]` runs the real stratum.

Both refuse `--units` and `--frame` inside the repository, open one metered client on `--item`, and print counts and
digests only.

**The frame file is a Captain decision.** The prereg runs the 40 queries through "one web search tool" without naming
one, and no search key is configured. So `of real` reads the frame from `--frame`: a JSON object mapping each of the 40
frozen queries to its first 10 result URLs. It refuses a missing or unknown query and a query with more than 10 results.
Who produces that file, and with which search tool, is for the Captain to decide.

## What another area must provide

- The caller: the metered client with the ledger lease (`lanes/product-value/meter.ts` or a wrapper with its shape), and a
  `spent()` reading of the authoring lease's metered spend, which the pilot projection and the cap stop read.
- The `Labeller` for W labels, with the production brief.
- An `mdd(comparisonUnits)` function from the power script, for the E_OF_SUPPLY_SHORT message.
- The search and fetch functions for the real stratum, and a gstack checkout at the pin for `loadForcingQuestions`.
- A command entry, if the lane wants one; this folder exports functions and wires no CLI row.

## Build-time choices

1. **Draw schedule.** Positions run in rounds of six. Each round takes the six shapes in a seeded order, and each shape takes
   the next pair from its own seeded list of the types it allows crossed with the 24 industries. So every shape holds a sixth
   of the positions, s2 and s6 get only consumer and marketplace, and any prefix is the same whatever its length. A plain
   shuffle of all valid combinations would give s2 and s6 a tenth each, close to the comparison set's floor of 6 in 64.
2. **Slots in the author prompt.** `<shape>` takes the shape's sentence without its closing period, `<type>` the type
   phrase, and `<industry>` the industry. For a developer tool the industry slot reads "teams that build software for
   <industry>", which is how the prereg sets a developer tool among its industry.
3. **CEILING line.** It is appended to the author prompt after one space. The CEILING redraw uses the same schedule with ids
   starting `h`, runs no pilot, and redraws only the calibration and comparison sets (no reserves), as the band's
   wording names only those two. Its new calibration units get second skins under choice 22, because stage 1 reruns on
   them with its twin check.
4. **Pilot.** The pilot is the first draw position of each named type. Pilot units that pass join the sets in draw order like
   any other unit, so no passing unit is thrown away.
5. **Supply projection.** `needed` is the sum of the quotas (94). The projection is the spend so far plus the units still
   needed times the pilot's spend per passing unit. It fits when it is at most the cap. The comparison count that can fill is
   what the cap buys after calibration, twins and reserves. Spend comes from the authoring lease, not from summing replies,
   because labels are paid through the labeller.
6. **Seeded fact order.** A unit's facts reach the validators sorted by sha256 of the seed, the unit id and the fact id. The
   full-information reference may want the same function (`factOrder`).
7. **Reading a writer's reply.** A file starts at a line that names it (a heading, a bold line or a fence labelled with it);
   the file is the first fenced body in its section, or the section's text. A reply that is one JSON object keyed by file name
   is read directly. A reply that fails this or the shape checks is asked once more, then the draw drops at "author".
8. **Shape checks.** Constructed units must hold 10 to 16 facts with unique ids and listed kinds, 4 to 6 key facts all on the
   sheet, an alternative, and `mentioned` drawn from customer and wedge. Word limits are not enforced; the auditors read the
   unit as a whole.
9. **Asking again.** Any reply a check cannot read (an author reply, an audit, a trace, a probe answer, a probe judgment, a
   type label, notes, a founder-page answer) is asked once more with twice the token budget. The larger budget changes the
   request body, so the meter's reply cache cannot answer the second ask with the first reply. The validators' retry (no
   block, or an unlabelled W cell) works the same way and makes a fresh validator call.
10. **Credit.** A W item is credited when its cell is true and the block is not multi-target, as section 8 scores W. The
    validators must label the open items' cells and the multi-target cell; a null in any of them is "an unlabelled W cell".
11. **Mentioned flag early.** A key that marks both W items mentioned can never keep a primary item, so it drops before any
    check is paid. The primary rule itself (at least one W item neither mentioned nor generic) runs after the generic screen.
12. **Keyless part of audit check (b).** An alternative whose customer or wedge equals the key's, word for word after the
    word rule, fails (b) without an auditor call. The auditors still read every other unit.
13. **Unreadable audits.** An audit or trace reply that cannot be read after the second ask fails every check it covers, so
    the unit goes to its one rewrite or drops.
14. **Rewrite prompts.** A rewrite sends the writer's first prompt, its current files, then a note. For the vocabulary screen,
    the audits, the copy check and traceability the note is a fixed line followed by each failed check's text (and, for the
    vocabulary and copy checks, the matched words, so the writer knows what to change). For a recognition hit the note is the
    frozen probe line alone. A rewrite voids every logged result and reruns every check in order.
15. **Industry for a probe rewrite.** A constructed unit fills `<industry>` with its drawn industry. A real unit fills it with
    the invented startup's industry, which the traceability call reports, because nothing else records what T1 chose; the
    same answer fills the real unit's `industry` field.
16. **Word rule.** Every keyless text check lowercases text and turns each run of characters that is not a letter or a digit
    into one space. "office-hours" reads as "office hours", and "Acme's" still holds the word "acme".
17. **Forcing questions.** "The text of the six forcing questions" is each question's `**Ask:**` line in
    `phase-2a-startup-diagnostic.md` at the pin (sha256 `35ed1e41...a393`), read from a checkout and refused on any other
    sha256. The rest of each question's section (push lines, red flags) is guidance, not the question. Each Ask line and the
    lens arm's first line are read as one run of words, so a 5-word sequence may cross a sentence end inside them.
18. **What the vocabulary screen reads.** opening.md, the persona, each fact's text and reveal_when, and every string in
    key.json. Fact kinds are a fixed list and are skipped (the kind "status-quo" would otherwise fail every unit that uses it).
19. **Probe judging.** Every answered probe reply goes to both judges (Opus and Astra, medium effort); no keyless filter
    guesses at "don't know". On a constructed unit a guess counts when both judges list the same company. A judge reply that
    cannot be read is no judgment, so it cannot make a guess count. A probe call that fails twice is recorded as unanswered.
20. **Generic screen.** One label packet per judge holds stock rows 1 and 2. An item becomes generic when either judge credits
    it on either row. An unlabelled cell is no credit and is counted, as the product-value eval's screen does.
21. **Type labels and stage.** Opus and Sol each answer the type and the founder's stage (pre-product or has users) in one
    call, from the opening and the persona only. Argon settles either field when they differ. A unit left with no type drops;
    a missing stage stays null.
22. **Second skins.** The translation must keep the first skin's fact ids and key facts. It then passes steps 2 to 6 with no
    rewrite, and a skin that fails leaves its pair out of the twin check. Calibration units get skins in draw order until 8
    pass, so a failed skin passes its place to the next calibration unit; if fewer than 8 pass among all 16, the run ends
    short and names every failed pair. This replaces the prereg's "first 8 calibration units" by the Captain's pre-data
    ruling of 2026-11-12, made after 3 of the first 8 skins failed.
23. **Sets.** Quotas fill in draw order from passing first skins, by their labelled type. A unit joins a set only while the
    set's minimums can still fill in its remaining places; a unit held back moves on to the next set. Reserves take the rest in
    draw order. Passing units outside every set are not written as units; the sealed outcome log keeps them.
24. **Reserve replacement.** The first reserve in draw order replaces a dropped comparison unit, without re-checking minimums.
25. **Frame and sources.** One site (URL origin) is one source; its pages are its frame results in query and rank order, at
    most 3. No link is followed.
26. **First-person founder accounts.** After the terms gate allows a page and it is fetched, Sol answers whether it is a
    first-person account by a founder on the company's own site or a founder's personal site. Only those pages go to the
    notes, and a source with none leaves the frame. Host rules alone cannot tell a founder's post from a guest post.
27. **Real draw order.** Sources run in order of sha256 of the seed and the origin. T1 alternates by that position (Sol odd,
    Argon even), counting sources that never reach T1.
28. **robots.txt.** Our agent token is `gstack-evals`; its group wins over `*`. The longest matching rule decides and Allow
    wins a tie. A 404 or 410 allows every path; any other failure allows none.
29. **Terms page.** The gate tries `/terms`, `/terms-of-service`, `/terms-of-use`, `/tos`, `/legal/terms` and `/legal` in
    order and reads the first that answers 200 with text. A site with no readable terms page at those paths counts as
    forbidding. A clause forbids when one sentence holds a prohibition word and a word for automated reading, keeping a copy, or
    sending text to an outside model.
30. **Pages as text.** Pages are stored raw under custody and read as text with scripts, styles and tags removed.
31. **Names line.** Entries split on commas, semicolons and a standalone "and" or "&". The copy check bars every word of every
    entry, as written; the name scan and the probe match whole entries.
32. **Traceability output.** The tracer also lists the key facts that point toward the customer or the wedge, the source's
    opening and first-sale dates, and the invented industry. Key facts left on the sheet are key facts that are on the sheet
    and that the tracer lists as pointing; fewer than 2 drops at once.
33. **Rewrite from T2.** A real unit rewrites from T2 when every failure is in key.json: copy or vocabulary hits only in
    key.json, or only the key's traceability or audit checks. Otherwise it rewrites from T1 and T2 writes a fresh key.
34. **Foreseeable rating.** The drop needs both auditors to rate both W items "no". It drops at once, before any rewrite.
35. **Fame tercile.** The article title is the first Names entry. Units rank by summed monthly views; a unit with no article
    ranks lowest and always takes tercile 1.
36. **Cutoff marks.** Each model's cutoff comes from `lanes/product-value/cutoffs.json` (Opus, Sol and particle-1). A first
    sale stated as a year alone reads as that year's December; with no year, or no published cutoff, the mark is unknown.
37. **Efforts not stated in the prereg.** Traceability runs at high effort like the audits. The probe judges run at medium,
    like production labels. The type labels and the founder-page test run at default effort.
38. **One meter per command.** The ledger keeps one open lease per item, so a second meter on the same item is refused.
    The production labeller (score/judge.ts) therefore runs through the same meter as every other call, with the product
    value eval's version tap recording each judge reply's model version.
39. **Provider checks.** Every Argon reply, cached or not, must name Google Vertex, as the simulator's check does. A pin
    drift the meter catches on Sol or particle-1 is re-raised as E_OF_PROVIDER_DRIFT. Either stops the command; the lease
    settles first.
40. **One cap.** `--spend-cap` is both the lease's amount and the authoring cap that the pilot projection and the cap stop
    read. A pilot on its own ledger item leases its `--spend-cap` and projects against `--authoring-cap`, the full run's
    cap; only `--pilot` takes that flag.
41. **Resume.** `--resume` reuses `--units`, its run id and its reply cache, so settled calls replay at no cost. The spend
    of earlier launches is kept in `run.json` and counts toward `spent()`.
42. **The supply stop's MDD.** It is power.py's guard-rule MDD for Opus at its 2 passes, at the planning design of section
    12's part F: control rate 0.25, ICC 0.5, shuffled-key credit 0.05. Under 2 units it reads as none.
43. **Supply stop output.** When the pilot does not fit, the pilot's outcomes are written and the projection printed, and
    only then does the command raise E_OF_SUPPLY_SHORT.
44. **`--pilot` writes no units.** Sets fill only in the full run, which replays the pilot from the cache. The pilot writes
    its outcomes and summary.
45. **Fetching.** The miner GETs each URL as the frame wrote it (http or https), follows redirects, waits at most 30
    seconds, and sends the user agent `gstack-evals`. A network failure reads as status 0, which the gate counts as
    unreadable. Wikipedia's pageviews go through the same serial fetch.
46. **Neutral packet ids.** The blocks in authoring label packets are `b1` and `b2`, so a judge never sees a validator's
    name or which stock row it reads.

## Rules that may be wrong (built as written)

- The copy check bars every word on the Names line. A company named with common words (for example "Open Table") bars those
  words from the whole unit, which may drop real units whose story never names the source.
- A terms page that cannot be read counts as forbidding. Many personal founder sites have no terms page, so the real stratum
  may yield few or no units.
- The vocabulary screen's named term "status quo" is also a fact kind the author prompt lists, so authors may write it into
  fact text and trigger rewrites.
