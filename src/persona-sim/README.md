# persona-sim

A simulated person for evals where an assistant talks with someone who holds facts it must draw out. The module knows a person sheet and the visible transcript, and nothing else: no answer keys, flags, arms, models under test or scores. The caller brings its own rules text and its own model call, so another eval can reuse it unchanged. The office-hours founder eval (lanes/office-hours-founder/sim/) is its first user.

## Modules

- **sim.ts** runs one person turn. `personTurn({ sheet, transcript, call })` renders the system prompt (the caller's rules text, then the sheet), maps the transcript to chat messages, calls the injected `SimCall` and checks the output. It returns one of three outcomes: `reply` (the reply, the revealed ids, the rules applied, the attempts and the request digests), `check-failed` (the checks the second attempt failed) or `call-failed` (the call itself failed: `allowance`, `provider` or `drift`). `SIM_SHA256` is the sha256 of the file, so the rendering, the checks and the retry notes travel with every logged turn.
- **audit.ts** audits one turn. `auditPrompt` renders the auditor prompt from the caller's violation definitions, the sheet, the assistant's last message, the reply and the logged ids. `auditTurn` sends it through an injected `AuditCall` and reads the codes marked. `combine` turns two auditors' reads into `fail`, `disputed` or `clean`.

## Build-time choices

1. The system prompt is the rules text with trailing whitespace trimmed, a blank line, `The sheet:` and the sheet as indented JSON with the keys `persona`, `opening` and `facts`. Each fact carries only its `id`, `text` and `reveal_when`. The key is `facts` because the founder prompt says "your facts"; it is not founder-specific.
2. The transcript must start and end with an assistant message, so the chat always opens with a user message. The opening lives only on the sheet. Assistant messages go to the model as user messages and the person's earlier replies as assistant messages, as plain text, never as the JSON the model wrote.
3. The output counts as JSON when the whole output is one JSON object, or the whole output is one fenced block whose body is one JSON object. Prose before or after either fails the `json` check.
4. The `json` check needs `reply` a non-empty string, `revealed` an array of strings and `rules` an array of integers. Other keys are ignored. Rule numbers are not range-checked, because the module does not know the caller's rules. Duplicate ids are dropped.
5. The `ids` check fails when any revealed id is not on the sheet. The `words` check fails above 150 words, counted by splitting on whitespace. Both are reported together. When the `json` check fails, the others are not run.
6. The retry sends the same system prompt and messages with a fixed note for each failed check added to the end of the system prompt. The note goes there, not into the chat, so the assistant's last message stays the last message.
7. A call failure returns `call-failed` at once and is never retried here; retrying is the caller's choice. A call failure on the retry attempt also returns `call-failed`.
8. Each request's digest is the sha256 of the JSON of `{ system, messages }`. The caller's model client keeps its own cache key.
9. The auditor answers with `{"marked": [codes]}`, alone or as one fenced block. An answer with a code that is not on the caller's list, or any other shape, is unreadable.
10. An unreadable answer is resent once. Still unreadable, it fails closed: it counts as that auditor marking the turn, under the code `UNREADABLE`. So an auditor that can't answer never clears a turn, and two unreadable answers fail it.
11. A turn fails when both auditors mark at least one violation, even different ones. It is disputed when one alone marks a violation.
