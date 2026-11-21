---
id: 2026-11-21-capy-cso-advisories-deviations
kind: plan
title: "Pre-data deviations to the /cso real-advisory preregistration: containment over each arm's gstack install, a narrower stage 1 release, the judge's output cap, the interim-look bounds and the Sol pilot"
summary: "Six changes, each made before the data it touches: wider containment (two), a narrower stage 1 release, a higher judge output cap, two terms for later stages. Also three stage 0 repairs."
author: capy
model: anthropic/claude-opus-5-5
date: 2026-11-21
status: open
links:
  - 2026-11-19-geva-561-cso-advisories-prereg
  - lanes/outcome-skills/cso/
  - https://github.com/garrytan/gstack/tree/5afef04e31de1cb30c727c7f827bdd729d04713e
  - 2026-11-19-geva-559-ship-panel-judged-sample-prereg
  - https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
  - https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-carbon
---
# Pre-data deviations to the /cso real-advisory preregistration

Dated 2026-11-21. (a), (b), (c), CV5 and CV6 came before any unit build, model session, judge call or label call: nothing had run on any arm, paid or keyless, so no data could shape them. (d) came after stage 0's 10 sessions and their judge calls, and before any stage 1 session. Stage 0 is each counted arm's pilot under R111; its reports join the judge check, and none of its outcomes enters an arm comparison. The preregistration (2026-11-19-geva-561-cso-advisories-prereg) stays as merged; this post sits beside it, and the results post lists every deviation it used.

The eval's owner recorded (a), (b), CV5 and CV6 in the team's approvals record (approvals/2026-11-19-untested-parts-ship-guards-cso.md), using the words quoted below, and decided (c) and (d) on 2026-11-21.

Together, (a) and (c) make this containment claim: no unit in the draw has its GHSA id, a CVE id or its fix-commit prefix anywhere in an arm's installed gstack tree, and no unit's affected package is installed there at or past its fixed version.

## (a) Containment also scans each arm's gstack install

> The containment gate also scans each arm's installed gstack tree; a unit whose GHSA id, CVE id or fix-commit prefix appears there drops from every cell.

**Why.** Section 3's gate 6 reads only the session tree. But the cso and untold arms also see gstack's install, and gstack's tree at the pin names nine candidate advisories by GHSA id. So attack 12's answer (no file names the advisory) was false for those two arms. A unit dropped from every cell keeps the comparison paired.

**What the pinned tree holds.** We scanned gstack's git tree at 5afef04 for every candidate's GHSA id, CVE ids and fix-commit prefix, case-insensitively. Indexes count from 0 in prereg.json's lists.

| Unit | List and index | Where gstack names it |
|---|---|---|
| katex GHSA-238p-pmpm-9mq7 | part 1, 17 | TODOS.md, .osv-scanner.toml |
| @hono/node-server GHSA-rmxm-3fg6-px4f | part 2, 10 | CHANGELOG.md |
| dompurify GHSA-mrv2-3pqr-j5jr | part 2, 36 | CHANGELOG.md |
| ip-address GHSA-rxp7-6hxx-x8q5 | part 2, 66 | CHANGELOG.md, test/deps-smoke.test.ts |
| dompurify GHSA-c6gr-qvv4-5v3f | part 2, 74 | CHANGELOG.md |
| body-parser GHSA-27r3-jxmh-p828 | part 2, 76 | CHANGELOG.md |
| qs GHSA-6pq8-jhm2-2vcw | part 2, 141 | CHANGELOG.md |
| dompurify GHSA-cg2g-xh64-v4q7 | part 2, 154 | CHANGELOG.md |
| @hono/node-server GHSA-frvp-7c67-39w9 | part 2, 368 | docs/designs/fork-port-residual-2026-09/records-other.json |

The id rule catches all nine, katex included, so no candidate needs a drop by name. We also read every line of the pinned tree that names a candidate's package beside a security word. None of those lines describes another candidate's advisory without its id. For example, the basic-ftp pin answers four earlier advisories, and the hono pin answers five other hono advisories that the changelog lists by id.

**How it runs.** The scan reads the tree each arm's recipe actually installed, so it covers node_modules, git objects and archives as well as gstack's own files. It reads every file raw, reads every git object store object by object, and opens archives two levels deep. It records the tree's hash and runs on the dedicated VM before the supply check. A scan that can't finish fails closed (E_CSO_SCAN), and a hit drops the unit with E_CSO_DROP_INSTALL_ID. A CVE id must not run on into another digit, so CVE-2026-1234 never matches CVE-2026-12345.

Code: lanes/outcome-skills/cso/units/install-contain.ts and lanes/outcome-skills/cso/units/ids.ts. Tests: tests/outcome-skills/cso-install-contain.test.ts. They plant an id in a file in a different case, in a git object no checked-out file holds, and in a tarball. They check both directions: those units drop from every cell, and the same units stay under the session-tree rule alone. A unit named nowhere stays, and a CVE id that runs on into another digit doesn't match. We broke the code twice on purpose: once so it ignored install hits, and once so the CVE match had no right edge. The tests failed both times.

## (c) Installed dependencies at or past the fixed version drop too

The owner's decision, 2026-11-21:

> A. Drop the 16 units by name from every cell, before the draw, as a dated deviation. The deviations post lists each one with the lockfile line behind it, and the containment claim says installed dependencies at or past the fixed version were excluded. Also add the lockfile check to the unit gate itself, so the next draw catches this route automatically instead of by a hand list.

**Why.** The same read of the pinned tree found a second route that (a) doesn't cover. gstack's lockfiles hold 24 candidates' packages at or past the fixed version, so the cso and untold installs can carry the fixed code of the library under audit. The none arm can't. The id rule already drops 8 of those 24. The 16 below are the rest. All of them sit at part 2 index 96 or later, so the draw reaches them only if n2 runs near 100.

| Unit | Part 2 index | Line behind it |
|---|---|---|
| hono GHSA-5r4p-p66f-jhc7 | 96 | bun.lock hono@4.13.16, fixed in 4.13.11 |
| proxy-addr GHSA-jqcg-44mw-7w3h | 160 | bun.lock proxy-addr@2.0.8, fixed in 2.0.8 |
| qs GHSA-4mjr-xmp4-gh2g | 169 | bun.lock qs@6.16.2, fixed in 6.16.0 |
| ip-address GHSA-j6r3-76f7-8jcv | 190 | bun.lock ip-address@10.7.4, fixed in 10.7.1 |
| hono GHSA-hxh3-vqpv-xpqv | 192 | bun.lock hono@4.13.16, fixed in 4.13.7 |
| hono GHSA-g6gw-c38x-mqfc | 193 | bun.lock hono@4.13.16, fixed in 4.13.5 |
| ip-address GHSA-2vr4-cq9g-pvrc | 196 | bun.lock ip-address@10.7.4, fixed in 10.5.1 |
| nanoid GHSA-xwg4-73v4-xw9w | 216 | bun.lock nanoid@3.3.18 and lib/diagram-render/bun.lock nanoid@5.1.16, fixed in 3.3.12 and 5.1.11 |
| source-map-js GHSA-68fv-2mgg-jv7q | 271 | lib/diagram-render/bun.lock source-map-js@1.2.2, fixed in 1.2.2 |
| qs GHSA-x5fp-wj9c-mxmx | 273 | bun.lock qs@6.16.2, fixed in 6.16.0 |
| adm-zip GHSA-xcpc-8h2w-3j85 | 358 | bun.lock adm-zip@0.6.1, fixed in 0.6.0 |
| immutable GHSA-v56q-mh7h-f735 | 376 | lib/diagram-render/bun.lock immutable@4.3.9, fixed in 4.3.9 |
| immutable GHSA-xvcm-6775-5m9r | 388 | lib/diagram-render/bun.lock immutable@4.3.9, fixed in 4.3.9 |
| @hono/node-server GHSA-9mqv-5hh9-4cgg | 426 | bun.lock @hono/node-server@2.1.6, fixed in 2.0.10 |
| body-parser GHSA-v422-hmwv-36x6 | 433 | bun.lock body-parser@2.4.0, fixed in 2.3.0 |
| nanoid GHSA-28wg-ghj8-5hjv | 446 | bun.lock nanoid@3.3.18 and lib/diagram-render/bun.lock nanoid@5.1.16, fixed in 3.3.16 and 5.1.16 |

katex is not on this list. gstack holds katex 0.16.47, which is still vulnerable (the fix is 0.18.2), so the install carries no fixed code for it. The id rule drops it anyway.

**How it runs.** These 16 drop by name from every cell before the draw. The unit gate also checks every arm's installed tree for this route, so a later draw doesn't need a hand list. It reads every lockfile and installed package manifest it knows: bun.lock, package-lock.json, yarn.lock, pnpm-lock.yaml and node_modules package.json files for npm, Cargo.lock for crates.io, and go.sum for Go. Then it evaluates the advisory's ranges at each held version. A version carries the fix when no range affects it and some fixed version sits at or below it. So a vulnerable version stays, a version below the first affected one stays, and a vulnerable release on a second line stays. A Maven or NuGet file the gate can't read fails closed when a unit of that ecosystem is asked about. A drop records E_CSO_DROP_INSTALL_DEP with the file and version behind it. Run on gstack's pinned tree, the gate drops exactly 24 units: the 16 above and the 8 the id rule drops.

Code: lanes/outcome-skills/cso/units/deps.ts. Tests: tests/outcome-skills/cso-deps.test.ts. They check both directions: a package held past the fix drops, in a lockfile, an installed manifest, Cargo.lock or go.sum. A vulnerable version, a version below the first affected one, a vulnerable backport line and a package that isn't held all stay. The id rule alone keeps every unit this gate drops. We broke the code twice on purpose: once so it ignored the affected check, and once so it dropped nothing. The tests failed both times.

## (b) Stage 1 releases only pass or fail from the judge check

> Stage 1's judge-check release reports only whether each gold minimum was met and the pass or fail of each gate, not gold counts by class.

**Why.** Item 6 of section 12's release list says "judge check results (kappa per label, per-arm gate, format variants, refusals, gold counts)". Gold counts by class on the stage 0 and stage 1 reports, read beside the released no-gstack named count, would show how many cso reports were named. Section 12 keeps that arm rate sealed.

**What the release holds.** For each judge route, it holds met or not met for each gold minimum: gold reports, the named class minimum, gold findings, the validity class minimum and the anchor share. It holds pass or fail for each gate: named kappa on all gold, named kappa on non-anchor gold, the per-arm gate, both format-variant thresholds, the refusal limit, the over-cap gold-drop limit and validity kappa. It also holds whether the route may score named outcomes and whether validity is validated, both derived from those booleans. Counts, kappa values and rates go into the sealed stage 1 file with the arm outcomes. A check that lacks a minimum or gate, carries a number where a boolean goes, or adds a field is refused (E_CSO_RELEASE).

Code: lanes/outcome-skills/cso/analysis/release.ts. Tests: tests/outcome-skills/cso-release.test.ts. A passing route and a failing route each read correctly. A failed validity kappa closes only validity. No digit and no detail key leaves the release, and only item 6 of the frozen list changes. We broke the code on purpose so it passed the raw check through, and three tests failed.

## (d) The judge runs at medium effort with a 65,536-token cap

The owner decided this in three steps on 2026-11-21, each after a stage 0 re-judge showed the step before it wasn't enough. First, after stage 0:

> Raise Carbon's output cap to 48,000 and keep high effort, as dated deviation (d), entered before any stage 1 data. [...] Label a reply cut off at the cap as truncated, not malformed. Re-judge stage 0's 10 sessions on cso-judge, with no new sessions.

Then, after the 48,000 re-judge:

> Raise Carbon to 128,000 at high effort as a dated (d) amendment, test-first and before any stage 1 data, then re-judge all 10 stage 0 sessions at 128,000 in a fresh out dir. Keep the stage 1 judging inside cso-judge's $174 cap; a projection past it comes back to me.

Then, after the 128,000 re-judge's first calls:

> Judge every Carbon call at medium effort with a cap of 65,536, as a dated amendment to (d) made before any stage 1 judge call. Land it test-first and re-judge all of stage 0 at medium in a fresh out dir. [...] If a packet still overflows at medium, it's a judge gap and comes to me with the count, not as a retry at another setting.

**Why.** Section 7 froze Gemini 4 Carbon as the judge at high effort with 16,000 output tokens. Reasoning tokens count against the output cap, as OpenRouter's reasoning-token guide says, so a high-effort call can spend the whole cap before it writes an answer.

- **At 16,000.** Stage 0 made 11 judge calls on Carbon. In 9 of them Carbon spent the whole 16,000 on reasoning (15,997 reasoning tokens, finish reason `length`, no text), and a tenth stopped at 15,683. So 9 of stage 0's 10 sessions came back as judge gaps. The ship-panel judged-sample eval (2026-11-19-geva-559-ship-panel-judged-sample-prereg) hit the same failure in its pilot the same day, on Carbon at 16,000.
- **At 48,000.** 8 of 20 Carbon calls were cut off, and 4 of stage 0's 10 sessions were judge gaps. The longest call that finished used 46,965 tokens.
- **At 128,000.** A call can't return more than 65,536 tokens. One packet ran to `length` at exactly 65,536 completion tokens (65,533 of them reasoning), with Google's native finish reason `CONTINUATION`. That packet was also cut off at 16,000 and at 48,000. Google's Vertex guide for Gemini 4 Carbon (https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-carbon) says one API segment produces at most 65,536 output tokens when streaming, or 32,768 when not. Longer output needs Vertex's long-decode `continuation_token` on the v1beta1 API, which OpenRouter's chat route doesn't expose. So no cap above 65,536 helps through OpenRouter.

The same guide lists Carbon's thinking levels as low, medium (Carbon's default) and high. The owner chose medium for every judge call, so every session gets the same judge setting. Raising effort only on the retry after a cut-off was ruled out, because the cut-offs fell on the none and untold arms' long reports: judge effort would then differ by arm on exactly the sessions the eval compares.

**When.** All three steps came after stage 0 and before any stage 1 judge call. The first came before any stage 1 session. The second and third came after stage 1's sessions had started. Those session records are sealed to the readout key as they are written, and nobody has read them, so no stage 1 data shaped any step.

**What changes.** The judge's settings in `judge.production` become medium effort and a 65,536 output cap. Every route's judge reads those settings, so the fallback judges (Astra and Opus) get them too; the gold labellers keep high effort and 32,000. A judge gap from a reply that ended at the cap now says "truncated" where it said "malformed". The retry rule doesn't change: one retry at the same setting, then a gap. A packet that still overflows at medium is a judge gap, and its count goes to the owner. A call's worst case is $0.66 of output at Carbon's $10 per million output tokens. The ledger reserves each call's worst case before it sends, inside the cso-judge cap, which doesn't change.

**How it runs.** Stage 0's 10 sessions are judged again on cso-judge at medium in a fresh out dir, with no new sessions. The 16,000, 48,000 and 128,000 replies stay in their own out dirs as the record. The 128,000 re-judge was stopped after its stage 0 calls, and it judged no stage 1 session. One probe call down each judge and labeller route at its setting runs before stage 1's judging, as section 7's probe does.

Code: lanes/outcome-skills/cso/prereg.ts (`judgeMaxOutput` and `judgeEffort`), lanes/outcome-skills/cso/judge/client.ts and lanes/outcome-skills/cso/judge/meter.ts. Tests: tests/outcome-skills/cso-judge.test.ts and tests/outcome-skills/cso-judge-meter.test.ts. The tests check that:

- the judge's request asks for 65,536 at medium effort, and the gold labellers keep high effort;
- a plan copy that froze any effort but high, or any cap but 16,000, refuses (E_CSO_PREREG), so the deviation lands only on the plan it was written against;
- the metering proxy admits the judge's cap (it refused anything past 32,000 before, which the probe test caught);
- two replies cut off at the cap read "gave a truncated reply twice", while a mixed pair names each.

The tests were committed first and failed before the code landed, at each step.

## Harness repairs after stage 0

These change no rule in the plan. Each makes the code do what the plan already says, and each has its own test, committed first.

1. **The exposure detector reads launcher calls made through shell variables.** Section 8's procedure gate needs a start, an inspect or read on that run, and a finish, all through gstack-cso-launcher. Opus on the cso arm bound the launcher and the run id to variables and called through them: `R=<run id>; L=~/.claude/skills/gstack/bin/gstack-cso-launcher; $L inspect $R`. The detector read only the literal launcher path, so it reported that the procedure never ran on either unit when it had. The detector now expands the variables a command assigns, ignores the assignment text itself, and counts every launcher call in a command. A binding ends with its command, because each Bash call starts a fresh shell. When one command prints several helper objects, it reads the last one. Opus also piped `start` through `head -100`, which cut its JSON short, so the detector now takes the run id from the start's `"runId"` line when the JSON doesn't parse; a refusal or a bare id elsewhere in the text still names no run. Helper reads through a variable no longer count as host reads, and they now count as opened files, which the miss anatomy reads. Code: lanes/outcome-skills/cso/exposure.ts and lanes/outcome-skills/cso/sessions.ts. Tests: tests/outcome-skills/cso-exposure.test.ts and tests/outcome-skills/cso-sessions.test.ts, one built from the vm2 session's real command lines, and others showing that a variable bound to another program, a test of the launcher's path, a binding made in an earlier command, a failed start, a refusal or a stray id resolves to no call or no run.
2. **The judge's retry sends a new request.** Section 7 gives a malformed or truncated reply one retry. The judge transport keeps every reply by request digest so a rerun never pays twice, but the retry sent the identical request, so it got the kept reply back and never reached the model. None of stage 0's 9 cut-off calls was retried. A retry's digest now names its attempt, so the retry is a real call and a rerun still reuses both replies. Code: lanes/outcome-skills/cso/judge/client.ts and judge/meter.ts. Tests: tests/outcome-skills/cso-judge-meter.test.ts.
3. **The session driver serves a cso item's arms.** `gstack-evals outcome serve --stage cso-pilot=cso:none,cso:cso,cso:untold` serves the arms on one lease, as a PF stage names its arms; stage 0 used a scratch launcher that made the same driver call. Code: lanes/outcome-skills/cli.ts. Tests: tests/outcome-skills/cli.test.ts.

## CV5: interim-look bounds replace Holm, if stage 2 takes the look

> When stage 2 takes R113's interim look, its O'Brien-Fleming bounds (3.18 and 2.25 at two-sided 0.025, then 2.80 and 1.98 at 0.05 once one contrast is rejected) replace section 10's Holm thresholds at both looks.

This applies only if re-pricing after stage 1, or a raised line, plans stage 2 above $500 paid. Stage 2 is planned under $400. If it is re-priced past $500, the eval's owner decides, and a dated pre-data change writes this deviation into the plan and prereg.json, tested both ways, before any stage 2 session.

## CV6: the Sol stage's pilot is its paid Codex smoke

> The Sol stage's R111 pilot is its paid Codex smoke, sized with its own caps in the Sol proposal; a keyless session start doesn't count, and R78's 40 Sol reports still stand.

This applies only to the conditional Sol stage, which runs on the owner's go with its own caps. The Sol proposal also pins the exact Codex CLI version it was planned and piloted on (never the latest tag) and names the model on every call. Its result rows take the model and the CLI version from each session record. It pins gstack at or after ed4086e, or uses the A2 workaround, and says which.

## What does not change

Arms, models, texts, the candidate lists and their order, seeds, scoring, the judge model, the labellers, the check thresholds, the analysis, the stages, the caps and the money all stay as merged. Only the judge's output cap and effort change, under (d). Run receipts name each deviation by its letter and the commit that landed it.
