# Judge brief, review lane

Frozen for stacks round 1. The judge runner (a step 5 build item, section 9 of the post) sends each judge this brief, then the packet's own instructions file and the packet, both written by `noloss judge-packet` at the rig pin. Those files carry the suite's judging rule, the reply format and the reply rules, so this brief adds only the framing and the impact rating.

## Matching packets

You are one of several judges reading anonymous code review output for one pull request. The instructions file that follows gives the known defects of this pull request (blockers) and the rule for matching. The packet lists findings from several reviews under opaque ids, in a shuffled order, with severity words masked. You do not know which review wrote which finding, and you must not guess.

For every blocker, list the ids of the findings that name the same defect under the judging rule: the finding sits on a path the blocker lists and gives the same cause; its line may differ. A finding that names a different defect on the same file does not match. An empty list is a valid answer. Judge the defect only; severity is applied mechanically afterwards.

Then rate the impact of every finding in the packet, matched or not, as blocking or non-blocking. Blocking means that if the pull request merged as it stands, the problem the finding names would fail a test, break behaviour a user or another program relies on, or lose data or secrets. Anything else is non-blocking, including style, naming, docs, missing tests with no wrong behaviour, and claims you judge to be false.

Reply with one JSON object in the reply format the instructions file gives, plus one extra key per packet, `impact`, mapping every finding id in that packet to "blocking" or "non-blocking". Nothing else, no prose.

## Adjudication packets

The instructions file gives the rulings: defect when the finding names a real defect at the pull request's head, not-defect when it does not, known-informational when it raises the unit's known informational case as a blocker. Every finding in these packets was raised as blocking by some review and matches no known blocker. An evidence sheet follows each packet: for every finding id, the evidence its review gave (masked the way the packet is) and the head's code from 30 lines before to 30 lines after the line the finding names. Rule each finding on the code at the head as the sheet shows it, using that evidence. Rule not-defect when the evidence and the code shown do not establish a real defect. Add one extra key per packet, `verifiable`, mapping every finding id to true when the sheet was enough to rule either way and false when it was not. Reply in the instructions file's reply format plus that key, nothing else.

## Fixed settings

- Primary judge anthropic/claude-opus-5-5; second judge openai/gpt-6.1-sol; third read anthropic/claude-opus-5-5 in a fresh session on the same packet. A third read on a reshuffled packet, as the plan wrote, cannot join: judge-join binds every reply to the batch digest, which a reshuffle changes.
- Reasoning effort medium (`JUDGE_REASONING_EFFORT` in src/adapters/judge.ts), at most 16,000 output tokens, no tools.
- Packet seed 20261031 for matching, 20261101 for adjudication.
- A reply that judge-join refuses is asked again once, in a fresh session with the same input. A second refusal leaves that packet's blockers or findings unjudged, recorded with coverage incomplete; the arms involved get no verdict on the comparisons that need them.
- The runner keeps `impact` out of the reply file it hands to judge-join and writes it to impact.tsv (packet, opaque id, judge, impact).
