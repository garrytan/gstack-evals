INPUT: design 42e28cee6c4f4bd89595766e39d43fcb547548ab81f48bf191bdf1c0c7b07b0b

# Design review, native voice (attempt autoplan-20261103023817-a2)

Verdict: the plan picks the right kind of outcome for design (can a user get the job done in what was built), but the instrument as specified cannot show the design claim true or false. The agent user acts through the accessibility tree at one desktop viewport, so most of what plan-design-review and design-review claim to change is invisible to it, and its completion score is confounded with plain functional correctness. Both are fixable inside the plan's own direction before code. This review does not repeat the CEO phase's findings; where it touches one (CEO-1, CEO-8, CEO-11) it adds only the new part.

I read the whole plan, checked the browser probe's driver and RESULT.md under probes-in/browser, and read gstack 1.93.34.0's design-review and plan-design-review SKILL.md files and the designer source.

## 1. What the agent user can see (information hierarchy of the instrument)

The probe's driver (probes-in/browser/driver.ts, RESULT.md line 22) targets every action by "role plus accessible name" from `locator('body').ariaSnapshot()`, at a fixed 1280x720 viewport, and the plan's scoring rule gives the agent user "a screenshot and the accessibility snapshot per step". An agent that reads a flat list of every labelled control is doing the opposite of Krug's scanning user: it reads everything, and it can click a button by name no matter how small, low-contrast, buried below the fold or visually misranked it is.

design-review's own description is "finds visual inconsistency, spacing issues, hierarchy problems, AI slop patterns, and slow interactions". Its Krug block (SKILL.md line 427) is about billboards, one obvious next step, clickable things looking clickable, and mobile (44px targets, no hover); it captures 375, 768 and 1440 widths (line 536). plan-design-review's passes include responsive and accessibility (lines 246-247). Almost none of that changes the accessibility tree at 1280 wide. So the primary is blind to the main effect the skills claim, and the admission check does not catch it: its degraded fixture (input label removed, one button hidden) is an accessibility and function defect, exactly the kind the a11y-driven agent can see. A gold-versus-degraded pass then proves sensitivity to the wrong defect class. A null from this instrument would be uninterpretable, and the R61 raise (screenshot only, 15 steps) arrives only after a saturation null, one attempt too late.

Fix: make the primary agent user vision-first (screenshot plus coordinate actions, no accessibility text), keep the a11y mode as a sensitivity reading, run one scenario per task at 375 wide, and add visual degraded fixtures to admission that keep the accessibility tree byte-identical (primary action demoted to a low-contrast text link, two competing primary buttons, the key control pushed below the fold, a mobile overflow). Admission should require the instrument to separate gold from both the functional and the visual fixtures.

## 2. Completion is mostly correctness (can the claim come out true or false?)

A scenario fails when its checker does not pass. On an arm's tree that happens for two very different reasons: the feature does not work (a correctness failure the hidden tests already measure), or it works and the user cannot find or operate it (the usability failure the design claim is about). The plan scores both as the same zero. On real web apps the first reason will dominate, so a design skill could "win" family U purely by producing more working code, and the Krug claim would ride on a correctness effect. The plan guards only the other direction (a primary win with a hidden-test loss is a tradeoff).

The same confound reaches screening: band screening plain Opus into 20 to 80% completion will mostly pick tasks that are functionally hard, not tasks where usability has room.

Fix: per scenario, run a privileged reachability probe (a fixed agent with DOM and source access, no step pressure, or a scripted path adapted by the author) on every tree. A scenario it cannot complete is a functional failure. The design reading is completion on functionally reachable scenarios; the unconditional completion is the sensitivity. Screen and admit on the conditioned reading. Then the design claim can come out true (told beats none on reachable scenarios), false (no difference at stated power on reachable scenarios), or "the skill helps by making the feature work", which is reported under its own name.

## 3. Completion within 25 steps saturates; Krug claims effort

"Don't make me think" is a claim about effort and errors, not about whether a persistent agent eventually gets there. A frontier agent with 25 steps and full text of the page will finish most scenarios on any working UI, so completion over 3 scenarios is a 0/1/2/3 score that sits at 3 for most functional trees. Steps, failed actions and dead ends are already logged but demoted to secondaries.

Fix: freeze a per-scenario step budget from gold's pilot median (for example 1.5 times it, never more than 25) and make the primary "completed within budget", with raw completion a secondary. Admission row 4 should then read gold versus degraded on that measure. This also makes the plan's claim that U's primary is finer than one binary true in practice.

## 4. Missing states in the scenarios

plan-design-review's stand-in (and the skill) puts empty, loading, error and edge states at the centre. The plan says each task has 3 frozen scenarios, a goal plus a state checker, but says nothing about which states they start from. If authors write three happy paths from a seeded app, the skill's main lever is unmeasured.

Fix: freeze a scenario mix at authoring. Where the feature has them, at least one scenario starts from the empty state and one requires recovery from an error (invalid input, failed save, offline server response stubbed by the rig). Tag scenarios by kind and print per-kind completion.

## 5. The hidden-test guard punishes redesign

U's guard includes "the PR's e2e tests where present". Browser e2e tests are bound to gold's selectors, labels and page flow. An arm that redesigns the screen, which is what design skills are supposed to do, fails them more often. Under the 10-point tradeoff rule, design skills would be marked "tradeoff, not a win" for doing their job. This is separate from CEO-8, which is about the scenario checkers.

Fix: the U guard uses unit and integration tests only; the PR's e2e pass rate prints as a descriptive line, never in the guard.

## 6. App boot and seed state are unspecified

The probe drove TodoMVC, a static app. Real web apps need a database, migrations, seed data, a logged-in user and stubs for outside services, offline. The plan says "an app that does not start scores 0" but never says who defines how a tree starts. A frozen recipe from gold fails arms that add a migration or an env var differently; running arm-supplied scripts lets an arm change the rig. Either way the zero is partly a rig artifact. Boot feasibility will also cut U's yield well below the 230 UI-tagged changes, on top of the 4-of-16 concentration and the permissive filter (CEO-11).

Fix: a per-task boot contract frozen at authoring (container, the repository's own migrate and seed commands, a seed fixture, an auth bypass user, outside services stubbed), stated to every arm in the task statement. A boot failure is classified: the arm's tree fails the contract's commands (unsolved, also visible in hidden tests) or the rig fails (a gap). Add an admission row: gold and base trees boot under the contract in at least 90% of runs, and report boot yield per mined repository in the thin slice.

## 7. Statement and scenario wording

CEO-1 covered the G statements. For U the risk is sharper: if the statement is written from the PR and names the gold UI (labels, placement, which page), design skills have nothing left to decide. And if scenario goals quote gold's labels ("click Archive"), the agent user is handed the vocabulary and a design with different words loses for no usability reason.

Fix: U statements state the user's goal, data and constraints, never layout or labels; scenario goals are written in user language with no control names; the auditor checks both.

## 8. Choosing the agent user and judges

The agent user is chosen in the pilot as the one of Opus 5.5 and particle-1 whose completion best separates gold from degraded, on the same thin-slice fixtures the admission instrument row then reads. That is selection on the admission data, so admission will look better than the instrument is. Both candidates are also models under test.

Fix: choose on half of the thin-slice fixtures and admit on the other half, and add one cross-family candidate that is not a model under test.

The judges compare "screenshots of the same scenarios". If the screenshots come from the agent user's own runs, an arm whose run got stuck shows different states from one that finished, and the judge grades the run, not the UI. Fix: a scripted capture of defined states (entry screen, empty state, error state, the checker-passing state reached by the reachability probe) at 375 and 1280 wide, both presentation orders, agreement between the two judges printed, rubric pinned by sha256.

## 9. Stand-in lines and exposure for the two design skills

The stand-ins are fair drafts. Two gaps. First, both design skills generate mockups with the gstack designer (plan-design-review Step 0.5 at line 236; design-review's `$D generate` at line 1061), and the designer calls OpenAI's Responses API with an image model and needs OPENAI_API_KEY (design/src/auth.ts, models.ts). The plan pins every told cell to its own model with "no other key", so these steps fail with DESIGN_NOT_AVAILABLE by construction. That is a reasonable choice, but the plan must say it, the claim must read "without generated mockups", and the exposure detector must record the fallback instead of silently passing "7 passes in order". Supplying a key instead would add a second model family to a gstack arm and needs its own route, price and terms check. Second, design-review's exposure check names the Trunk Test per page, which exists in 1.93.34.0 (line 596); freeze the detector from the confirmatory pin, since the after pin may rename it.

## 10. R65: outside terms, licences and rights

Yes, terms are involved, and section 11 handles the main ones. CEO-11 and CEO-12 already cover the root-LICENSE-only check, GitHub user content, the Claude Code gateway clause, comparative-publication terms and particle-1's licence. What the design lens adds:

- UI assets carry their own licences. A web app under MIT often ships fonts (OFL or commercial), icon sets, illustrations and logos under other terms and trademarks. Screenshots of task apps go to two judge providers and could end up in a results post. The plan should add an asset check to V8 (font and icon packages, files under public/ or assets/) and a rule that no screenshot of a task app is published.
- The designer's OpenAI image calls (section 9 above) would bring OpenAI's image terms into gstack arms if a key is ever supplied.
- Custody gap: section 12's sealed list names scenario checkers and degraded fixtures but not agent-user step logs, aria snapshots, screenshots or judge inputs. Each reveals the repository and the gold UI. They should be sealed panel material, and judge calls should carry the same data-collection deny the rig sets for OpenRouter.
- Playwright and Chrome Headless Shell are recorded correctly; nothing to add.

## Can the plan show the design claim true or false?

Not as written. The primary cannot see visual hierarchy or responsive design, it counts broken features as usability failures, and it saturates on effort. With findings 1, 2 and 3 fixed, yes: a told-minus-none difference on functionally reachable scenarios within a gold-anchored step budget, by a vision-first agent user that separates gold from visual and functional degraded fixtures on held-out fixtures, is a Krug outcome that can come out either way, and a null then means something.

```gstack-findings
{"id":"F1","severity":"Critical","title":"Agent user acts by role and accessible name at one 1280x720 viewport, so design-review's hierarchy, spacing, slop and mobile fixes and plan-design-review's responsive pass are invisible; the degraded fixture only tests a11y and function defects","file":"probes-in/browser/driver.ts","line":54,"fix":"Make the primary agent user vision-first (screenshot plus coordinate actions, no a11y text), keep a11y mode as a sensitivity, run one scenario per task at 375 wide, and add visual degraded fixtures with an identical a11y tree (demoted primary action, competing primaries, key control below the fold, mobile overflow) to admission row 4"}
{"id":"F2","severity":"High","title":"Scenario completion is confounded with functional correctness; a design skill can win family U by making the feature work, and band screening on completion selects functionally hard tasks","fix":"Run a privileged reachability probe per scenario per tree; the design reading is completion on reachable scenarios, unconditional completion is a sensitivity; screen and admit on the conditioned reading and report 'helps by making it work' under its own name"}
{"id":"F3","severity":"High","title":"Completion within a 25-step cap saturates for a frontier agent on any working UI; Krug claims effort and errors, which are only secondaries","fix":"Freeze a per-scenario step budget from gold's pilot median (about 1.5 times, at most 25); primary is completed within budget, raw completion secondary; admission reads gold versus degraded on that measure"}
{"id":"F4","severity":"High","title":"U's hidden-test guard includes the PR's selector-bound e2e tests, so arms that redesign the screen fail them and design skills get marked as tradeoffs for doing their job","fix":"Guard on unit and integration tests only; print the PR e2e pass rate as a descriptive line outside the guard"}
{"id":"F5","severity":"High","title":"No boot and seed contract for real web apps (database, migrations, seed, auth, stubbed services, offline); 'app does not start scores 0' mixes arm failures with rig failures and boot feasibility will cut U's yield","fix":"Freeze a per-task boot contract at authoring and state it to every arm; classify boot failures as arm (unsolved) or rig (gap); add an admission row that gold and base boot in at least 90% of runs and report boot yield per mined repo in the thin slice"}
{"id":"F6","severity":"Medium","title":"Scenarios are unspecified as to state, so three happy paths would leave plan-design-review's empty, loading, error and edge states unmeasured","fix":"Freeze a scenario mix: where the feature has them, one scenario from the empty state and one requiring error recovery; tag scenarios by kind and print per-kind completion"}
{"id":"F7","severity":"Medium","title":"U statements written from the PR and scenario goals that quote gold's labels leave design skills nothing to decide and hand the agent user gold's vocabulary","fix":"U statements give goal, data and constraints, never layout or labels; scenario goals use user language with no control names; the auditor checks both"}
{"id":"F8","severity":"Medium","title":"The agent user is selected on the same thin-slice fixtures the admission instrument row reads, and both candidates are models under test","fix":"Select on half the fixtures and admit on the other half; add one cross-family candidate that is not a model under test"}
{"id":"F9","severity":"Medium","title":"Judges compare screenshots whose states depend on each arm's agent-user path, with no order control or agreement statistic","fix":"Scripted capture of defined states (entry, empty, error, checker state via the reachability probe) at 375 and 1280 wide; both orders; print judge agreement; pin the rubric by sha256"}
{"id":"F10","severity":"Medium","title":"Both design skills' mockup steps need the gstack designer, which calls OpenAI's image API with OPENAI_API_KEY; the no-other-key pin disables them silently and the '7 passes in order' detector does not record it","fix":"State that the designer is unavailable by construction in every U told cell, scope the claim to 'without generated mockups', and have the exposure detector record DESIGN_NOT_AVAILABLE; supplying a key needs its own route, price and OpenAI image terms check"}
{"id":"F11","severity":"Medium","title":"R65 and custody: UI assets (fonts, icons, logos) carry licences and trademarks apart from the repo licence, and agent-user screenshots, aria snapshots, step logs and judge inputs reveal the repo and gold UI but are not in section 12's sealed list","fix":"Add an asset-licence check to V8, publish no task-app screenshot, seal agent-user and judge artifacts as panel material, and send judge calls with a data-collection deny"}
{"id":"F12","severity":"Low","title":"design-review's exposure detector names the Trunk Test from 1.93.34.0; the after pin may rename or restructure it","fix":"Freeze each design skill's exposure detector from the confirmatory pin's files, with keyless fixtures from that pin"}
```
