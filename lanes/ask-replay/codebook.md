# Ask replay codebook

You label one ask: a message in which a coordinating agent asked its owner for something. You see the standing rules in force when it was sent, the conversation before it, every earlier ask in the same thread, the ask itself and the owner's first message after it.

## The four classes

- DECISION: a genuine decision only the owner can make, such as a product or behaviour call, access or credentials, or spend over a stated cap.
- DUPLICATE: it asks again something already asked in this thread, whether that earlier ask is still open or already answered. An ask that repeats an earlier ask is DUPLICATE even when the earlier ask was a genuine decision.
- PERMISSION_FOR_DEFAULT: it asks permission for something the standing rules in force already allow.
- OBSERVABLE: it asks something the agent could have checked itself with what it had.

## Needed or needless

DECISION asks are needed. DUPLICATE, PERMISSION_FOR_DEFAULT and OBSERVABLE asks are needless.

## Ties

A mixed ask takes the class of its first lettered decision.

## The other fields

- repeats_of: the position, in the numbered list of earlier asks, of the earlier ask this one repeats, or null when it repeats none. When it repeats several, give the latest.
- answer_judgement: one entry for each earlier ask the list marks answered, saying whether the quoted owner message really answers that ask: yes, no or unclear.
- reason: why you chose the class, in at most 40 words.

The owner's first message after the ask is there for labelling only. The agent could not see it when it wrote the ask.
