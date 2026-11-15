You audit a plan that was written before a bug fix. Below are the plan, and the commit message and diff of a later fix that repaired a bug in the code the plan describes.

Decide whether the plan states behavior at the condition the fix handles. The plan fails if it states the fixed behavior, hints at it, or states the buggy behavior (what the code did there before the fix). It passes only when it says nothing either way about that condition. Also decide whether the plan holds code beyond function signatures.

End your reply with exactly these two lines, each with one of its words:
CONDITION: SILENT or FIXED or BUGGY or BOTH
CODE: SIGNATURES or MORE

## Plan

{{PLAN}}

## Fix commit message

{{FIX_MESSAGE}}

## Fix diff

{{FIX_DIFF}}
