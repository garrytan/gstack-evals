
# Intentions inventory: plan-tune (TUNE), eval-plan (EP), shared preamble (PRE)

Pin: gstack main b6155921a564ba9ec2470fd2cb3894c05e2c2d13 (2026-11-08), read in ~/.capy/work/geva412/gstack. All paths below are relative to the gstack repo root. Line numbers cite the generated runtime files unless marked `.tmpl`.

Template offsets (checked with diff; bodies identical apart from the noted expansion):
- plan-tune: `.tmpl` line N = SKILL.md line N+69 for the body (`.tmpl` 34-684 = SKILL.md 103-753, diff empty). `{{PREAMBLE}}` at `.tmpl` 33 expands to SKILL.md 26-102.
- eval-plan: `.tmpl` line N = SKILL.md line N+78 up to `.tmpl` 212 (`.tmpl` 25 = SKILL.md 103). `{{FREE_TEXT_FILE:GATE_FILE=gate-command}}` at `.tmpl` 213 expands to SKILL.md 292-298; after it the offset is +85. `{{PREAMBLE}}` at `.tmpl` 23 expands to SKILL.md 25-101.

## Files read

| Path | Lines | sha256 | Read in full |
|---|---|---|---|
| plan-tune/SKILL.md | 753 | a4d01bb2b43ef9f649fb1932d850b733f81db1229ed01cc755f12f73bcfa26ed | yes |
| plan-tune/SKILL.md.tmpl | 684 | 69eb433e6387a018bfe43823fa0bd87a1431de4da097eb37dda5298db3bdae8d | yes |
| plan-tune/sections/preamble.md | 255 | 3eeee274045c6af4a3a4a88895944a348e3f8613232f44e04875fd1318861705 | yes (byte-identical to the plan-ceo-review copy) |
| eval-plan/SKILL.md | 352 | eb12e2d4a5ce9e51eef7529070dbc7892d7dca0ab3c702d620b73432c3e3e025 | yes |
| eval-plan/SKILL.md.tmpl | 267 | 256f1b4e67745b256e5639e34de7b7dd7ed8151fb6a73d5d6091a86617101642 | yes |
| eval-plan/sections/preamble.md | 255 | 3eeee274045c6af4a3a4a88895944a348e3f8613232f44e04875fd1318861705 | yes (identical) |
| plan-ceo-review/sections/preamble.md | 255 | 3eeee274045c6af4a3a4a88895944a348e3f8613232f44e04875fd1318861705 | yes; all 45 `*/sections/preamble.md` share md5 1dddc6c24f8c3d3c5f01fd3bdb18bb1a |
| bin/gstack-eval-plan | 277 | 65d174ccea069af59980886c16458092c4cee27ad292dfeccbcf40045feda960 | yes |
| lib/eval-plan.ts | 741 | 79ffae600ceb96dc6fa736d77389e0a6a7d3ba22231cbeb9829754c4e217989f | no: 1-146 (prereg check), 286-355 (dry run), 386-516 (pilot, report) |
| lib/eval-plan-report.ts | 46 | 676ed45b472c5765ae9c36b863edfc5676a098c715750da8ca44504fa5177a1a | yes |
| docs/eval-calls.md | 194 | 7a8423114cf386e1a79634ad0febcf169d174439c1975d3faece899037e95ebb | yes |
| docs/eval-models.md | 91 | f44416f51c137ff94fbf323a831ba77d43ad6c54ba7da785d5e94de3dfc8c56e | yes |
| docs/TESTING_INTERNALS.md | 2132 | 44c8578718ea507c8ec3306faa6b3b029a159d04e0f34945d2f78efa4f2703b4 | no: 1921-2069 (No-gstack arm, Frontier models under test) |
| ETHOS.md | 364 | 4281fd98ce872b9f96f1fc2359d878ce68498ebb82ed879f4ded5639868b75ea | no: 253-292 (Explain the Number) |
| docs/skills.md | 1653 | dbd54755a105ef37a4e4fbbd83b8ddb3fa6f2006e351285466e7452b31a5479b | no: lines 38, 50, 906-936 |
| README.md | 328 | 37d496d0e4925e3b3e34723c127f558d23ab2182ae19b122ac783b8f2ad4d442 | no: line 176 |
| AGENTS.md | 274 | 457c6c934fbfe0f0067423009230fb1a25fd42c3d8e95a28b03588ec5ca66bbc | no: 1-75 (skill area table) |
| bin/gstack-question-preference | 395 | aec066706883456eddb67bbb6677613cf35fb990fa4696dd27bbc55292d243bc | yes |
| docs/designs/PLAN_TUNING_V0.md | 410 | 403d16d28aeb36d9d50693417385e54007e6c757b845d9f1efef6fcf94952832 | yes |
| docs/designs/PLAN_TUNING_V1.md | 237 | 00ee5f309a9345bb0b8b2c3d02245598e1fb5927f06e3da821365c639be7983f | yes |
| scripts/one-way-doors.ts | 166 | d080aded8a03ad2ef179aa9527fd304d97c77f4c33463419292e97bf8656cb2f | yes |
| bin/gstack-distill-free-text | 290 | b0f32c5bf15c2ebfa54dd417139b5f46ac30d0d6a927f5789178d9d73d1f3c16 | yes |
| bin/gstack-distill-apply | 184 | 4705d0b65073a9017f602cdeb8f64eb2da778001688c0a680512f48970132e16 | yes |
| bin/gstack-developer-profile | 822 | 2c9e8e2e026207ed14728421d792e21042df86953162b19891c0d5b75ba77915 | no: 1-60, 480-640, 780-822 (header, --profile, --gap, accumulate, --vibe, dispatch) |
| scripts/question-registry.ts | 658 | 7385a50486ff4839482222ad1fa318e30125778e3234a17fab00ee1d822885cd | no: 1-60, 560-600 (header, plan-tune entries) |
| scripts/resolvers/preamble-hoist.ts | 116 | 777ef2ad6f053a65034fc891485b687ae4ac1ba05204464ca0b624f89416d022 | yes |
| docs/askuserquestion-split.md | 224 | 9d948b4a5cad4bed893e08ee6a34b783c6859982346a7c2503d14907881e64c9 | yes |
| docs/askuserquestion-cjk.md | 29 | a70240c7de8e92c168904bf15e33cbbbd08c39fbbbfd37c39c986507fded86f5 | yes |
| bin/gstack-skill-start | 811 | 830915c614c3565d0a0c156a1a9fb1e760afa4e669456740734cfdb23d25a78d | no: 1-40, 85-115, 160-170, 250-262, 360-376, 768-790 (status lines, session kind, plan-mode echo, spawned block) |
| bin/gstack-question-log | 316 | fee895fa5f8e3a8544497ddf2221a85692ac32010c23535098c6857a13ef12b7 | no: 1-45 plus a grep for registry handling |

UNREAD (referenced but not opened): scripts/jargon-list.json, scripts/psychographic-signals.ts, scripts/archetypes.ts, lib/pricing.ts, lib/spend-ledger.ts, lib/eval-models.ts, bin/gstack-config, bin/gstack-gate, bin/gstack-models, bin/gstack-context-recovery, bin/gstack-decision-log, bin/gstack-learnings-log, bin/gstack-session-kind, lib/eval-plan.ts 147-285, 356-385 and 517-741, bin/gstack-developer-profile 61-479 and 641-779, bin/gstack-skill-start outside the ranges above, bin/gstack-question-log 46-316, scripts/question-registry.ts 61-559 and 601-658.

---

# Part A: plan-tune (TUNE)

## Inclusion verdict

**Meant to run before code, shaping a plan: no.**

Lines that say so:
- It is an inspection and configuration tool for question tuning and a developer profile, not a plan workflow: plan-tune/SKILL.md:104-117 (title "Question Tuning + Developer Profile", the scope list, and "The profile itself never changes a skill's defaults").
- Every route in Step 0 is about profile, preferences, logs or on/off: SKILL.md:121-165.
- "This skill inspects and configures": SKILL.md:733-735.
- It writes only gstack state (gstack-config, developer-profile.json, question-preferences.json), never a plan file, and has no EXIT PLAN MODE gate (only the codex, plan-ceo-review, plan-design-review, plan-devex-review and plan-eng-review templates include one).
- Design doc: the feature exists because skills fire AskUserQuestion constantly and users want repeats to stop: docs/designs/PLAN_TUNING_V0.md:14.

Lines that point the other way:
- AGENTS.md:21 files `/plan-tune` under area "plan", and the name says "plan".
- Setup Q1 asks about "planning a feature" (SKILL.md:255-259). That is a self-description question, not plan work.
- It can run inside plan mode, because writes to `~/.gstack/` are a permitted plan-mode operation (preamble:7).

**Recommendation: exclude plan-tune as a subject of the plan-mode eval program, but pin its state in every plan-mode arm (question_tuning off, no preference files), because a never-ask preference silently auto-decides gates inside plan-mode skills.**

## Claimed value, one sentence

plan-tune lets a user stop gstack from re-asking questions they always answer the same way, through explicit per-question preferences that act at once (one-way doors still ask), and shows a plain-English profile of how they steer without that profile changing any defaults (plan-tune/SKILL.md:104-115, 198-203, 733-735; docs/designs/PLAN_TUNING_V0.md:14, 33-34).

## Intentions table

| ID | Intention (plain words, paraphrased) | Stated or implied | Citations (file:line) | Main or secondary | Why main/secondary | What "met" looks like, observably | Where it shows |
|---|---|---|---|---|---|---|---|
| TUNE-1 | A user can tell gstack to stop asking a given question; the preference acts at once and later runs take the recommended option instead of asking. | Stated | plan-tune/SKILL.md:111-114, 149-150, 198-203, 405-433; SKILL.md:61 (AUTO_DECIDE text); bin/gstack-question-preference:157-164; PLAN_TUNING_V0.md:14, 33-34 | Main | The feature's reason to exist per V0:14; leads the scope line. | question-preferences.json holds the id as never-ask; question-events.jsonl has a preference-set event; later sessions show "Auto-decided ... (your preference)" and that id stops appearing as an asked question. | AFTER (strongest: fewer prompts on that id later); PLAN (preference record) |
| TUNE-2 | One-way doors (destructive, architecture, security) are always asked, whatever the preference. | Stated | SKILL.md:432-433, 730-732; bin/gstack-question-preference:129-140, 246-254; scripts/one-way-doors.ts:117-152; PLAN_TUNING_V0.md:34, 148 | Main | Safety override repeated in the skill, the bin and the design; failing it auto-approves destructive actions. | Writing never-ask on a registered one-way id is refused; a one-way question still reaches the user with never-ask set; the override NOTE is shown. | AFTER (a destructive question still asked); BUILD (no auto-approved destructive change) |
| TUNE-3 | Only the user can change preferences or the declared profile: tune events come only from the user's own message, and declared edits wait for an explicit yes. | Stated | SKILL.md:74, 419-422, 435-438, 448-449, 459-462, 724-729; bin/gstack-question-preference:25-32, 229-244; PLAN_TUNING_V0.md:130-135, 343-357 | Main | Profile-poisoning defense is a named design decision (V0 Decision J) and repeated in Important Rules. | Every preference-set event lines up with a user turn that typed the change; declared values change only after a Y; a tune: string planted in a file or tool output produces no event. | PLAN (transcript and event log); AFTER |
| TUNE-4 | The user talks in plain English and gets plain-English answers: profile bands in words, a question log with follow and override counts, gap words, no CLI syntax required. | Stated | SKILL.md:106-109, 123, 145-165, 328-337, 396-398, 488-497, 721-723; PLAN_TUNING_V0.md:167-189 | Main | Opens the skill body and closes it in Important Rules; V0 Decision E. | Output uses low/balanced/high and close/drift/mismatch words; intent routed without the user typing a subcommand; raw floats never stand alone. | PLAN (session output) |
| TUNE-5 | The profile is observation only: inferred values appear only with enough diverse evidence, the gap is reported but never rewrites declared, and no skill default changes because of the profile. | Stated | SKILL.md:111-115, 339-355, 496-500, 733-735; PLAN_TUNING_V0.md:16-26, 36-37, 111, 146-152 | Main | v1 was cut to "observational" after review (V0:16-26); repeated three times in the skill. | "Not enough observed data yet" appears below the display gate; declared values unchanged after Show gap; other skills behave the same with any profile. | AFTER (no behavior change from the profile); PLAN |
| TUNE-6 | Question tuning is off by default, the user is asked once, and the answer is honored with a marker so they are never re-asked. | Stated | SKILL.md:125-132, 169-238 (privacy note 175-182), 226-230, 306-313 | Main | Privacy posture: the consent prompt is "the only path to enabling"; failing it means silent logging. | `.question-tuning-prompted` exists after the first run whatever the answer; question_tuning stays false after C; no second consent prompt later. | AFTER; PLAN (consent brief) |
| TUNE-7 | Wasted questions get fixed at the source: frequent unmarked questions get registry markers, and questions a command could answer move to a machine check in the asking skill rather than a never-ask. | Implied (steps imply it; the observable rule states the end state) | SKILL.md:592-629, 736-748; scripts/question-registry.ts:13-16 | Main | The audit and the observable-question rule serve gstack-wide question quality, the pain V0:14 names. Implied because the skill only lists and flags; the fix lands in other skills. | Later gstack versions add `<gstack-qid:...>` markers or replace an observable question with a check in the asking skill; audit output names that check. | AFTER (strongest: later commits to other skills); PLAN (audit flags) |
| TUNE-8 | A five-question setup records the user's declared steering style. | Stated | SKILL.md:240-318 | Secondary | Supporting procedure for the declared track. | developer-profile.json `declared` holds five values and `declared_at`; `.declared-setup-prompted` exists. | PLAN |
| TUNE-9 | Review the question log and point out often-overridden questions as never-ask candidates. | Stated | SKILL.md:363-401 | Secondary | Inspection feeding TUNE-1. | Top ids with counts and follow/override; offer to set a preference. | PLAN |
| TUNE-10 | Report calibration honestly: repeat the CALIBRATION line verbatim; answers that moved nothing are not calibration. | Stated | SKILL.md:504-557 (554-555) | Secondary | Reporting accuracy. | When CALIBRATION prints, the reply repeats it word for word. | PLAN |
| TUNE-11 | Let the user spot-check recent auto-decisions and flip a misfire to always-ask. | Stated | SKILL.md:561-588 | Secondary | Audit loop for TUNE-1. | Last 10 auto-decided rows shown; flip written only after Y. | PLAN; AFTER |
| TUNE-12 | Turn free-text "Other" answers into proposals (preference, declared nudge, memory nugget), each applied only after a per-item yes. | Stated | SKILL.md:633-715; bin/gstack-distill-free-text:1-7; bin/gstack-distill-apply:1-19 | Secondary | Optional loop, gated on proposals existing or an explicit request. | Proposals gain `applied_at` only when accepted; one question per proposal. | PLAN; AFTER |
| TUNE-13 | The user's words never pass through a shell command; they travel in an agent-written file. | Stated | SKILL.md:61, 76, 424-430; bin/gstack-question-preference:58-70, 188-197 | Secondary | Injection rail. | `.gstack/tmp/tune-words.txt` written then removed; no user phrase in bash text. | PLAN |
| TUNE-14 | Do not add question markers to skills without approval, because markers widen what can be auto-decided. | Stated | SKILL.md:625-629 | Secondary | Scope rail. | No template edits from a plan-tune session without an approval turn. | BUILD |
| TUNE-15 | Enable or disable tuning on a plain request. | Stated | SKILL.md:156-157 | Secondary | Convenience route. | gstack-config value flips; marker touched on enable. | PLAN |
| TUNE-16 | Ask plainly when intent is unclear; end with DONE, DONE_WITH_CONCERNS or NEEDS_CONTEXT. | Stated | SKILL.md:158-161, 749-753 | Secondary | Format and completion. | Menu question when ambiguous; status word at the end. | PLAN |
| TUNE-17 | Every brief carries the question-id marker and one `(recommended)` label so the hook can auto-decide and log. | Stated | SKILL.md:59-81 (63-65) | Secondary | Bookkeeping that makes TUNE-1 work in other skills; the same block is inlined in every tier-2+ skill. | `<gstack-qid:...>` in the question text; exactly one `(recommended)`. | PLAN |
| TUNE-18 | Mirror accepted memory nuggets to gbrain when gbrain tools exist. | Stated | SKILL.md:653-662, 680-688 | Secondary | Optional integration. | `--gbrain-published true` recorded; gbrain page exists. | AFTER |
| TUNE-19 | Log telemetry once at the end, even in plan mode. | Stated | SKILL.md:83-102 | Secondary | Telemetry. | One gstack-skill-end call. | PLAN |

Counts: 7 main, 12 secondary.

## Steps vs intention

1. **The user-origin gate is self-reported.** The bin accepts any write whose `source` says plan-tune or inline-user (bin/gstack-question-preference:229-244), and the agent writes that field. The design admits this (PLAN_TUNING_V0.md:135, 355). A model that obeys a planted `tune:` and labels it inline-user passes every check while TUNE-3 fails.
2. **"Logs stay local" is false for the dream cycle.** The consent text says logs stay local and nothing leaves the machine (SKILL.md:204, 217; V0:138). The distiller sends the user's free-text answers to the Anthropic API in a paid call (bin/gstack-distill-free-text:4-7, 182-222; default model at 215-217). A user can consent on a false premise.
3. **Dead RATE_CAPPED branch.** The skill scripts a reply for a "3 distills/day cap" (SKILL.md:704-705). The bin says there is no rate cap and never prints RATE_CAPPED (bin/gstack-distill-free-text:16-20, 92-93).
4. **Vibe ignores the declared profile.** The skill shows the vibe when calibration is met "OR if declared is filled" (SKILL.md:357-359). `--vibe` matches only `inferred.values` and falls back to 0.5 on every dimension (bin/gstack-developer-profile:784-799); the bin calls it a v2 stub (line 17) and V0:46 deferred vibe. A declared-only user gets an archetype computed from defaults.
5. **Profile and gap can be stale.** Inspect profile and Show gap read the stored file (bin/gstack-developer-profile:490-530) and the skill never runs `--derive` first; only Stats hints at it (SKILL.md:546). The plain-English view can be right in form and wrong in content.
6. **"Source quotes verbatim (proves user-origin)" proves nothing.** The quotes come from the distiller model's JSON and are never matched to the log (SKILL.md:650; bin/gstack-distill-apply:82-85, 142-151). Apply then writes the preference with source plan-tune.
7. **Agent-path auto-decisions are likely invisible to "Recent auto-decisions".** That view lists only rows with `source=auto-decided` (SKILL.md:563-576), which the PostToolUse hook writes. The agent path auto-decides (SKILL.md:61) and its log command carries no source (SKILL.md:69), so stats count it as `agent` (SKILL.md:523). Inferred from these lines, not run.
8. **The observable-question rule has no procedure behind it.** The rule says to flag observable questions in the audit and name the replacing check (SKILL.md:746-748), but the audit script only counts `hook-` ids (SKILL.md:599-623). The step can be followed to the letter with no observability judgment.
9. **Dream review relies on the model to skip applied items.** `--list` prints every proposal, applied or not (bin/gstack-distill-apply:60-87), while the skill says "for each unapplied proposal" (SKILL.md:646).

## Conditional loading and exposure

- The whole skill loads only when invoked. Step 0 gates fire on state files: consent (SKILL.md:130-132), setup (133-136), dream review (137-141).
- Contributor framing only when `gstack_contributor: true` (SKILL.md:194-224).
- The question-tuning block is skipped when `QUESTION_TUNING: false` (SKILL.md:59), as echoed by bin/gstack-skill-start:256-257.
- Inferred values show only past the display gate (SKILL.md:339-345), and per dimension only with 3 or more contributing answers (344-345; bin/gstack-developer-profile:519-524).
- Dream distill needs ANTHROPIC_API_KEY and spends money (bin/gstack-distill-free-text:182-194). The gbrain mirror needs `mcp__gbrain__*` tools (SKILL.md:680).
- Spawned or unattended sessions auto-choose (preamble:19), so consent and setup questions would be answered by the model unless the unattended gate-item rule holds.

Procedure-visible markers per main intention:
- TUNE-1: bin stdout `OK: <id> → <pref> (source: ...)` (bin/gstack-question-preference:296); a preference-set row in question-events.jsonl (286-294); later "Auto-decided ... Change with /plan-tune." (SKILL.md:61).
- TUNE-2: `NOTE: one-way door overrides your never-ask preference` (bin:137) or the refusal `cannot set ... on one-way question` (bin:251).
- TUNE-3: the Y/n confirmation in the transcript (SKILL.md:420, 460); exit code 2 rejection text (bin:238-243).
- TUNE-4: band and gap words in output (SKILL.md:330-343, 490-494).
- TUNE-5: the strings "not enough observed answers yet" and "Not enough observed data yet" (SKILL.md:344-345, 353-355).
- TUNE-6: the `.question-tuning-prompted` marker file and the consent brief (SKILL.md:197-230).
- TUNE-7: audit output lines or "(no unmarked questions, coverage is 100%)" (SKILL.md:617); there is no marker for the observable flag.

## Notes

- `.tmpl` vs generated: body identical. Only the frontmatter description differs: the `.tmpl` has a multi-line description with "Use when" triggers (SKILL.md.tmpl:5-14); the generated file keeps one line (SKILL.md:5).
- Dead reference: SKILL.md:178-180 cites PLAN_TUNING_V1.md "Decisions log" for the contributor privacy rationale. V1's decisions (V1:166-226) cover writing style and LOC; none covers contributors or consent.
- docs/skills.md:38 links to `#plan-tune`, but docs/skills.md has no plan-tune section.
- "Recent auto-decisions" has no Step 0 route and no shortcut; "Stats" is reachable only by the `stats` shortcut (SKILL.md:145-165).
- Drift from design: V0 says the log rejects unknown ids (V0:32, 121); the log bin accepts ad-hoc `{skill}-{slug}` ids (bin/gstack-question-log:14). V0 says only `inline-user` passes (V0:125, 135); the preference bin also accepts `plan-tune` (bin/gstack-question-preference:231). V0 lists `/plan-tune export` and `delete` (V0:139-140); the skill has neither.
- scripts/one-way-doors.ts:20 names `gstack-question-sensitivity`, an older name for the preference bin.
- The distiller's default model is claude-haiku-4-5 (bin/gstack-distill-free-text:217), an older generation.
- For an eval designer: plan-tune changes what every other tier-2+ skill asks. Any plan-mode eval must pin question_tuning and the preference files per arm, or the arms differ in which gates fire.

---

# Part B: eval-plan (EP)

## Inclusion verdict

**Meant to run before code, shaping a plan before building: no.** It plans a paid eval run, not a build, and its own steps leave plan mode.

Lines that say so:
- Its plan is an eval preregistration before the first priced call, not a plan for code: eval-plan/SKILL.md:103-110; README.md:176; docs/skills.md:906-908.
- It writes outside the plan file and `~/.gstack/`: the preregistration in the repo (SKILL.md:132, 145-148), `dry-run.json` and the ledger in `--out` (250-251, 259-263), a gate file under `.gstack/tmp` (292-298). Plan mode permits only plan-file and `~/.gstack/` writes (preamble:7, 255).
- Step 3 spends money through provider calls (SKILL.md:116, 253-263); Step 4 asks the owner to approve a full paid run (285-322).
- AGENTS.md:60 files it under "operational + memory", not "plan".
- No EXIT PLAN MODE gate and no plan review report.

Lines that point the other way: Steps 1 to 1c (SKILL.md:130-227) are plan-like work done before any spend, and "Spend nothing before Step 3" (116) makes the first half pre-execution.

**Recommendation: exclude eval-plan from the plan-mode eval program; evaluate it separately as an eval-method skill (gstack-evals is its natural user), and if a plan-like slice is wanted, score preregistration quality from Steps 1 to 1c only.**

## Claimed value, one sentence

eval-plan puts three gates between an eval idea and its first priced call (a filled preregistration, a $0 dry run on the real inputs, and a three-item priced pilot whose extrapolated cost the owner approves) and makes the results show a no-gstack arm beside every variant (eval-plan/SKILL.md:105-110, 154-163, 324-336; README.md:176).

## Intentions table

| ID | Intention (plain words, paraphrased) | Stated or implied | Citations (file:line) | Main or secondary | Why main/secondary | What "met" looks like, observably | Where it shows |
|---|---|---|---|---|---|---|---|
| EP-1 | A complete preregistration (bars with the public lesson, arms, comparison, decoys, stop rules, held-out exposure) exists before any priced call and stays frozen once the pilot starts. | Stated | eval-plan/SKILL.md:105-110, 119-120, 130-152; lib/eval-plan.ts:26, 131-141; ETHOS.md:277 | Main | First of the three gates and the skill's name; a changed bar after spend is "a new eval". | Prereg file committed before spend.json's first reservation; `PREREG: ok`; no diff to bars, arms, decoys or stop rules after the first settle. | PLAN (prereg file and git history) |
| EP-2 | Nothing is spent until a $0 stub-model dry run passes on the real development rows (prices, output budget, retry text, cap fit, frontier check). | Stated | SKILL.md:105-108, 116, 229-251; bin/gstack-eval-plan:163-183; lib/eval-plan.ts:311-353, 395-398 | Main | Second gate; the pilot refuses to start without it. | `dry-run.json` with `pass: true` predates the pilot; `DRY_RUN_RESULT: pass` in the log. | PLAN; BUILD (artifacts) |
| EP-3 | Spend is capped through a ledger; a refused reservation ends the step; no retries or split calls to slip under the cap. | Stated | SKILL.md:116-118, 259-263, 269, 282-283; lib/eval-plan.ts:395-430, 446-480 | Main | First Boundary; repeated in the stop rules. | spend.json shows spent plus reserved within cap; no attempt after `EVAL_BUDGET_EXHAUSTED`; none after the first quota error on a seat-metered arm. | AFTER (ledger and invoices) |
| EP-4 | The owner, not the model, approves the full run on an honest price: projection, spend table with unknown charges, gate prices, per-bar pilot results and stop rules, in that order; stop without asking on a missed bar, exhausted budget or a projection over the cap. | Stated | SKILL.md:108-109, 123-128, 277-283, 285-322; lib/eval-plan.ts:493-506 | Main | Third gate; the skill "never approves a priced run by itself". | The ask opens with `PILOT_PROJECTION:` and the table; option A recommended only when verdict=within; unattended runs end `GSTACK_RESULT: ... status=gate_pending`; no full run without an owner reply. | PLAN (approval record); AFTER (spend vs projection) |
| EP-5 | Every comparison that loads a skill stack has a masked no-gstack arm per model, and its row sits beside the variants before any number leaves. | Stated | SKILL.md:139, 143, 154-163, 324-336; lib/eval-plan.ts:110-129; lib/eval-plan-report.ts:32-45; docs/TESTING_INTERNALS.md:1921-1974 | Main | Its own step and error codes; only that arm shows a variant losing to the plain model (TESTING_INTERNALS:1924-1926). | Arms list `<model>#no-gstack` per model; results table fills each row; masking and read audit show no gstack file read by that arm. | AFTER (results table, audit) |
| EP-6 | Candidates cannot tell they are graded and judges cannot tell which arm they read. | Stated | SKILL.md:199-227 | Main | Every result's validity rests on it; a broken rule after spend is a new eval. | Fixture tree and prompts contain none of the banned words; the fixture root looks like a real project; judge inputs carry only A/B labels; the judge grades from transcript reads. | BUILD (fixture tree, judge inputs) |
| EP-7 | The run is after a stated public lesson, and its results open with two or three plain takeaways, wins first, then losses with numbers. | Stated (lesson line) and implied (the outputs serve it) | SKILL.md:137, 338-340; ETHOS.md:269-283 | Main | `lesson:` is the first required Bars line; the results file shape serves it. | Bars starts with `lesson:`; the results file opens with "We learned X. You should do X." bullets, including a loss with its number. | PLAN (lesson); AFTER (results file) |
| EP-8 | Held-out sets named in the prereg are never read, pasted or summarized; the dry run uses development rows only. | Stated | SKILL.md:121-122, 142 | Secondary | Integrity rail supporting EP-1. | No read of held-out paths; Held-out exposure table filled. | PLAN; AFTER |
| EP-9 | Models under test are frontier models; Haiku or Sonnet arms only with a stated tier question. | Stated | SKILL.md:189-191, 247; lib/eval-plan.ts:305-306, 346-348, 398; TESTING_INTERNALS.md:2040-2068 | Secondary | Policy rail. | `CHECK: frontier` ok; tier question recorded when small-tier arms exist. | PLAN |
| EP-10 | Arms obey the repo's committed model rules; a refused arm is replaced, not argued past. | Stated | SKILL.md:193-197; docs/eval-models.md:49-57, 66-78 | Secondary | Policy rail. | `EVAL_MODEL:` lines ok for every arm. | PLAN |
| EP-11 | Every arm has a price row; a missing price means add the row or drop the arm. | Stated | SKILL.md:174-187 | Secondary | Supports EP-3 and EP-4. | `ARM:` lines priced; no `price=MISSING` left. | PLAN |
| EP-12 | Declared diagnostics are tested on a synthetic fixture before the freeze. | Stated | SKILL.md:165-172; bin/gstack-eval-plan:121-138 | Secondary | Optional and conditional. | `PREREG_DIAGNOSTIC:` lines all ok. | PLAN |
| EP-13 | Seat-metered arms are declared at start, hold no cap, and end the run at the first quota error. | Stated | SKILL.md:265-270; lib/eval-plan.ts:400-405 | Secondary | Conditional cost rule. | `PILOT_SEAT_METERED:` lines; no attempt after a quota error. | AFTER |
| EP-14 | Every paid gate the plan names is priced from a bound call-plan file; stale or unpriced gates are not approvable without the owner's word. | Stated | SKILL.md:287-309; docs/eval-calls.md:78-117 | Secondary | Supports EP-4. | `GATE_PRICE:` lines in the ask; receipt JSON in `.gstack/tmp/price-gate/`. | PLAN |
| EP-15 | Gate command text reaches the pricer through a file, never a shell string. | Stated | SKILL.md:292-300 | Secondary | Injection rail. | `GATE_FILE:` printed; command written with the file tool. | PLAN |
| EP-16 | Each step prints one grep-able line so a parent agent reads results, not prose. | Stated | SKILL.md:110 | Secondary | Format. | PREREG, DRY_RUN_RESULT, PILOT_PROJECTION, GATE_PRICE and RESULTS lines present. | PLAN |
| EP-17 | Output budget meets the reasoning floor and the retry prompt text is set, so a retry is not a repeat at the same price. | Stated | SKILL.md:241-246; lib/eval-plan.ts:286, 337-338 | Secondary | Cost and quality rail inside EP-2. | `CHECK: output-budget` ok; `CHECK: retry-prompt` shows text. | PLAN |
| EP-18 | Telemetry once at the end. | Stated | SKILL.md:82-101 | Secondary | Telemetry. | One gstack-skill-end call. | PLAN |

Counts: 7 main, 11 secondary.

## Steps vs intention

1. **The freeze is not enforced.** `pilot start` never takes the preregistration (bin/gstack-eval-plan:9, 189-194; lib/eval-plan.ts:395-430), and no prereg hash is recorded. `results --check` reads the prereg at report time (lib/eval-plan-report.ts:32-45), so a bar edited after the pilot still passes. EP-1's freeze rests on the model (SKILL.md:119-120).
2. **The preregistration check counts lines, not substance.** A section passes with any one non-comment line (lib/eval-plan.ts:64-71, 131-141). `lesson:` is never checked, Stop rules need not name the cap, Decoys can say "TBD". The no-gstack `audit:` line only has to be something other than none, n/a, no or a dash (lib/eval-plan.ts:116). The checklist can be ticked with no plan behind it.
3. **"Pilot missed a bar" has no tool behind it.** The skill stops on a missed bar and presents per-bar pilot results (SKILL.md:282-283, 311-312), but `pilot report` computes cost only (lib/eval-plan.ts:446-506). The model must score bars itself and can skip it while every printed line looks green.
4. **Actual cost is typed by the agent.** `pilot settle --usd` takes whatever number it is given (bin/gstack-eval-plan:205-211). Settling estimates instead of invoice figures follows the steps and defeats the honest price in EP-4.
5. **Blinding and held-out rules are unchecked.** The skill says `prereg --check` does not read fixture trees (SKILL.md:205-206), and nothing checks held-out reads (121-122).
6. **The results check accepts any non-placeholder cell.** A row counts as filled if one cell is not blank, a dash, n/a, tbd, todo or "?" (lib/eval-plan-report.ts:12-28). It does not check that the masking audit passed or that numbers exist.
7. **An unknown verdict has no stop rule.** The skill stops on `exceeds` and budget exhaustion (SKILL.md:282-283) and recommends option A only on `within` (313). On `unknown` the report prints "APPROVAL: not ready" (lib/eval-plan.ts:505), but the skill text still describes asking.

## Conditional loading and exposure

- The no-gstack arm is required only with `stack: loaded` (SKILL.md:143; lib/eval-plan.ts:111). Diagnostics only with a `## Diagnostics` section, run only with `--allow-repo-commands` (SKILL.md:165-172; bin:125-138).
- Model rules only when `.gstack/eval-models.json` is committed (SKILL.md:193-197; docs/eval-models.md:75-76). Reservation-fits-cap only with `--cap` (SKILL.md:245; lib/eval-plan.ts:340-344).
- Seat-metered rules only with `--seat-metered` (SKILL.md:265-270). Unattended sessions write the approval as a gate item (127-128, 319-320).
- Step 4 gate pricing only when the plan names paid gates (287).

Procedure-visible markers per main intention:
- EP-1: `PREREG: ok present=6/6 ...` (bin/gstack-eval-plan:129) and the prereg file's commit time.
- EP-2: `DRY_RUN_RESULT: pass` and `DRY_RUN_RECORD:` (bin:176); `dry-run.json` in `--out`.
- EP-3: `PILOT: status=reserved ... ledger=` (bin:197), `SETTLED:` lines, `spend.json`; `EVAL_BUDGET_EXHAUSTED` when refused.
- EP-4: `PILOT_PROJECTION: ... verdict=` and `APPROVAL:` lines (lib/eval-plan.ts:504-505); `GSTACK_RESULT: skill=eval-plan status=gate_pending` when unattended (SKILL.md:320).
- EP-5: `PREREG: ... stack=loaded no_gstack_arm=ok` and `RESULTS: ok no_gstack_rows=N/N` (bin:129, 148).
- EP-6: none printed; only the fixture tree and judge inputs show it.
- EP-7: none printed; the `lesson:` line and the results file opening show it.

## Notes

- `.tmpl` vs generated: identical body apart from the `{{FREE_TEXT_FILE}}` expansion (SKILL.md.tmpl:213 = SKILL.md:292-298) and the preamble block. No disagreement found.
- Template drift: the prereg template's Stop rules comment omits the seat-metered quota rule that the skill's table lists (lib/eval-plan.ts:55 vs SKILL.md:141).
- The Tier 3 list (SKILL.md:342-352) names instrument audit, sealed paths, power tables and others as not yet in the skill. They are not intentions of the current skill and none run.
- The blinding word list bans "test" and "eval" in anything a candidate sees (SKILL.md:208-215). gstack-evals fixtures for plan-mode tasks should follow it whether or not eval-plan is in scope.
- Pilot default n is 3 (bin/gstack-eval-plan:194). With n=3 the t multiplier is 4.303 (lib/eval-plan.ts:440), so bands are wide by design.

---

# Part C: shared preamble (PRE)

File: plan-ceo-review/sections/preamble.md (255 lines, md5 1dddc6c24f8c3d3c5f01fd3bdb18bb1a, identical in all 45 tier-2+ skills at this pin). Header id `4e82fa4c839f` (line 3). Generated by scripts/resolvers/preamble-hoist.ts from the preamble resolvers; there is no hand-written `.tmpl` for it. Citations "preamble:N" below mean this file.

Scope correction: the preamble is loaded by every tier-2+ skill, not only plan-mode skills (scripts/resolvers/preamble-hoist.ts:4-16, 25, 28-30, 109-115). Each SKILL.md tells the model to Read it in full before the start command (for example plan-tune/SKILL.md:26-28, eval-plan/SKILL.md:25-27).

## Claimed value, one sentence

The shared preamble makes every tier-2+ session respect plan-mode limits, put each decision to the user as a structured brief with a plain explanation, a recommendation and a completeness score, write in a direct builder voice, recommend complete coverage with minimal code, back claims with evidence and end with an honest status (preamble:5-11, 49-84, 157-177, 204-208, 214-236; its own summary at plan-tune/SKILL.md:28).

## Intentions table

| ID | Intention (plain words, paraphrased) | Stated or implied | Citations (file:line) | Main or secondary | Why main/secondary | What "met" looks like, observably | Where it shows |
|---|---|---|---|---|---|---|---|
| PRE-1 | Plan mode is respected: host read-only rules win, the skill runs step by step inside them, the session halts at STOP points, and ExitPlanMode comes only after the workflow finishes. | Stated | preamble:5-7, 9-11, 253-255 | Main | Opens the file; the only text about the plan-mode contract every plan skill inherits. | No writes outside the plan file and permitted paths during plan mode; ExitPlanMode after the last step; for plan reviews the plan file ends with `## GSTACK REVIEW REPORT`. | PLAN (plan file, tool log) |
| PRE-2 | Every decision reaches the user as a decision brief: D-number, grounding, ELI10 with stakes, a recommendation with its reason, completeness scores when options differ in coverage, real pros and cons, and a Net line. | Stated | preamble:13, 37-43, 49-84, 109-124 | Main | The largest section; the skill pointer names AskUserQuestion format first. | Each asked question in the transcript or decision record has these fields; the prose fallback carries the ELI10, scores and recommendation triad. | PLAN (decision record) |
| PRE-3 | The user keeps control of decisions and of the option set: no silent auto-decide, no dropped options (split five or more), explicit typed confirmation for one-way doors, and cross-model agreement is only a recommendation. | Stated | preamble:19-22, 45-47, 86-100, 169; docs/askuserquestion-split.md:9-25, 168-189 | Main | Repeated across the format, the split rule and the voice; the split doc calls the option set "sacred". | Options offered equal options identified; split chains use `D<N>.k` ids; no destructive action without an exact letter or word in a user turn. | PLAN; BUILD (no unconfirmed destructive change) |
| PRE-4 | Recommend complete coverage of the requirement (tests, edge cases, error paths) with the smallest code; flag unrelated work; an accepted shortcut leaves a trail in code and the decision log. | Stated | preamble:74, 76, 204-208 | Main | Named "Completeness Principle"; every brief's scores depend on it. | Plans list tests, edge cases and error paths; built code has those tests; accepted shortcuts appear as `gstack-shortcut(dec-<id>)` comments and decision-log entries; later fixes land on the marked spots. | PLAN; BUILD (strongest: tests and markers); AFTER |
| PRE-5 | Claims rest on evidence, and the session ends with an honest status (DONE only with evidence; concerns, blockers and missing context named). | Stated | preamble:214-220, 228-236 | Main | Completion rules are named in the pointer; failing means a false "done". | The report names commands, revisions and the evidence kind; unverified work flagged; status is one of four words, with STATUS, REASON, ATTEMPTED, RECOMMENDATION when escalating. | PLAN (report); AFTER (no reverts of "done" work) |
| PRE-6 | Write like a builder to a builder: lead with the point, be concrete, tie choices to user outcomes, no filler or AI vocabulary, gloss jargon and frame questions by outcome unless terse. | Stated | preamble:157-177, 191-202 | Main | Voice and writing are named in the pointer and apply to every reply and brief. | Replies and briefs name files, numbers and user impact; banned words absent; jargon glossed on first use. | PLAN |
| PRE-7 | Carry context across sessions: recover recent artifacts, honor active decisions without re-arguing, log durable decisions. | Stated | preamble:179-189 | Secondary | Continuity support. | Decision-log entries for durable calls; reversals announced with a supersede. | AFTER |
| PRE-8 | Review every session for durable learnings and log them, or say none were found. | Stated | preamble:238-251 | Secondary | Bookkeeping. | A `gstack-learnings-log` call or "No durable learnings this session". | PLAN |
| PRE-9 | Spawned or unattended sessions auto-choose the recommended option, never a destructive one; unattended writes consent and approvals as pending gate items. | Stated | preamble:19, 31-35; bin/gstack-skill-start:775-779 | Secondary | Mode rule. | No AskUserQuestion calls in spawned runs; choices listed in the completion report. | PLAN |
| PRE-10 | Resolve the question tool correctly (Conductor, MCP variant, failure) and retry a failed call once only if no answer could have surfaced. | Stated | preamble:15-35 | Secondary | Tooling. | Prose brief under Conductor; at most one retry. | PLAN |
| PRE-11 | Stop and ask on high-stakes ambiguity, with two or three options. | Stated | preamble:210-212 | Secondary | Safety rail. | A brief before an architecture or data-model choice made with missing context. | PLAN |
| PRE-12 | Tell the user what is done and next at phase ends; stop looping on the same failed fix. | Stated | preamble:222-226 | Secondary | Process. | Short phase summaries; no repeated identical attempts. | PLAN |
| PRE-13 | Label effort in both human-team and CC time. | Stated | preamble:82, 118 | Secondary | Format. | `(human: ... / CC: ...)` on effort options. | PLAN |
| PRE-14 | Write non-ASCII text literally, never escaped. | Stated | preamble:102-107; docs/askuserquestion-cjk.md:8-15 | Secondary | Format. | No escaped code points in briefs. | PLAN |
| PRE-15 | Claude nudges: mark todos one by one, state the approach before heavy actions, prefer dedicated file tools. | Stated | preamble:138-155 | Secondary | Declared subordinate preferences (141-143). | Todo updates per task. | PLAN |
| PRE-16 | Relay artifacts-sync attention lines and fire the privacy gate when skill-start emits it. | Stated | preamble:126-136 | Secondary | Tooling. | One-sentence attention relay. | PLAN |
| PRE-17 | Keep closers short, except mandated reports and briefs. | Stated | preamble:174-177 | Secondary | Format. | A few-line closer. | PLAN |
| PRE-18 | Reply in the user's language; keep markers verbatim. | Stated | preamble:168 | Secondary | Format. | Reply language matches the latest user turn. | PLAN |

Counts: 6 main, 12 secondary.

## Steps vs intention

1. **The self-check is self-rated and rewards length.** The model ticks its own checklist (preamble:109-124). Each pro and con must be at least 40 characters (62-63, 78, 116), which rewards padding. A brief can pass every box with an empty ELI10.
2. **Completeness scores are self-assigned and steer auto-decide.** The model scores its own options on a 10/7/3 scale (74, 208) and puts `(recommended)` on one (72); AUTO_DECIDE takes that label (72, 80). A model that scores its favorite 10 looks complete and decides for the user under a never-ask preference.
3. **"One edit allowed" contradicts the permitted writes.** The footer says writing the plan file is "the one edit allowed in plan mode" (255). Line 7 also permits writes to `~/.gstack/`, temp prompts and generated artifacts, and every skill's telemetry is marked "PLAN MODE EXCEPTION, ALWAYS RUN" (for example plan-tune/SKILL.md:90). An eval cannot use "no writes but the plan file" as its pass rule.
4. **Shortcut markers belong to build time.** The accepted-shortcut trail is written "while implementing" (76). In plan mode nothing is implemented, so PRE-4's marker appears only in BUILD, if at all.
5. **The learnings review is satisfied by one sentence.** "Runs every time" (240-245) is met by printing the empty-result sentence.
6. **Spawned sessions hide the briefs.** Under `SESSION_KIND: spawned` the model must not ask or render briefs (19). A harness that marks runs spawned will see no decision briefs, so PRE-2 and PRE-3 cannot be measured there.
7. **DONE "with evidence" is self-reported** (231); nothing checks it.
8. **The voice ban list is checkable by grep; substance is not** (167). A reply can avoid every banned word and still be vague.

## Conditional loading and exposure

- Loaded by every tier-2+ skill (preamble-hoist.ts:28-30). A skill section with the same heading replaces the shared one (plan-tune/SKILL.md:28; preamble-hoist.ts:65-83, 99-102).
- Plan-mode sections bite only when the host is in plan mode. bin/gstack-skill-start:362-372 echoes `GSTACK_PLAN_MODE: active|inactive` from `CLAUDE_PLAN_FILE` or a force variable; neither plan-tune nor eval-plan branches on it.
- Writing Style is skipped when `EXPLAIN_LEVEL: terse` is echoed (191; bin/gstack-skill-start:253-255) or the user asks for terse.
- The split reference is read on demand with more than four options (99-100); the CJK doc on demand (106-107); the jargon list on the first jargon term (202).
- Spawned and unattended branches (19, 31-35); Conductor branch (20; bin/gstack-skill-start:214-215).
- The Plan Status Footer applies only to plan-review skills (255).

Procedure-visible markers per main intention:
- PRE-1: `GSTACK_PLAN_MODE: active` in the skill-start output plus where ExitPlanMode falls in the tool log; `## GSTACK REVIEW REPORT` at the end of the plan file for plan reviews.
- PRE-2: `D<N> -` headers, `ELI10:`, `Recommendation:`, `Completeness:` or the kind note, `Net:`.
- PRE-3: `D<N>.k` split headers and `<skill>-split-<slug>` question ids; typed confirmations before one-way actions.
- PRE-4: `Completeness: X/10` in briefs; `gstack-shortcut(dec-<id>)` comments in code.
- PRE-5: the completion status word and the STATUS/REASON/ATTEMPTED/RECOMMENDATION block; named commands and revisions.
- PRE-6: none beyond the absence of banned words and the presence of glosses.

## Notes

- No `.tmpl` exists for the shared file; it is generated (lines 1-2). A section is hoisted only when byte-identical across skills (preamble-hoist.ts:14-15), so per-skill blocks (start command, question tuning, telemetry) stay inline in each SKILL.md.
- Line 19 refers to "the Spawned session block". That text exists only in skill-start output for spawned sessions (bin/gstack-skill-start:770-779). Unattended sessions get no such block.
- The task's description "the preamble that every plan-mode skill loads" is narrower than the truth: plan-tune and eval-plan load it too, and neither is a plan-mode skill by the verdicts above.
- For eval designers: three preamble switches change what a plan-mode eval sees whatever the skill under test. QUESTION_TUNING with stored preferences auto-decides gates (Part A). SESSION_KIND spawned removes all briefs (19). EXPLAIN_LEVEL terse removes the writing layer (191). Pin all three per arm and keep the skill-start echo in each transcript.
- UNREAD ranges are listed under "Files read" at the top. None of them decides what the three texts tell the model to do, but scripts/psychographic-signals.ts and scripts/archetypes.ts decide what the profile and vibe show (TUNE-5, Steps vs intention item 4), and lib/pricing.ts decides EP prices.
