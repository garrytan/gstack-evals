---
id: 2026-11-05-geva-298-g-registry-turns
kind: plan
title: "G admission harness: real_agent sends the registry's turns t1 to t3 and records phase and parent_tool_use_id"
summary: "real_agent sends each G arm's registry turns and stamps every message record with its turn and parent_tool_use_id for the exposure detectors; the keyless dry run drives the real turns."
author: GEVA-298
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-05
status: open
links:
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-04-geva-286-u4-session-driver
  - garrytan/gstack-evals#215
  - lanes/real-outcome/agent/real_agent.py
  - lanes/outcome-skills/arms/exposure.ts
---

# G admission harness: real_agent sends the registry's turns and records phase and parent_tool_use_id

GEVA-298 for the gstack-evals Captain (GSTA-2). Code PR from main, gate class: the exposure detectors decide admission item 2, so their input is on the scored path. Nothing here spends money.

## ELI5

G's admission check runs about 80 Claude Code sessions in three arms. Each arm sends fixed messages written in the arm registry: the none arm sends one turn, and each told arm sends three (draft a plan, run the skill on it, build it). A detector then reads the told session's second turn to see whether the skill really ran.

Today the session agent, real_agent.py, only knows the real-outcome lane's two turns, build and then ship. Handed G's registry, it fails before it sends anything. It also writes no parent_tool_use_id on its message records, so the detector can't tell the session's own words from a subagent's, and it refuses the transcript.

This change teaches real_agent to send a registry arm's turns, t1 to t3, in order in one conversation, and to stamp every message record with the turn it arrived in and the parent_tool_use_id the SDK gives it. The free dry run, which until now used stand-in arms with G's names, runs the real turns and checks that every message the detectors read carries both fields.

## Before → after

- **Before:** real_agent's phase_texts reads build_suffix and turn2, which G's registry doesn't have, so a G session stops with a KeyError before its sandbox opens. Message records carry the turn name (build or ship) but no parent_tool_use_id, and exposure.ts refuses any transcript without both. The keyless dry run drives the U4 driver with stand-in arms: G's names and limits, the lane's turns.
- **After:** a registry arm sends its turns t1, t2 and so on, each after the previous goes quiet, exactly as registry.ts turnScript writes them. Every record carries its turn as phase, and parent_tool_use_id wherever the SDK's message has one. The dry run runs the registry's turns, and a new check, U8, shows both fields on every message record, a subagent's message under its Agent call, and both detectors reading the transcripts.

## Why it matters

Admission item 2 reads exposure from the told sessions: 7 of 8 sampled trials must show the skill ran. The detectors are frozen and built, but nothing feeds them a transcript they accept. Without this change admission can't read exposure at all, and a subagent's text could be kept apart from the session's own only by guessing.

## What caused this work

The U4 session driver's plan review found that real_agent sends only the lane's build and ship turns, and that nothing records phase and parent_tool_use_id for G's detectors. The driver merged in #215 (f280433) with a dry run on stand-in arms until this lands. It is a named start condition before any paid G stage.

## Big decisions

1. **What phase means.** A message's phase is the registry turn whose opening message real_agent sent last before the message arrived. The persona's replies inside a turn, and anything a background task sends while real_agent waits for quiet, stay in that turn. That is how real_agent already tags the lane's build and ship. What would flip it: nothing in the prereg; the detectors read the turn real_agent sent.
2. **parent_tool_use_id comes only from the SDK.** real_agent copies the field from every message object that has it (AssistantMessage, UserMessage and StreamEvent at the pinned SDK 0.2.174), null included. A message type without the field gets no key, so exposure.ts refuses the transcript instead of counting a subagent's words as the session's. The lane's records get the same key. What would flip it: an SDK that drops the field, which U8 and the SDK pin catch before a paid stage.
3. **The persona is the lane's, unchanged.** The prereg runs every told session under the lane's rec persona. ShipUser holds shipping only in a lane build turn, so in G's turns it picks the option marked recommended, otherwise replies "Go with your recommendation.", and answers a closing prose question at most 3 times a turn. It counts per registry turn. What would flip it: a ruling that G's turns should hold shipping too; G has no ship turn, so a hold would promise a turn that never comes.
4. **The dry run changes only quiet_sec.** It runs the registry's turns and limits with quiet_sec set to 1, as #215's stand-ins did, so three-turn sessions fit the dry run's time limit. U8 checks each session's real-summary.json: its limits differ from the registry's in quiet_sec alone. What would flip it: a request for a run at quiet_sec 30, which adds about 90 seconds per told session.
5. **Registry arms refuse what G never runs.** A K4 task (G has no replay turn) and a statement that is empty after trimming are refused with E_REAL_SANDBOX_SETUP before the sandbox opens or a model is called. Each refusal names its fix.

## Implementation plan

### 1. Scope

In: lanes/real-outcome/agent/real_agent.py and ship_user.py; the outcome-skills dry run (lanes/outcome-skills/driver/dryrun.ts and dryrun_session.py); their tests and the stub Claude Code; E_REAL_SANDBOX_SETUP's meaning and fix in src/errors/codes.ts, and the generated docs/errors.md.

Out: stage.ts, the ledger settle path and the driver README, which a sibling thread changes; the exposure detectors and the registry, which are frozen; the persona file; the told arm's gstack install and the none arm's clean room; anything paid.

The told arm's gstack install and the none arm's clean room are separate start conditions, tracked in the prereg's section 10 (rules 5 and 6). A green U8 shows that real_agent sends the turns and records the fields, not that a paid stage may start.

Two changes reach the lane's own sessions: every lane message record gains parent_tool_use_id, and nothing reads it there yet. A registry arm's real-summary.json keys skill_calls per turn and carries an empty ship_steps, because G has no ship turn.

### 2. real_agent.py

- **phase_texts.** An arms file in the registry's shape (it has families) gives the arm's turns in order as (phase, text). Turn 1's {statement} becomes the task statement with trailing whitespace removed, using JavaScript's whitespace class so the text matches registry.ts turnScript byte for byte. Later turns are sent as written. A K4 task, or a statement that is empty after trimming, is refused with E_REAL_SANDBOX_SETUP, and each message names its fix: run K4 tasks on a lane arm or drop the task from G's task list; check the task's instruction file, which is blank after trimming. src/errors/codes.ts adds both causes to E_REAL_SANDBOX_SETUP's meaning and fix, and bun run errors:doc regenerates docs/errors.md. The lane's build and ship texts are unchanged.
- **Records.** message_record copies parent_tool_use_id from any message that has the attribute, beside the attributes it already copies. A record's phase is already the turn real_agent is driving; for a registry arm that is now t1, t2 or t3.
- **Run and summary.** For a registry arm the persona counts per registry turn, real-summary.json's skill_calls are keyed per turn, and turn1 stays null because there is no build turn. Lane arms keep their build and ship keys. The turns log line already prints each turn's phase and sha256. The module docstring says what a registry arm sends and records.

### 3. ship_user.py

ShipUser.per_turn(phases) replaces the build and ship counts with one count per registry turn, and start accepts those turns. Holding shipping still applies only in a build turn.

### 4. Tests, written first

- unit_test.py (CI, SDK stubbed): the three arms' turn texts; the K4 and empty-statement refusals; parent_tool_use_id kept, null kept, and absent where the class has none; per-turn counts with no hold.
- agent-units.test.ts (CI): phase_texts against turnScript for every registry arm and six statements with ordinary and unusual trailing whitespace.
- agent_test.py on the real pinned SDK and Harbor with the stub Claude Code (agent.test.ts runs it where the SDK is installed): a told arm sends t1 to t3 and every message record carries phase and parent_tool_use_id, a subagent's message under its Agent call's id; a review done inside a subagent is recorded under that id; autoplan's told arm records the replayed review in t2; the none arm sends t1 only. agent.test.ts then reads the kept transcripts: planEngReviewExposure reads the main session's review exposed and the subagent's unexposed, and autoplanExposure reads autoplan's told session exposed.
- The stub Claude Code gets a g_turns scenario: one Agent subagent per turn; in a /plan-eng-review turn the marks that skill's detector reads, from the main session or from inside the subagent; and in an /autoplan turn the main session's t2 messages of the frozen fixture tests/outcome-skills/fixtures/autoplan-exposed.jsonl, replayed as tool calls, results and text.

### 5. The keyless dry run

- The stand-in arms go. Every session runs the registry's turns and limits, with quiet_sec 1.
- U8 runs one g_turns session per arm through its U4 slot, with one metered model call each so L7 still matches every call. It passes when each session's real-summary.json shows the registry's limits apart from quiet_sec 1, and its one metered call was answered 200; the stub received each arm's turns byte for byte as turnScript writes them, and the turns log line names the same phases and sha256s; every AssistantMessage and UserMessage record carries a registry phase and parent_tool_use_id; every turn holds a subagent message under its Agent call's id; and each told skill's detector, plan-eng-review's and autoplan's, reads its told session exposed.
- Two seeds must fail at U8: u8-turns runs U8 on the old stand-in arms, and u8-parent plants a recorder that drops parent_tool_use_id. driver-dryrun.test.ts adds both, and U8 to the no-seed list.

### 6. Verification

The unit and parity tests run in CI. agent.test.ts and the dry run with every seed run keyless on this machine, with the pinned SDK and Docker. Fail-first logs for every new test are kept in the Captain drive under handoffs/GEVA-298/.

### 7. Risks

- An SDK upgrade that renames or drops parent_tool_use_id fails closed at the detector, and U8 and the SDK pin catch it before a paid stage.
- Output from a background task that outlives bg_wait_sec can arrive after the next turn goes out, and is tagged with the new turn. When t2 ends at bg_wait_expired, the session's own late text, whose parent_tool_use_id is null, can also land in t3, and the frozen detector then reads that session unexposed. This is the lane's existing rule and the detectors are frozen, so this change keeps it. The results post reports, per arm, how many told sessions' t2 ended at bg_wait_expired, read from real-summary.json's phases[].end.

### 8. Outside terms

None new: no new dependency, licence or data source. The change reuses the rig's pinned Agent SDK and Harbor.

## Review record

/autoplan --kind feature (R65 lean), run autoplan-20261105104003 on gstack 1.96.0.0: one Opus 5.5 reviewer read this plan and the draft code against main and answered the outside-terms question (none). It raised 9 findings: 2 High, 1 Medium, 4 Low and 2 Informational, and found no path that spends. The gate (gate_rev 1) carried the two Highs, and the owner took both recommendations along with the handling below of the other seven. This revision applies them without re-review, as the lean kind does.

- **High, autoplan's exposed read was never shown.** U8 accepted any autoplan read that did not refuse. The stub's /autoplan turn now replays the frozen exposed fixture's main-session t2 messages, and agent.test.ts and U8 require autoplanExposure to read that session exposed.
- **High, the refusals named no fix.** The K4 and empty-statement refusals now name their fixes, and src/errors/codes.ts adds both causes to E_REAL_SANDBOX_SETUP.
- **Medium, a late reply can cross into t3.** Section 7 now says that when t2 ends at bg_wait_expired, the session's own late text can land in t3 and read unexposed. The detectors are frozen, so there is no code change; the results post reports the per-arm count.
- **Low, U8's arms check was true by construction.** U8 now reads each session's limits from its real-summary.json.
- **Low, U8 did not check its metered call.** U8 now requires the one call answered 200.
- **Low, U1 to U7 told sessions stop after t1.** Not a defect: the stub answers every later turn real_agent sends, so those sessions run the registry's three turns. Marked irrelevant.
- **Low, unlisted behavior changes.** Section 1 now names the two changes that reach the lane's sessions, and the pull request lists them.
- **Informational, a redundant regex.** Dropped from real_agent.py.
- **Informational, other start conditions.** Section 1 now points at the prereg's section 10 for the told arm's gstack install and the none arm's clean room.

## As built

The code follows the plan above, with these changes found while building it and in the /ship review's one fix round.

- **A frame without the key fails closed.** At the pinned SDK 0.2.174, parse_message reads an assistant or user frame that has no parent_tool_use_id key as None, and the detectors would count that as the session's own words. real_agent now wraps parse_message at the SDK's two call sites and leaves the key out of such a frame's record, so exposure.ts refuses the transcript. The pinned Claude Code writes the key on every path the review read, so no reading changes there. With this, big decision 2 and the first risk in section 7 hold at the pin.
- **A registry arm's turns must be t1 to tn.** Any other list, an empty one included, is refused with E_REAL_SANDBOX_SETUP before the sandbox opens, so no registry turn can be named build and turn on the ship hold.
- **The statement trim is linear.** A loop over JavaScript's whitespace replaces the trailing-space regex, which was quadratic on a long whitespace run. Parity with turnScript is unchanged.
- **U8 counts a subagent message under any Agent call in its turn**, because autoplan's replayed t2 holds Agent calls of its own.
- **Open notes.** The lane persona can approve code in t1, because it holds shipping only in a lane build turn. That is a G admission item for the Captain to rule on before any paid G stage. real_agent does not check the arms file against the registry; that check belongs in the stage driver. sdk-messages.jsonl is opened in append mode, which predates this change, so a Harbor retry in the same directory would mix two attempts' records.
