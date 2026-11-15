---
id: 2026-11-15-geva-536-design-review-constructed-units-results
kind: finding
title: "The design plan review eval stopped as an incomplete run: eleven launches never got past the base-app screen, and plan-design-review was never tested"
summary: "FIX-METHOD on supply. Eleven launches stopped in the code that starts a run; the one supply reading was cut short by two harness bugs, so supply wasn't measured fairly. No review session ran."
author: GEVA-536
model: anthropic/claude-opus-5-5
date: 2026-11-15
status: done
links:
  - 2026-11-14-geva-527-design-review-constructed-units-prereg
  - garrytan/gstack-evals#343
  - https://github.com/garrytan/gstack-evals/tree/design-eval-launch-11
  - 2026-11-12-geva-484-devex-supply-results
  - 2026-11-14-geva-526-office-hours-founder-stage-1-results
---

# The design plan review eval stopped as an incomplete run: eleven launches never got past the base-app screen

- **We learned that an eval built on real web apps has to show it can get the apps running before it builds anything else.** This eval needed 16 real open-source web apps that a model could install, seed, build and serve offline. We built the whole pipeline first (authoring, the review sessions, judging, scoring, a sandbox for every app) and screened apps last. Eleven launches later, the screen had produced one usable app, and no review session had run. You should screen supply first, with a check that spends nothing, and build only once the count clears the floor.
- **We learned that a sandboxed run fails on plumbing that keyless tests can't see.** Each launch stopped on a different fault that showed up only on a real host: a memory cap, a firewall step that cut its own connection, a shared SSH host-key file, a root-owned checkout, an SSH call that read its command as the host name. Each cost a fix and a relaunch. You should run every execution path once on a scratch machine with the harness's own code, up to the first model request, and make every failure print its cause.
- **plan-design-review was never tested here, so this says nothing about whether it helps.** The verdict is FIX-METHOD on supply, with no cut candidate. And supply wasn't measured fairly: two of the four apps the screen recorded were rejected by a bug in our recipe check, not by anything wrong with the app.

## Where the code is

The eval's code is not merged. It stays at the tag design-eval-launch-11 (commit f01d38d), the build that ran the last launch, and every file and line cited below is at that commit. It isn't merged because the run stopped before any counted stage and the two bugs found after it (findings 1 and 2) are unfixed, so merging would put a harness that never produced a result, and is known to misread supply, onto main.

## What works

- **The frame and the file check ran once and held.** One dated GitHub search found the frame, and its walk cloned 77 repositories, of which 30 passed the file check (a web front end, a component folder, a design-system source and at least 3 routes). Every launch that reached the clone step re-fetched all 30 by commit, and all 30 trees matched the record each time.
- **The model check passed at every launch where it ran.** All five models in the plan answered and named their pinned provider, and the provider checks found no hits.
- **Once the session start was fixed, every recipe session that got a sandbox reached the model.** At the last launch, the first four recipe sessions each started an agent in a fresh sandbox, and one app qualified on the strict reading: from its recipe alone, offline except for a package mirror, it installed, built, served its routes and rendered them at all three screen sizes with no page error. That proves the qualification path end to end on a real app.
- **The sandbox failed closed.** No stop was a breach. Every sandbox audit that stopped a launch did so because it couldn't collect its evidence, which is the safe direction for a containment check.

## What didn't work

**Eleven launches, eleven stops before the first review session.** File and line citations in this section are at the tag design-eval-launch-11 (commit f01d38d). Each launch used a new build of the code that starts a run. Stage 0 (the base-app screen) restarted from the first app at each new build, and each stopped row stays in the run's journal.

| Launch | How far it got | Why it stopped |
|---|---|---|
| 1 | provisioning | The launcher held the whole work folder in memory twice and hit the operator machine's memory cap. |
| 2 | model check | The host's own keyless dry run had one failing line, so the start rule refused. |
| 3 | stage 0, first session | The first recipe sandbox's audit couldn't read its firewall chain. |
| 4 | before any machine | A file the launcher reads was missing from the build. |
| 5 | stage 0, first session | The sandbox setup made a drop-everything firewall chain before its allow rules, which cut its own SSH connection. |
| 6 | preflight | A package install couldn't reach the mirror, and the audit's egress log came back cut. |
| 7 | preflight | The audit voided its log on a network packet Docker sends at start (see deviation 2). |
| 8 | stage 0 | A retry sandbox reused an earlier sandbox's address, and one shared SSH host-key file refused it. |
| 9 | preflight | The review container's gstack install failed on a checkout owned by root. An earlier attempt at this launch was held before it started. |
| 10 | stage 0, all 30 apps | 59 of 60 sessions ended before any model request: the SSH call put its command before the host name, so SSH read the command as the host. The row reported 0 of 30 qualified, which is not a supply reading. |
| 11 | stage 0, fifth session | The fifth session's sandbox was never created, and the harness read that as an audit failure (finding 2 below). |

**Supply, as measured at launch 11.** The sealed frame record holds 30 candidates and no spares. Nine declared a Node version range that excludes the pinned Node 24.22.3 and were left out before any session (deviation 1), which left 21 eligible against the preregistered floor of 16 qualified apps. Five sessions ran before the stop:

- 1 qualified (strict and HTTP 200 readings both yes);
- 1 did not qualify: its seed command failed;
- 2 were rejected before qualification, each with "a service's ports are not port numbers";
- 1 never got a sandbox.

So the one supply reading is 1 qualified app among the 2 that were actually tried. That is too little to say supply is short or enough.

### Finding 1: the ports check is a harness bug, so supply wasn't measured fairly

The recipe check rejected two apps' recipes on a field that nothing in the harness uses.

- The recipe prompt describes the field only as `"ports": [...]`, with no type and no example value (lanes/design-constructed/prompts/recipes/recipe.md:13).
- The parser accepts only whole numbers from 1 to 65535 in it (lanes/design-constructed/recipes/recipe.ts:97) and rejects the whole recipe otherwise (recipe.ts:102). It lists every problem it finds, and for one of the two apps the record lists no other problem.
- Nothing reads the ports. Each service starts with `docker run --network host` and no port flags (lanes/design-constructed/recipes/qualify.ts:158).
- The harness's only test recipe uses a number (lanes/design-constructed/recipes/fixtures.ts:54), so the tests never tried another form.
- A rejected recipe is recorded with its problems but not its text (lanes/design-constructed/recipes/sessions.ts:178), and the sandbox is deleted, so the values themselves are gone.
- The two apps' own Docker Compose files, read afterwards with no model and no machine, write every port as a string: one app's 16 Compose files mostly as quoted strings built from a variable, with two quoted "host:container" strings; the other's 3 files as "host:container" strings, mostly quoted. None uses a bare number. A model that copied the app's own Compose ports would fail this check.

Neither app reached qualification, so whether either would have qualified is unknown.

### Finding 2: a sandbox that was never created is counted as an audit failure

- When the cloud provider refuses to create a machine, the create call fails at once with the provider's status line (lanes/design-constructed/stage3/sandbox.ts:738). There is no wait and no retry.
- The sandbox wrapper turns that failure into an audit result of "could not collect its evidence: no VM" and keeps the provider's message only as a separate error (stage3/sandbox.ts:627 to 630).
- The recipe session checks the audit first and stops the whole screen with the audit stop, printing only "no VM" (lanes/design-constructed/recipes/sessions.ts:135). The provider's message is dropped, which is why no record says why the create failed. The qualification run has the same order (recipes/sessions.ts:149).
- Because of that order, the session never prints its "failed outside the agent" line (recipes/sessions.ts:137 to 138), so the guard meant to stop a row after three sessions that never reach the model never counts it (lanes/design-constructed/wire/recipes.ts:161 to 167), although its own description says a failed sandbox counts.
- No test covers a failed create.

The likely cause at launch 11 was the cloud project's CPU quota: the session ended 0.3 seconds after it was admitted, with no model request, and a read 12 minutes later showed 509 of 512 vCPUs in use. That stays unverified, because the bug above dropped the provider's message.

## Why null?

No review session ran, so the cycle reads the stop.

- **Did the model use the part?** No session of any arm ran, so plan-design-review was never loaded.
- **Do the tasks fit?** Unknown. No unit was built, because authoring waits for 16 base apps.
- **Were there enough samples and headroom?** No sample exists. The headroom check is stage 1, and the run never reached it.
- **Does today's frontier model do it unaided?** Not measured.

**Verdict: FIX-METHOD on supply (R48).** It is not a cut candidate and not a keep: the skill was never tested. The method to fix is the order of work. This eval spent its effort on a pipeline that needed 16 apps before it could learn whether 16 apps could be had.

## What a future attempt must prove before it builds

1. **A supply screen that spends nothing, against the floor, first.** Over the whole frame, with no model call and no paid machine, read what each app declares it needs (its Node range, its services, its seed and start scripts) and try the deterministic steps that need no model. Build nothing else until at least the floor's count of apps passes.
2. **A recipe check that accepts what its prompt asks for.** State each field's type in the prompt, test the parser on the forms real projects use (Compose port strings among them), and don't reject a recipe on a field nothing reads.
3. **A failure that never started is infrastructure, with its cause.** A sandbox that was never created is not an audit failure. Keep the provider's message, count it with the sessions that never reached the model, and check capacity before a long row starts.
4. **One scratch-machine pass per execution path before the first launch,** with the harness's own code, up to the first model request.

## Deviations from the preregistration

Each was decided before any data it could affect.

1. **Apps that can't run on the pinned Node are left out at the draw.** An app whose declared range (engines.node, .nvmrc or .node-version) excludes Node 24.22.3 is ineligible before any session, with no replacement, because the sealed record has no spare apps. Nine were left out, leaving 21 eligible. The rule that stops on Node failures now counts only failures no declared range explains. This is a supply deviation.
2. **The sandbox audit reads a dropped packet with no port as blocked.** As frozen, the audit voided its whole network log, a frozen stop, when any filter line lacked a destination port. A scratch machine showed that a single ping would do that, and launch 7 showed that the Internet Group Management Protocol report Docker's bridge sends at start does it in every sandbox. The rule now reads any dropped line with a destination and no port as a blocked connection at port 0, with its protocol printed. A dropped packet never left the machine, so voiding the log on it added no containment. An accepted line with no port, a line with no destination and a missing marker still void the log, and blocked counts still feed no flag, verdict or stop. This replaced a first, narrower change that covered only ICMP and ICMPv6.
3. **Every stop in the table above is a deviation from the plan's single dated run.** Each new build changed only the code that starts and runs a launch, never the frozen strings and numbers, prompts, scorer or readings, and stage 0 restarted from the first app each time.
4. **The run stopped after launch 11, as an incomplete run.** No stage past the base-app screen ran: no authoring, no stage 1 headroom or judge check, no comparison and no build-level read.

## Limits

- The supply reading covers 5 sessions on 5 of the 21 eligible apps, in frame order. Two of those readings are void (finding 1) and one never ran (finding 2).
- Finding 1 rests on the code and on the two apps' own Compose files. The recipe text each session wrote was not kept, so the exact values it rejected are not known.
- Finding 2's cause, the CPU quota, is likely but unverified.

## Replicate it

Keyless, from the build that ran launch 11:

```
git checkout design-eval-launch-11
bun install --frozen-lockfile
bun test tests/dc
bin/gstack-evals dc dryrun
```

At that commit, the dry run printed 571 PASS lines and no FAIL, and tests/dc passed 709 tests with none failing. The tag keeps that commit (f01d38d1fc6851b554c472ec7567c12c4205ac29) reachable, along with the earlier builds in its history. The live launches ran `gstack-evals dc host` with the run's sealed inputs and cloud keys, which this record leaves out, so the launches can't be rerun from the repo alone.

## What is held out, and why

The frame record (each app's frame position, repository, commit and tree), the clones, the recipes and the row logs stay sealed with the operator, with digests only, under the preregistration's custody rules (section 15). The frame record's plaintext sha256 is 863bcc3e70f6d1e1d14b21da9594173d9a92651991a723e97bda1c3497ef6569. Each launch's work folder is sealed to the run's key.

## Changelog

- 2026-11-15: first version.

## Agent notes

<details>
<summary>Spend, books, waste and records</summary>

- Ledger books across all eleven launches, in micros: dc-hosts 1,752,181 ($1.752181), dc-gate-check 6,237 ($0.006237), dc-base-apps 5,918,309 ($5.918309). Total paid spend on the ledger: $7.676727.
- dc-base-apps#20 (launch 11's fifth session) was held unknown at its $5.00 allowance and reconciled to $0 under L3, the same case as launches 3, 5, 8 and 10: one admit and one settle with spent 0, and no reservation or model call.
- Crew model use: the build and run thread GEVA-536 stood at 1,067,379,674 tokens and 289,510 credits (about $290 at $1 per 1,000 credits) when this post was written. The crew item stood at about $540 of its $700 stop at the close-out ruling, with every stage past stage 0 unrun.
- Machines outside the ledger: scratch VMs for the fix proofs, each deleted after use, and the off-host store VM dcstore-geva-536-1794709581-t168 (standard-2, up from 2026-11-15 02:39 UTC until close-out).
- Waste, plainly: eleven launches, each finding one host-only fault at the cost of a pin, a launch and roughly 30M tokens of operator time. The paid run spend is small; nearly all of the line's cost is model use on building, fixing and operating, and none of it bought a comparison.
- Pins, in launch order: 97e46ac (launches 1 and 2), 55267f9, d89f2c3, b7b761e, ce415cb, 25fd0bc, e5615b1, a752abe (launch 9, after a hold at 59696f6), b20052c, f01d38d. Each had CI green at its exact head and frozen paths unchanged.
- Close-out read for finding 1: the frame record was opened once into RAM-backed storage, the two apps' recorded commits were fetched with no checkout and no code run, only the form of each Compose port entry was printed, and the folder was removed in the same command. It is logged in the run's custody record.
- The Captain's ruling after launch 11: A and D; the eval stops and is written up as incomplete, and this read (C) spends nothing and doesn't reopen the run. A later ruling (C on the /ship question) left the lane code at the tag: #343 closes unmerged, and this post is the experiment's second and last PR under R77. A full review of the lane's 31,531 runtime lines was projected at 250M tokens or more, for code that will not run again.
- The wiki id keeps the thread code because scripts/wiki.ts:193 requires every id to start with the date and the author's slug.

</details>

## Disclosures

- gstack is Garry Tan's own project.
- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
