---
id: 2026-11-17-geva-546-day-one-usefulness-prereg
kind: plan
title: "Preregistration: does plain Opus, the same plan after a one-paragraph day-one pass, or the same plan after gstack's /autoplan give the owner an app that works on day one?"
summary: "15 sealed synthetic app briefs with hidden day-one task lists, plus 2 real briefs. Arms: plain Opus plan, a day-one pass, /autoplan --full with an Astra second voice. Builds are checked in a browser."
author: GEVA-546
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-17
status: open
links:
  - 2026-11-09-geva-412-plan-mode-intentions
  - 2026-11-14-geva-527-design-review-constructed-units-prereg
  - 2026-11-10-geva-513-product-value-stage-1-results
  - lanes/day-one
  - https://github.com/garrytan/gstack/tree/5b4fa9ea335e3ba743a36e3269da95980b77b32d/autoplan
---

# Preregistration: does plain Opus, a day-one pass or /autoplan give the owner an app that works on day one?

## Approval

The project owner asked for this test: does gstack's planning review make what gets built more useful on the first day, or does a plain plan with one short product pass do as well? The Captain ruled on its design on 2026-11-17 (rulings A1, B1, C2, D1, F1, G1 and H1, with conditions; this post follows each one and names where). The design went to the Captain as a memo and came back as those rulings, so no separate /autoplan run reviewed this post; the pull request's /ship review is its review (Review record). This post approves no spend. No paid call runs, the smoke included, until it merges and the Captain records every line's cap in approvals.

## ELI5

When someone asks an agent to build them a small app, the agent first writes a plan and then builds from it. gstack has a skill, /autoplan, that reviews a plan the way a CEO, a designer and an engineer would, with a second model from another company checking each part, before any code is written. It is thorough and slow. A cheaper idea is to tell the planner one thing: picture the owner opening the app for the first time, name the first five things they will try, and make sure each one works.

This test checks which of the two gives the owner an app that actually works on day one. We wrote 15 short app requests in the voice of an ordinary person (a dog walker, a choir leader, a small landlord), each with a hidden list of the 5 or 6 things that person will try first. Plain Claude Opus 5.5 writes a plan for each. Then two fresh sessions improve that same plan: one with the one-paragraph day-one pass, one with /autoplan. A simulated owner answers questions from what the person knows. Opus builds each plan once, and a separate model then tries every hidden task in a real browser and says which ones work. The score is the share of tasks that work.

Two real requests from the project owner's own recent builds run too, plans only, scored against what he actually complained about or asked for after he used what got built. They describe; they don't decide.

## Before → after

Before: a factory rule has new app builds skip /autoplan's review chain and write a one-page day-one plan instead, until this test reports. Nobody has measured whether /autoplan, the day-one page or neither helps the first-day result. The plan-mode intentions research lists /autoplan's main intentions, and none is scored by what gets built.

After: a frozen, paired test on 15 sealed briefs that reads, with 95% intervals, whether the /autoplan review (A) and the day-one pass (D) each make the built app do more of the owner's first tasks than the plain plan they started from (N), and whether A beats D. The result picks keep, slim or cut for that rule, and it decides whether a strengthened /autoplan that adds the day-one pass ships.

## Why it matters

Most new apps in the factory start from a plan, and the review chain costs real time and money per plan: at planning prices an /autoplan --full review costs about 25 times what the plain plan does. If it makes first-day apps work better, builders should keep it. If one paragraph does as well, the chain should go for app plans. If neither helps, the one-page rule is ceremony. The project owner's own recent experience is the reason to ask: a plan went through the full review and the first version still missed what he tried first.

## What caused this work

The project owner's first use of a new personal app, built from a plan that went through the full review, turned up complaints about things he tried first that the plan never covered. The factory then adopted the interim rule above and asked for this test. A survey of other planning skills found that none of the widely used ones asks outright what the owner will do first on day one, and two spec-driven tools tell the agent not to run the app at all. The Captain's design rulings set this eval's shape: a shared base plan, GPT-6 Astra as /autoplan's second voice through the metering proxy, a browser checklist that is itself validated as a judge, a simulated owner on every planning arm, and a frozen order of cuts if prices run high.

## Big decisions

1. **A shared base plan (ruling B1).** N writes the plan; D and A each review that same plan in a fresh session. Options: (a) three independent planning sessions; (b) a shared base plan. Pick (b): each comparison then differs only in the review step, it costs less, and later arms join as reviews of the same base plans. What it costs: gstack's effect on a first draft isn't tested here (section 18).
2. **Synthetic briefs carry the verdict; real briefs describe (ruling A1).** Only two real briefs have both the owner's words before planning and his reactions after first use, so no decision rests on them. The 15 synthetic briefs come from another model family, blind to the arms, and are sealed.
3. **Score what gets built, in a browser.** One Opus build per plan, the same build prompt for every arm, and a checklist run that tries each hidden task through Playwright's browser. The checklist runner is a model judge and has to pass its own check before any category 2 number counts (ruling D1).
4. **/autoplan runs as the factory runs it, with its second voice on GPT-6 Astra (ruling C2).** The voice goes through the metering proxy on its own slot. The provider key never enters the container: the container holds only that slot's bearer, and a keyless test proved it (section 12).
5. **A simulated owner on every planning arm (ruling H1).** The same channel and the same one-line notice go to every planning arm. It answers only from a sealed profile, else says it doesn't know, and on choice questions picks what the profile supports, else the recommended option. Answer types print by arm.
6. **Opus 5.5 only in wave 1.** N, D and A run on Claude Opus 5.5. GPT-6.1 Sol and particle-1 planners don't fit the money line beside the strengthened variants (section 18).
7. **The decision rule is frozen (section 10).** Keep, slim, cut or undecided for the factory rule, from three paired intervals, and the merge rule gstack's maintainers set for the strengthened /autoplan.

## Implementation plan

### 1. The question, the decision it changes, the claimed value and construct fit

**Question.** On new small web apps, does /autoplan --full (A) or a one-paragraph day-one pass (D), each reviewing the same plain Opus plan, make the app Opus builds from the plan do more of its owner's first tasks than the plain plan (N)?

**The decision (R97).** The factory's interim rule (R107) skips /autoplan for new app builds and uses a one-page day-one plan until this test reports. The reading in section 10 picks:
- **keep**: A beats N and A beats D. The rule ends and new app plans go back through /autoplan.
- **slim**: D beats N and A does not beat D. The rule's day-one page stays and the review chain stays off for app plans.
- **cut**: neither A nor D beats N. Neither step is shown to help; the day-one page becomes optional, and /autoplan gets R48's verdict below.
- **undecided**: anything else. The rule stays as it is, and the reading goes to the Captain with the strengthened arms' wave as the next step.

The strengthened /autoplan (section 15) has its own rule, set by gstack's maintainers: its second pull request merges only if S-full beats A by more than the MDD and doesn't lose to D; otherwise only the day-one pass ships and the cuts go to the project owner as cut candidates.

**The claimed value, one sentence (from the intentions inventory).** /autoplan runs the CEO, design, DX and eng reviews over a plan in one pass, answers the routine questions itself by stated principles, has two reviewers from different model families check each phase, and stops once at a single gate where the owner decides only taste calls and changes to their stated direction (wiki/research/2026-11-09-geva-412-plan-mode-intentions/inventory-autoplan.md, committed in b58c97047db2be7ca93dc2568527f41ca48955c0, read at gstack b6155921a564ba9ec2470fd2cb3894c05e2c2d13).

**Construct fit.** The inventory's claimed value is a better plan. This test scores one consequence of a better plan: whether the owner can do their first tasks in what gets built from it. That fits /autoplan's main intentions unevenly:

| Main intention | Scored here? | How |
|---|---|---|
| AP-CEO-1, challenge premises and scope | Yes, in part | Implied tasks rest on facts the owner knows and the brief leaves out; a plan that finds the real problem gets them. Six-month foresight isn't scored. |
| AP-DES-1, UI states, hierarchy, responsiveness, accessibility | In part | A task counts only when it works from the first screen with no hidden step, and empty starts are real. Responsiveness and accessibility aren't scored: the checker uses one desktop viewport. |
| AP-ENG-1, eng review of the final plan | In part | Failures that break a first task (data lost on reload, an import that fails) are scored. Test plans and architecture aren't. |
| AP-GATE-2, accepted changes land in the built plan | Yes | The builder reads the plan as amended. |
| AP-X-1, AP-X-2, AP-X-3, the one-pass procedure, full depth and two voices | No, reported as exposure | Section 8 reads them from /autoplan's run record. |
| AP-GATE-1, the owner decides at the gate | No | The simulated owner answers the gate; a real owner's judgment isn't present. |
| AP-DX-1, developer experience | No | No brief is a developer tool. |

**Changes to /autoplan since the inventory.** Six commits touched /autoplan's files between the inventory's pin and the pin here (5b4fa9ea335e3ba743a36e3269da95980b77b32d, version 1.99.5.0): the never-print-secrets rule now loads in every skill; the standalone /plan-eng-review command came back; the gate's recommended reply now applies every recommended plan change; the plan-approval gate item became p1; agent words are refused on owner-only answers; and the docs now say what lean and full runs load. None changes a main intention's text. Outside /autoplan's own files, the second voice's default model is now GPT-6 Astra, and GSTACK_CODEX_NO_SANDBOX lets that voice run without Codex's own sandbox (section 7). Both change how AP-X-3 runs, not what it intends.

**R48, kept apart from R107.** The keep, slim or cut reading follows section 10 as written. A null for A gets one Why-null cycle and a verdict on /autoplan. That verdict can be CUT-CANDIDATE only for the intentions marked Yes or In part above. It reads FIX-METHOD for every main intention marked No.

**For the strengthened variants** (section 15) the same rule cites the plan-ceo-review and plan-design-review inventories in the same research post. The day-one score covers CEO-1 (the real problem), CEO-2 in part (the user's felt first experience), CEO-5 in part (failures the user sees), DES-1, DES-2 (a clear first thing and next step) and DES-3 in part (empty states). It leaves CEO-3, CEO-4, CEO-6, DES-4, DES-5, DES-6, DES-7 and DES-8 untested.

### 2. Units

**Category 2: 15 synthetic briefs (the counted set).** A GPT-6.1 Sol author wrote 21 units, each a short brief in an ordinary person's voice, a profile of what that person knows, and a hidden ranked list of 5 to 8 day-one tasks, each with what counts as done, where it comes from (the brief, or a profile fact the brief leaves out) and the sample file it needs, if any. Three units were written as obvious: every task is stated in the brief. Three Gemini 4 Argon auditors read 7 units each and marked every unit and task keep, fix or drop: units 6 keep and 15 fix; tasks 99 keep, 26 fix and 1 drop. The author then applied 29 fixes, declined none and dropped that task. Every unit passes the loader's checks (5 to 8 tasks, ids and ranks in order, every named file present, no implied task in an obvious unit).

Labels were minted from random bytes. The 3 obvious units went into the set, and the other 18 were shuffled from random bytes into 12 more set units, 3 spares and 3 practice units.

| Split | Units | Obvious | Tasks | Implied | Sample files | Units digest |
|---|---|---|---|---|---|---|
| set | 15 | 3 | 89 | 32 | 6 | 315da04405dd98fceb1013b7a5942feaf065177d5964945a1f2422d0aa57c162 |
| spares | 3 | 0 | 18 | 9 | 1 | a2911e35586de29ffc62abfe8a963391e32bf2238b3d809dabc0b9b6d06d37cc |
| practice | 3 | 0 | 18 | 7 | 1 | 32bd8f8065df1f0d61dfa6d813d79476dc51677d3236b774c6788c4ebaab743f |

The digest is the product-value lane's rule over every file of every unit in the split, sealed files included (lanes/day-one/units.ts unitsDigest). The labels and digests are frozen in lanes/day-one/frozen.ts (UNIT_SETS), and every stage refuses a units folder whose split doesn't read back its digest. Spares replace a set unit only if a unit turns out unrunnable before its first counted session; a swap is reported. Practice units serve the smoke and are never counted.

Every category 2 brief reaches planners and the builder with this platform paragraph after a blank line:

```text
Platform: version 1 is a web app the owner opens in a browser on their own computer. It runs on Node 24 with only its standard library and plain browser HTML, CSS and JavaScript, with no package installs and no outside services, accounts or keys. ./start.sh starts it, serving on the port in the PORT environment variable.
```

**Category 1: 2 real briefs (descriptive, ruling A1).** Two requests the project owner wrote for his own recent builds, both from before any plan existed:
- a new personal app: his first message, 138 words, with its opening line cut under ruling F1. That line asked for planning help and told the agent to install gstack, which would hand the plain arm a gstack instruction. The product text stays verbatim. His later answers in that conversation are not in the brief; they reach the arms only through the simulated owner's profile (380 words). Its checks are 5 items (3 primary) written from his own complaints and asks after first use.
- a feature for an existing MIT-licensed public codebase: his own words as relayed verbatim when the work started, 113 words. Planners get the codebase at the commit the real plan was written against (pinned in custody). Its profile is 142 words and its checks are 2 items, both primary.

Each real brief's checks were written by a GPT-6.1 Sol author from the brief and the reactions, audited by Gemini 4 Argon, and fixed or dropped only as the audit said. The profiles were written by a separate Sol author that saw only what the owner had said before planning and never the reactions. Both units are sealed with a units digest of 9b73dedb3b37d6dca3cc401f4601db23bd4cd302009aca01968c7aa50db89225 (1,855 files, the codebase included).

### 3. Arms and the frozen texts

Every arm runs Claude Opus 5.5 in Claude Code at the pinned driver, with the claude-code-preset system prompt, a 200,000-token window, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, and WebSearch, WebFetch and AskUserQuestion denied. Each session's work folder is a fresh git repository with one commit, holding brief.md (and the codebase, for the second real brief) and, on a review arm, the base plan as plan.md.

- **N (no gstack).** Writes the base plan. No gstack, no drive and no state root anywhere in its container.
- **D (day-one pass, no gstack).** Reviews the base plan with one extra paragraph.
- **A (gstack /autoplan).** Reviews the base plan with /autoplan --full on gstack at 5b4fa9ea335e3ba743a36e3269da95980b77b32d (1.99.5.0), unattended as the factory runs it, its second voice on GPT-6 Astra (section 7). --full, because the factory's Capy default (lean) drops the second voice, a main intention.

Each arm's whole first message is built from these texts (lanes/day-one/frozen.ts armPrompt). N gets the common ask, a blank line and the owner notice. D gets the review ask, the day-one pass and the owner notice, each after a blank line. A gets the /autoplan line, the review ask and the owner notice, each after a blank line.

The common ask:
```text
The brief is in brief.md. Write a plan for this brief in plan.md.
```

The review ask:
```text
Review the plan in plan.md for the brief in brief.md and improve it.
```

The day-one pass (D only):
```text
Before you finish, do a day-one product pass. Picture the owner opening what you plan for the first time. Name the first five things they will try to do on day one, in the order they will try them. For each one, check that your plan makes it work on day one, from the first screen to the result, with nothing missing, hidden or left for later, and change the plan wherever one would not work.
```

The /autoplan line (A, and the strengthened variants at their own pins):
```text
/autoplan --full plan.md
```

The owner notice (every planning arm):
```text
The owner is available to answer questions while you plan.
```

The arm texts were written and hashed before anyone read the owner's reactions. The sha256 of all frozen prompt texts together, as frozen.ts computes it, is 3cebf1d3f218376d05416a2e266d2337e475747c20ed9d975eaa3e63954990f7.

**The arm's plan.** plan.md at the session's end when it differs from the base plan; for A, otherwise /autoplan's own active or exported plan when that differs; otherwise plan.md as is. A plan with no words is empty (E_DAYONE_NO_PLAN): its build is not run and it scores as doing nothing. An N session that ends with no plan gets the one retry; on the retry, or on a review arm, an empty plan stands.

### 4. The simulated owner (ruling H1)

Every planning arm, in both categories, gets the same channel. The builder and the checker get none.

- A reply asks the owner when its last 600 characters hold a question mark, or, on a gstack arm, when /autoplan's run waits at its gate. The asking reply goes to the responder as the question; the responder's answer comes back as the next user message. Otherwise the session ends at that reply.
- The responder is GPT-6.1 Sol on OpenRouter with OpenAI as the pinned provider, at low effort, one request per question with no transcript, through the rig's usersim persona prompt (src/usersim/persona.ts). The model stays fixed across arms and waves. Its persona text is the head below, the sealed profile, and the rules below.
- After 30 answers in a session, the closing message goes instead, and the reply to it ends the session.

```text
You are the owner of the project the assistant is planning. In your own words, this is you:
```

```text
Rules for your answers: answer only what was asked, and only from what you wrote above about yourself. If that doesn't cover the question, say "I don't know." When the question offers options, pick the one your own words above support; if they don't decide it, pick the option marked recommended, and if none is marked, say "I don't know, use your judgment." Never offer features, tasks or wishes you weren't asked about. After your answer, on a last line of its own, write SOURCE: profile, SOURCE: recommended or SOURCE: unknown, for where your answer came from. That line is removed before the assistant sees your reply.
```

```text
I need to stop answering questions now. Please finish the plan with what you have.
```

The SOURCE line is cut before the answer goes back and logged as the answer's type. Question counts and answer types (profile, recommended, unknown, untagged) print by arm beside every score. If A's gain rests mostly on answers of type recommended at /autoplan's gate, the results say so plainly.

**Fidelity bar, frozen before any transcript is read.** Ten transcripts are checked against their profile and hidden list: the smoke's planning sessions, plus a probe of 8 fixed questions on practice briefs if the smoke has fewer than 10 sessions with answers. The channel fails if any answer states a hidden-list task that isn't already in the profile, or if more than 2 of the 10 transcripts invent a fact that could change a plan. A failed bar drops the channel from wave 1 for every arm, and the Captain hears it before anything else runs.

### 5. Builds

One build per plan, on Claude Opus 5.5, in a fresh container whose work folder holds only plan.md, with Node 24 (the h2h runtimes' node pin, mounted read-only) on its PATH. No arm's build gets the brief, the owner or gstack. Every build gets this first message:

```text
Build version 1 of the app that the plan in plan.md describes, in this directory. Follow the plan; where it leaves a choice open, choose what serves the owner. Use Node 24 (node is on your PATH) with only its standard library and plain browser HTML, CSS and JavaScript: no package installs, no outside services, accounts or keys. When you finish, ./start.sh must start the app from this directory and serve it on the port in the PORT environment variable, and anything the app saves must live under this directory. Start it and try it yourself before you finish. Nobody will answer questions, so make your own choices.
```

Limits: 120 minutes, 600 turns per user message and a $15 allowance. The build ends at its first reply. Category 1 runs no builds.

### 6. The checklist run (category 2's score)

Each build runs in a browser container on an internal network with no route out: Playwright's MCP server (mcr.microsoft.com/playwright/mcp at sha256:8ca417ff2a3660b770d7dd4a293bd179d0f3c29d0d5fb5bc43d3be617b1566a2) with headless Chromium, the build's folder copied in writable, the unit's sample files read-only at /samples, and the same node. ./start.sh runs with PORT=3000. A build counts as started once its port answers within 60 seconds; one that never answers gets one more try in a fresh container and then scores no task done.

The checker is GPT-6.1 Sol in Claude Code (OpenRouter's Anthropic-compatible route), whose only tools are the browser's: navigate, back, snapshot, click, type, fill a form, choose, press a key, hover, drag, drop, upload, answer a dialog, tabs, wait, screenshot, resize and find. Its own folder is empty, so it sees the app only through the browser. Limits: 60 minutes, 400 turns and an $8 allowance. Its first message is the header, one block per hidden task in rank order (the task, what counts as done, and the sample file when the task names one), then the footer:

```text
You are checking version 1 of a web app the way its owner would use it the first time. The app is running at http://localhost:3000 in the browser your tools control, and the browser is the only thing you can use. Work through the owner's tasks below one at a time, in order, without skipping any. For each task, try to do it as the owner would, through the app's own pages: look at the page, click, type, choose, upload, reload, open a second tab. Only use what the app shows or tells you; never guess a hidden address. Files the owner brings are in /samples/; upload them with the file upload tool when a task needs one. A task is done only when you saw its success condition yourself in the browser. If you cannot find a way to do it within 25 browser actions, it is not done. Later tasks may use what earlier ones created.
```

```text
When you have tried every task, end your reply with one fenced block labelled verdicts that holds a JSON object {"tasks": [{"id": "t1", "done": true, "why": "at most 30 words on what you saw"}, ...]} with every task id exactly once. Only this block is scored.
```

**Parsing and the score** (lanes/day-one/verdict.ts, scorer code under ruling D1). The last fenced verdicts block of the checker's last reply must be a JSON object whose tasks list names every task id exactly once, each with a boolean done; anything else is unparsable, gets one more check in a fresh browser container, and a second unparsable answer leaves the build unscored, a gap and never a zero. A build's score is its share: tasks done over tasks on the list. It does nothing useful when none of its top three tasks is done, or it never started.

**The checker is a judge (R78, ruling D1).** It is validated at the task level before any category 2 number counts. Ten category 2 builds are drawn with the frozen seed, at least 3 from each arm. This eval's thread drives each one by hand through the same browser container and tools and labels every task done or not done, blind to arm and before reading any checker verdict; the labels are sealed before the checker's verdicts on those builds are opened. The checker needs kappa of at least 0.6 on done over at least 40 task verdicts, or no category 2 number counts. If 10 builds give fewer than 40 verdicts, more builds are drawn.

**Fixtures both ways (ruling D1).** A public fixture unit (lanes/day-one/fixtures/: a houseplant tracker with 5 tasks and a CSV) has two apps. The placeholder names every feature on its page and does nothing; it must score 0 with does-nothing-useful set. The reference really does every task; it must score 5 of 5. Both have already passed keyless with a scripted checker driving the same MCP server (section 12). The smoke runs both again with the real Sol checker, under the same bar; a miss stops the wave and goes to the Captain.

### 7. The rig: sessions, containment and the second voice

Every session runs on the Docker rig of the office-hours founder lane (dockerRig, runTrial and the Claude Code driver), on one Ubicloud runner VM that stays up for the whole run. Every model call goes through the metering proxy on a per-session slot and allowance, onto a ledger lease for its line.

**Containment.** Each container is probed just before it stops. A key-like env name other than the session's own bearers, a mount other than its work folder, HOME and, on builds, the node volume, or open egress halts the launch for the Captain. A halt is never retried.

**The second voice (ruling C2).** On a gstack arm, /autoplan's second voice is GPT-6 Astra through the Codex CLI (0.166.0 in the trial image), on its own proxy slot with its own meter and allowance ($15 a session). OpenAI's key never enters the container, its env, its files or its transcript. The route is the proxy pass-through: Codex's config names the proxy's slot as its provider, the container's OPENAI_API_KEY is that slot's bearer, and the proxy swaps in the provider key upstream. The containment probe checks that OPENAI_API_KEY equals the voice slot's bearer. Every Astra call is metered from OpenAI's own usage fields. gstack's resolver picks gpt-6-astra for plan review at this pin. GSTACK_CODEX_NO_SANDBOX=1 is set in gstack sessions only: Codex's own sandbox needs bubblewrap and user namespaces, which the trial container doesn't have, so the container is the sandbox.

Each session logs which voice ran: astra when the voice slot carried at least one request and every closed phase's outside voice completed, fallback otherwise (E_DAYONE_VOICE). Nothing swaps the voice silently, and every results line for A names the voice counts.

**Gaps and stops.** A cell (one unit, replicate and arm) gets at most two attempts: an infrastructure failure, a crash or a provider error on the first attempt runs once more in a fresh container, and on the second it is a gap, never a zero. A session that hits its own minutes or turns has ended, and its plan or build stands. A cap stop is an incomplete run, never retried to change a reading. A launch starts a round only when twice each session's allowance fits what its line has left.

### 8. Exposure and contamination

**A's exposure (R48's procedure gate),** read from /autoplan's own run record in the session's copied state root, never from what the model said: the run is complete (the gate was answered and applied); CEO and Eng closed; Design closed or skipped by /autoplan's own scope rule; every closed phase's native voice completed; and every closed phase's outside voice ended. Anything less is not exposed: reported beside every verdict, never counted as a loss. A's reading prints on all of its sessions and on its exposed sessions alone.

**Contamination.** Every session's transcript is searched for gstack reads, and every skill load is logged with its path (the loaded-skill log). Any gstack read or skill load in an N or D session marks it contaminated: reported, never scored. N and D containers hold no gstack, drive or state root by construction, so this is a descriptive check.

### 9. The plan judge (category 1, and descriptive category 2 reads)

GPT-6 Astra on OpenAI's API, at medium effort, labels each (plan, check) pair covered and usable on day one, from the frozen prompt lanes/day-one/prompts/judge.md (sha256 589f911a654afed3190e9baca17513977d596fc736dcf7c330589ea682e4596d). A packet is one plan with every check of its brief, the plan under a random label and the checks in a seeded order; packets go out in a seeded order and name no arm, model or source. A packet with a missing or garbled cell is sent once more, whole; a cell still missing stays unlabelled. Usable without covered reads as not usable. For category 2 the checks are the hidden list's tasks, the top three primary.

**Controls.** A stock generic plan (lanes/day-one/prompts/stock-plan.md, sha256 81f9bd5e15f5befb128791a058208ddd7602631d26c4a46529521c7c51a2bcb0) goes to every brief and must be covered on no primary check. The volume control is each base plan with the stock plan appended; its covered labels must match the base plan's on at least 90% of pairs. A failed control is reported and the judge's numbers don't count.

**Gold (R78).** At least 40 (plan, check) pairs from the real plan versions behind the two real briefs, labelled independently by Claude Opus 5.5 and Gemini 4 Argon (Carbon if it serves), blind to source and before the judge runs, with disagreements settled by a fresh Opus 5.5. The judge needs kappa of at least 0.6 against the settled labels on covered and on usable, or no judge number counts. Gold is labelled outside the judge's family, as R78 asks.

### 10. Readings and the decision rule

**Category 2 (counted).** Per brief, an arm's score is its build's share. A brief enters a comparison only when both arms have a score; unscored builds, contaminated plans and gaps leave their pairs, and every exclusion is listed. Each comparison X minus Y is the mean over briefs of the per-brief difference, with a 95% percentile interval from 10,000 paired bootstrap draws over briefs (seed 20261117).

The R107 reading (lanes/day-one/analysis.ts decide):
- **keep** when A minus N and A minus D both have intervals above zero;
- **slim** when D minus N's interval is above zero and A minus D's is not;
- **cut** when neither A minus N nor D minus N has an interval above zero;
- **undecided** otherwise.

**Secondary reads (descriptive).** The does-nothing-useful rate and top-three share per arm; the share of implied tasks and of brief tasks per arm; the 3 obvious briefs on their own; questions asked and answer types per arm; plan length per arm; A's exposure and voice counts; each arm's cost per brief; the judge's covered and usable rates on category 2 plans; and A minus N on exposed sessions only.

**Category 1 (descriptive).** Per arm and replicate, the share of primary checks the judge marks covered and usable, with no interval-based claim and no verdict.

**The strengthened variants (section 15).** S-full ships when S-full minus A is at least the MDD with its interval above zero, and S-full minus D's interval reaches zero or above; otherwise only the day-one pass ships and the cuts go to the project owner as cut candidates.

### 11. Power and MDD

The MDD is frozen in advance as 2.8 times an assumed paired standard deviation of 0.25 over the square root of the briefs compared: 0.18 at 15 briefs and 0.20 at 12. The observed paired SD and the MDD it implies print beside it. One build per plan makes builds noisy, so a real gain smaller than about a sixth of the task list may read as undecided; the results say so when it happens.

**Admission (after the smoke, before counted spend).** If both smoke N builds fail to start or do nothing useful, that is a floor: it goes to the Captain before the wave, with prompts unchanged (ruling D1). If all 5 smoke builds do at least five sixths of their tasks, that is a ceiling: it goes to the Captain with harder briefs as the R61 option. Otherwise the wave starts.

### 12. Keyless checks already run

Each runs with no key and no paid call, and printed these lines on 2026-11-17:

- **Dry run** (bin/gstack-evals day-one dryrun): units load and an empty list is refused; the owner channel cuts the SOURCE line, closes at the limit, reaches the owner at /autoplan's gate, ends on a reply with no question and stops on a failed responder call; session outcomes (end, cap, halt, contaminated, retry and the one-retry gap); the verdict parser and score (a good block, four bad blocks refused, a build that never started scores 0, an unparsable verdict unscored); keep, slim, cut and undecided; the judge's blind labels, resend, stock control and the 40-pair gold floor; the stage runner end to end on a stub rig (base, review, build and check, a cap stop and its refusal, a changed manifest refused, a crash marker reconciled, a leak halting the launch); the voice route on a real metering proxy against a stub provider (no bearer 403, the planner's bearer 403, the voice bearer 200, metered to the micro from the usage fields); one lease opened and settled per metered line on a temporary ledger with a second run id refused; caps that total $4,000; and the shrink order.
- **Fixtures** (bin/gstack-evals day-one fixtures): PASS placeholder, started, share 0, nothing useful; PASS reference, started, share 1, every task done.
- **Voice check** (bin/gstack-evals day-one voice-check): Codex 0.166.0 in the trial image, configured as the driver configures a gstack arm, answered through the voice slot; the stub provider saw only the proxy's key and model gpt-6-astra; the planner's bearer on the voice slot reached no provider; no provider key in the container's env or files; the slot metered exactly what the usage fields price.

### 13. Money (internal: a gate input, not part of any public post)

Planning prices, which the smoke replaces: N $1.50, D $1, an /autoplan-class plan $30 plus about $8 of Astra, a build $10, a check $3. Every line's cap goes into approvals before the first paid call, the smoke included. The caps total $4,000 exactly, so no mix of spends under them passes the all-in stop.

| Line | What it covers | Projection | Cap |
|---|---|---|---|
| day1-smoke | 3 practice briefs: N, D and A plans with A's voice, 5 builds, 5 checks, both fixtures with the real checker, the responder probe | $195 | $230 |
| day1-plans | N, D and A on 15 category 2 briefs and on 2 real briefs at 3 replicates | $690 | $830 |
| day1-voice | A's Astra voice, 21 sessions | $168 | $230 |
| day1-owner | The responder, every planning session | $20 | $30 |
| day1-builds | 45 builds | $450 | $540 |
| day1-checks | 45 checklist runs and the validation's reruns | $135 | $165 |
| day1-judge | Gold check, controls, category 1 and category 2 plans | $60 | $80 |
| day1-hosts | The Ubicloud runner VM | $60 | $80 |
| day1-crew | This thread, the run thread, gold labellers, checker validation, two /ship runs | $400 | $450 |
| day1-strengthened | S-full and S-dayone on 15 briefs: plans with their voice, builds and checks | $1,530 | $1,365 |
| Total | | $3,708 | $4,000 |

day1-voice rides day1-plans' ledger lease, because the rig's proxy holds one lease, so day1-plans' ledger cap is $1,060 (its own plus the voice line's). The voice still has its own slot, meter and allowance in every session, and each launch's voice cap is at most what the voice line has left. day1-strengthened's cap is the reserve left after every other line. It is recorded only when its pins land, and it doesn't cover its projection at planning prices; the smoke's prices and the shrink order settle that.

**Astra's price, against the design's $3,653.** The design memo projected $3,653 with no Astra. Astra adds about $408: $168 for A's 21 sessions and $240 for the strengthened arms' 30. The second real brief adds $65, the responder and judge $20, and the smoke $45. The runner VM comes down by $90 and the crew line by $400, to this thread's measured rate. Rounding adds $7. Net: $3,708, $55 more than the design, still under the $4,000 wave cap.

**The shrink order (ruling G1), applied once after the smoke and before any counted spend,** when the smoke's prices put the projection over $4,000. Each step keeps the ones before it: (1) category 1 to 2 replicates; (2) category 1 to its gold check and 1 replicate; (3) category 2 to 12 briefs, taken to the Captain with the number before any cut; (4) anything below 12 needs a ruling. A projection past $5,000 goes to the project owner through the Captain. If the strengthened pins haven't landed when the other arms finish, the reserve is held and reported, never spent elsewhere.

### 14. Order of stages, start rules and stops

1. This post merges, and the Captain records every line's cap in approvals.
2. **Smoke** on the 3 practice briefs: N, D and A plans on all three; builds of N, D and A on the first practice brief in label order and of N and A on the second; their checks; both fixtures with the real checker; the responder probe if needed.
3. **Fidelity check** of the owner channel on 10 transcripts (section 4). A fail drops the channel and goes to the Captain.
4. **Re-projection** on the smoke's prices, the shrink order at most once, and the admission read (section 11).
5. **Gold labelling** and the gold check (section 9), with a check-in with the Captain at gold admission.
6. **Category 2 wave**: N base plans, then D and A reviews, then builds, then checks, on the set's 15 briefs.
7. **Checker validation** (section 6) on 10 drawn builds. A fail means no category 2 number counts, and it goes to the Captain.
8. **Category 1 wave**: N, D and A plans at 3 replicates, judged.
9. **The strengthened variants** on the frozen base plans, once their pins land by a dated change.
10. **Results** in a second pull request, with R48's Why-null cycle, and every VM destroyed.

Each stage is its own launch on its line, with a frozen manifest; a launch whose manifest differs from its folder's is refused. A halt, a failed control, a failed fixture or a failed validation stops for the Captain.

### 15. Later arms

**Strengthened /autoplan.** gstack's branch for the strengthened review adds two arms, both /autoplan --full on the same frozen base plans, with the same owner, builder and checker: **S-full** (a strengthened /plan-ceo-review and /plan-design-review plus the day-one pass inside /autoplan) and **S-dayone** (current /autoplan plus only the day-one pass). Each is pinned to a commit on that branch by a dated change to this post's frozen file, before its first session. They run in wave 1 if the branch lands before the paid wave, and on the frozen set later otherwise. Readings: S-full minus S-dayone (the strengthened sections) and S-dayone minus A (the day-one pass inside /autoplan), with the merge rule in section 10.

**Outside planning skills** (from gstack's survey of other planning skills), each at a pinned commit and invoked as its own docs describe, with the same owner channel, builder and checker: BMAD's PM and UX agents; spec-kit up to its task list; compound-engineering's ce-brainstorm and ce-plan; superpowers' brainstorming and writing-plans. They write their own plans from the brief, so they compare at the brief level, paired by brief, not inside a base plan. They are not in the $4,000 and run only after a dated change that pins and prices them.

Every arm, later ones included, gets the loaded-skill log.

### 16. Custody, outside terms and public safety

Briefs, profiles, hidden lists, checks, the real briefs' plans, gold labels, transcripts and builds stay sealed with age in the Captain's custody store, with only counts and digests committed. Sealed material is decrypted only into RAM-backed /dev/shm for a job and wiped after it; every opening is logged in the custody record. Labels come from random bytes. The real briefs and their profiles and checks stay private; this post describes them only by kind. A published hidden list would let later models train on the answers.

**Outside terms and rights.** Anthropic's commercial terms cover every Opus call (planners, builders, gold labelling and adjudication). OpenAI's API terms cover every Astra call (the judge and /autoplan's second voice). OpenRouter's terms, with OpenAI as the pinned provider, cover every Sol call (the checker, the responder and the authoring). Gemini auditing and gold labelling run as Capy subagents under Capy's provider terms. Playwright's MCP server image is Apache-2.0 licensed and runs unchanged. The second real brief's codebase is MIT licensed and public; planners read it, and nothing from it is published. The synthetic units are our own invented text and name no real person. No public website is read by any arm. Ubicloud's terms cover the runner VM, which is destroyed at the end.

### 17. What the results post reports

It opens with two or three takeaways for builders, what works first and the null right after (R79), and the claim's scope in plain words: small new web apps from short briefs, one build per plan. Then: A minus N, D minus N and A minus D with intervals, MDD and the reading; the does-nothing-useful rates; exposure and voice counts; question counts and answer types by arm; the checker's kappa and the fixtures; the judge's controls and gold kappa; category 1 as description; the authoring funnel as counts; every gap, halt and contamination; cost per arm; R48's Why-null cycle and verdict, split by intention as section 1 says; and the context that no widely used planning skill asks what the owner will do first.

### 18. Risks, limits and not in scope

- The base plan is written without gstack, so gstack's effect on a first draft isn't tested. A reviews a plan it didn't write.
- One build per plan. Build noise is part of every score, and the MDD is large against it.
- The briefs are synthetic and short, written by one model family; the hidden lists are that family's guess at a first day. The obvious briefs and the implied-task split print separately.
- The checker is a model and one desktop browser viewport. Mobile, accessibility and visual quality are not scored.
- The Node standard-library platform keeps every build comparable and keyless, and it may floor some briefs; the admission read watches for that.
- The simulated owner answers from a profile, not a person, and picks the recommended option when the profile doesn't decide. /autoplan's gate meets a model, not its owner.
- GPT-6.1 Sol and particle-1 planners are out of wave 1 (R54 asks for them): they don't fit the money line beside the strengthened variants. A Sol planning wave is the first extension if money allows.
- The strengthened variants depend on another branch landing; their reserve doesn't cover their planning-price projection.
- Category 1 is two briefs and describes only; no keep, slim or cut and no R48 verdict rests on it.
- Not in scope: a person using the app, apps beyond small web apps, /autoplan's lean mode, the interactive (attended) skill, editing gstack, and posting anything.

### 19. Deviations from the brief

1. **The second voice runs on Astra through the proxy (C2 replaces C1).** The first ruling accepted a Claude fallback; the later ruling put Astra through a proxy pass-through, which section 12 tests keylessly.
2. **Real briefs at 3 replicates, not 5.** The design's money table moved category 1 to 3 replicates; the shrink order can take it lower.
3. **Two real briefs, not one.** The second qualified under ruling A1 once its brief proved to be the owner's own words.
4. **day1-voice shares day1-plans' lease.** The ruling asked for its own capped line in approvals. It has one, with its own slot, meter and launch cap, but the ledger lease is shared, because the rig's proxy holds one lease.
5. **No /autoplan run on this post.** The design went to the Captain as a memo and came back as rulings, which stand as its review; the pull request's /ship review covers the post and its code.

## Review record

The design memo went to the Captain on 2026-11-17 and came back as rulings A1, B1, C1 (later replaced by C2), D1, F1, G1 and H1; this post applies them and section 19 lists where it departs. No /autoplan run reviewed this post. The pull request's /ship review is its review, at the depth gstack's review planner sets for the lane code it carries.

## Disclosures

Filled in at the results post from org research/disclosures.md.
