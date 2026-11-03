# Judge brief v3, panel v3 E0 screen

Frozen for the panel v3 E0 screen. It is the CEO panel v2 brief (#127) with three paragraphs added under Matching packets, the anchors named, and the fixed settings changed for E0's three full reads; nothing else differs. The judge runner (`noloss judge-run`) sends each judge this brief, then the batch's batch.json and one packet, both written by `noloss judge-packet` at the pin. Those files carry the suite's judging rule, the reply format and the reply rules, so this brief adds only the framing.

## Matching packets

You are one of several judges reading anonymous reviews of one product plan. The packet holds the plan and its context as they were before any review, the plan's known flaws (blockers) with each one's section and cause, and findings from several reviews under opaque ids, in a shuffled order. Severity words and some review-template heading words are removed from the findings. You do not know which review wrote which finding, and you must not guess.

For every blocker, list the ids of the findings that name the same defect under the judging rule: the same cause in the same plan section, with the section as evidence. The line may differ. A finding that names a different problem in the same section does not match. A finding that gives the same cause under another heading matches only when its evidence points at the same part of the plan. An empty list is a valid answer. Judge the defect only; severity is applied mechanically afterwards.

Six kinds of blocker need a closer reading. Each blocker's cause says which kind it is, and a blocker may be of two kinds at once (for example a missing step that a computation shows is needed); then a finding must meet the rule of each.

- **A conflict between two places.** The cause names both places (two plan sections, or a plan section and a context file). A finding under either heading matches when it names the same conflict between the two. A finding that names a problem in only one of the two places, without the conflict, does not match.
- **A false fact or a hidden commitment.** The cause says what the plan states as fact, or what in-scope item is larger, blocked or owned elsewhere, and what in the context shows it. A finding matches only when it states that fact (the number, date, segment, owner or size the context shows), not a general doubt such as "the timeline looks optimistic" or "this assumes X without evidence".
- **A decision.** The cause states the decision the plan makes, the decision it should become and the evidence. A finding matches, under any heading, when it says that decision is wrong for the reason the cause gives, citing that evidence or the fact it shows, and calls for changing, stopping or re-scoping the decision. It need not name the same remedy: "stop and validate the real cause before building", with the same diagnosis, matches. A call for more research without that diagnosis does not. When the cause says the plan should replace an approach rather than tune it, the finding must call for a change of approach, not more tuning of the same system.
- **A missing step.** The cause names a step the plan never mentions. A finding matches when it names that specific missing step for the specific object (the table, endpoint, screen state, date or dependency) and gives either the context fact that makes the step required or the concrete consequence of leaving it out. "Add a rollback plan", "consider accessibility" or "think about migration" does not match.
- **A deciding fact or a computation.** The cause gives a fact that is written nowhere and follows from two places, or a computation over numbers from several files. A finding matches when it states the conclusion and the deciding fact or number it rests on, for example "the 12k requests a minute at stage 3 exceed the vendor's 10k limit". A right conclusion with a wrong reason does not match. Arithmetic need not be exact; the deciding comparison must be right.
- **Code behavior.** The cause says what the code does that breaks the plan's assumption. A finding matches when it names that behavior (the file, the function or the behavior itself). "Verify the handler is idempotent", without saying it isn't, does not match.

Some blockers are plain on purpose: a conflict between two places, a false fact or a hidden commitment, each resting on one fact in one place. Judge them by the first two rules above.

Reply with one JSON object in the reply format the instructions give, and nothing else.

## Adjudication packets

Every finding in these packets was rated must-fix by some review and matches no known flaw. Rule each one: defect when it names a real problem that would change what gets built, or how well, as the plan and its context show; not-defect when it does not, including restatements of the plan, matters of taste and claims the context contradicts; known-informational when it flags the plan's justified choice. An evidence sheet follows each packet with the evidence each finding gave and the plan lines around the line it names. Add one extra key per packet, `verifiable`, mapping every finding id to true when the packet and the sheet were enough to rule either way and false when they were not. Reply in the instructions' reply format plus that key, and nothing else.

## Fixed settings

- Three full matching reads of one packet batch, one judge-run call each, each its own ledger item: openai/gpt-6.1-sol (the first judge, cross-family to both subject models), anthropic/claude-opus-5-5 (the second judge) and anthropic/claude-sonnet-5-5 (the third). Each call's primary read answers every blocker in every packet; E0 scores from those three primary replies only (prereg section 6). judge-run requires a distinct second and third model in every call, so each call names the other two; their partial reads are recorded and decide nothing.
- Reasoning effort medium (JUDGE_REASONING_EFFORT), at most 16,000 output tokens, no tools.
- Packet seed 20261103. E0 runs no adjudication batch; the adjudication paragraph stands for the rounds after E0.
- A reply judge-run refuses is asked again once with the same input. A second refusal leaves that packet unjudged for that role, and E0 reads the result as section 6 says.
