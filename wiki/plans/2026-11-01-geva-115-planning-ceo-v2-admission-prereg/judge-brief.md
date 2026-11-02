# Judge brief, CEO panel v2 admission pilot

Frozen for the CEO panel v2 admission pilot. It is R1a's brief with three paragraphs added under Matching packets and the seeds changed; nothing else differs. The judge runner (`noloss judge-run`) sends each judge this brief, then the batch's batch.json and one packet, both written by `noloss judge-packet` at the pin. Those files carry the suite's judging rule, the reply format and the reply rules, so this brief adds only the framing.

## Matching packets

You are one of several judges reading anonymous reviews of one product plan. The packet holds the plan and its context as they were before any review, the plan's known flaws (blockers) with each one's section and cause, and findings from several reviews under opaque ids, in a shuffled order. Severity words and some review-template heading words are removed from the findings. You do not know which review wrote which finding, and you must not guess.

For every blocker, list the ids of the findings that name the same defect under the judging rule: the same cause in the same plan section, with the section as evidence. The line may differ. A finding that names a different problem in the same section does not match. A finding that gives the same cause under another heading matches only when its evidence points at the same part of the plan. An empty list is a valid answer. Judge the defect only; severity is applied mechanically afterwards.

Three kinds of blocker need a closer reading. Each blocker's cause says which kind it is.

- **A conflict between two places.** The cause names both places (two plan sections, or a plan section and a context file). A finding under either heading matches when it names the same conflict between the two. A finding that names a problem in only one of the two places, without the conflict, does not match.
- **A false fact or a hidden commitment.** The cause says what the plan states as fact, or what in-scope item is larger, blocked or owned elsewhere, and what in the context shows it. A finding matches only when it states that fact (the number, date, segment, owner or size the context shows), not a general doubt such as "the timeline looks optimistic" or "this assumes X without evidence".
- **A decision.** The cause states the decision the plan makes, the decision it should become and the evidence. A finding matches, under any heading, when it says that decision is wrong for the reason the cause gives, citing that evidence or the fact it shows, and calls for changing, stopping or re-scoping the decision. It need not name the same remedy: "stop and validate the real cause before building", with the same diagnosis, matches. A call for more research without that diagnosis does not. When the cause says the plan should replace an approach rather than tune it, the finding must call for a change of approach, not more tuning of the same system.

Some blockers are deliberate choices that the plan's context justifies. For those, list the findings that flag that choice as a problem, whatever reason they give.

Reply with one JSON object in the reply format the instructions give, and nothing else.

## Adjudication packets

Every finding in these packets was rated must-fix by some review and matches no known flaw. Rule each one: defect when it names a real problem that would change what gets built, or how well, as the plan and its context show; not-defect when it does not, including restatements of the plan, matters of taste and claims the context contradicts; known-informational when it flags the plan's justified choice. An evidence sheet follows each packet with the evidence each finding gave and the plan lines around the line it names. Add one extra key per packet, `verifiable`, mapping every finding id to true when the packet and the sheet were enough to rule either way and false when they were not. Reply in the instructions' reply format plus that key, and nothing else.

## Fixed settings

- Primary judge openai/gpt-6.1-sol (cross-family to the Opus 5.5 arms; it shares a family with the panel's authors); second judge anthropic/claude-opus-5-5 on every blocker where the arms differ plus a seeded 20% sample, as judge-join names them; third judge anthropic/claude-sonnet-5-5 on the same packet, only where the first two differ. judge-run refuses a third model equal to the first or second.
- Reasoning effort medium (JUDGE_REASONING_EFFORT), at most 16,000 output tokens, no tools.
- Packet seed 20261102 for matching and 20261103 for adjudication.
- A reply judge-join refuses is asked again once with the same input. A second refusal leaves that packet's blockers unjudged, written with coverage incomplete, and the arms involved get no verdict on the comparisons that need them.
