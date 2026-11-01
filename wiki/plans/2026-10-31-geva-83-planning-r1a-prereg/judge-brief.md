# Judge brief, planning lane R1a

Frozen for planning R1a. The judge runner (`noloss judge-run`) sends each judge this brief, then the batch's batch.json and one packet, both written by `noloss judge-packet` at the pin. Those files carry the suite's judging rule, the reply format and the reply rules, so this brief adds only the framing.

## Matching packets

You are one of several judges reading anonymous reviews of one product plan. The packet holds the plan and its context as they were before any review, the plan's known flaws (blockers) with each one's section and cause, and findings from several reviews under opaque ids, in a shuffled order. Severity words and some review-template heading words are removed from the findings. You do not know which review wrote which finding, and you must not guess.

For every blocker, list the ids of the findings that name the same defect under the judging rule: the same cause in the same plan section, with the section as evidence. The line may differ. A finding that names a different problem in the same section does not match. A finding that gives the same cause under another heading matches only when its evidence points at the same part of the plan. An empty list is a valid answer. Judge the defect only; severity is applied mechanically afterwards.

Some blockers are deliberate choices that the plan's context justifies. For those, list the findings that flag that choice as a problem, whatever reason they give.

Reply with one JSON object in the reply format the instructions give, and nothing else.

## Adjudication packets

Every finding in these packets was rated must-fix by some review and matches no known flaw. Rule each one: defect when it names a real problem that would change what gets built, or how well, as the plan and its context show; not-defect when it does not, including restatements of the plan, matters of taste and claims the context contradicts; known-informational when it flags the plan's justified choice. An evidence sheet follows each packet with the evidence each finding gave and the plan lines around the line it names. Add one extra key per packet, `verifiable`, mapping every finding id to true when the packet and the sheet were enough to rule either way and false when they were not. Reply in the instructions' reply format plus that key, and nothing else.

## Fixed settings

- Primary judge openai/gpt-6.1-sol (cross-family to Opus 5.5 and to particle-1's DeepSeek base); second judge anthropic/claude-opus-5-5 on every blocker where the arms differ plus a seeded 20% sample, as judge-join names them; third judge anthropic/claude-sonnet-5-5 on the same packet, only where the first two differ. judge-run refuses a third model equal to the first or second.
- Reasoning effort medium (JUDGE_REASONING_EFFORT), at most 16,000 output tokens, no tools.
- Packet seed 20261031 for matching and 20261101 for adjudication.
- A reply judge-join refuses is asked again once with the same input. A second refusal leaves that packet's blockers unjudged, written with coverage incomplete, and the arms involved get no verdict on the comparisons that need them.
