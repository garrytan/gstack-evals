---
id: 2026-11-25-geva-590-review-models-pre-run-change-2
kind: plan
title: "Pre-run change 2 to the review-models eval: repositories keep their own instruction files, the validation batch grows by one unit per arm, and the build's readings are fixed"
summary: "Units keep their own instruction files with executable config stripped; the validation batch grows to reach 100 bug-unit labels; the voice sends no web search; build readings recorded."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: open
links:
  - wiki/plans/2026-11-24-geva-590-review-models-prereg/README.md
  - wiki/plans/2026-11-24-geva-590-review-models-pre-run-change-1/README.md
---

# Pre-run change 2 to the review-models eval

## In short

- Units keep the repository's own CLAUDE.md, AGENTS.md and .claude/. Gate 4 as written refused 81 of 101 P bug units and every decoy for carrying them, which left no decoy and too few units for the floor. Hooks, permissions and other executable settings are stripped, and every needle check still reads these files. With that, a simulated draw fills the counted set: 77 P and 23 B if every B unit passes the visibility read, 78 P and 22 B if 60% do. The counted run has 12 decoys, not 15, because 3 fail gate 1.
- The validation batch grows by one unit per arm, so the judge check reaches 100 bug-unit labels. Change 1 counted 100, but 5 of the pilot's 55 reviews are decoys, which have no bug to rule on. The added cost comes from the retry reserve, and the all-in caps do not change.
- Codex 0.170.0 sends no web_search tool when it runs gstack's voice command, so the proxy's removal will likely count 0. The voice runs without search either way, as section 5 says.

This change governs where it and the preregistration or change 1 differ. It applies before the visibility read and the pilot, so no paid call has run. It changes no scored measure, arm, model or decision-table row.

Ruled by the gstack-evals Captain (GEVA-2), 2026-11-24: "Do it on both, with these conditions. Commit them as dated change 2 before 2026-11-28 06:00Z." The Captain accepted the build's readings in section 4 as written.

## 1. Gate 4: the repository's own instruction files stay

Section 2's gate 4 said the unit tree carries no CLAUDE.md, AGENTS.md or .claude/. The keyless build showed that rule is wrong for this supply (section 12 allows this change). On the real supply it refused 81 of 101 P bug units, all 15 decoys and 8 B units, and in every P case those files were the only reason. The draw then had no decoy for the pilot and could not reach 80.

These files are the repository as its authors shipped it, and every arm sees the same ones. The new rule:

1. Instruction files come from the unit's own pre-fix tree, which is the unit's head. The head is never after the fix, and the build already checks that. One unit, 4gray/iptvnator#1626, changes its CLAUDE.md in its own diff; it keeps the head's version, because that change is part of the code under review. Each unit records which instruction files its own diff changes.
2. Every needle check reads these files' text too: advisory id, CVE ids, the fix commit's first 12 hex characters, and the suite's name and case ids. A unit whose instruction file trips a needle is refused. None did.
3. Executable config is stripped, since it is not text the model reads. Every .mcp.json is removed. Every .claude/settings*.json loses hooks and permissions, and also the other keys that run commands or turn on MCP servers: statusLine, apiKeyHelper, awsAuthRefresh, awsCredentialExport, otelHeadersHelper, mcpServers, enableAllProjectMcpServers and enabledMcpjsonServers. A settings file that is not a JSON object cannot be stripped, and its unit is refused. Each unit records what was stripped (path, the file removed or the keys taken out, and the sha256 before and after) and the sha256 of every instruction file it keeps. If a stripped unit fails its install or test build on the run host, that unit is refused for every arm alike. 24 P units that pass gates 1 and 4 carry stripped config; no B unit does.
4. The results report how many drawn units carry each file type, and print one descriptive split: catches on units with and without a repository CLAUDE.md. It is descriptive only, and not a counted comparison.

**Counts after the change, keyless, 2026-11-25.**

| | Units | Gate 1 | Gate 4 | Both | CLAUDE.md | AGENTS.md | .claude/ | Settings | .mcp.json |
|---|---|---|---|---|---|---|---|---|---|
| P bug units | 101 (1 unreadable) | 97 | 100 | 97 | 70 | 75 | 53 | 19 | 7 |
| P decoys | 15 | 12 | 15 | 12 | 15 | 13 | 10 | 3 | 0 |
| B (gates 1 and 2 first) | 303 repositories (1 gone) | 149 | 81 of 81 | 81 | 6 | 6 | 2 | 0 | 0 |

The file-type columns count units that pass gate 4. All 81 B units now wait on the visibility read.

**Simulated draw.** It runs with the visibility read passing every B unit, then the first 60% in draw order.

| | 100% pass | 60% pass |
|---|---|---|
| Pilot | 5 P (suite ranks 97 to 101, the last 5 never-run units), 5 B, 1 decoy | the same P and decoy, 5 B |
| Validation batch | 9 P and 6 B | |
| Counted bug units | 100: 77 P, 23 B | 100: 78 P, 22 B |
| Passed over by the 3-per-repository cap | 6 | 5 |
| Counted decoys | 12 | 12 |

The floor of 80 holds in both cases.

**The counted run has 12 decoys, not 15.** Section 2 planned P's 15 decoys for the false-alarm secondary. Three of them fail gate 1, so false alarms per decoy rest on 12 PRs, one of which is also the pilot's decoy.

## 2. The validation batch grows by one unit per arm

Change 1's judge check counted the pilot's 55 reviews plus a 45-review batch as 100 labels. Five of the pilot's reviews are decoys, which have no known bug for Carbon to rule on, so the check had 95. The batch grows by one held-back unit per arm:

| Path | Reviews | Central | Cap | Change |
|---|---|---|---|---|
| Full path, 10 per arm | 50 | $506 | $940 | +$51 central, +$94 cap |
| Fable leaves, 17 per surviving arm | 51 | $308 | $527 | +$36 central, +$62 cap |
| Sol-only set (OS, FS, N), 17 per arm | 51 | $359 | $655 | +$42 central, +$77 cap |

Carbon's judge calls on the batch stay at about $4 central and $7 cap. The held-back units grow from 15 to 17, picked in the same seeded order (draw seed 1872089902) before the counted set is drawn.

**The retry reserve after the move.** The added cost comes from the retry reserve, so the all-in caps stay at $14,878 (full path) and $6,298 (Fable leaves).

| Path | Reserve before | Reserve after | Share of counted cap after |
|---|---|---|---|
| Full path | $582 central, $1,081 cap | $531 central, $987 cap | 9.1% |
| Fable leaves | $208 central, $357 cap | $172 central, $295 cap | 8.3% |

Section 11 sized the reserve at 10% of counted spend. Section 8 reruns a review once after a provider or infrastructure error. Read together, that plans for up to 10% of counted reviews being rerun: about 58 of the full path's 575 counted reviews, or 35 of the Fable-leaves path's 345. At each path's mean per-review cap ($18.80 and $10.33), the reserve now covers about 52 and 29 reruns. Pilot reruns also draw on it.

The Captain kept the caps and the smaller reserve (2026-11-25). The pilot measures the real rerun rate before any counted unit, and the pilot readout states the reserve against that rate; if the rate projects past the reserve, a cap ask goes to the Captain before the counted run. If the reserve runs out during the counted run, reruns stop there and go to the Captain. They never draw on an arm's counted budget, and a unit left without its rerun is reported as an infrastructure miss for every arm it hit.

## 3. The voice sends no web search

Section 3 says gstack's voice command asks for web_search "cached" and that the proxy removes that tool. In a recorded run of Codex 0.170.0 with gstack's exact flags at the pin, the voice's requests carried no web_search tool in any of nine setups, even though Codex's bundled catalog lists search support for gpt-6.2-sol. The removal is built and tested on planted requests, so it still works if a run does send the tool. The removed-tool count will most likely print 0. The voice runs without search in every cell, as section 5 already says.

## 4. Readings the harness build fixed where the plan was silent

- **The cost gap's lower bound (section 7)** is the mean minus 1.96 clustered bootstrap standard errors, the lower end of change 1's printed interval. It can only keep Fable in.
- **Gap readings (section 8):** a verdict holds only when the dropped and as-miss readings agree, and the look closes a contrast only when both cross.
- **Unsettled labels:** a labeller disagreement that adjudication does not settle stays in the judge check, read both ways, and the lower kappa stands. In the pilot's per-arm judge column it counts as an error.
- **Contrasts at the look:** OS and N never stop at the look. The other cells stop only when no open contrast needs them.
- **Judge route:** OpenRouter has no batch path for Carbon, so every review gets a single request. Refused and unreadable replies get the same single retry as empty ones. A non-200 reply stops with E_RM_JUDGE rather than becoming a ruling.
- **Proceed sets:** FA is both a Fable cell and an Astra cell. If FA fails its pilot and OA passed, the set is OS, OA and N. If OA also fails, the run stops.
- **Cost rows:** dollars and wall time per review come from the proxy-metered cost.tsv rows, because the ledger holds spend per lease, not per review.
- **Location hit:** line numbers are pre-fix. On B units the caller carries the hunks to the unit's head first.
- **Exposure (section 6):** specialists are read from gstack's printed dispatch line, so a session on a diff of 50 lines or more that skips that line counts as not exposed. The red team is required on diffs over 200 lines; its CRITICAL-finding trigger is not read. Effort is recorded per turn but does not gate exposure. A provider safety stop counts as a miss in both readings and is counted on its own (R95).
- **Supply:** "no .git history past the base" means nothing after the unit's head, so pre-base ancestry stays as unit.ts keeps it. The disclosure check reads the review comment or PR opening, the fix PR's opening and the advisory's publication date; an earlier issue naming the bug is not searched. An S3 unit's fix is the first commit in the fix PR that touches a blocker path. A decoy's gate 1 reads its head commit's dates. The visibility read sees both diffs cut to source files, with built and minified files removed. Gate 5 counts within the counted set only. The pilot decoy is the first in seeded order and is also one of the counted decoys.
- **SZZ ties:** a tie between equally blamed commits breaks to the first blamed line in patch order. On the design stage's 80 repositories this gives 35 and 16 at the last two steps, where the prototype's arbitrary tie order gave 37 and 17.
- **Codex:** the trial image's PATH holds Codex 0.166.0, so the run passes --voice-cli /opt/codex-0.170.0/bin.
