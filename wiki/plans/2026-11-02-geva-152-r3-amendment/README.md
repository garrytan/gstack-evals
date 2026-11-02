---
id: 2026-11-02-geva-152-r3-amendment
kind: plan
title: "R3 amendment: build pin, GSTA-2 rulings, R3a incomplete rules, particle-1 price, GPT-6.1 Sol on its own item, caps check"
summary: "Pins R3 (#121 at 8ad436d), its rulings and incomplete rules, particle-1 price as_of; Sol on its own $140 item; checks the caps at real values; reruns the dry run (135 of 135 lines)."
author: GEVA-152
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: open
links:
  - 2026-11-01-geva-101-r48-follow-ups-prereg
  - 2026-11-02-geva-122-r2-amendment
  - 2026-11-01-geva-125-untold-discovery-prereg
attachments:
  - ac47b5780a1d99091097efe304a1668583fa978e148e8bd2b3583f689ef0fd28  dry-run-r3.sh.txt
  - 9b4f5d7df0f4a9ed4c5612b2dcfa2b5801bf633b00cfd080ae6523a182a6214c  dry-run-r3.txt
  - 63ba44dd672c5069f1625a2554ec08597ca0510959bec2e9ca0271c7b82ae051  openrouter-gpt-6.1-sol.json
  - a3e63ef2da88a462f4afe15fbac6bec410f413ab9dc12b1bc3056ca0aca9b8e9  openrouter-particle-1.json
  - 9f5d1f34ae98af41e28507c40edb2bed7202e41af2e76b79924a4528f7f1567e  r3-plan-costs.py.txt
  - 91cab5f2c7d09e874e73183481c0dcc5fff71be3c27d2654daac2938b0caa513  r3a-caps.ts.txt
---

# R3 amendment

This post amends section 4 (R3) of [2026-11-01-geva-101-r48-follow-ups-prereg](../2026-11-01-geva-101-r48-follow-ups-prereg/README.md) (#112, main f0b81c0). Section 4.8's done line asks for it: once the R3 build merges, an amendment pins the build commit and the gstack commit and reruns the dry run at the pin, and R3a starts. The R3 build is #121. Every other rule, pin and attachment of #112 stands as written, and R1 and R2 are unchanged. Where this post names an attachment of #112, it means that file in #112's folder, pinned by its sha256 there.

R3a on Opus 5.5 starts when this post merges, on item r3a-screen at $150 including VMs, under the start rule in #112's section 5. GPT-6.1 Sol joins R3 on its own item, r3a-sol at $140 including VMs, and starts only after its build PR merges and a pin-only amendment binds it (section 6).

## 1. Pins

| What | Pin |
|---|---|
| R3 build (gstack-evals) for every R3a part | #121's merge commit 8ad436dc3403e3061440711dfe1d78cc59d7a7f9 (a squash of head d6a0452); every part runs from a checkout of it. Main at eae6efc holds the same quick/laneb tree, package.json and bun.lock (`git diff --stat 8ad436d eae6efc` on those paths is empty) |
| gstack for the told arm | garrytan/gstack 61e201ec08bcf59163ef2d3a69a26e334a536c04 (v1.91.295.0), as #109's gstack tar installs it: tar sha256 b93994689107ebc329b83b35c139b6a6e37ce6b4637f5c8a76dce961732c46b1, pinned in quick/laneb/arms/manifests/r3/gstack.json at the build pin. The told arm's /investigate is that commit's |
| none and placebo arms | #109's tars, none 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e and placebo ff6b909d89d87be16780b817bf799361263e0efcf931a2b1543db2b779c406f7 (the Captain drive's handoffs/GSTA-30/arms/SHA256SUMS.txt) |
| Harness | Harbor f3a5a923f6d722472c9e797af836ae4425fb215f with claude-agent-sdk 0.2.174 (runner/vm-bootstrap.sh at the pin), Claude Code 2.1.312, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every arm, the agent's default turn ceiling of 200 |
| Task set | the 93 ids of #112 (sha256 5d555f1ff7eb6d7f3b5fb760ad46992ab5fb49d975f4cbd4585a0cfa637fdc67), with a digest per task at harbor-datasets 86723674f04e4209ac479d0fb75d9d9f44b4377e in tasks/swebv-r3.json (sha256 61cff3ff899591a0bf8c3caecb3917520bfe71a2bbf99d10f80e0f870dc4c0f5). Each task keeps the dataset's agent timeout of 3000 s. The verifier limit is 6000 s: cells.r3.json's verifier_timeout_multiplier 2 on the dataset's 3000 s, which prepare-run.ts:89 puts in every swebv-r3 job (screen.ts:128 sets CELLS=cells.r3.json) |
| Cells and prices | config/cells.r3.json 7fe70d5ee4f55cd1efab783f08543192873ec1bd0ff071706df0d5d444ac5dbf (allowances: Opus 5.5 $4, particle-1 $1); config/proxy.json ba3927b68624958714c2fee7ac19836181c76a8bbabe148fbfdddce3d169c474 |
| Screen and its rules | r3/screen.ts c7a11aff14d42735066b00749cf43b905d2df1a9f95ccdbb48b7c078cf568eb0, r3/exposure.ts 98db9f1310ae3f0e7631ce8666368d2bcc579412636a417b2c4a3e090eae2f4f, runner/launch.sh ecb81c63aa35dc03c79eac11ab6149c24b26de2ef1b884c651b6e2e62ccc5f38, runner/vm-run.sh 7c149a38a54f4f52aa3b1e3f660b14bdb2b705c0262c968bea520e236667088a, runner/ledger.ts 9d9499646f21ba5a673a09ccb69ab70fb7f5850ee27f8b31fb9e6084b5ea7c33, analysis/analyze.ts 6ddca47eb3248768071428ae73428a511ddac00594c9a62000e3474208bbc68d |
| System prompt | claude-code-preset on every arm and model (section 2) |
| Ubicloud runner | ubi-runner.sh e53f11384dd6faa14bab96aff14ea42577787df285470e8a192ef24de62753a8, the user drive's ubicloud skill copy of 2026-11-02, saved in the Captain drive as handoffs/GEVA-161/pins/ubi-runner.sh. launch.sh calls the runner UBI_RUNNER names (launch.sh:25), and section 10 sets UBI_RUNNER to this copy and checks its sha256 before run binds the item. It accepts 320 or 640 GB disks (ubi-runner.sh:117 and :930) and names each VM ubirun-<owner>-<epoch>-<suffix>-t<UBI_TTL_HOURS> (:874) |
| Run settings | 8 trials at a time (screen.ts's CONCURRENT default), a standard-16 VM with 640 GB per part (UBI_SIZE is launch.sh's default; UBI_STORAGE=640 replaces launch.sh's default of 600, which the pinned runner refuses), each VM named with a 24-hour TTL (UBI_TTL_HOURS=24 in place of the runner's 3), VM hours settled at VM_USD_PER_HOUR=0.60 in blocks of VM_RESERVE_HOURS=4 ($2.40 a block), the ledger service on LEDGER_PORT=9911 and each next block reserved VM_EXTEND_LEAD_SEC=1800 ahead (launch.sh's defaults). Section 10's commands set each value explicitly. ORACLE=1, so each part's oracle gate runs before its paid batch, and an oracle failure makes R3a incomplete (sections 3 and 10) |

ledger.ts and analyze.ts differ in bytes from tag laneb-stacks-1-runner's, which #112's dry run used: main's lineage changed analyze.ts, and #121 added ledger.ts's reserve, settle and open commands. #112's frozen r3-dry.ts still prints its 135 R3 lines byte for byte at the pin (section 11).

The VM rate: Ubicloud lists standard-16 at $0.00831 a minute (about $0.50 an hour) with 320 GB of disk. Section 10 asks for 640 GB, and the price page lists no rate for the extra disk, so the ledger settles VM hours at $0.60 an hour, about 20% above the list price. The results post reports VM hours and this rate.

## 2. GSTA-2's three rulings

The Captain (GSTA-2) made three rulings on #121 that read the intent of #112's section 4 rather than its letter. They bind R3a, R3b and Sol's cells.

1. **Graded.** A trial is graded only when it has a verifier reward and a model response reached the agent (the proxy's ok_responses above 0, with the SDK log as a fallback). Anything else is infra. A trial with no model session can't admit a task, so the rule in #112's section 4.3, "a task is admitted when its graded screen trial failed", reads with this definition. A trial that hits its allowance or the agent timeout after a model response is still graded.
2. **Opened.** A told trial opened /investigate when the proxy saw the slash command expand in the first request (the body-load probe), or when the agent read the skill file itself. A slash command delivers the body without a file open, so either signal counts. The export keeps the two signals apart (cmd_names from the proxy, skill_opens from the agent), and its investigate_opened is true on either. The procedure gate of #112's section 4.5 counts a trial as exposed when it opened /investigate and its output shows the procedure (DEBUG REPORT or a Phase 1 to Phase 5 heading).
3. **claude-code-preset.** Every R3 arm on every model runs on Claude Code's own system prompt. It is part of R3's arm config (`none:system_prompt=claude-code-preset`, `gstack:told=investigate:system_prompt=claude-code-preset`, `placebo:told=investigate:system_prompt=claude-code-preset`).

Each cell's allowance-stop count, its trials with budget_stop true, goes beside every verdict in the run record and the results post: R3a's screen and pilot, and each of R3b's cells. analyze() at the pin prints no such count and record.json carries none (screen.ts:217-234), so the run thread counts it, one count per part, from the trials.jsonl that analyze writes (screen.ts:216). Nothing at the pin writes a trials.jsonl for R3b's cells, so the commands that freeze R3b's run name the file its counts come from. The count is report-only and changes no outcome rule.

## 3. When R3a is incomplete

#112 named one way for R3a to end incomplete: r3a-screen refusing a trial at its cap. The build adds the rules below, all accepted by GSTA-2. Each ends R3a incomplete (screen.ts exits 4) with nothing admitted, R3b does not start, and the Captain gets the record. None is rerun to change a verdict.

1. **A trial with no result.json is infra.** It counts toward the infra bound in rule 4.
2. **One trial per planned task.** A planned task with no trial, a second trial for a task, or a stray trial (a task outside the part's plan, the wrong arm, the wrong model, or a trial directory that can't be attributed) makes R3a incomplete.
3. **An unreachable ledger.** launch.sh reserves each next VM block through the ledger service before the current block runs out. Only the service's HTTP 409 is a refusal, a cap stop. Any other failure, such as the service being unreachable, is retried until the current block runs out, and then stops the batch the same way. Either way the part's run dir holds vm-cap-stop.
4. **The infra bound (Captain ruling A1 on #121).** More than 10% infra trials in a part (10 or more of the screen's 93, or 2 or more of the pilot's 10) makes R3a incomplete. It is checked before admission. #112's 10% infra rule in section 4.6 covers R3b's Opus cells and is unchanged.
5. **Unreadable proxy files (Captain ruling B1 on #121).** An empty or unparseable pulled cap-stop.json, proxy-status-end.json or proxy-sessions.jsonl makes R3a incomplete, and the reason names the file, because a cap stop can't be ruled out. An empty or non-integer `<part>.launch-exit` does the same ("launch exit unreadable").
6. **An oracle failure (GSTA-2's ruling on this post's review).** Section 10 sets ORACLE=1. A part whose oracle gate fails stops before any of its paid trials, launch.sh exits non-zero, and R3a is incomplete. On the screen's VM that spends only VM hours. The pilot's oracle runs on its own VM after the screen's paid trials, so a pilot oracle failure, even on a task that passed on the screen's VM, ends R3a incomplete after the screen's model spend, which stays spent (section 10).

The build also refuses, from 301d8d3 and f8a279b:

- run() refuses a VM rate or block hours that aren't positive numbers, and a block that rounds to $0, is over the $150 cap, or is under 2 seconds, before it binds the item. launch.sh refuses a non-positive rate or hours and a $0 block.
- analyze() removes an earlier analysis's admitted.txt and r3b-tasks.txt before it writes, so a reanalysis that ends incomplete leaves no admission list behind.

So R3a is incomplete when: a cap refusal (a session reserve, the proxy's batch cap or a VM block), one of rules 2 to 6, a launch that exits non-zero or never ran, or a part with no pulled results. screen.ts's exit codes are 0 (admission passed), 4 (incomplete), 5 (saturation) and 6 (pilot FIX-METHOD). Exit 1 or 2 is an error, never an outcome.

## 4. #121's open notes

#121's body leaves these to this amendment. Each is handled here without a change to #121's code.

| Note | How R3 handles it |
|---|---|
| The pilot runs after an incomplete screen (screen.ts:154). run() checks only the launch exit, cap-stop.json and vm-cap-stop between parts, so a screen that analyze() will call incomplete (over 10% infra, an unreadable proxy file) still launches the pilot. GSTA-2 kept it an open note for this amendment | Opus's R3a runs the pinned build as is: the pilot runs whatever the screen shows, its spend settles to r3a-screen inside the $150 cap, and analyze()'s verdict decides. The run thread does not stop the run by hand between parts, and the results post reports the pilot's spend on an incomplete run as spent. Sol's build checks the screen's stop reason before the pilot (section 6.6), since that code is being written anyway |
| The incomplete rules weren't in the public record (screen.ts:13), and the labels A1 and B1 collide with #112's | Sections 2 and 3 state every rule, and the dry run drives each through the build at the pin (section 11). This post calls them the Captain's rulings A1 and B1 on #121; section 9 says what #112's A1 and B1 were |
| A positive VM rate small enough rounds the block to $0 (launch.sh:45) | Fixed in 301d8d3 before the merge: launch.sh refuses a block that rounds to $0, and run() refuses it before it binds. The dry run shows both refusals |
| The VM cap stop rests on one unretried `ssh touch STOP` (launch.sh:76), and the extend call has no timeout | A vm-cap-stop file makes R3a incomplete whatever happens next (section 3), so once it exists no outcome moves, and the risk is VM hours past a reserve. A hung extend call is the exception: it writes no vm-cap-stop, and section 10 says how the run record shows it. The run thread watches each part's run dir: when vm-cap-stop appears, it confirms on the VM that work/run/STOP exists or that Harbor has exited, writes STOP itself through ubi-runner's ssh when neither holds, and records that in the run record. The ledger service runs on the run thread's own machine, which waits on it. The results post reports any VM hours settled past the cap |
| particle-1's price row ($0.25 in, $1 out, $0.03 cache read) is not OpenRouter's, and the row sends no max_price (proxy.json:71) | Ruling C1 keeps the row. Section 5 pins the price with its as_of date and says which cost the results report |
| Fix-check 1: run()'s $0 guard and launch.sh round the block differently at the half-micro boundary (screen.ts:143) | Reachable only at absurd rates. R3a's run settings fix the block at $2.40 ($0.60 an hour for 4 hours), far from the boundary. If launch.sh ever exits 2 after run() bound the item, that is a launch that exited non-zero: R3a is incomplete |
| Fix-check 2: analyze() exiting 1 on a mismatched plan.json, or a failed band read, leaves an earlier admitted.txt and r3b-tasks.txt in place (screen.ts:208) | An exit 1 is an error, never an outcome. R3b reads admitted.txt and r3b-tasks.txt only from an analyze() that exited 0, and the run record keeps that exit code beside the files. After any exit 1 the run thread deletes both files before anything else, and nobody edits plan.json. Sol's build moves the removal ahead of the plan.json read (section 6.6) |
| Test gaps: the ledger CLI reserving an id the item holds, a task.toml with no timeout, and swebv_r3.py | None moves an outcome. launch.sh reserves only fresh ids; a task.toml without timeouts throws in prepare, before any spend; swebv_r3.py's output is pinned by the band's sha256 |

## 5. particle-1's price (Captain ruling C1 on #121)

OpenRouter's endpoints API for particle-ai/particle-1, read 2026-11-02T02:43:08Z (as_of), lists one endpoint, Particle AI (provider particle-ai, particle-ai/particle-1-20261027): $0.05 a million input tokens, $0.50 output and $0.003 cache read, with no cache-write price and implicit caching. The response is attached (openrouter-particle-1.json, its sha256 in the front matter).

The proxy's row stays at $0.25 in, $1 out and $0.03 cache read (C1). So the proxy meters particle-1 at 5 times OpenRouter's input price, 2 times its output price and 10 times its cache-read price, and the ledger settles and the $1 allowance bind on that metered cost, an upper bound on what OpenRouter charges.

The results post reports both. Spend against each cap is the metered cost the ledger settled. particle-1's cost per trial and cost per success are reported at OpenRouter's as_of price, recomputed from the proxy's token counts, in the post's dated price table, beside the metered figures. R3a runs no particle-1 trial, so this first matters in R3b. Because the row sends no max_price, the run thread re-reads the endpoint before each particle-1 batch and stops before launch if any listed price is above the row's.

## 6. GPT-6.1 Sol (R54)

Org R54 puts GPT-6.1 Sol under test beside Opus 5.5, and Lane B can route it. Run D's runner reaches gpt-6.1-sol in claude-code-preset cells through the proxy and OpenRouter's Anthropic-compatible endpoint (#125, sections 4 and 8). #121's build has no Sol route and runs its screen on Opus only (screen.ts:26 and :69), so Sol's cells need a small build PR. The Captain ruled (A1, 2026-11-02) that Sol enters R3 on its own item, frozen here in full.

### 6.1 Cells and item

| Part | Arm | Trials |
|---|---|---|
| Route check | none, then gstack told /investigate (section 6.2) | 2 sessions, one retry each |
| Screen | none | one per band task, 93 |
| Pilot | gstack told /investigate | one on each of the same 10 tasks as Opus's pilot (seed 20261101) |

Everything else is Opus's: the harness and pins of section 1, claude-code-preset, the $4 allowance, 8 trials at a time, standard-16 VMs at $0.60 an hour in $2.40 blocks, and the rules of sections 2 and 3. The route is Run D's: OpenRouter, upstream openai/gpt-6.1-sol, provider openai only with no fallbacks.

Item r3a-sol, $140 including VMs, its own jsonl ledger, one run: the first reserve binds it, and its route check, both parts and their VM hours settle to it. The Captain records the cap in approvals/ when the pin-only amendment merges.

### 6.2 Route check, Sol's first paid step

Two sessions through R3's proxy and r3a-sol's ledger, both on claude-code-preset with the $4 allowance, on the runner's smoke task:

1. **Smoke.** Arm none. It passes when at least one tool call gets its result back (Run D's rule).
2. **Told.** Arm gstack, told /investigate. It passes when the proxy's body-load probe records /investigate's expansion in the first request and a model response reaches the agent. If the command's body never reaches Sol, the told arm measures nothing, so this part checks what Run D's listing check checks for its untold design.

The route check also records each session's cache-read tokens and metered cost. They are report-only, and the pin-only amendment re-projects Sol's cost from them (section 6.7). The cap still stops spend.

A part that fails is retried once. A model that fails twice leaves R3: Sol's screen and pilot don't run, and the results say so with the measured failure (which part failed, the Harbor exit, and the proxy's status and refusals). It is never written as "Sol can't run in Lane B".

### 6.3 Admission and R3b

Sol's admission reads Sol's own screen and pilot, under the rules of #112's section 4.3: a task is admitted when its graded Sol screen trial failed, and Sol's R3b starts only when at least 30 tasks are admitted, told /investigate showed its procedure in at least 7 of the 10 graded Sol pilot trials, and the Captain has recorded r3b-sol's cap under R42 and the projection fits it: n x 3 x (Sol's measured none cost per trial + its measured told cost per trial). Fewer than 30 admitted is a saturation finding for Sol; under 7 of 10 is FIX-METHOD for Sol.

R3b on Sol: n = min(70, Sol's admitted) tasks drawn from Sol's own admitted list with seed 20261102, three replicates of none and told on item r3b-sol. The procedure gate of #112's section 4.5 (90% of graded Sol told trials), the outcome rules of #112's section 4.6 and the power of #112's section 6 apply to Sol as they do to Opus, read on Sol's cells alone. The contamination line of #112's section 4.7 applies to Sol too.

### 6.4 Stop scope

Sol's line and Opus's are independent. Any Sol stop (a route check failed twice, r3a-sol incomplete or at its cap, saturation, pilot FIX-METHOD, or an r3b-sol stop) ends Sol's line only, and Opus's R3a, R3b and verdict stand. An Opus stop doesn't stop Sol: Sol runs its own screen whatever Opus's shows, and its verdict is its own. particle-1 is unchanged and reads Opus's admitted list, as #112 froze it.

### 6.5 Projection

Lane B has never measured Sol, so R3a's projection uses three planning figures per none trial (r3-plan-costs.py prints them from the data #112 used; a told trial costs 1.9 times a none trial):

- **low, $0.41:** Opus's $0.82 at Sol's prices. OpenRouter lists Sol at half of Opus 5.5's proxy price ($2 against $4 input, $10 against $20 output, $0.10 against $0.20 cache read).
- **central, $0.60:** GPT-5.2 high's mini-SWE-agent mean on these 93 tasks ($0.596), from the leaderboard runs #112's band uses.
- **high, $0.85:** Opus's $0.82 times Run D's Sol-to-Opus ratio ($0.150 against $0.145, #125 section 8).

| R3a | low | central | high |
|---|---|---|---|
| Opus (#112): 93 none at $0.82, 10 told at $1.56, VMs up to $30 | $121.84 | $121.84 | $121.84 |
| Sol: route check, 93 none and 10 told, VMs up to $30 | $76.74 | $98.40 | $126.71 |
| Both, with #112's $30 VM allowance per model | $198.58 | $220.24 | $248.55 |
| Both, with VMs near Ubicloud's list price (about $6 per model) | $150.58 | $172.24 | $200.55 |

Every case is past R3a's $150, which is why Sol has its own item. r3a-sol's $140 is the central figure times 1.4 ($137.76), rounded up to the next $10. Section 7 checks it against the rules that can stop a run.

The route check's figure assumes two sessions at a none trial's cost. Sol's OpenRouter price was read with particle-1's, at the same as_of (openrouter-gpt-6.1-sol.json): the openai endpoint lists $2 input, $10 output, $0.10 cache read and $2.50 cache write a million tokens, and $4, $15, $0.20 and $5 for prompts over 272,000 tokens.

### 6.6 What the Sol build does (GEVA-154, GST-913)

The Sol build is one PR to gstack-evals from main. It touches code that spends money and classifies outcomes, so its /ship runs the full panel (R51). If the build and this section disagree, the Captain decides.

1. **Route row.** A gpt-6.1-sol row in config/proxy.json: Run D's row from tag laneb-discovery-3-runner (route openrouter, upstream openai/gpt-6.1-sol, provider only openai, allow_fallbacks false), with the cache-write prices at OpenRouter's $2.50 and a long-prompt row over 272,000 tokens at $4, $15, $0.20 and $5, so metered cost is never below the list.
2. **Cell.** A gpt-6.1-sol entry in config/cells.r3.json: harbor_model anthropic/gpt-6.1-sol, session_cap_usd 4.
3. **Screen per model.** screen.ts takes the model: Opus (the default) on item r3a-screen at $150, or Sol on item r3a-sol at $140. The item's cap is the batch cap run() passes to launch.sh. Coverage counts a trial of the other model as stray, the allowance table holds Sol at $4, and the admission lines, record and projection name the model (r3b-sol for Sol). With Opus, every line and file stays as #121 writes it.
4. **Route check.** A command that runs section 6.2's two sessions on r3a-sol's ledger, writes a verdict file naming the part that failed, the proxy's evidence and each session's cache-read tokens and metered cost, and exits non-zero on a Harbor failure or a failed part. It takes the ledger port from LEDGER_PORT, as launch.sh does, and hard-codes no port.
5. **Two of #121's notes.** run() reads the screen's stop reason (stopReason) before it launches the pilot and skips the pilot when the screen is already incomplete. analyze() removes admitted.txt and r3b-tasks.txt before it reads plan.json.
6. **Keyless tests.** Sol's arms under the real pinned Agent SDK with a stub CLI (the preset, bundled skills off, each arm's exact prompt); Sol's screen on fixture trials (admission, saturation, the pilot stop, an Opus trial in a Sol part counted as stray); r3a-sol bound at $140 and refused at any other cap; the route-check verdict on passing and failing fixtures; the pilot skipped after an incomplete screen; the removal order; #112's r3-dry.ts still printing its 135 lines; and r3a-caps.ts at the Sol build's pin.

### 6.7 Start rule

Sol starts only after the Sol build PR merges and a pin-only amendment binds it. That amendment pins the build's merge commit and the digests of its route row, cell, screen and route-check files, re-reads Sol's OpenRouter price with an as_of date, and reruns this post's dry run at that pin with Sol's rules driven: the route-check verdicts, Sol's screen and admission on fixture trials, and r3a-caps.ts at $140. The Captain records r3a-sol's $140 when it merges. Then the route check runs first, then Sol's screen, then its pilot.

## 7. R3a's caps against its own rules

R2's frozen caps couldn't admit its own session allowance, because review-units starts a round only when spend so far plus every new session's allowance fits, and its dry run used a stub cap. R3a has no round rule. Three rules can refuse a start, and each is checked per session or per block:

- the ledger's reserve per session at its $4 allowance (ledger.ts:76): settled plus open reserves plus the new reserve must fit the item's cap;
- the proxy's batch cap per part (proxy.ts:316): the part's closed sessions' spend plus every open session's full allowance plus the new one must fit the batch cap run() passes, which is the item's cap. The ledger sees every part and the VM blocks too, so whenever the ledger admits a session, the proxy does;
- each VM block, reserved on the same item before the VM starts and before each block runs out (launch.sh).

r3a-caps.ts replays R3a's planned order on the pin's real Ledger at the real caps, $150 and $140, with these three rules: 8 trials at a time, $4 reserved per session, a part's VM blocks reserved when it starts (earlier than launch.sh reserves them, so a pass is conservative), told trials at 1.9 times a none trial. "VM plan" is 12 VM hours per model ($7.20); "VM wide" is 13 blocks ($31.20), at least #112's $30.

| Case | Result |
|---|---|
| Opus at $0.82, VM plan | all 103 trials run; peak commitment $118.58 of $150, at the last pilot trial |
| Opus at $0.82, VM wide | all 103 run; peak $142.58 |
| Opus, highest mean none cost at which all 103 run | $1.145 (VM plan), $0.897 (VM wide) |
| Sol at $0.41, $0.60 and $0.85, VM plan | all 105 run (2 route sessions, 93, 10); peaks $79.71, $98.48 and $123.18 of $140 |
| Sol at $0.41 and $0.60, VM wide | all 105 run; peaks $103.71 and $122.48 |
| Sol at $0.85, VM wide | stops at pilot trial 8 of 10: settled $102.35 + open $37.60 + $4 > $140 |
| Sol, highest mean none cost at which all run | $1.020 (VM plan), $0.777 (VM wide); with the route check retried, $1.000 and $0.762 |
| Every trial at its $4 allowance | Opus stops at screen trial 37 of 93, Sol at screen trial 32 |

So at the planning cost no start, block or round rule stops either screen before every planned trial runs, with every in-flight session reserved at its full allowance and VM hours up to #112's $30. Sol at the high figure completes with VM hours near plan, and stops in its pilot only if its VM hours also reach about $31. No cap of this size can hold every trial at its full allowance: 103 trials at $4 is $412. A run whose trials average more than the break-even ends in a cap stop, which section 3 makes an incomplete run, as #112 intends. The caps are sized to the planning cost, and the break-even says how far above it a run can go.

The replay assumes every settle lands. proxy.ts tries each settle 3 times (proxy.ts:278) and then leaves the session's $4 reserve open until a later close or close-all settles it or launch.sh reconciles the pulled proxy-sessions.jsonl after the pull (launch.sh:195), so each lost settle lowers headroom by up to $4 until then.

## 8. No gstack on every model

Every model in R3 has a no-gstack arm (Garry, 2026-10-31): Opus 5.5 none in R3a's screen and in R3b, Sol none in its screen and its R3b, and particle-1 none in R3b. R3a has no particle-1 cells: #112 first runs particle-1 in R3b, and the Captain confirmed that reading.

The none arm's agent is Claude Code inside the trial's own task container on the part's Ubicloud VM, never on a Capy machine, so it sees no Capy drive and no gstack install: launch.sh copies only runner/ and the run dir to the VM (launch.sh:152-153), laneb_agent.py starts the CLI by `docker exec` into the container with HOME=/root and CLAUDE_CONFIG_DIR=/root/.claude and reads user and project settings there (laneb_agent.py:322-323, :346 and :370), the none tar adds only an empty /root/.claude/skills (arms/manifests/r3/none.json, 0 files), and none of the 93 task repos holds a .claude, .gstack, AGENTS.md or CLAUDE.md path at its SWE-bench base commit (GEVA-161 read each tree, 2026-11-02).

## 9. Attribution

#112 says "Garry's rulings for this post (A1 and B1, through GEVA-2)". That is wrong. A1 (one prereg freezes all three experiments; R1 runs at merge; R2 and R3 each start only after their build PR merges and an amendment pins it) and B1 (the caps) were rulings by GSTA-2, the gstack-evals Captain, under R42 on 2026-11-01. Garry did not rule on them. The record is approvals/2026-11-01-r48-follow-ups-caps.md in the Captain drive, which says so.

R3b's caps are set the same way. #112's "R3b's cap comes from Garry after R3a" and "Garry has recorded r3b-opus's and r3b-particle's caps" mean GSTA-2 under R42, after R3a passes admission (planned $450 to $550 for r3b-opus and r3b-particle together). r3b-sol's cap is set the same way after Sol's R3a passes. screen.ts at the pin still prints "Garry records both caps before R3b starts"; the line is code and stays, and it means the Captain.

The A1, B1 and C1 of sections 3 to 5 are a third set: the Captain's rulings on #121's /ship findings.

## 10. Commands

Opus's R3a, from a checkout of 8ad436d in the run thread's own machine (section 1). `git rev-parse HEAD` must print 8ad436dc3403e3061440711dfe1d78cc59d7a7f9 first, and the run record keeps that line. LEDGER is r3a-screen's jsonl ledger with one approval row at $150 in the words approvals/2026-11-01-r48-follow-ups-caps.md gives. SWEBV is a harbor-datasets checkout at 86723674 (tasks/swebv_r3.py --checkout leaves one), and ARMS holds #109's three tars, rebuilt from handoffs/GSTA-30/arms and checked against SHA256SUMS.txt. API keys come from the environment, never the command line.

    LEDGER=<r3a-screen.jsonl> SWEBV=<harbor-datasets> ARMS=<arm tars> ORACLE=1 CONCURRENT=8 \
      bun quick/laneb/r3/screen.ts prepare <work>
    R=<pinned runner>
    echo "e53f11384dd6faa14bab96aff14ea42577787df285470e8a192ef24de62753a8  $R" | sha256sum -c - && test -x "$R" && \
      LEDGER=<r3a-screen.jsonl> UBI_OWNER=<thread code> UBI_RUNNER="$R" UBI_TTL_HOURS=24 \
      VM_USD_PER_HOUR=0.60 VM_RESERVE_HOURS=4 UBI_SIZE=standard-16 UBI_STORAGE=640 LEDGER_PORT=9911 \
      VM_EXTEND_LEAD_SEC=1800 bash -c 'echo $$ > <pid file>; exec bun quick/laneb/r3/screen.ts run <work> > <run log> 2>&1'
    LEDGER=<r3a-screen.jsonl> bun quick/laneb/r3/screen.ts analyze <work>

<pinned runner> is the Captain drive's handoffs/GEVA-161/pins/ubi-runner.sh, as a path on the run thread's machine. The run command's first step checks it: if its sha256 differs or it is not executable, the command stops before `screen.ts run` starts, so nothing binds r3a-screen. The run record repeats the check after run exits. <pid file> and <run log> sit beside <work>, outside it, under ~/.capy/work.

CONCURRENT, UBI_SIZE, LEDGER_PORT and VM_EXTEND_LEAD_SEC equal the pin's defaults (screen.ts:129, launch.sh:145, :33 and :62), and the commands set them anyway. Three settings replace a default on purpose:

- UBI_STORAGE=640: launch.sh's default of 600 is not a size the runner accepts (it allows 320 or 640, ubi-runner.sh:117 and :930), so launch would exit 1 after run bound the item.
- UBI_TTL_HOURS=24: with the runner's default of 3 hours (:118), any later `up` in the Ubicloud project could reap the VM mid-batch (:955 runs cmd_reap, :762), and that VM holds the only copy of the part's artifacts.
- UBI_RUNNER: launch.sh's default (launch.sh:25) is the user drive's live copy, which can change after this post merges.

So the run rests on no default. analyze exits 0, 4, 5 or 6 (section 3). Sol's commands come with its pin-only amendment.

**The VMs' lifetime.** Each part's VM is named ubirun-<owner>-<epoch>-<suffix>-t24 (ubi-runner.sh:874), so no `up` reaps it until 24 hours and 10 minutes after it was created. The VM plan is 12 VM hours for both parts together (section 7). A part still running past that can be reaped by any `up` in the project, which leaves it with no pulled results, so R3a is incomplete. launch.sh still destroys each VM itself after a confirmed pull (launch.sh:122-123). The run record checks two things (R16):

- each `vm: <name>` line launch.sh prints to the run log ends in -t24;
- after run exits, `UBI_OWNER=<thread code> "$R" list --mine` lists no VM. A VM that a launch exiting 7 kept is pulled, reconciled, settled and destroyed with the commands launch.sh printed, and the list is read again.

**The oracle gate.** With ORACLE=1, prepare-run.ts writes oracle.json beside each part's job (prepare-run.ts:93). vm-run.sh then runs the reference solution on every task of the part, calling no model, before the paid batch, and needs reward 1 on every task; a task with no trial fails too (vm-run.sh:29 to :38). An oracle failure stops the part before any of its paid trials: vm-run.sh exits 6, launch.sh exits with that code, and R3a is incomplete under section 3. On the screen that spends only VM hours; the pilot's oracle runs after the screen's paid trials (rule 6). The run record names the failing tasks from the pulled out/oracle-fails.txt, with Harbor's out/oracle.log beside it. The oracle job's trial directories are pulled into pulled/jobs beside the part's job, but exposure.ts reads only trials whose agent is laneb-claude-code (exposure.ts:48), so they never count as trials, stray trials or infra.

**Keeping the machine awake.** run launches the screen and then the pilot, each on its own VM, and can pass 6 hours. It holds the ledger service, the VM extender and the tunnel, so its machine must stay awake until it exits:

- `screen.ts run` runs detached on the run thread's own machine, through the `bash -c` wrapper in the run command: the wrapper writes its own pid to <pid file> and then execs bun, so the file holds the controller's pid. screen.ts writes no pid file itself.
- The thread keeps that machine awake with a chain of background watcher operations, each under 6 hours, which it waits on. At each wake it starts a new one while the pid in <pid file> lives (`kill -0`).
- It reads the pid from the pid file, never with pgrep.
- The ledger service runs on that same machine.
- One launch runs per machine at a time, because launches share LEDGER_PORT 9911.

One limit stands. The extender's curl (launch.sh:69) has no --max-time. It calls the local ledger service, so a hang is unlikely, but a hung curl fails open: vm_extend then writes neither vm-cap-stop nor STOP, the batch runs on VM hours no block reserves, and analyze sees no stop, so a run that rule 3 would end incomplete can score as complete. So the risk is VM hours, and in that one case an outcome too. The ledger shows it: after teardown, launch.sh settles the VM's hours across its open blocks, and only the last block can settle above its $2.40 (launch.sh:111). With the extender working, only the teardown after the extender stops (launch.sh:191) runs past the last reserve. The run record lists each part's VM settles from record.json and names any last block above $2.40, and a named block goes to the Captain with the record before R3b starts.

## 11. Dry run

dry-run-r3.sh reruns the R3 section of #112's dry-run.sh, keyless, at the build pin instead of tag laneb-stacks-1-runner. It then checks its R3 lines against #112's dry-run.txt, prints the planning figures, replays R3a's caps (section 7), and runs the build's own keyless tests at the pin, which drive every rule of sections 2 and 3 through r3/screen.ts, r3/exposure.ts, launch.sh, vm-run.sh and the real pinned Agent SDK with a stub CLI. No step calls a model or starts a VM, and API keys are unset first. dry-run-r3.txt is its output at 8ad436d.

- **Pins.** The checkout is 8ad436d and clean; #112's r3-band.py, r3-dry.ts and dry-run.txt match their digests; section 1's file digests print.
- **Band.** r3-band.py on the three leaderboard runs at SWE-bench/experiments 40f164d gives 93 of 500 tasks, sha256 5d555f1f..., identical to the pin's tasks/swebv-r3.txt.
- **Byte for byte.** #112's r3-dry.ts, run with the pin's Ledger and analyze() in all ten scenarios, prints 135 R3 lines, and all 135 are identical to #112's dry-run.txt: KEEP, FIX-METHOD, CUT-CANDIDATE, the gate failing, saturation (9 admitted), the pilot stop (4 of 10), an r3a-screen cap stop, an r3b-opus cap stop, an r3b-particle cap stop with the Opus verdict standing, and 13.8% infra in the Opus told cell.
- **Caps.** As section 7.
- **Rules.** 79 tests pass and none fail in r3.test.ts, launch.test.ts and vm-run.test.ts at the pin. Among them: graded needs a reward and a model response; a trial with no result.json is infra; a missing, second, stray, wrong-arm or unattributable trial makes R3a incomplete; 10 of 93 infra screen trials or 2 of 10 pilot trials make it incomplete, and 9 and 1 go on to admission; each unreadable proxy file and each unreadable launch exit makes it incomplete; a reanalysis that ends incomplete leaves no admission list; run binds the item once and refuses bad VM rates and blocks before it binds; a refused VM block, a refused next block and an unreachable ledger each stop the batch; every R3 arm sends CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and the preset through the real pinned SDK.

#112's done line asks for the dry run with "the R3 fixtures replaced by a stub run's real trial records". A Harbor trial needs Docker, a SWE-bench image and Harbor itself, so this dry run doesn't run one. The build's tests feed its own trial reader and screen with Harbor-shaped job directories, and the SDK test runs each arm's real agent options through the pinned SDK. runner/smoke.sh at the pin can't stand in: it runs the runner's own smoke task with a stub /investigate and passes no told_skill or system_prompt, so it can't run an R3 arm without a code change, and this machine has no Harbor. The first real Harbor records are vm-run.sh's oracle gate, which runs because section 10 sets ORACLE=1, needs reward 1 on every task before the paid batch starts and calls no model. Test durations in the output change from run to run.

## 12. Changes from #112

- The R3 build is pinned at 8ad436d, gstack at 61e201ec through #109's tar, and the harness and run settings with it (section 1).
- GSTA-2's three rulings: graded, opened and claude-code-preset (section 2).
- R3a ends incomplete under five more rules and the build's refusals, not only at its cap (section 3).
- #121's open notes are handled (section 4).
- particle-1's price is pinned at its as_of, and the results report metered and list cost (section 5).
- GPT-6.1 Sol joins R3 on its own items, r3a-sol at $140 and r3b-sol later, with a route check first; it starts after its build and a pin-only amendment (section 6).
- R3a's caps are checked against the rules that can stop a run, at the real caps (section 7).
- The attribution of #112's A1 and B1, and of R3b's caps, is corrected (section 9).
- The dry run reruns at the build pin; it uses the build's tests rather than a stub Harbor run (section 11).
- After review, GSTA-2's rulings: section 10 sets ORACLE=1 and every run setting explicitly, keeps the controller's machine awake and runs one launch per machine, and an oracle failure makes R3a incomplete (sections 1, 3 and 10).
- Sol's route check records cache reads and takes LEDGER_PORT, allowance stops print beside every verdict, the verifier limit reads 6000 s, and section 7 notes lost settles (sections 1, 2, 6 and 7).
- Round 3, on GSTA-2's rulings: UBI_STORAGE=640, a pinned ubi-runner.sh checked before run binds the item, and UBI_TTL_HOURS=24 with a name and deletion check in the run record; the pid file comes from a wrapper shown in the run command; a hung extender curl can fail open; rule 6's VM-hours-only holds for the screen, not the pilot; allowance stops are counted from trials.jsonl; and the none arm's agent sees no Capy drive and no gstack install (sections 1, 2, 3, 4, 8 and 10).

## Attachments

- dry-run-r3.sh.txt and dry-run-r3.txt: the dry run and its output at the build pin.
- r3a-caps.ts.txt: R3a's planned order on the real Ledger at the real caps (section 7).
- r3-plan-costs.py.txt: the per-trial planning figures (section 6.5).
- openrouter-particle-1.json and openrouter-gpt-6.1-sol.json: OpenRouter's endpoint listings as read at 2026-11-02T02:43:08Z (sections 5 and 6.5).
