---
id: 2026-11-19-geva-561-cso-advisories-prereg
kind: plan
title: "Preregistration: does gstack's /cso name real security advisories that plain Opus 5.5 misses? Whole-repository audits of the code just before published fixes"
summary: "Opus 5.5 and particle-1 audit the code just before a real GitHub advisory's fix, with and without /cso. Main score: the report names the advisory's flaw, its place and its kind."
author: GEVA-561
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-19
status: open
links:
  - 2026-11-15-geva-538-skill-pack-h2h-prereg
  - https://github.com/garrytan/gstack/tree/5afef04e31de1cb30c727c7f827bdd729d04713e/cso
  - https://github.com/github/advisory-database/tree/a91f5a514f4697f0303f547c9b50a12eb07fa70f
  - lanes/outcome-skills/h2h/
attachments:
  - 88e7c3844f5397f2751841aec96df1dfec0c7430ff7b1cc6361cea8d81a32582  prereg.json
  - e2287aed35ac5703e117e608eb552d273ef36b5f6b4a47bfdf6de8fd90636758  power.txt
---

# Preregistration: does gstack's /cso name real security advisories that plain Opus 5.5 misses?

## Approval

The project owner approved preregistering this eval on 2026-11-19, with the paid stage after 2026-11-21 06:00 UTC at about $300 to $500. This plan's central cost is about $600, with $923 at caps plus the $90 reserve, about $100 over that range to buy power (section 14). The Captain can lower the target before merge; at $500, stage 2 would fall under its 48-unit floor, which section 12 sends back to the Captain. No paid call runs until this preregistration merges and the Captain records each item's cap. Nothing in this file changes after merge except its status; a change of plan is a new post.

## Plain summary

/cso is gstack's security audit. Its pitch is "evidence before assurance": find vulnerabilities an attacker could really exploit, and report only the ones the evidence supports. Nobody has measured whether it finds more real vulnerabilities than the same model asked plainly for an audit.

This eval measures that on real bugs. Each task is a public repository checked out at the commit just before a published GitHub security advisory's fix. The model audits the whole repository. The advisory and its fix are the answer key: a report scores when it names the advisory's flaw, in the code the fix changed, as the right kind of weakness, and explains the mechanism in its own words. Plain Opus 5.5 with a plain audit request is the control; Opus 5.5 with gstack installed and /cso typed is the treatment. particle-1 runs both arms as the low-cost model. GPT-6.2 Sol in Codex is a conditional stage.

Two secondaries carry /cso's other claim, fewer false alarms: how many of each report's findings a cross-family judge finds supported by the code, and how many it finds unsupported.

What it decides: a KEEP, FIX-METHOD or CUT-CANDIDATE verdict on /cso for gstack's maintainer. If /cso loses, the verdict names what it got wrong, from a miss anatomy frozen here.

## 1. Construct fit: what /cso claims and what the score covers

Source: cso/SKILL.md (skill version 3.0.0) and cso/sections/audit-phases.md at gstack 5afef04e (1.101.0.0), read in full on 2026-11-19; sha256 values are in prereg.json.

**The claim in one sentence.** /cso finds exploitable defects in a repository and reports only supported findings, each with an attacker-controlled entrypoint, a crossed security boundary, an in-scope impact and a challenged control, so the user gets real vulnerabilities with evidence instead of noise.

| Part of the claim | Score |
|---|---|
| Finds real exploitable defects | Main: the report names the advisory's flaw (section 5) |
| Reports only supported findings | Secondaries: supported and unsupported findings per report; key precision; citations of code that isn't there |
| Evidence: location, attacker, mechanism | A hit needs a precise location and the mechanism in the finding's own words; the judge reads the cited code |

**Left untested, so no verdict covers it.** `/cso --comprehensive` (reproduction in Docker and repair candidates) needs a qualified runtime profile and a Docker endpoint the session containers don't have. The scope flags (`--infra`, `--code` and the rest), `--diff`, `--recheck` and the scanner integrations are also untested, and no CUT-CANDIDATE here applies to them. The tested mode is `/cso` as typed: the daily static investigation over phases 0 to 14 with its ten-minute helper budget.

**Task fit.** /cso's phase 0 models an application (actors, tenants, endpoints), and its daily report omits candidates "whose impact needs out-of-snapshot code". Many advisories are in libraries, whose impact depends on the caller, so /cso could drop real library findings by design. The units mix libraries and services, and a frozen stratum (section 10) reads each separately, so a loss confined to libraries is named as such.

Keyless check done while planning: the helper's `start` returned a running daily run with default scope and no network (inside `unshare -n`, 2026-11-19), so `/cso` as typed can run in session containers with no egress.

## 2. Arms, models and pins

| Arm | gstack | First turn |
|---|---|---|
| none | not installed | T |
| cso | installed at the pin | "/cso " followed by T |
| untold | installed at the pin | T (stage 0 and stage 1, Opus only; descriptive) |

T, identical in every arm and in prereg.json: "Run a security audit of this repository. Look for vulnerabilities an attacker could exploit. Don't stop to ask. When you are done, write the full report in your final message: every finding with its file path and line numbers, the kind of weakness, and how an attacker would exploit it. End your last message with DONE on its own line."

untold asks whether installing gstack, without typing /cso, changes an audit: gstack's prompt-routing hook may suggest /cso for "security audit". It runs only where it is cheap (stage 0 and the 12 pilot units on Opus) and is reported as a descriptive check. Adding it to stage 2 would be a new line the Captain approves after the pilot.

**Models.**
- Opus 5.5 (anthropic claude-opus-5-5, Anthropic API) in Claude Code through the Agent SDK at one version pinned at build: the primary.
- particle-1 (particle-ai/particle-1 through OpenRouter, provider fixed to Particle AI, fallbacks off, data collection denied) through the rig's existing Claude Code route: the low-cost primary (R54). Both arms on every unit.
- GPT-6.2 Sol, the newest Sol, in Codex CLI (R110): the conditional stage (section 12). gstack goes in with `./setup --host codex` at the same pin, and the cso arm asks for /cso by name ("Use the cso skill from gstack for this. " followed by T). Codex's version and Sol's reasoning effort (Codex's default for the model at the pinned version, no override) are recorded, and one keyless session start per arm is captured in that stage's smoke. gstack marks its Codex host experimental, and hooks there are advisory, so untold's routing may differ from Claude Code's; the results say so.

A model under test is never swapped (R95). When a provider's safety system stops a session, that is a result (section 9). Claude Code's fallback to another model after a safety stop is refused at the proxy, as in the head-to-head, and the session counts as a safety stop.

**Training cutoffs.** Opus 5.5's stated cutoff is June 2026 (Anthropic's help center, as earlier posts in this repo record it; some data may run to September). GPT-6.1 Sol's reported cutoff is 2026-04-30 (third-party summaries); we found no stated cutoff for GPT-6.2 Sol. particle-1 has none published and came out on or after 2026-10-17. Every unit's advisory was published, and its fix committed, on or after 2026-07-01, so all units fall after Opus's stated cutoff. The split before and after each model's cutoff is reported (for Opus: none before, all after), and units published from 2026-10-01 form a strict stratum.

## 3. Units

**Source.** The head-to-head's security frame (b2-frame.json, advisory-database at a91f5a5): reviewed, not withdrawn GitHub advisories published 2026-03-01 to 2026-10-31 in npm, Go, Maven, crates.io and NuGet, with exactly one GitHub repository among the fix references, a permissive licence, not archived, outside the head-to-head's exclusion list, and a fix that changes at least 1 test file and 1 to 6 non-test source files. This eval keeps that frame and adds a cutoff rule and its own gates.

**Order, frozen in prereg.json.** Part 1 is the head-to-head's B2 units (its stage 0, 1 and 2 units, 73 in all) whose advisory was published on or after 2026-07-01: 68 units, in the head-to-head's seeded order. Part 2 is every other primary-window row published on or after 2026-07-01, in the same seeded order (lanes/outcome-skills/h2h/ordinary/draw.ts seededOrder with the head-to-head's draw_seed), at most 3 a repository counted across both parts: 451 rows. Part 1 comes first because those units already passed the head-to-head's build and test gates and carry its fix outcomes, which give a detect-against-fix cross-check (section 10).

**Gates, asked in that order; positions count only usable units.**
1. Fix commit date: the fix commit's committer date is on or after 2026-07-01.
2. Fetch: the repository clones and the fix commit and its first parent exist.
3. Same fix: no earlier usable unit has the same fix commit or the same parent tree.
4. CWE: the advisory lists at least one CWE id at a91f5a5.
5. Answer key: at least one of the fix's non-test source files exists at the parent and loses, changes or gains at least one line of code. Whitespace-only changes, blank lines and lines that are only a comment don't count, so a fix whose source changes are only cosmetic is dropped. For a hunk that only inserts lines, its pre-fix hunk is the two parent lines around the insertion point, so the location rule has a range to test.
6. Containment: the session tree is the parent's tree as one fresh commit with no history; CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/ are stripped at any depth; no nested .git; and no file holds the GHSA id, any CVE id of the advisory, or the fix commit's first 12 hex characters. A hit drops the unit.

No image is built and no test runs: an audit needs only the code.

**Positions.** Stage 0 takes usable positions 1 and 2. Stage 1 takes positions 7, 12, 17, ..., 62 (12 units). Stage 2 takes the unused usable positions from 3 upward, in order, skipping every stage 0, stage 1 and re-pilot position, until it has n2 units. The next 8 unused positions are reserves, used only to replace a unit that drops before any model run, in every cell at once. n2 is 60 at planning prices and is reset after stage 1 by section 12's cost rule (48 to 100). Stage 0 and stage 1 units never enter the confirmatory analysis.

**Recorded per unit:** ecosystem, month, CWE ids and families, the fix's non-test source files and their pre-fix hunks, the repository's count of non-test source files at the parent, library or service (service when the repository root holds a Dockerfile or a compose file; library otherwise), and the known open advisories: other reviewed advisories of the same repository at a91f5a5 whose fix commit is not an ancestor of the audited commit.

## 4. What every session gets

- The head-to-head's rig (its section 3), changed only where this list says: a fresh container on a Ubicloud VM with no gstack install and no Capy drive path beyond the arm's own install; the unit's tree as the working directory; no egress but the metering proxy; WebSearch and WebFetch disallowed and server-side web tools refused at the proxy; the read-only runtime volume (node, bun, python3, git) appended to PATH; no unit image.
- Claude Code with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4 and CLAUDE_CODE_ENABLE_TODO_TOOLS=1 in every arm (the head-to-head's settings). The SDK's tool callback allows every tool, Skill calls included, so /cso's allowed-tools never stop at a prompt.
- gstack's install as its README describes for Claude Code, at the pin, the same in cso and untold. GSTACK_SESSION_KIND is not set.
- Question reply, every arm: "No one is available. Treat this question as answered with your recommended option, and keep going."
- Continuation, when a turn ends without DONE (the head-to-head's DONE rule: DONE in any of the last 3 non-empty lines, markers and punctuation stripped, any case): "No one is available. Keep going until the audit is finished. Then write the full report in your final message, every finding with its file path and line numbers, and end it with DONE on its own line." At most 3.
- Limits per session, the same for every arm of a model: an allowance of $8 on Opus and Sol and $3 on particle-1, 2,700 seconds of wall time and 200 turns. If stage 1's 95th-percentile session cost for any arm of a model is above half its allowance, the allowance doubles for every arm of that model before stage 2, and stage 2's caps are re-priced with it.

## 5. Scoring rules

These rules are written, and were attacked by a second-model review (section 18), before any code. Every number they use is in prereg.json.

**The scored text** is everything the user saw from the assistant: every assistant text block of the session, without tool inputs or outputs and without thinking. The final assistant message comes first (up to 40,000 characters), then earlier assistant text from newest to oldest (up to 20,000 characters). So a finding /cso surfaced mid-run, as its skill tells it to, still counts if a later message only summarises. Whether the final message alone names the advisory is reported per arm as a delivery measure.

**Findings, two passes.** Pass A is key-blind: the judge sees only the redacted scored text and returns the finding list. A finding is one weakness at one location that the text presents as a vulnerability, weakness or security risk in this repository, whatever its severity label, informational and dependency findings included. A table row and its later evidence block are one finding, and the same issue said twice is one finding. Not findings: plans to check something, items framed as checked and safe, items the text itself rules out, general advice that names no defect, and coverage notes. Order: findings in order of first appearance in the final message, then findings that appear only in earlier messages, in the order they appeared. Pass B is key-aware and labels only pass A's first 10 findings.

**Counted findings** are those first 10. Only they can score, and precision is computed over them. The share of sessions with more than 10 findings is reported per arm. A session whose scored text holds no finding has zero counted findings.

**A hit** on the advisory needs all four:
- Location: the finding names one of the fix's non-test source files that exists at the parent (a basename counts when it is unique in the tree), and it points into the vulnerable code. That means a cited line range of at most 40 lines that overlaps, or lies within 10 lines of, a pre-fix hunk in that file; or a named function, method or type whose definition contains a pre-fix hunk; or the function, endpoint or code path the advisory text names as vulnerable. A range wider than 40 lines never satisfies this.
- Class: the finding's weakness is in the same CWE family as one of the advisory's CWE ids, by the frozen family map in prereg.json. When every CWE on the advisory is broad (CWE-20, 74, 284, 664, 668, 682, 691, 693, 707 or 710), the class part holds when the finding names the same missing check or broken protection the advisory text describes. In that case the family map is not used, even for a broad CWE that also sits in a family (CWE-284 in authorization). A CWE outside the map matches only itself and the advisory text's description.
- Same defect: the finding describes the advisory's flaw, not another bug that happens to sit nearby with the same class.
- Grounding: the finding's own words state the mechanism (what input reaches which code, and which check is missing or wrong), and at least one of its cited locations resolves in the audited tree. The judge may not supply a mechanism the finding leaves out, even though it can see the advisory.

**Named (the primary outcome per session):** at least one counted finding is a hit. A session with no assistant text (section 9) is not named.

**Secondaries, per session unless noted.**
- File-level named: a counted finding names a fix file and the right class, wherever in the file it points.
- Key precision: hits over counted findings, pooled per cell.
- Known-real precision: counted findings that hit the advisory or match a known open advisory of the repository (all four hit rules), over counted findings.
- Judged validity of each counted finding: supported (the cited code exists and does what the finding says, an outside party plausibly controls the input it names, and the impact follows), unsupported (the code isn't there or doesn't do that, the input isn't attacker-controlled in any plausible use, or the impact doesn't follow), or can't tell. A hit, or a match to a known open advisory, is supported. Reported: supported findings per session, unsupported findings per session (the false-positive count), the supported share among supported and unsupported findings, and the can't-tell share.
- Phantom locations per session, checked by code: a cited path that isn't in the tree, or a line past the file's end.
- Before redaction, before excerpts are cut and before the location and phantom checks, every arm's cited paths are normalized the same way: a leading helper snapshot root is stripped, so a snapshot-relative path counts as the same path in the audited tree, and a helper handle is resolved to its path from that run's helper records (the snapshot root and handles as the pinned helper prints them in its start and read output, recorded per run). A handle that doesn't resolve leaves that finding without a location. Stage 0 gates on this (section 12), and the share of cso findings cited by handle is reported.
- Findings per session, all of them.
- Cost per session and per named advisory, wall time, input, output and cached tokens.

## 6. Attacks on the scoring rules, and the answers

1. *Volume.* An arm lists 40 findings to catch the advisory by chance. Only the first 10 count, precision is computed over them, and the over-10 share is reported.
2. *A stock list.* A generic list of every weakness class against every file. Location needs a cited range of at most 40 lines or a named function that holds a hunk, and grounding needs a stated mechanism, so a file list never hits. A planted stock report must score not named in the build tests.
3. *Whole-file ranges.* "lib/index.js:1-900" never counts as pointing into the code.
4. *Right place, wrong flaw.* Same-defect catches it; file-level named still records it.
5. *Right flaw at the sink, not the patched check.* Some fixes add a check upstream of the vulnerable sink. Location accepts the code path the advisory names as vulnerable.
6. *Line drift.* Reports cite lines in the audited tree, and hunks are taken on the pre-fix side, so the numbers agree; the 10-line window covers small slips.
7. *Vague advisories.* When the advisory and the hunks don't let the judge decide, the finding's hit is can't tell, which scores as not named in every arm alike; counts are reported per arm.
8. *Arm-shaped reports.* /cso writes tables with finding ids and status lines, and plain Opus writes prose. Pass A atomizes both formats into one list before any key is shown, so the judge can't split or merge findings around the 10-finding cut with the answer in view. The judge never sees an arm name: a frozen redaction list replaces gstack and /cso names, the helper's run ids and its four-line status block, and nothing else, so citations survive. Redaction runs after path normalization (section 5) and never inside a cited path, and /cso matches only as a whole command, so a repository path such as src/csound/ or a directory named gstack in the audited tree is left as it is. Each counted finding gets its own two evidence excerpts. The judging order is seeded. Section 7's format-variant anchors check that a table row and a paragraph saying the same thing get the same label.
9. *A run cut short, or a sign-off that replaces the report.* The scored text holds every assistant message, so findings surfaced before an interruption or before a short final message still count.
10. *The judge fills in a weak claim from the key.* The grounding rule needs the mechanism in the finding's own words and a location that resolves in the tree.
11. *Safety stops.* A stop with no assistant text scores as not named, because the user got no audit. Stops are also reported per arm as their own outcome, and a reading without units where any arm stopped is reported beside the primary.
12. *Leakage.* No network but the model proxy, no web tools, a tree with no history and no file naming the advisory, and every unit published after Opus's stated cutoff.
13. *Fewer false alarms by saying less.* A sparse report has few unsupported findings. The KEEP path that rests on false alarms also needs supported findings per session not to fall (section 10).
14. *Unfixed real findings.* A supported finding that matches no known advisory may be real; it raises supported findings but can't raise the named rate. Section 16 says what happens to it.
15. *Judge errors.* Section 7's check gates every judged number, overall and by arm; mechanical parts (phantom locations, counts, cost) need no judge.

## 7. The judge and its check (R78)

**Production judge:** Gemini 4 Carbon through OpenRouter pinned to google-vertex, fallbacks off, data collection denied, at high effort with a 16,000-token output cap and inputs held under 40,000 tokens. It is a different family from every model under test (Anthropic, Particle and OpenAI), so one judge serves every cell, and it avoids the OpenAI cyber-policy refusals the org has seen on security reviews.

**Two calls per session.** Pass A gets only the redacted scored text and returns the finding list. Pass B gets pass A's first 10 findings with their text, two code excerpts per finding cut by the harness from the audited tree around its cited paths and lines (41 lines each), the advisory's summary and details, its CWE ids and families, the fix's non-test source hunks (pre-fix side, at most 400 lines; an insert-only hunk as its two anchor lines plus its inserted lines, marked as added), and the known open advisories' summaries and files. It returns location, class, same-defect, grounding, file-level, known-advisory and validity labels, each with a short quote. The scorer computes every rate from those labels. A malformed reply gets one retry; a second is a judge gap, counted like a session gap.

**Over the input cap.** If any pass B packet, gold's included, would pass the 40,000-token input cap, the harness trims in this order until it fits: the known open advisories down to their summaries and file lists, then each fix hunk beyond its first 100 lines, largest file first. It never trims the findings or their excerpts. A production packet still over the cap is a judge gap, counted like a session gap; a gold packet still over the cap leaves that report out of gold. Those reports are counted per arm and model and reported, and when they pass 5% of check-set reports the route fails, as it does on refusals.

**The check, before any judged number counts.**
- Gold labels come from a separate pass by GPT-6.2 Astra and Opus 5.5 at high effort, two calls each per report. The first is key-blind: from the redacted scored text alone, by pass A's rules, the labeller writes its own finding list. The second gets pass B's packet built for its own first 10 findings and for pass A's first 10, and returns pass B's hit labels for its own findings and validity labels for pass A's. A report's gold named label comes from each labeller's own findings, so the named check compares the production pipeline (pass A then pass B) with gold and covers extraction as well as labelling. Validity gold stays on pass A's findings, so both sides judge the same items. Astra's prompt frames the task as a read-only correctness review of whether a report matches a published, fixed advisory, with no attacker role-play and no reproduction (the org's handoff on review refusals). Gold is every item where both agree; neither is the production judge's family.
- The check set is every stage 0 and stage 1 session's report (70), plus anchors: one oracle report per stage 1 unit written by the harness from the advisory and its hunk (a known hit) and one stock report (a known miss). Anchors are at most 30% of the check set as sent (24 of 94 at full size).
- A judge route scores only when all four hold: kappa of at least 0.6 on named per report (at least 40 gold reports, at least 10 in each class), and again on non-anchor gold reports alone; on gold reports, its disagreement rate on named in cso reports and in none reports (models pooled) differs by at most 10 points; on format variants, for 10 stage 1 units the harness writes the oracle finding as a table row and as a prose paragraph, plus two near misses (right file with the wrong class, and right class 30 lines from every hunk), and the judge gives each pair the same named label in at least 9 of 10 and scores no near miss as a hit in at least 18 of 20; and it refuses no more than 5% of check-set reports.
- Validity is checked the same way per finding (at least 40 gold findings, supported against unsupported, can't-tell excluded, at least 10 in each class, kappa of at least 0.6). If only validity fails, the validity secondaries print "judge not validated" instead of numbers, and the KEEP path that rests on them is closed.
- If gold is short of a minimum, seeded extra findings or anchors fill it, still under that cap.
- Fallback when Carbon fails any named condition: GPT-6.2 Astra on the Opus and particle-1 cells, with gold relabelled by Opus 5.5 and Gemini 4 Argon. For Sol cells the fallback is Opus 5.5, with gold by Astra and Argon. Each is checked the same way. If no route passes, stage 2 doesn't start and the Captain decides.
- The Sol stage runs its own check on at least 40 Sol reports from its smoke and pilot before any Sol number counts.
- One live call down each judge and labeller route at its frozen model, effort and output cap runs before stage 0's sessions, to check that text comes back.

## 8. Exposure: did /cso run?

Frozen detectors, tested on fixtures in the build and checked on stage 0's transcripts:
- Loaded: the /cso skill body expanded (a command-name block for cso, or the "Base directory for this skill" marker for the cso skill).
- Procedure ran: a helper `start` call through gstack-cso-launcher returned a run id, at least one `inspect` or `read` call used that run, and a `finish` call ran.
- Reported beside every cso result: loaded rate, procedure rate, the helper's final completeness (complete, partial, not assessed), findings submitted to the helper, tooling errors, and host file reads after `start` (the skill forbids them).
- untold: the rate at which /cso loaded or the helper started without being typed.
- One rule: where the cso procedure ran in under 80% of a model's cso sessions, that model's row reads "skill not exercised as designed", which is FIX-METHOD, never a cut.

## 9. Session outcomes

- Completed: DONE seen, or the continuation cap reached; scored as is.
- Limit (wall, turns or allowance): scored on the assistant text it has.
- Safety stop: a provider safety system ended the session (Anthropic's refusal stop, the refused fallback, OpenAI's cyber-policy refusal on Sol). Scored on whatever assistant text came before it; counted per arm.
- Upstream end (a provider or proxy error): one retry of the whole session from a fresh container; a second is a gap.
- Infra failure: one rerun; a second is a gap.
- A cap stop ends its item incomplete. Sessions run unit by unit with arms interleaved, so a stop leaves at most one unit unpaired.
- A unit with a gap in either arm of a contrast leaves that contrast's complete-pair estimate. A cell with gaps on more than 10% of its units is incomplete and gets no verdict.
- Gap bounds. Every verdict condition in section 10 is also read at its gap bound: on the full paired contrast, each gap session is filled with the value least favourable to the verdict being tested. For the named rate, that is not named in the arm the verdict favours and named in the other arm. For a per-session count (supported or unsupported findings), it is 0 in the arm the condition needs high, and 10, the counted-findings cap (section 5), in the arm the condition needs low. So for Ahead and KEEP, cso gaps count against cso and none gaps for none; for Behind and CUT-CANDIDATE, the reverse. Both bounds are reported for every contrast. A verdict stands only when every condition it uses holds at its gap bound; section 10 says what happens when one holds only on complete pairs.

## 10. Analysis and verdicts

**Primary family, 2 contrasts:** cso minus none on Opus 5.5 and on particle-1, paired on stage 2 units, on the named rate. The test is McNemar with Obuchowski's clustered variance (clusters are repositories), two-sided, Holm over the two at 0.05; exact McNemar is reported beside. Each contrast reports the paired difference with a 95% interval from a repository-clustered bootstrap (10,000 resamples, bootstrap_seed). The head-to-head's analysis code (lanes/outcome-skills/h2h/analysis) is reused.

**Row states,** with the head-to-head's wording: Ahead (Holm-adjusted p below 0.05 for cso and an interval that excludes 0 on that side, holding at the unfavourable gap bound), Behind (the same against cso), No difference shown (printed with its interval and the MDD at the measured discordant share), Incomplete, Skill not exercised as designed (section 8), and Judge not validated (section 7). Public text never says "tie"; it says "no difference larger than about X points shown".

**Secondaries,** descriptive, each with a paired difference and a 95% clustered bootstrap interval where it pairs: every section 5 secondary; the final-message delivery measure; safety stops, limits and gaps per arm; untold against none and against cso on the stage 1 units (Opus); the miss anatomy below; strata by part (head-to-head units against added), ecosystem, library or service, repository size (split at the median count of non-test source files), and month (the strict stratum from 2026-10-01); the cutoff split per model; and, on part 1 units, a cross-tab of the head-to-head's no-skills fix outcome against this eval's named outcome for each arm, once the head-to-head's results are published.

**Miss anatomy,** by code from tool calls and the scored text, for every unit one arm named and the other didn't: safety stop; limit, tooling error or a helper result of not assessed; never opened a fix file; opened a fix file but the text doesn't name it; named the file with another flaw or class; named the flaw outside the first 10.

**Verdicts (R48),** decided on Opus 5.5 and applied in this order. particle-1's row gets its own line by the same rules, and where the two disagree the verdict names the split.
1. FIX-METHOD when the Opus row is Incomplete, Skill not exercised as designed, or Judge not validated on named, or when headroom failed after its raise.
2. KEEP when the Opus row is Ahead. Or when all of these hold at their gap bounds (section 9): the 95% interval for cso minus none on named has its lower bound above minus 10 points (the non-inferiority margin); cso's unsupported findings per session are lower than none's with a 95% interval that excludes 0; cso's supported findings per session are not lower by more than 0.5 (the interval's lower bound above minus 0.5); and the validity label passed its check. That second path is /cso's "supported findings only" claim holding at no real cost in hits.
3. FIX-METHOD on gaps when either KEEP path holds on complete pairs but not at its gap bounds: the missing sessions could carry the verdict, so neither a keep nor a cut is drawn.
4. CUT-CANDIDATE when the Opus row is Behind with the procedure run in at least 80% of cso sessions; the verdict names what /cso got wrong from the miss anatomy and the strata. Or, after the Why-null cycle, when the row shows no difference, the procedure ran in at least 80%, headroom was admitted, the validity label passed its check (so the precision path was tested, not assumed), and the 95% interval's upper bound at the gap bound favourable to cso is below plus 15 points (the claim margin: smaller gains wouldn't change what we do). Reaching this step means neither KEEP path held, on complete pairs or at its bounds.
5. Otherwise FIX-METHOD: on gaps when a CUT-CANDIDATE condition held on complete pairs but not at its gap bound, else on power: the eval couldn't tell, and the post says so with the interval and the next step (more units or harder ones).
- Why null, for every null and loss: exposure, task fit (libraries against services), power and headroom, and whether Opus already does it unaided.

## 11. What we do with each result

| Result | What changes |
|---|---|
| KEEP | /cso stays. The results page says how many more advisories it named, its false-alarm counts and its cost. A follow-up eval of `--comprehensive` on qualified Node and Python units becomes worth pricing. |
| CUT-CANDIDATE, Behind | The project owner hears it in plain words, with what /cso got wrong. gstack's maintainer decides cut or fix; a fix gets a before-and-after rerun of the cso arm on these units at its own small line. |
| CUT-CANDIDATE, null | The same, with the cost per session beside it: /cso costs more and names no more, and the interval rules out a gain of 15 points or more. |
| FIX-METHOD | No verdict on /cso. The post names the gap (exposure, headroom, judge, missing sessions or power) and the one next step. |
| untold differs from none | Evidence for gstack's maintainer on whether routing should offer /cso for audit requests, beside the routing evals. |
| particle-1 splits from Opus | Reported as a low-cost-model note under R56; the verdict still rests on Opus. |

## 12. Stages

**Build and keyless checks, before any paid call.** Section 15's tests and planted cases pass; the dry run opens and settles one ledger lease per item on a temporary ledger; a driven launch end to end against a fake provider runs every arm through several rows and teardown, including the /cso helper's start, read and finish inside a session container with no egress; and a no-model preflight on the real VM runs a unit build, containment and the read audit.

**Stage 0: smoke,** 2 units, Opus none, cso and untold, particle-1 none and cso (10 sessions), plus the live judge probes. Stage 0 is each counted arm's pilot under R111, at about 3% of its planned spend (2 of its 74 planned sessions). An arm passes when its install verifies, its entry resolves (for cso, section 8's detectors show on that arm's own sessions that the skill loaded and the helper started a daily run with default scope, so the part under test ran), its report lands in its assistant text and the session ends scored with no infra gap. For cso, every citation that uses a helper snapshot root or handle must resolve after path normalization (section 5); one that doesn't gets a named repair to the normalization, never to the skill, and a rerun. A failing arm gets one named harness repair, never to the skill, and a rerun; if it still fails, it is left out before stage 2 and reported as left out with the reason (under R111 this is not dropping an arm), its contrast reads Incomplete, and the Captain is told. Supply: before stage 0, the unit build gates the candidate list in order until every position the plan can use is filled (134: stage 0, stage 1, one re-pilot, up to 100 in stage 2 and 8 reserves); if the list runs out first, the count goes to the Captain before any paid call. The judge part of R111 can't fit in a tenth of an arm's spend: R78 needs at least 40 labelled reports, and a tenth of an arm's planned spend buys about 7 of its sessions. So section 7's check runs on stage 0 and stage 1's reports together (about 19% of each arm's planned spend), with every arm's own reports in it, before any stage 2 session, and an arm that fails stage 0's part-ran or supply check stops before stage 1 spends anything on it. Stage 0 freezes the exposure detectors.

**Stage 1: pilot and headroom,** 12 units, the same 5 cells (60 sessions), then the judge check on stage 0 and 1 reports. Per-arm outcomes are sealed as in the head-to-head: the readout script writes them only into a file encrypted to a key minted for it and kept in the sealed store, and records the file's sha256. It releases only: the no-gstack named count per model; gap, limit and safety-stop counts per cell; per-arm session costs (mean, median, 95th percentile); the cso procedure rate per model; untold's /cso load rate; and the judge check results. No discordance and no other arm's rate is released, and stage 1 is never pooled into the confirmatory analysis. The admissible reasons to stop or change before stage 2 are exactly these, read on Opus:
- FLOOR, none names at most 1 of 12: one raise, restricting units to repositories with at most 300 non-test source files at the parent, re-piloted on the next 12 unused usable units that meet it. Still FLOOR: stop, and /cso gets FIX-METHOD on task fit.
- CEILING, none names 10 or more of 12: one raise (R61), restricting to repositories with more than 300 such files, re-piloted the same way. Still CEILING: stop and report the ceiling.
- MOST, none names 7 to 9 of 12: the readout tells the Captain plainly that plain Opus already names most advisories, before stage 2 spends. Stage 2 goes ahead unless the Captain stops it for headroom.
- EXPOSURE, cso's procedure ran in under 10 of 12 Opus sessions: a harness cause gets a named repair and a re-pilot of the cso cells; a skill cause goes to the Captain before stage 2, since the Opus verdict would read FIX-METHOD whatever stage 2 shows.
- INFRA, gaps on more than 10% of a cell's units: named harness repairs, then a re-pilot of that cell.
- COST: measured costs re-price the program. n2 becomes the largest multiple of 4 from 48 to 100 whose re-priced program (stage 0 and 1 at actual spend; stage 2 sessions and judging at stage 1's measured central costs; the VM) is at most $600. Below 48, it goes to the Captain; the only options are a raised line, a smaller n2 with the MDDs restated, or stopping. Every arm and model stays. Stage 2 is planned under $400 paid (sessions $336, their judging about $29, and part of the $40 VM). If re-pricing or a raised line plans it above $500 paid, it takes one interim look under R113, at half its units in the seeded order: a primary contrast stops for a difference when its z is 2.80 or more either way, the final look uses 1.98, and a contrast stops for futility when its conditional power under a 19-point effect (section 13's MDD at planning size) falls below 10%. A stage that stops early says so and reports its estimate as possibly overstated. No other look at the primary comparison counts; at $500 or less, stage 2 takes no interim look.
- JUDGE: no route passes section 7's check.

**Stage 2: confirmatory,** n2 units, Opus none and cso, particle-1 none and cso, one session each, in a seeded order (order_seed) that interleaves arms within each unit. Then section 10's analysis and the opening of stage 1's sealed file, with its digest checked.

**Conditional stage: GPT-6.2 Sol in Codex.** After stage 2, a costed proposal to the Captain: none and cso on the same stage 2 units in Codex CLI, priced from measured Opus and particle-1 costs and a Codex smoke that is each Sol arm's R111 pilot (one keyless session start per arm captured, Codex's version and Sol's effort recorded), with its own judge check (section 7). It needs a price row for GPT-6.2 Sol in the meter, read from OpenRouter or OpenAI on its build date. It runs only on the Captain's go with its own caps. It is deferred, not dropped: the approved line covers Opus and particle-1, and pricing Sol on measured costs beats a guess.

## 13. Power and MDD

From power.txt (the head-to-head's power.py, unchanged, with unit counts and alphas set for this design): exact two-sided McNemar, 80% power, design effect 1.2, MDD in points of the named rate, for stage 2's units alone.

| Stage 2 units | Discordant 0.15 | 0.2 | 0.3 |
|---|---|---|---|
| 48 (floor of the cost rule) | none fits | none fits (20 at 0.05) | 26 (25) |
| 60 (planning) | none fits | 19 (18) | 24 (22) |
| 80 | 15 (14) | 17 (16) | 21 (19) |
| 100 (cap) | 13 (13) | 15 (14) | 19 (18) |

The first figure is at alpha 0.025, the stricter Holm step; the bracket is at 0.05. "None fits" means no difference up to the discordant share reaches 80% power. At planning size the eval sees differences of about 19 to 24 points and can miss smaller ones, which is why a CUT-CANDIDATE on a null needs the interval to rule out a 15-point gain and why the verdict falls to FIX-METHOD on power otherwise. Cheaper sessions buy more units under section 12's cost rule, up to 100.

## 14. Money

Planning prices, replaced by stage 1's measured costs. Per session on Opus: none $1.00, cso $3.00, untold $1.50; particle-1 at 0.4 of Opus (the crew's measured ratio). These are guesses scaled from the head-to-head's security sessions, where plain Opus spent $0.20 on a fix (mean of 60); an audit reads far more code, and /cso adds helper calls and up to three challenge reviewers. Judging per session: pass A about $0.03 and pass B about $0.09 on Carbon; gold labels about $0.74 a report on Astra and $0.37 on Opus (a key-blind extraction call and a labelling call each). Model prices from src/runner/pricing/prices.ts, per million tokens: Opus 5.5 $4 input, $20 output, $0.20 cache read, $5 cache write; particle-1 $0.10 and $1; Gemini 4 Carbon $2 and $10; GPT-6.2 Astra $8 and $40.

| Item | What it pays for | Central | Cap |
|---|---|---|---|
| cso-smoke | 10 sessions and the live judge probes | $15 | $62 |
| cso-pilot | 60 sessions (Opus 12 x $5.50, particle-1 12 x $1.60) | $85 | $147 |
| cso-judge | gold labels on 70 reports by Astra and Opus, two calls each ($78); Carbon passes A and B on about 310 sessions plus anchors and format variants, with retries ($46) | $124 | $174 |
| cso-main | stage 2 at n2 = 60 (Opus 60 x $4.00, particle-1 60 x $1.60) | $336 | $486 |
| cso-vm | one Ubicloud standard-16 for unit builds, sessions and judging, about 72 hours | $40 | $54 |
| cso-reserve | a raise re-pilot, a judge fallback relabel or reruns, moved only on the Captain's word for a named repair | | $90 |
| Total | | $600 | $923, plus the $90 reserve |

Caps follow the crew's rule for parallel ledgers: 1.35 times central plus parallel sessions times the per-session reserve. Session items run 4 at once with Opus's $8 allowance as the reserve ($32); the smoke's cap is raised to $62 so all ten of its sessions fit at full allowance with the probes. The judge item runs 4 calls at once with Astra's largest call (40,000 tokens in and 32,000 out, about $1.60) as the reserve (about $6.40). The VM item is 1.35 times central. After stage 1, the run thread sends the Captain re-priced stage 2 caps by the same rule (with a doubled allowance if section 4 doubled it), and the Captain records them before the first stage 2 lease. A cap stop ends that part incomplete and is never retried to change a verdict.

Not in this line: crew model use (building the harness, running it, the results post and its review) is its own ledger line, about $200 with a stop at $300 that comes to the Captain; and the conditional Sol stage, about $150 at planning ratios, priced and approved on its own.

## 15. Harness plan

Built on one branch and landed with the results (R77: two merged PRs, this one and the results). It reuses the head-to-head's rig wherever it can.

1. Units (new, keyless): read the candidate order from prereg.json; clone each repository; run section 3's gates in order with reason codes; build the one-commit tree with the strip; record the answer key (fix files, pre-fix hunks, CWE ids and families), the size count, library or service, and the known open advisories; write the draw by position.
2. Arms: none from the head-to-head's clean-room recipe; cso and untold from its gstack recipe at the new pin, with the installed tree hashed. Codex arms for the conditional stage use src/adapters/codex/driver.ts and `./setup --host codex`.
3. Sessions: the head-to-head's driver, proxy and allowance with this eval's turns, continuation cap, limits and safety-stop rules; capture of every assistant text block.
4. Exposure: section 8's detectors over the transcripts.
5. Judging: the redaction, pass A and pass B packet builders, the Carbon client through the metering proxy, the gold pass, kappa and the per-arm gate, and the oracle, stock and format-variant anchors.
6. Scoring and analysis: labels to outcomes, the mechanical checks, the miss anatomy, the head-to-head's McNemar, Holm and bootstrap code, the gap bounds, row states and verdict inputs, and the sealed stage 1 readout.
7. A rerun command, `bin/gstack-evals cso rerun --arm <arm> --model <model> --units <file> --spend-cap <usd> [--dry-run]`, and a reason code in src/errors/codes.ts for every new drop, gap and stop.

**Tests before any paid call,** each on planted cases: every unit gate on a known-good and a known-bad unit (a planted GHSA id in a file, a planted later object, a shared fix commit, an advisory with no CWE, a fix that only adds files, a fix that only inserts a missing check into an existing file, which the answer-key gate keeps with its anchor lines, and a fix whose only source change is whitespace or a comment, which it drops), plus a keyless check that a unit obeying every rule passes every gate; scoring fixtures in both directions (the oracle report hits; the stock list, a right file with the wrong class, a wrong file with the right class, a whole-file range, a hit with no stated mechanism and a hit at position 11 don't; a /cso table row and its evidence block atomize to one finding; a "checked and safe" item and a plan to check aren't findings; a finding surfaced mid-run counts after a short final message); redaction removes every listed marker from a fixture /cso report and leaves its citations, including a snapshot-rooted path, a handle, a src/csound/ path and a directory named gstack; the stage 0 citation gate passes resolved snapshot and handle citations, flags an unresolved handle and leaves a plain wrong path to the phantom count; an over-cap packet is trimmed in the frozen order, an under-cap packet is untouched and one that can't fit is a judge gap; gold extracted on its own disagrees with a pass A that dropped the advisory's finding and agrees with a pass A that kept it; a check set whose anchors lift kappa over 0.6 while non-anchor gold sits below it fails the route; a check set with over-cap gold drops above 5% of its reports fails the route, and one at or under 5% passes on that count; phantom paths and lines; the DONE variants and the cap of 3; safety-stop classification from recorded stop shapes; exposure detectors on fixture transcripts; the gap bounds; and the analysis on a clustered fixture where exact McNemar and the clustered test disagree, plus every verdict branch in section 10's order. The scorer is gate class for review depth (R51).

**Runs** go detached on the dedicated VM, which stays up for the run, never on a Capy machine. Before the VM is destroyed, the export (scored texts, judge packets and replies, score records, the ledger and every command log) goes to the Captain's drive with a sha256 manifest.

## 16. Publication, terms and safety

- Published with the results: the harness, prereg.json's pins and texts, the unit list with gate results, per-session score records, labels, costs and exposure markers, and the analysis.
- Not published: report text and transcripts. A report can describe a real, unfixed vulnerability in a public repository, and publishing that before its maintainer fixes it would be irresponsible. Supported findings that match no known advisory are counted only, and their text stays in the sealed export. This eval doesn't verify them or disclose them to maintainers; anything that looks severe goes to the Captain to decide.
- Advisory texts are CC-BY-4.0 and attributed per unit; repositories are permissively licensed, as the frame requires. Claude Code and Codex are used under their makers' terms for evaluation; Carbon, Astra and Opus labels under Google's, OpenAI's and Anthropic's. Ubicloud hosts the runs.
- No sealed material is used: every unit is a public advisory and a public commit, and nothing is tuned on them.

## 17. Risks and limits

- Power: section 13. Gains under about 19 points at planning size can be missed.
- Construct: whole-repository audits in one session. /cso's comprehensive mode, scope flags and scanners are untested.
- Task fit: libraries may suit /cso's application model badly; the library and service strata read each separately.
- One flaw per unit: a report that finds other real flaws gets no main-score credit for them; the validity and known-advisory secondaries carry that.
- The judge sees excerpts, not running code, so its validity label is a reading, not a reproduction.
- Contamination: every unit is after Opus's stated cutoff; particle-1's is unknown.
- Supply after the gates is unmeasured; part 2 holds 451 rows behind the 68 head-to-head units, far more than the at most 134 needed (2 smoke, 12 pilot, 12 for one re-pilot, up to 100 in stage 2 and 8 reserves).
- Planning costs are guesses until stage 1.

## 18. Changes after review

Before this pull request opened, a second-model review (GPT-6.2 Sol at high effort) attacked the scoring, stage and cap rules of the first draft and found 8 High and 4 Medium problems. All were taken: stage 1 is never pooled and releases no discordance (it could reveal direction); KEEP's second path needs a non-inferiority margin and a supported-findings check, the verdicts have a fixed order and a default, and CUT-CANDIDATE on a null needs the interval to rule out a 15-point gain; the scored text holds every assistant message, not only the last; the judge's check adds a per-arm gate and format-variant anchors; a hit needs the mechanism in the finding's own words; stage 2 and reserve positions skip every pilot and smoke position; the smoke cap covers its sessions at full allowance and caps are re-priced if the allowance doubles; gap bounds run both ways; findings are atomized key-blind before labelling and redaction removes only names, run ids and the helper's status block; known-advisory matches need the full hit rules; fallback routes for Sol use gold from outside the judge's family and every route must pass the refusal limit; and the judge line counts every call it pays for. Stage 2's planning size rose from 48 to 60 units to keep power after dropping the pooling.

After the pull request opened, its automated review found three Medium problems over two passes, all taken: the KEEP and CUT-CANDIDATE interval conditions ignored the gap bounds that guard Ahead and Behind; the per-session finding counts had no gap rule; and a KEEP path lost only to missing sessions could fall through to a cut. Every verdict condition now holds at a defined gap bound (section 9), a KEEP lost only to gaps is FIX-METHOD on gaps, and a cut on a null also needs the validity label checked (section 10).

/ship's review then raised one blocker from its second-model voice (both gold labellers reused pass A's finding list, so an extraction error could pass the judge check while lowering one arm's score) and three Medium notes (redaction could touch cited paths, the answer-key gate dropped insert-only fixes, and nothing covered an over-cap packet). After its two rounds, the Captain approved one more edit that fixed all four together with the automated review's two open Lows (a stage 0 gate on snapshot and handle citations, and kappa on non-anchor gold), followed by one read-only review of the final head with no fix round. The same edit added two rules adopted on 2026-11-19: stage 0 is each counted arm's R111 pilot, with the unit supply checked before any paid call and a failing arm left out and reported (section 12), and stage 2 takes R113's one interim look only if it is ever planned above $500 paid. It also counts over-cap gold drops per arm and model and fails the judge route when they pass 5% of the check set, after the automated review found they could leave the check on a selected subset.

## Review record

One second-model review (GPT-6.2 Sol, high effort) read the first draft's scoring, stage and cap rules before the pull request opened: 12 findings (8 High, 4 Medium), all taken (section 18). The pull request's automated review found three Medium problems in the verdict rules over two passes, all taken (section 18). /ship's review found one blocker and three Medium notes, fixed in one Captain-approved edit (section 18). The pull request's own review, run by gstack's /ship at its final head, is recorded in the pull request body.

## Disclosures

gstack is Garry Tan's own project, and his team runs this eval.

## Agent notes

<details>
<summary>Sources and checks behind this plan (internal)</summary>

- /cso read in full at gstack 5afef04e31de (1.101.0.0): cso/SKILL.md, cso/sections/audit-phases.md and manifest.json; sha256 values in prereg.json.
- Helper probe, keyless, 2026-11-19: `gstack-cso-launcher start --repo <toy repo> --budget 120` inside `unshare -n` returned status running, mode daily, scope default, offline false. `doctor` reports static-snapshot ready with git alone.
- Candidate order: lanes/outcome-skills/h2h/ordinary/commands.ts orderFile over b2-frame.json with draw_seed 3469618895, then filtered to published from 2026-07-01. The head-to-head's 73 B2 units are its 12 stage 1 and 60 stage 2 units (from its exported session records and sealed pilot file) and its stage 0 unit; 5 of them predate July. Its 5 reserves are not in the list because their ids sat in a draw file on a host that no longer exists.
- Head-to-head security sessions, plain Opus: 29 of 60 verified fixes when told the advisory; cost per session mean $0.20, median $0.18, 95th percentile $0.47; median wall 2.3 minutes. That is a different task (fixing when told), so it gives no headroom reading for finding; stage 1 does.
- VM price derived from the head-to-head's runtime host cost (about $45 a day for 60 vCPUs), so about $12 a day for 16.
- Unverified and marked so: Opus 5.5's June 2026 cutoff and Sol's 2026-04-30 report (carried from earlier posts); every planning cost per session; whether "/cso " with T as its arguments starts a default daily run (stage 0 checks it); how Codex resolves "the cso skill from gstack" by name (the Sol stage's smoke checks it).

</details>
