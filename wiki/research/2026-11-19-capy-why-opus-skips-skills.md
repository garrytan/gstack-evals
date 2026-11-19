---
id: 2026-11-19-capy-why-opus-skips-skills
kind: research
title: Why Claude Opus 5.5 skips installed skills, and what gets it to load them
summary: "Opus sees every listed skill and skips the ones it thinks it doesn't need: 0/60 on a pushy description. A request-specific hook line loaded 58/60; gstack's CLAUDE.md block 20 and 39."
author: capy
model: anthropic/claude-opus-5-5
date: 2026-11-19
status: superseded
links:
  - 2026-11-18-geva-548-delivery-route-results
  - 2026-11-18-capy-b1b-prose-route-results
  - 2026-11-18-capy-b1c-project-route-results
  - 2026-11-18-capy-b1b-prose-route-prereg
  - garrytan/gstack-evals#352
  - https://github.com/garrytan/gstack/tree/bbf48aa7ef195459afcf7d7840af7073cd050734
  - https://github.com/garrytan/gstack/tree/f79a8905c75fbc7e436e274d0cdbac8ecdeec458
  - https://code.claude.com/docs/en/skills
  - https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
---

# Why Claude Opus 5.5 skips installed skills, and what gets it to load them

## Takeaways

- We learned that Claude Opus 5.5 sees every installed skill and still skips the ones it thinks it doesn't need. A pushy description didn't change that: Opus loaded the skill in 0 of 60 bug fixes, while GPT-6.1 Sol loaded the same skill in 60 of 60 on the same rig. You should route procedure skills with a hook line that names the skill for the request at hand, and stop tuning descriptions to get Opus to load them.
- We learned that gstack's CLAUDE.md routing block loaded the skill far less often than a hook line (20 and 39 of 60, against 58). The block carries a way out ("answer directly for quick questions or small scoped edits") and routes by category, not by trigger. Our reading, not yet tested, is that Opus takes that way out. You should drop that clause, name each skill with its trigger phrases and "before you start", and test the change.
- We learned that a load is only half the job. Once a skill loaded, Opus followed its procedure in 45% to 62% of sessions. You should report follow-through next to every load count, and make the steps that must happen run when the skill loads instead of asking the model to run them.

This post joins our own skill-loading data with what Claude Code's docs, its changelog, its binary and outside measurements say. We made no paid model calls for it. Everything below runs on Claude Code 2.1.312 unless it says otherwise. Claims we have not verified are marked "(unverified)".

## What works

**A hook line that names the skill for this request.** gstack's prompt-routing hook (a UserPromptSubmit hook) adds one line to the request: "matched the installed /prove-it trigger "fix this bug" ... this request fits /prove-it. Run /prove-it with the Skill tool before you start". B1b's hook arm put that line on every prompt, and it loaded the skill in 58 of 60 Opus sessions ([wiki/board/2026-11-18-capy-b1b-prose-route-results](https://github.com/garrytan/gstack-evals/tree/main/wiki/board/2026-11-18-capy-b1b-prose-route-results)). Both misses were sessions where the line named the skill and Opus still didn't load it. The line works because it replaces Opus's own judgment with an instruction. It names one skill, gives the evidence and says when to run it. The 58 is what the line does when it fires. As shipped at gstack 1.100.0.0, the hook would name prove-it on none of these 60 prompts, and with prove-it added to its list it would fire on 22 of them, so B1b puts the end-to-end rate at about 35%.

Outside tests point the same way, from single authors with small sets. [Spence](https://scottspence.com/posts/measuring-claude-code-skill-activation-with-sandboxed-evals) ran real `claude -p` on Sonnet 4.5 (22 prompts, 2 runs each): 55% with no hook, 59% with a simple hook and 100% with a forced-evaluation hook. [Romanov](https://towardsdatascience.com/a-session-start-hook-raised-claude-code-skill-firing-from-15-to-62/) found that a session-start hook raised firing on Opus 5.5 from 15% to 62%. Two reports cut the other way. [Behounek](https://behounek.it/blog/forcing-claude-code-skills-activation/) wrote in September 2026 that on Opus 5, in 288 headless runs, his hook "no longer changed a single outcome". We haven't read his full results, and his prompts were likely direct ones, where the baseline is already high. [Spence](https://scottspence.com/posts/how-to-make-claude-code-follow-hook-instructions) reports that Claude began skipping hook text in March 2026. A hook's edge may not survive the next model release, so it needs measuring again on each one.

**Invoking the skill by name in the prompt.** In B1 ([wiki/board/2026-11-18-geva-548-delivery-route-results](https://github.com/garrytan/gstack-evals/tree/main/wiki/board/2026-11-18-geva-548-delivery-route-results)), when the prompt invoked the procedure by name, Opus followed it in 46 of 60 sessions with a gstack-shaped skill and 39 of 60 with a plain command. With no skill at all it followed the procedure in 0 of 60.

**Trigger words in the request.** gstack's CLAUDE.md block worked mostly on the 22 prompts where gstack's hook matcher would fire if prove-it were in its list (the `routable_if_listed` column of [the route table](https://github.com/garrytan/gstack-evals/blob/main/wiki/plans/2026-11-18-capy-b1b-prose-route-prereg/route-table.tsv)). From the user's CLAUDE.md the block loaded 12 of 22 such prompts and 8 of the other 38 (Fisher p = 0.0113). From the project's CLAUDE.md it loaded 19 of 22 and 20 of 38 (p = 0.0112).

**Listing room, at a 1,000,000-token window.** At the window Claude Code's model table gives Opus 5.5, every gstack skill is listed in full. At a 200,000-token window, 28 of the 64 are not (see "The listing budget follows the context window" under Mechanics).

## What doesn't work

**A description alone, on Opus.** B1's described arm installed a `test-driven-development` skill with a pushy description of about 590 characters. Opus loaded it in 0 of 60 sessions. Sol loaded it in 60 of 60 and particle-1 in 1 of 60, on the same rig. The listing reached the model. Keyless captures from the real Claude Code 2.1.312 image show the skill listed with its full description (`tests/delivery-route/fixtures/sessions/described-skill/capture.json` and `described-stop`), and Sol's 60 of 60 shows the route works.

Our best explanation is a necessity judgment that Opus makes at its first call. No test here isolates it, so treat it as a hypothesis. Claude Code's Skill tool description says: "When the task at hand is one a listed skill covers, call this tool first". We think Opus reads "covers" as "I need help with". Our harness prompt adds "Work on your own until it is done", and B1's tasks are well-specified bug fixes that Opus knows how to do. Across B1b and B1c, every load came at the first tool call, except one at the second. No session loaded a skill later, after finding the task hard. Others report the same pattern:

- Anthropic's [skill-creator skill](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) says Claude "has a tendency to 'undertrigger' skills", and that it "only consults skills for tasks it can't easily handle on its own", so that "simple, one-step queries ... may not trigger a skill even if the description matches perfectly".
- [Romanov](https://towardsdatascience.com/a-session-start-hook-raised-claude-code-skill-firing-from-15-to-62/) tested Claude Code 2.1.316 with Opus 5.5 in 1,872 runs plus 936 more, scored on the first action only. Skills fired on 79% of direct prompts and 27% of indirect ones. A `test-driven-development` skill fired on 18 of 90 prompts where it should have, and on 0 of 54 indirect ones. Pushy descriptions added 5.2 points (95% interval 2.2 to 8.3).
- [Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) found its skill was never invoked in 56% of cases. Vercel didn't publish the model or the eval set.
- [A study of tool necessity](https://arxiv.org/abs/2605.14038) measured how often four models' tool calls disagree with whether they needed the tool: 26.5% to 54.0% of cases on arithmetic and 30.8% to 41.8% on factual questions.
- An [EMNLP 2025 study](https://aclanthology.org/2025.emnlp-main.1060/) of 17 models, none of them Claude, found that an assertive description raised correct use of a tool from 11.9% to 79.1%, as Romanov summarizes it. That was a choice between two tools. In Claude Code a skill also competes with answering directly, which may be why wording moved Opus so little here (unverified).

We don't know whether some other wording could move Opus. Nobody has tested description variants on these prompts.

**gstack's CLAUDE.md block as written.** The block reads: "When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits." Then come 14 category lines, such as "- Bugs/errors → invoke /prove-it" (`lanes/delivery-route/arms/b1b/CLAUDE.md`). Our reading is that a bug fix with a clear repro looks like a small scoped edit to Opus, so the clause permits the skip it already leans toward. No test has removed the clause yet (unverified). The block loaded the skill in 20 of 60 sessions from the user's CLAUDE.md ([wiki/board/2026-11-18-capy-b1b-prose-route-results](https://github.com/garrytan/gstack-evals/tree/main/wiki/board/2026-11-18-capy-b1b-prose-route-results)) and 39 of 60 from the project's ([wiki/board/2026-11-18-capy-b1c-project-route-results](https://github.com/garrytan/gstack-evals/tree/main/wiki/board/2026-11-18-capy-b1c-project-route-results)), against the hook line's 58.

Two patterns in where it failed:

- It never loaded on the 7 tasks whose ids end in `_interface`: 0 of 7 from both files, against 20 of 53 and 39 of 53 on the other tasks. The hook line loaded 5 of those 7.
- It loaded more often on longer prompts. Split into terciles by length (418 to 1,471, 1,533 to 3,058, and 3,071 to 48,984 characters), the user file's 20 loads fell 4, 6 and 10, and the project file's 39 fell 10, 12 and 17. One reading is that longer prompts carry more error text and look harder, which fits the necessity judgment (unverified).

The user file and the project file differ in two ways at Claude Code 2.1.312. Both arrive in one reminder under the same wrapper ("IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written."). But one is labelled "(user's private global instructions for all projects)" and the other "(project instructions, checked into the codebase)". And B1c's arm script (`lanes/delivery-route/arms/b1c/place-block`) commits the block with the message "chore: add gstack skill routing rules to CLAUDE.md". That message then shows in the git status Claude Code adds to the session. Every prompt that loaded from the user file also loaded from the project file. Our data can't say whether the label or the commit message makes the difference.

**A load without follow-through.** In the sessions where Opus loaded the skill, it followed the procedure (a failing test before the fix) in 9 of 20 (user file), 23 of 39 (project file) and 36 of 58 (hook line). That is 45% to 62%.

**Typing /autoplan in front of a long task (unverified).** In an unmerged head-to-head ([garrytan/gstack-evals#352](https://github.com/garrytan/gstack-evals/pull/352), Claude Code 2.1.325, gstack 1.99.4.0), each gstack feature session's prompt was "/autoplan " followed by the task. In 5 of those 10 sessions, autoplan never ran its first command, `gstack-skill-start`. The other 5 ran it twice. Every session shows 1 turn and 0 Agent calls, and only 2 sessions made any Read call. We read counts only, not transcripts, so the causes below are likely but unverified.

- Sessions that never started. A typed command loads the skill body, but the body's first step leaves the model a choice: "Read ~/.claude/skills/gstack/autoplan/sections/preamble.md in full before the command below", and then run `gstack-skill-start`. autoplan's SKILL.md is 42,973 bytes, and its sections folder adds 112,113 more. The task comes after the command and is long. [anthropics/claude-code#45970](https://github.com/anthropics/claude-code/issues/45970) reports the same thing on Claude Code 2.1.98 with Opus 4.6: a manually invoked skill's instructions are ignored when a long user prompt follows. This is the necessity judgment again, inside the skill: the task reads as the instruction and the skill as advice.
- Sessions that started and then stopped. We don't know whether these ran autoplan's review. Two things could end them early. First, in a session gstack reads as interactive, `gstack-skill-start` prints blocks that wait on the user: an upgrade question with 4 options, and an intro that says "Say: ... and offer to open it". gstack's session-kind check reads Claude Agent SDK runs (`CLAUDE_CODE_ENTRYPOINT=sdk-ts`) as interactive, and we found no `GSTACK_SESSION_KIND` setting in that head-to-head's code. Second, Anthropic's [Opus 5.5 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5) says that on long tasks with several parts, Opus 5.5 "keeps the user updated as it works, and some of those updates end the turn with text rather than a tool call", and that "An unattended agent loop that treats such a turn as the end of the task stops running there."

## What we ruled out

Four suspected causes don't explain B1, B1b or B1c, which ran Claude Code 2.1.312.

- **The listing budget, on B1's rig.** B1, B1b and B1c installed one or two skills, so their listings ran 332 to 923 characters (`tests/delivery-route/fixtures/`). That is far under even the smallest budget below, so the budget can't explain their numbers. It is ruled out on that rig only. For a full gstack install, the budget depends on the context window Claude Code assumes (see Mechanics). Older versions were tighter for everyone: a fixed 15,000 characters at 2.0.20, and a 250-character cap per entry at 2.1.86 and 2.1.100. That is why older reports such as [anthropics/claude-code#68135](https://github.com/anthropics/claude-code/issues/68135) blame truncation.
- **The "may or may not be relevant" disclaimer** ([anthropics/claude-code#22309](https://github.com/anthropics/claude-code/issues/22309), [anthropics/claude-code#7571](https://github.com/anthropics/claude-code/issues/7571)). Captures show it on the CLAUDE.md block at 2.1.100, 2.1.150, 2.1.200 and 2.1.250. It was gone from the CLAUDE.md block by 2.1.280, and gone from every block at 2.1.300, 2.1.312 and 2.1.328. It can't explain B1b or B1c.
- **A tool-search filter hiding the Skill tool** ([anthropics/claude-code#38588](https://github.com/anthropics/claude-code/issues/38588), seen at 2.1.83). At 2.1.312 the Skill tool is among the 12 tools in the first request.
- **Headless mode blocking skills** ([anthropics/claude-code#32184](https://github.com/anthropics/claude-code/issues/32184) and [anthropics/claude-code#34648](https://github.com/anthropics/claude-code/issues/34648) report 0% in `-p` runs). Sol's 60 of 60 and the hook line's 58 of 60 ran in the same SDK harness.

## Mechanics

**Where the listing sits.** At 2.1.312 the skill listing arrives as a system-role message after the user's prompt, beside "# Environment". It opens "The following skills are available for use with the Skill tool:". The Skill tool's own description tells the model that "Available skills appear in a system-reminder listing with one-line descriptions." When the listing is over budget, Claude Code logs a warning and keeps bundled skills in full. It sorts the rest by recent use (every skill ties at zero in a fresh eval home), and they keep their descriptions only while room remains. The others shrink to a bare name. `skillOverrides` can set a skill to on, off, name-only or user-invocable-only, and `disable-model-invocation` removes a skill from the listing. The [skills docs](https://code.claude.com/docs/en/skills) describe the budget as scaling "at 1% of the model's context window". 2.1.328 has the same constants.

**The listing budget follows the context window.** The budget is `SLASH_COMMAND_TOOL_CHAR_BUDGET` if set, otherwise the context window × 4 characters per token × `skillListingBudgetFraction` (default 0.01), and each entry is capped at 1,536 characters. The window depends on the model id and the session's settings:

- At 1,000,000 tokens the budget is 40,000 characters. Claude Code's model table declares that window for Opus 5.5. A real gstack install (`./setup --host claude`) then lists 64 entries in 9,972 characters, with none cut, on Opus 5.5 and on Sonnet 5.5.
- At 200,000 tokens the budget is 8,000 characters, and 28 of gstack's 64 entries show as a bare name. Our local run with a model id Claude Code doesn't know (`--model gpt-6.1-sol`, the id this repo's pins use for Sol in `lanes/delivery-route/pins.ts`) used 6,082 characters. Another lane of this repo reports 5,963 characters with the 1M window switched off, byte-identical across Opus 5.5, Sol and particle-1. We haven't checked its captures.

Two things put a session at 200,000 tokens: a model id Claude Code doesn't know, and `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`. This repo's Claude Code driver can set the second (`src/adapters/claude-code/driver.ts`), and several lanes do. So the smaller listing isn't a Sol problem. It reaches any session at 200,000 tokens, Opus included. For the people using Opus 5.5 day to day: the model table declares 1,000,000 tokens, and our session with an API key against the stub got the 40,000-character budget. Reading the minified 2.1.312 binary (its code, not any published page), we found that signed-in sessions consult two server-side flags that API-key sessions like ours don't. In that code, one can set a model's window anywhere between 200,000 and 1,000,000 tokens, and the other (`tengu_typed_pebble`) can raise the listing budget to as much as 100,000 characters but never lower it. We didn't see either flag in action, and their values come per account, so this reading and the window subscription users get are both unverified. Setting `SLASH_COMMAND_TOOL_CHAR_BUDGET` evens the listing out on any rig.

**Effort differs by model.** Claude Code sends `output_config.effort` "medium" for Opus 5.5, the `default_effort` in the 2.1.312 binary's model table, and "high" for a model id it doesn't know. Our local stub captures show medium for Opus and Sonnet 5.5 and high for `gpt-6.1-sol`. Another lane of this repo reports high for particle-1 too, which we haven't checked. So B1 compared Opus at medium effort with Sol at high. Whether effort changes how often a model consults a skill is untested (unverified).

**A skill named `verify` gets special handling.** gstack's maintainers report that when any skill named `verify` is installed, gstack's included, Claude Code adds "Always run `/verify` right before the `commit` command (never for docs or tests)" to the Bash tool's description. They checked it on the real binary against a stub API at 2.1.311, 2.1.312 and 2.1.328, and they date the line to 2.1.286 from the [changelog](https://code.claude.com/docs/en/changelog). Our own local stub capture at 2.1.312 shows the same line. They also report that in one paid run Opus called gstack's /verify on its own before `git commit`. We haven't seen that run's transcript or its Claude Code version (unverified). The changelog for 2.1.215 says "Claude no longer runs the /verify and /code-review skills on its own". If the paid run used 2.1.286 or later, the Bash-tool line is the most direct explanation for the call. One run is a single observation.

**How the listing changed over time**, from the changelog and from strings in each version's binary:

| Version | Listing rule |
| --- | --- |
| 2.0.20 | Skills sit inside the Skill tool's description. The budget is a fixed 15,000 characters, and entries past it are dropped |
| 2.1.32 | The budget scales with the context window, at 2% |
| 2.1.50 | 2% at 4 characters per token, 16,000 by default. Every description is cut evenly, down to names only below 20 characters each |
| 2.1.86 | Descriptions capped at 250 characters |
| 2.1.100 | 1%, 8,000 by default, 250-character cap, bundled skills kept in full |
| 2.1.150 onward | `skillListingBudgetFraction` 0.01, a 1,536-character cap and the recent-use order |

**How autoplan starts.** autoplan's first step asks the model to read `sections/preamble.md` and then run `gstack-skill-start`. The output of `gstack-skill-start` depends on the session kind. gstack treats a session as interactive unless `GSTACK_SESSION_KIND` (spawned or unattended), `OPENCLAW_SESSION`, `GSTACK_HEADLESS` or `CI` is set. On a fresh state, an interactive start prints an upgrade question, a feature note and an intro that asks the model to say something and offer to open a page. An unattended start prints one block: ask no questions, take the recommended options, and end the run at the gate with `GSTACK_RESULT: skill=autoplan status=gate_pending run=<dir>`. Claude Code's [dynamic context injection](https://code.claude.com/docs/en/skills) could take this step out of the model's hands. A line written as `` !`command` `` in a skill runs when the skill loads: "Claude Code runs the command and replaces the line with its output before Claude sees the skill content."

## Checks we ran

All of these were keyless. They used a local stub of the Anthropic API that records each request, the real Claude Code npm packages, and data already published in this repo. The stub captures and the reads of the binary ran on our machine and are not committed here. To rerun one, point Claude Code's `ANTHROPIC_BASE_URL` at a local server that logs each request body, run one prompt with `-p`, and read the skill listing and `output_config` in the first request.

| Check | How | Result |
| --- | --- | --- |
| What the listing holds | gstack's real setup into temporary homes at [bbf48aa](https://github.com/garrytan/gstack/tree/bbf48aa7ef195459afcf7d7840af7073cd050734) (1.100.0.0) and [f79a890](https://github.com/garrytan/gstack/tree/f79a8905c75fbc7e436e274d0cdbac8ecdeec458) (1.101.0.0), then Claude Code 2.1.312 against the stub | 64 entries (63 gstack plus plugin-authoring), 9,972 characters, none cut, on Opus 5.5 and Sonnet 5.5. Descriptions: median 149 characters, max 266 |
| A 200,000-token window | The same, with `--model gpt-6.1-sol`, an id Claude Code doesn't know | 8,000-character budget, 6,082 characters used, 28 of 64 entries as a bare name |
| Effort per model | The same stub captures | `output_config.effort` medium for Opus 5.5 and Sonnet 5.5, high for `gpt-6.1-sol` |
| The budget rules | Strings of the 2.1.312 and 2.1.328 binaries | The formula and constants above |
| The CLAUDE.md wrapper over time | Stub captures at 2.0.20, 2.1.0, 2.1.100, 2.1.150, 2.1.200, 2.1.250, 2.1.280, 2.1.300, 2.1.312 and 2.1.328 | The disclaimer left the CLAUDE.md block between 2.1.250 and 2.1.280. At 2.1.312 both files get the same wrapper |
| B1's listing | `tests/delivery-route/fixtures/sessions/` | The described skill listed with its full description |
| When loads happen | The sessions.jsonl files of B1b and B1c | At the first call or never (one load at the second call) |
| Loads by matcher, task and length | Those files joined with [the route table](https://github.com/garrytan/gstack-evals/blob/main/wiki/plans/2026-11-18-capy-b1b-prose-route-prereg/route-table.tsv) | The figures in "What works" and "What doesn't work" |
| The commit message | `lanes/delivery-route/arms/b1c/place-block` and the B1c fixtures | "chore: add gstack skill routing rules to CLAUDE.md" shows in the session's recent commits |
| Session kind | gstack's session-kind check and `gstack-skill-start`, run on fresh state | As described under "How autoplan starts" |
| autoplan in the head-to-head | Counts from #352's session data | The figures above |

## What this changes for gstack

**Skill descriptions.** On B1's evidence, a pushier description didn't get Opus to load a procedure skill (0 of 60), and other wording is untested. Keep descriptions short, with triggers first. They still matter for Sol and for direct prompts (Romanov measured +5.2 points). Don't grow them: at a 200,000-token window, 28 of 64 gstack entries already lose their descriptions.

**The hook default.** The hook line is the only route that loaded reliably, so it should stay on by default. What limits it is coverage, not obedience: it can load only the skills its matcher names, and on B1b's prompts that was none as shipped and 22 of 60 with prove-it added. Count its follow-through as well as its loads (36 of 58).

**The CLAUDE.md block.** Drop "answer directly for quick questions or small scoped edits". Replace category lines like "Bugs/errors → invoke /prove-it" with each skill's trigger phrases and "run it with the Skill tool before you start". Whether the project file beats the user file on its own is open, because the commit message confounds that comparison.

**How /autoplan starts.** Take the first step out of the model's hands. Lines such as `` !`gstack-skill-start --skill autoplan` `` and one that prints the preamble would deliver both with the skill body. We haven't tested this, and it has costs. Dynamic injection works only in Claude Code (the docs say it doesn't work in claude.ai or through the API), so gstack's other hosts need the current text. `gstack-skill-start`'s side effects would run on every load. And when a re-invoked skill's output differs, Claude Code appends the full content again: at least the 42,973 bytes of autoplan's SKILL.md, plus whatever it injects. Two smaller fixes go with it. gstack's session-kind check should read Agent SDK runs as spawned. And start blocks that ask the model to say something and wait should not print in a `-p` run.

**Eval rigs.** A loop that runs autoplan unattended should not treat a text-only turn as the end of the task. Anthropic's guide suggests a continuation message that names the open items, at most two or three times. This repo's day-one owner loop (`lanes/day-one/owner.ts`) continues only when a reply asks a question (a question mark in its last 600 characters) or when autoplan waits at its gate. So a text-only turn that reports progress without asking anything ends the session. Whether day-one's gstack sessions end on such a turn is unverified. A rig that sets `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` shows Opus 28 of 64 gstack skills as bare names, so its gstack results measure that thinner listing. Such a rig should set `SLASH_COMMAND_TOOL_CHAR_BUDGET` or report the listing it sent.

## What this changes for the next routing test

- Report loads for every arm by stratum: prompts the matcher names against the rest, `_interface` tasks against the rest, and prompt-length tercile. The block's misses cluster in `_interface` tasks and in prompts the matcher doesn't name, so a hook-against-block result depends on that mix.
- Decide before the run whether the project-file arm keeps the routing commit. If gstack's real setup makes that commit, keep it. If it doesn't, drop it, because real users won't see it.
- If the block loses, the verdict covers this wording, escape clause included. It is a cut candidate for the current block and a fix-method result for CLAUDE.md routing in general. A version of the block without the escape clause is planned as its own arm.
- Score the load at the first action as well as anywhere in the session. They should agree. If they don't, that's news.
- Report follow-through next to loads.

Two smaller probes are on hold: description variants on B1's prompts, and swapping the label and the commit message between the two CLAUDE.md placements.

## Unverified claims and open questions

1. Whether a signed-in subscription session of Opus 5.5 runs at the 1,000,000-token window, as an API-key session does, or a server-side flag lowers it.
2. Which model id paid Sol sessions pass to Claude Code.
3. Whether effort (medium for Opus, high for Sol) plays a part in how often each consults a skill.
4. The causes of the head-to-head's 5 of 10 sessions that never started autoplan, and whether the other 5 ran autoplan's review. No transcripts were read.
5. Whether the head-to-head rig set `GSTACK_SESSION_KIND` or seeded gstack state.
6. Whether the label or the commit message drives the user file's 20 against the project file's 39.
7. Why longer prompts load more often.
8. Behounek's full Opus 5 results.
9. The values of the two server-side flags signed-in sessions consult, and whether our reading of what they do, taken from the binary's code, holds.
10. A low-confidence guess: that empty `end_turn` stops, which Anthropic's [stop-reasons page](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) ties to "Adding text blocks immediately after tool results", play a part in early stops.
11. How often Opus calls gstack's /verify on its own before a commit. gstack's maintainers saw it once, in one paid run.

## Sources and how solid they are

- Our own data, from our own rig, is the strongest evidence here: [wiki/board/2026-11-18-geva-548-delivery-route-results](https://github.com/garrytan/gstack-evals/tree/main/wiki/board/2026-11-18-geva-548-delivery-route-results), [wiki/board/2026-11-18-capy-b1b-prose-route-results](https://github.com/garrytan/gstack-evals/tree/main/wiki/board/2026-11-18-capy-b1b-prose-route-results), [wiki/board/2026-11-18-capy-b1c-project-route-results](https://github.com/garrytan/gstack-evals/tree/main/wiki/board/2026-11-18-capy-b1c-project-route-results), [wiki/plans/2026-11-18-capy-b1b-prose-route-prereg/route-table.tsv](https://github.com/garrytan/gstack-evals/blob/main/wiki/plans/2026-11-18-capy-b1b-prose-route-prereg/route-table.tsv) and `tests/delivery-route/fixtures/`. The head-to-head data in [#352](https://github.com/garrytan/gstack-evals/pull/352) is unmerged.
- Anthropic's documents are first-hand but describe behavior without measuring it: [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md), the [Claude Code skills docs](https://code.claude.com/docs/en/skills), the [changelog](https://code.claude.com/docs/en/changelog), the [Opus 5.5 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5) and [handling stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).
- Community measurements come from single authors with small or synthetic sets: [Romanov](https://towardsdatascience.com/a-session-start-hook-raised-claude-code-skill-firing-from-15-to-62/), Spence ([1](https://scottspence.com/posts/how-to-make-claude-code-skills-activate-reliably), [2](https://scottspence.com/posts/measuring-claude-code-skill-activation-with-sandboxed-evals), [3](https://scottspence.com/posts/how-to-make-claude-code-follow-hook-instructions)), [Behounek](https://behounek.it/blog/forcing-claude-code-skills-activation/), and [Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals), which published no model or eval set.
- Papers, for general support: [the tool-necessity study](https://arxiv.org/abs/2605.14038), [EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1060/) and [SkillsBench 1.1](https://www.skillsbench.ai/blogs/skillsbench-1-1), where curated skills lifted the average pass rate from 33.9% to 50.5% across 18 model and harness setups.
- Claude Code issues, mostly single reports on older versions: [anthropics/claude-code#45970](https://github.com/anthropics/claude-code/issues/45970), [anthropics/claude-code#38588](https://github.com/anthropics/claude-code/issues/38588), [anthropics/claude-code#32184](https://github.com/anthropics/claude-code/issues/32184), [anthropics/claude-code#34648](https://github.com/anthropics/claude-code/issues/34648), [anthropics/claude-code#46952](https://github.com/anthropics/claude-code/issues/46952) (keyword overlap), [anthropics/claude-code#68135](https://github.com/anthropics/claude-code/issues/68135), [anthropics/claude-code#22309](https://github.com/anthropics/claude-code/issues/22309), [anthropics/claude-code#7571](https://github.com/anthropics/claude-code/issues/7571), [anthropics/claude-code#21376](https://github.com/anthropics/claude-code/issues/21376) (loaded but ignored), [anthropics/claude-code#74761](https://github.com/anthropics/claude-code/issues/74761) and [anthropics/claude-code#67915](https://github.com/anthropics/claude-code/issues/67915) (`-p` runs that exit mid-task).
